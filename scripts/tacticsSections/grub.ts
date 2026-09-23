/**
 * `verify:tactics` sections for the brindle grub, the one creature whose body
 * changes under its traits: a biting grub that can learn to flank, which grows
 * into a Vespa that must act on none of it.
 *
 * Traits are rolled once, at spawn, while it is still a larva, so the gate
 * grows real grubs through their real evolution clock rather than building a
 * Vespa directly, and measures bearings, facing and health rather than
 * counting hits.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { BrindleGrub, type GrubStage } from '../../src/creatures/BrindleGrub';
import { createMob, MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import type { Rng } from '../../src/sprites/person/rng';
import {
  TACTICS_MIN_MOB_LEVEL,
  type TacticsTrait,
} from '../../src/creatures/tactics/tacticsTraits';
import { GUARD_COOLDOWN_FRAMES } from '../../src/creatures/tactics/blockGuard';
import { FLANK_STAGING_TILES } from '../../src/creatures/tactics/flank';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { TacticsHarness } from './special';

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;
/** A source that says no to every roll. */
const ALWAYS_NO: Rng = () => 1;
const HIGHEST_TRAITLESS_LEVEL = TACTICS_MIN_MOB_LEVEL - 1;

/** A tiny swarmer: flank is the one thing worth learning. */
const GRUB_EXPECTED_TRAITS: readonly TacticsTrait[] = ['flank'];

const STAGE_LARVA: GrubStage = 1;
const STAGE_COW_TAILED: GrubStage = 2;
const STAGE_VESPA: GrubStage = 3;
/** Longer than both evolution clocks together, so a grub that never evolves is a failure. */
const MAX_EVOLVE_FRAMES = 6000;

const PROBE_TILE = 12;
const HUMAN_TILE = { x: 17, y: 12 };
const CAT_TILE = { x: 1, y: 1 };
/** Inside the cow-tailed grub's bite-chase range, outside the flank's staging ring. */
const START_GAP_TILES = 4.5;
const PACK_ROW_OFFSETS = [-1, 0, 1];
const FLANK_RUN_FRAMES = 900;
/** The arrival bearings of a pack that flanked must span at least this. */
const FLANK_DISTINCT_DEGREES = 40;
const DEGREES_PER_HALF_TURN = 180;
/** How many of the three must actually have walked a flank for the run to count. */
const FLANKERS_WANTED = 2;
/** A frame must cover this share of the mob's speed for its direction to be a walking direction. */
const WALKING_STEP_SHARE = 0.5;
/** Share of walking flank frames whose facing must agree with the step. */
const FACING_AGREEMENT_MIN = 0.9;
/** Long enough for a pack of Vespas to close to spit range and spit several times. */
const VESPA_RUN_FRAMES = 900;
/** Blows struck at a Vespa; a real guard chance at the top level would turn several aside. */
const VESPA_GUARD_PROBE_BLOWS = 40;
const PROBE_BLOW_DAMAGE = 1;
/**
 * How far the player steps round to a grub's far side once it has arrived —
 * inside its bite range, so it has no reason to walk and only turning to face
 * can follow the player.
 */
const SIDESTEP_TILES = 0.8;
/** Frames the grub is given to turn, comfortably longer than one bite's animation. */
const SIDESTEP_SETTLE_FRAMES = 30;

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

interface Arena {
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
}

function makeArena(map: GameMap): Arena {
  const human = new HumanPlayer(HUMAN_TILE.x, HUMAN_TILE.y, TILE_SIZE);
  human.godMode = true;
  const cat = new CatPlayer(CAT_TILE.x, CAT_TILE.y, TILE_SIZE);
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
  return { roster, loop: new MobUpdateLoop(), ctx, human };
}

/** A top-level grub whose spawn roll answered `rng`, grown to `stage`, or null if it never got there. */
function grownGrub(
  map: GameMap,
  tile: TilePoint,
  rng: Rng,
  stage: GrubStage,
  harness: TacticsHarness,
): BrindleGrub | null {
  const mob = createMob('brindle_grub', tile.x, tile.y, map);
  if (!(mob instanceof BrindleGrub)) {
    harness.check(false, 'brindle_grub builds as a BrindleGrub');
    return null;
  }
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, rng);
  for (let frame = 0; frame < MAX_EVOLVE_FRAMES && mob.stage < stage; frame++) mob.tickEvolve();
  if (mob.stage !== stage) {
    harness.check(false, `a grub reaches stage ${stage} within ${MAX_EVOLVE_FRAMES} frames`);
    return null;
  }
  return mob;
}

function widestBearingSpreadDegrees(bearings: readonly number[]): number {
  let widest = 0;
  for (const a of bearings) {
    for (const b of bearings) {
      let difference = Math.abs(a - b) % (Math.PI * 2);
      if (difference > Math.PI) difference = Math.PI * 2 - difference;
      widest = Math.max(widest, (difference * DEGREES_PER_HALF_TURN) / Math.PI);
    }
  }
  return widest;
}

function facesToward(mob: Mob, target: TilePoint): boolean {
  return mob.facingX * (target.x - mob.x) + mob.facingY * (target.y - mob.y) > 0;
}

// ── Eligibility ────────────────────────────────────────────────────────────

function checkGrubEligibility(map: GameMap, harness: TacticsHarness): void {
  harness.section('Brindle grub: a grub learns only to flank, and the Vespa acts on nothing');

  const larva = grownGrub(map, { x: PROBE_TILE, y: PROBE_TILE }, ALWAYS_YES, STAGE_LARVA, harness);
  if (larva !== null) {
    harness.check(
      larva.tactics.traits.join(',') === GRUB_EXPECTED_TRAITS.join(','),
      `a grub learns [${larva.tactics.traits.join(', ')}] (expected [${GRUB_EXPECTED_TRAITS.join(', ')}])`,
    );
  }

  const early = createMob('brindle_grub', PROBE_TILE, PROBE_TILE, map);
  early.applyMobLevel(HIGHEST_TRAITLESS_LEVEL);
  early.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
  harness.check(
    !early.tactics.hasAnyTrait,
    `nothing at level ${HIGHEST_TRAITLESS_LEVEL} (${early.tactics.traits.join(',') || 'none'})`,
  );

  const biter = grownGrub(
    map,
    { x: PROBE_TILE, y: PROBE_TILE },
    ALWAYS_YES,
    STAGE_COW_TAILED,
    harness,
  );
  if (biter !== null) {
    harness.check(
      biter.activeTacticsTraits.join(',') === GRUB_EXPECTED_TRAITS.join(',') &&
        biter.hasActiveTactics,
      `a cow-tailed grub still acts on [${biter.activeTacticsTraits.join(', ')}]`,
    );
  }

  const vespa = grownGrub(map, { x: PROBE_TILE, y: PROBE_TILE }, ALWAYS_YES, STAGE_VESPA, harness);
  if (vespa !== null) {
    harness.check(
      vespa.tactics.traits.join(',') === GRUB_EXPECTED_TRAITS.join(','),
      `a Vespa keeps the trait it rolled as a grub (${vespa.tactics.traits.join(',') || 'none'}) — dormant, not stripped`,
    );
    harness.check(
      !vespa.hasActiveTactics && vespa.activeTacticsTraits.length === 0,
      `a Vespa acts on no trait, so it shows no rank mark (${vespa.activeTacticsTraits.join(',') || 'none'})`,
    );
  }
}

// ── Cow-tailed grub flank ──────────────────────────────────────────────────

interface FlankTrace {
  readonly bearings: readonly number[];
  readonly flankers: number;
  readonly walkingFlankFrames: number;
  readonly facingAgreedFrames: number;
  readonly finalFacingTowardTarget: number;
  /** Whether a grub already at the fight turned to follow a player who stepped round it. */
  readonly turnedAfterSidestep: boolean;
}

function flankRun(map: GameMap, rng: Rng, harness: TacticsHarness): FlankTrace | null {
  const arena = makeArena(map);
  const pack: BrindleGrub[] = [];
  for (const offset of PACK_ROW_OFFSETS) {
    const tile = { x: HUMAN_TILE.x - START_GAP_TILES, y: HUMAN_TILE.y + offset };
    const grub = grownGrub(map, tile, rng, STAGE_COW_TAILED, harness);
    if (grub === null) return null;
    arena.roster.add(grub);
    pack.push(grub);
  }
  const bearings = pack.map(() => Number.NaN);
  const flanked = pack.map(() => false);
  let walkingFlankFrames = 0;
  let facingAgreedFrames = 0;
  const arrivalPx = FLANK_STAGING_TILES * TILE_SIZE;
  for (let frame = 0; frame < FLANK_RUN_FRAMES; frame++) {
    const before = pack.map((mob) => ({ x: mob.x, y: mob.y }));
    arena.loop.update(arena.ctx);
    pack.forEach((mob, index) => {
      const dx = mob.x - before[index].x;
      const dy = mob.y - before[index].y;
      if (mob.tactics.lastMove === 'flank') {
        flanked[index] = true;
        const step = Math.hypot(dx, dy);
        if (step >= mob.moveSpeed * WALKING_STEP_SHARE) {
          walkingFlankFrames++;
          if (mob.facingX * dx + mob.facingY * dy > 0) facingAgreedFrames++;
        }
      }
      const gap = Math.hypot(mob.x - arena.human.x, mob.y - arena.human.y);
      if (gap <= arrivalPx && Number.isNaN(bearings[index])) {
        bearings[index] = Math.atan2(mob.y - arena.human.y, mob.x - arena.human.x);
      }
    });
  }
  const finalFacingTowardTarget = pack.filter((mob) => facesToward(mob, arena.human)).length;

  const [watched] = pack;
  const awayX = watched.x - arena.human.x;
  const awayY = watched.y - arena.human.y;
  const awayLength = Math.hypot(awayX, awayY);
  if (awayLength > 0) {
    arena.human.x = watched.x + (awayX / awayLength) * SIDESTEP_TILES * TILE_SIZE;
    arena.human.y = watched.y + (awayY / awayLength) * SIDESTEP_TILES * TILE_SIZE;
  }
  for (let frame = 0; frame < SIDESTEP_SETTLE_FRAMES; frame++) arena.loop.update(arena.ctx);
  const turnedAfterSidestep = awayLength > 0 && facesToward(watched, arena.human);
  arena.loop.dispose();
  return {
    bearings,
    flankers: flanked.filter(Boolean).length,
    walkingFlankFrames,
    facingAgreedFrames,
    finalFacingTowardTarget,
    turnedAfterSidestep,
  };
}

function checkGrubFlank(map: GameMap, harness: TacticsHarness): void {
  harness.section('Cow-tailed grub flank: a burst of grubs fans out instead of queueing');
  const trained = flankRun(map, ALWAYS_YES, harness);
  const plain = flankRun(map, ALWAYS_NO, harness);
  if (trained === null || plain === null) return;

  const measured = trained.bearings.filter((bearing) => !Number.isNaN(bearing));
  harness.check(
    measured.length === PACK_ROW_OFFSETS.length,
    `${measured.length}/${PACK_ROW_OFFSETS.length} flanking grubs reached the fight`,
  );
  harness.check(
    trained.flankers >= FLANKERS_WANTED,
    `${trained.flankers} of the burst walked a flank (need ${FLANKERS_WANTED})`,
  );
  const spread = widestBearingSpreadDegrees(measured);
  harness.check(
    spread >= FLANK_DISTINCT_DEGREES,
    `flanking grubs come in across ${spread.toFixed(1)}° (need ${FLANK_DISTINCT_DEGREES}°)`,
  );
  const agreement = trained.facingAgreedFrames / Math.max(1, trained.walkingFlankFrames);
  harness.check(
    trained.walkingFlankFrames > 0 && agreement >= FACING_AGREEMENT_MIN,
    `faces the way it walks on ${agreement.toFixed(2)} of ${trained.walkingFlankFrames} flank frames (need ${FACING_AGREEMENT_MIN})`,
  );
  harness.check(
    trained.finalFacingTowardTarget === PACK_ROW_OFFSETS.length,
    `${trained.finalFacingTowardTarget}/${PACK_ROW_OFFSETS.length} face the player once there`,
  );

  harness.check(
    trained.turnedAfterSidestep,
    'a grub at the fight turns to face a player who steps round behind it',
  );

  const plainMeasured = plain.bearings.filter((bearing) => !Number.isNaN(bearing));
  const plainSpread = widestBearingSpreadDegrees(plainMeasured);
  harness.check(
    plain.flankers === 0 &&
      plainMeasured.length === PACK_ROW_OFFSETS.length &&
      plainSpread < FLANK_DISTINCT_DEGREES,
    `control: without flank, ${plain.flankers} flank and the burst comes in within ${plainSpread.toFixed(1)}°`,
  );
}

// ── Vespa: no tactics at all ───────────────────────────────────────────────

function checkVespaActsOnNothing(map: GameMap, harness: TacticsHarness): void {
  harness.section('Brindled Vespa: a grub that rolled flank never moves tactically or guards');

  const arena = makeArena(map);
  const pack: BrindleGrub[] = [];
  for (const offset of PACK_ROW_OFFSETS) {
    const tile = { x: HUMAN_TILE.x - START_GAP_TILES, y: HUMAN_TILE.y + offset };
    const vespa = grownGrub(map, tile, ALWAYS_YES, STAGE_VESPA, harness);
    if (vespa === null) return;
    arena.roster.add(vespa);
    pack.push(vespa);
  }
  harness.check(
    pack.every((vespa) => vespa.tactics.has('flank')),
    'every Vespa in the pack rolled flank as a grub',
  );
  let tacticalFrames = 0;
  let engagedFrames = 0;
  for (let frame = 0; frame < VESPA_RUN_FRAMES; frame++) {
    arena.loop.update(arena.ctx);
    for (const vespa of pack) {
      if (vespa.currentTarget !== null) engagedFrames++;
      if (vespa.tactics.lastMove !== null) tacticalFrames++;
    }
  }
  arena.loop.dispose();
  harness.check(
    engagedFrames > 0,
    `the Vespas were in the fight (${engagedFrames} engaged frames)`,
  );
  harness.check(tacticalFrames === 0, `${tacticalFrames} frames of a Vespa taking a tactical move`);

  const target = grownGrub(map, { x: PROBE_TILE, y: PROBE_TILE }, ALWAYS_YES, STAGE_VESPA, harness);
  if (target === null) return;
  const striker = new HumanPlayer(PROBE_TILE + 1, PROBE_TILE, TILE_SIZE);
  let unhurtBlows = 0;
  for (let blow = 0; blow < VESPA_GUARD_PROBE_BLOWS; blow++) {
    const before = target.hp;
    target.takeDamageFrom(PROBE_BLOW_DAMAGE, striker, 'melee');
    if (target.hp >= before) unhurtBlows++;
    for (let frame = 0; frame < GUARD_COOLDOWN_FRAMES; frame++) target.tickTimers();
  }
  harness.check(
    target.tactics.guardChancePerBlow === 0 && unhurtBlows === 0,
    `a Vespa turns aside ${unhurtBlows} of ${VESPA_GUARD_PROBE_BLOWS} sword blows (guard chance ${target.tactics.guardChancePerBlow})`,
  );
}

export function checkGrubTactics(map: GameMap, harness: TacticsHarness): void {
  checkGrubEligibility(map, harness);
  checkGrubFlank(map, harness);
  checkVespaActsOnNothing(map, harness);
}
