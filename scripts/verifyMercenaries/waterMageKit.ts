/**
 * Headless checks on Splash Zone's kit and the system that flies his water.
 *
 * - A bolt leaves on the tick the crossbow is drawn empty, and a hostile it
 *   is aimed at loses health.
 * - A crowd of three in front of him brings the wave, and the wave's effect is
 *   measured on the crowd: every one of them is hurt and carried back. Two is
 *   not a crowd.
 * - Water stops at a wall: a hostile behind one is neither counted nor hit.
 * - The wave never goes off in a safe room.
 * - Neither shot touches the party: crawlers, Mongo and another hireling
 *   standing in the cone or the bolt's path keep their health and their
 *   footing, while a hostile on the same spot does not.
 * - He backs off from a hostile at arm's length, does not shake between the
 *   back-off and the walk back in while it chases him, and a wall behind him
 *   does not pin him.
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
import { WaterMageKit } from '../../src/creatures/mercenaries/waterMageKit';
import { createMob } from '../../src/levels/spawner';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { HirelingBoltSystem, type HirelingShot } from '../../src/systems/HirelingBoltSystem';
import { RockThrowSystem } from '../../src/systems/RockThrowSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { normalize } from '../../src/utils';
import {
  SPLASH_ZONE_SHOOT_RELEASE_TICK,
  SPLASH_ZONE_SHOOT_TICKS,
} from '../../src/sprites/splashZoneTiming';

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
/** The owner stands behind him, out of the way of anything he fires east. */
const OWNER_OFFSET_TILES = -2;
const CAT_OFFSET_Y_TILES = 2;
const PET_LEVEL = 1;
const PET_STARTING_HP = 40;
const NO_SAFE_ROOM = (): boolean => false;
/**
 * A safe room covering him and his crawler but not the crowd east of him: he
 * stands in the doorway with the fight outside. Every hostile is outside it, so
 * only the rule about where the caster stands can hold the wave back.
 */
const SAFE_ROOM_EAST_EDGE_TILES = 1;
const SAFE_BEHIND_HIM = (point: { readonly x: number }): boolean =>
  point.x < (MERC_TILE_X + SAFE_ROOM_EAST_EDGE_TILES) * TILE_SIZE;

/** Long enough for a wave to be cast, roll its whole reach and let everyone land. */
const WAVE_FIGHT_FRAMES = 150;
/** Long enough for several bolts to be loosed and fly. */
const BOLT_FIGHT_FRAMES = 240;
/** A swept body must end up at least this much further from him than it started. */
const MIN_CARRY_TILES = 1.2;
/** Positions the party may drift by in a fight they are not part of: none. */
const STILL_EPSILON_PX = 0.01;
/** Tile offsets east of him, all inside the cone. */
const NEAR_TILES = 2;
const FAR_TILES = 3;
const BEYOND_TILES = 4;
/** The crowd, east of him and inside the cone. */
const CROWD_OFFSETS: readonly (readonly [number, number])[] = [
  [FAR_TILES, 0],
  [FAR_TILES, -1],
  [FAR_TILES, 1],
  [NEAR_TILES, 0],
];
const PAIR_OFFSETS = CROWD_OFFSETS.slice(0, 2);
/** The smallest crowd that should bring the wave. */
const SMALLEST_CROWD = 3;
const THREE_OFFSETS = CROWD_OFFSETS.slice(0, SMALLEST_CROWD);
/** A single target for the crossbow, inside his holding band so he stands and shoots. */
const LONE_TARGET_OFFSET_TILES = BEYOND_TILES;
/**
 * Goblins levelled until one wave and a bolt cannot kill them: a body that
 * dies to the water is never carried, and the carry is what is measured.
 */
const STURDY_GOBLIN_LEVEL = 15;
/**
 * The behind-the-wall check: a crowd clear of the wall, a hostile inside the
 * cone further out, and two wall tiles across the line to it.
 */
const WALLED_CROWD_OFFSETS: readonly (readonly [number, number])[] = [
  [NEAR_TILES, 0],
  [FAR_TILES, 0],
  [NEAR_TILES, -1],
];
const WALL_OFFSETS: readonly (readonly [number, number])[] = [
  [FAR_TILES, 1],
  [FAR_TILES, NEAR_TILES],
];
const BEHIND_WALL_OFFSET: readonly [number, number] = [BEYOND_TILES, NEAR_TILES];

/** How long the chase and the wedge run. */
const CHASE_FRAMES = 420;
const WEDGE_FRAMES = 60;
/** A chasing mob walks at this speed: slower than him, so a retreat can open a gap. */
const CHASER_SPEED_PX = 1.5;
/** The chaser stops this far from him rather than standing inside him. */
const CHASER_CONTACT_TILES = 0.8;
/** Most switches between backing off and standing a whole chase may show. */
const MAX_RETREAT_TOGGLES = 12;
/** Most frames in a chase he may spend stepping toward the thing chasing him. */
const MAX_STEPS_TOWARD_THREAT = 3;
/** Counted as at his shoulder while this close: a step toward it then is a step into its reach. */
const SHOULDER_TILES = 1.6;
/** One tile over: a body at his shoulder, or the owner standing just beside him. */
const ONE_TILE = 1;
/** The room's west border is wall; this is the first floor tile against it. */
const FIRST_TILE_INSIDE_WEST_WALL = 1;
/**
 * The party standing in the line of fire, as tile offsets from him: the
 * crawlers either side of the cone's spine, Mongo and another hireling on it,
 * between him and the crowd.
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
  readonly kit: WaterMageKit;
  readonly shots: HirelingBoltSystem;
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
  const merc = new Mercenary(mx, my, TILE_SIZE, human, 'splash_zone', 'Splash Zone');
  roster.add(merc);
  const safeRoom = options.safeRoom ?? NO_SAFE_ROOM;
  merc.cat = cat;
  merc.allMobs = roster.mobs;
  merc.safeRoomTest = safeRoom;
  const allies: Player[] = [human, cat];
  merc.allies = allies;
  const kit = merc.kit;
  if (!(kit instanceof WaterMageKit)) throw new Error('splash_zone is not built on WaterMageKit');
  const shots = new HirelingBoltSystem(map, safeRoom);
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
  const goblin = createMob('goblin', tileX, tileY, h.map);
  goblin.applyMobLevel(STURDY_GOBLIN_LEVEL);
  h.roster.add(goblin);
  return goblin;
}

/**
 * One frame in `MobUpdateLoop`'s order: the hireling thinks, every shove
 * advances, every mob's timers tick (which is what ages its line-of-sight
 * cache), then the projectile system drains and flies what he loosed. The
 * hostiles themselves stand still, so anything that moves them is the water.
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

// ── The crossbow ───────────────────────────────────────────────────────────

interface BoltOutcome {
  readonly releasedOnDrawnTick: boolean;
  readonly boltsSeen: boolean;
  readonly targetHurt: boolean;
}

function fightWithCrossbow(drainShots: boolean): BoltOutcome {
  const h = build();
  const goblin = addGoblin(h, LONE_TARGET_OFFSET_TILES, 0);
  const startHp = goblin.hp;
  let releasedOnDrawnTick = true;
  let boltsSeen = false;
  let sawRelease = false;
  for (let f = 0; f < BOLT_FIGHT_FRAMES; f++) {
    const before = h.shots.inFlight.bolts;
    frame(h, drainShots);
    const state = h.kit.drawState(h.merc);
    const launched = h.shots.inFlight.bolts > before;
    if (launched) boltsSeen = true;
    if (state.row === 'shoot') {
      const tick = Math.round(state.progress * SPLASH_ZONE_SHOOT_TICKS);
      const onReleaseTick = tick === SPLASH_ZONE_SHOOT_RELEASE_TICK;
      if (onReleaseTick) sawRelease = true;
      if (drainShots && onReleaseTick !== launched) releasedOnDrawnTick = false;
    }
  }
  return {
    releasedOnDrawnTick: releasedOnDrawnTick && sawRelease,
    boltsSeen,
    targetHurt: goblin.hp < startHp,
  };
}

function checkCrossbow(): void {
  section('Splash Zone: the crossbow');
  const fight = fightWithCrossbow(true);
  check(
    fight.releasedOnDrawnTick,
    `each bolt leaves on shoot tick ${SPLASH_ZONE_SHOOT_RELEASE_TICK}, the tick the crossbow is drawn empty`,
  );
  check(fight.boltsSeen && fight.targetHurt, 'bolts fly and the goblin he aims at is hurt');
  const undrained = fightWithCrossbow(false);
  checkCatches(
    undrained.boltsSeen || undrained.targetHurt,
    'a scene that never flies his bolts shows none and hurts nothing',
  );
}

// ── The wave ───────────────────────────────────────────────────────────────

interface WaveOutcome {
  readonly cast: boolean;
  readonly hurt: number;
  readonly carried: number;
  readonly total: number;
  readonly behindWallHit: boolean;
  readonly cooldownArmed: boolean;
}

interface WaveSetup {
  readonly offsets: readonly (readonly [number, number])[];
  readonly drainShots?: boolean;
  readonly safeRoom?: (point: { readonly x: number; readonly y: number }) => boolean;
  readonly wallBetween?: boolean;
}

function waveFight(setup: WaveSetup): WaveOutcome {
  const walls: (readonly [number, number])[] = [];
  if (setup.wallBetween === true) {
    for (const [dx, dy] of WALL_OFFSETS) walls.push([MERC_TILE_X + dx, MERC_TILE_Y + dy]);
  }
  const h = build({ walls, safeRoom: setup.safeRoom });
  const crowd = setup.offsets.map(([dx, dy]) => addGoblin(h, dx, dy));
  const [hiddenDx, hiddenDy] = BEHIND_WALL_OFFSET;
  const hidden = setup.wallBetween === true ? addGoblin(h, hiddenDx, hiddenDy) : null;
  const hiddenHp = hidden?.hp ?? 0;
  const startHp = crowd.map((mob) => mob.hp);
  // Measured from where he stood when it started: he may walk after the wave.
  const castFrom = { x: h.merc.x, y: h.merc.y };
  const startDistance = crowd.map((mob) => distance(mob, castFrom));
  let cast = false;
  let cooldownArmed = false;
  for (let f = 0; f < WAVE_FIGHT_FRAMES; f++) {
    frame(h, setup.drainShots ?? true);
    if (h.kit.drawState(h.merc).row === 'cast_wave') cast = true;
    if (h.kit.waveCooldownFrames > 0) cooldownArmed = true;
  }
  let hurt = 0;
  let carried = 0;
  crowd.forEach((mob, i) => {
    if (mob.hp < (startHp[i] ?? 0)) hurt++;
    const pushed = distance(mob, castFrom) - (startDistance[i] ?? 0);
    if (pushed >= TILE_SIZE * MIN_CARRY_TILES) carried++;
  });
  return {
    cast,
    hurt,
    carried,
    total: crowd.length,
    behindWallHit: hidden !== null && hidden.hp < hiddenHp,
    cooldownArmed,
  };
}

function waveSweptEveryone(outcome: WaveOutcome): boolean {
  return (
    outcome.cast &&
    outcome.hurt === outcome.total &&
    outcome.carried === outcome.total &&
    outcome.total > 0
  );
}

function checkWave(): void {
  section('Splash Zone: the Wet Spot wave');
  const crowd = waveFight({ offsets: CROWD_OFFSETS });
  check(
    waveSweptEveryone(crowd),
    `a crowd of ${crowd.total} brings the wave, and it hurts ${crowd.hurt} and carries ${crowd.carried} back at least ${MIN_CARRY_TILES} tiles`,
  );
  check(crowd.cooldownArmed, 'casting it starts the wave cooldown');
  const three = waveFight({ offsets: THREE_OFFSETS });
  check(waveSweptEveryone(three), 'three hostiles are a crowd');
  const pair = waveFight({ offsets: PAIR_OFFSETS });
  check(!pair.cast, 'two hostiles are not a crowd: no wave');
  checkCatches(
    waveSweptEveryone(waveFight({ offsets: CROWD_OFFSETS, drainShots: false })),
    'a wave that is cast but never rolls does not pass as a sweep',
  );

  const walled = waveFight({ offsets: WALLED_CROWD_OFFSETS, wallBetween: true });
  check(walled.cast && !walled.behindWallHit, 'a hostile behind a wall inside the cone is not hit');
  const openBehind = waveFight({ offsets: [...WALLED_CROWD_OFFSETS, BEHIND_WALL_OFFSET] });
  check(
    openBehind.cast && openBehind.hurt === openBehind.total,
    'the same spot with no wall is hit, so the wall check can tell the difference',
  );

  const safe = waveFight({ offsets: CROWD_OFFSETS, safeRoom: SAFE_BEHIND_HIM });
  check(
    !safe.cast && safe.hurt === 0,
    'standing in a safe room with the crowd outside, he neither casts the wave nor shoots',
  );
  checkCatches(
    !waveFight({ offsets: CROWD_OFFSETS }).cast,
    'the same crowd outside a safe room does bring the wave',
  );
}

// ── Friendly fire ──────────────────────────────────────────────────────────

interface FriendlyOutcome {
  readonly waveCast: boolean;
  readonly friendsUntouched: boolean;
  readonly hostilesHurt: boolean;
}

/**
 * Stands the party in the wave's cone and the bolt's path — the human and the
 * cat themselves, Mongo, and a second hireling — beside three hostiles, and
 * runs the fight. With `asHostile`, a hostile goblin takes Mongo's spot
 * instead, and must be hit: that is what shows the spot is in the line of fire.
 */
function friendlyFight(asHostile: boolean): FriendlyOutcome {
  const h = build();
  const hostiles = THREE_OFFSETS.map(([dx, dy]) => addGoblin(h, dx, dy));
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
    decoy = addGoblin(h, petDx, petDy);
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
      'bomo',
      'Bomo',
    );
    h.roster.add(other);
    friends.push(mongo, other);
    h.allies.push(mongo);
  }
  const before = friends.map(read);
  const hostileHp = hostiles.map((mob) => mob.hp);
  const decoyHp = decoy?.hp ?? 0;
  let waveCast = false;
  for (let f = 0; f < BOLT_FIGHT_FRAMES; f++) {
    frame(h);
    if (h.kit.drawState(h.merc).row === 'cast_wave') waveCast = true;
  }
  const friendsUntouched = friends.every((body, i) => untouched(before[i], body));
  const crowdHurt = hostiles.every((mob, i) => mob.hp < (hostileHp[i] ?? 0));
  const decoyHurt = decoy === null || decoy.hp < decoyHp;
  return { waveCast, friendsUntouched, hostilesHurt: crowdHurt && decoyHurt };
}

function checkFriendlyFire(): void {
  section('Splash Zone: no friendly fire');
  const party = friendlyFight(false);
  check(
    party.waveCast && party.friendsUntouched && party.hostilesHurt,
    'crawlers, Mongo and another hireling in the wave and the bolts keep their health and footing while the hostiles are hit',
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

/** A goblin walks at him and keeps walking at him; he is left to kite it. */
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
 * He stands with his back to the west wall and a goblin at his east shoulder,
 * so straight away is straight into masonry. With `enclosed`, the tiles north
 * and south of him are walls too, and there is genuinely nowhere to go.
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
    // Pinned to his shoulder: straight away from it stays straight into the wall.
    const ox = goblin.x;
    const oy = goblin.y;
    goblin.x = h.merc.x + TILE_SIZE;
    goblin.y = h.merc.y;
    h.roster.grid.move(goblin, ox, oy);
  }
  return distance(h.merc, start) / TILE_SIZE;
}

function checkKiting(): void {
  section('Splash Zone: kiting');
  const run = chase();
  check(run.retreated, 'a goblin at arm’s length makes him back off');
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
 * He looses a bolt and dies later in the same frame, before the projectile
 * system drains his outbox — the scene's order, since death interception runs
 * after the mobs think. The bolt must still fly and land.
 */
function boltOutlivesShooter(die: Dying): boolean {
  const h = build();
  const goblin = addGoblin(h, LONE_TARGET_OFFSET_TILES, 0);
  const startHp = goblin.hp;
  let died = false;
  for (let f = 0; f < BOLT_FIGHT_FRAMES; f++) {
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
  const goblin = createMob('goblin', MERC_TILE_X + THROW_TARGET_OFFSET_TILES, MERC_TILE_Y, map);
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
    boltOutlivesShooter(sceneDeath),
    'a bolt loosed on the frame Splash Zone dies still flies and lands',
  );
  checkCatches(boltOutlivesShooter(wipingDeath), 'a death that wipes his outbox loses the bolt');
  check(
    boulderOutlivesThrower(sceneDeath),
    'a boulder thrown on the frame Tumbledown dies still flies and lands',
  );
  checkCatches(
    boulderOutlivesThrower(wipingDeath),
    'a death that wipes his outbox loses the boulder',
  );
}

// ── Water stops at a safe room ─────────────────────────────────────────────

/** The safe room's west edge, this many tiles east of him: the crowd is inside, he is not. */
const SAFE_ROOM_WEST_EDGE_TILES = 1.5;
const SAFE_ROOM_WEST_EDGE_PX = (MERC_TILE_X + SAFE_ROOM_WEST_EDGE_TILES) * TILE_SIZE;
type SafeTest = (point: { readonly x: number; readonly y: number }) => boolean;
/** The room as the scene has it: bodies and points alike. */
const SAFE_EAST_OF_HIM: SafeTest = (point) => point.x >= SAFE_ROOM_WEST_EDGE_PX;
/**
 * The room answering only for points the water travels through, never for a
 * body. Leaves the threshold tests as the one thing between the water and the
 * crowd, so each is measured on its own.
 */
const SAFE_FOR_POINTS_ONLY: SafeTest = (point) =>
  !(point instanceof Mob) && point.x >= SAFE_ROOM_WEST_EDGE_PX;

/** He stands outside; the crowd stands inside. He must not open fire. */
function crowdInsideSafeRoomUnhurt(safeRoom: SafeTest): boolean {
  const h = build({ safeRoom });
  const crowd = CROWD_OFFSETS.map(([dx, dy]) => addGoblin(h, dx, dy));
  const startHp = crowd.map((mob) => mob.hp);
  for (let f = 0; f < BOLT_FIGHT_FRAMES; f++) frame(h);
  return crowd.every((mob, i) => mob.hp === startHp[i]);
}

/**
 * Hands the system a bolt and a wave straight down the spine at a goblin in
 * the safe room, from a hireling that is never asked to think: the kit's own
 * refusals are out of the way, and only the system's are measured.
 */
function injectedShotsSpare(safeRoom: SafeTest, kinds: readonly HirelingShot['kind'][]): boolean {
  const h = build({ safeRoom });
  const victim = addGoblin(h, FAR_TILES, 0);
  const startHp = victim.hp;
  const origin = { x: h.merc.x + TILE_SIZE / 2, y: h.merc.y + TILE_SIZE / 2 };
  const shots: HirelingShot[] = [];
  if (kinds.includes('bolt')) {
    shots.push({
      kind: 'bolt',
      bolt: {
        x: origin.x,
        y: origin.y,
        dirX: 1,
        dirY: 0,
        damage: INJECTED_DAMAGE,
        rangePx: TILE_SIZE * BOLT_FIGHT_RANGE_TILES,
        shooter: h.merc,
        owner: h.human,
      },
    });
  }
  if (kinds.includes('wave')) {
    shots.push({
      kind: 'wave',
      wave: {
        originX: origin.x,
        originY: origin.y,
        heading: 0,
        halfAngle: INJECTED_WAVE_HALF_ANGLE,
        reachPx: TILE_SIZE * BOLT_FIGHT_RANGE_TILES,
        damage: INJECTED_DAMAGE,
        caster: h.merc,
        owner: h.human,
      },
    });
  }
  let handed = false;
  Object.defineProperty(h.merc, 'takePendingShots', {
    value: (): readonly HirelingShot[] => {
      if (handed) return [];
      handed = true;
      return shots;
    },
  });
  for (let f = 0; f < WAVE_FIGHT_FRAMES; f++) {
    settleMobs(h);
    h.shots.update(h.ctx);
  }
  return victim.hp === startHp;
}

/** Damage the injected shots carry: enough to show, not enough to kill a sturdy goblin. */
const INJECTED_DAMAGE = 5;
/** Far enough for either shot to reach well past the goblin. */
const BOLT_FIGHT_RANGE_TILES = 6;
/** Thirty degrees either side, like his own wave. */
const INJECTED_WAVE_HALF_ANGLE_DEGREES = 30;
const DEGREES_PER_HALF_TURN = 180;
const INJECTED_WAVE_HALF_ANGLE =
  (INJECTED_WAVE_HALF_ANGLE_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;

function checkSafeRoomTarget(): void {
  section('Splash Zone: a crowd inside a safe room');
  check(
    crowdInsideSafeRoomUnhurt(SAFE_EAST_OF_HIM),
    'from outside, he neither shoots nor washes a crowd standing in a safe room',
  );
  checkCatches(crowdInsideSafeRoomUnhurt(NO_SAFE_ROOM), 'the same crowd with no safe room is hurt');
  const bodyOnly: SafeTest = (point) => point instanceof Mob && point.x >= SAFE_ROOM_WEST_EDGE_PX;
  check(
    injectedShotsSpare(bodyOnly, ['bolt', 'wave']),
    'water that reaches a body standing in a safe room does not hurt it',
  );
  check(
    injectedShotsSpare(SAFE_FOR_POINTS_ONLY, ['bolt']),
    'a bolt stops at the safe room threshold',
  );
  check(
    injectedShotsSpare(SAFE_FOR_POINTS_ONLY, ['wave']),
    'a wave stops at the safe room threshold',
  );
  checkCatches(
    injectedShotsSpare(NO_SAFE_ROOM, ['bolt']) || injectedShotsSpare(NO_SAFE_ROOM, ['wave']),
    'the same bolt and wave with no safe room each hurt the goblin',
  );
}

// ── Whom he runs from ──────────────────────────────────────────────────────

/** A mob this far off is inside arm's length but not in contact. */
const STAND_OFF_TILES = 1.3;
/** How far a closing mob creeps toward him each frame. */
const CREEP_PX = 0.3;
/**
 * How long the stand-off and corner cases run: past one whole shot, since a
 * mob first seen at arm's length has no step to judge yet and may be shot at
 * once before it is recognised as closing.
 */
const THREAT_FRAMES = 60;
/** How long a too-close target is given to be eased away from. */
const EASE_FRAMES = 180;
/** The ease-back must end within this of the band's near edge. */
const EASE_TOLERANCE_TILES = 0.2;
const HOLD_MIN_TILES = 3;
/** A target he has no need to ease back from: already inside the band. */
const IN_BAND_TILES = 3.5;
/** Most times the ease-back may start and stop over one run. */
const MAX_EASE_TOGGLES = 4;

function creepToward(h: Harness, mob: Mob): void {
  const dir = normalize(h.merc.x - mob.x, h.merc.y - mob.y);
  const ox = mob.x;
  const oy = mob.y;
  mob.x += dir.x * CREEP_PX;
  mob.y += dir.y * CREEP_PX;
  h.roster.grid.move(mob, ox, oy);
}

/** Did a mob at arm's length make him retreat? */
function retreatsFrom(setup: {
  readonly offset: readonly [number, number];
  readonly closing: boolean;
  readonly walls?: readonly (readonly [number, number])[];
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
  for (let f = 0; f < THREAT_FRAMES; f++) {
    frame(h, false);
    if (h.kit.isRetreating) return true;
    if (setup.closing) creepToward(h, mob);
  }
  return false;
}

/** Just inside arm's length, for the one-step case. */
const ONE_STEP_START_TILES = 1.45;
/** The single step the mob takes as his shot begins. */
const ONE_STEP_TILES = 0.15;
/** Long enough to outlast several shots after that step. */
const ONE_STEP_WATCH_FRAMES = 200;

/**
 * A goblin at arm's length takes one step toward him as his shot starts, then
 * stands. With `keepWalking`, it goes on creeping in instead. Did he retreat?
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
  section('Splash Zone: whom he runs from, and how far he stands');
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
    !retreatsFrom({ offset: diagonal, closing: true, walls: corner }),
    'a mob across a wall corner, diagonally close but out of reach, is not run from',
  );
  checkCatches(
    !retreatsFrom({ offset: diagonal, closing: true }),
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

/** Runs every Splash Zone check and returns how many failed. */
export function verifyWaterMageKit(): number {
  failures = 0;
  checkCrossbow();
  checkWave();
  checkFriendlyFire();
  checkKiting();
  checkShotsOutliveShooter();
  checkSafeRoomTarget();
  checkThreats();
  return failures;
}
