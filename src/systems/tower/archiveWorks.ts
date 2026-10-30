/**
 * The warded archive. Its ward lines are registered into the storey's sense
 * layer, where the cat sees each at full strength and its rhythm, and the
 * human sees only a faint steady warning over the same ground; how they
 * stand follows the questline:
 *
 * - **Solid**, before the conduit is shut: every ward bars its tiles to
 *   everyone. Belle coming down from the cattery finds the east room sealed.
 * - **Pulsing**, once it is shut: the doorway's ward burns on a rhythm and
 *   bites whoever is in it while it burns; the west ward goes dark for good
 *   the first time its plate is weighed down; the north door's ward stays solid.
 * - **Sweeping**, once the Warden knows the party is inside: each ward sweeps
 *   back and forth across its band, fed by a standing stone. Only Belle can
 *   find which stone feeds a ward — standing by it marks it — and only the
 *   human can break a marked stone, which puts its ward out.
 * - **Spent**, once the Warden is gone: nothing.
 *
 * A ward that bites does a little damage and puts the crawler back on the
 * last tile it stood on outside every ward.
 *
 * Before the Warden knows, raveling wardens drift on their rounds. They do not
 * fight; one that sees a crawler at all has the party caught at a glance
 * and set back at the cattery stair's landing, as the gatehouse's guards do,
 * and one that sees a companion is put on orange alert.
 * A warden is the archive's keeper, and the dumbwaiter's bell is how it is
 * called: rung, the warden stops, turns toward the sound with a `?`, then
 * leaves its round by the south doorway to hang in front of the hatch,
 * peering in at what came up, before it drifts back the way it came. Its back
 * is to the room the whole time it peers, and its own room stands empty.
 * Rung again, it goes back to the hatch, so the bell can always be used.
 * Once the Warden knows, the ravelings come to fight.
 *
 * While the party is apart, each thing in the room that can be worked wears
 * the same quiet tell (`interestGlint.ts`): a sheen on whatever can be batted
 * off a shelf top or rung, and a soft pool of light on the plate.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../core/constants';
import { TOWER_STAIR_SPAN } from '../../map/tileTypes';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import type { Mob } from '../../creatures/Mob';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import {
  ARCHIVE_FIXED_WARDS,
  ARCHIVE_KNOCKABLES,
  ARCHIVE_RAVELING_TILES,
  ARCHIVE_SWEEPING_WARDS,
  ARCHIVE_WARD_PLATE,
  ARCHIVE_WARDEN_BELL_PATH,
  ARCHIVE_WARDEN_ROUNDS,
  TOWER_DUMBWAITER,
  towerStoreyPlan,
  type ArchiveFixedWard,
  type ArchiveSweepingWard,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { Player, DamageSource } from '../../Player';
import { WARD_STONE_VARIANT } from '../../sprites/art/townInterior/rooms/towerWorks';
import { MINE_ROWS } from '../../sprites/art/humanFigure';
import { drawRavelingSprite, ravelingFloatPhase } from '../../sprites/ravelingSprite';
import { drawQuestBeacon } from '../../sprites/questBeacon';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { worldPalette } from '../../ui/theme/worldInk';
import { drawSightFan } from '../../ui/world/worldSightFan';
import { drawGlyphBadge, glyphBadgeBob } from '../../ui/world/glyphBadge';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import { drawInterestGlint, drawInterestPool } from '../../ui/world/interestGlint';
import { TOWER_DUMBWAITER_BELL_FLAG } from '../../map/town/interiors/roomMechanisms';
import type { WardSegment } from '../../ui/world/worldSenses';
import type { SystemContext } from '../GameSystem';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import type { SenseSourceHandle } from '../senses/SenseLayer';
import type { WorkChannelBuilder } from '../WorkChannel';
import {
  CAUGHT_AFTER_SEEN_FRAMES,
  stepSuspicion,
  SUSPICION_CAPTURE,
} from '../stealthKeySnatch/detection';
import type { OnSightNoticeTuning } from '../stealthKeySnatch/prisonTuning';
import { CaptureFade } from './captureFade';
import {
  sameTile,
  StoreyWorks,
  tileCentrePx,
  tileOfBody,
  tileOriginPx,
  type StoreyWorksDeps,
} from './storeyWorks';

const ARCHIVE_SPAWNS = liveSpawnContext('quest:tower-archive');

const WARD_DAMAGE = 4;
const WARD_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'towerWard' };
/** Frames after a bite before the same crawler can be bitten again. */
const WARD_BITE_COOLDOWN_FRAMES = 45;

/** The doorway ward's rhythm: frames per cycle, the burning share at its end, and the brightening before it. */
const PULSE_PERIOD_FRAMES = 150;
const PULSE_BURN_FRAMES = 55;
const PULSE_WARN_FRAMES = 35;
/** How far a pulsing ward's warning has risen, as a share of full, the frame before it burns. */
const PULSE_WARN_PEAK = 0.75;

/** Frames a sweeping ward takes to cross its band and come back, and how far apart the sweeps start. */
const SWEEP_PERIOD_FRAMES = 260;
const SWEEP_PHASE_STEP_FRAMES = 85;
/** A sweeping ward bites the column it is over while its line is this close to that column's middle, in tiles. */
const SWEEP_BITE_HALF_TILES = 0.35;

/** Hauls on a ward stone that break it. */
const STONE_PRESSES = 3;
const STONE_REACH_TILES = 1.3;
const STONE_ART_RISE_TILES = 0.9;
/** How close Belle must come to a stone to find which ward it feeds. */
const STONE_FIND_TILES = 1.6;
const STONE_BADGE_LIFT_TILES = 1.4;

const STONE_DEF: MashInteractionDef = {
  pressesRequired: STONE_PRESSES,
  deed: 'break the ward stone',
  humanRows: MINE_ROWS,
  barStyle: 'hack',
  reachTiles: STONE_REACH_TILES,
  artRisePx: TILE_SIZE * STONE_ART_RISE_TILES,
};

/** A warden's drift speed, in pixels a frame, and how close to a corner counts as there. */
const WARDEN_SPEED = 0.55;
const WARDEN_ARRIVE_PX = 2;
/** What a warden sees: how far, and how wide either side of the way it faces. */
const WARDEN_SIGHT_TILES = 3.5;
const WARDEN_SIGHT_HALF_SHARE_OF_PI = 0.3;
const WARDEN_SIGHT_HALF_ANGLE = Math.PI * WARDEN_SIGHT_HALF_SHARE_OF_PI;
/** A warden's look has no soft edge: whoever it sees, it sees in full view. */
const WARDEN_SIGHTING_WEIGHT = 1;
/**
 * How a warden notices. It catches at a glance, so only how long it stays on
 * its guard after losing sight of someone is its own.
 */
const WARDEN_WARY_FRAMES = 40;
const WARDEN_NOTICE = {
  kind: 'on_sight',
  alertFillFrames: CAUGHT_AFTER_SEEN_FRAMES,
  coneEdgeWeight: WARDEN_SIGHTING_WEIGHT,
  drainFrames: WARDEN_WARY_FRAMES,
} as const satisfies OnSightNoticeTuning;
/** How long a warden stands turning to the bell before it sets off, and how fast it turns. */
const WARDEN_HEARING_FRAMES = 50;
const WARDEN_TURN_RADIANS_PER_FRAME = 0.08;
/** Called, a warden goes to the hatch faster than it keeps its round. */
const WARDEN_ANSWER_SPEED = 1.1;
/** How long it hangs at the hatch peering in, its back to the room. */
const WARDEN_PEER_FRAMES = 600;
/** How full its `?` stands while it turns to the bell: heard, not yet seen. */
const WARDEN_HEARD_SUSPICION = 0.5;
const WARDEN_MARKER_LIFT_TILES = 1.1;
/** Line of sight is walked in steps this long, as a share of a tile. */
const SIGHT_STEP_TILES = 0.25;

const MS_PER_SECOND = 1000;
const MS_PER_WORLD_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;

/** The stairwell's mark sorts just behind anyone standing on its far row, so the beam is never drawn over them. */
const STAIR_MARK_SORTS_BEHIND_PX = 1;

const CAPTURE_TOAST = 'A warden saw you and drove you back to the stairs.';

/** Where each tell sits: a sheen this far above a shelf-top thing's tile centre, and the plate's pool radius. */
const GLINT_LIFT_TILES = 0.3;
const BELL_GLINT_LIFT_TILES = 0.4;
const PLATE_POOL_RADIUS_TILES = 1.05;
/** The archive's things that wear a sheen until they are knocked off, each with its twinkle's stagger. */
const GLINTING_KNOCKABLES = [
  { ...ARCHIVE_KNOCKABLES.key_ring, seed: 0 },
  { ...ARCHIVE_KNOCKABLES.shelf_board, seed: 1 },
  { ...ARCHIVE_KNOCKABLES.plate_jar, seed: 2 },
] as const;
const BELL_GLINT_SEED = 3;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const PAW_PAD_SHARE = 0.42;
const PAW_TOE_SHARE = 0.2;
const PAW_TOE_SPREAD_SHARE = 0.42;
const PAW_TOE_LIFT_SHARE = 0.55;
const PAW_TOES = 4;

/** A paw print, the badge Belle leaves over a stone she has found. */
function pawGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = worldPalette.senses.pawMark;
  ctx.beginPath();
  ctx.arc(cx, cy + radius * PAW_TOE_SHARE, radius * PAW_PAD_SHARE, 0, FULL_TURN);
  ctx.fill();
  for (let toe = 0; toe < PAW_TOES; toe++) {
    const x = cx + (toe - (PAW_TOES - 1) * HALF) * radius * PAW_TOE_SPREAD_SHARE;
    ctx.beginPath();
    ctx.arc(x, cy - radius * PAW_TOE_LIFT_SHARE, radius * PAW_TOE_SHARE, 0, FULL_TURN);
    ctx.fill();
  }
}

/** A ward line live on the storey: the tiles it may bite this frame, and its source in the sense layer. */
interface LiveWard {
  /** The tiles under the ward this frame. */
  readonly tiles: () => readonly TowerTile[];
  /** Whether it bites whoever is on those tiles this frame. */
  readonly biting: () => boolean;
  /** Whether it bars its tiles to everyone instead of biting. */
  readonly solid: () => boolean;
  handle: SenseSourceHandle | null;
}

interface Stone {
  readonly ward: ArchiveSweepingWard;
  readonly work: MashInteraction;
  /** Puts out the ward the stone feeds. */
  readonly putOut: () => void;
  found: boolean;
}

/**
 * A warden away from its round to answer the bell: turning to the sound,
 * going leg by leg along {@link ARCHIVE_WARDEN_BELL_PATH}, peering into the
 * hatch, then coming back along it. `leg` is the index of the path tile it is
 * drifting toward.
 */
type WardenErrand =
  | { readonly kind: 'hearing'; frames: number; readonly thenLeg: number }
  | { readonly kind: 'going'; leg: number }
  | { readonly kind: 'peering'; frames: number }
  | { readonly kind: 'returning'; leg: number };

interface Warden {
  readonly round: readonly TowerTile[];
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  next: number;
  /** How near it is to catching the party, 0 to {@link SUSPICION_CAPTURE}. */
  suspicion: number;
  errand: WardenErrand | null;
  floatFrames: number;
}

const LAST_BELL_LEG = ARCHIVE_WARDEN_BELL_PATH.length - 1;

type ArchiveFixedWardId = keyof typeof ARCHIVE_FIXED_WARDS;
const ARCHIVE_FIXED_WARD_IDS = Object.keys(ARCHIVE_FIXED_WARDS).filter(isArchiveFixedWardId);

function isArchiveFixedWardId(value: string): value is ArchiveFixedWardId {
  return value in ARCHIVE_FIXED_WARDS;
}

type Crawler = HumanPlayer | CatPlayer;

function verticalSegment(columnX: number, y0: number, y1: number): WardSegment {
  const x = (columnX + HALF) * TILE_SIZE;
  return { from: { x, y: y0 * TILE_SIZE }, to: { x, y: (y1 + 1) * TILE_SIZE } };
}

/** A fixed ward's line: one segment down the middle of each column of tiles it lies across. */
function fixedSegments(ward: ArchiveFixedWard): WardSegment[] {
  const columns = new Map<number, { y0: number; y1: number }>();
  for (const tile of ward.tiles) {
    const run = columns.get(tile.x);
    columns.set(tile.x, {
      y0: Math.min(run?.y0 ?? tile.y, tile.y),
      y1: Math.max(run?.y1 ?? tile.y, tile.y),
    });
  }
  return [...columns.entries()].map(([x, run]) => verticalSegment(x, run.y0, run.y1));
}

export class ArchiveWorks extends StoreyWorks {
  private readonly wards: LiveWard[] = [];
  private readonly stones: Stone[] = [];
  private readonly wardens: Warden[] = [];
  /** The ravelings risen to fight once the Warden knows. */
  private readonly raveling: Mob[] = [];
  /** Tiles each fixed ward bars this frame, so a change is a block or an unblock. */
  private readonly barred = new Set<string>();
  private readonly lastSafe = new Map<Crawler, TowerTile>();
  private readonly biteCooldown = new Map<Crawler, number>();
  private readonly capture = new CaptureFade();
  private readonly stopListening: () => void;
  private clock = 0;
  /** Frames the world has run on this storey, captures included: what its tells and badges move by, so they hold still while the world is halted. */
  private worldFrames = 0;
  /** Whether the archive is the storey on show: a bell rung anywhere else is not heard here. */
  private shown = false;

  constructor(deps: StoreyWorksDeps) {
    super(deps);
    this.raiseWards();
    if (deps.conditions.wards === 'solid' || deps.conditions.wards === 'pulsing') {
      for (const round of ARCHIVE_WARDEN_ROUNDS) this.wardens.push(this.raiseWarden(round));
    }
    if (deps.conditions.wards === 'sweeping') {
      for (const tile of ARCHIVE_RAVELING_TILES) {
        const raveling = spawnMob('raveling', tile, deps.map, ARCHIVE_SPAWNS);
        applySpawnDifficulty(raveling);
        deps.addMob(raveling);
        this.raveling.push(raveling);
      }
    }
    this.stopListening = deps.bus.on('conveyorSignalled', ({ flag, from }) => {
      const rungHere = flag === TOWER_DUMBWAITER_BELL_FLAG && from === 'head';
      if (rungHere && this.shown) this.answerBell();
    });
  }

  /** Whether the party is being caught, which holds its input. */
  get playerLocked(): boolean {
    return this.capture.active;
  }

  /** Whether a warden keeps its round here, so the party has to keep out of its look. */
  get watched(): boolean {
    return this.wardens.length > 0;
  }

  /** How dark the capture has the screen. */
  get fadeAlpha(): number {
    return this.capture.alpha;
  }

  enter(_ctx: SystemContext): void {
    this.shown = true;
    if (this.deps.progress.phase === 'cattery') this.moment({ kind: 'cattery_exit_reached' });
  }

  leave(): void {
    this.shown = false;
    if (!this.capture.active) return;
    this.capture.cancel();
    this.resetWardens();
  }

  update(ctx: SystemContext): void {
    this.worldFrames++;
    if (this.capture.active) {
      this.stepCapture();
      return;
    }
    this.clock++;
    this.noteWardPlate();
    this.settleBars();
    const crawlers = this.deps.presentCrawlers();
    for (const crawler of [ctx.human, ctx.cat]) {
      if (!crawlers.includes(crawler)) continue;
      this.watchFeet(crawler);
    }
    this.findStones(ctx.cat, crawlers.includes(ctx.cat));
    this.moveWardens(crawlers, this.deps.presentCompanions());
  }

  tryInteract(ctx: SystemContext): boolean {
    if (ctx.active !== ctx.human) return false;
    for (const stone of this.stones) {
      if (!stone.found || stone.work.isFinished) continue;
      if (stone.work.tryInteract(ctx.active)) return true;
    }
    return false;
  }

  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const warden of this.wardens) {
      drawSightFan(ctx, {
        origin: { x: warden.x + TILE_SIZE * HALF - camX, y: warden.y + TILE_SIZE * HALF - camY },
        rim: {
          kind: 'arc',
          facingRad: Math.atan2(warden.facingY, warden.facingX),
          halfAngleRad: WARDEN_SIGHT_HALF_ANGLE,
          reachPx: WARDEN_SIGHT_TILES * TILE_SIZE,
        },
        suspicion: warden.suspicion,
      });
    }
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const nowMs = this.worldFrames * MS_PER_WORLD_FRAME;
    this.renderPlatePool(ctx, camX, camY, nowMs);
    this.renderGlints(ctx, camX, camY, nowMs);
    for (const warden of this.wardens) {
      const heard = warden.errand?.kind === 'hearing' ? WARDEN_HEARD_SUSPICION : 0;
      drawSuspicionMarker(ctx, {
        x: warden.x + TILE_SIZE * HALF - camX,
        y: warden.y - camY - TILE_SIZE * WARDEN_MARKER_LIFT_TILES,
        suspicion: Math.max(heard, warden.suspicion),
        alarmed: this.capture.active,
        nowMs,
      });
    }
    for (const stone of this.stones) {
      if (!stone.found || stone.work.isFinished) continue;
      const centre = tileCentrePx(stone.ward.stone);
      const lift = TILE_SIZE * STONE_BADGE_LIFT_TILES - glyphBadgeBob(nowMs);
      drawGlyphBadge(ctx, centre.x - camX, centre.y - camY - lift, pawGlyph);
    }
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    for (const stone of this.stones) stone.work.renderProgress(ctx, camX, camY);
    if (!active.isActive || active.crawlerKind !== 'human') return;
    for (const stone of this.stones) {
      if (!stone.found || stone.work.isFinished) continue;
      if (stone.work.renderPrompt(ctx, camX, camY, active)) return;
    }
  }

  roomFigures(): InteriorFigure[] {
    const figures: InteriorFigure[] = this.wardens.map((warden) => ({
      y: warden.y,
      render: (ctx, camX, camY, tileSize) =>
        drawRavelingSprite(
          ctx,
          warden.x - camX,
          warden.y - camY,
          tileSize,
          ravelingFloatPhase(warden.floatFrames),
          warden.suspicion > 0,
          warden.facingX >= 0 ? 1 : -1,
        ),
    }));
    const stairMark = this.stairDownMark();
    if (stairMark !== null) figures.push(stairMark);
    return figures;
  }

  /**
   * The quest beam over the stairwell down once the key ring has gone and
   * the stair is Belle's way on, until the west ward is out. The Journal leads
   * her here by this mark alone while the way to the stair runs through that
   * ward, where an arrow would point straight into it; once it is out, the
   * Journal's own route leads her.
   */
  private stairDownMark(): InteriorFigure | null {
    const { progress } = this.deps;
    const markLeadsBelle =
      progress.phase === 'archive' && progress.keyRingSent && !progress.westWardOut;
    if (!markLeadsBelle) return null;
    const stair = towerStoreyPlan('archive').stairDown;
    if (stair === null) return null;
    const left = stair.x * TILE_SIZE;
    const top = stair.y * TILE_SIZE;
    const span = TOWER_STAIR_SPAN * TILE_SIZE;
    return {
      y: top + span - TILE_SIZE - STAIR_MARK_SORTS_BEHIND_PX,
      render: (ctx, camX, camY) => {
        drawQuestBeacon(
          ctx,
          left - camX,
          top - camY,
          span,
          camX,
          camY,
          this.worldFrames * MS_PER_WORLD_FRAME,
          worldPalette.objective.ready,
        );
      },
    };
  }

  standDown(): void {
    for (const stone of this.stones) {
      if (stone.work.isFinished) continue;
      this.deps.map.setPlacedInteriorPropVariant(stone.ward.stoneId, WARD_STONE_VARIANT.broken);
      stone.putOut();
    }
    this.stones.length = 0;
    for (const ward of this.wards) {
      ward.handle?.remove();
      for (const tile of ward.tiles()) {
        if (this.barred.delete(`${tile.x},${tile.y}`)) {
          this.deps.map.unblockTilePermanently(tile.x, tile.y);
        }
      }
    }
    this.wards.length = 0;
    this.wardens.length = 0;
    for (const raveling of this.raveling) this.deps.removeMob(raveling);
    this.raveling.length = 0;
  }

  dispose(): void {
    this.stopListening();
    for (const ward of this.wards) ward.handle?.remove();
  }

  /**
   * The pool of light on the plate until its ward is out, washed over the
   * plate itself so the plate reads lit. Only while the room is a puzzle:
   * wardens on their rounds.
   */
  private renderPlatePool(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    nowMs: number,
  ): void {
    if (this.wardens.length === 0 || this.deps.progress.westWardOut) return;
    const plate = tileCentrePx(ARCHIVE_WARD_PLATE.at);
    drawInterestPool(ctx, {
      x: plate.x - camX,
      y: plate.y - camY,
      radiusPx: TILE_SIZE * PLATE_POOL_RADIUS_TILES,
      nowMs,
    });
  }

  /**
   * The sheen on each thing still standing on its shelf top, and on the bell
   * while a warden is there to answer it.
   */
  private renderGlints(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    nowMs: number,
  ): void {
    if (this.wardens.length === 0) return;
    const { knockOffs } = this.deps.mechanisms;
    for (const thing of GLINTING_KNOCKABLES) {
      if (!knockOffs.isStanding(thing.id)) continue;
      const at = tileCentrePx(thing.at);
      drawInterestGlint(ctx, {
        x: at.x - camX,
        y: at.y - camY - TILE_SIZE * GLINT_LIFT_TILES,
        nowMs,
        seed: thing.seed,
      });
    }
    const bell = tileCentrePx(TOWER_DUMBWAITER.head.bell);
    drawInterestGlint(ctx, {
      x: bell.x - camX,
      y: bell.y - camY - TILE_SIZE * BELL_GLINT_LIFT_TILES,
      nowMs,
      seed: BELL_GLINT_SEED,
    });
  }

  // ── Wards ──────────────────────────────────────────────────────────────────

  private raiseWards(): void {
    const state = this.deps.conditions.wards;
    switch (state) {
      case 'solid':
        for (const id of ARCHIVE_FIXED_WARD_IDS) this.addFixed(id, () => true);
        return;
      case 'pulsing':
        this.addFixed('north_door', () => true);
        this.addPulsing('doorway');
        this.addFixed('west', () => !this.deps.progress.westWardOut);
        return;
      case 'sweeping':
        Object.values(ARCHIVE_SWEEPING_WARDS).forEach((ward, index) =>
          this.addSweeping(ward, index),
        );
        return;
      case 'spent':
        return;
      default: {
        const unhandled: never = state;
        throw new Error(`unhandled ward state ${String(unhandled)}`);
      }
    }
  }

  /**
   * The west ward goes out for good the first time anything weighs its plate
   * down, and stays out across rebuilds and reloads. Nothing on its far side
   * can reach the plate, so a ward that lit again once Pumpkin wandered off it
   * would shut Belle in by the stair down before the key ring has gone and the
   * stair will take her.
   */
  private noteWardPlate(): void {
    if (this.deps.mechanisms.plates.isPlateHeld(ARCHIVE_WARD_PLATE.id)) {
      this.deps.progress.westWardOut = true;
    }
  }

  /** A ward that bars its tiles while `lit` says so, and is dark and open otherwise. */
  private addFixed(id: ArchiveFixedWardId, lit: () => boolean): void {
    const ward = ARCHIVE_FIXED_WARDS[id];
    const live: LiveWard = {
      tiles: () => ward.tiles,
      biting: () => false,
      solid: lit,
      handle: null,
    };
    live.handle = this.deps.senses.add('ward', {
      id,
      segments: fixedSegments(ward),
      get hurts() {
        return lit();
      },
      pulse: () => (lit() ? 1 : 0),
    });
    this.wards.push(live);
  }

  private addPulsing(id: ArchiveFixedWardId): void {
    const ward = ARCHIVE_FIXED_WARDS[id];
    const live: LiveWard = {
      tiles: () => ward.tiles,
      biting: () => this.pulseBurning,
      solid: () => false,
      handle: null,
    };
    live.handle = this.deps.senses.add('ward', {
      id,
      segments: fixedSegments(ward),
      hurts: true,
      pulse: () => this.pulseStrength,
    });
    this.wards.push(live);
  }

  private get pulseFrame(): number {
    return this.clock % PULSE_PERIOD_FRAMES;
  }

  private get pulseBurning(): boolean {
    return this.pulseFrame >= PULSE_PERIOD_FRAMES - PULSE_BURN_FRAMES;
  }

  /** Out at rest, rising through the warning, full while it burns: the rhythm the cat reads. */
  private get pulseStrength(): number {
    if (this.pulseBurning) return 1;
    const warnFrom = PULSE_PERIOD_FRAMES - PULSE_BURN_FRAMES - PULSE_WARN_FRAMES;
    if (this.pulseFrame < warnFrom) return 0;
    const share = (this.pulseFrame - warnFrom) / PULSE_WARN_FRAMES;
    return PULSE_WARN_PEAK * share;
  }

  private addSweeping(ward: ArchiveSweepingWard, index: number): void {
    const phaseFrames = index * SWEEP_PHASE_STEP_FRAMES;
    const position = (): number => {
      const share = ((this.clock + phaseFrames) % SWEEP_PERIOD_FRAMES) / SWEEP_PERIOD_FRAMES;
      const sweep = HALF - HALF * Math.cos(share * FULL_TURN);
      return ward.fromX + (ward.toX - ward.fromX) * sweep;
    };
    const segment: { from: { x: number; y: number }; to: { x: number; y: number } } = {
      from: { x: 0, y: ward.y0 * TILE_SIZE },
      to: { x: 0, y: (ward.y1 + 1) * TILE_SIZE },
    };
    const segments: WardSegment[] = [segment];
    let out = false;
    const live: LiveWard = {
      tiles: () => {
        if (out) return [];
        const at = position();
        const column = Math.round(at);
        if (Math.abs(at - column) > SWEEP_BITE_HALF_TILES) return [];
        const tiles: TowerTile[] = [];
        for (let y = ward.y0; y <= ward.y1; y++) tiles.push({ x: column, y });
        return tiles;
      },
      biting: () => !out,
      solid: () => false,
      handle: null,
    };
    live.handle = this.deps.senses.add('ward', {
      id: ward.stoneId,
      segments,
      hurts: true,
      pulse: () => {
        const x = (position() + HALF) * TILE_SIZE;
        segment.from.x = x;
        segment.to.x = x;
        return 1;
      },
    });
    this.wards.push(live);
    const stone: Stone = {
      ward,
      work: new MashInteraction({
        def: STONE_DEF,
        footprint: { x: ward.stone.x, y: ward.stone.y, w: 1, h: 1 },
        onPress: (press) => this.onStonePress(stone, press),
      }),
      putOut: () => {
        out = true;
        live.handle?.remove();
        live.handle = null;
      },
      found: false,
    };
    this.stones.push(stone);
  }

  private onStonePress(stone: Stone, press: MashPress): void {
    const at = tileCentrePx(stone.ward.stone);
    switch (press.kind) {
      case 'advanced':
        this.play('wardStoneBreak', at);
        return;
      case 'finished':
        this.play('wardStoneBreak', at);
        this.deps.map.setPlacedInteriorPropVariant(stone.ward.stoneId, WARD_STONE_VARIANT.broken);
        stone.putOut();
        this.moment({ kind: 'ward_stone_broken', stoneId: stone.ward.stoneId });
        return;
      default: {
        const unhandled: never = press;
        throw new Error(`unhandled stone press ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Bars or opens each fixed ward's tiles as its state changes, never shutting one on a crawler standing in it. */
  private settleBars(): void {
    const crawlerTiles = this.deps.presentCrawlers().map((crawler) => tileOfBody(crawler));
    for (const ward of this.wards) {
      const solid = ward.solid();
      for (const tile of ward.tiles()) {
        const key = `${tile.x},${tile.y}`;
        const barred = this.barred.has(key);
        if (solid && !barred) {
          if (crawlerTiles.some((at) => sameTile(at, tile))) continue;
          this.deps.map.blockTilePermanently(tile.x, tile.y);
          this.barred.add(key);
        } else if (!solid && barred) {
          this.deps.map.unblockTilePermanently(tile.x, tile.y);
          this.barred.delete(key);
        }
      }
    }
  }

  /** Bites a crawler standing in a ward that bites now, and remembers where it last stood clear. */
  private watchFeet(crawler: Crawler): void {
    const cooldown = this.biteCooldown.get(crawler) ?? 0;
    if (cooldown > 0) this.biteCooldown.set(crawler, cooldown - 1);
    const feet = tileOfBody(crawler);
    const biting = this.wards.some(
      (ward) => ward.biting() && ward.tiles().some((tile) => sameTile(tile, feet)),
    );
    const inAnyWard = this.wards.some((ward) => ward.tiles().some((tile) => sameTile(tile, feet)));
    if (!inAnyWard) {
      this.lastSafe.set(crawler, feet);
      return;
    }
    if (!biting || cooldown > 0 || !crawler.isAlive) return;
    crawler.takeDamage(WARD_DAMAGE, WARD_DAMAGE_SOURCE);
    this.play('wardZap', tileCentrePx(feet));
    this.biteCooldown.set(crawler, WARD_BITE_COOLDOWN_FRAMES);
    const back = this.lastSafe.get(crawler);
    if (back === undefined) return;
    const origin = tileOriginPx(back);
    crawler.x = origin.x;
    crawler.y = origin.y;
  }

  /** Belle standing by a stone finds which ward it feeds, and marks it for the human. */
  private findStones(cat: CatPlayer, catHere: boolean): void {
    if (!catHere) return;
    const centre = tileCentrePx(tileOfBody(cat));
    for (const stone of this.stones) {
      if (stone.found || stone.work.isFinished) continue;
      const at = tileCentrePx(stone.ward.stone);
      if (Math.hypot(at.x - centre.x, at.y - centre.y) > STONE_FIND_TILES * TILE_SIZE) continue;
      stone.found = true;
    }
  }

  // ── Wardens ────────────────────────────────────────────────────────────────

  private raiseWarden(round: readonly TowerTile[]): Warden {
    const start = tileOriginPx(round[0]);
    return {
      round,
      x: start.x,
      y: start.y,
      facingX: 1,
      facingY: 0,
      next: 1 % round.length,
      suspicion: 0,
      errand: null,
      floatFrames: 0,
    };
  }

  private resetWardens(): void {
    for (let index = 0; index < this.wardens.length; index++) {
      this.wardens[index] = this.raiseWarden(this.wardens[index].round);
    }
  }

  /** The bell is rung: each warden turns to it and goes, or if already at the hatch, peers on. */
  private answerBell(): void {
    for (const warden of this.wardens) {
      const errand = warden.errand;
      if (errand === null) {
        warden.errand = { kind: 'hearing', frames: WARDEN_HEARING_FRAMES, thenLeg: 0 };
        continue;
      }
      switch (errand.kind) {
        case 'hearing':
        case 'going':
          continue;
        case 'peering':
          errand.frames = WARDEN_PEER_FRAMES;
          continue;
        case 'returning':
          warden.errand = {
            kind: 'hearing',
            frames: WARDEN_HEARING_FRAMES,
            thenLeg: Math.min(errand.leg + 1, LAST_BELL_LEG),
          };
          continue;
        default: {
          const unhandled: never = errand;
          throw new Error(`unhandled warden errand ${JSON.stringify(unhandled)}`);
        }
      }
    }
  }

  private moveWardens(crawlers: readonly Player[], companions: readonly Player[]): void {
    for (const warden of this.wardens) {
      warden.floatFrames++;
      if (warden.errand === null) this.keepRound(warden);
      else this.runErrand(warden, warden.errand);
      const sighting = {
        crawler: this.wardenSeesAny(warden, crawlers),
        companion: this.wardenSeesAny(warden, companions),
      };
      warden.suspicion = stepSuspicion(warden.suspicion, 'cone', sighting, WARDEN_NOTICE);
      if (warden.suspicion >= SUSPICION_CAPTURE) {
        this.capture.begin();
        this.moment({ kind: 'archive_caught' });
        return;
      }
    }
  }

  private keepRound(warden: Warden): void {
    if (this.driftToward(warden, warden.round[warden.next], WARDEN_SPEED)) {
      warden.next = (warden.next + 1) % warden.round.length;
    }
  }

  private runErrand(warden: Warden, errand: WardenErrand): void {
    switch (errand.kind) {
      case 'hearing':
        this.turnToward(warden, tileCentrePx(TOWER_DUMBWAITER.head.bell));
        errand.frames--;
        if (errand.frames <= 0) warden.errand = { kind: 'going', leg: errand.thenLeg };
        return;
      case 'going':
        if (!this.driftToward(warden, ARCHIVE_WARDEN_BELL_PATH[errand.leg], WARDEN_ANSWER_SPEED))
          return;
        if (errand.leg < LAST_BELL_LEG) {
          errand.leg++;
          return;
        }
        warden.errand = { kind: 'peering', frames: WARDEN_PEER_FRAMES };
        this.moment({ kind: 'archive_bell_answered' });
        return;
      case 'peering':
        this.turnToward(warden, tileCentrePx(TOWER_DUMBWAITER.head.hatch));
        errand.frames--;
        if (errand.frames <= 0) warden.errand = { kind: 'returning', leg: LAST_BELL_LEG - 1 };
        return;
      case 'returning':
        if (!this.driftToward(warden, ARCHIVE_WARDEN_BELL_PATH[errand.leg], WARDEN_SPEED)) return;
        if (errand.leg > 0) {
          errand.leg--;
          return;
        }
        warden.errand = null;
        warden.next = this.roundCornerAfter(warden, ARCHIVE_WARDEN_BELL_PATH[0]);
        return;
      default: {
        const unhandled: never = errand;
        throw new Error(`unhandled warden errand ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Drifts a warden toward `tile`, facing the way it goes. Returns whether it has arrived. */
  private driftToward(warden: Warden, tile: TowerTile, speed: number): boolean {
    const target = tileOriginPx(tile);
    const dx = target.x - warden.x;
    const dy = target.y - warden.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= WARDEN_ARRIVE_PX) return true;
    const step = Math.min(speed, distance);
    warden.x += (dx / distance) * step;
    warden.y += (dy / distance) * step;
    warden.facingX = dx / distance;
    warden.facingY = dy / distance;
    return false;
  }

  /** Turns a warden's look a little toward world pixel `at`, as a head turns to a sound. */
  private turnToward(warden: Warden, at: { readonly x: number; readonly y: number }): void {
    const toward = Math.atan2(
      at.y - (warden.y + TILE_SIZE * HALF),
      at.x - (warden.x + TILE_SIZE * HALF),
    );
    const facing = Math.atan2(warden.facingY, warden.facingX);
    const off = Math.atan2(Math.sin(toward - facing), Math.cos(toward - facing));
    const turn = Math.max(
      -WARDEN_TURN_RADIANS_PER_FRAME,
      Math.min(WARDEN_TURN_RADIANS_PER_FRAME, off),
    );
    warden.facingX = Math.cos(facing + turn);
    warden.facingY = Math.sin(facing + turn);
  }

  /** The index of the corner of a warden's round after `corner`, so its round picks up from there. */
  private roundCornerAfter(warden: Warden, corner: TowerTile): number {
    const at = warden.round.findIndex((tile) => sameTile(tile, corner));
    return (Math.max(at, 0) + 1) % warden.round.length;
  }

  private wardenSeesAny(warden: Warden, bodies: readonly Player[]): number {
    return bodies.some((body) => this.wardenSees(warden, body)) ? WARDEN_SIGHTING_WEIGHT : 0;
  }

  private wardenSees(warden: Warden, crawler: Player): boolean {
    if (!crawler.isAlive) return false;
    const dx = crawler.x - warden.x;
    const dy = crawler.y - warden.y;
    const distance = Math.hypot(dx, dy);
    if (distance > WARDEN_SIGHT_TILES * TILE_SIZE) return false;
    const facing = Math.atan2(warden.facingY, warden.facingX);
    const toward = Math.atan2(dy, dx);
    const off = Math.abs(Math.atan2(Math.sin(toward - facing), Math.cos(toward - facing)));
    if (off > WARDEN_SIGHT_HALF_ANGLE) return false;
    const steps = Math.ceil(distance / (TILE_SIZE * SIGHT_STEP_TILES));
    for (let step = 1; step < steps; step++) {
      const share = step / steps;
      const at = tileOfBody({ x: warden.x + dx * share, y: warden.y + dy * share });
      if (this.deps.map.blocksSight(at.x, at.y)) return false;
    }
    return true;
  }

  private stepCapture(): void {
    const step = this.capture.step();
    switch (step.kind) {
      case 'none':
        return;
      case 'reset': {
        const stair = towerStoreyPlan('archive').stairUp;
        if (stair !== null) this.deps.setPartyDown({ x: stair.x, y: stair.y + TOWER_STAIR_SPAN });
        this.resetWardens();
        return;
      }
      case 'returning':
        this.deps.toast(CAPTURE_TOAST);
        return;
      default: {
        const unhandled: never = step;
        throw new Error(`unhandled capture step ${JSON.stringify(unhandled)}`);
      }
    }
  }
}
