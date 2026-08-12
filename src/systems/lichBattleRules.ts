/**
 * The Lich fight's rules, with nothing on screen attached to them.
 *
 * The four-phase machine, the firewall's gap planner and the tantrum's orb
 * planner live here rather than inside `LichBattleSystem` for one reason: every
 * fairness promise this fight makes — a wave always has a gap the player can
 * reach, a rain of orbs never covers every tile they could step to — is a
 * property of these functions alone, and a promise that can only be checked by
 * playing the game is not checked. `scripts/verify-lich.ts` drives this module
 * headlessly with a seeded RNG.
 *
 * Nothing here may import a sprite, a canvas, or a creature.
 */

import { pick, rangeInt, type Rng } from '../sprites/person/rng';

// ── Phase machine ────────────────────────────────────────────────────────────

export type LichBattlePhase = 'onslaught' | 'firewall' | 'tantrum' | 'reckoning';

/** Where the tantrum is: out of reach raining orbs, or grounded and open. */
export type TantrumMode = 'float' | 'daze';

/**
 * Health remaining when the fight leaves its opening phase.
 *
 * 0.6 of a pool 2.5 times the old fight's, so the player has dealt roughly one
 * entire "current fight" worth of damage before anything new is asked of them.
 * The opening is the fight they already know how to have.
 */
export const FIREWALL_TRIGGER_HP_FRACTION = 0.6;

/** Ten seconds of clean dodging, at the game's fixed 60 Hz update. */
export const DODGE_SURVIVAL_FRAMES = 600;
/** How long the Lich stays grounded and open once the dodge clock fills. */
export const DAZE_FRAMES = 180;
/** Landed hits during daze windows, cumulative, that end the tantrum. */
export const DAZE_HITS_REQUIRED = 2;

/** What one frame of the tantrum did, so the caller can play the right cue. */
export type TantrumTick = 'none' | 'daze_started' | 'daze_expired';

/**
 * The fight's order of events, and the only thing allowed to change it.
 *
 * Every transition method moves strictly forward through
 * `onslaught → firewall → tantrum → reckoning` and refuses when called from any
 * other phase, so a stray call from a system that has lost track of where the
 * fight is cannot skip a stage or walk one back.
 *
 * There is deliberately no capture/restore pair. A party death in the
 * magistrate's office turns them out of the tower, and climbing back rebuilds
 * the encounter from `MurderQuestProgress` with a fresh Lich at full health —
 * which is the restart-at-onslaught behaviour a snapshot would have had to
 * reproduce anyway. Building interiors keep no checkpoint of their own, so a
 * snapshot API here would have had nothing to hang from and no caller.
 */
export class LichPhaseMachine {
  private currentPhase: LichBattlePhase = 'onslaught';
  private currentTantrumMode: TantrumMode = 'float';
  private dodgeClockFrames = 0;
  private dazeClockFrames = 0;
  private landedDazeHits = 0;

  get phase(): LichBattlePhase {
    return this.currentPhase;
  }

  get tantrumMode(): TantrumMode {
    return this.currentTantrumMode;
  }

  /** Frames of clean dodging banked toward the next daze. */
  get dodgeFrames(): number {
    return this.dodgeClockFrames;
  }

  /** 0..1, for the dodge-clock bar under the boss bar. */
  get dodgeProgress(): number {
    return this.dodgeClockFrames / DODGE_SURVIVAL_FRAMES;
  }

  get dazeHitsRemaining(): number {
    return Math.max(0, DAZE_HITS_REQUIRED - this.landedDazeHits);
  }

  /**
   * Whether the Lich can be hurt at all right now.
   *
   * The two gauntlet phases answer "no" on their own terms: the firewall lets a
   * hit through only from inside the strike range its caller measures, and the
   * tantrum only while the Lich is grounded.
   */
  get isVulnerable(): boolean {
    switch (this.currentPhase) {
      case 'onslaught':
      case 'reckoning':
        return true;
      case 'firewall':
        return false;
      case 'tantrum':
        return this.currentTantrumMode === 'daze';
    }
  }

  /**
   * Opens the firewall once the opening phase has been fought down to the
   * threshold. Returns true on the frame it transitions.
   */
  observeHealth(hpFraction: number): boolean {
    if (this.currentPhase !== 'onslaught') return false;
    if (hpFraction > FIREWALL_TRIGGER_HP_FRACTION) return false;
    this.currentPhase = 'firewall';
    return true;
  }

  /** The close-range hit that ends the gauntlet. Returns true on transition. */
  registerFirewallStrike(): boolean {
    if (this.currentPhase !== 'firewall') return false;
    this.currentPhase = 'tantrum';
    this.currentTantrumMode = 'float';
    this.dodgeClockFrames = 0;
    this.dazeClockFrames = 0;
    return true;
  }

  /**
   * One frame of the tantrum.
   *
   * `orbHitPlayer` empties the dodge clock rather than merely pausing it: the
   * bar the player is watching has to visibly answer the hit, or the phase
   * reads as an unexplained wait.
   */
  tickTantrum(orbHitPlayer: boolean): TantrumTick {
    if (this.currentPhase !== 'tantrum') return 'none';

    if (this.currentTantrumMode === 'daze') {
      this.dazeClockFrames--;
      if (this.dazeClockFrames > 0) return 'none';
      this.currentTantrumMode = 'float';
      this.dazeClockFrames = 0;
      this.dodgeClockFrames = 0;
      return 'daze_expired';
    }

    if (orbHitPlayer) {
      this.dodgeClockFrames = 0;
      return 'none';
    }
    this.dodgeClockFrames++;
    if (this.dodgeClockFrames < DODGE_SURVIVAL_FRAMES) return 'none';
    this.currentTantrumMode = 'daze';
    this.dazeClockFrames = DAZE_FRAMES;
    return 'daze_started';
  }

  /**
   * A hit landed while the Lich is grounded. Counts cumulatively across as many
   * daze windows as it takes. Returns true on the frame it reaches reckoning.
   */
  registerDazeHit(): boolean {
    if (this.currentPhase !== 'tantrum') return false;
    if (this.currentTantrumMode !== 'daze') return false;
    this.landedDazeHits++;
    if (this.landedDazeHits < DAZE_HITS_REQUIRED) return false;
    this.currentPhase = 'reckoning';
    this.dazeClockFrames = 0;
    this.dodgeClockFrames = 0;
    return true;
  }
}

// ── The firewall's gap planner ───────────────────────────────────────────────

/** Tiles of safe gap in a wall of fire. Two, so it is a doorway and not a needle. */
export const FIREWALL_GAP_WIDTH_TILES = 2;
/**
 * Columns a gap may move between consecutive waves.
 *
 * This is the fairness contract of the whole phase: with waves
 * {@link FIREWALL_WAVE_INTERVAL_FRAMES} apart, a player walking sideways covers
 * far more than three tiles in that time, so the next gap is always reachable
 * from the one they are standing in. `verify:lich` asserts it.
 */
export const FIREWALL_GAP_MAX_SHIFT_TILES = 3;
/** Frames between wave spawns. */
export const FIREWALL_WAVE_INTERVAL_FRAMES = 120;
/** Frames a wave's row sits marked before it ignites. Well over the 21-frame floor. */
export const FIREWALL_TELEGRAPH_FRAMES = 30;

/** The span of columns a wave is drawn across. */
export interface ColumnSpan {
  readonly minCol: number;
  readonly maxCol: number;
}

/**
 * Chooses where each wave's gap sits.
 *
 * Held apart from the wave list it feeds so the rule that matters — how far a
 * gap may jump — can be exercised over hundreds of waves in a millisecond.
 */
export class FirewallGapPlanner {
  private framesUntilNextWave = 0;
  private previousGapStart: number | null = null;

  constructor(private readonly rng: Rng) {}

  /**
   * Whether a gap starting at this column is somewhere the player can actually
   * stand for the whole of the wave's journey.
   *
   * A room is not a rectangle. The magistrate's office has pillars in it, and a
   * gap placed on one is not a gap — it is a wall the player is being told to
   * hide behind. The caller supplies the test because only it knows the storey.
   */
  private isUsable(gapStart: number, usable: GapUsabilityTest | undefined): boolean {
    return usable === undefined || usable(gapStart);
  }

  /** The gap column of the wave most recently planned, or null before the first. */
  get lastGapStart(): number | null {
    return this.previousGapStart;
  }

  /**
   * Advance one frame. Returns the leftmost column of the new wave's gap when
   * one is due, else null.
   *
   * Returns null forever for a span too narrow to hold a gap, which is a room
   * the phase cannot be run in — the caller checks {@link canHoldGap} rather
   * than discovering it as silence.
   */
  tick(span: ColumnSpan, usable?: GapUsabilityTest): number | null {
    if (this.framesUntilNextWave > 0) {
      this.framesUntilNextWave--;
      return null;
    }
    if (!canHoldGap(span)) return null;
    this.framesUntilNextWave = FIREWALL_WAVE_INTERVAL_FRAMES;
    const gapStart = this.planGapStart(span, usable);
    this.previousGapStart = gapStart;
    return gapStart;
  }

  /**
   * Holds the cadence back for a beat without forgetting where the gap was.
   *
   * Called when a hit resets the stage. The player is returned to the south
   * wall, so gap continuity across the reset buys them nothing — but keeping it
   * costs nothing either, and the shift rule stays true of every consecutive
   * pair of waves rather than of every pair except the ones nobody checks.
   */
  holdFor(frames: number): void {
    this.framesUntilNextWave = Math.max(this.framesUntilNextWave, frames);
  }

  reset(): void {
    this.framesUntilNextWave = 0;
    this.previousGapStart = null;
  }

  private planGapStart(span: ColumnSpan, usable: GapUsabilityTest | undefined): number {
    const lowestStart = span.minCol;
    const highestStart = span.maxCol - FIREWALL_GAP_WIDTH_TILES + 1;
    const previous = this.previousGapStart;
    if (previous === null) {
      return this.pickBetween(lowestStart, highestStart, lowestStart, highestStart, usable);
    }
    const reachableLow = Math.max(lowestStart, previous - FIREWALL_GAP_MAX_SHIFT_TILES);
    const reachableHigh = Math.min(highestStart, previous + FIREWALL_GAP_MAX_SHIFT_TILES);
    const reachable = this.collectUsable(reachableLow, reachableHigh, usable);
    // `previous` is itself standable and lies inside its own window, so this is
    // non-empty on any storey with a usable column at all. The fallback below is
    // for the storey that has none — where the phase cannot be run fairly and
    // the caller has already decided to run it anyway.
    if (reachable.length > 0) return pick(this.rng, reachable);
    return this.pickBetween(lowestStart, highestStart, lowestStart, highestStart, usable);
  }

  /**
   * A usable column in `[low, high]`, falling back to any column in the span
   * when the storey offers none at all — a room with no standable gap anywhere
   * cannot host this phase, and the caller checks {@link canHoldGap} and its own
   * geometry before starting it.
   */
  private pickBetween(
    low: number,
    high: number,
    spanLow: number,
    spanHigh: number,
    usable: GapUsabilityTest | undefined,
  ): number {
    const candidates = this.collectUsable(low, high, usable);
    if (candidates.length > 0) return pick(this.rng, candidates);
    return rangeInt(this.rng, spanLow, spanHigh);
  }

  private collectUsable(low: number, high: number, usable: GapUsabilityTest | undefined): number[] {
    const candidates: number[] = [];
    for (let start = low; start <= high; start++) {
      if (this.isUsable(start, usable)) candidates.push(start);
    }
    return candidates;
  }
}

/** Whether a wave whose gap starts at this column leaves somewhere to stand. */
export type GapUsabilityTest = (gapStart: number) => boolean;

/** Whether a span is wide enough for a wave to have a gap at all. */
export function canHoldGap(span: ColumnSpan): boolean {
  return span.maxCol - span.minCol + 1 >= FIREWALL_GAP_WIDTH_TILES;
}

/** Whether a column burns in a wave whose gap starts at `gapStart`. */
export function columnBurns(column: number, gapStart: number): boolean {
  return column < gapStart || column >= gapStart + FIREWALL_GAP_WIDTH_TILES;
}

/**
 * The column to stand in to survive a wave whose gap starts at `gapStart`.
 *
 * A whole column, because a body occupies one: the midpoint of a two-tile gap
 * falls on a tile boundary, and half a tile either way is a body half in the
 * fire.
 */
export function gapCentreColumn(gapStart: number): number {
  return gapStart + Math.floor((FIREWALL_GAP_WIDTH_TILES - 1) / 2);
}

// ── The tantrum's orb planner ────────────────────────────────────────────────

/** Frames an impact circle is drawn on the floor before the orb lands in it. */
export const ORB_WARNING_FRAMES = 50;
/** Frames between orbs during the tantrum. */
export const ORB_SPAWN_INTERVAL_FRAMES = 20;
/** The slower rain that keeps falling through the final phase. */
export const RECKONING_ORB_SPAWN_INTERVAL_FRAMES = 55;
/** Warnings allowed on the floor at once. */
export const MAX_CONCURRENT_ORB_WARNINGS = 8;
/** One orb in this many is aimed at the tile the player is standing on. */
const PLAYER_TARGETED_ORB_PERIOD = 3;
/**
 * Tiles from an impact point that an orb hurts.
 *
 * A rule rather than a rendering number, and it lives here because the
 * never-box-in test is meaningless without it: measuring coverage at the impact
 * tile alone would call an escape safe that is well inside the blast.
 */
export const ORB_IMPACT_RADIUS_TILES = 1.1;
/**
 * Random tiles tried before a spawn is abandoned for this frame.
 *
 * A cap rather than a loop until success: the never-box-in rule can in principle
 * refuse every tile in a small room with eight warnings already down, and the
 * correct answer there is to drop the orb, not to spin.
 */
const ORB_PLACEMENT_ATTEMPTS = 12;

export interface TilePos {
  readonly col: number;
  readonly row: number;
}

/** The floor the rain falls on, as the planner needs to see it. */
export interface OrbRainRoom extends ColumnSpan {
  readonly minRow: number;
  readonly maxRow: number;
  isWalkable(col: number, row: number): boolean;
}

const NEIGHBOUR_OFFSETS: ReadonlyArray<TilePos> = [
  { col: -1, row: -1 },
  { col: 0, row: -1 },
  { col: 1, row: -1 },
  { col: -1, row: 0 },
  { col: 1, row: 0 },
  { col: -1, row: 1 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
];

/** The walkable tiles a player standing on `tile` could step to this frame. */
export function walkableNeighbours(room: OrbRainRoom, tile: TilePos): TilePos[] {
  const neighbours: TilePos[] = [];
  for (const offset of NEIGHBOUR_OFFSETS) {
    const col = tile.col + offset.col;
    const row = tile.row + offset.row;
    if (col < room.minCol || col > room.maxCol) continue;
    if (row < room.minRow || row > room.maxRow) continue;
    if (!room.isWalkable(col, row)) continue;
    neighbours.push({ col, row });
  }
  return neighbours;
}

/**
 * Whether adding `candidate` to the warnings already down would leave a player
 * on `playerTile` with nowhere safe to step.
 *
 * The player's own tile is deliberately not counted as an escape: standing
 * still inside a ring of impacts is not a dodge the player can see, and a
 * fairness rule the player cannot read is not one.
 */
function wouldBoxIn(
  room: OrbRainRoom,
  playerTile: TilePos,
  liveWarnings: ReadonlyArray<TilePos>,
  candidate: TilePos,
): boolean {
  const escapes = walkableNeighbours(room, playerTile);
  if (escapes.length === 0) return false;
  // Measured at the blast radius, not at the impact tile. An orb hurts
  // everything within {@link ORB_IMPACT_RADIUS_TILES}, so three warnings placed
  // around a player can cover every tile they could step to without any of them
  // landing on one — which is the invariant reading as satisfied while the
  // player is boxed in exactly as it was written to prevent.
  return escapes.every(
    (escape) =>
      withinBlast(escape, candidate) ||
      liveWarnings.some((warning) => withinBlast(escape, warning)),
  );
}

function withinBlast(tile: TilePos, impact: TilePos): boolean {
  return Math.hypot(tile.col - impact.col, tile.row - impact.row) <= ORB_IMPACT_RADIUS_TILES;
}

/**
 * Decides when an orb falls and where.
 *
 * Every third orb is aimed at the player's own tile, which is what makes the
 * phase a dodge rather than a stroll; the rest land at random so standing still
 * is never safe either.
 */
export class OrbRainPlanner {
  private framesUntilNextOrb = 0;
  private orbsPlanned = 0;
  private intervalFrames = ORB_SPAWN_INTERVAL_FRAMES;

  constructor(private readonly rng: Rng) {}

  /** Frames between orbs — the tantrum's cadence, or the reckoning's slower one. */
  setInterval(frames: number): void {
    this.intervalFrames = frames;
  }

  /**
   * Advance one frame. Returns the tile to warn, or null when nothing is due,
   * the floor is already at its warning cap, or every tile tried would box the
   * player in.
   */
  tick(
    room: OrbRainRoom,
    playerTile: TilePos,
    liveWarnings: ReadonlyArray<TilePos>,
  ): TilePos | null {
    if (this.framesUntilNextOrb > 0) {
      this.framesUntilNextOrb--;
      return null;
    }
    // The cadence is not restarted here: at the cap the next orb is owed the
    // moment a warning resolves, not a further interval later.
    if (liveWarnings.length >= MAX_CONCURRENT_ORB_WARNINGS) return null;

    const target = this.chooseTarget(room, playerTile, liveWarnings);
    if (target === null) return null;
    this.framesUntilNextOrb = this.intervalFrames;
    this.orbsPlanned++;
    return target;
  }

  reset(): void {
    this.framesUntilNextOrb = 0;
    this.orbsPlanned = 0;
  }

  private chooseTarget(
    room: OrbRainRoom,
    playerTile: TilePos,
    liveWarnings: ReadonlyArray<TilePos>,
  ): TilePos | null {
    // The player's own tile is a legal target, but not an unconditional one:
    // measured at the blast radius, an orb on the tile they are standing on
    // reaches all four of their orthogonal neighbours. In an open room the
    // diagonals are still clear and it is allowed; in a corridor it would leave
    // them nowhere to step, and there the rule refuses it like any other.
    const aimsAtPlayer = (this.orbsPlanned + 1) % PLAYER_TARGETED_ORB_PERIOD === 0;
    if (aimsAtPlayer && !wouldBoxIn(room, playerTile, liveWarnings, playerTile)) {
      return playerTile;
    }
    for (let attempt = 0; attempt < ORB_PLACEMENT_ATTEMPTS; attempt++) {
      const candidate = {
        col: rangeInt(this.rng, room.minCol, room.maxCol),
        row: rangeInt(this.rng, room.minRow, room.maxRow),
      };
      if (!room.isWalkable(candidate.col, candidate.row)) continue;
      if (wouldBoxIn(room, playerTile, liveWarnings, candidate)) continue;
      return candidate;
    }
    return null;
  }
}

// ── Getting out of the way ───────────────────────────────────────────────────

/**
 * How far the escape search looks for somewhere better to stand, in tiles.
 *
 * Wide enough to cross the magistrate's office, because during the firewall the
 * only safe ground is the gap and it can be at the far wall. A smaller radius
 * would find nothing better within reach on exactly the frames that matter and
 * report "nowhere to go" while a whole safe column stood eight tiles away.
 */
export const HAZARD_ESCAPE_SEARCH_RADIUS_TILES = 10;

/**
 * How dangerous a tile is to stand on. Zero is safe; the search only ever
 * compares these against each other, so the scale is the caller's own.
 */
export type TileDanger = (tile: TilePos) => number;

interface SearchNode {
  readonly tile: TilePos;
  /** The neighbour of the origin this node was first reached through. */
  readonly firstStep: TilePos;
  readonly depth: number;
}

/**
 * The single step that starts the shortest walk to the safest ground in reach,
 * or null when standing still is already as good as it gets.
 *
 * A step rather than a destination because the caller steers with a direction
 * and walls do not bend: aiming straight at a tile eight columns away walks into
 * whatever pillar is between, while re-asking each frame from wherever the
 * walker has got to follows the corner around it.
 *
 * Strictly *safer*, never merely different — a search that returned a tile of
 * equal danger would have the walker trade places with itself forever. When two
 * waves' gaps do not overlap there is no clean tile anywhere and the honest
 * answer is that the walker should keep whatever standing order it has.
 *
 * Ties are broken twice, and neither is cosmetic. First on how far the tile is
 * from where the walker already stands: with several equally safe tiles the same
 * number of steps away, taking whichever the neighbour list happened to name
 * first sent the walker diagonally when a sideways step would have done, and in
 * this fight that diagonal points north, into the wall of fire it is dodging.
 *
 * Then on how much room the tile leaves. A tile you cannot leave is not a safe
 * tile — it is a safe tile *this frame*. Without this the walker banks a corner:
 * each dodge is individually correct, each one has it a little nearer a wall,
 * and it ends the phase wedged in a pocket with three neighbours where the next
 * orb has nowhere to send it. It survives every hazard on the way there and dies
 * to the first one that finds it.
 */
export function stepTowardSafety(
  room: OrbRainRoom,
  dangerAt: TileDanger,
  from: TilePos,
  searchRadiusTiles: number = HAZARD_ESCAPE_SEARCH_RADIUS_TILES,
): TilePos | null {
  const startingDanger = dangerAt(from);
  if (startingDanger <= 0) return null;

  let best: { danger: number; step: TilePos; strayed: number; escapes: number } | null = null;
  const visited = new Set<string>([tileKey(from)]);
  let frontier: SearchNode[] = [];

  for (const neighbour of walkableNeighbours(room, from)) {
    visited.add(tileKey(neighbour));
    frontier.push({ tile: neighbour, firstStep: neighbour, depth: 1 });
  }

  while (frontier.length > 0) {
    const next: SearchNode[] = [];
    for (const node of frontier) {
      const danger = dangerAt(node.tile);
      if (danger < startingDanger) {
        // Every node of one pass through this loop is the same number of steps
        // out, so comparing them on danger and then on stray is comparing like
        // with like. A later, deeper pass can only win on danger.
        const strayed = squaredSpan(from, node.tile);
        const escapes = walkableNeighbours(room, node.tile).length;
        if (best === null || beats(danger, strayed, escapes, best)) {
          best = { danger, step: node.firstStep, strayed, escapes };
        }
      }
      if (node.depth >= searchRadiusTiles) continue;
      for (const neighbour of walkableNeighbours(room, node.tile)) {
        const key = tileKey(neighbour);
        if (visited.has(key)) continue;
        visited.add(key);
        next.push({ tile: neighbour, firstStep: node.firstStep, depth: node.depth + 1 });
      }
    }
    // Checked between rings rather than the moment clean ground is found, so
    // every tile the same distance out gets to compete for the tie-break above.
    if (best !== null && best.danger <= 0) break;
    frontier = next;
  }

  return best === null ? null : best.step;
}

function beats(
  danger: number,
  strayed: number,
  escapes: number,
  best: { danger: number; strayed: number; escapes: number },
): boolean {
  if (danger !== best.danger) return danger < best.danger;
  if (strayed !== best.strayed) return strayed < best.strayed;
  return escapes > best.escapes;
}

function squaredSpan(a: TilePos, b: TilePos): number {
  const col = a.col - b.col;
  const row = a.row - b.row;
  return col * col + row * row;
}

function tileKey(tile: TilePos): string {
  return `${tile.col},${tile.row}`;
}
