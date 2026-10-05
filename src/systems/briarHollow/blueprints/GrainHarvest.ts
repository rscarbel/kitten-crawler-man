/**
 * Merrit's grain: the scythe on the barn wall and the timed swing through
 * the grain field, during the `harvest_grain` step.
 *
 * Owned by `BlueprintsQuestSystem`, which asks it where the scythe hangs and
 * where the field lies (for guidance and the tracker) and routes Space, taps
 * and the render passes to it through the hooks below. The grain counter is
 * durable (`ctx.state.blueprints.grain`); the per-tile cut state and a swing
 * in progress live here and are deliberately lost on a reload, which simply
 * regrows the field. Whether the scythe is held is read off the crawlers'
 * inventories (`holderOf`), never stored.
 *
 * A swing is one press and one timed second press. The first starts a swing
 * of {@link SCYTHE_SWING_SECONDS}; the second is graded by where in the swing
 * it landed, measured from the input event's own timestamp rather than from
 * whenever the handler happened to run, so a frame stall never moves a
 * press out of the window it was made in. Only the first second press
 * counts: it is judged the moment it is made, with its sound and the
 * verdict on the screen-wide timing bar (`ScytheSwingBar`), and a swing that
 * runs out with no press is judged a miss. Every swing lands its grain when
 * it ends — a hit its full share, a miss a single stalk's worth — and the
 * stand in front of the crawler takes one cut. The bar comes down the moment
 * the needle reaches its end, together with Carl's swing row, so nothing
 * stands idle between the swing finishing and the next one starting.
 *
 * A swing the swinger breaks off — walking, attacking, being struck, a
 * hostile closing in — is dropped with nothing, unless its press was already
 * judged a hit: then it lands at once, because "PERFECT!" or "Clean cut!"
 * and its sound already told the player what they earned, and stepping away
 * the moment after the press is the natural thing to do. A miss was never
 * celebrated, so breaking it off forfeits its consolation grain. A swing
 * that loses its footing entirely (the step moves on, the scythe leaves the
 * party, the swinger goes down) is dropped whatever its verdict.
 */

import { TILE_SIZE } from '../../../core/constants';
import { viewportHeight, viewportWidth } from '../../../core/Viewport';
import type { SpatialGrid } from '../../../core/SpatialGrid';
import type { Mob } from '../../../creatures/Mob';
import { BLUEPRINTS_GRAIN_TARGET } from '../../../core/blueprintsQuestPhase';
import { allocCanvas, type CanvasSurface, surfaceContext } from '../../../core/canvasSurface';
import { keybindings } from '../../../core/Keybindings';
import { activeInputMode, byInputMode, keyLabel } from '../../../ui/core/inputMode';
import { HumanPlayer } from '../../../creatures/HumanPlayer';
import { rectContains } from '../../../map/overworld/briarHollowSite';
import { drawGrainStand, type GrainStage } from '../../../map/tiles/cropRowTiles';
import { tileHash } from '../../../map/tiles/hollowTileHash';
import type { TilePoint } from '../../../map/town/townPlan';
import { CHOP_ROWS } from '../../../sprites/art/humanFigure';
import { viewForFacing } from '../../../sprites/humanSprite';
import { drawInteractionPrompt } from '../../../ui/InteractionPrompt';
import type { Rect } from '../../../ui/core/geom';
import { hostileWithinAttackRange } from '../../interactionPromptGate';
import type { TileRect } from '../questGuidance';
import { UPDATES_PER_SECOND } from '../structureRules';
import type { BlueprintsCrawler, BlueprintsQuestContext } from './blueprintsContext';
import { grantBlueprintsItem, holderOf } from './blueprintsProgress';
import {
  drawScytheSwingBar,
  drawScytheVerdictEdgeGlow,
  scytheSwingBarLayout,
  type ScytheSwingBarView,
} from './ScytheSwingBar';

/** How long one swing of the scythe takes, first press to grain. */
export const SCYTHE_SWING_SECONDS = 1.5;
/** The outer band of the swing, as shares of it: a second press here is a good cut. */
export const SCYTHE_GOOD_WINDOW = { start: 0.55, end: 0.85 } as const;
/** The inner band, inside the outer one: a second press here is a perfect cut. */
export const SCYTHE_PERFECT_WINDOW = { start: 0.66, end: 0.74 } as const;
/**
 * Grain for a missed swing: no second press, or one made too early or too
 * late. A swing through the stand still cuts it and brings a little in, so a
 * player who cannot find the timing still makes slow progress; the red
 * "Miss!", the shake and the miss sound keep it reading as a failure.
 */
export const GRAIN_PER_MISS = 1;
export const GRAIN_PER_GOOD = 4;
export const GRAIN_PER_PERFECT = 8;
/** How long a stand cut to stubble takes to grow back in full. */
export const GRAIN_REGROW_SECONDS = 30;
/** Cuts a stand takes before it is stubble. */
export const GRAIN_CUTS_TO_STUBBLE = 3;
/** How near a stand's centre the swinging crawler's centre must be, in tiles. */
export const HARVEST_REACH_TILES = 1.3;
/** How near the pegs the active crawler must stand to take the scythe down, in tiles. */
export const SCYTHE_TAKE_REACH_TILES = 1.5;
/** How a swing's second press was judged. */
export type ScytheGrade = 'perfect' | 'good' | 'miss';

/** Why a live swing stopped early; see `GrainHarvest.swingInterruption`. */
type SwingInterruption = 'lost' | 'brokenOff';

const SCYTHE_SWING_TICKS = Math.round(SCYTHE_SWING_SECONDS * UPDATES_PER_SECOND);
const MS_PER_SECOND = 1000;
const TICK_MS = MS_PER_SECOND / UPDATES_PER_SECOND;
/**
 * How far past the last tick a press may be placed by its timestamp, in
 * ticks: two frames at the slowest rate the loop still keeps up with (two
 * updates a frame). When the loop lags the wall clock, the bar the player was
 * watching had not moved that far, and grading further ahead would judge a
 * press against a picture nobody saw. There is no such bound backwards: a
 * tap is handled at touchend, well after the touchstart it is stamped with,
 * and it must still be graded where the finger came down.
 */
const MAX_PRESS_OFFSET_TICKS = 4;
const MAX_PRESS_OFFSET_MS = MAX_PRESS_OFFSET_TICKS * TICK_MS;
/**
 * The last third of the regrowth passes back through sparse and thinned, so
 * the field is seen coming back rather than popping in whole.
 */
const REGROW_SPARSE_FROM_SECONDS = 20;
const REGROW_THINNED_FROM_SECONDS = 25;
/**
 * Movement past which the swing ends, in pixels from where it started — the
 * gather channel's rule, measured on position because `isMoving` only means
 * "tried to walk".
 */
const SWING_MOTION_TOLERANCE_PX = 0.5;
/** How squarely a stand must sit in front of the crawler to be picked over a nearer one. */
const FACING_PREFERENCE_DOT = 0.5;
/** Donut has no scythe row: her swipe lands this long before the swing ends, as the grain falls. */
const CAT_SWIPE_LEAD_SECONDS = 0.4;
const CAT_SWIPE_LEAD_TICKS = Math.round(CAT_SWIPE_LEAD_SECONDS * UPDATES_PER_SECOND);
const SCYTHE_LOOK_TIER = 0;
/** The scythe's pegs art stands this many tiles above its own tile, where a tap may land on it. */
const PEGS_TAP_HEADROOM_TILES = 2;

const TILE_CENTRE = 0.5;
const GRAIN_STAGES: readonly GrainStage[] = ['full', 'thinned', 'sparse', 'stubble'];
/** Layouts per stage: enough that the field never reads as one stamp repeated. */
const GRAIN_STAND_LAYOUTS = 4;
const GRAIN_LAYOUT_SALT = 0x5c47;
/** The stands are cached at twice the tile, so a HiDPI canvas keeps the stalks crisp. */
const GRAIN_STAND_SUPERSAMPLE = 2;

/** Where the harvest keeps a stand's cuts. Absent: an uncut stand. */
interface StandCuts {
  cuts: number;
  /** The update tick the stand was cut to stubble, while it is. */
  stubbleAtTick: number | null;
}

interface Swing {
  readonly swinger: BlueprintsCrawler;
  readonly tile: TilePoint;
  readonly startX: number;
  readonly startY: number;
  hp: number;
  ticks: number;
  /**
   * When the swing started on the input events' clock, pushed later by every
   * stretch the world spent halted, so a press's distance from it is swing
   * time the player actually watched.
   */
  startMs: number;
  /** Where in the swing the one graded press landed, 0–1, or null before it. */
  pressShare: number | null;
  /** The swing's verdict: its press's grade, or a miss once it ran out unpressed. Null until then. */
  verdict: ScytheGrade | null;
  /** The harvest tick the verdict was reached on, for the bar's flash and pop. */
  verdictTick: number;
  /** Whether Carl's paced swing row is playing for this swing. */
  animating: boolean;
}

/**
 * What the harvest reads: the shared context (only the mob grid of the
 * roster, for the hostile check), plus a clock for the press timestamps —
 * narrow enough to stand up headlessly.
 */
export type GrainHarvestContext = Pick<
  BlueprintsQuestContext,
  'state' | 'gameMap' | 'site' | 'human' | 'cat' | 'active' | 'worldHalted' | 'cue'
> &
  Partial<Pick<BlueprintsQuestContext, 'onTileChanged'>> & {
    readonly roster: { readonly grid: SpatialGrid<Mob> };
    /**
     * The clock input timestamps share (`performance.now()`'s timebase),
     * in milliseconds. A headless gate supplies its own.
     */
    readonly nowMs?: () => number;
  };

/** Judges a second press at `share` of the swing. */
export function gradeScythePress(share: number): ScytheGrade {
  if (share >= SCYTHE_PERFECT_WINDOW.start && share <= SCYTHE_PERFECT_WINDOW.end) return 'perfect';
  if (share >= SCYTHE_GOOD_WINDOW.start && share <= SCYTHE_GOOD_WINDOW.end) return 'good';
  return 'miss';
}

/** The grain a swing judged `grade` lands. */
export function grainForGrade(grade: ScytheGrade): number {
  switch (grade) {
    case 'perfect':
      return GRAIN_PER_PERFECT;
    case 'good':
      return GRAIN_PER_GOOD;
    case 'miss':
      return GRAIN_PER_MISS;
  }
}

/**
 * How a stand looks after `cuts` cuts, and — once it is stubble —
 * `secondsSinceStubble` into its regrowth: stubble for the first two thirds,
 * then back through sparse and thinned, so the regrowth is seen coming.
 */
export function grainStageFor(cuts: number, secondsSinceStubble: number): GrainStage {
  if (cuts < GRAIN_CUTS_TO_STUBBLE) return GRAIN_STAGES[cuts] ?? 'full';
  if (secondsSinceStubble >= GRAIN_REGROW_SECONDS) return 'full';
  if (secondsSinceStubble >= REGROW_THINNED_FROM_SECONDS) return 'thinned';
  if (secondsSinceStubble >= REGROW_SPARSE_FROM_SECONDS) return 'sparse';
  return 'stubble';
}

const standSurfaces = new Map<string, CanvasSurface>();

/** One stage of one stand layout, painted once for every tile that shows it. */
function standSurface(stage: GrainStage, layout: number): CanvasSurface {
  const cacheKey = `${stage}:${layout}`;
  const known = standSurfaces.get(cacheKey);
  if (known !== undefined) return known;
  const size = TILE_SIZE * GRAIN_STAND_SUPERSAMPLE;
  const surface = allocCanvas(size, size);
  drawGrainStand(surfaceContext(surface), 0, 0, size, layout, 0, stage);
  standSurfaces.set(cacheKey, surface);
  return surface;
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

export class GrainHarvest {
  private readonly stands = new Map<string, StandCuts>();
  private swing: Swing | null = null;
  /** Update ticks run while the world was live: the regrowth clock. */
  private tick = 0;
  /** When the current halt began, on the input events' clock; null while the world runs. */
  private haltedSinceMs: number | null = null;
  private readonly nowMs: () => number;
  /** The pegs' anchor tile, found once: the barn is fixed layout. */
  private readonly pegs: TilePoint | null;

  constructor(protected readonly ctx: GrainHarvestContext) {
    this.nowMs = ctx.nowMs ?? (() => performance.now());
    const barn = ctx.site.buildings.find((building) => building.id === 'barn');
    const pegs = barn?.furniture.find((prop) => prop.prop === 'scythe_pegs');
    this.pegs = pegs === undefined ? null : { x: pegs.x, y: pegs.y };
  }

  /** The barn-wall tile the scythe hangs on, for guidance; null where the barn has no pegs. */
  scytheTile(): TilePoint | null {
    return this.pegs;
  }

  /** The harvestable grain field, for guidance; null on a map without one. */
  grainField(): TileRect | null {
    const { x, y, w, h } = this.ctx.site.grainField;
    return { x, y, width: w, height: h };
  }

  /** Whether a swing is under way. */
  get isSwinging(): boolean {
    return this.swing !== null;
  }

  /**
   * Whether a swing is live and wants every world tap, so a tap anywhere is
   * the timed second press. `BriarHollowKit.handleTap` gives it the tap
   * before cows, villagers and the fence.
   */
  get claimsWorldTaps(): boolean {
    return this.swing !== null;
  }

  /** How many cuts the stand at (`tileX`, `tileY`) has taken: 0 uncut, 3 stubble. */
  cutsAt(tileX: number, tileY: number): number {
    return this.stands.get(tileKey(tileX, tileY))?.cuts ?? 0;
  }

  /** How the stand at (`tileX`, `tileY`) looks right now. */
  stageAt(tileX: number, tileY: number): GrainStage {
    const stand = this.stands.get(tileKey(tileX, tileY));
    if (stand === undefined) return 'full';
    const ticksSince = stand.stubbleAtTick === null ? 0 : this.tick - stand.stubbleAtTick;
    return grainStageFor(stand.cuts, ticksSince / UPDATES_PER_SECOND);
  }

  /** Once per gameplay frame: advances a swing, ends it early on an interruption, and regrows stubble. */
  update(): void {
    this.syncPegs();
    if (this.ctx.worldHalted()) {
      this.haltedSinceMs ??= this.nowMs();
      return;
    }
    this.resumeFromHalt();
    this.tick++;
    this.regrow();
    this.advanceSwing();
  }

  /** Moves a live swing's start past the halt just ended, so the halt counts as no swing time. */
  private resumeFromHalt(): void {
    const haltedSinceMs = this.haltedSinceMs;
    if (haltedSinceMs === null) return;
    this.haltedSinceMs = null;
    if (this.swing !== null) this.swing.startMs += this.nowMs() - haltedSinceMs;
  }

  /**
   * Space, from `BriarHollowKit.tryInteract`, after the fence: takes the
   * scythe off the wall or starts a swing. Returns whether the press was
   * taken; false outside `harvest_grain` and whenever there is nothing in
   * reach, so the press falls through unchanged. A press during a live swing
   * is taken without effect: the graded press comes through
   * {@link handleKeyDown}, which carries the event's timestamp.
   */
  tryInteract(active: BlueprintsCrawler): boolean {
    if (this.swing !== null) return true;
    if (this.tryTakeScythe(active)) return true;
    const tile = this.standInReach(active);
    if (tile === null) return false;
    this.startSwing(active, tile);
    return true;
  }

  /**
   * The raw keydown, ahead of every other key consumer while a swing is
   * live: the attack key is the swing's timed second press, graded at
   * `eventTimeStampMs`. Held-key repeats and any press after the first are
   * swallowed so they can neither grade again nor reach the attack. Returns
   * whether the key was taken.
   */
  handleKeyDown(key: string, repeat: boolean, eventTimeStampMs: number): boolean {
    if (this.swing === null || this.ctx.worldHalted()) return false;
    if (keybindings.actionFor(key) !== 'attack') return false;
    if (!repeat) this.gradePress(eventTimeStampMs);
    return true;
  }

  /**
   * A single world tap at world pixel (`worldX`, `worldY`): the mobile
   * equivalent of {@link tryInteract}, and while {@link claimsWorldTaps} is
   * set any tap is the swing's timed press, graded at `eventTimeStampMs`.
   * Returns whether the tap was taken.
   */
  handleTap(
    worldX: number,
    worldY: number,
    active: BlueprintsCrawler,
    eventTimeStampMs: number,
  ): boolean {
    if (this.swing !== null) {
      this.gradePress(eventTimeStampMs);
      return true;
    }
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const pegs = this.pegs;
    const onPegs =
      pegs !== null &&
      tileX === pegs.x &&
      tileY <= pegs.y &&
      tileY >= pegs.y - PEGS_TAP_HEADROOM_TILES;
    if (onPegs) return this.tryTakeScythe(active);
    if (!rectContains(this.ctx.site.grainField, tileX, tileY)) return false;
    const tile = this.standInReach(active);
    if (tile === null) return false;
    this.startSwing(active, tile);
    return true;
  }

  /** Whether a Space press from `active` would be taken here: {@link tryInteract} without its effects. */
  wouldInteract(active: BlueprintsCrawler): boolean {
    return this.swing !== null || this.canTakeScythe(active) || this.standInReach(active) !== null;
  }

  // ── The scythe ───────────────────────────────────────────────────────────

  private get scytheHolder(): BlueprintsCrawler | null {
    return holderOf([this.ctx.human, this.ctx.cat], 'quest_scythe');
  }

  /** Whether `active` could take the scythe down right now. */
  canTakeScythe(active: BlueprintsCrawler): boolean {
    const pegs = this.pegs;
    if (pegs === null || this.ctx.state.blueprints.phase !== 'harvest_grain') return false;
    if (this.scytheHolder !== null) return false;
    return tilesFrom(active, pegs) <= SCYTHE_TAKE_REACH_TILES;
  }

  private tryTakeScythe(active: BlueprintsCrawler): boolean {
    if (!this.canTakeScythe(active)) return false;
    grantBlueprintsItem(active, 'quest_scythe');
    this.ctx.cue('scytheUnhook');
    this.syncPegs();
    return true;
  }

  /** Carries whether the scythe is off its pegs onto the pegs' tile, for the prop renderer. */
  private syncPegs(): void {
    const pegs = this.pegs;
    if (pegs === null) return;
    // The pegs are barn furniture, so their tile always lies on the map.
    const content = this.ctx.gameMap.structure[pegs.y][pegs.x];
    const taken = this.scytheHolder !== null;
    if ((content.scytheTaken === true) === taken) return;
    content.scytheTaken = taken ? true : undefined;
    this.ctx.gameMap.markTileDirty(pegs.x, pegs.y);
    this.ctx.onTileChanged?.(pegs.x, pegs.y);
  }

  // ── The swing ────────────────────────────────────────────────────────────

  /**
   * The stand `crawler` would cut: an uncut-enough grain tile in reach, the
   * one squarely ahead first, else the nearest. Null outside `harvest_grain`,
   * at the target, or without the scythe.
   */
  standInReach(crawler: BlueprintsCrawler): TilePoint | null {
    const quest = this.ctx.state.blueprints;
    if (quest.phase !== 'harvest_grain' || quest.grain >= BLUEPRINTS_GRAIN_TARGET) return null;
    if (this.scytheHolder === null) return null;
    const field = this.ctx.site.grainField;
    const centreX = crawler.x + TILE_SIZE / 2;
    const centreY = crawler.y + TILE_SIZE / 2;
    const reachPx = HARVEST_REACH_TILES * TILE_SIZE;
    let faced: { tile: TilePoint; dot: number } | null = null;
    let nearest: { tile: TilePoint; distance: number } | null = null;
    for (let tileY = field.y; tileY < field.y + field.h; tileY++) {
      for (let tileX = field.x; tileX < field.x + field.w; tileX++) {
        if (this.cutsAt(tileX, tileY) >= GRAIN_CUTS_TO_STUBBLE) continue;
        const dx = (tileX + TILE_CENTRE) * TILE_SIZE - centreX;
        const dy = (tileY + TILE_CENTRE) * TILE_SIZE - centreY;
        const distance = Math.hypot(dx, dy);
        if (distance > reachPx) continue;
        const tile = { x: tileX, y: tileY };
        if (nearest === null || distance < nearest.distance) nearest = { tile, distance };
        if (distance === 0) continue;
        const dot = (dx / distance) * crawler.facingX + (dy / distance) * crawler.facingY;
        if (dot >= FACING_PREFERENCE_DOT && (faced === null || dot > faced.dot)) {
          faced = { tile, dot };
        }
      }
    }
    return faced?.tile ?? nearest?.tile ?? null;
  }

  private startSwing(swinger: BlueprintsCrawler, tile: TilePoint): void {
    const faceX = (tile.x + TILE_CENTRE) * TILE_SIZE - (swinger.x + TILE_SIZE / 2);
    const faceY = (tile.y + TILE_CENTRE) * TILE_SIZE - (swinger.y + TILE_SIZE / 2);
    const faceLength = Math.hypot(faceX, faceY);
    if (faceLength > 0) {
      swinger.facingX = faceX / faceLength;
      swinger.facingY = faceY / faceLength;
    }
    const swing: Swing = {
      swinger,
      tile,
      startX: swinger.x,
      startY: swinger.y,
      hp: swinger.hp,
      ticks: 0,
      startMs: this.nowMs(),
      pressShare: null,
      verdict: null,
      verdictTick: 0,
      animating: false,
    };
    this.swing = swing;
    swinger.setWorkingTool({ kind: 'scythe', tier: SCYTHE_LOOK_TIER });
    if (swinger instanceof HumanPlayer) this.playSwingRow(swing, swinger);
    this.ctx.cue('scytheSwing');
  }

  /**
   * Carl's chop row, paced by the swing rather than by its own clock, so the
   * axe's one-second swing plays out over the scythe's longer one.
   */
  private playSwingRow(swing: Swing, human: HumanPlayer): void {
    const row = CHOP_ROWS[viewForFacing(human.facingX, human.facingY)];
    swing.animating = human.playAction(row, {
      faceX: human.facingX,
      faceY: human.facingY,
      progress: () => swing.ticks / SCYTHE_SWING_TICKS,
      onEnd: () => {
        swing.animating = false;
      },
    });
  }

  /** Where in the live swing a press stamped `eventTimeStampMs` landed, 0–1. */
  private shareAt(swing: Swing, eventTimeStampMs: number): number {
    // A press can arrive between the halt lifting and the next update folding it in.
    if (!this.ctx.worldHalted()) this.resumeFromHalt();
    const sinceStartMs = eventTimeStampMs - swing.startMs;
    const latestPlausibleMs = swing.ticks * TICK_MS + MAX_PRESS_OFFSET_MS;
    const swingMs = Math.max(0, Math.min(latestPlausibleMs, sinceStartMs));
    return swingMs / (SCYTHE_SWING_SECONDS * MS_PER_SECOND);
  }

  private gradePress(eventTimeStampMs: number): void {
    const swing = this.swing;
    if (swing === null) return;
    if (swing.verdict !== null) return;
    swing.pressShare = this.shareAt(swing, eventTimeStampMs);
    this.judge(swing, gradeScythePress(swing.pressShare));
  }

  /** Settles `swing`'s verdict, once, with its sound. */
  private judge(swing: Swing, verdict: ScytheGrade): void {
    swing.verdict = verdict;
    swing.verdictTick = this.tick;
    switch (verdict) {
      case 'perfect':
        this.ctx.cue('scytheTimingPerfect');
        return;
      case 'good':
        this.ctx.cue('scytheTimingGood');
        return;
      case 'miss':
        this.ctx.cue('scytheMiss');
        return;
    }
  }

  private advanceSwing(): void {
    const swing = this.swing;
    if (swing === null) return;
    const interruption = this.swingInterruption(swing);
    const judgedAHit = swing.verdict === 'good' || swing.verdict === 'perfect';
    if (interruption === 'brokenOff' && judgedAHit) {
      this.land(swing);
      return;
    }
    if (interruption !== null) {
      this.endSwing(swing);
      return;
    }
    swing.ticks++;
    const swinger = swing.swinger;
    if (swinger instanceof HumanPlayer) {
      if (!swing.animating && swing.ticks < SCYTHE_SWING_TICKS) this.playSwingRow(swing, swinger);
    } else if (swing.ticks === SCYTHE_SWING_TICKS - CAT_SWIPE_LEAD_TICKS) {
      swinger.playWorkSwing();
    }
    if (swing.ticks >= SCYTHE_SWING_TICKS) this.land(swing);
  }

  /**
   * The gather channel's interruptions, sorted by whether a judged press
   * survives them: `lost` when the swing can no longer pay out at all (the
   * step moved on, the scythe left the party, the swinger went down),
   * `brokenOff` when the swinger merely stopped standing still for it
   * (moving, attacking, a hit, a hostile in reach). Null while it runs on.
   */
  private swingInterruption(swing: Swing): SwingInterruption | null {
    const swinger = swing.swinger;
    if (this.ctx.state.blueprints.phase !== 'harvest_grain') return 'lost';
    if (this.scytheHolder === null) return 'lost';
    if (!swinger.isAlive || swinger.isKnockedOut) return 'lost';
    const moved = Math.hypot(swinger.x - swing.startX, swinger.y - swing.startY);
    if (moved > SWING_MOTION_TOLERANCE_PX) return 'brokenOff';
    if (swinger.isSwinging) return 'brokenOff';
    if (swinger.hp < swing.hp) return 'brokenOff';
    swing.hp = swinger.hp;
    return hostileWithinAttackRange(swinger, this.ctx.roster.grid) ? 'brokenOff' : null;
  }

  private land(swing: Swing): void {
    this.endSwing(swing);
    if (swing.verdict === null) this.judge(swing, 'miss');
    const amount = grainForGrade(swing.verdict ?? 'miss');
    this.ctx.state.blueprints.grain += amount;
    this.cut(swing.tile);
    swing.swinger.queueFloatingText(`+${amount} Grain`, 'buff');
    this.ctx.cue('grainGather');
  }

  private endSwing(swing: Swing): void {
    if (this.swing === swing) this.swing = null;
    swing.swinger.setWorkingTool(null);
    if (swing.animating && swing.swinger instanceof HumanPlayer) {
      swing.animating = false;
      swing.swinger.stopAction();
    }
  }

  /** What the timing bar shows right now: the live swing, or null when none is under way. */
  swingBarView(): ScytheSwingBarView | null {
    const swing = this.swing;
    if (swing === null) return null;
    return {
      progress: Math.min(1, swing.ticks / SCYTHE_SWING_TICKS),
      pressShare: swing.pressShare,
      verdict: swing.verdict,
      verdictAgeSeconds:
        swing.verdict === null ? 0 : (this.tick - swing.verdictTick) / UPDATES_PER_SECOND,
      verdictGrain: grainForGrade(swing.verdict ?? 'miss'),
      goodWindow: SCYTHE_GOOD_WINDOW,
      perfectWindow: SCYTHE_PERFECT_WINDOW,
      pressLabel: byInputMode(activeInputMode(), { touch: 'Tap', pointer: keyLabel('attack') }),
    };
  }

  // ── The field ────────────────────────────────────────────────────────────

  private cut(tile: TilePoint): void {
    const key = tileKey(tile.x, tile.y);
    const stand = this.stands.get(key) ?? { cuts: 0, stubbleAtTick: null };
    stand.cuts = Math.min(GRAIN_CUTS_TO_STUBBLE, stand.cuts + 1);
    if (stand.cuts >= GRAIN_CUTS_TO_STUBBLE) stand.stubbleAtTick = this.tick;
    this.stands.set(key, stand);
  }

  private regrow(): void {
    const regrowTicks = GRAIN_REGROW_SECONDS * UPDATES_PER_SECOND;
    for (const [key, stand] of this.stands) {
      if (stand.stubbleAtTick === null) continue;
      if (this.tick - stand.stubbleAtTick >= regrowTicks) this.stands.delete(key);
    }
  }

  // ── The picture ──────────────────────────────────────────────────────────

  /** Under every body: the field's stalks at their current stage. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const field = this.ctx.site.grainField;
    for (let tileY = field.y; tileY < field.y + field.h; tileY++) {
      for (let tileX = field.x; tileX < field.x + field.w; tileX++) {
        const layout = tileHash(tileX, tileY, GRAIN_LAYOUT_SALT) % GRAIN_STAND_LAYOUTS;
        const surface = standSurface(this.stageAt(tileX, tileY), layout);
        ctx.drawImage(
          surface,
          tileX * TILE_SIZE - camX,
          tileY * TILE_SIZE - camY,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }
  }

  /**
   * Screen space, in the HUD pass: the timing bar across the screen, clear of
   * every rect in `keepouts` (HUD panel, minimap, hotbar, a phone's buttons),
   * and the screen-edge flash of a verdict just reached.
   */
  renderHud(ctx: CanvasRenderingContext2D, keepouts: readonly Rect[]): void {
    const view = this.swingBarView();
    if (view === null) return;
    const width = viewportWidth();
    const height = viewportHeight();
    drawScytheVerdictEdgeGlow(ctx, width, height, view);
    drawScytheSwingBar(ctx, scytheSwingBarLayout(width, height, keepouts), view);
  }

  /**
   * The harvest or take-the-scythe prompt, in `BriarHollowKit.renderPrompt`
   * order. Returns whether it claimed the prompt slot. A live swing claims it
   * without drawing: Space is the swing's timed press then, so no later link
   * (a villager's "Talk" beside the field) may name a different action, and
   * the labelled swing bar already says what the press does.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: BlueprintsCrawler,
  ): boolean {
    if (this.swing !== null) return true;
    // In touch mode the key cap itself reads "TAP", so the label finishes its sentence.
    const mode = activeInputMode();
    const pegs = this.pegs;
    if (pegs !== null && this.canTakeScythe(active)) {
      const label = byInputMode(mode, { touch: 'to take the scythe', pointer: 'Take scythe' });
      drawInteractionPrompt(
        ctx,
        pegs.x * TILE_SIZE - camX,
        pegs.y * TILE_SIZE - camY,
        TILE_SIZE,
        label,
      );
      return true;
    }
    if (this.standInReach(active) === null) return false;
    const label = byInputMode(mode, { touch: 'to harvest', pointer: 'Harvest' });
    drawInteractionPrompt(ctx, active.x - camX, active.y - camY, TILE_SIZE, label);
    return true;
  }

  /** A death rewind on the same scene: drop any swing in progress, and its bar. */
  onRewind(): void {
    if (this.swing !== null) this.endSwing(this.swing);
  }

  /** The scene is being torn down. */
  dispose(): void {
    if (this.swing !== null) this.endSwing(this.swing);
  }
}

/** Tiles from `crawler`'s centre to the centre of `tile`. */
function tilesFrom(crawler: BlueprintsCrawler, tile: TilePoint): number {
  const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
  const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
  return Math.hypot(tile.x + TILE_CENTRE - centreX, tile.y + TILE_CENTRE - centreY);
}
