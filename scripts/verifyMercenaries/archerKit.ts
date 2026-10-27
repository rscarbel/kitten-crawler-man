/**
 * Headless checks on the archer's kit and the system that flies her arrows.
 *
 * - An arrow leaves on the tick the string is loosed, and a hostile it is
 *   aimed at loses health.
 * - Arrows never touch the party: crawlers, Mongo and another hireling
 *   standing in her line of fire keep their health and their footing, while a
 *   hostile on the same spot does not.
 * - An arrow stops at a safe room's threshold, and nothing inside one is hurt.
 * - She backs off from a hostile at arm's length, does not shake between the
 *   back-off and the walk back in while it chases her, and a wall behind her
 *   does not pin her.
 *
 * Every check runs beside a variant that must fail it, so a check that cannot
 * go red is caught here rather than trusted.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { Mercenary } from '../../src/creatures/Mercenary';
import { Mongo } from '../../src/creatures/Mongo';
import { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import {
  ARCHER_SHOT_RELEASE_TICK,
  ARCHER_SHOT_TICKS,
  ArcherKit,
} from '../../src/creatures/mercenaries/archerKit';
import { liveSpawnContext, spawnMob } from '../../src/levels/spawnFunnel';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { HirelingShotSystem, type HirelingShot } from '../../src/systems/HirelingShotSystem';
import { RockThrowSystem } from '../../src/systems/RockThrowSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { normalize } from '../../src/utils';

let failures = 0;
function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

function checkCatches(ruleHolds: boolean, message: string): void {
  check(!ruleHolds, `negative: ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ── Harness ────────────────────────────────────────────────────────────────

const ROOM_TILES = 26;
const ROOM_LAST = ROOM_TILES - 1;
const MERC_TILE_X = 8;
const MERC_TILE_Y = 13;
/** The owner stands behind her, out of the way of anything she fires east. */
const OWNER_OFFSET_TILES = -2;
const CAT_OFFSET_Y_TILES = 2;
const PET_LEVEL = 1;
const PET_STARTING_HP = 40;
const NO_SAFE_ROOM = (): boolean => false;
/** Long enough for several arrows to be loosed and fly. */
const ARROW_FIGHT_FRAMES = 240;
/** Long enough for several arrows to cross the party on their way to the target. */
const FRIENDLY_FIGHT_FRAMES = ARROW_FIGHT_FRAMES;
/** Positions the party may drift by in a fight they are not part of: none. */
const STILL_EPSILON_PX = 0.01;
/** Tile offsets east of her, along her line of fire. */
const NEAR_TILES = 2;
const FAR_TILES = 3;
const BEYOND_TILES = 4;
/** The crowd, east of her. */
const CROWD_OFFSETS: readonly (readonly [number, number])[] = [
  [FAR_TILES, 0],
  [FAR_TILES, -1],
  [FAR_TILES, 1],
  [NEAR_TILES, 0],
];
/** A single target for the bow, inside her holding band so she stands and shoots. */
const LONE_TARGET_OFFSET_TILES = BEYOND_TILES;
/** Goblins levelled until a few arrows cannot kill them, so every hit is still there to measure. */
const STURDY_GOBLIN_LEVEL = 15;

/** How long the chase and the wedge run. */
const CHASE_FRAMES = 420;
const WEDGE_FRAMES = 60;
/** A chasing mob walks at this speed: slower than her, so a retreat can open a gap. */
const CHASER_SPEED_PX = 1.5;
/** The chaser stops this far from her rather than standing inside her. */
const CHASER_CONTACT_TILES = 0.8;
/** Most switches between backing off and standing a whole chase may show. */
const MAX_RETREAT_TOGGLES = 12;
/** Most frames in a chase she may spend stepping toward the thing chasing her. */
const MAX_STEPS_TOWARD_THREAT = 3;
/** Counted as at her shoulder while this close: a step toward it then is a step into its reach. */
const SHOULDER_TILES = 1.6;
/** One tile over: a body at her shoulder, or the owner standing just beside her. */
const ONE_TILE = 1;
/** The room's west border is wall; this is the first floor tile against it. */
const FIRST_TILE_INSIDE_WEST_WALL = 1;
/**
 * The party standing in the line of fire, as tile offsets from her: the
 * crawlers either side of her line of fire, Mongo and another hireling on it,
 * between her and the crowd.
 */
const HUMAN_IN_FIRE: readonly [number, number] = [NEAR_TILES, -1];
const CAT_IN_FIRE: readonly [number, number] = [NEAR_TILES, 1];
const PET_IN_FIRE: readonly [number, number] = [ONE_TILE, 0];
const OTHER_HIRELING_IN_FIRE: readonly [number, number] = [NEAR_TILES, 0];
/** A wedged hireling must have got at least this far along the wall. */
const MIN_WEDGE_ESCAPE_TILES = 0.75;

interface Harness {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly merc: Mercenary;
  readonly kit: ArcherKit;
  readonly shots: HirelingShotSystem;
  readonly ctx: SystemContext;
  readonly allies: Player[];
}

interface HarnessOptions {
  readonly walls?: readonly (readonly [number, number])[];
  readonly safeRoom?: (point: { readonly x: number; readonly y: number }) => boolean;
  readonly mercTile?: readonly [number, number];
}

function makeRoom(walls: readonly (readonly [number, number])[]): GameMap {
  const blocked = new Set(walls.map(([x, y]) => `${x}#${y}`));
  const grid: TileContent[][] = Array.from({ length: ROOM_TILES }, (_, y) =>
    Array.from({ length: ROOM_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOM_LAST || y === ROOM_LAST;
      const solid = isBorder || blocked.has(`${x}#${y}`);
      return { tileId: `${x}#${y}`, type: solid ? FloorTypeValue.wall : FloorTypeValue.tile_floor };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function build(options: HarnessOptions = {}): Harness {
  const map = makeRoom(options.walls ?? []);
  const [mx, my] = options.mercTile ?? [MERC_TILE_X, MERC_TILE_Y];
  const human = new HumanPlayer(mx + OWNER_OFFSET_TILES, my, TILE_SIZE);
  const cat = new CatPlayer(mx + OWNER_OFFSET_TILES, my + CAT_OFFSET_Y_TILES, TILE_SIZE);
  const roster = new MobRoster(map, new SpellSystem());
  const merc = new Mercenary(mx, my, TILE_SIZE, human, 'ivy_ashgrove', 'Ivy Ashgrove');
  roster.add(merc);
  const safeRoom = options.safeRoom ?? NO_SAFE_ROOM;
  merc.cat = cat;
  merc.allMobs = roster.mobs;
  merc.safeRoomTest = safeRoom;
  const allies: Player[] = [human, cat];
  merc.allies = allies;
  const kit = merc.kit;
  if (!(kit instanceof ArcherKit)) throw new Error('ivy_ashgrove is not built on ArcherKit');
  const shots = new HirelingShotSystem(map, safeRoom);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [merc],
  };
  return { map, roster, human, cat, merc, kit, shots, ctx, allies };
}

function addGoblin(h: Harness, offsetX: number, offsetY: number): Mob {
  const tileX = Math.floor(h.merc.x / TILE_SIZE) + offsetX;
  const tileY = Math.floor(h.merc.y / TILE_SIZE) + offsetY;
  const goblin = spawnMob('goblin', { x: tileX, y: tileY }, h.map, liveSpawnContext('dev:spawn'));
  goblin.applyMobLevel(STURDY_GOBLIN_LEVEL);
  h.roster.add(goblin);
  return goblin;
}

/**
 * One frame in `MobUpdateLoop`'s order: the hireling thinks, every shove
 * advances, every mob's timers tick (which is what ages its line-of-sight
 * cache), then the projectile system drains and flies what she loosed. The
 * hostiles themselves stand still, so anything that moves them is her doing.
 */
function frame(h: Harness, drainShots = true): void {
  h.merc.updateAI([]);
  settleMobs(h);
  if (drainShots) h.shots.update(h.ctx);
}

/** The part of a mob frame every body gets, whether or not it thinks. */
function settleMobs(h: Harness): void {
  for (const mob of h.roster.mobs) {
    const ox = mob.x;
    const oy = mob.y;
    mob.advanceKnockback();
    mob.tickTimers();
    h.roster.grid.move(mob, ox, oy);
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface BodyReading {
  readonly hp: number;
  readonly x: number;
  readonly y: number;
}

function read(body: Player): BodyReading {
  return { hp: body.hp, x: body.x, y: body.y };
}

function untouched(before: BodyReading, body: Player): boolean {
  return (
    body.hp === before.hp &&
    Math.abs(body.x - before.x) < STILL_EPSILON_PX &&
    Math.abs(body.y - before.y) < STILL_EPSILON_PX
  );
}

// ── The bow ────────────────────────────────────────────────────────────────

interface ArrowOutcome {
  readonly releasedOnDrawnTick: boolean;
  readonly arrowsSeen: boolean;
  readonly targetHurt: boolean;
}

function fightWithBow(drainShots: boolean): ArrowOutcome {
  const h = build();
  const goblin = addGoblin(h, LONE_TARGET_OFFSET_TILES, 0);
  const startHp = goblin.hp;
  let releasedOnDrawnTick = true;
  let arrowsSeen = false;
  let sawRelease = false;
  for (let f = 0; f < ARROW_FIGHT_FRAMES; f++) {
    const before = h.shots.inFlight;
    frame(h, drainShots);
    const state = h.kit.drawState(h.merc);
    const launched = h.shots.inFlight > before;
    if (launched) arrowsSeen = true;
    if (state.row === 'shoot') {
      const tick = Math.round(state.progress * ARCHER_SHOT_TICKS);
      const onReleaseTick = tick === ARCHER_SHOT_RELEASE_TICK;
      if (onReleaseTick) sawRelease = true;
      if (drainShots && onReleaseTick !== launched) releasedOnDrawnTick = false;
    }
  }
  return {
    releasedOnDrawnTick: releasedOnDrawnTick && sawRelease,
    arrowsSeen,
    targetHurt: goblin.hp < startHp,
  };
}

function checkBow(): void {
  section('Ivy Ashgrove: the bow');
  const fight = fightWithBow(true);
  check(
    fight.releasedOnDrawnTick,
    `each arrow leaves on shoot tick ${ARCHER_SHOT_RELEASE_TICK}, the tick the string is loosed`,
  );
  check(fight.arrowsSeen && fight.targetHurt, 'arrows fly and the goblin she aims at is hurt');
  const undrained = fightWithBow(false);
  checkCatches(
    undrained.arrowsSeen || undrained.targetHurt,
    'a scene that never flies her arrows shows none and hurts nothing',
  );
}

// ── Friendly fire ──────────────────────────────────────────────────────────

interface FriendlyOutcome {
  readonly shotsLoosed: boolean;
  readonly friendsUntouched: boolean;
  readonly hostilesHurt: boolean;
}

/**
 * Stands the party in the arrows' path — the human and the cat themselves,
 * Mongo, and a second hireling — between her and the hostile she is shooting,
 * and runs the fight. With `asHostile`, a hostile goblin takes the other
 * hireling's spot
 * instead, and must be hit: that is what shows the spot is in the line of fire.
 */
function friendlyFight(asHostile: boolean): FriendlyOutcome {
  const h = build();
  const target = addGoblin(h, LONE_TARGET_OFFSET_TILES, 0);
  const placeAt = (body: Player, [dx, dy]: readonly [number, number]): void => {
    body.x = (MERC_TILE_X + dx) * TILE_SIZE;
    body.y = (MERC_TILE_Y + dy) * TILE_SIZE;
  };
  placeAt(h.human, HUMAN_IN_FIRE);
  placeAt(h.cat, CAT_IN_FIRE);
  const friends: Player[] = [h.human, h.cat];
  let decoy: Mob | null = null;
  const [petDx, petDy] = PET_IN_FIRE;
  const [otherDx, otherDy] = OTHER_HIRELING_IN_FIRE;
  if (asHostile) {
    decoy = addGoblin(h, otherDx, otherDy);
  } else {
    const mongo = new Mongo(
      MERC_TILE_X + petDx,
      MERC_TILE_Y + petDy,
      TILE_SIZE,
      h.cat,
      PET_LEVEL,
      PET_STARTING_HP,
    );
    h.roster.add(mongo);
    const other = new Mercenary(
      MERC_TILE_X + otherDx,
      MERC_TILE_Y + otherDy,
      TILE_SIZE,
      h.human,
      'hammer_hands',
      'Hammer Hands',
    );
    h.roster.add(other);
    friends.push(mongo, other);
    h.allies.push(mongo);
  }
  const before = friends.map(read);
  const targetHp = target.hp;
  const decoyHp = decoy?.hp ?? 0;
  let shotsLoosed = false;
  for (let f = 0; f < FRIENDLY_FIGHT_FRAMES; f++) {
    frame(h);
    if (h.shots.inFlight > 0) shotsLoosed = true;
  }
  const friendsUntouched = friends.every((body, i) => untouched(before[i], body));
  const hostilesHurt = decoy === null ? target.hp < targetHp : decoy.hp < decoyHp;
  return { shotsLoosed, friendsUntouched, hostilesHurt };
}

function checkFriendlyFire(): void {
  section('Ivy Ashgrove: no friendly fire');
  const party = friendlyFight(false);
  check(
    party.shotsLoosed && party.friendsUntouched && party.hostilesHurt,
    'crawlers, Mongo and another hireling in the arrows’ path keep their health and footing while the hostiles are hit',
  );
  const decoy = friendlyFight(true);
  check(decoy.hostilesHurt, 'a hostile standing on the ally spot is hit');
  checkCatches(
    !decoy.hostilesHurt,
    'the ally spot is in the line of fire, so sparing it is a real refusal',
  );
}

// ── Kiting ─────────────────────────────────────────────────────────────────

interface ChaseOutcome {
  readonly retreated: boolean;
  readonly toggles: number;
  readonly stepsTowardThreat: number;
}

/** A goblin walks at her and keeps walking at her; she is left to kite it. */
function chase(): ChaseOutcome {
  const h = build();
  const chaser = addGoblin(h, ONE_TILE, 0);
  let retreated = false;
  let toggles = 0;
  let stepsTowardThreat = 0;
  let wasRetreating = h.kit.isRetreating;
  for (let f = 0; f < CHASE_FRAMES; f++) {
    const gap = distance(chaser, h.merc);
    const bx = h.merc.x;
    const by = h.merc.y;
    frame(h, false);
    const toward = normalize(chaser.x - bx, chaser.y - by);
    const step = (h.merc.x - bx) * toward.x + (h.merc.y - by) * toward.y;
    const atShoulder = gap < TILE_SIZE * SHOULDER_TILES;
    if (step > STILL_EPSILON_PX && atShoulder) stepsTowardThreat++;
    if (h.kit.isRetreating) retreated = true;
    if (h.kit.isRetreating !== wasRetreating) toggles++;
    wasRetreating = h.kit.isRetreating;
    const pursuit = normalize(h.merc.x - chaser.x, h.merc.y - chaser.y);
    if (distance(chaser, h.merc) > TILE_SIZE * CHASER_CONTACT_TILES) {
      const ox = chaser.x;
      const oy = chaser.y;
      chaser.x += pursuit.x * CHASER_SPEED_PX;
      chaser.y += pursuit.y * CHASER_SPEED_PX;
      h.roster.grid.move(chaser, ox, oy);
    }
  }
  return { retreated, toggles, stepsTowardThreat };
}

/**
 * She stands with her back to the west wall and a goblin at her east shoulder,
 * so straight away is straight into masonry. With `enclosed`, the tiles north
 * and south of her are walls too, and there is genuinely nowhere to go.
 */
function wedged(enclosed: boolean): number {
  const mx = FIRST_TILE_INSIDE_WEST_WALL;
  const my = MERC_TILE_Y;
  const walls: (readonly [number, number])[] = enclosed
    ? [
        [mx, my - 1],
        [mx, my + 1],
      ]
    : [];
  const h = build({ walls, mercTile: [mx, my] });
  h.human.x = (mx + ONE_TILE) * TILE_SIZE;
  h.human.y = (my + CAT_OFFSET_Y_TILES) * TILE_SIZE;
  const goblin = addGoblin(h, ONE_TILE, 0);
  const start = { x: h.merc.x, y: h.merc.y };
  for (let f = 0; f < WEDGE_FRAMES; f++) {
    frame(h, false);
    // Pinned to her shoulder: straight away from it stays straight into the wall.
    const ox = goblin.x;
    const oy = goblin.y;
    goblin.x = h.merc.x + TILE_SIZE;
    goblin.y = h.merc.y;
    h.roster.grid.move(goblin, ox, oy);
  }
  return distance(h.merc, start) / TILE_SIZE;
}

function checkKiting(): void {
  section('Ivy Ashgrove: kiting');
  const run = chase();
  check(run.retreated, 'a goblin at arm’s length makes her back off');
  check(
    run.toggles <= MAX_RETREAT_TOGGLES,
    `the back-off and the stand take turns at most ${MAX_RETREAT_TOGGLES} times over a ${CHASE_FRAMES}-frame chase (${run.toggles})`,
  );
  check(
    run.stepsTowardThreat <= MAX_STEPS_TOWARD_THREAT,
    `he almost never steps toward a goblin at his shoulder (${run.stepsTowardThreat} frames)`,
  );
  const escaped = wedged(false);
  check(
    escaped >= MIN_WEDGE_ESCAPE_TILES,
    `backed against a wall, he slides along it rather than pushing into it (${escaped.toFixed(2)} tiles)`,
  );
  checkCatches(
    wedged(true) >= MIN_WEDGE_ESCAPE_TILES,
    'boxed in on three sides, the same measurement reports no escape',
  );
}

// ── Shots outlive the shooter ──────────────────────────────────────────────

/** More than any hireling's health. */
const LETHAL_DAMAGE = 10_000;
/** Tumbledown throws from four tiles out; the goblin stands inside that range. */
const THROW_TARGET_OFFSET_TILES = 6;
/** Long enough for a golem to wind up a throw and the boulder to land. */
const THROW_FIGHT_FRAMES = 360;

type Dying = (merc: Mercenary) => void;

/** What the scene does the frame a hireling's HP reaches zero. */
const sceneDeath: Dying = (merc) => merc.beginDeath();
/** A death that takes everything queued with it. */
const wipingDeath: Dying = (merc) => {
  merc.beginDeath();
  merc.clearAirborneAttacks();
};

/**
 * Reads a cue flag the frame's own update may have raised. A function, so the
 * reset just before the update does not narrow the read after it to `false`.
 */
function loosedThisFrame(cueFlag: boolean): boolean {
  return cueFlag;
}

function kill(merc: Mercenary): void {
  merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
}

/**
 * She looses an arrow and dies later in the same frame, before the projectile
 * system drains her outbox — the scene's order, since death interception runs
 * after the mobs think. The arrow must still fly and land.
 */
function arrowOutlivesShooter(die: Dying): boolean {
  const h = build();
  const goblin = addGoblin(h, LONE_TARGET_OFFSET_TILES, 0);
  const startHp = goblin.hp;
  let died = false;
  for (let f = 0; f < ARROW_FIGHT_FRAMES; f++) {
    if (!died) {
      h.merc.attackSoundPending = false;
      h.merc.updateAI([]);
      if (loosedThisFrame(h.merc.attackSoundPending)) {
        kill(h.merc);
        die(h.merc);
        died = true;
      }
    }
    settleMobs(h);
    h.shots.update(h.ctx);
  }
  return died && goblin.hp < startHp;
}

/** The same for Tumbledown's boulder, which `RockThrowSystem` drains. */
function boulderOutlivesThrower(die: Dying): boolean {
  const map = makeRoom([]);
  const human = new HumanPlayer(MERC_TILE_X + OWNER_OFFSET_TILES, MERC_TILE_Y, TILE_SIZE);
  const cat = new CatPlayer(
    MERC_TILE_X + OWNER_OFFSET_TILES,
    MERC_TILE_Y + CAT_OFFSET_Y_TILES,
    TILE_SIZE,
  );
  const roster = new MobRoster(map, new SpellSystem());
  const golem = new Mercenary(
    MERC_TILE_X,
    MERC_TILE_Y,
    TILE_SIZE,
    human,
    'tumbledown',
    'Tumbledown',
  );
  roster.add(golem);
  golem.cat = cat;
  golem.allMobs = roster.mobs;
  golem.allies = [human, cat];
  const goblin = spawnMob(
    'goblin',
    { x: MERC_TILE_X + THROW_TARGET_OFFSET_TILES, y: MERC_TILE_Y },
    map,
    liveSpawnContext('dev:spawn'),
  );
  goblin.applyMobLevel(STURDY_GOBLIN_LEVEL);
  roster.add(goblin);
  const rocks = new RockThrowSystem(map);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [golem],
  };
  const startHp = goblin.hp;
  let died = false;
  for (let f = 0; f < THROW_FIGHT_FRAMES; f++) {
    if (!died) {
      golem.projectileSoundPending = false;
      golem.updateAI([]);
      if (loosedThisFrame(golem.projectileSoundPending)) {
        kill(golem);
        die(golem);
        died = true;
      }
    }
    for (const mob of roster.mobs) {
      const ox = mob.x;
      const oy = mob.y;
      mob.advanceKnockback();
      mob.tickTimers();
      roster.grid.move(mob, ox, oy);
    }
    rocks.update(ctx);
  }
  return died && goblin.hp < startHp;
}

function checkShotsOutliveShooter(): void {
  section('Hireling shots outlive the hireling');
  check(
    arrowOutlivesShooter(sceneDeath),
    'an arrow loosed on the frame Ivy Ashgrove dies still flies and lands',
  );
  checkCatches(arrowOutlivesShooter(wipingDeath), 'a death that wipes her outbox loses the arrow');
  check(
    boulderOutlivesThrower(sceneDeath),
    'a boulder thrown on the frame Tumbledown dies still flies and lands',
  );
  checkCatches(
    boulderOutlivesThrower(wipingDeath),
    'a death that wipes his outbox loses the boulder',
  );
}

// ── Arrows stop at a safe room ─────────────────────────────────────────────

/** The safe room's west edge, this many tiles east of her: the crowd is inside, she is not. */
const SAFE_ROOM_WEST_EDGE_TILES = 1.5;
const SAFE_ROOM_WEST_EDGE_PX = (MERC_TILE_X + SAFE_ROOM_WEST_EDGE_TILES) * TILE_SIZE;
type SafeTest = (point: { readonly x: number; readonly y: number }) => boolean;
/** The room as the scene has it: bodies and points alike. */
const SAFE_EAST_OF_HIM: SafeTest = (point) => point.x >= SAFE_ROOM_WEST_EDGE_PX;
/**
 * The room answering only for points an arrow travels through, never for a
 * body. Leaves the threshold test as the one thing between the arrow and the
 * crowd, so it is measured on its own.
 */
const SAFE_FOR_POINTS_ONLY: SafeTest = (point) =>
  !(point instanceof Mob) && point.x >= SAFE_ROOM_WEST_EDGE_PX;

/** She stands outside; the crowd stands inside. She must not open fire. */
function crowdInsideSafeRoomUnhurt(safeRoom: SafeTest): boolean {
  const h = build({ safeRoom });
  const crowd = CROWD_OFFSETS.map(([dx, dy]) => addGoblin(h, dx, dy));
  const startHp = crowd.map((mob) => mob.hp);
  for (let f = 0; f < ARROW_FIGHT_FRAMES; f++) frame(h);
  return crowd.every((mob, i) => mob.hp === startHp[i]);
}

/**
 * Hands the system an arrow straight down the spine at a goblin in the safe
 * room, from a hireling that is never asked to think: the kit's own refusals
 * are out of the way, and only the system's are measured.
 */
function injectedArrowSpares(safeRoom: SafeTest): boolean {
  const h = build({ safeRoom });
  const victim = addGoblin(h, FAR_TILES, 0);
  const startHp = victim.hp;
  const origin = { x: h.merc.x + TILE_SIZE / 2, y: h.merc.y + TILE_SIZE / 2 };
  const shots: HirelingShot[] = [
    {
      kind: 'arrow',
      x: origin.x,
      y: origin.y,
      dirX: 1,
      dirY: 0,
      damage: INJECTED_DAMAGE,
      rangePx: TILE_SIZE * INJECTED_RANGE_TILES,
      shooter: h.merc,
      owner: h.human,
    },
  ];
  let handed = false;
  Object.defineProperty(h.merc, 'takePendingHirelingShots', {
    value: (): readonly HirelingShot[] => {
      if (handed) return [];
      handed = true;
      return shots;
    },
  });
  for (let f = 0; f < INJECTED_FLIGHT_FRAMES; f++) {
    settleMobs(h);
    h.shots.update(h.ctx);
  }
  return victim.hp === startHp;
}

/** Damage the injected arrow carries: enough to show, not enough to kill a sturdy goblin. */
const INJECTED_DAMAGE = 5;
/** Far enough for the arrow to reach well past the goblin. */
const INJECTED_RANGE_TILES = 6;
/** Long enough for the arrow to fly its whole range. */
const INJECTED_FLIGHT_FRAMES = 60;

function checkSafeRoomTarget(): void {
  section('Ivy Ashgrove: a crowd inside a safe room');
  check(
    crowdInsideSafeRoomUnhurt(SAFE_EAST_OF_HIM),
    'from outside, she does not shoot a crowd standing in a safe room',
  );
  checkCatches(crowdInsideSafeRoomUnhurt(NO_SAFE_ROOM), 'the same crowd with no safe room is hurt');
  const bodyOnly: SafeTest = (point) => point instanceof Mob && point.x >= SAFE_ROOM_WEST_EDGE_PX;
  check(
    injectedArrowSpares(bodyOnly),
    'an arrow that reaches a body standing in a safe room does not hurt it',
  );
  check(injectedArrowSpares(SAFE_FOR_POINTS_ONLY), 'an arrow stops at the safe room threshold');
  checkCatches(
    injectedArrowSpares(NO_SAFE_ROOM),
    'the same arrow with no safe room hurts the goblin',
  );
}

// ── Whom she runs from ──────────────────────────────────────────────────────

/** A mob this far off is inside arm's length but not in contact. */
const STAND_OFF_TILES = 1.3;
/** How far a closing mob creeps toward her each frame. */
const CREEP_PX = 0.3;
/**
 * How long the stand-off and corner cases run: past one whole shot, since a
 * mob first seen at arm's length has no step to judge yet and may be shot at
 * once before it is recognised as closing.
 */
/** Frames past the shot a closing mob is given to be recognised. */
const THREAT_MARGIN_FRAMES = 28;
const THREAT_FRAMES = ARCHER_SHOT_TICKS + THREAT_MARGIN_FRAMES;
/** How long a too-close target is given to be eased away from. */
const EASE_FRAMES = 180;
/** The ease-back must end within this of the band's near edge. */
const EASE_TOLERANCE_TILES = 0.2;
const HOLD_MIN_TILES = 3;
/** A target she has no need to ease back from: already inside the band. */
const IN_BAND_TILES = 3.5;
/** Most times the ease-back may start and stop over one run. */
const MAX_EASE_TOGGLES = 4;

/** A creeping mob stops a body's width off, as a mob walking at another does. */
const CREEP_STOP_TILES = 1;

function creepToward(h: Harness, mob: Mob): void {
  if (distance(mob, h.merc) <= TILE_SIZE * CREEP_STOP_TILES) return;
  const dir = normalize(h.merc.x - mob.x, h.merc.y - mob.y);
  const ox = mob.x;
  const oy = mob.y;
  mob.x += dir.x * CREEP_PX;
  mob.y += dir.y * CREEP_PX;
  h.roster.grid.move(mob, ox, oy);
}

/** Did a mob at arm's length make her retreat? */
function retreatsFrom(setup: {
  readonly offset: readonly [number, number];
  readonly closing: boolean;
  readonly walls?: readonly (readonly [number, number])[];
  /**
   * Holds her on her tile, so the geometry under test — a wall corner between
   * her and the mob — is the same on the last frame as the first, however
   * long the run lasts and whatever an ease-back would have done.
   */
  readonly pinned?: boolean;
}): boolean {
  const walls = (setup.walls ?? []).map(([dx, dy]): readonly [number, number] => [
    MERC_TILE_X + dx,
    MERC_TILE_Y + dy,
  ]);
  const h = build({ walls });
  const [dx, dy] = setup.offset;
  const mob = addGoblin(h, 0, 0);
  const ox = mob.x;
  const oy = mob.y;
  mob.x = h.merc.x + dx * TILE_SIZE;
  mob.y = h.merc.y + dy * TILE_SIZE;
  h.roster.grid.move(mob, ox, oy);
  const startX = h.merc.x;
  const startY = h.merc.y;
  for (let f = 0; f < THREAT_FRAMES; f++) {
    frame(h, false);
    if (h.kit.isRetreating) return true;
    if (setup.pinned === true) {
      h.merc.x = startX;
      h.merc.y = startY;
    }
    if (setup.closing) creepToward(h, mob);
  }
  return false;
}

/** Just inside arm's length, for the one-step case. */
const ONE_STEP_START_TILES = 1.45;
/** The single step the mob takes as her shot begins. */
const ONE_STEP_TILES = 0.15;
/** Long enough to outlast several shots after that step. */
const ONE_STEP_WATCH_FRAMES = 200;

/**
 * A goblin at arm's length takes one step toward her as her shot starts, then
 * stands. With `keepWalking`, it goes on creeping in instead. Did she retreat?
 */
function retreatsAfterOneStep(keepWalking: boolean): boolean {
  const h = build();
  const mob = addGoblin(h, 0, 0);
  const ox = mob.x;
  mob.x = h.merc.x + ONE_STEP_START_TILES * TILE_SIZE;
  h.roster.grid.move(mob, ox, mob.y);
  let stepped = false;
  for (let f = 0; f < ONE_STEP_WATCH_FRAMES; f++) {
    frame(h, false);
    if (h.kit.isRetreating) return true;
    const shooting = h.kit.drawState(h.merc).row === 'shoot';
    if (shooting && !stepped) {
      stepped = true;
      const bx = mob.x;
      mob.x -= ONE_STEP_TILES * TILE_SIZE;
      h.roster.grid.move(mob, bx, mob.y);
    } else if (stepped && keepWalking) {
      creepToward(h, mob);
    }
  }
  return false;
}

interface EaseOutcome {
  readonly finalTiles: number;
  readonly toggles: number;
  readonly retreated: boolean;
}

function easeFrom(startTiles: number): EaseOutcome {
  const h = build();
  const target = addGoblin(h, 0, 0);
  const ox = target.x;
  target.x = h.merc.x + startTiles * TILE_SIZE;
  h.roster.grid.move(target, ox, target.y);
  let toggles = 0;
  let was = h.kit.isEasingBack;
  let retreated = false;
  for (let f = 0; f < EASE_FRAMES; f++) {
    frame(h, false);
    if (h.kit.isEasingBack !== was) toggles++;
    was = h.kit.isEasingBack;
    if (h.kit.isRetreating) retreated = true;
  }
  return { finalTiles: distance(target, h.merc) / TILE_SIZE, toggles, retreated };
}

function checkThreats(): void {
  section('Ivy Ashgrove: whom she runs from, and how far she stands');
  const standOff: readonly [number, number] = [STAND_OFF_TILES, 0];
  check(
    !retreatsFrom({ offset: standOff, closing: false }),
    `a mob standing off at ${STAND_OFF_TILES} tiles, not closing, is shot rather than run from`,
  );
  checkCatches(
    !retreatsFrom({ offset: standOff, closing: true }),
    'the same mob still closing on him does make him retreat',
  );
  const diagonal: readonly [number, number] = [ONE_TILE, ONE_TILE];
  const corner: readonly (readonly [number, number])[] = [
    [ONE_TILE, 0],
    [0, ONE_TILE],
  ];
  check(
    !retreatsFrom({ offset: diagonal, closing: true, walls: corner, pinned: true }),
    'a mob across a wall corner, diagonally close but out of reach, is not run from',
  );
  checkCatches(
    !retreatsFrom({ offset: diagonal, closing: true, pinned: true }),
    'the same diagonal mob with no corner between them is',
  );

  check(
    !retreatsAfterOneStep(false),
    'one step toward him during a shot, then standing still, is not taken for a charge',
  );
  checkCatches(
    !retreatsAfterOneStep(true),
    'the same goblin walking on in after that step does make him retreat',
  );

  const close = easeFrom(NEAR_TILES);
  check(
    Math.abs(close.finalTiles - HOLD_MIN_TILES) <= EASE_TOLERANCE_TILES &&
      close.toggles <= MAX_EASE_TOGGLES &&
      !close.retreated,
    `a target standing ${NEAR_TILES} tiles off is eased back to about ${HOLD_MIN_TILES} (${close.finalTiles.toFixed(2)} tiles, ${close.toggles} starts and stops, no retreat)`,
  );
  const inBand = easeFrom(IN_BAND_TILES);
  checkCatches(
    Math.abs(inBand.finalTiles - IN_BAND_TILES) > EASE_TOLERANCE_TILES,
    `a target already in the band at ${IN_BAND_TILES} tiles stays where it was (${inBand.finalTiles.toFixed(2)} tiles)`,
  );
}

/** Runs every archer check and returns how many failed. */
export function verifyArcherKit(): number {
  failures = 0;
  checkBow();
  checkFriendlyFire();
  checkKiting();
  checkShotsOutliveShooter();
  checkSafeRoomTarget();
  checkThreats();
  return failures;
}
