import type { GameMap } from '../map/GameMap';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import type { LevelDef } from '../levels/types';
import type { LevelId } from '../levels/levelIds';
import type { GameSystem, SystemContext } from './GameSystem';
import { getLevelDef } from '../levels';
import { recommendedPartyLevelFor } from '../levels/spawner';
import { activeDifficultyProfile } from '../core/difficulty/difficultyProfiles';
import type { DifficultyProfile } from '../core/difficulty/difficultyProfiles';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import { drawSpriteKey } from '../core/spriteAssets/SpriteRenderer';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import type { StairwellStyleId } from '../sprites/art/stairwellArt';
import { screenToWorld, type Camera } from '../core/rendering/camera';
import { clamp } from '../utils';
import type { KeyRing, KeyView } from '../core/keys/KeyRing';
import type { KeyKind } from '../core/keys/keyKinds';
import type { StairwellTile } from '../core/keys/keyRingState';
import { STAIRWELL_FOOTPRINT_SPAN } from '../map/DungeonGenerator';
import { prefersReducedMotion } from '../ui/core/reducedMotion';
import {
  paintSealedNotice,
  paintSealGround,
  paintUnsealAbove,
  type SealPlacement,
  type SealView,
} from './stairwellSealPainter';
import { unsealBeatFrames, type UnsealBeat } from './stairwellUnseal';

const TILE_CENTER_OFFSET = 0.5;
// Stairwell rendering
const STAIRWELL_SCALE = 2;
/** The sewer's way out climbs to the town above, so it is cut like a street stairwell. */
const STAIRWELL_STYLE_BY_THEME = {
  cellars: 'cellars',
  service_level: 'service_level',
  sewer: 'street',
} as const satisfies Record<DungeonFloorThemeId, StairwellStyleId>;
const STAIRWELL_PULSE_CENTER = 0.7;
const STAIRWELL_PULSE_AMPLITUDE = 0.2;
const STAIRWELL_PULSE_SPEED = 500; // ms
const STAIRWELL_BORDER_WIDTH = 2;
const STAIRWELL_BORDER_INSET_PX = 1;
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
 * What one release costs the pulse's frame budget: the frame the mote leaves on
 * plus the cooldown frames it then spends counting down. Named because how many
 * motes a pulse can shed is `(VISIBLE - 1) / this + 1`, and the off-by-one is
 * the difference between a gate that predicts the loop and one that is a frame
 * out from it.
 */
export const WAYFINDER_MOTE_RELEASE_COST_FRAMES = WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES + 1;
/**
 * How long one mote drifts before it fades out (2 s at 60 fps). Deliberately
 * longer than a pulse: the mote is the message, so it has to outlive the window
 * that released it and still be travelling when the player looks over at it.
 */
export const WAYFINDER_MOTE_LIFE_FRAMES = 120;
/** Frames a mote spends fading in at the start of its life, and fading out again at the end. */
const WAYFINDER_MOTE_FADE_FRAMES = 40;
/**
 * A mote has to outrun the crawler it is talking to.
 *
 * The mote lives in world pixels but is read on a screen the player's own
 * movement is dragging: anything slower than a walk drifts *backwards* across
 * the view of a crawler heading the same way, which is the exact opposite of
 * the cue. The ambient draft gets away with being much slower because it is a
 * wide converging field with a visible sink in the middle; two grains have no
 * such context and only their own motion to say anything with.
 */
const WAYFINDER_MOTE_SPEED_OVER_WALK = 1.2;
export const WAYFINDER_MOTE_SPEED = PLAYER_SPEED * WAYFINDER_MOTE_SPEED_OVER_WALK;
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
 * is pointed the same way every time, which is the difference between a
 * direction and a live tracker.
 */
function quantizeBearingToCompass(angleRadians: number): number {
  return (
    Math.round(angleRadians / WAYFINDER_COMPASS_SECTOR_RADIANS) * WAYFINDER_COMPASS_SECTOR_RADIANS
  );
}

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
export type PartyStanding = 'below' | 'met' | 'above';

export interface DescentAdvice {
  party: number;
  recommended: number;
  standing: PartyStanding;
}

/** What the descend prompt asks, for a view that draws it. */
export interface DescentPrompt {
  readonly nextFloorName: string;
  /** Null on a floor that gives no advice. */
  readonly advice: DescentAdvice | null;
  /** Why the party may want to stay, or null when it is strong enough. */
  readonly warning: string | null;
}

function descentWarning(advice: DescentAdvice | null): string | null {
  if (advice?.standing !== 'below') return null;
  return (
    `The foes below fight like a level-${advice.recommended} party. You are level ` +
    `${advice.party} — this floor still has strength to give.`
  );
}

const NEXT_FLOOR_FALLBACK_NAME = 'Next Floor';

/** What the floor's stairwells hand the party to, by the level's `exit`. */
export interface StairwellExits {
  /** The descend prompt's Descend, on a floor whose stairwells lead down. */
  readonly onDescend: (nextLevelId: LevelId) => void;
  /** The party stepped onto a stairwell on the floor that ends the run. */
  readonly onRunEnd: () => void;
  /**
   * An open stairwell has just offered the party its way out, whichever way
   * that is: the descend prompt opening, or the run's end. Told before the
   * offer itself.
   */
  readonly onExitOffered: () => void;
}

/** The part of the floor's key ring the seals read and write. */
export type StairwellSealRing = Pick<
  KeyRing,
  'isUnsealed' | 'markUnsealed' | 'canUnsealStairwells' | 'stairwellOpener' | 'stairwellKeyView'
>;

/** A stairwell whose key has just been brought to it: the scene its seal opens with. */
export interface UnsealRequest {
  readonly tile: StairwellTile;
  /** The footprint's centre, in world pixels. */
  readonly center: { readonly x: number; readonly y: number };
  readonly style: StairwellStyleId;
  readonly reducedMotion: boolean;
}

/** What the seals ask of the scene they stand in. */
export interface StairwellSealHooks {
  readonly ring: StairwellSealRing;
  /** A crawler stepped onto a seal without the key: rattle it. */
  readonly onLocked: (at: { readonly x: number; readonly y: number }) => void;
  /** A crawler brought the key: play the unseal scene, then call `completeUnseal`. */
  readonly onUnseal: (request: UnsealRequest) => void;
  /** The Keys button's centre in screen CSS pixels, where the key flies from; null when it is not drawn. */
  readonly keyDock: () => { readonly x: number; readonly y: number } | null;
  /**
   * A party carrying the key is near a seal of this style: have the poses it
   * opens through painted before they are needed, so the scene never waits on
   * them. Called again while the party stays near, which keeps them held.
   */
  readonly prewarmOpening: (style: StairwellStyleId) => void;
  /**
   * Whether the unseal scene may start at the seal centred on `at` (world
   * pixels): it holds the party for seconds, so it never starts while
   * anything is hunting them.
   */
  readonly isSafeToUnseal: (at: { readonly x: number; readonly y: number }) => boolean;
}

/** What the scene announces once a seal is open. */
export interface UnsealedStairwell {
  readonly kind: KeyKind;
  readonly tile: StairwellTile;
}

/** The picture of a seal opening, advanced in place each world tick rather than rebuilt per frame. */
interface UnsealingView {
  readonly kind: 'unsealing';
  beat: UnsealBeat | null;
  beatFrame: number;
  beatLength: number;
  readonly reducedMotion: boolean;
}

/** The seal's own scene, from the step that started it to the scene's end. */
interface UnsealRun {
  readonly tile: StairwellTile;
  readonly style: StairwellStyleId;
  /** The forged key that is opening it, resolved once when it was brought. */
  readonly kind: KeyKind;
  readonly view: UnsealingView;
}

/** The picture of a seal just tried without the key, rattling. */
interface RattlingView {
  readonly kind: 'sealed';
  rattle: number;
  rattleTick: number;
}

/** The note over a seal tried without the key, while it shows. */
interface LockedNotice {
  readonly tile: StairwellTile;
  /** Written once, when the seal was tried: the counts do not change while it shows. */
  readonly text: string;
  framesLeft: number;
  /** Only a seal tried without the key rattles; one refused for the danger near it holds still. */
  readonly rattles: boolean;
  readonly view: RattlingView;
}

/** What the seal says when the party brings its key while something is hunting it. */
export const HUNTED_NOTICE_TEXT = "Not while you're being hunted";

const SEALED_IDLE: SealView = Object.freeze({ kind: 'sealed', rattle: 0, rattleTick: 0 });

/** How often a party carrying the key checks for a seal near enough to ready (1 s at 60 fps). */
const SEAL_PREWARM_INTERVAL_FRAMES = 60;
/**
 * How near a sealed stairwell a party carrying the key must be for its
 * opening poses to be painted: about two screens, far enough that the paint
 * has finished well before the crawler can reach the stairs.
 */
const SEAL_PREWARM_RADIUS_TILES = 30;
const SEAL_PREWARM_RADIUS_PX = SEAL_PREWARM_RADIUS_TILES * TILE_SIZE;

/** How long "Sealed: 1 of 2 fragments" stays over a seal (2.5 s at 60 fps). */
const SEALED_NOTICE_FRAMES = 150;
/**
 * The least time between two tries of a seal raising its rattle and note
 * (2 s at 60 fps), so stepping off and on again does not hammer either.
 */
const SEALED_NOTICE_COOLDOWN_FRAMES = 120;
/** How long the padlock rattles after a try, as a share of the note's time. */
const SEALED_RATTLE_SHARE = 0.25;

/** The note over a seal, with the key ring's own count of the floor key's fragments. */
export function sealedNoticeText(key: KeyView): string {
  const unit = key.needed === 1 ? 'fragment' : 'fragments';
  return `Sealed: ${key.held} of ${key.needed} ${unit}`;
}

export class StairwellSystem implements GameSystem {
  private onStairwell = false;
  private _menuOpen = false;
  private dismissed = false;
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
   * Counts down between mote releases. Zeroed whenever no pulse is on, so every
   * pulse opens by shedding a mote rather than by a pause the player reads as
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
  private unseal: UnsealRun | null = null;
  private lockedNotice: LockedNotice | null = null;
  private lockedCooldownFrames = 0;
  /** A seal the party brought its key to while hunted, opened once calm if they wait on it. */
  private awaitingCalm: StairwellTile | null = null;
  private sealPrewarmFrames = 0;
  private readonly sealPlacement: { x: number; y: number; size: number; style: StairwellStyleId } =
    { x: 0, y: 0, size: 0, style: 'cellars' };

  constructor(
    private readonly gameMap: Pick<GameMap, 'stairwellTiles' | 'isStairwellTile'>,
    private readonly levelDef: LevelDef,
    private readonly exits: StairwellExits,
    private readonly partyLevel: () => number,
    private readonly seals: StairwellSealHooks,
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
    this.unseal = null;
    this.lockedNotice = null;
    this.lockedCooldownFrames = 0;
    this.awaitingCalm = null;
    this.forceDraftReselect();
    this.wayfinderMotes.length = 0;
    this.wayfinderSpawnCooldownFrames = 0;
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
    if (this.nextLevelId() === null) return;
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
    if (!this.wayfinderPulseVisible()) {
      // Each pulse gets the cooldown back at zero, so it opens by shedding a
      // mote. Left to carry across the silence between pulses the phase drifts,
      // and pulses eventually open with half their window already spent — or
      // shed a single mote, which is a coincidence rather than a bearing.
      this.wayfinderSpawnCooldownFrames = 0;
      return;
    }

    // Announced off a mote actually leaving rather than off the pulse window,
    // because the line describes something the player can look at, and a floor
    // with no reachable stairwell releases nothing at all.
    if (this.releaseWayfinderMote(active) && !this.wayfinderAnnounced) {
      this.wayfinderAnnounced = true;
      this.wayfinderAnnouncePending = true;
    }
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
   *
   * @returns whether a mote actually left this frame.
   */
  private releaseWayfinderMote(active: { x: number; y: number }): boolean {
    if (this.wayfinderSpawnCooldownFrames > 0) {
      this.wayfinderSpawnCooldownFrames--;
      return false;
    }
    if (this.wayfinderMotes.length >= WAYFINDER_MOTE_MAX_ALIVE) return false;

    const bearing = this.wayfinderBearing(active);
    if (bearing === null) return false;

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
    return true;
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

  /** The descend prompt's question and advice. */
  descentPrompt(): DescentPrompt {
    const nextId = this.nextLevelId();
    const advice = this.descentAdvice();
    return {
      nextFloorName: nextId === null ? NEXT_FLOOR_FALLBACK_NAME : getLevelDef(nextId).name,
      advice,
      warning: descentWarning(advice),
    };
  }

  /** The prompt's Descend. */
  descend(): void {
    const exit = this.levelDef.exit;
    switch (exit.kind) {
      case 'descend':
        this.exits.onDescend(exit.nextLevelId);
        return;
      case 'runEnd':
        this.exits.onRunEnd();
        return;
      default: {
        const unhandled: never = exit;
        return unhandled;
      }
    }
  }

  /** The floor the stairwells lead down to, or null on the floor that ends the run. */
  private nextLevelId(): LevelId | null {
    const exit = this.levelDef.exit;
    switch (exit.kind) {
      case 'descend':
        return exit.nextLevelId;
      case 'runEnd':
        return null;
      default: {
        const unhandled: never = exit;
        return unhandled;
      }
    }
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
    this.updateSeals(ctx.active);
  }

  /**
   * One world tick of the seals: the opening scene's picture, the note over a
   * tried seal, readying the opening poses near a party carrying the key, and
   * opening a seal whose danger has passed under a crawler waiting on it.
   */
  updateSeals(active: { x: number; y: number }): void {
    this.openOnceCalm(active);
    const run = this.unseal;
    if (run !== null && run.view.beat !== null) run.view.beatFrame++;
    if (this.lockedCooldownFrames > 0) this.lockedCooldownFrames--;
    const notice = this.lockedNotice;
    if (notice !== null) {
      notice.framesLeft--;
      notice.view.rattleTick++;
      const rattleFrames = SEALED_NOTICE_FRAMES * SEALED_RATTLE_SHARE;
      const rattleLeft = notice.framesLeft - (SEALED_NOTICE_FRAMES - rattleFrames);
      notice.view.rattle = notice.rattles ? clamp(rattleLeft / rattleFrames, 0, 1) : 0;
      if (notice.framesLeft <= 0) this.lockedNotice = null;
    }
    this.sealPrewarmFrames++;
    if (this.sealPrewarmFrames >= SEAL_PREWARM_INTERVAL_FRAMES) {
      this.sealPrewarmFrames = 0;
      if (this.sealedStairwellNear(active)) this.seals.prewarmOpening(this.stairwellStyle());
    }
  }

  /** Whether the party carries the key within reach of a stairwell it has yet to open. */
  private sealedStairwellNear(active: { x: number; y: number }): boolean {
    if (!this.seals.ring.canUnsealStairwells()) return false;
    const reachSq = SEAL_PREWARM_RADIUS_PX * SEAL_PREWARM_RADIUS_PX;
    return this.gameMap.stairwellTiles.some((tile) => {
      if (this.seals.ring.isUnsealed(tile)) return false;
      const dx = footprintCenterX(tile.x) - active.x;
      const dy = footprintCenterY(tile.y) - active.y;
      return dx * dx + dy * dy <= reachSq;
    });
  }

  /** Whether a seal's scene is waiting to play or playing: the party is held still for it. */
  get unsealing(): boolean {
    return this.unseal !== null;
  }

  /** The unseal scene has reached `beat`; the seal's picture follows it from here. */
  beginUnsealBeat(beat: UnsealBeat): void {
    const run = this.unseal;
    if (run === null) return;
    run.view.beat = beat;
    run.view.beatFrame = 0;
    run.view.beatLength = unsealBeatFrames(beat, run.style);
  }

  /**
   * The unseal scene has ended: the stairwell is open from now on. A crawler
   * still standing on it is offered its exit at once; one knocked off it
   * during the scene is offered it on their next step onto the stairs.
   *
   * @returns what opened, for the scene to announce, or null when no seal was opening.
   */
  completeUnseal(active: { x: number; y: number }): UnsealedStairwell | null {
    const run = this.unseal;
    if (run === null) return null;
    this.unseal = null;
    this.seals.ring.markUnsealed(run.tile);
    const standingOn = this.stairwellUnder(active);
    const stillOnIt = standingOn?.x === run.tile.x && standingOn.y === run.tile.y;
    this.dismissed = false;
    this.onStairwell = stillOnIt;
    if (stillOnIt) this.offerExit();
    return { kind: run.kind, tile: run.tile };
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
    // The unseal scene holds the crawler on the stairs; its end offers the exit.
    if (this.unseal !== null) return;
    const wasOn = this.onStairwell;
    const tile = this.stairwellUnder(active);
    this.onStairwell = tile !== null;

    if (tile === null) {
      this.dismissed = false;
      this._menuOpen = false;
      return;
    }
    if (wasOn || this.dismissed) return;
    if (!this.seals.ring.isUnsealed(tile)) {
      this.tryTheSeal(tile);
      return;
    }
    this.offerExit();
  }

  /**
   * A crawler has stepped onto a sealed stairwell. With the floor's key it
   * opens; without, the padlock rattles and the note says how far off the key
   * is. A seal never offers the exit itself.
   */
  private tryTheSeal(tile: StairwellTile): void {
    const center = this.footprintCenter(tile);
    const opener = this.seals.ring.stairwellOpener();
    if (opener !== null && !this.seals.isSafeToUnseal(center)) {
      // The scene holds the party still for seconds, so it never opens into a
      // fight. It starts by itself once the danger passes, if the crawler waits on the stairs.
      this.awaitingCalm = tile;
      this.raiseNotice(tile, HUNTED_NOTICE_TEXT, false);
      return;
    }
    if (opener !== null) {
      this.awaitingCalm = null;
      const style = this.stairwellStyle();
      const reducedMotion = prefersReducedMotion();
      this.lockedNotice = null;
      this.seals.prewarmOpening(style);
      this.unseal = {
        tile,
        style,
        kind: opener,
        view: { kind: 'unsealing', beat: null, beatFrame: 0, beatLength: 0, reducedMotion },
      };
      this.seals.onUnseal({ tile, center, style, reducedMotion });
      return;
    }
    if (this.raiseNotice(tile, sealedNoticeText(this.seals.ring.stairwellKeyView()), true)) {
      this.seals.onLocked(center);
    }
  }

  /** Puts a note over a seal, unless one was raised too lately; returns whether it was. */
  private raiseNotice(tile: StairwellTile, text: string, rattles: boolean): boolean {
    if (this.lockedCooldownFrames > 0) return false;
    this.lockedCooldownFrames = SEALED_NOTICE_COOLDOWN_FRAMES;
    this.lockedNotice = {
      tile,
      text,
      framesLeft: SEALED_NOTICE_FRAMES,
      rattles,
      view: { kind: 'sealed', rattle: rattles ? 1 : 0, rattleTick: 0 },
    };
    return true;
  }

  /**
   * A crawler with the key who was refused for the danger near and is still
   * standing on that seal: open it the moment the danger has passed.
   */
  private openOnceCalm(active: { x: number; y: number }): void {
    const waiting = this.awaitingCalm;
    if (waiting === null || this.unseal !== null) return;
    const standingOn = this.stairwellUnder(active);
    if (standingOn?.x !== waiting.x || standingOn.y !== waiting.y) {
      this.awaitingCalm = null;
      return;
    }
    if (!this.seals.isSafeToUnseal(this.footprintCenter(waiting))) return;
    this.tryTheSeal(waiting);
  }

  /** The note over a seal tried without the key, or null while none shows. */
  get sealedNotice(): string | null {
    return this.lockedNotice?.text ?? null;
  }

  /** Opens the floor's way out for a crawler on an open stairwell. */
  private offerExit(): void {
    this.exits.onExitOffered();
    const exit = this.levelDef.exit;
    switch (exit.kind) {
      case 'descend':
        this._menuOpen = true;
        return;
      case 'runEnd':
        // Once per step onto the stairs, as the descend prompt is.
        this.dismissed = true;
        this.exits.onRunEnd();
        return;
      default: {
        const unhandled: never = exit;
        return unhandled;
      }
    }
  }

  isEntityOnStairwell(entity: { x: number; y: number }): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    // The map already keeps a bit per tile for exactly this 2×2 footprint test.
    return this.gameMap.isStairwellTile(tx, ty);
  }

  /** The footprint the entity stands in, by its top-left tile, or null off every stairwell. */
  private stairwellUnder(entity: { x: number; y: number }): StairwellTile | null {
    if (!this.isEntityOnStairwell(entity)) return null;
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    return (
      this.gameMap.stairwellTiles.find(
        (tile) =>
          tx >= tile.x &&
          tx < tile.x + STAIRWELL_FOOTPRINT_SPAN &&
          ty >= tile.y &&
          ty < tile.y + STAIRWELL_FOOTPRINT_SPAN,
      ) ?? null
    );
  }

  /**
   * What the floor's stairwells are built of. The overworld's stairwell is cut
   * into the town square's paving, whatever dungeon theme was last set.
   */
  private stairwellStyle(): StairwellStyleId {
    if (this.levelDef.isOverworld === true) return 'street';
    return STAIRWELL_STYLE_BY_THEME[dungeonFloorTheme().id];
  }

  private sealViewOf(tile: StairwellTile): SealView | null {
    const run = this.unseal;
    if (run !== null && run.tile.x === tile.x && run.tile.y === tile.y) return run.view;
    if (this.seals.ring.isUnsealed(tile)) return null;
    const notice = this.lockedNotice;
    if (notice?.tile.x === tile.x && notice.tile.y === tile.y) return notice.view;
    return SEALED_IDLE;
  }

  /**
   * What crosses in front of the crawlers: the unseal scene's key, light,
   * motes and banner, and the note over a seal tried without the key.
   */
  renderAbove(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const run = this.unseal;
    if (run !== null && run.view.beat !== null) {
      const dock = this.seals.keyDock();
      const dockWorld = dock === null ? null : screenToWorld(camera, dock.x, dock.y);
      paintUnsealAbove(ctx, this.placementOf(run.tile, camera), run.view, {
        keyFrom:
          dockWorld === null ? null : { x: dockWorld.x - camera.x, y: dockWorld.y - camera.y },
        keyKind: run.kind,
        banner: this.unsealBanner(),
      });
    }
    const notice = this.lockedNotice;
    if (notice !== null) {
      paintSealedNotice(
        ctx,
        this.placementOf(notice.tile, camera),
        notice.text,
        notice.framesLeft / SEALED_NOTICE_FRAMES,
      );
    }
  }

  /** Where a seal draws this frame, written into one placement the painters read and never keep. */
  private placementOf(tile: StairwellTile, camera: Camera): SealPlacement {
    const placement = this.sealPlacement;
    placement.x = tile.x * TILE_SIZE - camera.x;
    placement.y = tile.y * TILE_SIZE - camera.y;
    placement.size = TILE_SIZE * STAIRWELL_SCALE;
    placement.style = this.stairwellStyle();
    return placement;
  }

  /** The banner over a seal as it opens, by where the floor's stairwells lead. */
  private unsealBanner(): string {
    const exit = this.levelDef.exit;
    switch (exit.kind) {
      case 'descend':
        return 'The way down is open';
      case 'runEnd':
        // This stairwell does not lead down to another floor.
        return 'The way is open';
      default: {
        const unhandled: never = exit;
        return unhandled;
      }
    }
  }

  renderStairwells(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    const ts = TILE_SIZE;
    const bw = ts * STAIRWELL_SCALE;
    const bh = ts * STAIRWELL_SCALE;
    const now = Date.now();
    const pulse =
      STAIRWELL_PULSE_CENTER + Math.sin(now / STAIRWELL_PULSE_SPEED) * STAIRWELL_PULSE_AMPLITUDE;
    for (const tile of this.gameMap.stairwellTiles) {
      const sx = tile.x * ts - camX;
      const sy = tile.y * ts - camY;
      if (
        sx < -bw * STAIRWELL_OFFSCREEN_MARGIN ||
        sx > camera.viewWidth ||
        sy < -bh * STAIRWELL_OFFSCREEN_MARGIN ||
        sy > camera.viewHeight
      )
        continue;

      drawSpriteKey(ctx, 'stairwell', this.stairwellStyle(), 0, sx, sy, bw);

      const seal = this.sealViewOf(tile);
      if (seal !== null) {
        paintSealGround(ctx, this.placementOf(tile, camera), seal, now);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = worldPalette.waymark.stairwellEdge;
      ctx.lineWidth = STAIRWELL_BORDER_WIDTH;
      ctx.strokeRect(
        sx + STAIRWELL_BORDER_INSET_PX,
        sy + STAIRWELL_BORDER_INSET_PX,
        bw - STAIRWELL_BORDER_INSET_PX * 2,
        bh - STAIRWELL_BORDER_INSET_PX * 2,
      );
      ctx.restore();

      const arrowSize = Math.floor(bh * STAIRWELL_ICON_SIZE_RATIO);
      worldText(ctx, '▼', {
        x: sx + bw / 2,
        y: sy + bh * STAIRWELL_ICON_Y_RATIO - Math.round(arrowSize * STAIRWELL_ICON_Y_ADJUST),
        size: arrowSize,
        bold: true,
        color: worldPalette.waymark.stairwellArrow,
        alpha: pulse,
        align: 'center',
      });
    }

    ctx.save();
    ctx.fillStyle = worldPalette.waymark.stairwellDraft;
    this.renderDraftMotes(ctx, camera);
    this.renderWayfinderMotes(ctx, camera);
    ctx.restore();
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
  private renderDraftMotes(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    const viewW = camera.viewWidth;
    const viewH = camera.viewHeight;
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

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(screenX, screenY, mote.radiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * The fail-safe's motes, drawn in the draft's own dust so a crawler who has
   * learned what the dust means reads them without being told anything.
   */
  private renderWayfinderMotes(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    const viewW = camera.viewWidth;
    const viewH = camera.viewHeight;
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

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(screenX, screenY, mote.radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * The next floor's level, and how the party measures against it.
   *
   * Null on a floor with nowhere to descend to — which the prompt never shows
   * on, but the type says so rather than the reader having to know that — and
   * on a floor that opts out of the advice altogether.
   */
  private descentAdvice(): DescentAdvice | null {
    const nextId = this.nextLevelId();
    if (nextId === null) return null;
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
}
