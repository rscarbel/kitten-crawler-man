/**
 * Builds the clogged bathroom's pipe board for one world and one difficulty.
 *
 * Each attempt grows its answer first: ports on the panel edges, then a
 * uniform random spanning tree over the cells by Wilson's algorithm (uniform,
 * so no long corridors), with the ports as extra leaves. Leaves that hold no
 * port are trimmed away until the tree keeps the tier's share of the tiles;
 * what is left is the winning network, and the trimmed tiles become decoys
 * dealt from the network's own mix of kinds, so they look like they belong.
 * The rotations are scrambled, and the acceptance contract in `pipeBoard.ts`
 * decides whether the attempt is kept. A board with a second winning network
 * is discarded, never patched.
 *
 * Every draw comes from this module's own stream, seeded from the world seed
 * and the difficulty, and never from `Math.random` or the world's stream: one
 * draw from the world's stream would reshuffle every floor generated after
 * it, and one from `Math.random` would deal a world a different board each
 * visit. The fallback is chosen by attempt count alone, never by elapsed
 * time, so a slow device lands on the same board as a fast one.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import { worldRandom } from '../../core/world/WorldRandom';
import { mixSeed, seededStream } from '../../map/starlightTent/mirrorBoard';
import { subSeed } from '../../sprites/person/rng';
import {
  assessPipeBoard,
  FOLLOW_THE_WATER_RUNS,
  followTheWaterPlayer,
  followTheWaterSeed,
  randomTurnPlayer,
  solverPlayer,
  cellIndex,
  CROSSES_MAX,
  isEdgeCell,
  longestStraightRunOfMasks,
  FIXTURE_EDGES_MIN,
  fixtureCell,
  fixtureDirection,
  inletRowRange,
  KIND_DISTINCT_ROTATIONS,
  kindOfMask,
  PIPE_BOARD_TIERS,
  PIPE_ROTATIONS,
  PORT_SPACING_MIN,
  rotationOfMask,
  scrambleProblems,
  SIDE_BIT,
  tileMask,
  type FixtureEdge,
  type FixtureKind,
  type PipeBoardAssessment,
  type PipeBoardLayout,
  type PipeBoardOptions,
  type PipeBoardTier,
  type PipeCellCoord,
  type PipeFixture,
  type PipeRotation,
  type PipeTile,
  type PipeTileKind,
} from './pipeBoard';
import { PIPE_BOARD_FALLBACKS } from './pipeBoardFallback';

/** Attempts before the bathroom settles for the tier's committed fallback board. */
export const GENERATION_ATTEMPTS_MAX = 1000;

/** Separates the pipe board's stream from every other use of the world seed. */
export const PIPE_BOARD_SALT = 0x919e5;

const DIFFICULTY_SALT: Readonly<Record<Difficulty, number>> = {
  easy: 0x6b697474,
  normal: 0x63726177,
  hard: 0x6e696768,
};

/** Shuffled fixture layouts an attempt may draw before it is given up. */
const FIXTURE_DRAWS = 32;
/** Spanning trees an attempt may draw before it is given up. */
const TREE_DRAWS = 64;
/** Scrambles an attempt may draw to meet the opening-state rules before keeping the last. */
const SCRAMBLE_DRAWS = 12;

const FIXTURE_EDGES: ReadonlyArray<FixtureEdge> = ['top', 'right', 'bottom'];
const FIXTURE_KINDS: ReadonlyArray<FixtureKind> = ['toilet', 'sink'];
const SIDE_COUNT = 4;
const HALF_TURN = 2;
const STEP_X: ReadonlyArray<number> = [0, 1, 0, -1];
const STEP_Y: ReadonlyArray<number> = [-1, 0, 1, 0];

/** The one seed a world's board for `difficulty` grows from. */
export function pipeBoardSeed(worldSeed: number, difficulty: Difficulty): number {
  return mixSeed(subSeed(worldSeed, PIPE_BOARD_SALT), DIFFICULTY_SALT[difficulty]);
}

/** Each attempt's own sub-seed, so an attempt's board never depends on the ones before it. */
export function attemptSeed(boardSeed: number, attempt: number): number {
  return mixSeed(boardSeed, attempt + 1);
}

class Draws {
  private readonly next: () => number;

  constructor(seed: number, options: PipeBoardOptions) {
    this.next =
      options.fault === 'generator-shares-world-stream' ? worldRandom : seededStream(seed);
  }

  below(count: number): number {
    return Math.floor(this.next() * count);
  }

  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const swap = this.below(index + 1);
      const held = items[index];
      items[index] = items[swap];
      items[swap] = held;
    }
    return items;
  }
}

function manhattan(a: PipeCellCoord, b: PipeCellCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const EDGE_ORDER: Readonly<Record<FixtureEdge, number>> = { top: 0, right: 1, bottom: 2 };

function drawFixtures(draws: Draws, size: number, inletRow: number, count: number) {
  const slots = FIXTURE_EDGES.flatMap((edge) =>
    Array.from({ length: size }, (_, index) => ({ edge, index })),
  );
  for (let draw = 0; draw < FIXTURE_DRAWS; draw++) {
    const ports: PipeCellCoord[] = [{ x: 0, y: inletRow }];
    const chosen: Array<{ edge: FixtureEdge; index: number }> = [];
    for (const slot of draws.shuffle([...slots])) {
      if (chosen.length === count) break;
      const at = fixtureCell(size, { ...slot, kind: 'toilet' });
      if (ports.some((port) => manhattan(port, at) < PORT_SPACING_MIN)) continue;
      ports.push(at);
      chosen.push(slot);
    }
    const edges = new Set(chosen.map((slot) => slot.edge));
    if (chosen.length === count && edges.size >= FIXTURE_EDGES_MIN) return chosen;
  }
  return null;
}

/** At least one toilet and one sink when there is room for both, the rest drawn. */
function assignFixtureKinds(
  draws: Draws,
  slots: ReadonlyArray<{ edge: FixtureEdge; index: number }>,
): PipeFixture[] {
  const order = draws.shuffle(slots.map((_, index) => index));
  const kinds: FixtureKind[] = slots.map(() => FIXTURE_KINDS[draws.below(FIXTURE_KINDS.length)]);
  FIXTURE_KINDS.forEach((kind, position) => {
    if (position < order.length) kinds[order[position]] = kind;
  });
  return slots
    .map((slot, index) => ({ edge: slot.edge, index: slot.index, kind: kinds[index] }))
    .sort((a, b) => EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge] || a.index - b.index);
}

/** Each cell's on-board neighbours, packed: slot `cell * 4 + n` for n below `stepCount[cell]`. */
interface GridSteps {
  readonly next: Int16Array;
  readonly side: Uint8Array;
  readonly stepCount: Uint8Array;
}

const gridStepsBySize = new Map<number, GridSteps>();

function gridSteps(size: number): GridSteps {
  const cached = gridStepsBySize.get(size);
  if (cached !== undefined) return cached;
  const count = size * size;
  const next = new Int16Array(count * SIDE_COUNT);
  const side = new Uint8Array(count * SIDE_COUNT);
  const stepCount = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) {
    for (let direction = 0; direction < SIDE_COUNT; direction++) {
      const x = (cell % size) + STEP_X[direction];
      const y = Math.floor(cell / size) + STEP_Y[direction];
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const slot = cell * SIDE_COUNT + stepCount[cell];
      next[slot] = cellIndex(size, x, y);
      side[slot] = direction;
      stepCount[cell]++;
    }
  }
  const steps = { next, side, stepCount };
  gridStepsBySize.set(size, steps);
  return steps;
}

/** A uniform random spanning tree over the grid, as each cell's connection mask. */
function wilsonTree(draws: Draws, size: number): Uint8Array {
  const count = size * size;
  const { next, side, stepCount } = gridSteps(size);
  const masks = new Uint8Array(count);
  const inTree = new Uint8Array(count);
  const exitSlot = new Int16Array(count);
  inTree[draws.below(count)] = 1;
  for (let start = 0; start < count; start++) {
    let walker = start;
    while (inTree[walker] === 0) {
      const slot = walker * SIDE_COUNT + draws.below(stepCount[walker]);
      exitSlot[walker] = slot;
      walker = next[slot];
    }
    walker = start;
    while (inTree[walker] === 0) {
      inTree[walker] = 1;
      const slot = exitSlot[walker];
      const direction = side[slot];
      const onward = next[slot];
      masks[walker] |= 1 << direction;
      masks[onward] |= 1 << ((direction + HALF_TURN) % SIDE_COUNT);
      walker = onward;
    }
  }
  return masks;
}

/**
 * Trims a spanning tree down to the network that joins the main to every
 * fixture: random leaves that hold no port are cut, one at a time, until the
 * network keeps `share` of the tiles or every leaf left holds a port. Cut
 * tiles become 0, to be dealt decoys.
 */
function pruneToNetwork(
  draws: Draws,
  masks: Uint8Array,
  size: number,
  inletRow: number,
  fixtures: ReadonlyArray<PipeFixture>,
  share: number,
): void {
  const { next, side, stepCount } = gridSteps(size);
  const count = size * size;
  const terminal = new Uint8Array(count);
  terminal[cellIndex(size, 0, inletRow)] = 1;
  for (const fixture of fixtures) {
    const { x, y } = fixtureCell(size, fixture);
    terminal[cellIndex(size, x, y)] = 1;
  }
  const target = Math.round(share * count);
  let kept = count;
  while (kept > target) {
    const leaves: number[] = [];
    for (let cell = 0; cell < count; cell++) {
      if (terminal[cell] === 0 && popcount(masks[cell]) === 1) leaves.push(cell);
    }
    if (leaves.length === 0) return;
    const leaf = leaves[draws.below(leaves.length)];
    for (let slot = leaf * SIDE_COUNT; slot < leaf * SIDE_COUNT + stepCount[leaf]; slot++) {
      if ((masks[leaf] & (1 << side[slot])) === 0) continue;
      masks[next[slot]] &= ~(1 << ((side[slot] + HALF_TURN) % SIDE_COUNT));
    }
    masks[leaf] = 0;
    kept--;
  }
}

function popcount(mask: number): number {
  let total = 0;
  for (let bit = 0; bit < SIDE_COUNT; bit++) total += (mask >> bit) & 1;
  return total;
}

/** At most one cross and none on the rim, no long straight runs, enough tees. */
function treeFits(masks: Uint8Array, tier: PipeBoardTier): boolean {
  let crosses = 0;
  let tees = 0;
  for (let cell = 0; cell < masks.length; cell++) {
    const kind = kindOfMask(masks[cell]);
    if (kind === 'tee') tees++;
    if (kind !== 'cross') continue;
    crosses++;
    if (isEdgeCell(tier.size, cell)) return false;
  }
  return (
    crosses <= CROSSES_MAX &&
    tees >= tier.minTees &&
    longestStraightRunOfMasks(tier.size, masks) <= tier.maxStraightRun
  );
}

function distinctRotations(tile: { readonly kind: PipeTile['kind'] }): ReadonlyArray<PipeRotation> {
  return PIPE_ROTATIONS.slice(0, KIND_DISTINCT_ROTATIONS[tile.kind]);
}

function scrambleRotation(
  draws: Draws,
  kind: PipeTile['kind'],
  answerMask: number,
  options: PipeBoardOptions,
): PipeRotation {
  const all = distinctRotations({ kind });
  const keepsAnswers = options.fault === 'scramble-keeps-answers';
  const wrong = keepsAnswers
    ? all
    : all.filter((rotation) => tileMask(kind, rotation) !== answerMask);
  return wrong.length === 0 ? rotationOfMask(kind, answerMask) : wrong[draws.below(wrong.length)];
}

/** The answer half of an attempt: ports, tree, kinds and bolts, every tile on its answer. */
function buildAnswerLayout(
  draws: Draws,
  tier: PipeBoardTier,
): { readonly layout: PipeBoardLayout | null; readonly failure: string | null } {
  const { size } = tier;
  const band = inletRowRange(size);
  const inletRow = band.min + draws.below(band.max - band.min + 1);
  const slots = drawFixtures(draws, size, inletRow, tier.fixtures);
  if (slots === null) return { layout: null, failure: 'no fixture layout fits' };
  const fixtures = assignFixtureKinds(draws, slots);

  let masks: Uint8Array | null = null;
  for (let draw = 0; draw < TREE_DRAWS && masks === null; draw++) {
    const tree = wilsonTree(draws, size);
    tree[cellIndex(size, 0, inletRow)] |= SIDE_BIT.west;
    for (const fixture of fixtures) {
      const { x, y } = fixtureCell(size, fixture);
      tree[cellIndex(size, x, y)] |= SIDE_BIT[fixtureDirection(fixture)];
    }
    pruneToNetwork(draws, tree, size, inletRow, fixtures, tier.networkShare);
    if (treeFits(tree, tier)) masks = tree;
  }
  if (masks === null) return { layout: null, failure: 'no tree fits the tier' };

  const networkKinds: PipeTileKind[] = [];
  for (const mask of masks) {
    const kind = kindOfMask(mask);
    if (kind !== null && kind !== 'cross') networkKinds.push(kind);
  }
  const tiles: PipeTile[] = [];
  for (const mask of masks) {
    const kind = kindOfMask(mask);
    if (kind === null) {
      const decoyKind = networkKinds[draws.below(networkKinds.length)];
      tiles.push({ kind: decoyKind, answer: 0, scramble: 0, bolted: false, decoy: true });
      continue;
    }
    const answer = rotationOfMask(kind, mask);
    tiles.push({ kind, answer, scramble: answer, bolted: kind === 'cross', decoy: false });
  }
  const hintable = draws.shuffle(
    tiles.flatMap((tile, cell) => (tile.kind === 'cross' || tile.decoy ? [] : [cell])),
  );
  for (const cell of hintable.slice(0, tier.hintTiles)) {
    tiles[cell] = { ...tiles[cell], bolted: true };
  }
  return { layout: { size, inletRow, fixtures, tiles }, failure: null };
}

/**
 * Draws wrong rotations for every turnable tile, redrawing until the opening
 * state is far enough from the answer or the draws run out.
 */
function scrambleAnswer(
  draws: Draws,
  answer: PipeBoardLayout,
  tier: PipeBoardTier,
  options: PipeBoardOptions,
): PipeBoardLayout {
  let layout = answer;
  for (let draw = 0; draw < SCRAMBLE_DRAWS; draw++) {
    const tiles = answer.tiles.map((tile): PipeTile => {
      if (tile.bolted) return tile;
      if (tile.decoy) {
        const rotations = distinctRotations(tile);
        const rotation = rotations[draws.below(rotations.length)];
        return { ...tile, answer: rotation, scramble: rotation };
      }
      const answerMask = tileMask(tile.kind, tile.answer);
      return { ...tile, scramble: scrambleRotation(draws, tile.kind, answerMask, options) };
    });
    layout = { ...answer, tiles };
    if (scrambleProblems(layout, tier).length === 0) break;
  }
  return layout;
}

export interface PipeAttemptBuild {
  readonly layout: PipeBoardLayout | null;
  readonly failure: string | null;
}

/** One attempt's board, before the contract judges it. */
export function buildPipeAttempt(
  seed: number,
  tier: PipeBoardTier,
  options: PipeBoardOptions = {},
): PipeAttemptBuild {
  const draws = new Draws(seed, options);
  const answer = buildAnswerLayout(draws, tier);
  if (answer.layout === null) return answer;
  return { layout: scrambleAnswer(draws, answer.layout, tier, options), failure: null };
}

export interface PipeAttemptResult {
  readonly layout: PipeBoardLayout | null;
  readonly accepted: boolean;
  /** The construction failure, or the first contract row the board failed. */
  readonly rejection: string | null;
  readonly assessment: PipeBoardAssessment | null;
}

/**
 * The last contract row that depends only on the answer and the bolts. Rows up
 * to it are judged before a scramble is drawn, so most attempts never pay for one.
 */
const LAST_ANSWER_ROW = 'needsHypothesis';

/**
 * The cheap half of an attempt: build the answer, judge the rows that read
 * only the answer and the bolts, draw the scramble and judge it. Every draw an
 * attempt makes happens here, so the board does not depend on how the
 * simulated players that follow are spread across frames.
 */
function buildAndJudgeScramble(
  boardSeed: number,
  attempt: number,
  tier: PipeBoardTier,
  options: PipeBoardOptions,
): PipeAttemptResult {
  const draws = new Draws(attemptSeed(boardSeed, attempt), options);
  const answer = buildAnswerLayout(draws, tier);
  if (answer.layout === null) {
    return { layout: null, accepted: false, rejection: answer.failure, assessment: null };
  }
  const structure = assessPipeBoard(answer.layout, tier, {
    ...options,
    stopAtFirstFailure: true,
    lastRow: LAST_ANSWER_ROW,
  });
  if (!structure.passed) {
    return {
      layout: answer.layout,
      accepted: false,
      rejection: structure.firstFailure,
      assessment: structure,
    };
  }
  const layout = scrambleAnswer(draws, answer.layout, tier, options);
  const scrambled = scrambleProblems(layout, tier).length === 0;
  return {
    layout,
    accepted: scrambled,
    rejection: scrambled ? null : 'scrambleFar',
    assessment: null,
  };
}

/**
 * One whole attempt in one go: build, then assess in the generator's
 * stop-at-first-failure mode. When the answer rows pass, it gives the same board
 * as {@link buildPipeAttempt} for the same seed, and it accepts exactly what the
 * stepped generation accepts.
 */
export function runPipeAttempt(
  boardSeed: number,
  attempt: number,
  tier: PipeBoardTier,
  options: PipeBoardOptions = {},
): PipeAttemptResult {
  const built = buildAndJudgeScramble(boardSeed, attempt, tier, options);
  if (!built.accepted || built.layout === null) return built;
  const { layout } = built;
  const assessment = assessPipeBoard(layout, tier, { ...options, stopAtFirstFailure: true });
  return { layout, accepted: assessment.passed, rejection: assessment.firstFailure, assessment };
}

export interface GeneratedPipeBoard {
  readonly layout: PipeBoardLayout;
  readonly source: 'generated' | 'fallback';
  /** Attempts spent, including the accepted one. */
  readonly attempts: number;
}

/**
 * Generation that can be spread across frames. Each {@link step} does a
 * bounded slice of work and returns true once a board is settled; after that
 * it does nothing. {@link attempts} counts attempts finished so far.
 */
export interface PipeBoardGeneration {
  step(): boolean;
  readonly result: GeneratedPipeBoard | null;
  readonly attempts: number;
}

/**
 * Where a sliced attempt stands: building and judging its scramble, sending
 * the follow-the-water player at it one seeded run per step, or the final
 * random-turn and replay checks.
 */
type GenerationPhase =
  | { readonly kind: 'build' }
  | { readonly kind: 'followTheWater'; readonly layout: PipeBoardLayout; run: number; wins: number }
  | { readonly kind: 'finalChecks'; readonly layout: PipeBoardLayout };

class SlicedPipeBoardGeneration implements PipeBoardGeneration {
  private attempt = 0;
  private settled: GeneratedPipeBoard | null = null;
  private phase: GenerationPhase = { kind: 'build' };
  private readonly boardSeed: number;

  constructor(
    worldSeed: number,
    private readonly difficulty: Difficulty,
    private readonly tier: PipeBoardTier,
    private readonly options: PipeBoardOptions,
  ) {
    this.boardSeed = pipeBoardSeed(worldSeed, difficulty);
  }

  get result(): GeneratedPipeBoard | null {
    return this.settled;
  }

  get attempts(): number {
    return this.attempt;
  }

  step(): boolean {
    if (this.settled !== null) return true;
    const { phase } = this;
    switch (phase.kind) {
      case 'build': {
        const built = buildAndJudgeScramble(this.boardSeed, this.attempt, this.tier, this.options);
        if (!built.accepted || built.layout === null) return this.attemptFailed();
        this.phase = { kind: 'followTheWater', layout: built.layout, run: 0, wins: 0 };
        return false;
      }
      case 'followTheWater': {
        const seed = followTheWaterSeed(phase.run);
        if (followTheWaterPlayer(phase.layout, seed, this.options).won) phase.wins++;
        phase.run++;
        if (phase.wins > this.tier.followTheWaterWinsAllowed) return this.attemptFailed();
        if (phase.run === FOLLOW_THE_WATER_RUNS) {
          this.phase = { kind: 'finalChecks', layout: phase.layout };
        }
        return false;
      }
      case 'finalChecks': {
        const random = randomTurnPlayer(phase.layout, undefined, this.options);
        if (random.won || !solverPlayer(phase.layout, this.options).won) {
          return this.attemptFailed();
        }
        this.attempt++;
        this.settled = { layout: phase.layout, source: 'generated', attempts: this.attempt };
        return true;
      }
    }
  }

  private attemptFailed(): boolean {
    this.attempt++;
    this.phase = { kind: 'build' };
    if (this.attempt < GENERATION_ATTEMPTS_MAX) return false;
    this.settled = {
      layout: PIPE_BOARD_FALLBACKS[this.difficulty],
      source: 'fallback',
      attempts: this.attempt,
    };
    return true;
  }
}

/**
 * Starts generating the board for one world and difficulty. `tier` defaults to
 * the difficulty's own; the gate passes another to prove a mistuned tier is
 * caught.
 */
export function createPipeBoardGeneration(
  worldSeed: number,
  difficulty: Difficulty,
  tier: PipeBoardTier = PIPE_BOARD_TIERS[difficulty],
  options: PipeBoardOptions = {},
): PipeBoardGeneration {
  return new SlicedPipeBoardGeneration(worldSeed, difficulty, tier, options);
}

/** Runs a generation to completion in one go. */
export function generatePipeBoardNow(
  worldSeed: number,
  difficulty: Difficulty,
  tier: PipeBoardTier = PIPE_BOARD_TIERS[difficulty],
  options: PipeBoardOptions = {},
): GeneratedPipeBoard {
  const generation = createPipeBoardGeneration(worldSeed, difficulty, tier, options);
  let settled = generation.step();
  while (!settled) settled = generation.step();
  const { result } = generation;
  if (result === null) throw new Error('pipe board generation stopped without a board');
  return result;
}
