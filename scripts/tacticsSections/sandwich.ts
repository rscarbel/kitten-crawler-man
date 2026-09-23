/**
 * `verify:tactics` section for the rule every falling-back mob must keep: a
 * kite or a regroup never comes within a tile of the player and never shoves
 * them, whichever way its friend stands.
 *
 * Every registered creature that can learn `kite` or `regroup` is driven
 * through the real mob loop in three fixed layouts — its friend off to the
 * side, which must produce the fall-back so the harness is known to reach it;
 * oblique, where the walk to the friend starts nearly tangent to the player;
 * and on the player's far side, where the straight way runs through them —
 * then over seeded random pack layouts, which must still produce fall-backs
 * often enough that a planner refusing everything cannot pass. A last case
 * steps the player into a kite already running.
 *
 * Measured as distances and displacements, frame by frame, over every frame a
 * fall-back is running — never by whether a blow landed.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { createMob, getRegisteredMobTypes, MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import { mulberry32, type Rng } from '../../src/sprites/person/rng';
import { TACTICS_TRAITS, type TacticsTrait } from '../../src/creatures/tactics/tacticsTraits';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { SystemContext } from '../../src/systems/GameSystem';

/** The pass/fail reporting `verify-tactics.ts` owns, so its failure count covers these too. */
export interface TacticsHarness {
  readonly check: (ok: boolean, message: string) => void;
  readonly section: (name: string) => void;
}

type FallBack = 'kite' | 'regroup';
const FALL_BACKS: readonly FallBack[] = ['kite', 'regroup'];

/** Says yes to every roll, so a creature's rolled traits are its whole eligibility. */
const ALWAYS_YES: Rng = () => 0;

const ROW = 12;
const PLAYER_TILE = { x: 6, y: ROW };
const FAR_CORNER = { x: 1, y: 1 };

/** Where a probe and its friend stand around the player, in tiles. */
interface Layout {
  readonly name: string;
  readonly probe: { x: number; y: number };
  readonly friend: { x: number; y: number };
  /** The friend is where a fall-back is plainly wanted, so one must start. */
  readonly mustStart: boolean;
}

/** The control: the friend straight north of the probe, off the player's line. */
const SIDE_FRIEND_ROWS_NORTH = 4;
/**
 * The oblique layout: probe in contact just south of the player, friend a
 * little over two and a half tiles west and a half tile south of the player —
 * a walk to it that starts nearly tangent to the player and bends a hair
 * toward them. An ordinary pack layout, and the one a grazing allowance of a
 * pixel or two let through to shove the player round.
 */
const OBLIQUE_PROBE_OFFSET = { x: -0.04, y: 1 };
const OBLIQUE_FRIEND_OFFSET = { x: -2.6, y: 0.48 };
/** The far side: the friend three tiles past the player, so the straight line to it runs through them. */
const FAR_SIDE_FRIEND_OFFSET_TILES = 3;

const LAYOUTS: readonly Layout[] = [
  {
    name: 'friend off to the side',
    probe: { x: PLAYER_TILE.x - 1, y: ROW },
    friend: { x: PLAYER_TILE.x - 1, y: ROW - SIDE_FRIEND_ROWS_NORTH },
    mustStart: true,
  },
  {
    name: 'friend oblique',
    probe: { x: PLAYER_TILE.x + OBLIQUE_PROBE_OFFSET.x, y: ROW + OBLIQUE_PROBE_OFFSET.y },
    friend: { x: PLAYER_TILE.x + OBLIQUE_FRIEND_OFFSET.x, y: ROW + OBLIQUE_FRIEND_OFFSET.y },
    mustStart: false,
  },
  {
    name: 'friend beyond the player',
    probe: { x: PLAYER_TILE.x - 1, y: ROW },
    friend: { x: PLAYER_TILE.x + FAR_SIDE_FRIEND_OFFSET_TILES, y: ROW },
    mustStart: false,
  },
];

/** Share of its health a regroup probe is wounded by, below every regroup line. */
const REGROUP_WOUND_SHARE = 0.7;
const RUN_FRAMES = 600;
/** A small non-lethal blast that marks each body as having fought the party. */
const BLOOD_DAMAGE = 1;

/**
 * Nearest a falling-back mob may come to the player: a tile, where the
 * separation between a body and the player starts to shove, or wherever it
 * started if it was already inside that — less a sliver for one frame of
 * rounding.
 */
const PLAYER_CLEARANCE_TILES = 1;
const APPROACH_SLACK_PX = 2;
/**
 * How far the player may be moved while a fall-back runs: the nudge a brawler
 * standing in melee contact already gives, and no more.
 */
const PLAYER_SHOVE_SLACK_PX = 4;

interface Arena {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
}

function makeArena(map: GameMap, playerTile: { x: number; y: number }): Arena {
  const human = new HumanPlayer(playerTile.x, playerTile.y, TILE_SIZE);
  human.godMode = true;
  const cat = new CatPlayer(FAR_CORNER.x, FAR_CORNER.y, TILE_SIZE);
  cat.godMode = true;
  const roster = new MobRoster(map, new SpellSystem());
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  return { map, roster, loop: new MobUpdateLoop(), ctx, human };
}

/** Every trait `type` can learn, in roll order, read off a top-level roll that says yes to all. */
function eligibilityOf(type: string, map: GameMap): readonly TacticsTrait[] {
  const mob = createMob(type, PLAYER_TILE.x, PLAYER_TILE.y, map);
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, ALWAYS_YES);
  mob.dispose();
  return mob.tactics.traits;
}

/**
 * A source that answers yes to exactly `wanted` among `eligibility`, draw by
 * draw, in the order the roll asks — skipping riposte unless block came up.
 */
function rollOnly(eligibility: readonly TacticsTrait[], wanted: readonly TacticsTrait[]): Rng {
  const draws: number[] = [];
  let blockRolled = false;
  for (const trait of TACTICS_TRAITS) {
    if (!eligibility.includes(trait)) continue;
    if (trait === 'riposte' && !blockRolled) continue;
    const yes = wanted.includes(trait);
    if (trait === 'block') blockRolled = yes;
    draws.push(yes ? 0 : 1);
  }
  let index = 0;
  return () => draws[index++] ?? 1;
}

function addMob(
  arena: Arena,
  type: string,
  tile: { x: number; y: number },
  rng: Rng,
  woundShare: number,
): Mob {
  const mob = createMob(type, tile.x, tile.y, arena.map);
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, rng);
  arena.roster.add(mob);
  mob.takeDamageFrom(BLOOD_DAMAGE, arena.human, 'explosion');
  mob.hp = Math.max(1, Math.round(mob.maxHp * (1 - woundShare)));
  return mob;
}

function pinInPlace(arena: Arena, mob: Mob, x: number, y: number): void {
  if (mob.x === x && mob.y === y) return;
  const movedX = mob.x;
  const movedY = mob.y;
  mob.x = x;
  mob.y = y;
  arena.roster.grid.move(mob, movedX, movedY);
}

function centreDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface FallBackTrace {
  readonly starts: number;
  readonly retreatFrames: number;
  /** The most any fall-back closed inside its allowed floor, in pixels; zero if never. */
  readonly worstIntrusionPx: number;
  /** The furthest the player was moved during any one fall-back, in pixels. */
  readonly widestShovePx: number;
  readonly endReasons: readonly string[];
}

interface FallBackRun {
  readonly type: string;
  readonly eligibility: readonly TacticsTrait[];
  readonly fallBack: FallBack;
  readonly playerTile: { x: number; y: number };
  readonly probeTile: { x: number; y: number };
  readonly friendTile: { x: number; y: number };
  readonly frames: number;
  /**
   * Called after each frame the probe is falling back, with how many frames it
   * has been; the one place a test may step into the fall-back's way.
   */
  readonly duringRetreat?: (arena: Arena, probe: Mob, retreatFrame: number) => void;
}

/**
 * Drive one probe through the real mob loop beside a friend held where it
 * stands, and measure every fall-back it makes from the frame it starts:
 * how far inside its floor it came, and how far the player was moved.
 */
function traceFallBack(map: GameMap, run: FallBackRun): FallBackTrace {
  const arena = makeArena(map, run.playerTile);
  const woundShare = run.fallBack === 'regroup' ? REGROUP_WOUND_SHARE : 0;
  const probe = addMob(
    arena,
    run.type,
    run.probeTile,
    rollOnly(run.eligibility, [run.fallBack]),
    woundShare,
  );
  const friend = addMob(arena, run.type, run.friendTile, rollOnly(run.eligibility, []), 0);
  const friendX = friend.x;
  const friendY = friend.y;
  let starts = 0;
  let retreatFrames = 0;
  let runFrames = 0;
  let worstIntrusionPx = 0;
  let widestShovePx = 0;
  let floorPx = 0;
  let playerStartX = 0;
  let playerStartY = 0;
  const endReasons: string[] = [];
  let was = false;
  for (let frame = 0; frame < run.frames; frame++) {
    const gapBefore = centreDistance(probe, arena.human);
    arena.loop.update(arena.ctx);
    // Held where it stands, so the walk toward it is the probe's own choice.
    pinInPlace(arena, friend, friendX, friendY);
    const retreating = probe.tactics.activeRetreat === run.fallBack;
    if (retreating && !was) {
      starts++;
      runFrames = 0;
      floorPx = Math.min(gapBefore, PLAYER_CLEARANCE_TILES * TILE_SIZE) - APPROACH_SLACK_PX;
      playerStartX = arena.human.x;
      playerStartY = arena.human.y;
    }
    if (retreating) {
      retreatFrames++;
      runFrames++;
      const gap = centreDistance(probe, arena.human);
      worstIntrusionPx = Math.max(worstIntrusionPx, floorPx - gap);
      const shove = Math.hypot(arena.human.x - playerStartX, arena.human.y - playerStartY);
      widestShovePx = Math.max(widestShovePx, shove);
      if (run.duringRetreat !== undefined) {
        run.duringRetreat(arena, probe, runFrames);
        // A test that moved the player measures from where it put them.
        floorPx = Math.min(floorPx, centreDistance(probe, arena.human) - APPROACH_SLACK_PX);
        playerStartX = arena.human.x;
        playerStartY = arena.human.y;
      }
    }
    if (was && !retreating) endReasons.push(probe.tactics.lastRetreatEnd ?? 'unknown');
    was = retreating;
  }
  arena.loop.dispose();
  return { starts, retreatFrames, worstIntrusionPx, widestShovePx, endReasons };
}

/** Every registered creature and each fall-back it can learn. */
function fallBackCases(map: GameMap): Array<{
  type: string;
  eligibility: readonly TacticsTrait[];
  fallBack: FallBack;
}> {
  const cases: Array<{ type: string; eligibility: readonly TacticsTrait[]; fallBack: FallBack }> =
    [];
  for (const type of getRegisteredMobTypes()) {
    const eligibility = eligibilityOf(type, map);
    for (const fallBack of FALL_BACKS) {
      if (eligibility.includes(fallBack)) cases.push({ type, eligibility, fallBack });
    }
  }
  return cases;
}

function isClean(trace: FallBackTrace): boolean {
  return trace.worstIntrusionPx <= 0 && trace.widestShovePx <= PLAYER_SHOVE_SLACK_PX;
}

function describe(trace: FallBackTrace): string {
  return `${trace.starts} started over ${trace.retreatFrames} frames, closed ${Math.max(0, trace.worstIntrusionPx).toFixed(1)} px past its floor, shoved the player ${trace.widestShovePx.toFixed(1)} px (max ${PLAYER_SHOVE_SLACK_PX})`;
}

function checkFixedLayouts(
  map: GameMap,
  harness: TacticsHarness,
  cases: ReturnType<typeof fallBackCases>,
): void {
  harness.section('Kite and regroup: never through the player, never shoving them');
  for (const { type, eligibility, fallBack } of cases) {
    for (const layout of LAYOUTS) {
      const trace = traceFallBack(map, {
        type,
        eligibility,
        fallBack,
        playerTile: PLAYER_TILE,
        probeTile: layout.probe,
        friendTile: layout.friend,
        frames: RUN_FRAMES,
      });
      const started = !layout.mustStart || trace.starts > 0;
      harness.check(
        started && isClean(trace),
        `${type} ${fallBack}, ${layout.name}: ${describe(trace)}${layout.mustStart ? ' (need 1 start)' : ''}`,
      );
    }
  }
  harness.check(cases.length > 0, `found ${cases.length} creature fall-backs to probe`);
}

/** Seeded random pack layouts per creature fall-back. */
const RANDOM_LAYOUT_TRIALS = 60;
/** Long enough for a slow-swinging brawler to finish a swing and still fall back. */
const RANDOM_LAYOUT_FRAMES = 150;
const RANDOM_LAYOUT_SEED = 0x5a4d;
/** The random friend stands this many tiles from the player, give or take the spread. */
const RANDOM_FRIEND_MIN_TILES = 1.6;
const RANDOM_FRIEND_SPREAD_TILES = 3.4;
/** The random layouts' player, in the middle of the room so no layout meets a wall. */
const RANDOM_PLAYER_TILE = { x: 12, y: 12 };
/**
 * The least share of random layouts that must produce each fall-back. A
 * planner that refused nearly every walk would never shove anybody; this is
 * what tells that apart from one that walks cleanly.
 *
 * A regroup's floor is far lower than a kite's, and not by accident: a random
 * friend stands on the player's side or beyond them about half the time, and
 * no clean walk reaches it there; a shooter only ever regroups behind its
 * friend, which rules out more still.
 */
const MIN_RANDOM_START_SHARE: Record<FallBack, number> = { kite: 0.5, regroup: 0.15 };

function checkRandomLayouts(
  map: GameMap,
  harness: TacticsHarness,
  cases: ReturnType<typeof fallBackCases>,
): void {
  harness.section('Kite and regroup: seeded random pack layouts never shove the player');
  const rng = mulberry32(RANDOM_LAYOUT_SEED);
  for (const { type, eligibility, fallBack } of cases) {
    let started = 0;
    let worstShovePx = 0;
    let worstIntrusionPx = 0;
    for (let trial = 0; trial < RANDOM_LAYOUT_TRIALS; trial++) {
      const probeBearing = rng() * Math.PI * 2;
      const friendBearing = rng() * Math.PI * 2;
      const friendTiles = RANDOM_FRIEND_MIN_TILES + rng() * RANDOM_FRIEND_SPREAD_TILES;
      const offsetPlayer = (bearing: number, tiles: number): { x: number; y: number } => ({
        x: RANDOM_PLAYER_TILE.x + Math.cos(bearing) * tiles,
        y: RANDOM_PLAYER_TILE.y + Math.sin(bearing) * tiles,
      });
      const trace = traceFallBack(map, {
        type,
        eligibility,
        fallBack,
        playerTile: RANDOM_PLAYER_TILE,
        probeTile: offsetPlayer(probeBearing, 1),
        friendTile: offsetPlayer(friendBearing, friendTiles),
        frames: RANDOM_LAYOUT_FRAMES,
      });
      if (trace.starts > 0) started++;
      worstShovePx = Math.max(worstShovePx, trace.widestShovePx);
      worstIntrusionPx = Math.max(worstIntrusionPx, trace.worstIntrusionPx);
    }
    const share = started / RANDOM_LAYOUT_TRIALS;
    const minShare = MIN_RANDOM_START_SHARE[fallBack];
    harness.check(
      share >= minShare && worstShovePx <= PLAYER_SHOVE_SLACK_PX && worstIntrusionPx <= 0,
      `${type} ${fallBack}: started in ${started}/${RANDOM_LAYOUT_TRIALS} layouts (need ${Math.ceil(minShare * RANDOM_LAYOUT_TRIALS)}), worst shove ${worstShovePx.toFixed(1)} px (max ${PLAYER_SHOVE_SLACK_PX}), closed ${Math.max(0, worstIntrusionPx).toFixed(1)} px past its floor`,
    );
  }
}

/** Kite frames run before the player steps into the kiter's path. */
const STEP_IN_AFTER_FRAMES = 8;
/** How far ahead of the kiter, along its walk, the player steps in, in tiles. */
const STEP_IN_AHEAD_TILES = 1.2;
const CROWDED_PROBE_TYPE = 'goblin';

function checkPlayerSteppingIn(map: GameMap, harness: TacticsHarness): void {
  harness.section('Kite: a player stepping into its path ends it, unshoved');
  const eligibility = eligibilityOf(CROWDED_PROBE_TYPE, map);
  const side = LAYOUTS[0];
  let lastX = 0;
  let lastY = 0;
  // Held in an object: a flag set inside the callback is invisible to narrowing.
  const stepIn = { done: false };
  const trace = traceFallBack(map, {
    type: CROWDED_PROBE_TYPE,
    eligibility,
    fallBack: 'kite',
    playerTile: PLAYER_TILE,
    probeTile: side.probe,
    friendTile: side.friend,
    frames: RUN_FRAMES,
    duringRetreat: (arena, probe, retreatFrame) => {
      if (retreatFrame === STEP_IN_AFTER_FRAMES - 1) {
        lastX = probe.x;
        lastY = probe.y;
      }
      if (retreatFrame !== STEP_IN_AFTER_FRAMES || stepIn.done) return;
      const stepX = probe.x - lastX;
      const stepY = probe.y - lastY;
      const stepLength = Math.hypot(stepX, stepY);
      if (stepLength === 0) return;
      const aheadPx = STEP_IN_AHEAD_TILES * TILE_SIZE;
      arena.human.x = probe.x + (stepX / stepLength) * aheadPx;
      arena.human.y = probe.y + (stepY / stepLength) * aheadPx;
      stepIn.done = true;
    },
  });
  harness.check(
    stepIn.done && trace.endReasons[0] === 'crowded',
    `the kite ends 'crowded' when the player steps into its path (ended: ${trace.endReasons.join(', ') || 'never'})`,
  );
  harness.check(
    isClean(trace),
    `a kite the player stepped into never shoves them: ${describe(trace)}`,
  );
}

export function checkFallBackSandwich(map: GameMap, harness: TacticsHarness): void {
  const cases = fallBackCases(map);
  checkFixedLayouts(map, harness, cases);
  checkRandomLayouts(map, harness, cases);
  checkPlayerSteppingIn(map, harness);
}
