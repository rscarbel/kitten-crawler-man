#!/usr/bin/env tsx
/**
 * The Krakaren Clone is a solid, immovable body as wide as her drawn mantle.
 *
 * Headless, on real generated second floors with her flooded lab built, through
 * the real `MobUpdateLoop` and the real `applyMovement`:
 *
 *   - a crawler (Carl, then the cat) holding a direction straight into her from
 *     each side never gets its centre closer than `KRAKAREN_BODY_RADIUS_PX`;
 *   - she never moves: not for a crawler, a companion, a hostile mob, or a
 *     knockback;
 *   - a crawler pinned between her and a wall can still walk away along it;
 *   - a crawler pressed against her can still hit her, and Mongo still closes
 *     to his ordinary contact distance;
 *   - she is ticked from every tile of her room, so she collides wherever the
 *     party can stand in it.
 *
 *   npm run verify:krakaren-collision
 *   npm run verify:krakaren-collision -- --fault=unanchored       # must fail
 *   npm run verify:krakaren-collision -- --fault=wide-companion   # must fail
 *
 * Each fault overrides a getter on one instance, without touching a source
 * file. `unanchored` makes her separable again: the crawler is then handed
 * only its mass share of each push and the first check has to go red.
 * `wide-companion` makes Mongo stop closing to the ordinary contact: he is then
 * held out at her body radius, beyond his own bite, and the Mongo contact check
 * has to go red.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { KRAKAREN_BODY_RADIUS_PX, KrakarenClone } from '../src/creatures/KrakarenClone.js';
import { Mongo } from '../src/creatures/Mongo.js';
import type { Mob } from '../src/creatures/Mob.js';
import { Rat } from '../src/creatures/Rat.js';
import type { Player } from '../src/Player.js';
import { applyMovement } from '../src/systems/GameLoopPhases.js';
import { pushPlayerWithCollision } from '../src/systems/playerDisplacement.js';
import { MobUpdateLoop, hasAiAttention } from '../src/systems/MobUpdateLoop.js';
import type { SystemContext } from '../src/systems/GameSystem.js';
import { SEPARATION_RADIUS } from '../src/systems/mobSeparation.js';
import { MobRoster } from '../src/systems/kits/SceneWorld.js';
import { SpellSystem } from '../src/systems/SpellSystem.js';
import type { DoorSide, TilePoint } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  DOOR_SIDES,
  buildEnvironment,
  findFloorWithRoom,
  gameGauntletDressings,
  type RoomEnvironment,
} from './bossRooms/harness.js';
import { krakarenRoom } from './bossRooms/krakaren.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const FAULT = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);
const KNOWN_FAULTS: readonly string[] = ['unanchored', 'wide-companion'];
if (FAULT !== undefined && !KNOWN_FAULTS.includes(FAULT)) {
  throw new Error(`--fault=${FAULT} is not one of ${KNOWN_FAULTS.join(', ')}`);
}

/** First world seed searched for a floor whose Krakaren room opens on each side. */
const FIRST_SEED = 1;

/** Where a crawler starts walking in from: inside the clear ground every layout keeps round her. */
const APPROACH_START_TILES = 3;
/** How long a direction is held into her: several seconds of pressing. */
const HOLD_FRAMES = 300;
/**
 * Slack on "never closer than her radius". With her anchored the crawler takes
 * the whole push and ends every frame exactly on the radius, so this only
 * absorbs floating-point error. It must stay well under what an unanchored body
 * lets through — the crawler's mass share of one walking step, most of a pixel
 * — or the fault run could not go red.
 */
const RADIUS_TOLERANCE_PX = 0.1;
/** How near her radius a crawler must get for a run to count as having pressed into her. */
const CONTACT_SLACK_PX = 1;
/** How far her position may drift and still count as not moved: none, bar float error. */
const STILL_TOLERANCE_PX = 1e-9;

/** How far a mob is placed into her body before separation is left to resolve it. */
const MOB_OVERLAP_TILES = 0.5;
/** Frames separation is given to resolve a placed overlap. */
const SETTLE_FRAMES = 180;
/**
 * Mob-vs-mob separation stops pushing a few pixels short of contact, so a mob
 * pressed against another rests that far inside it.
 */
const MOB_SETTLE_SLACK_PX = 4;
/**
 * How far either side of the ordinary one-tile contact a companion may settle.
 * It rests the separation deadband inside contact; held out at her body radius
 * instead, it would sit half a tile further off, far outside this.
 */
const ORDINARY_CONTACT_SLACK_PX = 4;

const KNOCKBACK_DISTANCE_TILES = 3;
const KNOCKBACK_FRAMES = 20;

/**
 * How far south of the pinned crawler she stands: near enough that her push
 * runs it into the wall behind it, so it ends up flat between the two.
 */
const PIN_GAP_TILES = 1;
/** Frames the pinned crawler spends pressing into her before trying to leave. */
const PIN_FRAMES = 60;
/** Frames it then holds a direction along the wall. */
const ESCAPE_FRAMES = 180;
/** How far along the wall it must have got for the escape to count. */
const ESCAPE_MIN_TILES = 2;
/** Walkable tiles needed along the wall on the escape side. */
const ESCAPE_CLEAR_TILES = 4;

const MONGO_LEVEL = 1;
const MONGO_STARTING_HP = 999;

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

interface Direction {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

const DIRECTIONS: readonly Direction[] = [
  { name: 'north', x: 0, y: -1 },
  { name: 'east', x: 1, y: 0 },
  { name: 'south', x: 0, y: 1 },
  { name: 'west', x: -1, y: 0 },
];

interface Arena {
  readonly env: RoomEnvironment;
  readonly boss: KrakarenClone;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
}

function centreOf(body: { x: number; y: number }): TilePoint {
  return { x: body.x + TILE_SIZE / 2, y: body.y + TILE_SIZE / 2 };
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const ca = centreOf(a);
  const cb = centreOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function placeAtTile(body: { x: number; y: number }, tile: TilePoint): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

/**
 * Her lab on the floor found from the seed, with her standing at her spawn (or
 * at `bossAtPx`, a tile origin in pixels) and
 * both crawlers parked in the doorway. Her AI is held: what is under test is
 * her body, and a slam landing on the crawler would end the run for a reason
 * that has nothing to do with collision.
 */
function buildArena(side: DoorSide, bossAtPx?: TilePoint): Arena {
  const found = findFloorWithRoom(krakarenRoom, FIRST_SEED, side);
  if (found === null) throw new Error(`no Krakaren room opening ${side}`);
  const env = buildEnvironment(found);
  gameGauntletDressings(env);
  const { gameMap, room } = env;
  const roster = new MobRoster(gameMap, new SpellSystem());
  const boss = new KrakarenClone(room.spawn.x, room.spawn.y, TILE_SIZE);
  if (bossAtPx !== undefined) {
    boss.x = bossAtPx.x;
    boss.y = bossAtPx.y;
  }
  boss.aiHeld = true;
  if (FAULT === 'unanchored') {
    Object.defineProperty(boss, 'separationAnchored', { get: () => false });
  }
  roster.add(boss);
  const ctx: SystemContext = {
    human: env.frame.human,
    cat: env.frame.cat,
    active: env.frame.human,
    inactive: env.frame.cat,
    activeIsMoving: false,
    roster,
    gameMap,
  };
  return { env, boss, roster, loop: new MobUpdateLoop(), ctx };
}

function setActive(arena: Arena, crawler: SystemContext['active']): void {
  const { human, cat } = arena.ctx;
  human.isActive = crawler === human;
  cat.isActive = crawler === cat;
  arena.ctx.active = crawler;
  arena.ctx.inactive = crawler === human ? cat : human;
}

/** One frame: the crawler walks along `heading`, then the mob loop resolves bodies. */
function step(arena: Arena, crawler: Player, heading: TilePoint): void {
  applyMovement(crawler, { dx: heading.x, dy: heading.y, isMobile: true }, arena.env.gameMap);
  arena.ctx.activeIsMoving = crawler.isMoving;
  arena.loop.update(arena.ctx);
  crawler.tickTimers();
}

function bossHasNotMoved(boss: KrakarenClone, origin: TilePoint): boolean {
  return Math.hypot(boss.x - origin.x, boss.y - origin.y) <= STILL_TOLERANCE_PX;
}

// ── A crawler pressed into her ──────────────────────────────────────────────

function checkPressingInto(side: DoorSide, crawlerName: 'Carl' | 'the cat'): void {
  for (const direction of DIRECTIONS) {
    const arena = buildArena(side);
    const { boss, ctx } = arena;
    const crawler = crawlerName === 'Carl' ? ctx.human : ctx.cat;
    const other = crawler === ctx.human ? ctx.cat : ctx.human;
    setActive(arena, crawler);
    const spawn = arena.env.room.spawn;
    placeAtTile(crawler, {
      x: spawn.x + direction.x * APPROACH_START_TILES,
      y: spawn.y + direction.y * APPROACH_START_TILES,
    });
    // Parked well clear, so only the crawler under test touches her.
    placeAtTile(other, arena.env.room.doorways[0]?.tile ?? spawn);
    const origin = { x: boss.x, y: boss.y };
    const inward = { x: -direction.x, y: -direction.y };

    let closest = Infinity;
    for (let frame = 0; frame < HOLD_FRAMES; frame++) {
      step(arena, crawler, inward);
      closest = Math.min(closest, distanceBetween(crawler, boss));
    }
    const label = `${side} lab: ${crawlerName} pressing in from the ${direction.name}`;
    check(
      closest <= KRAKAREN_BODY_RADIUS_PX + CONTACT_SLACK_PX,
      `${label} reaches her body at all`,
    );
    check(
      closest >= KRAKAREN_BODY_RADIUS_PX - RADIUS_TOLERANCE_PX,
      `${label} never comes closer than her body radius ` +
        `(closest ${closest.toFixed(2)} px, radius ${KRAKAREN_BODY_RADIUS_PX} px)`,
    );
    check(bossHasNotMoved(boss, origin), `${label} does not move her`);
  }
}

// ── Mobs and shoves ─────────────────────────────────────────────────────────

/** Puts `mob` half a tile into her body and lets separation sort them out. */
function settleOverlap(arena: Arena, mob: Mob): void {
  const spawn = arena.env.room.spawn;
  mob.x = (spawn.x + MOB_OVERLAP_TILES) * TILE_SIZE;
  mob.y = spawn.y * TILE_SIZE;
  mob.aiHeld = true;
  arena.roster.add(mob);
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) arena.loop.update(arena.ctx);
}

function checkMobsAndShoves(side: DoorSide): void {
  {
    const arena = buildArena(side);
    const origin = { x: arena.boss.x, y: arena.boss.y };
    const spawn = arena.env.room.spawn;
    const mongo = new Mongo(
      spawn.x,
      spawn.y,
      TILE_SIZE,
      arena.ctx.cat,
      MONGO_LEVEL,
      MONGO_STARTING_HP,
    );
    if (FAULT === 'wide-companion') {
      Object.defineProperty(mongo, 'closesToOrdinaryContact', { get: () => false });
    }
    settleOverlap(arena, mongo);
    check(bossHasNotMoved(arena.boss, origin), `${side} lab: Mongo bumping her does not move her`);
    const mongoGap = distanceBetween(mongo, arena.boss);
    check(
      Math.abs(mongoGap - SEPARATION_RADIUS) <= ORDINARY_CONTACT_SLACK_PX,
      `${side} lab: Mongo is pushed out to his ordinary contact, not held out of reach ` +
        `(${mongoGap.toFixed(1)} px)`,
    );
  }
  {
    const arena = buildArena(side);
    const origin = { x: arena.boss.x, y: arena.boss.y };
    const spawn = arena.env.room.spawn;
    const rat = new Rat(spawn.x, spawn.y, TILE_SIZE);
    settleOverlap(arena, rat);
    check(bossHasNotMoved(arena.boss, origin), `${side} lab: a hostile mob does not move her`);
    check(
      distanceBetween(rat, arena.boss) >= KRAKAREN_BODY_RADIUS_PX - MOB_SETTLE_SLACK_PX,
      `${side} lab: a hostile mob is pushed out to her body radius ` +
        `(${distanceBetween(rat, arena.boss).toFixed(1)} px)`,
    );
  }
  {
    const arena = buildArena(side);
    const origin = { x: arena.boss.x, y: arena.boss.y };
    arena.boss.applyKnockback(1, 0, KNOCKBACK_DISTANCE_TILES * TILE_SIZE, KNOCKBACK_FRAMES);
    check(
      arena.boss.knockbackFramesRemaining === 0,
      `${side} lab: a knockback never starts on her, so nothing reads her as mid-stagger`,
    );
    for (let frame = 0; frame < KNOCKBACK_FRAMES * 2; frame++) arena.loop.update(arena.ctx);
    check(bossHasNotMoved(arena.boss, origin), `${side} lab: a knockback does not move her`);
  }
}

// ── Pinned against a wall ───────────────────────────────────────────────────

interface PinSpot {
  readonly crawlerTile: TilePoint;
  /** Her tile origin in pixels. */
  readonly bossAtPx: TilePoint;
  readonly escape: TilePoint;
}

/**
 * A floor tile with blocked ground straight north of it and open floor along
 * the wall to one side: the crawler stands there and she stands
 * {@link PIN_GAP_TILES} south of it, so her push drives it straight into the
 * wall.
 */
function findPinSpot(arena: Arena): PinSpot | null {
  const { gameMap, room } = arena.env;
  const open = (x: number, y: number): boolean => gameMap.isWalkable(x, y);
  for (const tile of room.interior) {
    if (!open(tile.x, tile.y) || open(tile.x, tile.y - 1)) continue;
    if (!open(tile.x, tile.y + 1)) continue;
    for (const dx of [1, -1]) {
      let clear = true;
      for (let k = 1; k <= ESCAPE_CLEAR_TILES; k++) {
        if (!open(tile.x + dx * k, tile.y) || open(tile.x + dx * k, tile.y - 1)) clear = false;
      }
      if (clear) {
        return {
          crawlerTile: tile,
          bossAtPx: { x: tile.x * TILE_SIZE, y: (tile.y + PIN_GAP_TILES) * TILE_SIZE },
          escape: { x: dx, y: 0 },
        };
      }
    }
  }
  return null;
}

function checkPinnedAgainstWall(side: DoorSide): void {
  const scout = buildArena(side);
  const spot = findPinSpot(scout);
  if (spot === null) {
    check(false, `${side} lab: has a stretch of wall to pin a crawler against`);
    return;
  }
  const arena = buildArena(side, spot.bossAtPx);
  const { human, cat } = arena.ctx;
  setActive(arena, human);
  placeAtTile(human, spot.crawlerTile);
  placeAtTile(cat, arena.env.room.doorways[0]?.tile ?? arena.env.room.spawn);

  for (let frame = 0; frame < PIN_FRAMES; frame++) step(arena, human, { x: 0, y: 1 });
  const pinnedX = human.x;
  const wallProbe = { x: human.x, y: human.y };
  pushPlayerWithCollision(wallProbe, 0, -1, arena.env.gameMap);
  check(
    wallProbe.y === human.y &&
      distanceBetween(human, arena.boss) <= KRAKAREN_BODY_RADIUS_PX + CONTACT_SLACK_PX,
    `${side} lab: a crawler pressed into her is pinned flat against the wall behind it`,
  );
  for (let frame = 0; frame < ESCAPE_FRAMES; frame++) step(arena, human, spot.escape);

  const travelledTiles = Math.abs(human.x - pinnedX) / TILE_SIZE;
  check(
    travelledTiles >= ESCAPE_MIN_TILES,
    `${side} lab: a crawler pinned between her and the wall walks away along it ` +
      `(${travelledTiles.toFixed(1)} tiles)`,
  );
  check(
    distanceBetween(human, arena.boss) >= KRAKAREN_BODY_RADIUS_PX - RADIUS_TOLERANCE_PX,
    `${side} lab: and ends up clear of her body`,
  );
}

// ── Reach and attention ─────────────────────────────────────────────────────

function checkReach(): void {
  const arena = buildArena(DOOR_SIDES[0]);
  const { human, cat } = arena.ctx;
  check(
    human.getMeleeRange() > KRAKAREN_BODY_RADIUS_PX,
    `Carl's swing (${human.getMeleeRange().toFixed(1)} px) reaches her from her body's edge`,
  );
  check(
    cat.getMeleeRange() > KRAKAREN_BODY_RADIUS_PX,
    `the cat's swipe (${cat.getMeleeRange().toFixed(1)} px) reaches her from her body's edge`,
  );
}

/**
 * Nothing in her own lab can pin a crawler against her: every blocked tile is
 * far enough from her that a crawler pushed out to her radius still has floor
 * behind it. A crawler's centre may come up to the edge of a blocked tile, so
 * that is the distance measured.
 */
function checkLabLeavesRoomBehindHerBody(side: DoorSide): void {
  const arena = buildArena(side);
  const { gameMap, room } = arena.env;
  const herCentre = centreOf(arena.boss);
  let nearestBlockedEdge = Infinity;
  for (const tile of room.interior) {
    if (gameMap.isWalkable(tile.x, tile.y)) continue;
    const nearestX = Math.max(tile.x * TILE_SIZE, Math.min(herCentre.x, (tile.x + 1) * TILE_SIZE));
    const nearestY = Math.max(tile.y * TILE_SIZE, Math.min(herCentre.y, (tile.y + 1) * TILE_SIZE));
    nearestBlockedEdge = Math.min(
      nearestBlockedEdge,
      Math.hypot(nearestX - herCentre.x, nearestY - herCentre.y),
    );
  }
  check(
    nearestBlockedEdge > KRAKAREN_BODY_RADIUS_PX,
    `${side} lab: no prop or wall stands inside her body's reach, so nothing pins a crawler ` +
      `against her (nearest blocked ground ${nearestBlockedEdge.toFixed(1)} px)`,
  );
}

function checkAttention(side: DoorSide): void {
  const arena = buildArena(side);
  const unattended = arena.env.room.interior.filter(
    (tile) => !hasAiAttention(arena.boss, [{ x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE }]),
  );
  check(
    unattended.length === 0,
    `${side} lab: she is ticked, and so collides, from every tile of her room ` +
      `(${unattended.length} tiles out of range)`,
  );
}

console.log(`verify:krakaren-collision${FAULT === undefined ? '' : ` --fault=${FAULT}`}`);
checkReach();
for (const side of DOOR_SIDES) {
  checkPressingInto(side, 'Carl');
  checkPressingInto(side, 'the cat');
  checkMobsAndShoves(side);
  checkPinnedAgainstWall(side);
  checkLabLeavesRoomBehindHerBody(side);
  checkAttention(side);
}

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
