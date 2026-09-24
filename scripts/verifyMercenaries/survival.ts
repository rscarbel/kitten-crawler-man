/**
 * Headless checks on how a hireling stays alive, run from `verify-mercenaries.ts`
 * through the scene's own frame: the mob loop, the hireling system's death
 * interception, kill resolution and the system's update, in `DungeonScene`'s
 * order.
 *
 * - Half damage: a long run of one-point hits through both damage doors costs
 *   half as many hit points, not one per hit.
 * - Recovery: a hireling left alone is back to full health on exactly the
 *   out-of-combat frame and not one frame earlier; a hit, a hostile it has
 *   engaged, and a fight it is swinging in each restart the clock.
 * - Draughts: one at the health threshold, none just above it, and none again
 *   until the cooldown has run out.
 * - Downed: at zero HP a hire goes down instead of dying — no kill, no
 *   `mobKilled`, hostiles let go of it, the body stays drawn, blows stop
 *   landing.
 * - Revive: a crawler standing over the body fills the revive and holds the
 *   window; stepping away empties the revive and lets the window run on; a
 *   full revive stands the hire up at the crawlers' revive share of health.
 * - The window running out, or the party leaving the scene, kills the hire for
 *   good and ends the contract.
 * - Health survives a scene change and a save: dismissed and respawned, or
 *   captured, written, parsed and restored, the hire comes back as hurt as it
 *   left.
 *
 * Every rule is paired with a run where it must go the other way.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mercenary } from '../../src/creatures/Mercenary';
import type { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import { POTION_HEAL_FRACTION } from '../../src/Player';
import { getMercenaryTemplate, type MercenaryTemplateId } from '../../src/core/mercenaryTemplates';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type HiredMercenary,
  type MercenaryRoster,
} from '../../src/core/MercenaryRoster';
import { parseMercenaryRosterCheckpoint } from '../../src/core/PersistedWorldState';
import { REVIVE_FRAMES, REVIVE_HP_FRACTION, REVIVE_RANGE_PX } from '../../src/core/reviveRules';
import {
  HIRELING_DAMAGE_TAKEN_MULTIPLIER,
  HIRELING_OUT_OF_COMBAT_FRAMES,
  HIRELING_POTION_COOLDOWN_FRAMES,
  HIRELING_POTION_HP_FRACTION,
  HIRELING_REVIVE_WINDOW_FRAMES,
} from '../../src/creatures/mercenaries/hirelingSurvival';
import { MercenarySystem, type HirelingFeedback } from '../../src/systems/MercenarySystem';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem';
import { EventBus } from '../../src/core/EventBus';
import { AbilityManager } from '../../src/core/AbilityManager';
import { createMob } from '../../src/levels/spawner';
import type { SoundId } from '../../src/audio/sounds';

/** How a gate reports; the caller owns the failure count. */
export interface SurvivalGateReporter {
  section(name: string): void;
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const FLOOR = 'level3';

// ── The scene ────────────────────────────────────────────────────────────────

const ROOM_WIDTH_TILES = 40;
const ROOM_HEIGHT_TILES = 24;
const PARTY_TILE_X = 8;
const PARTY_TILE_Y = 12;
/**
 * A one-tile cell walled in on every side, inside every kit's engage radius of
 * the party: a hostile shut in there can be engaged but never reached.
 */
const SEALED_CELL_OFFSET_TILES = 7;
const SEALED_CELL_TILE_X = PARTY_TILE_X + SEALED_CELL_OFFSET_TILES;
const SEALED_CELL_TILE_Y = PARTY_TILE_Y;
/** Far enough from the party that nothing there is in engage, revive or talk range. */
const FAR_TILE_X = 34;
const FAR_TILE_Y = 4;

function isOpenTile(x: number, y: number, lastX: number, lastY: number): boolean {
  const insideOuterWall = x > 0 && y > 0 && x < lastX && y < lastY;
  const besideCell = Math.abs(x - SEALED_CELL_TILE_X) <= 1 && Math.abs(y - SEALED_CELL_TILE_Y) <= 1;
  const isCell = x === SEALED_CELL_TILE_X && y === SEALED_CELL_TILE_Y;
  return insideOuterWall && (!besideCell || isCell);
}

function makeRoom(): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_HEIGHT_TILES }, (_, y) =>
    Array.from({ length: ROOM_WIDTH_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: isOpenTile(x, y, lastX, lastY) ? FloorTypeValue.tile_floor : FloorTypeValue.wall,
    })),
  );
  // At the real tile height, or every sight test measures against the wrong grid.
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** What the system asked the scene to say and play. */
interface FeedbackLog {
  readonly toasts: string[];
  readonly sounds: SoundId[];
}

interface Scene {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly mobs: MobRoster;
  readonly roster: MercenaryRoster;
  readonly system: MercenarySystem;
  readonly ctx: SystemContext;
  readonly combat: CombatContext;
  readonly mobLoop: MobUpdateLoop;
  readonly extras: Player[];
  readonly feedback: FeedbackLog;
  /** `mobKilled` events seen, of any mob. */
  readonly kills: Mob[];
}

function hireOf(id: MercenaryTemplateId): HiredMercenary {
  return { id, name: getMercenaryTemplate(id).name, contractLevelId: FLOOR, introduced: true };
}

function buildScene(hire: HiredMercenary | null): Scene {
  const map = makeRoom();
  const human = new HumanPlayer(PARTY_TILE_X, PARTY_TILE_Y, TILE_SIZE);
  const cat = new CatPlayer(PARTY_TILE_X, PARTY_TILE_Y + 1, TILE_SIZE);
  human.isActive = true;
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const roster = createMercenaryRoster();
  roster.active = hire;
  const log: FeedbackLog = { toasts: [], sounds: [] };
  const feedback: HirelingFeedback = {
    toast: (message) => log.toasts.push(message),
    sound: (id) => log.sounds.push(id),
  };
  const system = new MercenarySystem(roster, FLOOR, () => false, feedback);
  const extras: Player[] = [];
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
    extraTargets: extras,
  };
  const bus = new EventBus();
  const kills: Mob[] = [];
  bus.on('mobKilled', (event) => kills.push(event.mob));
  const combat: CombatContext = {
    human,
    cat,
    mobs: mobs.mobs,
    mobGrid: mobs.grid,
    gameMap: map,
    safeRoom: null,
    bus,
    abilityManager: new AbilityManager(),
    spells,
    hitLanded: false,
  };
  const scene: Scene = {
    map,
    human,
    cat,
    mobs,
    roster,
    system,
    ctx,
    combat,
    mobLoop: new MobUpdateLoop(),
    extras,
    feedback: log,
    kills,
  };
  refreshExtras(scene);
  system.update(ctx);
  refreshExtras(scene);
  return scene;
}

/** The scene lists only a standing hireling among the party's extra targets, as `DungeonScene` does. */
function refreshExtras(scene: Scene): void {
  scene.extras.length = 0;
  const merc = scene.system.activeMerc;
  if (merc !== null) scene.extras.push(merc);
}

/** One frame of the scene, in `DungeonScene`'s order. */
function step(scene: Scene): void {
  refreshExtras(scene);
  scene.mobLoop.update(scene.ctx);
  scene.system.checkHealth();
  resolveKills(scene.combat);
  scene.system.update(scene.ctx);
  scene.human.tickTimers();
  scene.cat.tickTimers();
}

function steps(scene: Scene, count: number): void {
  for (let i = 0; i < count; i++) step(scene);
}

function placeAt(body: { x: number; y: number }, tileX: number, tileY: number): void {
  body.x = tileX * TILE_SIZE;
  body.y = tileY * TILE_SIZE;
}

/** Moves a mob and keeps the grid in step, as every teleport must. */
function moveMob(scene: Scene, mob: Mob, tileX: number, tileY: number): void {
  const oldX = mob.x;
  const oldY = mob.y;
  placeAt(mob, tileX, tileY);
  scene.mobs.grid.move(mob, oldX, oldY);
}

function inGrid(scene: Scene, mob: Mob): boolean {
  return [...scene.mobs.grid.queryCircle(mob.x, mob.y, TILE_SIZE)].includes(mob);
}

/** Both crawlers somewhere nobody can revive from. */
function partyAway(scene: Scene): void {
  placeAt(scene.human, FAR_TILE_X, FAR_TILE_Y);
  placeAt(scene.cat, FAR_TILE_X, FAR_TILE_Y + 1);
}

/** The human stood right on the body, well inside revive reach. */
function humanOnBody(scene: Scene, merc: Mercenary): void {
  standOnBody(scene.human, merc);
}

/** A crawler stood right on the body, well inside revive reach. */
function standOnBody(crawler: Player, merc: Mercenary): void {
  crawler.x = merc.x;
  crawler.y = merc.y + REVIVE_RANGE_PX / 2;
}

function spawnedScene(id: MercenaryTemplateId): { scene: Scene; merc: Mercenary } | null {
  const scene = buildScene(hireOf(id));
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  return { scene, merc };
}

// ── Half damage ─────────────────────────────────────────────────────────────

/** Enough one-point hits that a quarter-point of drift would show. */
const ONE_POINT_HITS = 160;
const ONE_POINT = 1;
/** The ledger may owe or be owed at most one hit point at any moment. */
const LEDGER_TOLERANCE_HP = 1;
/** Below this, top the body up so a long run of hits never finishes it. */
const TOP_UP_BELOW_HP = 10;

type HitDoor = 'takeDamage' | 'takeDamageFrom';

/** HP lost to a run of one-point hits through one door, topping the body up as needed. */
function hpLostToOnePointHits(body: Mob, attacker: Mob, door: HitDoor): number {
  let lost = 0;
  for (let i = 0; i < ONE_POINT_HITS; i++) {
    if (body.hp < TOP_UP_BELOW_HP) body.hp = body.maxHp;
    const before = body.hp;
    if (door === 'takeDamage') {
      body.takeDamage(ONE_POINT, { kind: 'status', effectType: 'burn', applier: null });
    } else {
      body.takeDamageFrom(ONE_POINT, attacker, 'melee');
    }
    lost += before - body.hp;
  }
  return lost;
}

function halvesOnePointHits(body: Mob, attacker: Mob, door: HitDoor): boolean {
  const lost = hpLostToOnePointHits(body, attacker, door);
  const expected = ONE_POINT_HITS * HIRELING_DAMAGE_TAKEN_MULTIPLIER;
  return Math.abs(lost - expected) <= LEDGER_TOLERANCE_HP;
}

function checkHalfDamage(r: SurvivalGateReporter): void {
  r.section('A hireling takes half of every blow, one-point ticks included');
  const spawned = spawnedScene('sledge');
  if (spawned === null) {
    r.check(false, 'Sledge spawns for the damage run');
    return;
  }
  const { scene, merc } = spawned;
  const goblin = createMob('goblin', FAR_TILE_X, FAR_TILE_Y, scene.map);
  for (const door of ['takeDamage', 'takeDamageFrom'] as const) {
    const lost = hpLostToOnePointHits(merc, goblin, door);
    r.check(
      Math.abs(lost - ONE_POINT_HITS * HIRELING_DAMAGE_TAKEN_MULTIPLIER) <= LEDGER_TOLERANCE_HP,
      `${ONE_POINT_HITS} one-point hits through ${door} cost ${lost} HP (half is ${ONE_POINT_HITS * HIRELING_DAMAGE_TAKEN_MULTIPLIER})`,
    );
  }
  // A body with no ledger behind it, measured by the same rule.
  const unsoftened = createMob('goblin', FAR_TILE_X, FAR_TILE_Y, scene.map);
  unsoftened.hp = unsoftened.maxHp;
  r.checkCatches(
    halvesOnePointHits(unsoftened, goblin, 'takeDamage'),
    'a body that takes every one-point tick in full is caught by the half-damage rule',
  );
}

// ── Recovery ────────────────────────────────────────────────────────────────

const HALF = 0.5;

/** Sets the hireling to half health with its recovery clock just restarted. */
function woundedAtHalf(merc: Mercenary): number {
  const wounded = Math.round(merc.maxHp * HALF);
  merc.hp = wounded;
  merc.survival.noteCombat();
  return wounded;
}

/**
 * The frame, counted from now, on which the hireling is back at full health,
 * or null if it is not within `budget` frames. `during` runs before each frame.
 */
function framesUntilFull(
  scene: Scene,
  merc: Mercenary,
  budget: number,
  during: (frame: number) => void = () => undefined,
): number | null {
  for (let frame = 1; frame <= budget; frame++) {
    during(frame);
    step(scene);
    if (merc.hp >= merc.maxHp) return frame;
  }
  return null;
}

/** Recovery periods run before a heal that has not come counts as never. */
const RECOVERY_BUDGET_PERIODS = 3;
/** Past the recovery frame by enough to see a late heal. */
const RECOVERY_BUDGET_FRAMES = HIRELING_OUT_OF_COMBAT_FRAMES * RECOVERY_BUDGET_PERIODS;
/** Where in the quiet a disturbance lands. */
const DISTURB_AT_FRAME = Math.floor(HIRELING_OUT_OF_COMBAT_FRAMES / 2);
/** How long a hostile is left in sight before it is taken away. */
const HOSTILE_PRESENT_FRAMES = HIRELING_OUT_OF_COMBAT_FRAMES + DISTURB_AT_FRAME;

/** Removes a mob from the scene outright, as a despawn would. */
function removeMob(scene: Scene, mob: Mob): void {
  scene.mobs.grid.remove(mob);
  const index = scene.mobs.mobs.indexOf(mob);
  if (index >= 0) scene.mobs.mobs.splice(index, 1);
}

/** A goblin that never moves or swings: something to fight, not a threat. */
function addHeldGoblin(scene: Scene, tileX: number, tileY: number): Mob {
  const goblin = createMob('goblin', tileX, tileY, scene.map);
  placeAt(goblin, tileX, tileY);
  goblin.aiHeld = true;
  scene.mobs.add(goblin);
  return goblin;
}

function checkRecovery(r: SurvivalGateReporter): void {
  r.section('A hireling left alone is back to full health after the quiet, not before');
  const quiet = spawnedScene('dong_quixote');
  if (quiet === null) {
    r.check(false, 'Dong Quixote spawns for the recovery run');
    return;
  }
  const wounded = woundedAtHalf(quiet.merc);
  const earlyFrames = HIRELING_OUT_OF_COMBAT_FRAMES - 1;
  steps(quiet.scene, earlyFrames);
  const stillHurtEarly = quiet.merc.hp === wounded;
  step(quiet.scene);
  const fullOnTheFrame = quiet.merc.hp === quiet.merc.maxHp;
  r.check(
    stillHurtEarly && fullOnTheFrame,
    `at ${wounded}/${quiet.merc.maxHp} HP: unchanged after ${earlyFrames} quiet frames, full on frame ${HIRELING_OUT_OF_COMBAT_FRAMES}`,
  );
  r.check(
    quiet.merc.survival.healFlashFrames > 0,
    'the recovery shows the heal sparkle over the hireling',
  );
  r.checkCatches(
    (() => {
      const early = spawnedScene('dong_quixote');
      if (early === null) return false;
      woundedAtHalf(early.merc);
      steps(early.scene, earlyFrames);
      return early.merc.hp === early.merc.maxHp;
    })(),
    `a heal expected one frame early (frame ${earlyFrames}) is caught`,
  );

  r.section('A hit, a hostile engaged, and a fight in progress each restart the quiet');

  const hit = spawnedScene('dong_quixote');
  if (hit !== null) {
    woundedAtHalf(hit.merc);
    const healedOn = framesUntilFull(hit.scene, hit.merc, RECOVERY_BUDGET_FRAMES, (frame) => {
      if (frame === DISTURB_AT_FRAME) {
        hit.merc.takeDamage(ONE_POINT, { kind: 'status', effectType: 'burn', applier: null });
      }
    });
    // The hit lands before frame DISTURB_AT_FRAME runs, so that frame is the
    // first of the new quiet.
    const expected = DISTURB_AT_FRAME - 1 + HIRELING_OUT_OF_COMBAT_FRAMES;
    r.check(
      healedOn === expected,
      `a one-point hit on frame ${DISTURB_AT_FRAME} moves the full heal to frame ${expected} (got ${healedOn ?? 'none'})`,
    );
    r.checkCatches(
      healedOn === HIRELING_OUT_OF_COMBAT_FRAMES,
      'a heal still on the undisturbed frame after a hit is caught',
    );
  }

  // A brawler: every attack it has is a fist, so a hostile it cannot reach is
  // one it has engaged and never swung at.
  const engaged = spawnedScene('gluteus_maxx');
  if (engaged !== null) {
    woundedAtHalf(engaged.merc);
    const goblin = addHeldGoblin(engaged.scene, SEALED_CELL_TILE_X, SEALED_CELL_TILE_Y);
    let attacks = 0;
    const kit = engaged.merc.kit;
    const startAttack = kit.startAttack.bind(kit);
    kit.startAttack = (ctx, target, distance) => {
      attacks++;
      startAttack(ctx, target, distance);
    };
    const healedOn = framesUntilFull(engaged.scene, engaged.merc, RECOVERY_BUDGET_FRAMES, (f) => {
      if (f === HOSTILE_PRESENT_FRAMES) removeMob(engaged.scene, goblin);
    });
    // The goblin goes before frame HOSTILE_PRESENT_FRAMES runs, so the frame
    // before it is the last one with anything engaged, and counts as the first
    // of the quiet.
    const expected = HOSTILE_PRESENT_FRAMES - 2 + HIRELING_OUT_OF_COMBAT_FRAMES;
    r.check(
      attacks === 0 && healedOn === expected,
      `an engaged hostile it cannot reach (${attacks} attacks) holds the quiet off until it goes (full on frame ${healedOn ?? 'none'}, expected ${expected})`,
    );
  }

  const fighting = spawnedScene('gluteus_maxx');
  if (fighting !== null) {
    woundedAtHalf(fighting.merc);
    const besideX = Math.round(fighting.merc.x / TILE_SIZE) + 1;
    const besideY = Math.round(fighting.merc.y / TILE_SIZE);
    const goblin = addHeldGoblin(fighting.scene, besideX, besideY);
    // A goblin that cannot die, so the fight lasts as long as the run needs.
    goblin.hp = Number.MAX_SAFE_INTEGER;
    let attacks = 0;
    const kit = fighting.merc.kit;
    const startAttack = kit.startAttack.bind(kit);
    kit.startAttack = (ctx, target, distance) => {
      attacks++;
      startAttack(ctx, target, distance);
    };
    const healedDuringFight = framesUntilFull(
      fighting.scene,
      fighting.merc,
      HOSTILE_PRESENT_FRAMES,
    );
    r.check(
      attacks > 0 && healedDuringFight === null,
      `swinging at a hostile (${attacks} attacks) never full-heals in ${HOSTILE_PRESENT_FRAMES} frames of fighting`,
    );
  }
}

// ── Draughts ────────────────────────────────────────────────────────────────

/** Keeps the hireling "in a fight", so only the draught can heal it. */
function inAFight(merc: Mercenary): () => void {
  return () => merc.survival.noteCombat();
}

function thresholdHp(merc: Mercenary): number {
  return Math.floor(merc.maxHp * HIRELING_POTION_HP_FRACTION);
}

/** Frames until the hireling's HP rises above `hp`, holding its fight clock at zero. */
function framesUntilDrink(
  scene: Scene,
  merc: Mercenary,
  hp: number,
  budget: number,
): number | null {
  const fight = inAFight(merc);
  merc.hp = hp;
  for (let frame = 1; frame <= budget; frame++) {
    fight();
    step(scene);
    if (merc.hp > hp) return frame;
  }
  return null;
}

function checkPotions(r: SurvivalGateReporter): void {
  r.section('A hireling drinks at the threshold, then not again until the cooldown is up');
  const spawned = spawnedScene('bomo');
  if (spawned === null) {
    r.check(false, 'Bomo spawns for the draught run');
    return;
  }
  const { scene, merc } = spawned;
  const atThreshold = thresholdHp(merc);
  const aboveThreshold = atThreshold + 1;

  const drankAbove = framesUntilDrink(scene, merc, aboveThreshold, HIRELING_POTION_COOLDOWN_FRAMES);
  r.check(drankAbove === null, `at ${aboveThreshold}/${merc.maxHp} HP it does not drink`);

  const drankAt = framesUntilDrink(scene, merc, atThreshold, 1);
  const healedTo = merc.hp;
  const expectedHeal = Math.round(merc.maxHp * POTION_HEAL_FRACTION);
  r.check(
    drankAt === 1 && healedTo === atThreshold + expectedHeal,
    `at ${atThreshold}/${merc.maxHp} HP it drinks at once, for the crawlers' potion share (+${healedTo - atThreshold}, expected +${expectedHeal})`,
  );
  r.check(
    scene.feedback.sounds.includes('healing_potion'),
    "the draught plays the crawlers' potion sound",
  );

  const wouldDrinkAgain = framesUntilDrink(
    scene,
    merc,
    atThreshold,
    HIRELING_POTION_COOLDOWN_FRAMES,
  );
  r.check(
    wouldDrinkAgain === HIRELING_POTION_COOLDOWN_FRAMES,
    `back at the threshold straight after, the next draught waits out the whole cooldown (drank ${wouldDrinkAgain ?? 'never'} frames after the first, cooldown ${HIRELING_POTION_COOLDOWN_FRAMES})`,
  );
  r.checkCatches(
    wouldDrinkAgain === HIRELING_POTION_COOLDOWN_FRAMES - 1,
    'a second draught expected one frame before the cooldown ends is caught',
  );
}

// ── Downed ──────────────────────────────────────────────────────────────────

/** More than any hireling's health, whatever it is scaled by. */
const LETHAL_DAMAGE = 10_000;
/** Frames given to a hostile to find a new target. */
const RETARGET_FRAMES = 30;

/** Knocks the hireling to zero through a hostile's blow, and runs the frame. */
function knockDownBy(scene: Scene, merc: Mercenary, attacker: Mob): void {
  attacker.currentTarget = merc;
  attacker.retaliateMob = merc;
  merc.takeDamageFrom(LETHAL_DAMAGE, attacker, 'melee');
  step(scene);
}

/** The same frame without the hireling system's interception. */
function knockDownUnintercepted(scene: Scene, merc: Mercenary, attacker: Mob): void {
  merc.takeDamageFrom(LETHAL_DAMAGE, attacker, 'melee');
  resolveKills(scene.combat);
}

function checkDowned(r: SurvivalGateReporter): void {
  r.section('At zero HP a hireling goes down instead of dying');
  const spawned = spawnedScene('splash_zone');
  if (spawned === null) {
    r.check(false, 'Splash Zone spawns for the downed run');
    return;
  }
  const { scene, merc } = spawned;
  partyAway(scene);
  const goblin = createMob('goblin', FAR_TILE_X - 2, FAR_TILE_Y, scene.map);
  scene.mobs.add(goblin);
  moveMob(scene, goblin, Math.round(merc.x / TILE_SIZE) + 1, Math.round(merc.y / TILE_SIZE));
  knockDownBy(scene, merc, goblin);

  r.check(
    merc.lifePhase === 'downed' && merc.hp === 0 && !merc.isAlive,
    `the hire is down (${merc.lifePhase}, ${merc.hp} HP), not dead`,
  );
  r.check(
    scene.roster.active !== null && scene.roster.lastDeceased === null,
    'the contract stands while it is down',
  );
  r.check(scene.kills.length === 0, 'no mobKilled fires for a downed hire');
  r.check(inGrid(scene, merc), 'the body keeps its slot in the mob grid, so it is drawn');
  r.check(
    scene.system.activeMerc === null && scene.system.downedMerc === merc,
    'the scene no longer lists it as a standing hire, so it is nobody’s target',
  );
  r.check(
    goblin.currentTarget !== merc && goblin.retaliateMob !== merc,
    'the hostile that felled it lets go of it',
  );
  steps(scene, RETARGET_FRAMES);
  r.check(
    goblin.currentTarget !== merc && goblin.retaliateMob !== merc,
    `after ${RETARGET_FRAMES} frames of its own AI the hostile has not gone back to it`,
  );
  const landed = merc.takeDamage(LETHAL_DAMAGE, {
    kind: 'mob',
    mobType: 'goblin',
    undodgeable: true,
  });
  merc.takeDamageFrom(LETHAL_DAMAGE, goblin, 'melee');
  r.check(
    !landed && merc.lifePhase === 'downed',
    'blows on the body do not land; it stays down rather than dying',
  );
  r.check(
    scene.feedback.toasts.some((toast) => toast.includes(merc.displayName)),
    `the fall is announced by name ("${scene.feedback.toasts[0] ?? ''}")`,
  );

  const unintercepted = spawnedScene('splash_zone');
  if (unintercepted !== null) {
    const attacker = createMob('goblin', FAR_TILE_X, FAR_TILE_Y, unintercepted.scene.map);
    knockDownUnintercepted(unintercepted.scene, unintercepted.merc, attacker);
    r.checkCatches(
      unintercepted.scene.kills.length === 0,
      'a lethal blow nobody intercepts is caught firing mobKilled',
    );
  }
}

// ── Revive ──────────────────────────────────────────────────────────────────

/** A downed hireling with the party away from it. */
function downedScene(id: MercenaryTemplateId): { scene: Scene; merc: Mercenary } | null {
  const spawned = spawnedScene(id);
  if (spawned === null) return null;
  partyAway(spawned.scene);
  spawned.merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
  step(spawned.scene);
  return spawned.merc.isDowned ? spawned : null;
}

/** Part of the window spent before anyone arrives, as a divisor of it. */
const WAIT_BEFORE_REVIVE_DIVISOR = 3;
const WAIT_BEFORE_REVIVE_FRAMES = Math.floor(
  HIRELING_REVIVE_WINDOW_FRAMES / WAIT_BEFORE_REVIVE_DIVISOR,
);
/** A revive begun and broken off before it finishes. */
const PARTIAL_REVIVE_FRAMES = Math.floor(REVIVE_FRAMES / 2);
/** Window spent after the reviver steps away, as a divisor of it. */
const WAIT_AFTER_REVIVE_DIVISOR = 4;
const WAIT_AFTER_REVIVE_FRAMES = Math.floor(
  HIRELING_REVIVE_WINDOW_FRAMES / WAIT_AFTER_REVIVE_DIVISOR,
);

function checkRevive(r: SurvivalGateReporter): void {
  r.section('A crawler standing over the body holds the window and fills the revive');
  const down = downedScene('bucket_boy');
  if (down === null) {
    r.check(false, 'Bucket Boy goes down for the revive run');
    return;
  }
  const { scene, merc } = down;
  const windowAtStart = merc.survival.reviveWindowLeft;
  steps(scene, WAIT_BEFORE_REVIVE_FRAMES);
  const windowBeforeRevive = merc.survival.reviveWindowLeft;
  r.check(
    windowBeforeRevive === windowAtStart - WAIT_BEFORE_REVIVE_FRAMES,
    `with nobody near, the window runs (${windowAtStart} → ${windowBeforeRevive})`,
  );

  humanOnBody(scene, merc);
  steps(scene, PARTIAL_REVIVE_FRAMES);
  const windowWhileReviving = merc.survival.reviveWindowLeft;
  const progressWhileReviving = merc.survival.reviveProgress;
  r.check(
    windowWhileReviving === windowBeforeRevive && progressWhileReviving === PARTIAL_REVIVE_FRAMES,
    `with the human over it, the window holds at ${windowWhileReviving} and the revive fills to ${progressWhileReviving}/${REVIVE_FRAMES}`,
  );
  r.checkCatches(
    windowWhileReviving === windowBeforeRevive - PARTIAL_REVIVE_FRAMES,
    'a window that kept running through the revive is caught',
  );
  r.check(
    scene.feedback.sounds.includes('reviving_tone'),
    "starting the revive plays the crawlers' reviving tone",
  );

  partyAway(scene);
  steps(scene, WAIT_AFTER_REVIVE_FRAMES);
  r.check(
    merc.survival.reviveProgress === 0 &&
      merc.survival.reviveWindowLeft === windowBeforeRevive - WAIT_AFTER_REVIVE_FRAMES,
    `stepping away empties the revive and the window runs on (${merc.survival.reviveWindowLeft} left)`,
  );

  r.section('A full revive stands the hire up at the revive share of health');
  humanOnBody(scene, merc);
  steps(scene, REVIVE_FRAMES - 1);
  const downOneFrameShort = merc.isDowned;
  // The revive lands in the death interception, before the frame's upkeep can
  // pour a draught on top of it.
  refreshExtras(scene);
  scene.mobLoop.update(scene.ctx);
  scene.system.checkHealth();
  const revivedHp = merc.hp;
  const expectedHp = Math.max(1, Math.ceil(merc.maxHp * REVIVE_HP_FRACTION));
  r.check(
    downOneFrameShort && merc.lifePhase === 'alive' && revivedHp === expectedHp,
    `still down after ${REVIVE_FRAMES - 1} frames, up on frame ${REVIVE_FRAMES} at ${revivedHp} HP (expected ${expectedHp})`,
  );
  resolveKills(scene.combat);
  scene.system.update(scene.ctx);
  r.check(
    scene.system.activeMerc === merc && inGrid(scene, merc),
    'on its feet it is the standing hire again, in the grid',
  );
  r.check(
    merc.hp > revivedHp,
    `its draught is ready the moment it is up, so it drinks at once (${revivedHp} → ${merc.hp} HP)`,
  );
  r.checkCatches(
    revivedHp === merc.maxHp,
    'a revive to full health is caught by the revive-share rule',
  );
}

// ── Who can revive ──────────────────────────────────────────────────────────

/** Whether a downed hire is up after a full revive's worth of frames with `crawler` on it. */
function revivedBy(
  id: MercenaryTemplateId,
  pick: (scene: Scene) => Player,
  prepare: (crawler: Player) => void = () => undefined,
): boolean {
  const down = downedScene(id);
  if (down === null) return false;
  const crawler = pick(down.scene);
  prepare(crawler);
  standOnBody(crawler, down.merc);
  steps(down.scene, REVIVE_FRAMES);
  return !isDownedNow(down.merc);
}

/** Knocks a crawler out the way a lethal blow does. */
function knockOut(crawler: Player): void {
  crawler.hp = 0;
  crawler.isKnockedOut = true;
}

function checkWhoRevives(r: SurvivalGateReporter): void {
  r.section('Either crawler can revive a hire, but not one who is down herself');
  r.check(
    revivedBy('bucket_boy', (scene) => scene.cat),
    'the cat standing over the body revives it, the human far away',
  );
  const knockedOutCatRevives = revivedBy('bucket_boy', (scene) => scene.cat, knockOut);
  r.check(!knockedOutCatRevives, 'a knocked-out cat lying on the body revives nothing');
  r.checkCatches(knockedOutCatRevives, 'a gate expecting the knocked-out cat to revive is caught');
}

// ── A fall cancels the swing ────────────────────────────────────────────────

/** Frames given to a swing to begin once the hire is beside its victim. */
const SWING_START_BUDGET_FRAMES = 240;
/** Frames watched after the revive: longer than any hireling's swing. */
const AFTER_REVIVE_FRAMES = 120;
const LOCOMOTION_ROWS: readonly string[] = ['idle', 'walk'];

interface SwingAfterFall {
  readonly swungFirst: boolean;
  readonly victimHurtAfter: boolean;
  readonly rowsAfter: readonly string[];
}

/**
 * Knocks the hire down on the frame a swing starts, takes its victim out of
 * the scene, revives it, and watches whether the old swing still lands.
 */
function swingAfterFall(id: MercenaryTemplateId): SwingAfterFall | null {
  const spawned = spawnedScene(id);
  if (spawned === null) return null;
  const { scene, merc } = spawned;
  const besideX = Math.round(merc.x / TILE_SIZE) + 1;
  const besideY = Math.round(merc.y / TILE_SIZE);
  const victim = addHeldGoblin(scene, besideX, besideY);
  victim.hp = Number.MAX_SAFE_INTEGER;
  let swung = false;
  const kit = merc.kit;
  const startAttack = kit.startAttack.bind(kit);
  kit.startAttack = (ctx, target, distance) => {
    swung = true;
    startAttack(ctx, target, distance);
  };
  for (let f = 0; f < SWING_START_BUDGET_FRAMES && !swung; f++) step(scene);
  if (!swung) return { swungFirst: false, victimHurtAfter: false, rowsAfter: [] };

  merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
  step(scene);
  removeMob(scene, victim);
  const hpAtFall = victim.hp;
  standOnBody(scene.human, merc);
  steps(scene, REVIVE_FRAMES);
  const rowsAfter: string[] = [];
  for (let f = 0; f < AFTER_REVIVE_FRAMES; f++) {
    step(scene);
    rowsAfter.push(merc.kit.drawState(merc).row);
  }
  return { swungFirst: true, victimHurtAfter: victim.hp < hpAtFall, rowsAfter };
}

const SWINGING_HIRES: readonly MercenaryTemplateId[] = ['gluteus_maxx', 'sledge', 'tumbledown'];

function checkSwingCancelledByFall(r: SurvivalGateReporter): void {
  r.section('A hire knocked down mid-swing does not finish the swing when it gets up');
  for (const id of SWINGING_HIRES) {
    const outcome = swingAfterFall(id);
    // Only the first frame: once up, a hire may well start something new.
    const firstRow = outcome?.rowsAfter[0];
    const upInItsIdle = firstRow !== undefined && LOCOMOTION_ROWS.includes(firstRow);
    r.check(
      outcome !== null && outcome.swungFirst && !outcome.victimHurtAfter && upInItsIdle,
      `${id}: the swing it fell in never lands after the revive, and it gets up in its ${firstRow ?? 'nothing'}`,
    );
  }
}

// ── Saves wait for a revive ─────────────────────────────────────────────────

function checkSaveWaits(r: SurvivalGateReporter): void {
  r.section('A save waits while the hire is down');
  const spawned = spawnedScene('dong_quixote');
  if (spawned === null) {
    r.check(false, 'Dong Quixote spawns for the save run');
    return;
  }
  const { scene, merc } = spawned;
  const standingBlocks = scene.system.revivePending;
  partyAway(scene);
  merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
  step(scene);
  const downedBlocks = scene.system.revivePending;
  humanOnBody(scene, merc);
  steps(scene, REVIVE_FRAMES);
  const revivedBlocks = scene.system.revivePending;
  r.check(
    !standingBlocks && downedBlocks && !revivedBlocks,
    'a save is held off only while the hire is down (standing: free, down: held, revived: free)',
  );
  r.checkCatches(!downedBlocks, 'a gate that lets a save through with the hire down is caught');
}

// ── Death ───────────────────────────────────────────────────────────────────

/** Read through a call, so a frame run in between is not narrowed away. */
function isDownedNow(merc: Mercenary): boolean {
  return merc.isDowned;
}

/** Far more frames than any hireling's linger and fade. */
const CORPSE_FRAME_BUDGET = 2000;

function checkDeath(r: SurvivalGateReporter): void {
  r.section('A body left for the whole window dies for good');
  const down = downedScene('sledge');
  if (down === null) {
    r.check(false, 'Sledge goes down for the bleed-out run');
    return;
  }
  const { scene, merc } = down;
  const name = merc.displayName;
  const windowLeft = merc.survival.reviveWindowLeft;
  steps(scene, windowLeft - 1);
  const downOneFrameShort = merc.isDowned && scene.roster.active !== null;
  const drawnThroughoutWindow = inGrid(scene, merc) && merc.lifePhase === 'downed';
  step(scene);
  const deadOnTheLastFrame = !isDownedNow(merc);
  r.check(
    drawnThroughoutWindow,
    'the body lies there, drawn and holding its pose, for the whole window',
  );
  r.check(
    downOneFrameShort &&
      deadOnTheLastFrame &&
      scene.roster.active === null &&
      scene.roster.lastDeceased === name,
    `still down one frame before the window ends; dead on its last frame, the contract ended and ${name} remembered for the desk`,
  );
  r.check(
    merc.lifePhase === 'corpse' && scene.kills.length === 0,
    'it dies from where it lay (no second fall) and still earns nobody a kill',
  );
  let frames = 0;
  while (scene.mobs.mobs.includes(merc) && frames < CORPSE_FRAME_BUDGET) {
    step(scene);
    frames++;
  }
  r.check(
    merc.lifePhase === 'gone' && !scene.mobs.mobs.includes(merc) && !inGrid(scene, merc),
    `the body fades and leaves the world (${frames} frames)`,
  );

  r.section('Leaving the scene with the hire down loses it');
  const leaving = downedScene('bomo');
  if (leaving !== null) {
    leaving.scene.system.warnIfLeavingDowned();
    leaving.scene.system.warnIfLeavingDowned();
    const warnings = leaving.scene.feedback.toasts.filter((t) => t.includes('leave them behind'));
    r.check(warnings.length === 1, 'the player is warned once before walking away from the body');
    leaving.scene.system.dismissForTransition(leaving.scene.mobs.mobs, leaving.scene.mobs.grid);
    r.check(
      leaving.scene.roster.active === null &&
        leaving.scene.roster.lastDeceased === leaving.merc.displayName &&
        !leaving.scene.mobs.mobs.includes(leaving.merc),
      'a transition with the hire down ends the contract and takes the body away',
    );
  }
  const plainDismiss = downedScene('bomo');
  if (plainDismiss !== null) {
    plainDismiss.scene.system.dismiss(plainDismiss.scene.mobs.mobs, plainDismiss.scene.mobs.grid);
    r.checkCatches(
      plainDismiss.scene.roster.active === null,
      'a transition that only despawns the body is caught keeping the contract',
    );
  }
  const standing = spawnedScene('bomo');
  if (standing !== null) {
    standing.scene.system.dismissForTransition(standing.scene.mobs.mobs, standing.scene.mobs.grid);
    r.check(
      standing.scene.roster.active !== null && standing.scene.roster.lastDeceased === null,
      'a transition with the hire standing keeps the contract',
    );
  }
}

// ── Health across scenes and saves ──────────────────────────────────────────

/**
 * A wound that leaves every hire standing, far from full, and above the
 * draught threshold, so nothing heals it between the leaving and the arriving.
 */
const CARRIED_WOUND_FRACTION = 0.6;
/** Well past any template's maximum. */
const OVER_MAX_HP = 100_000;

function carriedHp(merc: Mercenary): number {
  return Math.max(1, Math.round(merc.maxHp * CARRIED_WOUND_FRACTION));
}

type Respawn = (scene: Scene, roster: MercenaryRoster) => Mercenary | null;

/** The next scene's system, standing the hire up from the same roster. */
const nextSceneRespawn: Respawn = (scene, roster) => {
  const next = new MercenarySystem(roster, FLOOR);
  next.update(scene.ctx);
  return next.activeMerc;
};

function hpSurvivesTransition(id: MercenaryTemplateId, respawn: Respawn): boolean {
  const spawned = spawnedScene(id);
  if (spawned === null) return false;
  const { scene, merc } = spawned;
  const hp = carriedHp(merc);
  merc.hp = hp;
  step(scene);
  scene.system.dismissForTransition(scene.mobs.mobs, scene.mobs.grid);
  return respawn(scene, scene.roster)?.hp === hp;
}

function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

type HireParser = (value: unknown) => ReturnType<typeof parseMercenaryRosterCheckpoint>;

function hpSurvivesSave(id: MercenaryTemplateId, parse: HireParser): boolean {
  const spawned = spawnedScene(id);
  if (spawned === null) return false;
  const { scene, merc } = spawned;
  const hp = carriedHp(merc);
  merc.hp = hp;
  step(scene);
  const parsed = parse(throughJson(captureMercenaryRoster(scene.roster)));
  if (parsed === undefined) return false;
  const loaded = createMercenaryRoster();
  loaded.floorLevelId = FLOOR;
  restoreMercenaryRoster(loaded, parsed);
  return nextSceneRespawn(scene, loaded)?.hp === hp;
}

/** Spawns the hire a saved roster names and reports its HP. */
function hpFromSavedHire(savedHire: unknown): number | null {
  const parsed = parseMercenaryRosterCheckpoint({ active: savedHire, lastDeceased: null });
  if (parsed?.active === null || parsed === undefined) return null;
  const roster = createMercenaryRoster();
  roster.floorLevelId = FLOOR;
  restoreMercenaryRoster(roster, parsed);
  const scene = buildScene(null);
  return nextSceneRespawn(scene, roster)?.hp ?? null;
}

/** A parser that forgets the hire's health. */
const hpForgettingParser: HireParser = (value) => {
  const parsed = parseMercenaryRosterCheckpoint(value);
  if (!parsed?.active) return parsed;
  const { hp: _forgotten, ...rest } = parsed.active;
  return { ...parsed, active: rest };
};

function checkPersistence(r: SurvivalGateReporter): void {
  r.section('A hire comes back through a door and a save as hurt as it left');
  const id: MercenaryTemplateId = 'dong_quixote';
  const maxHp = getMercenaryTemplate(id).hp;
  r.check(
    hpSurvivesTransition(id, nextSceneRespawn),
    'dismissed at a transition and respawned by the next scene, it keeps its HP',
  );
  r.checkCatches(
    hpSurvivesTransition(id, (scene, roster) => {
      const hired = roster.active;
      if (hired !== null) delete hired.hp;
      return nextSceneRespawn(scene, roster);
    }),
    'a respawn that ignores the recorded HP is caught healing the hire for free',
  );
  r.check(
    hpSurvivesSave(id, parseMercenaryRosterCheckpoint),
    'captured, written, parsed, restored and respawned, it keeps its HP',
  );
  r.checkCatches(hpSurvivesSave(id, hpForgettingParser), 'a parser that drops the HP is caught');

  const base = hireOf(id);
  r.check(
    hpFromSavedHire(base) === maxHp,
    `a save from before HP was recorded spawns it full (${maxHp})`,
  );
  r.check(
    hpFromSavedHire({ ...base, hp: 'lots' }) === maxHp,
    'an unreadable HP keeps the hire, at full health',
  );
  r.check(
    hpFromSavedHire({ ...base, hp: OVER_MAX_HP }) === maxHp,
    'an HP over the maximum is held to it',
  );
  // Read off the parse rather than the spawn: a hire stood up on one hit point
  // drinks its draught on its first frame.
  const zeroParsed = parseMercenaryRosterCheckpoint({
    active: { ...base, hp: 0 },
    lastDeceased: null,
  });
  r.check(
    zeroParsed?.active?.hp === 1 && hpFromSavedHire({ ...base, hp: 0 }) !== null,
    'a zero HP is raised to one: a hire the roster still names is alive, and stands up',
  );
}

// ── Entry ───────────────────────────────────────────────────────────────────

export function verifyHirelingSurvival(r: SurvivalGateReporter): void {
  checkHalfDamage(r);
  checkRecovery(r);
  checkPotions(r);
  checkDowned(r);
  checkRevive(r);
  checkWhoRevives(r);
  checkSwingCancelledByFall(r);
  checkDeath(r);
  checkSaveWaits(r);
  checkPersistence(r);
}
