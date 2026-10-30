/**
 * The pipe board as the player watches it: turns that spin into place, water
 * that floods out from the main one tile at a time, pipes that drain when
 * they are cut off, leaks that build up and puddle, fixtures that fill, and
 * the solved board's surge, flushes and banner.
 *
 * It observes the board rather than driving it. Whoever owns the board turns
 * tiles however it likes (a tap, a key, a solver replaying the answer, a
 * restart); each `sync` compares the rotations with the last ones it saw and
 * animates the difference. The water is re-traced only once every turning
 * tile has settled, so the flood always starts from where the pipes now
 * point.
 */

import {
  PIPE_DIRECTIONS,
  SIDE_BIT,
  cellCoord,
  currentMask,
  fixtureCell,
  traceFlow,
  type PipeBoard,
  type PipeFlowTrace,
} from '../../systems/cloggedBathroom/pipeBoard';
import type { BathroomCue } from '../../audio/bathroomSoundCues';
import {
  GAUGE_RED_SHARE,
  type PipeBoardPicture,
  type PipeCellPicture,
  type PipeFixturePicture,
  type PipePuddlePicture,
} from './pipeBoardPainter';

/** How long water takes to cross one tile as it floods out from the main. */
export const FLOW_STEP_MS = 70;
/** How long one quarter turn takes to play. Turns made faster than this queue up. */
export const TURN_ANIM_MS = 150;
/** How long a cut-off pipe takes to empty. */
export const DRAIN_MS = 420;
const SPRAY_RAMP_MS = 260;
const PUDDLE_GROW_MS = 1800;
const PUDDLE_DRY_MS = 900;
const FIXTURE_FILL_MS = 380;
const FIXTURE_PULSE_MS = 600;
const SHAKE_MS = 320;
const GAUGE_EASE_MS = 260;
/** The needle never quite reaches the green until the board is solved. */
const GAUGE_RED_HEADROOM = 0.97;
/** Where the needle rests once solved: the middle of the green. */
const GAUGE_SOLVED = (GAUGE_RED_SHARE + 1) / 2;

/** The solved board's moment, from the instant the water settles. */
export const WIN_SURGE_MS = 900;
const SURGE_WIDTH = 2.2;
const FLUSH_START_MS = 700;
const FLUSH_STAGGER_MS = 240;
const FLUSH_MS = 650;
const GAUGE_SWING_AT_MS = 500;
const GAUGE_SWING_MS = 700;
/** When the "PLUMBING FIXED!" banner comes in. */
export const WIN_BANNER_AT_MS = 1700;
export const WIN_BANNER_IN_MS = 300;
/** The whole moment; input stays locked until it ends. */
export const WIN_MOMENT_MS = 2500;
/**
 * The longest the moment waits for the last water to land after the solve.
 * Input locks at the solving turn, so a long re-flood must not stretch the
 * locked span much past the moment itself.
 */
const WIN_SETTLE_MAX_MS = 300;
const PUDDLE_EVAPORATE_MS = 1500;

const SIDE_COUNT = 4;
const HALF_TURN_SIDES = 2;
const WEST_BIT = SIDE_BIT.west;
const STEP_X: readonly number[] = [0, 1, 0, -1];
const STEP_Y: readonly number[] = [-1, 0, 1, 0];

interface CellFlow {
  /** When water reaches the tile's inflow end; null while dry. */
  arrivedAt: number | null;
  /** When the tile began to drain, and how full it was then. */
  drainFrom: number | null;
  drainLevel: number;
}

interface PuddleState {
  readonly cell: number;
  readonly side: number;
  readonly startedAt: number;
  endedAt: number | null;
  sizeAtEnd: number;
}

interface FixtureState {
  fullAt: number | null;
  announced: boolean;
}

/** Where the win moment is, for the surface's banner and footer. */
export interface PipeWinMoment {
  /** 0..1 through the banner's arrival; 0 before it. */
  readonly banner: number;
  /** The moment has finished and the board can be left. */
  readonly done: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function flowLevel(flow: CellFlow, now: number): number {
  if (flow.arrivedAt !== null) return clamp01((now - flow.arrivedAt) / FLOW_STEP_MS);
  if (flow.drainFrom === null) return 0;
  return Math.max(0, flow.drainLevel - (now - flow.drainFrom) / DRAIN_MS);
}

function puddleKey(cell: number, side: number): string {
  return `${cell}:${side}`;
}

export class PipeBoardView {
  private readonly seen: number[];
  private readonly spin: number[];
  private readonly flows: CellFlow[];
  private readonly shakeAt: (number | null)[];
  private readonly puddles = new Map<string, PuddleState>();
  private readonly fixtureStates: FixtureState[];
  /** The trace the water on screen was drawn from. */
  private display: PipeFlowTrace;
  private retracePending = false;
  private lastNow: number;
  private gaugeValue: number;
  private solvedSeenAt: number | null = null;
  private solvedAnnounced = false;
  private winStartAt: number | null = null;
  private readonly firedWinCues = new Set<string>();
  /** Fixtures in the order they flush: left to right across the panel, then top to bottom. */
  private readonly flushOrder: readonly number[];

  constructor(
    readonly board: PipeBoard,
    now: number,
    solved: boolean,
    private readonly emit: (cue: BathroomCue) => void,
  ) {
    const count = board.tiles.length;
    this.seen = [...board.rotations];
    this.spin = new Array<number>(count).fill(0);
    this.shakeAt = new Array<number | null>(count).fill(null);
    this.display = traceFlow(board);
    this.lastNow = now;
    this.flows = this.display.distance.map((steps) => ({
      arrivedAt: steps >= 0 ? Number.NEGATIVE_INFINITY : null,
      drainFrom: null,
      drainLevel: 0,
    }));
    this.fixtureStates = this.display.fixturesFull.map((full) => ({
      fullAt: full ? Number.NEGATIVE_INFINITY : null,
      announced: true,
    }));
    for (const leak of this.display.leaks) {
      const side = SIDE_BIT[leak.direction];
      this.puddles.set(puddleKey(leak.cell, side), {
        cell: leak.cell,
        side,
        startedAt: Number.NEGATIVE_INFINITY,
        endedAt: null,
        sizeAtEnd: 0,
      });
    }
    const solvedNow = solved || this.display.won;
    if (solvedNow) {
      this.solvedSeenAt = Number.NEGATIVE_INFINITY;
      this.solvedAnnounced = solved;
      this.winStartAt = Number.NEGATIVE_INFINITY;
    }
    this.gaugeValue = this.gaugeTarget(now);
    this.flushOrder = board.fixtures
      .map((fixture, index) => ({
        index,
        at: fixtureCell(board.size, fixture),
        edge: fixture.edge,
      }))
      .sort((a, b) => {
        const ax = a.edge === 'right' ? board.size : a.at.x;
        const bx = b.edge === 'right' ? board.size : b.at.x;
        return ax - bx || a.at.y - b.at.y;
      })
      .map((entry) => entry.index);
  }

  /** Counts and coaching read this: the water the player is watching. */
  get trace(): PipeFlowTrace {
    return this.display;
  }

  /** The board has been seen solved; input stays locked through the moment that follows. */
  get solved(): boolean {
    return this.solvedSeenAt !== null;
  }

  /** True once, the first sync after the board is seen solved; the caller reports the solve. */
  takeSolvedNotice(): boolean {
    if (this.solvedSeenAt === null || this.solvedAnnounced) return false;
    this.solvedAnnounced = true;
    return true;
  }

  /** Whether the player may turn tiles. */
  acceptsTurns(now: number): boolean {
    return !this.solved && !this.winMoment(now).done;
  }

  /** A bolted tile was tapped: shake it. */
  noteBolted(cell: number, now: number): void {
    this.shakeAt[cell] = now;
  }

  /** Reads the board, starts spins for any tile that moved, and re-traces once they settle. */
  sync(now: number): void {
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    let moved = false;
    for (let cell = 0; cell < this.board.rotations.length; cell++) {
      const rotation = this.board.rotations[cell];
      const delta = (rotation - this.seen[cell] + SIDE_COUNT) % SIDE_COUNT;
      if (delta === 0) continue;
      moved = true;
      this.seen[cell] = rotation;
      this.spin[cell] += delta === SIDE_COUNT - 1 ? 1 : -delta;
      this.startDrain(cell, now);
    }
    if (moved) {
      this.retracePending = true;
      const standing = traceFlow(this.board);
      if (standing.won && this.solvedSeenAt === null) this.solvedSeenAt = now;
    }
    const spinStep = dt / TURN_ANIM_MS;
    let spinning = false;
    for (let cell = 0; cell < this.spin.length; cell++) {
      const value = this.spin[cell];
      if (value === 0) continue;
      const next = value < 0 ? Math.min(0, value + spinStep) : Math.max(0, value - spinStep);
      this.spin[cell] = next;
      if (next !== 0) spinning = true;
    }
    if (this.retracePending && !spinning) {
      this.retracePending = false;
      this.retrace(now);
    }
    this.tickFixtures(now);
    this.tickWin(now);
    const ease = Math.min(1, dt / GAUGE_EASE_MS);
    this.gaugeValue += (this.gaugeTarget(now) - this.gaugeValue) * ease;
  }

  private startDrain(cell: number, now: number): void {
    const flow = this.flows[cell];
    const level = flowLevel(flow, now);
    flow.arrivedAt = null;
    flow.drainFrom = level > 0 ? now : null;
    flow.drainLevel = level;
  }

  private retrace(now: number): void {
    const before = this.display;
    const after = traceFlow(this.board);
    this.display = after;
    const newlyWet: number[] = [];
    let newlyDry = 0;
    after.distance.forEach((steps, cell) => {
      const flow = this.flows[cell];
      const wasWet = flow.arrivedAt !== null;
      if (steps >= 0 && !wasWet) newlyWet.push(cell);
      if (steps < 0 && wasWet) {
        this.startDrain(cell, now);
        newlyDry++;
      }
    });
    const base = Math.min(...newlyWet.map((cell) => after.distance[cell]));
    for (const cell of newlyWet) {
      const flow = this.flows[cell];
      flow.arrivedAt = now + (after.distance[cell] - base) * FLOW_STEP_MS;
      flow.drainFrom = null;
    }
    if (newlyWet.length > 0) this.emit('waterRush');
    if (newlyDry > 0) this.emit('pipeDrain');
    this.retraceLeaks(now);
    if (after.counts.leaks > before.counts.leaks) this.emit('leakSprayLoop');
    after.fixturesFull.forEach((full, index) => {
      const state = this.fixtureStates[index];
      if (full && state.fullAt === null) {
        const cell = this.fixtureCellIndex(index);
        state.fullAt = (this.flows[cell].arrivedAt ?? now) + FLOW_STEP_MS;
        state.announced = false;
      } else if (!full) {
        state.fullAt = null;
      }
    });
    if (after.won && this.winStartAt === null) {
      const settled = Math.max(
        now,
        ...this.flows.map((flow) => (flow.arrivedAt ?? now) + FLOW_STEP_MS),
      );
      this.solvedSeenAt ??= now;
      const solvedAt = Number.isFinite(this.solvedSeenAt) ? this.solvedSeenAt : now;
      this.winStartAt = Math.min(settled, solvedAt + WIN_SETTLE_MAX_MS);
    }
  }

  private retraceLeaks(now: number): void {
    const live = new Set<string>();
    for (const leak of this.display.leaks) {
      const side = SIDE_BIT[leak.direction];
      const key = puddleKey(leak.cell, side);
      live.add(key);
      const existing = this.puddles.get(key);
      if (existing?.endedAt === null) continue;
      const arrived = this.flows[leak.cell].arrivedAt ?? now;
      this.puddles.set(key, {
        cell: leak.cell,
        side,
        startedAt: arrived + FLOW_STEP_MS,
        endedAt: null,
        sizeAtEnd: 0,
      });
    }
    for (const [key, puddle] of this.puddles) {
      if (live.has(key) || puddle.endedAt !== null) continue;
      puddle.sizeAtEnd = this.puddleGrowth(puddle, now);
      puddle.endedAt = now;
    }
  }

  private fixtureCellIndex(index: number): number {
    const { x, y } = fixtureCell(this.board.size, this.board.fixtures[index]);
    return y * this.board.size + x;
  }

  private tickFixtures(now: number): void {
    for (const state of this.fixtureStates) {
      if (this.solvedSeenAt !== null) {
        state.announced = true;
        continue;
      }
      if (state.announced || state.fullAt === null) continue;
      if (now >= state.fullAt + FIXTURE_FILL_MS) {
        state.announced = true;
        this.emit('fixtureFill');
      }
    }
  }

  private fireOnce(key: string, at: number, now: number, cue: BathroomCue): void {
    if (now < at || this.firedWinCues.has(key)) return;
    this.firedWinCues.add(key);
    this.emit(cue);
  }

  private tickWin(now: number): void {
    const start = this.winStartAt;
    if (start === null || !Number.isFinite(start)) return;
    this.fireOnce('surge', start, now, 'surge');
    this.flushOrder.forEach((fixture, order) => {
      this.fireOnce(
        `flush${fixture}`,
        start + FLUSH_START_MS + order * FLUSH_STAGGER_MS,
        now,
        'flush',
      );
    });
    this.fireOnce('solved', start + WIN_BANNER_AT_MS, now, 'boardSolved');
  }

  private gaugeTarget(now: number): number {
    const { fixturesFull, fixturesTotal } = this.display.counts;
    const share = fixturesFull / Math.max(1, fixturesTotal);
    const resting = share * GAUGE_RED_SHARE * GAUGE_RED_HEADROOM;
    const start = this.winStartAt;
    if (start === null) return resting;
    const swing = clamp01((now - start - GAUGE_SWING_AT_MS) / GAUGE_SWING_MS);
    return resting + (GAUGE_SOLVED - resting) * swing;
  }

  winMoment(now: number): PipeWinMoment {
    const start = this.winStartAt;
    if (start === null) return { banner: 0, done: false };
    const elapsed = now - start;
    return {
      banner: clamp01((elapsed - WIN_BANNER_AT_MS) / WIN_BANNER_IN_MS),
      done: elapsed >= WIN_MOMENT_MS,
    };
  }

  private puddleGrowth(puddle: PuddleState, now: number): number {
    return clamp01((now - puddle.startedAt) / PUDDLE_GROW_MS);
  }

  private puddleSize(puddle: PuddleState, now: number): number {
    const grown =
      puddle.endedAt === null
        ? this.puddleGrowth(puddle, now)
        : Math.max(0, puddle.sizeAtEnd - (now - puddle.endedAt) / PUDDLE_DRY_MS);
    const start = this.winStartAt;
    if (start === null) return grown;
    return grown * (1 - clamp01((now - start) / PUDDLE_EVAPORATE_MS));
  }

  /** The sides water enters a wet tile by: towards a nearer wet neighbour that connects back. */
  private inflowOf(cell: number, mask: number): number {
    const steps = this.display.distance[cell];
    if (steps < 0) return 0;
    const { size } = this.board;
    const { x, y } = cellCoord(size, cell);
    let inflow = 0;
    if (x === 0 && y === this.board.inletRow && (mask & WEST_BIT) !== 0 && steps === 0) {
      inflow |= WEST_BIT;
    }
    PIPE_DIRECTIONS.forEach((direction, side) => {
      const bit = SIDE_BIT[direction];
      if ((mask & bit) === 0) return;
      const nx = x + STEP_X[side];
      const ny = y + STEP_Y[side];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) return;
      const neighbour = ny * size + nx;
      const facing = SIDE_BIT[PIPE_DIRECTIONS[(side + HALF_TURN_SIDES) % SIDE_COUNT]];
      const connects = (currentMask(this.board, neighbour) & facing) !== 0;
      const nearer =
        this.display.distance[neighbour] >= 0 && this.display.distance[neighbour] < steps;
      if (connects && nearer) inflow |= bit;
    });
    return inflow;
  }

  private surgeAt(steps: number, now: number): number {
    const start = this.winStartAt;
    if (start === null || !Number.isFinite(start) || steps < 0) return 0;
    const progress = (now - start) / WIN_SURGE_MS;
    if (progress < 0 || progress > 1) return 0;
    const front = progress * (this.display.maxDistance + SURGE_WIDTH * 2) - SURGE_WIDTH;
    return clamp01(1 - Math.abs(steps - front) / SURGE_WIDTH);
  }

  private leakMasks(): number[] {
    const masks = new Array<number>(this.board.tiles.length).fill(0);
    for (const leak of this.display.leaks) masks[leak.cell] |= SIDE_BIT[leak.direction];
    return masks;
  }

  /** One frame's picture of the board. */
  picture(now: number): PipeBoardPicture {
    const leakMasks = this.leakMasks();
    const cells = this.board.tiles.map((tile, cell): PipeCellPicture => {
      const flow = this.flows[cell];
      const mask = currentMask(this.board, cell);
      const steps = this.display.distance[cell];
      const spinning = this.spin[cell] !== 0;
      const leaks = spinning ? 0 : leakMasks[cell];
      const leakStart = (flow.arrivedAt ?? now) + FLOW_STEP_MS;
      const shakeAt = this.shakeAt[cell];
      return {
        kind: tile.kind,
        mask,
        spin: this.spin[cell],
        bolted: tile.bolted,
        water: flowLevel(flow, now),
        draining: flow.arrivedAt === null,
        inflow: this.inflowOf(cell, mask),
        distance: Math.max(0, steps),
        leaks,
        spray: leaks === 0 ? 0 : clamp01((now - leakStart) / SPRAY_RAMP_MS),
        shake: shakeAt === null ? 0 : clamp01(1 - (now - shakeAt) / SHAKE_MS),
        surge: this.surgeAt(steps, now),
      };
    });
    const start = this.winStartAt;
    const fixtures = this.board.fixtures.map((fixture, index): PipeFixturePicture => {
      const state = this.fixtureStates[index];
      const fullAt = state.fullAt;
      const full = fullAt === null ? 0 : clamp01((now - fullAt) / FIXTURE_FILL_MS);
      const fillPulse = fullAt === null ? 0 : (now - fullAt - FIXTURE_FILL_MS) / FIXTURE_PULSE_MS;
      const order = this.flushOrder.indexOf(index);
      const flushPulse =
        start === null || !Number.isFinite(start)
          ? -1
          : (now - start - FLUSH_START_MS - order * FLUSH_STAGGER_MS) / FLUSH_MS;
      const pulse = [fillPulse, flushPulse].find((value) => value > 0 && value < 1) ?? 0;
      return { fixture, full, pulse };
    });
    const puddles: PipePuddlePicture[] = [];
    for (const puddle of this.puddles.values()) {
      const size = this.puddleSize(puddle, now);
      if (size > 0) puddles.push({ cell: puddle.cell, side: puddle.side, size });
    }
    return {
      cols: this.board.size,
      rows: this.board.size,
      inletRow: this.board.inletRow,
      cells,
      fixtures,
      puddles,
      gauge: this.gaugeValue,
      mainSurge: this.surgeAt(0, now),
      timeMs: now,
    };
  }
}
