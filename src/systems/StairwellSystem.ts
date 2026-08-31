import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LevelDef } from '../levels/types';
import type { GameSystem, SystemContext } from './GameSystem';
import { getLevelDef } from '../levels';
import { recommendedPartyLevelFor } from '../levels/spawner';
import { activeDifficultyProfile } from '../core/difficultyProfiles';
import type { DifficultyProfile } from '../core/difficultyProfiles';
import { drawText, measureTextBox, TEXT_PRESETS } from '../ui/TextBox';
import type { TextOptions } from '../ui/TextBox';
import { drawModal, drawOverlay, BOX_PRESETS } from '../ui/Box';
import { addButton, beginMenuFocus, endMenuFocus, BUTTON_PRESETS } from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { clamp } from '../utils';

const TILE_CENTER_OFFSET = 0.5;
// Stairwell rendering
const STAIRWELL_SCALE = 2;
const STAIRWELL_PULSE_CENTER = 0.7;
const STAIRWELL_PULSE_AMPLITUDE = 0.2;
const STAIRWELL_PULSE_SPEED = 500; // ms
const STAIRWELL_BORDER_WIDTH = 2;
const STAIRWELL_ICON_SIZE_RATIO = 0.42;
const STAIRWELL_ICON_Y_RATIO = 0.67;
const STAIRWELL_ICON_Y_ADJUST = 0.8;
const STAIRWELL_OFFSCREEN_MARGIN = 2; // measured in stairwell-widths

// Stairwell draft (ambient dust motes that drift toward an open stairwell)
const STAIRWELL_DRAFT_RADIUS_TILES = 42;
const STAIRWELL_DRAFT_RADIUS_PX = STAIRWELL_DRAFT_RADIUS_TILES * TILE_SIZE;
/**
 * Motes per tile of draft radius.
 *
 * A pool is a stream: motes recycle at the outer edge and travel inward at a
 * constant speed, so in the steady state they spread evenly *along the radius*
 * rather than over the area. Density therefore scales with radius, not with
 * radius squared — holding this ratio fixed is what keeps the near-field look
 * of the draft unchanged as the field grows.
 */
const STAIRWELL_DRAFT_MOTES_PER_RADIUS_TILE = 1.75;
const STAIRWELL_DRAFT_MOTES_MAX = Math.round(
  STAIRWELL_DRAFT_RADIUS_TILES * STAIRWELL_DRAFT_MOTES_PER_RADIUS_TILE,
);
/** Well under the player's move speed so the draft reads as ambient, not as something to chase. */
const STAIRWELL_DRAFT_MOTE_SPEED = 0.4;
const STAIRWELL_DRAFT_MOTE_ALPHA_MAX = 0.5;
const STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX = 1;
const STAIRWELL_DRAFT_MOTE_RADIUS_MAX_PX = 2.5;
const STAIRWELL_DRAFT_RESPAWN_DIST_TILES = 0.75;
/** A mote this close to the footprint centre has reached the hole and recycles to the outer edge. */
const STAIRWELL_DRAFT_RESPAWN_DIST_PX = TILE_SIZE * STAIRWELL_DRAFT_RESPAWN_DIST_TILES;
const STAIRWELL_DRAFT_FADE_ZONE_TILES = 3;
/** Distance over which a mote fades in from the outer edge, and fades out just before it recycles. */
const STAIRWELL_DRAFT_FADE_ZONE_PX = TILE_SIZE * STAIRWELL_DRAFT_FADE_ZONE_TILES;
const STAIRWELL_DRAFT_MOTE_COLOR_RGB = '216, 200, 235'; // pale violet dust, echoing the stairwell glow
/** Render's own wider cull margin, since motes live well outside the sprite's own footprint. */
const STAIRWELL_DRAFT_CULL_MARGIN_PX = STAIRWELL_DRAFT_RADIUS_PX;
const ALPHA_CHANNEL_STEPS = 256;
/** Below one step of an 8-bit alpha channel a mote cannot resolve to a pixel at all. */
const STAIRWELL_DRAFT_MIN_VISIBLE_ALPHA = 1 / (ALPHA_CHANNEL_STEPS - 1);
/** Inside this range of a stairwell the draft is at full strength, as it always was. */
const STAIRWELL_DRAFT_FULL_STRENGTH_RADIUS_TILES = 14;
const STAIRWELL_DRAFT_FULL_STRENGTH_RADIUS_PX =
  STAIRWELL_DRAFT_FULL_STRENGTH_RADIUS_TILES * TILE_SIZE;
/**
 * What the draft's alpha falls to at the very edge of its range. Small enough
 * to read as a hint of movement at the corner of the eye rather than as dust,
 * but deliberately not zero: the fade has to bottom out at something visible,
 * or the extra range buys nothing.
 */
const STAIRWELL_DRAFT_FAR_STRENGTH_FACTOR = 0.12;
/**
 * How often the "which stairwells does this player's draft cover, and how
 * strongly" decision is re-taken (1 s at the fixed 60 fps timestep). The answer
 * turns over on the scale of a player walking tens of tiles, so re-deriving it
 * every frame — over every stairwell on the floor — is work spent to learn the
 * same thing sixty times. Motes still step every frame; only the selection is
 * throttled.
 */
const STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES = 60;
/**
 * How much of the gap to a pool's newly selected strength is closed each frame,
 * as an exponential approach.
 *
 * The selection is throttled, but its *result* must not be: strength multiplies
 * every mote in a pool at once, so applying a new value the frame it is chosen
 * makes the whole field brighten or dim in one step, once a second — a pulse,
 * and precisely the popping the wide draft radius exists to avoid.
 *
 * The time constant has to sit comfortably inside
 * `STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES`: a third of a second means a
 * step has visibly finished before the next decision arrives, so the draft
 * never lags far enough behind the player to be wrong about where they are.
 */
const STAIRWELL_DRAFT_STRENGTH_SETTLE_FRAMES = 20;
const STAIRWELL_DRAFT_STRENGTH_APPROACH_PER_FRAME = 1 / STAIRWELL_DRAFT_STRENGTH_SETTLE_FRAMES;
/**
 * A single-frame move further than this is not a walk. Nothing in the game
 * covers two tiles in a frame — the fastest follower speed is a few pixels, and
 * even a separation shove tops out around a tile — so a jump this large means
 * the player was placed somewhere new: fast travel, a respawn, a checkpoint
 * restore, a scene hand-off. The throttled pool selection still describes where
 * they *were*, and has to be re-taken now rather than up to a second later.
 */
const STAIRWELL_DRAFT_TELEPORT_JUMP_TILES = 2;
const STAIRWELL_DRAFT_TELEPORT_JUMP_PX = STAIRWELL_DRAFT_TELEPORT_JUMP_TILES * TILE_SIZE;
const STAIRWELL_DRAFT_TELEPORT_JUMP_PX_SQ =
  STAIRWELL_DRAFT_TELEPORT_JUMP_PX * STAIRWELL_DRAFT_TELEPORT_JUMP_PX;

// Wayfinder fail-safe (a last-resort bearing for a crawler the breadcrumbs failed)
/** Frames of fruitless hunting after the last gauntlet boss before the pulse starts (90 s at 60 fps). */
export const WAYFINDER_GRACE_FRAMES = 5400;
/** How often the pulse repeats once it has started (10 s at 60 fps). */
export const WAYFINDER_PULSE_PERIOD_FRAMES = 600;
/** How long each pulse stays on screen (1.5 s at 60 fps). */
export const WAYFINDER_PULSE_VISIBLE_FRAMES = 90;
/** A nudge, not a route: the bearing is rounded to N/NE/E/SE/S/SW/W/NW. */
const WAYFINDER_COMPASS_SECTORS = 8;
const WAYFINDER_COMPASS_SECTOR_RADIANS = (Math.PI * 2) / WAYFINDER_COMPASS_SECTORS;
/**
 * How many of the fail-safe's motes may be adrift at once. The hint is the
 * same dust the stairwell's own draft is made of, so it has to stay countable:
 * a handful reads as a stream, and a stream near the player is a place, not a
 * direction.
 */
export const WAYFINDER_MOTE_MAX_ALIVE = 2;
/** Frames between spawns while a pulse is on screen — with the life below, a pulse sheds two motes. */
export const WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES = 45;
/**
 * How long one mote drifts before it fades out (3 s at 60 fps). Deliberately
 * longer than a pulse: the mote is the message, so it has to outlive the window
 * that released it and still be travelling when the player looks over at it.
 */
export const WAYFINDER_MOTE_LIFE_FRAMES = 180;
/** Frames a mote spends fading in at the start of its life, and fading out again at the end. */
const WAYFINDER_MOTE_FADE_FRAMES = 40;
/**
 * Faster than the ambient draft, because this mote has one life to say which
 * way it is going rather than an endless stream to say it with — but still well
 * under a walking crawler, so it reads as something the air is doing.
 */
const WAYFINDER_MOTE_SPEED = 1;
const WAYFINDER_MOTE_TRAVEL_PX = WAYFINDER_MOTE_SPEED * WAYFINDER_MOTE_LIFE_FRAMES;
/**
 * How far back along the bearing a mote starts, as a fraction of the ground it
 * will cover. Half, so it passes the crawler around the middle of its life:
 * spawning level with them would put the whole drift on one side of the screen
 * and waste the half of the journey that best shows the direction.
 */
const WAYFINDER_MOTE_LEAD_FRACTION = 0.5;
const WAYFINDER_MOTE_LEAD_PX = WAYFINDER_MOTE_TRAVEL_PX * WAYFINDER_MOTE_LEAD_FRACTION;
/** Sideways scatter at spawn, so successive motes are not a dotted line drawn through the player. */
const WAYFINDER_MOTE_LATERAL_SPREAD_TILES = 3;
const WAYFINDER_MOTE_LATERAL_SPREAD_PX = WAYFINDER_MOTE_LATERAL_SPREAD_TILES * TILE_SIZE;
/**
 * The same ceiling the draft's own motes fade up to. Matching it is the whole
 * point of the hint: a player who has learned to read the dust near a stairwell
 * should not be able to tell that this one was sent on purpose.
 */
const WAYFINDER_MOTE_ALPHA_MAX = STAIRWELL_DRAFT_MOTE_ALPHA_MAX;

const STAIRWELL_FOOTPRINT_HALF_PX = (TILE_SIZE * STAIRWELL_SCALE) / 2;

function footprintCenterX(tileX: number): number {
  return tileX * TILE_SIZE + STAIRWELL_FOOTPRINT_HALF_PX;
}

function footprintCenterY(tileY: number): number {
  return tileY * TILE_SIZE + STAIRWELL_FOOTPRINT_HALF_PX;
}

/**
 * How strongly a stairwell's draft draws for a player this far from it: full
 * strength close in, then a smooth ramp down to a faint but non-zero floor at
 * the edge of the draft's range. Smooth rather than stepped so a draft never
 * announces itself by popping on — the far edge is meant to be something the
 * player notices before they know why.
 */
function draftStrengthAtPlayerDistance(distPx: number): number {
  const fadeSpanPx = STAIRWELL_DRAFT_RADIUS_PX - STAIRWELL_DRAFT_FULL_STRENGTH_RADIUS_PX;
  const fadeProgress = clamp((distPx - STAIRWELL_DRAFT_FULL_STRENGTH_RADIUS_PX) / fadeSpanPx, 0, 1);
  return 1 - fadeProgress * (1 - STAIRWELL_DRAFT_FAR_STRENGTH_FACTOR);
}

/**
 * The centre bearing of the compass sector an angle falls in.
 *
 * Rounding to the sector centre — rather than to its near edge — is what makes
 * successive pulses agree with each other: a player drifting within one sector
 * sees the same arrow every time, which is the difference between a direction
 * and a live tracker.
 */
function quantizeBearingToCompass(angleRadians: number): number {
  return (
    Math.round(angleRadians / WAYFINDER_COMPASS_SECTOR_RADIANS) * WAYFINDER_COMPASS_SECTOR_RADIANS
  );
}

// Menu rendering
const STAIRWELL_MENU_OVERLAY_ALPHA = 0.55;
const STAIRWELL_MENU_PANEL_WIDTH = 360;
const STAIRWELL_MENU_PANEL_MARGIN = 32;
/** Panel height with no warning shown; each wrapped warning line adds a line height. */
const STAIRWELL_MENU_PANEL_BASE_HEIGHT = 184;
const STAIRWELL_MENU_BODY_MARGIN = 36;
const STAIRWELL_MENU_TITLE_Y_OFFSET = 20;
const STAIRWELL_MENU_TITLE_SIZE = 18;
const STAIRWELL_MENU_PROMPT_Y_OFFSET = 54;
const STAIRWELL_MENU_PROMPT_SIZE = 13;
const STAIRWELL_MENU_RECOMMENDED_Y_OFFSET = 80;
const STAIRWELL_MENU_WARNING_Y_GAP = 20;
const STAIRWELL_MENU_WARNING_SIZE = 10;
const STAIRWELL_MENU_WARNING_LINE_HEIGHT = 15;
const STAIRWELL_MENU_HINT_SIZE = 10;
/** Minimum gap kept between the warning text (or recommended-level line) and the hint below it. */
const STAIRWELL_MENU_CONTENT_TO_HINT_GAP = 18;
const STAIRWELL_MENU_BUTTON_WIDTH = 130;
const STAIRWELL_MENU_BUTTON_HEIGHT = 40;
const STAIRWELL_MENU_BUTTON_GAP = 16;
const STAIRWELL_MENU_BUTTON_BOTTOM_OFFSET = 56;
/** Gap between the hint line and the button row below it. */
const STAIRWELL_MENU_HINT_TO_BUTTON_GAP = 16;
/**
 * Hard floor for the button row on a viewport too short to fit the panel's
 * requested height even after clamping: half the panel's own edge margin, so
 * the row still keeps some daylight from the canvas edge instead of touching it.
 */
const STAIRWELL_MENU_BUTTON_HARD_FLOOR_MARGIN = STAIRWELL_MENU_PANEL_MARGIN / 2;
const STAIRWELL_MENU_BUTTON_TEXT_SIZE = 14;
const STAIRWELL_MENU_BORDER_COLOR = '#a855f7';
const STAIRWELL_MENU_TITLE_TEXT_COLOR = '#e9d5ff';
const STAIRWELL_MENU_PROMPT_TEXT_COLOR = '#94a3b8';
const STAIRWELL_MENU_HINT_TEXT_COLOR = '#64748b';
/** The consequence-line amber every modal in the game warns in. */
const STAIRWELL_MENU_WARNING_COLOR = '#fbbf24';
/** Marks the recommended-level line as advice the party has not met yet. */
const STAIRWELL_MENU_RECOMMENDED_WARNING_PREFIX = '⚠ ';
/**
 * A hint of a halo behind the red, so the line catches the eye without the
 * bloom a full-strength glow puts on a 12px string.
 */
const STAIRWELL_MENU_RECOMMENDED_GLOW_BLUR = 4;
const STAIRWELL_MENU_RECOMMENDED_GLOW_COLOR = '#ffffff';
/** The advice is not merely met but comfortably cleared. */
const STAIRWELL_MENU_RECOMMENDED_ABOVE_COLOR = '#4ade80';

/** A point-in-time copy of the descend prompt's state, and of the Wayfinder's. */
export interface StairwellCheckpoint {
  dismissed: boolean;
  onStairwell: boolean;
  menuOpen: boolean;
  /** Frames since the Wayfinder armed, or null while it is unarmed or retired. */
  wayfinderFrames: number | null;
  wayfinderRetired: boolean;
  wayfinderAnnounced: boolean;
}

interface DraftMote {
  x: number;
  y: number;
  radiusPx: number;
  /** Cached from the last update step so render doesn't re-derive it for the fade. */
  distToCenter: number;
}

/**
 * One mote of the Wayfinder fail-safe: a single grain of the stairwell's dust,
 * released near a lost crawler and drifting off along the bearing so they can
 * read where it is going. Lives in world pixels, like the draft's own motes, so
 * the camera moving does not move it.
 */
interface WayfinderMote {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  radiusPx: number;
  ageFrames: number;
}

/** One stairwell's active pool of draft motes, keyed by its footprint centre in world pixels. */
interface DraftPool {
  centerX: number;
  centerY: number;
  motes: DraftMote[];
  /**
   * How strongly this pool draws right now — what render multiplies mote alpha
   * by. Chases `targetStrength` a fraction of the remaining gap per frame so a
   * throttled selection never lands as a visible step.
   */
  strength: number;
  /** The strength the last selection pass chose for the player's distance. */
  targetStrength: number;
  /** The selection pass that last claimed this pool; an older one means it is out of range. */
  selectionPass: number;
}

/** How the party's level sits against the next floor's recommendation. */
type PartyStanding = 'below' | 'met' | 'above';

type RecommendedLineStyle = Pick<
  TextOptions,
  'size' | 'bold' | 'color' | 'glow' | 'glowBlur' | 'strikethrough'
>;

/**
 * How the recommended-level line is dressed for a given standing.
 *
 * The struck-through variants say the same thing the colour does twice over:
 * this is advice you have already satisfied, and the number is here for
 * reference rather than as something to act on.
 */
function recommendedLineStyle(standing: PartyStanding): RecommendedLineStyle {
  switch (standing) {
    case 'below':
      return {
        ...TEXT_PRESETS.danger,
        glow: STAIRWELL_MENU_RECOMMENDED_GLOW_COLOR,
        glowBlur: STAIRWELL_MENU_RECOMMENDED_GLOW_BLUR,
      };
    case 'met':
      return { ...TEXT_PRESETS.value, strikethrough: true };
    case 'above':
      return {
        ...TEXT_PRESETS.value,
        color: STAIRWELL_MENU_RECOMMENDED_ABOVE_COLOR,
        strikethrough: true,
      };
  }
}

interface DescentAdvice {
  party: number;
  recommended: number;
  standing: PartyStanding;
}

export class StairwellSystem implements GameSystem {
  private onStairwell = false;
  private _menuOpen = false;
  private dismissed = false;
  /** Rebuilt by `renderMenu`, so a click and the thing it hits can never drift apart. */
  private menuButtons: ButtonRect[] = [];
  /**
   * One entry per stairwell currently near the player, keyed by footprint tile
   * (`x,y`). Ambient VFX, not game state: it needs no checkpoint capture,
   * because every frame re-derives which stairwells are active from the
   * player's position and drops the rest — and any jump in that position forces
   * that re-derivation immediately — so a checkpoint restore self-corrects on
   * its very next update.
   */
  private draftPools = new Map<string, DraftPool>();
  /**
   * Counts up to `STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES`; a selection pass
   * runs when it reaches it. Starts at the interval so the very first update
   * selects rather than leaving the floor draftless for a second.
   */
  private draftSelectionFrames = STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES;
  /** Bumped per selection pass, so a pool the pass didn't claim can be recognised without a Set. */
  private draftSelectionPass = 0;
  /**
   * Where the active crawler stood at the last draft update, so a teleport can
   * be recognised as the jump it is. Null until the first update, and after a
   * checkpoint restore, where there is no previous position to compare against.
   */
  private lastDraftPlayerX: number | null = null;
  private lastDraftPlayerY: number | null = null;

  private wayfinderFrames: number | null = null;
  private wayfinderRetired = false;
  private wayfinderAnnounced = false;
  /**
   * Ambient VFX like the draft pools, and left out of the checkpoint for the
   * same reason: a restore drops them, and the next pulse releases more.
   */
  private wayfinderMotes: WayfinderMote[] = [];
  /**
   * Counts down between mote releases. Starts at zero so the first frame of a
   * pulse sheds a mote rather than opening with a pause the player reads as
   * nothing happening.
   */
  private wayfinderSpawnCooldownFrames = 0;
  /**
   * Raised the frame the first pulse becomes visible; the scene lowers it once
   * it has said the line. A drained flag rather than a callback because the
   * announcer belongs to the scene, and this is the same hand-off every other
   * "the system noticed something worth saying" case in the dungeon uses.
   */
  wayfinderAnnouncePending = false;

  /**
   * Cache for `descentAdvice`, which the menu asks about on every render call
   * (~60/sec while it's open). The chain underneath — `recommendedPartyLevelFor`
   * running an up-to-60-iteration search that rescans every room/hallway/camp
   * spawn rule per iteration — is expensive enough that redoing it every frame
   * shows up on the profiler, even though its result only changes when the
   * party's level or the active difficulty profile changes.
   */
  private descentAdviceCache: {
    nextId: string;
    party: number;
    profile: DifficultyProfile;
    result: DescentAdvice;
  } | null = null;

  /**
   * @param partyLevel Read at render time rather than passed in once, because
   *   the menu can be re-opened after levelling up without the system being
   *   rebuilt — a stale party level would advise against a floor the crawler has
   *   since grown into.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly levelDef: LevelDef,
    private readonly onDescend: () => void,
    private readonly partyLevel: () => number,
  ) {}

  captureCheckpoint(): StairwellCheckpoint {
    return {
      dismissed: this.dismissed,
      onStairwell: this.onStairwell,
      menuOpen: this._menuOpen,
      wayfinderFrames: this.wayfinderFrames,
      wayfinderRetired: this.wayfinderRetired,
      wayfinderAnnounced: this.wayfinderAnnounced,
    };
  }

  /**
   * `onStairwell` is restored alongside the flags it gates, because `detect`
   * reads it as the *previous* frame's answer: leaving it stale would make the
   * first frame after the restore look like a fresh arrival and pop the descend
   * menu at a player who has just respawned.
   *
   * The Wayfinder rides along for the opposite reason: a death mid-hunt costs
   * the player time, so rewinding its clock would punish the death twice, and
   * dropping the retired latch would put the hint back on a floor whose
   * stairwell has already been found. Its motes are cleared rather than
   * restored — they were released around a crawler who is no longer standing
   * there, and the next pulse sheds more.
   *
   * The draft's pool selection is not snapshotted — it is ambient VFX — but it
   * is *invalidated* here: a restore puts the crawler back at a checkpoint that
   * can be a whole floor away, and the throttled selection would otherwise keep
   * stepping the old position's pools for up to a second, leaving the stairwell
   * they respawned beside with no motes at all.
   */
  restoreCheckpoint(snapshot: StairwellCheckpoint): void {
    this.forceDraftReselect();
    this.wayfinderMotes.length = 0;
    this.dismissed = snapshot.dismissed;
    this.onStairwell = snapshot.onStairwell;
    this._menuOpen = snapshot.menuOpen;
    this.wayfinderFrames = snapshot.wayfinderFrames;
    this.wayfinderRetired = snapshot.wayfinderRetired;
    this.wayfinderAnnounced = snapshot.wayfinderAnnounced;
  }

  /**
   * Starts the fail-safe's grace clock. Idempotent: re-arming would hand a
   * player who has already hunted for a minute a fresh 90 seconds of silence.
   */
  armWayfinder(): void {
    if (!this.levelDef.nextLevelId) return;
    if (this.wayfinderRetired || this.wayfinderFrames !== null) return;
    this.wayfinderFrames = 0;
  }

  /** Ends the fail-safe for the rest of the floor — the hunt is over. */
  retireWayfinder(): void {
    this.wayfinderRetired = true;
    this.wayfinderFrames = null;
    this.wayfinderAnnouncePending = false;
  }

  private tickWayfinder(active: { x: number; y: number }): void {
    // Motes outlive the pulse that released them, so they are stepped whatever
    // the clock is doing — including on a floor whose fail-safe has just retired
    // because the player finally walked onto the stairs.
    this.stepWayfinderMotes();

    const frames = this.wayfinderFrames;
    if (frames === null || this.wayfinderRetired) return;
    this.wayfinderFrames = frames + 1;
    if (!this.wayfinderPulseVisible()) return;

    if (!this.wayfinderAnnounced) {
      this.wayfinderAnnounced = true;
      this.wayfinderAnnouncePending = true;
    }
    this.releaseWayfinderMote(active);
  }

  private stepWayfinderMotes(): void {
    for (let i = this.wayfinderMotes.length - 1; i >= 0; i--) {
      const mote = this.wayfinderMotes[i];
      mote.ageFrames++;
      if (mote.ageFrames >= WAYFINDER_MOTE_LIFE_FRAMES) {
        this.wayfinderMotes.splice(i, 1);
        continue;
      }
      mote.x += mote.dirX * WAYFINDER_MOTE_SPEED;
      mote.y += mote.dirY * WAYFINDER_MOTE_SPEED;
    }
  }

  /**
   * Releases one mote upwind of the crawler, if the spawn cooldown has run out
   * and there is room for another. Upwind rather than at their feet: the mote
   * has to arrive from somewhere and leave somewhere, and only the leaving half
   * carries the bearing.
   */
  private releaseWayfinderMote(active: { x: number; y: number }): void {
    if (this.wayfinderSpawnCooldownFrames > 0) {
      this.wayfinderSpawnCooldownFrames--;
      return;
    }
    if (this.wayfinderMotes.length >= WAYFINDER_MOTE_MAX_ALIVE) return;

    const bearing = this.wayfinderBearing(active);
    if (bearing === null) return;

    const dirX = Math.cos(bearing);
    const dirY = Math.sin(bearing);
    const lateral = (Math.random() * 2 - 1) * WAYFINDER_MOTE_LATERAL_SPREAD_PX;
    this.wayfinderMotes.push({
      x: active.x + TILE_SIZE / 2 - dirX * WAYFINDER_MOTE_LEAD_PX - dirY * lateral,
      y: active.y + TILE_SIZE / 2 - dirY * WAYFINDER_MOTE_LEAD_PX + dirX * lateral,
      dirX,
      dirY,
      radiusPx:
        STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX +
        Math.random() * (STAIRWELL_DRAFT_MOTE_RADIUS_MAX_PX - STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX),
      ageFrames: 0,
    });
    this.wayfinderSpawnCooldownFrames = WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES;
  }

  private wayfinderPulseVisible(): boolean {
    const frames = this.wayfinderFrames;
    if (frames === null || this.wayfinderRetired) return false;
    const huntedFrames = frames - WAYFINDER_GRACE_FRAMES;
    if (huntedFrames < 0) return false;
    return huntedFrames % WAYFINDER_PULSE_PERIOD_FRAMES < WAYFINDER_PULSE_VISIBLE_FRAMES;
  }

  /**
   * The compass bearing a fail-safe mote drifts along, or null when there is no
   * stairwell to point at.
   *
   * Rounded to the compass rather than aimed exactly, so a crawler who watches
   * several motes in a row is given one direction to walk instead of a live
   * tracker that turns as they move.
   */
  private wayfinderBearing(from: { x: number; y: number }): number | null {
    const target = this.nearestStairwellCenter(from);
    if (target === null) return null;
    const fromCenterX = from.x + TILE_SIZE / 2;
    const fromCenterY = from.y + TILE_SIZE / 2;
    return quantizeBearingToCompass(Math.atan2(target.y - fromCenterY, target.x - fromCenterX));
  }

  /**
   * The stairwell nearest a tile, by straight-line tile distance — the metric
   * `progressionValidation.ts` and `DungeonGenerator.ts` already use for every
   * other stairwell-distance question. Undefined only on a floor that generated
   * with no stairwells, which `validateProgression`'s I4 check forbids.
   */
  nearestStairwellTile(fromTile: { x: number; y: number }): { x: number; y: number } | undefined {
    let nearest: { x: number; y: number } | undefined;
    let nearestDist = Infinity;
    for (const stairwell of this.gameMap.stairwellTiles) {
      const dist = Math.hypot(stairwell.x - fromTile.x, stairwell.y - fromTile.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = stairwell;
      }
    }
    return nearest;
  }

  /**
   * The footprint centre, in world pixels, of the stairwell nearest a world
   * position. Compares true pixel distance rather than flooring `from` to a
   * tile first: the cheat arrow and the Wayfinder both need the actual
   * nearest stairwell, and floor-then-compare can flip the winner for a
   * player standing near a tile-boundary tie between two similarly-distant
   * stairwells.
   */
  nearestStairwellCenter(from: { x: number; y: number }): { x: number; y: number } | null {
    let nearest: { x: number; y: number } | null = null;
    let nearestDistSq = Infinity;
    for (const tile of this.gameMap.stairwellTiles) {
      const center = this.footprintCenter(tile);
      const dx = center.x - from.x;
      const dy = center.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = center;
      }
    }
    return nearest;
  }

  get menuOpen(): boolean {
    return this._menuOpen;
  }

  closeMenu(): void {
    this._menuOpen = false;
    this.dismissed = true;
  }

  /**
   * `detect` is deliberately not called from here: the scene drives it itself,
   * because it watches the menu-open edge across the call to decide whether the
   * floor's first `stairwellFound` has just happened. Running it twice a frame
   * would leave that edge on the wrong side of this update.
   */
  update(ctx: SystemContext): void {
    this.updateDraftMotes(ctx.active);
    this.tickWayfinder(ctx.active);
  }

  /** The stairwell's footprint centre in world pixels, matching where `renderStairwells` draws it. */
  private footprintCenter(tile: { x: number; y: number }): { x: number; y: number } {
    return { x: footprintCenterX(tile.x), y: footprintCenterY(tile.y) };
  }

  /**
   * Steps every live draft pool, and — on the throttled selection interval —
   * re-decides which stairwells have one and how strongly each draws.
   *
   * A stairwell only gets a pool while the player is within the draft radius of
   * it, so an idle floor with several stairwells never simulates motes for the
   * ones nobody is near.
   */
  private updateDraftMotes(active: { x: number; y: number }): void {
    if (!this.levelDef.nextLevelId) {
      this.draftPools.clear();
      return;
    }

    if (this.playerJumped(active)) this.forceDraftReselect();
    this.lastDraftPlayerX = active.x;
    this.lastDraftPlayerY = active.y;

    this.draftSelectionFrames++;
    if (this.draftSelectionFrames >= STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES) {
      this.draftSelectionFrames = 0;
      this.selectDraftPools(active);
    }

    for (const pool of this.draftPools.values()) this.stepDraftPool(pool);
  }

  /**
   * Whether the active crawler was placed somewhere new since the last draft
   * update, rather than having walked there.
   *
   * This is how the draft catches every teleport it cannot be told about
   * directly — fast travel, a Wayfinder jump, a respawn — without any of those
   * callers having to know the draft exists.
   */
  private playerJumped(active: { x: number; y: number }): boolean {
    const previousX = this.lastDraftPlayerX;
    const previousY = this.lastDraftPlayerY;
    if (previousX === null || previousY === null) return false;
    const dx = active.x - previousX;
    const dy = active.y - previousY;
    return dx * dx + dy * dy > STAIRWELL_DRAFT_TELEPORT_JUMP_PX_SQ;
  }

  /**
   * Makes the next `update` re-take the pool selection instead of waiting out
   * the rest of the throttle interval.
   */
  private forceDraftReselect(): void {
    this.draftSelectionFrames = STAIRWELL_DRAFT_SELECTION_INTERVAL_FRAMES;
    this.lastDraftPlayerX = null;
    this.lastDraftPlayerY = null;
  }

  private selectDraftPools(active: { x: number; y: number }): void {
    this.draftSelectionPass++;
    const pass = this.draftSelectionPass;

    for (const tile of this.gameMap.stairwellTiles) {
      const centerX = footprintCenterX(tile.x);
      const centerY = footprintCenterY(tile.y);
      const dx = centerX - active.x;
      const dy = centerY - active.y;
      const distToPlayerSq = dx * dx + dy * dy;
      if (distToPlayerSq > STAIRWELL_DRAFT_RADIUS_PX * STAIRWELL_DRAFT_RADIUS_PX) continue;

      const targetStrength = draftStrengthAtPlayerDistance(Math.sqrt(distToPlayerSq));
      const key = `${tile.x},${tile.y}`;
      const pool = this.draftPools.get(key);
      if (pool === undefined) {
        // A pool born already at its target: walking into range should reveal a
        // draft that has always been blowing, not one that fades up as you arrive.
        this.draftPools.set(key, {
          centerX,
          centerY,
          motes: [],
          strength: targetStrength,
          targetStrength,
          selectionPass: pass,
        });
      } else {
        pool.centerX = centerX;
        pool.centerY = centerY;
        pool.targetStrength = targetStrength;
        pool.selectionPass = pass;
      }
    }

    for (const [key, pool] of this.draftPools) {
      if (pool.selectionPass !== pass) this.draftPools.delete(key);
    }
  }

  private stepDraftPool(pool: DraftPool): void {
    pool.strength +=
      (pool.targetStrength - pool.strength) * STAIRWELL_DRAFT_STRENGTH_APPROACH_PER_FRAME;

    for (let i = pool.motes.length - 1; i >= 0; i--) {
      const mote = pool.motes[i];
      const dx = pool.centerX - mote.x;
      const dy = pool.centerY - mote.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= STAIRWELL_DRAFT_RESPAWN_DIST_PX) {
        this.respawnDraftMote(mote, pool);
        continue;
      }
      mote.x += (dx / dist) * STAIRWELL_DRAFT_MOTE_SPEED;
      mote.y += (dy / dist) * STAIRWELL_DRAFT_MOTE_SPEED;
      mote.distToCenter = dist - STAIRWELL_DRAFT_MOTE_SPEED;
    }

    while (pool.motes.length < STAIRWELL_DRAFT_MOTES_MAX) {
      const mote = { x: 0, y: 0, radiusPx: 0, distToCenter: 0 };
      this.placeDraftMote(mote, pool, true);
      pool.motes.push(mote);
    }
  }

  /**
   * A fresh spawn scatters across the full radius so the pool doesn't ring in
   * all at once; a recycled mote always restarts at the outer edge so the
   * inward flow reads as continuous rather than as motes teleporting inward.
   */
  private placeDraftMote(mote: DraftMote, pool: DraftPool, scatterAcrossRadius: boolean): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = scatterAcrossRadius
      ? Math.random() * STAIRWELL_DRAFT_RADIUS_PX
      : STAIRWELL_DRAFT_RADIUS_PX;
    mote.x = pool.centerX + Math.cos(angle) * dist;
    mote.y = pool.centerY + Math.sin(angle) * dist;
    mote.radiusPx =
      STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX +
      Math.random() * (STAIRWELL_DRAFT_MOTE_RADIUS_MAX_PX - STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX);
    mote.distToCenter = dist;
  }

  private respawnDraftMote(mote: DraftMote, pool: DraftPool): void {
    this.placeDraftMote(mote, pool, false);
  }

  /** Called each gameplay frame. Detects stairwell entry and opens/closes the menu. */
  detect(active: { x: number; y: number }): void {
    if (!this.levelDef.nextLevelId) {
      this.onStairwell = false;
      return;
    }

    const wasOn = this.onStairwell;
    this.onStairwell = this.isEntityOnStairwell(active);

    if (!this.onStairwell) {
      this.dismissed = false;
      this._menuOpen = false;
    } else if (!wasOn && !this.dismissed) {
      this._menuOpen = true;
    }
  }

  isEntityOnStairwell(entity: { x: number; y: number }): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    // The map already keeps a bit per tile for exactly this 2×2 footprint test.
    return this.gameMap.isStairwellTile(tx, ty);
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._menuOpen) return false;
    for (const button of this.menuButtons) {
      if (
        mx >= button.x &&
        mx <= button.x + button.w &&
        my >= button.y &&
        my <= button.y + button.h
      ) {
        button.action?.();
        return true;
      }
    }
    return false;
  }

  renderStairwells(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.levelDef.nextLevelId) return;
    const ts = TILE_SIZE;
    const bw = ts * STAIRWELL_SCALE;
    const bh = ts * STAIRWELL_SCALE;
    const pulse =
      STAIRWELL_PULSE_CENTER +
      Math.sin(Date.now() / STAIRWELL_PULSE_SPEED) * STAIRWELL_PULSE_AMPLITUDE;
    for (const { x, y } of this.gameMap.stairwellTiles) {
      const sx = x * ts - camX;
      const sy = y * ts - camY;
      if (
        sx < -bw * STAIRWELL_OFFSCREEN_MARGIN ||
        sx > viewportWidth() ||
        sy < -bh * STAIRWELL_OFFSCREEN_MARGIN ||
        sy > viewportHeight()
      )
        continue;

      drawSpriteKey(ctx, 'stairwell', 'idle', 0, sx, sy, bw);

      ctx.strokeStyle = `rgba(168, 85, 247, ${pulse})`;
      ctx.lineWidth = STAIRWELL_BORDER_WIDTH;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);

      const arrowSize = Math.floor(bh * STAIRWELL_ICON_SIZE_RATIO);
      drawText(ctx, '▼', {
        x: sx + bw / 2,
        y: sy + bh * STAIRWELL_ICON_Y_RATIO - Math.round(arrowSize * STAIRWELL_ICON_Y_ADJUST),
        size: arrowSize,
        bold: true,
        color: `rgba(233, 213, 255, ${pulse})`,
        align: 'center',
      });
    }

    this.renderDraftMotes(ctx, camX, camY);
    this.renderWayfinderMotes(ctx, camX, camY);
  }

  /**
   * Motes are drawn on their own screen position, never on the stairwell's: a
   * field this wide is mostly off screen whenever its stairwell is on it, and
   * — the case that matters — is mostly *on* screen for a player standing at
   * the field's edge with the stairwell far behind the camera. Culling the
   * whole pool on the stairwell's position would blink out motes the player is
   * standing next to.
   *
   * The pool-level test is only a cheap way to skip a field that cannot reach
   * the screen at all, so its margin has to cover the full mote spread.
   */
  private renderDraftMotes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const viewW = viewportWidth();
    const viewH = viewportHeight();
    for (const pool of this.draftPools.values()) {
      const centerScreenX = pool.centerX - camX;
      const centerScreenY = pool.centerY - camY;
      if (
        centerScreenX < -STAIRWELL_DRAFT_CULL_MARGIN_PX ||
        centerScreenX > viewW + STAIRWELL_DRAFT_CULL_MARGIN_PX ||
        centerScreenY < -STAIRWELL_DRAFT_CULL_MARGIN_PX ||
        centerScreenY > viewH + STAIRWELL_DRAFT_CULL_MARGIN_PX
      )
        continue;

      for (const mote of pool.motes) {
        const screenX = mote.x - camX;
        const screenY = mote.y - camY;
        if (
          screenX + mote.radiusPx < 0 ||
          screenX - mote.radiusPx > viewW ||
          screenY + mote.radiusPx < 0 ||
          screenY - mote.radiusPx > viewH
        )
          continue;

        const fadeIn = clamp(
          (STAIRWELL_DRAFT_RADIUS_PX - mote.distToCenter) / STAIRWELL_DRAFT_FADE_ZONE_PX,
          0,
          1,
        );
        const fadeOut = clamp(
          (mote.distToCenter - STAIRWELL_DRAFT_RESPAWN_DIST_PX) / STAIRWELL_DRAFT_FADE_ZONE_PX,
          0,
          1,
        );
        const alpha = STAIRWELL_DRAFT_MOTE_ALPHA_MAX * Math.min(fadeIn, fadeOut) * pool.strength;
        if (alpha < STAIRWELL_DRAFT_MIN_VISIBLE_ALPHA) continue;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${STAIRWELL_DRAFT_MOTE_COLOR_RGB}, ${alpha})`;
        ctx.arc(screenX, screenY, mote.radiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * The fail-safe's motes, drawn in the draft's own dust so a crawler who has
   * learned what the dust means reads them without being told anything.
   */
  private renderWayfinderMotes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const viewW = viewportWidth();
    const viewH = viewportHeight();
    for (const mote of this.wayfinderMotes) {
      const screenX = mote.x - camX;
      const screenY = mote.y - camY;
      if (
        screenX + mote.radiusPx < 0 ||
        screenX - mote.radiusPx > viewW ||
        screenY + mote.radiusPx < 0 ||
        screenY - mote.radiusPx > viewH
      )
        continue;

      const fadeIn = clamp(mote.ageFrames / WAYFINDER_MOTE_FADE_FRAMES, 0, 1);
      const fadeOut = clamp(
        (WAYFINDER_MOTE_LIFE_FRAMES - mote.ageFrames) / WAYFINDER_MOTE_FADE_FRAMES,
        0,
        1,
      );
      const alpha = WAYFINDER_MOTE_ALPHA_MAX * Math.min(fadeIn, fadeOut);
      if (alpha < STAIRWELL_DRAFT_MIN_VISIBLE_ALPHA) continue;

      ctx.beginPath();
      ctx.fillStyle = `rgba(${STAIRWELL_DRAFT_MOTE_COLOR_RGB}, ${alpha})`;
      ctx.arc(screenX, screenY, mote.radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * The next floor's level, and how the party measures against it.
   *
   * Null on a floor with nowhere to descend to — which the menu never renders
   * on, but the type says so rather than the reader having to know that — and
   * on a floor that opts out of the advice altogether.
   */
  private descentAdvice(): DescentAdvice | null {
    const nextId = this.levelDef.nextLevelId;
    if (!nextId) return null;
    if (this.levelDef.suppressDescentAdvice === true) return null;
    const party = this.partyLevel();
    const profile = activeDifficultyProfile();

    const cache = this.descentAdviceCache;
    if (
      cache !== null &&
      cache.nextId === nextId &&
      cache.party === party &&
      cache.profile === profile
    ) {
      return cache.result;
    }

    const recommended = recommendedPartyLevelFor(getLevelDef(nextId), profile);
    const standing: PartyStanding =
      party < recommended ? 'below' : party === recommended ? 'met' : 'above';
    const result = { party, recommended, standing };
    this.descentAdviceCache = { nextId, party, profile, result };
    return result;
  }

  renderMenu(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const ch = viewportHeight();

    this.menuButtons = [];
    drawOverlay(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      alpha: STAIRWELL_MENU_OVERLAY_ALPHA,
    });

    const panelW = Math.min(STAIRWELL_MENU_PANEL_WIDTH, cw - STAIRWELL_MENU_PANEL_MARGIN);
    const bodyW = panelW - STAIRWELL_MENU_BODY_MARGIN;
    const advice = this.descentAdvice();

    const warningText =
      advice?.standing === 'below'
        ? `The foes below fight like a level-${advice.recommended} party. You are level ` +
          `${advice.party} — this floor still has strength to give.`
        : '';
    const warningLineCount =
      warningText === ''
        ? 0
        : measureTextBox(ctx, warningText, {
            size: STAIRWELL_MENU_WARNING_SIZE,
            width: bodyW,
            lineHeight: STAIRWELL_MENU_WARNING_LINE_HEIGHT,
          }).lineCount;
    // How far the content actually reaches below the panel top, in the same
    // fixed offsets used to draw it below — computed before the panel height
    // so panelH can be sized to fit it, rather than the button row later
    // discovering the content ran past a height that was clamped without it.
    const contentBottomOffset =
      advice === null
        ? STAIRWELL_MENU_PROMPT_Y_OFFSET
        : warningText === ''
          ? STAIRWELL_MENU_RECOMMENDED_Y_OFFSET
          : STAIRWELL_MENU_RECOMMENDED_Y_OFFSET +
            STAIRWELL_MENU_WARNING_Y_GAP +
            warningLineCount * STAIRWELL_MENU_WARNING_LINE_HEIGHT;
    const requiredButtonsYOffset =
      contentBottomOffset + STAIRWELL_MENU_CONTENT_TO_HINT_GAP + STAIRWELL_MENU_HINT_TO_BUTTON_GAP;
    const neededPanelH = Math.max(
      STAIRWELL_MENU_PANEL_BASE_HEIGHT,
      requiredButtonsYOffset + STAIRWELL_MENU_BUTTON_BOTTOM_OFFSET,
    );
    const panelH = Math.min(neededPanelH, ch - STAIRWELL_MENU_PANEL_MARGIN);

    const { x: panelX, y: panelY } = drawModal(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      width: panelW,
      height: panelH,
      ...BOX_PRESETS.modal,
      border: STAIRWELL_MENU_BORDER_COLOR,
    });
    const centreX = panelX + panelW / 2;

    // The row is anchored bottom-up from the panel — except on a viewport
    // so short even the clamped panel can't fit it, where this hard floor is
    // the last line of defence against buttons rendering past the canvas edge.
    const buttonsY = Math.min(
      panelY + panelH - STAIRWELL_MENU_BUTTON_BOTTOM_OFFSET,
      ch - STAIRWELL_MENU_BUTTON_HEIGHT - STAIRWELL_MENU_BUTTON_HARD_FLOOR_MARGIN,
    );
    const hintY = buttonsY - STAIRWELL_MENU_HINT_TO_BUTTON_GAP;
    // Everything above the hint is placed at fixed offsets down from the panel
    // top while the hint and buttons are anchored to the panel bottom, so when
    // a short viewport clamps panelH below the height the content asked for,
    // the two halves close on each other. This ceiling is what keeps them
    // apart: content that would not end above it is dropped or cut short
    // rather than drawn beneath the buttons, where it would be both occluded
    // and clickable through.
    const contentCeilingY = hintY;

    const titleText = '▼  Stairwell  ▼';
    const titleY = panelY + STAIRWELL_MENU_TITLE_Y_OFFSET;
    const titleHeight = measureTextBox(ctx, titleText, {
      size: STAIRWELL_MENU_TITLE_SIZE,
    }).totalHeight;
    if (titleY + titleHeight <= contentCeilingY) {
      drawText(ctx, titleText, {
        x: centreX,
        y: titleY,
        size: STAIRWELL_MENU_TITLE_SIZE,
        bold: true,
        color: STAIRWELL_MENU_TITLE_TEXT_COLOR,
        align: 'center',
      });
    }

    const nextId = this.levelDef.nextLevelId;
    const nextName = nextId ? getLevelDef(nextId).name : 'Next Floor';
    const promptText = `Descend to: ${nextName}?`;
    const promptY = panelY + STAIRWELL_MENU_PROMPT_Y_OFFSET;
    const promptHeight = measureTextBox(ctx, promptText, {
      size: STAIRWELL_MENU_PROMPT_SIZE,
    }).totalHeight;
    if (promptY + promptHeight <= contentCeilingY) {
      drawText(ctx, promptText, {
        x: centreX,
        y: promptY,
        size: STAIRWELL_MENU_PROMPT_SIZE,
        color: STAIRWELL_MENU_PROMPT_TEXT_COLOR,
        align: 'center',
      });
    }

    if (advice !== null) {
      const recommendedStyle = recommendedLineStyle(advice.standing);
      const recommendedPrefix =
        advice.standing === 'below' ? STAIRWELL_MENU_RECOMMENDED_WARNING_PREFIX : '';
      const recommendedText = `${recommendedPrefix}Recommended level: ${advice.recommended}`;
      const recommendedY = panelY + STAIRWELL_MENU_RECOMMENDED_Y_OFFSET;
      const recommendedHeight = measureTextBox(ctx, recommendedText, {
        size: recommendedStyle.size,
      }).totalHeight;
      if (recommendedY + recommendedHeight <= contentCeilingY) {
        drawText(ctx, recommendedText, {
          x: centreX,
          y: recommendedY,
          ...recommendedStyle,
          align: 'center',
        });
      }
      if (warningText !== '') {
        const warningY = recommendedY + STAIRWELL_MENU_WARNING_Y_GAP;
        const warningLinesThatFit = Math.floor(
          (contentCeilingY - warningY) / STAIRWELL_MENU_WARNING_LINE_HEIGHT,
        );
        const drawnWarningLines = Math.max(0, Math.min(warningLineCount, warningLinesThatFit));
        if (drawnWarningLines > 0) {
          drawText(ctx, warningText, {
            x: panelX + STAIRWELL_MENU_BODY_MARGIN / 2,
            y: warningY,
            size: STAIRWELL_MENU_WARNING_SIZE,
            color: STAIRWELL_MENU_WARNING_COLOR,
            align: 'center',
            width: bodyW,
            lineHeight: STAIRWELL_MENU_WARNING_LINE_HEIGHT,
            // A whole number of line heights, so the clip falls between lines
            // and never slices one in half.
            height: drawnWarningLines * STAIRWELL_MENU_WARNING_LINE_HEIGHT,
          });
        }
      }
    }

    drawText(ctx, '(Esc or Stay to remain on this floor)', {
      x: centreX,
      y: hintY,
      size: STAIRWELL_MENU_HINT_SIZE,
      color: STAIRWELL_MENU_HINT_TEXT_COLOR,
      align: 'center',
    });
    const buttonsW = STAIRWELL_MENU_BUTTON_WIDTH * 2 + STAIRWELL_MENU_BUTTON_GAP;
    const descendX = centreX - buttonsW / 2;
    const stayX = descendX + STAIRWELL_MENU_BUTTON_WIDTH + STAIRWELL_MENU_BUTTON_GAP;

    // Descend leads the ring so the first Tab lands on it, and it's the
    // primary too: a bare accept-key press on a stairwell tile should send
    // the crawler down rather than dismiss the menu.
    beginMenuFocus('stairwell');
    addButton(ctx, this.menuButtons, {
      x: descendX,
      y: buttonsY,
      width: STAIRWELL_MENU_BUTTON_WIDTH,
      height: STAIRWELL_MENU_BUTTON_HEIGHT,
      label: 'Descend',
      ...BUTTON_PRESETS.award,
      labelSize: STAIRWELL_MENU_BUTTON_TEXT_SIZE,
      primaryAction: true,
      action: () => this.onDescend(),
    });
    addButton(ctx, this.menuButtons, {
      x: stayX,
      y: buttonsY,
      width: STAIRWELL_MENU_BUTTON_WIDTH,
      height: STAIRWELL_MENU_BUTTON_HEIGHT,
      label: 'Stay',
      ...BUTTON_PRESETS.primary,
      labelSize: STAIRWELL_MENU_BUTTON_TEXT_SIZE,
      action: () => this.closeMenu(),
    });
    endMenuFocus();
  }
}
