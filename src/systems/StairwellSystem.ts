import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LevelDef } from '../levels/types';
import type { GameSystem, SystemContext } from './GameSystem';
import { getLevelDef } from '../levels';
import { recommendedPartyLevelFor } from '../levels/spawner';
import { activeDifficultyProfile } from '../core/difficultyProfiles';
import type { DifficultyProfile } from '../core/difficultyProfiles';
import { drawText, measureTextBox, TEXT_PRESETS } from '../ui/TextBox';
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
const STAIRWELL_DRAFT_RADIUS_TILES = 14;
const STAIRWELL_DRAFT_RADIUS_PX = STAIRWELL_DRAFT_RADIUS_TILES * TILE_SIZE;
const STAIRWELL_DRAFT_MOTES_MAX = 24;
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

/** One stairwell's active pool of draft motes, keyed by its footprint centre in world pixels. */
interface DraftPool {
  centerX: number;
  centerY: number;
  motes: DraftMote[];
}

interface DescentAdvice {
  party: number;
  recommended: number;
  underlevelled: boolean;
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
   * player's live position and drops the rest, so a checkpoint restore
   * self-corrects on its very next update.
   */
  private draftPools = new Map<string, DraftPool>();

  private wayfinderFrames: number | null = null;
  private wayfinderRetired = false;
  private wayfinderAnnounced = false;
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
   * dropping the retired latch would put the arrow back on a floor whose
   * stairwell has already been found.
   */
  restoreCheckpoint(snapshot: StairwellCheckpoint): void {
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

  private tickWayfinder(): void {
    const frames = this.wayfinderFrames;
    if (frames === null || this.wayfinderRetired) return;
    this.wayfinderFrames = frames + 1;
    if (this.wayfinderPulseVisible() && !this.wayfinderAnnounced) {
      this.wayfinderAnnounced = true;
      this.wayfinderAnnouncePending = true;
    }
  }

  private wayfinderPulseVisible(): boolean {
    const frames = this.wayfinderFrames;
    if (frames === null || this.wayfinderRetired) return false;
    const huntedFrames = frames - WAYFINDER_GRACE_FRAMES;
    if (huntedFrames < 0) return false;
    return huntedFrames % WAYFINDER_PULSE_PERIOD_FRAMES < WAYFINDER_PULSE_VISIBLE_FRAMES;
  }

  /**
   * The compass bearing to point the fail-safe arrow along this frame, or null
   * whenever it should not be drawn at all.
   */
  wayfinderBearing(from: { x: number; y: number }): number | null {
    if (!this.wayfinderPulseVisible()) return null;
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
    this.tickWayfinder();
  }

  /** The stairwell's footprint centre in world pixels, matching where `renderStairwells` draws it. */
  private footprintCenter(tile: { x: number; y: number }): { x: number; y: number } {
    const footprintSizePx = TILE_SIZE * STAIRWELL_SCALE;
    return {
      x: tile.x * TILE_SIZE + footprintSizePx / 2,
      y: tile.y * TILE_SIZE + footprintSizePx / 2,
    };
  }

  /**
   * Maintains one draft pool per nearby stairwell. A stairwell only gets a
   * pool while the player is within the draft radius of it, so an idle floor
   * with several stairwells never simulates motes for the ones nobody is near.
   */
  private updateDraftMotes(active: { x: number; y: number }): void {
    if (!this.levelDef.nextLevelId) {
      this.draftPools.clear();
      return;
    }

    const liveKeys = new Set<string>();
    for (const tile of this.gameMap.stairwellTiles) {
      const key = `${tile.x},${tile.y}`;
      const center = this.footprintCenter(tile);
      const dx = center.x - active.x;
      const dy = center.y - active.y;
      if (dx * dx + dy * dy > STAIRWELL_DRAFT_RADIUS_PX * STAIRWELL_DRAFT_RADIUS_PX) continue;

      liveKeys.add(key);
      let pool = this.draftPools.get(key);
      if (!pool) {
        pool = { centerX: center.x, centerY: center.y, motes: [] };
        this.draftPools.set(key, pool);
      } else {
        pool.centerX = center.x;
        pool.centerY = center.y;
      }
      this.stepDraftPool(pool);
    }

    for (const key of this.draftPools.keys()) {
      if (!liveKeys.has(key)) this.draftPools.delete(key);
    }
  }

  private stepDraftPool(pool: DraftPool): void {
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
      pool.motes.push(this.spawnDraftMote(pool, true));
    }
  }

  /**
   * A fresh spawn scatters across the full radius so the pool doesn't ring in
   * all at once; a recycled mote always restarts at the outer edge so the
   * inward flow reads as continuous rather than as motes teleporting inward.
   */
  private spawnDraftMote(pool: DraftPool, scatterAcrossRadius: boolean): DraftMote {
    const angle = Math.random() * Math.PI * 2;
    const dist = scatterAcrossRadius
      ? Math.random() * STAIRWELL_DRAFT_RADIUS_PX
      : STAIRWELL_DRAFT_RADIUS_PX;
    return {
      x: pool.centerX + Math.cos(angle) * dist,
      y: pool.centerY + Math.sin(angle) * dist,
      radiusPx:
        STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX +
        Math.random() * (STAIRWELL_DRAFT_MOTE_RADIUS_MAX_PX - STAIRWELL_DRAFT_MOTE_RADIUS_MIN_PX),
      distToCenter: dist,
    };
  }

  private respawnDraftMote(mote: DraftMote, pool: DraftPool): void {
    const fresh = this.spawnDraftMote(pool, false);
    mote.x = fresh.x;
    mote.y = fresh.y;
    mote.radiusPx = fresh.radiusPx;
    mote.distToCenter = fresh.distToCenter;
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
  }

  /**
   * Motes live within `STAIRWELL_DRAFT_RADIUS_PX` of a stairwell, well outside
   * the sprite's own footprint, so this uses its own wider cull rather than
   * the tighter one above — otherwise a stairwell just off the edge of the
   * screen would still need its motes drawn as they drift into view.
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
        const alpha = STAIRWELL_DRAFT_MOTE_ALPHA_MAX * Math.min(fadeIn, fadeOut);
        if (alpha <= 0) continue;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${STAIRWELL_DRAFT_MOTE_COLOR_RGB}, ${alpha})`;
        ctx.arc(mote.x - camX, mote.y - camY, mote.radiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * The next floor's level, and how the party measures against it.
   *
   * Null on a floor with nowhere to descend to — which the menu never renders
   * on, but the type says so rather than the reader having to know that.
   */
  private descentAdvice(): DescentAdvice | null {
    const nextId = this.levelDef.nextLevelId;
    if (!nextId) return null;
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
    const result = { party, recommended, underlevelled: party < recommended };
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
      advice?.underlevelled === true
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
      const recommendedStyle = advice.underlevelled ? TEXT_PRESETS.danger : TEXT_PRESETS.value;
      const recommendedText = `Recommended level: ${advice.recommended}`;
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
