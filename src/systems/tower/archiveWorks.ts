/**
 * The warded archive. Its ward lines are registered into the storey's sense
 * layer, where the cat sees each at full strength and its rhythm, and the
 * human sees only a faint steady warning over the same ground; how they
 * stand follows the questline:
 *
 * - **Solid**, before the conduit is shut: every ward bars its tiles to
 *   everyone. Belle coming down from the cattery finds the east room sealed.
 * - **Pulsing**, once it is shut: the doorway's ward burns on a rhythm and
 *   bites whoever is in it while it burns; the west ward goes dark while its
 *   plate is held; the north door's ward stays solid.
 * - **Sweeping**, once the Warden knows the party is inside: each ward sweeps
 *   back and forth across its band, fed by a standing stone. Only Belle can
 *   find which stone feeds a ward — standing by it marks it — and only the
 *   human can break a marked stone, which puts its ward out.
 * - **Spent**, once the Warden is gone: nothing.
 *
 * A ward that bites does a little damage and puts the crawler back on the
 * last tile it stood on outside every ward.
 *
 * Before the Warden knows, krasue wardens drift on their rounds. They do not
 * fight; one that sees a crawler for long enough has the party caught and
 * set back at the cattery stair's landing, as the gatehouse's guards do. A
 * warden that hears a noise within its reach (a jar knocked off a shelf top)
 * drifts to the edge of its round nearest the noise and stares that way for
 * a while. Once the Warden knows, the krasue come to fight.
 */

import { TILE_SIZE } from '../../core/constants';
import { TOWER_STAIR_SPAN } from '../../map/tileTypes';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import {
  ARCHIVE_FIXED_WARDS,
  ARCHIVE_KRASUE_TILES,
  ARCHIVE_SWEEPING_WARDS,
  ARCHIVE_WARD_PLATE,
  ARCHIVE_WARDEN_ROUNDS,
  towerStoreyPlan,
  type ArchiveFixedWard,
  type ArchiveSweepingWard,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { Player, DamageSource } from '../../Player';
import { WARD_STONE_VARIANT } from '../../sprites/art/townInterior/rooms/towerWorks';
import { MINE_ROWS } from '../../sprites/art/humanFigure';
import { drawKrasueSprite } from '../../sprites/krasueSprite';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { worldPalette } from '../../ui/theme/worldInk';
import { drawSightFan } from '../../ui/world/worldSightFan';
import { drawGlyphBadge, glyphBadgeBob } from '../../ui/world/glyphBadge';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import type { WardSegment } from '../../ui/world/worldSenses';
import type { SystemContext } from '../GameSystem';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import type { SenseSourceHandle } from '../senses/SenseLayer';
import type { WorkChannelBuilder } from '../WorkChannel';
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
/** How bright a pulsing ward glows between burns, as a share of full. */
const PULSE_REST = 0.12;
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
/** What a warden sees: how far, how wide either side of the way it faces, and how long it must look. */
const WARDEN_SIGHT_TILES = 3.5;
const WARDEN_SIGHT_HALF_SHARE_OF_PI = 0.3;
const WARDEN_SIGHT_HALF_ANGLE = Math.PI * WARDEN_SIGHT_HALF_SHARE_OF_PI;
const WARDEN_SEE_FRAMES = 40;
/** How long a warden stares toward a noise it heard. */
const WARDEN_INVESTIGATE_FRAMES = 420;
const WARDEN_MARKER_LIFT_TILES = 1.1;
/** Line of sight is walked in steps this long, as a share of a tile. */
const SIGHT_STEP_TILES = 0.25;

const CAPTURE_TOAST = 'A warden saw you and drove you back to the stairs.';

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const PAW_PAD_SHARE = 0.42;
const PAW_TOE_SHARE = 0.2;
const PAW_TOE_SPREAD_SHARE = 0.42;
const PAW_TOE_LIFT_SHARE = 0.55;
const PAW_TOES = 4;

/** A paw print, the badge Belle leaves over a stone she has found. */
function pawGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = worldPalette.senses.wardCore;
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

interface Warden {
  readonly round: readonly TowerTile[];
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  next: number;
  seenFrames: number;
  investigating: { readonly toward: { x: number; y: number }; frames: number } | null;
  floatPhase: number;
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
  /** Tiles each fixed ward bars this frame, so a change is a block or an unblock. */
  private readonly barred = new Set<string>();
  private readonly lastSafe = new Map<Crawler, TowerTile>();
  private readonly biteCooldown = new Map<Crawler, number>();
  private readonly capture = new CaptureFade();
  private readonly stopListening: () => void;
  private clock = 0;

  constructor(deps: StoreyWorksDeps) {
    super(deps);
    this.raiseWards();
    if (deps.conditions.wards === 'solid' || deps.conditions.wards === 'pulsing') {
      for (const round of ARCHIVE_WARDEN_ROUNDS) this.wardens.push(this.raiseWarden(round));
    }
    if (deps.conditions.wards === 'sweeping') {
      for (const tile of ARCHIVE_KRASUE_TILES) {
        const krasue = spawnMob('krasue', tile, deps.map, ARCHIVE_SPAWNS);
        applySpawnDifficulty(krasue);
        deps.addMob(krasue);
      }
    }
    this.stopListening = deps.bus.on('worldNoise', (noise) => this.hear(noise));
  }

  /** Whether the party is being caught, which holds its input. */
  get playerLocked(): boolean {
    return this.capture.active;
  }

  /** How dark the capture has the screen. */
  get fadeAlpha(): number {
    return this.capture.alpha;
  }

  enter(_ctx: SystemContext): void {
    if (this.deps.progress.phase === 'cattery') this.moment({ kind: 'cattery_exit_reached' });
  }

  leave(): void {
    if (!this.capture.active) return;
    this.capture.cancel();
    this.resetWardens();
  }

  update(ctx: SystemContext): void {
    if (this.capture.active) {
      this.stepCapture();
      return;
    }
    this.clock++;
    this.settleBars();
    const crawlers = this.deps.presentCrawlers();
    for (const crawler of [ctx.human, ctx.cat]) {
      if (!crawlers.includes(crawler)) continue;
      this.watchFeet(crawler);
    }
    this.findStones(ctx.cat, crawlers.includes(ctx.cat));
    this.moveWardens(crawlers);
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
      const hasSeenSomeone = warden.seenFrames > 0;
      drawSightFan(ctx, {
        origin: { x: warden.x + TILE_SIZE * HALF - camX, y: warden.y + TILE_SIZE * HALF - camY },
        rim: {
          kind: 'arc',
          facingRad: Math.atan2(warden.facingY, warden.facingX),
          halfAngleRad: WARDEN_SIGHT_HALF_ANGLE,
          reachPx: WARDEN_SIGHT_TILES * TILE_SIZE,
        },
        suspicion: hasSeenSomeone ? 1 : 0,
      });
    }
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const nowMs = performance.now();
    for (const warden of this.wardens) {
      drawSuspicionMarker(ctx, {
        x: warden.x + TILE_SIZE * HALF - camX,
        y: warden.y - camY - TILE_SIZE * WARDEN_MARKER_LIFT_TILES,
        suspicion: warden.seenFrames / WARDEN_SEE_FRAMES,
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
    return this.wardens.map((warden) => ({
      y: warden.y,
      render: (ctx, camX, camY, tileSize) =>
        drawKrasueSprite(
          ctx,
          warden.x - camX,
          warden.y - camY,
          tileSize,
          warden.floatPhase,
          warden.seenFrames > 0,
          warden.facingX >= 0 ? 1 : -1,
        ),
    }));
  }

  dispose(): void {
    this.stopListening();
    for (const ward of this.wards) ward.handle?.remove();
  }

  // ── Wards ──────────────────────────────────────────────────────────────────

  private raiseWards(): void {
    const state = this.deps.conditions.wards;
    switch (state) {
      case 'solid':
        for (const ward of Object.values(ARCHIVE_FIXED_WARDS)) this.addFixed(ward, () => true);
        return;
      case 'pulsing':
        this.addFixed(ARCHIVE_FIXED_WARDS.north_door, () => true);
        this.addPulsing(ARCHIVE_FIXED_WARDS.doorway);
        this.addFixed(ARCHIVE_FIXED_WARDS.west, () => !this.wardPlateHeld);
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

  private get wardPlateHeld(): boolean {
    return this.deps.mechanisms.plates.isPlateHeld(ARCHIVE_WARD_PLATE.id);
  }

  /** A ward that bars its tiles while `lit` says so, and is dark and open otherwise. */
  private addFixed(ward: ArchiveFixedWard, lit: () => boolean): void {
    const live: LiveWard = {
      tiles: () => ward.tiles,
      biting: () => false,
      solid: lit,
      handle: null,
    };
    live.handle = this.deps.senses.add('ward', {
      segments: fixedSegments(ward),
      get hurts() {
        return lit();
      },
      pulse: () => (lit() ? 1 : 0),
    });
    this.wards.push(live);
  }

  private addPulsing(ward: ArchiveFixedWard): void {
    const live: LiveWard = {
      tiles: () => ward.tiles,
      biting: () => this.pulseBurning,
      solid: () => false,
      handle: null,
    };
    live.handle = this.deps.senses.add('ward', {
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

  /** Dim at rest, brightening through the warning, full while it burns: the rhythm the cat reads. */
  private get pulseStrength(): number {
    if (this.pulseBurning) return 1;
    const warnFrom = PULSE_PERIOD_FRAMES - PULSE_BURN_FRAMES - PULSE_WARN_FRAMES;
    if (this.pulseFrame < warnFrom) return PULSE_REST;
    const share = (this.pulseFrame - warnFrom) / PULSE_WARN_FRAMES;
    return PULSE_REST + (PULSE_WARN_PEAK - PULSE_REST) * share;
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
      seenFrames: 0,
      investigating: null,
      floatPhase: 0,
    };
  }

  private resetWardens(): void {
    for (let index = 0; index < this.wardens.length; index++) {
      this.wardens[index] = this.raiseWarden(this.wardens[index].round);
    }
  }

  private hear(noise: { x: number; y: number; radiusTiles: number }): void {
    for (const warden of this.wardens) {
      const distance = Math.hypot(noise.x - warden.x, noise.y - warden.y);
      if (distance > noise.radiusTiles * TILE_SIZE) continue;
      warden.investigating = { toward: noise, frames: WARDEN_INVESTIGATE_FRAMES };
    }
  }

  private moveWardens(crawlers: readonly Player[]): void {
    for (const warden of this.wardens) {
      warden.floatPhase++;
      const target = this.wardenTarget(warden);
      const dx = target.x - warden.x;
      const dy = target.y - warden.y;
      const distance = Math.hypot(dx, dy);
      if (distance > WARDEN_ARRIVE_PX) {
        const step = Math.min(WARDEN_SPEED, distance);
        warden.x += (dx / distance) * step;
        warden.y += (dy / distance) * step;
        warden.facingX = dx / distance;
        warden.facingY = dy / distance;
      } else if (warden.investigating === null) {
        warden.next = (warden.next + 1) % warden.round.length;
      }
      const investigating = warden.investigating;
      if (investigating !== null) {
        const towardX = investigating.toward.x - warden.x;
        const towardY = investigating.toward.y - warden.y;
        const length = Math.hypot(towardX, towardY);
        if (distance <= WARDEN_ARRIVE_PX && length > 0) {
          warden.facingX = towardX / length;
          warden.facingY = towardY / length;
        }
        investigating.frames--;
        if (investigating.frames <= 0) warden.investigating = null;
      }
      const sees = crawlers.some((crawler) => this.wardenSees(warden, crawler));
      warden.seenFrames = sees ? warden.seenFrames + 1 : Math.max(0, warden.seenFrames - 1);
      if (warden.seenFrames >= WARDEN_SEE_FRAMES) {
        this.capture.begin();
        this.moment({ kind: 'archive_caught' });
        return;
      }
    }
  }

  /** Where a warden is drifting to: its round's next corner, or while it listens, its round's edge nearest the noise. */
  private wardenTarget(warden: Warden): { x: number; y: number } {
    const investigating = warden.investigating;
    if (investigating === null) return tileOriginPx(warden.round[warden.next]);
    const xs = warden.round.map((tile) => tile.x * TILE_SIZE);
    const ys = warden.round.map((tile) => tile.y * TILE_SIZE);
    return {
      x: Math.min(Math.max(investigating.toward.x, Math.min(...xs)), Math.max(...xs)),
      y: Math.min(Math.max(investigating.toward.y, Math.min(...ys)), Math.max(...ys)),
    };
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
