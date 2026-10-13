#!/usr/bin/env tsx
/**
 * Getting caught in the Goblin High Security Prison, and getting out of the
 * cell, in the real `BuildingInteriorScene` run headless:
 *
 *  - a capture — by walking into a guard, and by standing in a spotlight —
 *    freezes the prison, fades out, puts both crawlers in a holding cell with
 *    its door boarded, and resets every guard, spotlight and suspicion to the
 *    start of its loop;
 *  - the cell door breaks to each kind of blow the party has, one run each:
 *    either crawler's melee, Smush, Magic Missile direct and by splash, a
 *    slingshot rock, the Protective Shell and dynamite — and a broken door
 *    opens its tile;
 *  - one press of Space from any tile of the cell breaks its door;
 *  - guards take no damage, no knockback and no displacement from any of it;
 *  - the "break door" prompt shows inside a cell with a whole door and
 *    nowhere else;
 *  - a blast changes nothing in the prison's grid;
 *  - a capture with the key keeps the key and the quest's phase;
 *  - the following crawler never leaves the leader's trail, through a switch
 *    of leader as well, and a trail started again with a wall between the two
 *    crawlers never walks the follower through it;
 *  - a key pushed out of the quest slot by another quest item is back on its
 *    pedestal, with a toast, and can be lifted again.
 *
 * More checks join {@link PRISON_CAPTURE_CHECKS}; each is handed a fresh
 * prison from `enterPrison`.
 *
 *   npm run verify:prison-capture [-- --fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import type { PlayerDamageType } from '../src/creatures/Mob.js';
import { installBrowserShim } from './browserShim.js';

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(VIEWPORT);

const FAULTS = [
  /** The capture leaves the guards where they were caught. */
  'no-loop-reset',
  /** The door refuses Smush. */
  'door-refuses-smush',
  /** The door's tile stays blocked once it breaks. */
  'door-stays-blocked',
  /** The prompt shows from the hall outside the cell too. */
  'prompt-from-hall',
  /** A capture takes the key off the party. */
  'capture-drops-key',
  /** The follower is handed back to the ordinary follow drive, which paths on its own. */
  'follower-off-trail',
  /** The pedestal remembers the key was taken, so an evicted key never comes back. */
  'evicted-key-lost',
  /** Driven guards are never moved in the mob grid. */
  'guard-grid-stale',
  /** A blow is heard at the struck guard rather than where it was thrown from. */
  'strike-heard-at-guard',
  /** Nothing tells the capture toast the key is held. */
  'key-toast-unregistered',
  /** Noise made under the fade still sends guards to look once the capture ends. */
  'noise-heard-while-caught',
  /** A struck guard only answers a blow thrown from inside the noise's radius. */
  'struck-guard-keeps-radius',
  /** A restarted trail is a straight line from the follower to the leader, through any wall between. */
  'trail-straight-restart',
] as const;
type Fault = (typeof FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

let fault: Fault | null = null;
for (const arg of process.argv.slice(2)) {
  const [name, value = ''] = arg.split('=');
  if (name === '--fault' && isFault(value)) fault = value;
  else {
    console.error(`unknown argument ${arg}; faults: ${FAULTS.join(', ')}`);
    process.exit(2);
  }
}

const { gameContext } = await import('./nodeGameContext.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { makeStun } = await import('../src/core/StatusEffect.js');
const { Rat } = await import('../src/creatures/Rat.js');
const { isPrisonCrawlerWalkable } = await import('../src/map/goblinPrisonPlan.js');
const { guardPoseAt } = await import('../src/systems/stealthKeySnatch/prisonPatrols.js');
const {
  CAPTURE_FADE_IN_FRAMES,
  CAPTURE_FADE_OUT_FRAMES,
  CAPTURE_FREEZE_FRAMES,
  CAPTURE_HOLD_FRAMES,
  CAPTURE_WITH_KEY_TOAST,
} = await import('../src/systems/stealthKeySnatch/GoblinPrisonSystem.js');
const { enterPrison } = await import('./prisonInteriorHarness.js');
type PrisonHarness = Awaited<ReturnType<typeof enterPrison>>;

setViewportSize(VIEWPORT.width, VIEWPORT.height);
const ctx = gameContext(VIEWPORT.width, VIEWPORT.height);

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

const CAPTURE_TOTAL_FRAMES =
  CAPTURE_FREEZE_FRAMES + CAPTURE_FADE_OUT_FRAMES + CAPTURE_HOLD_FRAMES + CAPTURE_FADE_IN_FRAMES;
/** Frames given to any blow to land: a swing, a missile's flight, a fuse. */
const BLOW_SETTLE_FRAMES = 420;
/** Frames for a swing already thrown to finish before the next is set up. */
const SWING_SETTLE_FRAMES = 105;
/** How far behind a guard a strike is thrown from, in tiles: outside its touch, inside a swing's reach. */
const STRIKE_STANDOFF_TILES = 1.1;
/** How close a guard's facing must come to the attacker's bearing to count as facing it. */
const FACING_TOLERANCE_RADIANS = Math.PI / 6;
/** Frames a struck guard is given to turn round. */
const TURN_SETTLE_FRAMES = 150;
/** How far behind a guard the struck-from-behind shot is thrown from, in tiles: well outside its touch. */
const STRUCK_FROM_TILES = 3;
/** How near the spot a struck guard goes to look must be to the thrower, in tiles. */
const SPOT_NEAR_ATTACKER_TILES = 1.5;
/** A sling stone thrown from beyond a sling's noise radius, inside its range. */
const FAR_STRIKE_TILES = 5.5;
/** The radius a guard is looked up in the mob grid with, about its own position. */
const GRID_PROBE_RADIUS_PX = 4;
/** How far beside each guard the under-the-fade blast goes off, in tiles. */
const NOISE_OFFSET_TILES = 2;
/** Frames let run before a capture so the loops are well away from their start. */
const PATROL_RUN_FRAMES = 400;
/** The ability level from which Magic Missile splashes and the shell wounds as it opens. */
const MISSILE_SPLASH_TEST_LEVEL = 5;
const SHELL_TEST_LEVEL = 5;
/** Frames a broken door is given to open its tile: the prison reads the break on its next frame. */
const DOOR_OPEN_FRAMES = 2;
/** Tiles back along the hall the cat fires the splash test from. */
const SPLASH_FIRING_DISTANCE_TILES = 3;
const STUN_TICKS = 600;
const GUARD_PROBE_DAMAGE = 9999;
const KNOCKBACK_PROBE_PX = 64;
const KNOCKBACK_PROBE_FRAMES = 10;
/** How far behind a guard the blast test drops its stick, out of its light. */
const BLAST_STANDOFF_TILES = 2;

/** An element by index, or undefined past either end. */
function elementAt<T>(items: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function tileOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

function firstCell(harness: PrisonHarness) {
  const cell = elementAt(harness.prison.compiled.parsed.holdingCells, 0);
  if (cell === undefined) throw new Error('the layout has no holding cell');
  return cell;
}

function firstDoor(harness: PrisonHarness) {
  const door = elementAt(harness.prison.cellDoors, 0);
  if (door === undefined) throw new Error('the prison built no cell door');
  return door;
}

/** The cell tile right inside the door, the one a swing reaches the door from. */
function tileInsideDoor(harness: PrisonHarness) {
  const cell = firstCell(harness);
  const { door, hall } = cell;
  return { x: door.x - (hall.x - door.x), y: door.y - (hall.y - door.y) };
}

function faceTile(
  body: { x: number; y: number; facingX: number; facingY: number },
  tile: { x: number; y: number },
): void {
  const dx = tile.x * TILE_SIZE - body.x;
  const dy = tile.y * TILE_SIZE - body.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  body.facingX = dx / length;
  body.facingY = dy / length;
}

function makeBlastProof(harness: PrisonHarness): void {
  for (const crawler of [harness.human, harness.cat]) {
    crawler.takeDamage = (): boolean => false;
  }
}

/** Stands the party in the first cell, the cat parked deep in it, the active crawler at the door. */
function standAtCellDoor(harness: PrisonHarness, activeIsHuman: boolean): void {
  const { human, cat, scene } = harness;
  human.isActive = activeIsHuman;
  cat.isActive = !activeIsHuman;
  const active = activeIsHuman ? human : cat;
  const parked = activeIsHuman ? cat : human;
  const inside = tileInsideDoor(harness);
  const deep = firstCell(harness).tiles.find((tile) => tile.x !== inside.x || tile.y !== inside.y);
  harness.placeAt(active, inside);
  harness.placeAt(parked, deep ?? inside);
  faceTile(active, firstCell(harness).door);
  scene['companion'].anchorBoth(human, cat);
}

function runUntil(harness: PrisonHarness, frames: number, done: () => boolean): boolean {
  for (let frame = 0; frame < frames; frame++) {
    if (done()) return true;
    harness.step(1);
  }
  return done();
}

// ── Checks ──────────────────────────────────────────────────────────────────

interface PrisonCaptureCheck {
  readonly name: string;
  readonly run: (harness: PrisonHarness) => void | Promise<void>;
}

function checkCaptureResets(cause: 'touch' | 'spotlight') {
  return (harness: PrisonHarness): void => {
    const { prison, human, cat } = harness;
    if (fault === 'no-loop-reset') prison['resetLoops'] = (): void => undefined;
    harness.step(PATROL_RUN_FRAMES);
    const guard = elementAt(prison.guardMobs, 0);
    const spot = elementAt(prison.compiled.spotlights, 0);
    if (cause === 'touch') {
      if (guard === undefined) throw new Error('no guard to walk into');
      human.x = guard.x;
      human.y = guard.y;
    } else {
      if (spot === undefined) throw new Error('no spotlight to stand in');
      const centre = spot.centreAt(prison.loopFrame + 1);
      human.x = centre.x - TILE_SIZE / 2;
      human.y = centre.y - TILE_SIZE / 2;
    }
    const caught = runUntil(harness, BLOW_SETTLE_FRAMES, () => prison.isCapturing);
    check(caught, `${cause}: the capture starts`);
    const frozenAt = prison.guardMobs.map((mob) => ({ x: mob.x, y: mob.y }));
    harness.step(CAPTURE_FREEZE_FRAMES - 1);
    check(
      prison.guardMobs.every(
        (mob, index) => mob.x === frozenAt[index]?.x && mob.y === frozenAt[index]?.y,
      ),
      `${cause}: the prison is frozen while the guard shouts`,
    );
    const shiftedBefore = prison.loopFrame;
    runUntil(harness, CAPTURE_TOTAL_FRAMES, () => prison.capturePhaseNow === 'hold');
    check(prison.fadeAlpha === 1, `${cause}: the screen is black while the party is moved`);
    const cellKeys = new Set(firstCell(harness).tiles.map((tile) => `${tile.x},${tile.y}`));
    const humanTile = tileOf(human);
    const catTile = tileOf(cat);
    check(
      cellKeys.has(`${humanTile.x},${humanTile.y}`) && cellKeys.has(`${catTile.x},${catTile.y}`),
      `${cause}: both crawlers stand in the first holding cell`,
    );
    check(
      humanTile.x !== catTile.x || humanTile.y !== catTile.y,
      `${cause}: on two different tiles`,
    );
    const door = firstDoor(harness);
    check(!door.broken, `${cause}: the cell's door is boarded`);
    check(
      !harness.scene['map'].isWalkable(door.x / TILE_SIZE, door.y / TILE_SIZE),
      `${cause}: and its tile is blocked`,
    );
    check(prison.loopFrame === 0 && shiftedBefore > 0, `${cause}: the loop clock is back at 0`);
    const resetPoses = prison.compiled.guards.map((compiled) => guardPoseAt(compiled, 0));
    const guardsAtStart = prison.guardMobs.every((mob, index) => {
      const pose = elementAt(resetPoses, index);
      return (
        pose !== undefined &&
        Math.abs(mob.x + TILE_SIZE / 2 - pose.x) < 1 &&
        Math.abs(mob.y + TILE_SIZE / 2 - pose.y) < 1
      );
    });
    check(guardsAtStart, `${cause}: every guard stands at the start of its loop`);
    check(
      [...prison.suspicionById().values()].every((value) => value === 0),
      `${cause}: every suspicion is 0`,
    );
    runUntil(harness, CAPTURE_TOTAL_FRAMES, () => !prison.isCapturing);
    check(!prison.isCapturing && prison.fadeAlpha === 0, `${cause}: the screen comes back`);
    check(prison.captureCount === 1, `${cause}: exactly one capture ran`);
  };
}

/** A door broken by one weapon, through that weapon's own hit path. */
function checkDoorBreaks(
  weapon: string,
  land: (harness: PrisonHarness) => void,
  expected: PlayerDamageType,
) {
  return (harness: PrisonHarness): void => {
    makeBlastProof(harness);
    const door = firstDoor(harness);
    const takeDamageFrom = door.takeDamageFrom.bind(door);
    const record: { brokenBy: PlayerDamageType | null } = { brokenBy: null };
    door.takeDamageFrom = (amount, attacker, damageType) => {
      if (fault === 'door-refuses-smush' && damageType === 'smush') return;
      const wasBroken = door.broken;
      takeDamageFrom(amount, attacker, damageType);
      if (!wasBroken && door.broken) record.brokenBy = damageType ?? null;
    };
    if (fault === 'door-stays-blocked') {
      harness.scene['map'].setBodyBlock = (): void => undefined;
    }
    land(harness);
    const broken = runUntil(harness, BLOW_SETTLE_FRAMES, () => door.broken);
    check(
      broken && record.brokenBy === expected,
      `${weapon}: the cell door breaks to a ${expected} blow (${record.brokenBy ?? 'none'})`,
    );
    harness.step(DOOR_OPEN_FRAMES);
    const map = harness.scene['map'];
    check(
      map.isWalkable(door.x / TILE_SIZE, door.y / TILE_SIZE),
      `${weapon}: the broken door's tile is open`,
    );
  };
}

const humanMelee = (harness: PrisonHarness): void => {
  standAtCellDoor(harness, true);
  harness.human.triggerAttack(firstDoor(harness));
};
const catMelee = (harness: PrisonHarness): void => {
  standAtCellDoor(harness, false);
  harness.cat.triggerAttack();
};
const smush = (harness: PrisonHarness): void => {
  standAtCellDoor(harness, true);
  harness.human.triggerSmush();
};
const missileDirect = (harness: PrisonHarness): void => {
  standAtCellDoor(harness, false);
  harness.cat.triggerMissile();
};
const missileSplash = (harness: PrisonHarness): void => {
  const { cat, human, scene } = harness;
  scene['abilityManager'].setGodModeMinLevel(MISSILE_SPLASH_TEST_LEVEL);
  const cell = firstCell(harness);
  const along = { x: cell.hall.x - cell.door.x, y: cell.hall.y - cell.door.y };
  const sideways = { x: along.y === 0 ? 0 : 1, y: along.x === 0 ? 0 : 1 };
  const firingTile = {
    x: cell.hall.x + sideways.x * SPLASH_FIRING_DISTANCE_TILES,
    y: cell.hall.y + sideways.y * SPLASH_FIRING_DISTANCE_TILES,
  };
  const rat = new Rat(cell.hall.x, cell.hall.y, TILE_SIZE);
  rat.setMap(scene['map']);
  rat.applyStatus(makeStun(STUN_TICKS));
  scene['world'].roster.add(rat);
  human.isActive = false;
  cat.isActive = true;
  harness.placeAt(cat, firingTile);
  harness.placeAt(human, { x: firingTile.x + sideways.x, y: firingTile.y + sideways.y });
  faceTile(cat, cell.hall);
  scene['companion'].anchorBoth(human, cat);
  cat.triggerMissile();
};
const slingshot = (harness: PrisonHarness): void => {
  const { human } = harness;
  human.inventory.addItem('slingshot', 1);
  human.drawWeapon('slingshot');
  standAtCellDoor(harness, true);
  human.triggerAttack(null);
};
const shell = (harness: PrisonHarness): void => {
  standAtCellDoor(harness, true);
  const { scene, human, cat } = harness;
  scene['combat'].spells.triggerProtectiveShell(
    human,
    cat,
    scene['world'].roster.grid,
    SHELL_TEST_LEVEL,
  );
};
const dynamite = (harness: PrisonHarness, inCell = true): void => {
  if (inCell) standAtCellDoor(harness, true);
  const { scene, human } = harness;
  human.inventory.addItem('goblin_dynamite', 1);
  const sticks = scene['destruction'].dynamite;
  sticks.beginCharge(0, human);
  sticks.release(human);
};

function checkSpaceFromEveryCellTile(harness: PrisonHarness): void {
  const cell = firstCell(harness);
  const door = firstDoor(harness);
  const map = harness.scene['map'];
  for (const tile of cell.tiles) {
    harness.step(SWING_SETTLE_FRAMES);
    door.reboard();
    map.setBodyBlock(door.x / TILE_SIZE, door.y / TILE_SIZE, true);
    harness.human.isActive = true;
    harness.cat.isActive = false;
    harness.placeAt(harness.human, tile);
    const deep = cell.tiles.find((other) => other.x !== tile.x || other.y !== tile.y) ?? tile;
    harness.placeAt(harness.cat, deep);
    harness.human.facingX = 0;
    harness.human.facingY = -1;
    const pressed = harness.prison.tryInteract(harness.systemContext());
    const broken = runUntil(harness, BLOW_SETTLE_FRAMES, () => door.broken);
    check(
      pressed && broken,
      `Space from cell tile ${tile.x},${tile.y} breaks the door (pressed ${pressed}, at ${tileOf(harness.human).x},${tileOf(harness.human).y})`,
    );
  }
}

function checkGuardsUnmoved(harness: PrisonHarness): void {
  const { prison, human } = harness;
  const types = ['melee', 'missile', 'shell', 'smush', 'explosion', 'slingshot'] as const;
  for (const guard of prison.guardMobs) {
    const before = { x: guard.x, y: guard.y, hp: guard.hp };
    for (const type of types) guard.takeDamageFrom(GUARD_PROBE_DAMAGE, human, type);
    guard.applyKnockback(1, 0, KNOCKBACK_PROBE_PX, KNOCKBACK_PROBE_FRAMES);
    guard.applyStatus(makeStun(STUN_TICKS));
    guard.takeDamage(GUARD_PROBE_DAMAGE);
    check(
      guard.isAlive && guard.hp === before.hp && guard.x === before.x && guard.y === before.y,
      `guard ${guard.displayName} at ${tileOf(guard).x},${tileOf(guard).y}: no damage, knockback or status`,
    );
  }
  prison.guardMobs.forEach((guard) => guard.takeStrikes());
  const guard = elementAt(prison.guardMobs, 0);
  if (guard === undefined) return;
  makeBlastProof(harness);
  const behind = TILE_SIZE * BLAST_STANDOFF_TILES;
  human.x = guard.x - Math.cos(guard.facingAngle) * behind;
  human.y = guard.y - Math.sin(guard.facingAngle) * behind;
  const hpBefore = guard.hp;
  dynamite(harness, false);
  harness.step(BLOW_SETTLE_FRAMES);
  check(guard.hp === hpBefore && guard.isAlive, 'a blast beside a guard does it no harm');
  const guardIndex = 0;
  const drivenPose = elementAt(prison['guards'], guardIndex)?.pose;
  check(
    drivenPose !== undefined &&
      Math.abs(guard.x + TILE_SIZE / 2 - drivenPose.x) < 1 &&
      Math.abs(guard.y + TILE_SIZE / 2 - drivenPose.y) < 1,
    'and it stands exactly where its patrol puts it',
  );
}

function checkPromptOnlyInCell(harness: PrisonHarness): void {
  const { prison } = harness;
  if (fault === 'prompt-from-hall') {
    const doorPromptFor = prison.doorPromptFor.bind(prison);
    const hall = firstCell(harness).hall;
    prison.doorPromptFor = (body) => {
      const tile = tileOf(body);
      if (tile.x === hall.x && tile.y === hall.y) return firstDoor(harness);
      return doorPromptFor(body);
    };
  }
  const { grid } = prison.compiled.parsed;
  const cellKeys = new Set(
    prison.compiled.parsed.holdingCells.flatMap((cell) =>
      cell.tiles.map((tile) => `${tile.x},${tile.y}`),
    ),
  );
  let wrong = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!isPrisonCrawlerWalkable(grid, x, y)) continue;
      const shows = prison.doorPromptFor({ x: x * TILE_SIZE, y: y * TILE_SIZE }) !== null;
      if (shows !== cellKeys.has(`${x},${y}`)) wrong++;
    }
  }
  check(
    wrong === 0,
    `the prompt shows inside a holding cell and on no other tile (${wrong} wrong)`,
  );
  const door = firstDoor(harness);
  door.reboard();
  const cell = firstCell(harness);
  check(
    prison.doorPromptFor({ x: cell.tiles[0].x * TILE_SIZE, y: cell.tiles[0].y * TILE_SIZE }) ===
      door,
    'inside a cell it names that cell’s door',
  );
  door.takeDamageFrom(1, harness.human, 'melee');
  harness.step(1);
  check(
    prison.doorPromptFor({ x: cell.tiles[0].x * TILE_SIZE, y: cell.tiles[0].y * TILE_SIZE }) ===
      null,
    'and it goes once the door is broken',
  );
}

function checkBlastChangesNothing(harness: PrisonHarness): void {
  const map = harness.scene['map'];
  const before = map.structure.map((row) => row.map((tile) => tile.type).join(',')).join('|');
  makeBlastProof(harness);
  standAtCellDoor(harness, true);
  dynamite(harness);
  harness.step(BLOW_SETTLE_FRAMES);
  const after = map.structure.map((row) => row.map((tile) => tile.type).join(',')).join('|');
  check(before === after, 'a blast in the prison leaves every tile as it was');
}

const KEY_ITEM = 'quest_prison_key';
/** A quest item that takes the one quest slot from the key. */
const EVICTING_QUEST_ITEM = 'quest_blueprints';
const KEY_RETURNED_TOAST = 'The key went back to its pedestal in the prison vault.';
/** How far the follower may stand from a point the leader occupied, in pixels: rounding only. */
const TRAIL_TOLERANCE_PX = 0.5;
const LEADER_STEP_PX = 2;
const TILE_HALF = 0.5;
/** The follower must actually walk this much of the route, in tiles, or the check proves nothing. */
const MIN_FOLLOWER_WALK_TILES = 3;
const ROUTE_SEARCH_TILES = 200;

function keysHeld(harness: PrisonHarness): number {
  return harness.human.inventory.countOf(KEY_ITEM) + harness.cat.inventory.countOf(KEY_ITEM);
}

function prisonKeyOf(harness: PrisonHarness) {
  const prisonKey = harness.scene['prisonKey'];
  if (prisonKey === null) throw new Error('the prison scene built no PrisonKeySystem');
  return prisonKey;
}

function phaseOf(harness: PrisonHarness): string {
  return prisonKeyOf(harness)['deps'].link.phase;
}

/** Steps the driven crawler onto the pedestal's front tile from the tile below it. */
function stepOntoPedestalFront(harness: PrisonHarness): void {
  const prisonKey = prisonKeyOf(harness);
  const front = prisonKey.pedestalFront;
  const leader = harness.human.isActive ? harness.human : harness.cat;
  harness.placeAt(leader, { x: front.x, y: front.y + 1 });
  harness.step(1);
  harness.placeAt(leader, front);
  harness.step(1);
}

function checkCaptureKeepsKey(harness: PrisonHarness): void {
  const { prison } = harness;
  if (fault === 'capture-drops-key') {
    prison.onCapture(() => {
      harness.human.inventory.removeItems(KEY_ITEM, harness.human.inventory.countOf(KEY_ITEM));
      harness.cat.inventory.removeItems(KEY_ITEM, harness.cat.inventory.countOf(KEY_ITEM));
    });
  }
  stepOntoPedestalFront(harness);
  check(keysHeld(harness) === 1, 'stepping onto the pedestal’s front tile lifts the key');
  check(phaseOf(harness) === 'keyHeld', `and the phase follows to keyHeld (${phaseOf(harness)})`);
  check(!prisonKeyOf(harness).keyOnPedestal, 'and the pedestal stands empty');
  check(!prisonKeyOf(harness).guidesToExit, 'lifting the key alone does not frame the exit');
  if (!prison.isCapturing) prison.capture();
  runUntil(harness, CAPTURE_TOTAL_FRAMES * 2, () => !prison.isCapturing);
  const cellKeys = new Set(firstCell(harness).tiles.map((tile) => `${tile.x},${tile.y}`));
  const humanTile = tileOf(harness.human);
  check(cellKeys.has(`${humanTile.x},${humanTile.y}`), 'the capture puts the party in a cell');
  check(keysHeld(harness) === 1, 'a capture with the key keeps the key');
  check(phaseOf(harness) === 'keyHeld', `and keeps the phase (${phaseOf(harness)})`);
  check(!prisonKeyOf(harness).keyOnPedestal, 'and the key does not reappear on the pedestal');
  check(
    prisonKeyOf(harness).guidesToExit,
    'and the party wakes with the exit framed and pointed at',
  );
}

function guardIsFiled(harness: PrisonHarness, guard: { x: number; y: number }): boolean {
  const grid = harness.scene['world'].roster.grid;
  const found = grid.queryCircle(guard.x, guard.y, GRID_PROBE_RADIUS_PX);
  return [...found].some((mob) => mob === guard);
}

function checkGuardsFiledWhereTheyStand(harness: PrisonHarness): void {
  const { prison, human } = harness;
  if (fault === 'guard-grid-stale') {
    for (const mob of prison.guardMobs) {
      const applyPose = mob.applyPose.bind(mob);
      mob.applyPose = (pose) => applyPose(pose);
    }
  }
  harness.step(PATROL_RUN_FRAMES);
  const moved = prison.guardMobs.filter((mob, index) => {
    const start = guardPoseAt(prison.compiled.guards[index] ?? prison.compiled.guards[0], 0);
    return Math.hypot(mob.x + TILE_SIZE / 2 - start.x, mob.y + TILE_SIZE / 2 - start.y) > TILE_SIZE;
  });
  check(moved.length > 0, `some guards have walked off their start (${moved.length})`);
  const unfiled = moved.filter((mob) => !guardIsFiled(harness, mob));
  check(
    unfiled.length === 0,
    `every moved guard is filed in the mob grid where it stands (${unfiled.length} not)`,
  );
  const guard = elementAt(moved, 0);
  if (guard === undefined) return;
  makeBlastProof(harness);
  const behind = TILE_SIZE * STRIKE_STANDOFF_TILES;
  human.x = guard.x - Math.cos(guard.facingAngle) * behind;
  human.y = guard.y - Math.sin(guard.facingAngle) * behind;
  human.isActive = true;
  harness.cat.isActive = false;
  faceTile(human, { x: guard.x / TILE_SIZE, y: guard.y / TILE_SIZE });
  let landed = 0;
  const takeDamageFrom = guard.takeDamageFrom.bind(guard);
  guard.takeDamageFrom = (amount, attacker, damageType) => {
    landed++;
    takeDamageFrom(amount, attacker, damageType);
  };
  human.triggerAttack(guard);
  runUntil(harness, SWING_SETTLE_FRAMES, () => landed > 0);
  check(landed > 0, 'a real swing lands on a guard that has walked off its start');
}

function checkStruckGuardLooksAtAttacker(harness: PrisonHarness): void {
  const { prison, human } = harness;
  harness.step(PATROL_RUN_FRAMES);
  const guard = elementAt(prison.guardMobs, 0);
  if (guard === undefined) return;
  if (fault === 'strike-heard-at-guard') {
    const takeDamageFrom = guard.takeDamageFrom.bind(guard);
    guard.takeDamageFrom = (amount, attacker, damageType) => {
      takeDamageFrom(amount, attacker, damageType);
      guard.lastStrike = null;
    };
  }
  makeBlastProof(harness);
  const standoff = TILE_SIZE * STRUCK_FROM_TILES;
  human.x = guard.x - Math.cos(guard.facingAngle) * standoff;
  human.y = guard.y - Math.sin(guard.facingAngle) * standoff;
  guard.takeDamageFrom(1, human, 'slingshot');
  harness.step(1);
  const runtime = elementAt(prison['guards'], 0);
  const plan = runtime?.investigation?.plan ?? null;
  const attackerTile = tileOf(human);
  const nearAttacker =
    plan !== null &&
    Math.hypot(plan.spot.x - attackerTile.x, plan.spot.y - attackerTile.y) <=
      SPOT_NEAR_ATTACKER_TILES;
  check(nearAttacker, 'a guard struck from behind goes to look where the blow came from');
  const attacker = { x: human.x, y: human.y };
  const facesAttacker = (): boolean => {
    const bearing = Math.atan2(attacker.y - guard.y, attacker.x - guard.x);
    const off = Math.abs(
      Math.atan2(Math.sin(bearing - guard.facingAngle), Math.cos(bearing - guard.facingAngle)),
    );
    return off < FACING_TOLERANCE_RADIANS;
  };
  check(
    runUntil(harness, TURN_SETTLE_FRAMES, facesAttacker),
    'and turns its light toward the attacker',
  );
}

function checkStruckFromBeyondTheRadius(harness: PrisonHarness): void {
  const { prison, human } = harness;
  const { grid } = prison.compiled.parsed;
  if (fault === 'struck-guard-keeps-radius') {
    const noises = prison['noises'];
    const push = noises.push.bind(noises);
    noises.push = (...items) => push(...items.map((noise) => ({ kind: noise.kind, at: noise.at })));
  }
  makeBlastProof(harness);
  const standoff = TILE_SIZE * FAR_STRIKE_TILES;
  for (let frame = 0; frame < PATROL_RUN_FRAMES; frame++) {
    harness.step(1);
    const guard = prison.guardMobs.find((mob) => {
      const x = mob.x - Math.cos(mob.facingAngle) * standoff;
      const y = mob.y - Math.sin(mob.facingAngle) * standoff;
      const tile = tileOf({ x, y });
      return isPrisonCrawlerWalkable(grid, tile.x, tile.y);
    });
    if (guard === undefined) continue;
    human.x = guard.x - Math.cos(guard.facingAngle) * standoff;
    human.y = guard.y - Math.sin(guard.facingAngle) * standoff;
    guard.takeDamageFrom(1, human, 'slingshot');
    harness.step(1);
    const index = prison.guardMobs.indexOf(guard);
    const investigating = elementAt(prison['guards'], index)?.investigation ?? null;
    check(
      investigating !== null || prison.isCapturing,
      `a guard hit by a sling stone from ${FAR_STRIKE_TILES} tiles behind goes to look`,
    );
    return;
  }
  check(false, `found a guard with open floor ${FAR_STRIKE_TILES} tiles behind it`);
}

function checkKeyHeldCaptureToast(harness: PrisonHarness): void {
  const { prison } = harness;
  if (fault === 'key-toast-unregistered') prison['listeners'].clear();
  harness.human.inventory.addItem(KEY_ITEM, 1);
  const toasts: string[] = [];
  prison.onCapture((capture) => toasts.push(capture.toast));
  prison.capture();
  runUntil(harness, CAPTURE_TOTAL_FRAMES * 2, () => !prison.isCapturing);
  check(
    toasts[0] === CAPTURE_WITH_KEY_TOAST,
    `caught holding the key, the toast says so ("${toasts[0] ?? 'none'}")`,
  );
}

function checkNoiseIgnoredWhileCaught(harness: PrisonHarness): void {
  const { prison } = harness;
  if (fault === 'noise-heard-while-caught') prison['ignoreWhileCapturing'] = (): void => undefined;
  prison.capture();
  runUntil(harness, CAPTURE_TOTAL_FRAMES * 2, () => prison.capturePhaseNow === 'fadeIn');
  for (const guard of prison.guardMobs) {
    harness.scene['bus'].emit('blastLanded', {
      x: guard.x + TILE_SIZE / 2 + TILE_SIZE * NOISE_OFFSET_TILES,
      y: guard.y + TILE_SIZE / 2,
      radiusPx: TILE_SIZE,
    });
  }
  runUntil(harness, CAPTURE_TOTAL_FRAMES * 2, () => !prison.isCapturing);
  harness.step(1);
  const investigating = prison['guards'].filter((guard) => guard.investigation !== null).length;
  check(investigating === 0, `noise made under the fade sends no guard to look (${investigating})`);
}

function distanceToPolyline(
  point: { readonly x: number; readonly y: number },
  line: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    const b = line[i + 1] ?? a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y));
  }
  return best;
}

/**
 * Walks the leader through the intake, where no light reaches, to a holding
 * cell's hall tile, switches crawlers halfway and walks the new leader back
 * to the entry. Every frame the follower must stand on a point some leader
 * stood on.
 */
function checkFollowerKeepsToTrail(harness: PrisonHarness): void {
  const { scene, human, cat } = harness;
  if (fault === 'follower-off-trail') scene['companion'].setTrailFollow(null);
  const map = scene['map'];
  const parsed = harness.prison.compiled.parsed;
  const farthestHall = elementAt(
    [...parsed.holdingCells]
      .map((cell) => cell.hall)
      .sort(
        (a, b) =>
          Math.hypot(b.x - parsed.entry.x, b.y - parsed.entry.y) -
          Math.hypot(a.x - parsed.entry.x, a.y - parsed.entry.y),
      ),
    0,
  );
  if (farthestHall === undefined) throw new Error('the layout has no holding cell');
  const legs = [{ to: farthestHall }, { to: parsed.entry }];
  harness.placeAt(human, parsed.entry);
  const startBeside = [
    { x: parsed.entry.x + 1, y: parsed.entry.y },
    { x: parsed.entry.x - 1, y: parsed.entry.y },
    { x: parsed.entry.x, y: parsed.entry.y - 1 },
  ].find((tile) => map.isWalkable(tile.x, tile.y));
  if (startBeside === undefined) throw new Error('nothing walkable beside the prison entry');
  harness.placeAt(cat, startBeside);
  harness.step(1);
  const trails: Array<Array<{ x: number; y: number }>> = [
    [
      { x: cat.x, y: cat.y },
      { x: human.x, y: human.y },
    ],
  ];
  let worstPx = 0;
  let offWalkable = 0;
  let followerWalkedPx = 0;
  for (const [legIndex, leg] of legs.entries()) {
    if (legIndex > 0) {
      scene['trySwitchActive']();
      trails.push([]);
    }
    const leader = human.isActive ? human : cat;
    const follower = human.isActive ? cat : human;
    const trail = trails[trails.length - 1];
    trail.push({ x: leader.x, y: leader.y });
    const startTile = tileOf(leader);
    const route = map.findPath(startTile.x, startTile.y, leg.to.x, leg.to.y, ROUTE_SEARCH_TILES);
    check(route.length > 1, `leg ${legIndex + 1}: the intake has a route to walk`);
    for (const waypoint of route.slice(1)) {
      const targetX = waypoint.x * TILE_SIZE;
      const targetY = waypoint.y * TILE_SIZE;
      for (;;) {
        const remaining = Math.hypot(targetX - leader.x, targetY - leader.y);
        if (remaining < TRAIL_TOLERANCE_PX) break;
        const stride = Math.min(LEADER_STEP_PX, remaining);
        leader.x += ((targetX - leader.x) / remaining) * stride;
        leader.y += ((targetY - leader.y) / remaining) * stride;
        trail.push({ x: leader.x, y: leader.y });
        const before = { x: follower.x, y: follower.y };
        harness.step(1);
        followerWalkedPx += Math.hypot(follower.x - before.x, follower.y - before.y);
        const offTrailPx = Math.min(...trails.map((line) => distanceToPolyline(follower, line)));
        worstPx = Math.max(worstPx, offTrailPx);
        const footTile = tileOf(follower);
        if (!map.isWalkable(footTile.x, footTile.y)) offWalkable++;
      }
    }
  }
  check(
    !harness.prison.isCapturing,
    'the walk through the intake was never seen (the check would be void otherwise)',
  );
  check(
    followerWalkedPx >= MIN_FOLLOWER_WALK_TILES * TILE_SIZE,
    `the follower walked the route (${(followerWalkedPx / TILE_SIZE).toFixed(1)} tiles)`,
  );
  check(
    worstPx <= TRAIL_TOLERANCE_PX,
    `the follower never left the leader’s trail (worst ${worstPx.toFixed(2)} px off it)`,
  );
  check(offWalkable === 0, `the follower never stood on a blocked tile (${offWalkable} frames)`);
  const leader = human.isActive ? human : cat;
  const follower = human.isActive ? cat : human;
  const restAt = { x: follower.x, y: follower.y };
  harness.step(TILE_SIZE);
  check(
    follower.x === restAt.x && follower.y === restAt.y && leader.isActive,
    'the follower stops when the leader stops',
  );
}

/** Half the collision box's width, as a share of a tile: the box's corners must stay on open floor. */
const BOX_HALF_SHARE = 0.25;
/** Frames given to the follower to close the gap round the wall. */
const RESTART_WALK_FRAMES = 600;
/** The longest way round the wall the check accepts, in tiles, so the route stays within the trail's reach. */
const MAX_DETOUR_TILES = 12;
const WALL_GAP_TILES = 2;

/** Two open tiles two apart in a row with a blocked tile between them and a short way round. */
function tilesAcrossAWall(harness: PrisonHarness) {
  const map = harness.scene['map'];
  const { grid } = harness.prison.compiled.parsed;
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x + WALL_GAP_TILES < grid.width - 1; x++) {
      const far = { x: x + WALL_GAP_TILES, y };
      if (!map.isWalkable(x, y) || !map.isWalkable(far.x, far.y) || map.isWalkable(x + 1, y)) {
        continue;
      }
      const detour = map.findPath(x, y, far.x, far.y, MAX_DETOUR_TILES);
      if (detour.length > WALL_GAP_TILES + 1 && detour.length <= MAX_DETOUR_TILES) {
        return { near: { x, y }, far };
      }
    }
  }
  return null;
}

/**
 * Puts the two crawlers on either side of a wall, so the trail has to start
 * again, and lets the follower close the gap: every frame its collision box
 * must stand on open floor.
 */
function checkTrailRestartAroundWall(harness: PrisonHarness): void {
  const { scene, human, cat, prison } = harness;
  prison.capture = (): void => undefined;
  const trail = scene['companion'].followTrail;
  if (trail === null) throw new Error('the prison follower is not on a trail');
  if (fault === 'trail-straight-restart') {
    Object.defineProperty(trail, 'routeBetween', { value: () => [] });
  }
  const pair = tilesAcrossAWall(harness);
  check(pair !== null, 'the layout has two open tiles with a wall between them');
  if (pair === null) return;
  const map = scene['map'];
  harness.placeAt(human, pair.far);
  harness.placeAt(cat, pair.near);
  let blockedFrames = 0;
  let closest = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < RESTART_WALK_FRAMES; frame++) {
    harness.step(1);
    const corners = [-BOX_HALF_SHARE, BOX_HALF_SHARE].flatMap((dx) =>
      [-BOX_HALF_SHARE, BOX_HALF_SHARE].map((dy) => ({
        x: Math.floor((cat.x + TILE_SIZE * (TILE_HALF + dx)) / TILE_SIZE),
        y: Math.floor((cat.y + TILE_SIZE * (TILE_HALF + dy)) / TILE_SIZE),
      })),
    );
    if (corners.some((tile) => !map.isWalkable(tile.x, tile.y))) blockedFrames++;
    closest = Math.min(closest, Math.hypot(cat.x - human.x, cat.y - human.y));
  }
  check(
    blockedFrames === 0,
    `a restarted trail never walks the follower through the wall (${blockedFrames} frames on blocked floor)`,
  );
  check(
    closest <= trail.spacing + TRAIL_TOLERANCE_PX,
    `and the follower does come round to its place behind the leader (closest ${(closest / TILE_SIZE).toFixed(2)} tiles)`,
  );
}

function checkEvictedKeyReturns(harness: PrisonHarness): void {
  const prisonKey = prisonKeyOf(harness);
  if (fault === 'evicted-key-lost') {
    let taken = false;
    const lift = prisonKey['lift'].bind(prisonKey);
    prisonKey['lift'] = (crawler) => {
      taken = true;
      lift(crawler);
    };
    Object.defineProperty(prisonKey, 'keyOnPedestal', {
      get: () => !taken && keysHeld(harness) === 0,
    });
  }
  stepOntoPedestalFront(harness);
  const holder = harness.human.inventory.countOf(KEY_ITEM) > 0 ? harness.human : harness.cat;
  check(keysHeld(harness) === 1, 'the key is lifted before the eviction');
  holder.inventory.addItem(EVICTING_QUEST_ITEM, 1);
  harness.step(1);
  check(keysHeld(harness) === 0, 'another quest item pushes the key out of the quest slot');
  check(prisonKey.keyOnPedestal, 'the evicted key is back on its pedestal');
  check(phaseOf(harness) === 'briefed', `and the phase drops to briefed (${phaseOf(harness)})`);
  check(
    harness.scene['menus'].toasts.shown.some((toast) => toast.text === KEY_RETURNED_TOAST),
    'and a toast says where it went',
  );
  check(prisonKey.minimapKeyTile !== null, 'the minimap marks the key again');
  stepOntoPedestalFront(harness);
  check(keysHeld(harness) === 1, 'and stepping back onto the front tile lifts it again');
}

/** Every check in the gate, each run against its own fresh prison. */
export const PRISON_CAPTURE_CHECKS: ReadonlyArray<PrisonCaptureCheck> = [
  { name: 'capture by touch', run: checkCaptureResets('touch') },
  { name: 'capture by spotlight', run: checkCaptureResets('spotlight') },
  { name: 'door: human melee', run: checkDoorBreaks('human melee', humanMelee, 'melee') },
  { name: 'door: cat melee', run: checkDoorBreaks('cat melee', catMelee, 'melee') },
  { name: 'door: Smush', run: checkDoorBreaks('Smush', smush, 'smush') },
  { name: 'door: Magic Missile', run: checkDoorBreaks('Magic Missile', missileDirect, 'missile') },
  {
    name: 'door: missile splash',
    run: checkDoorBreaks('missile splash', missileSplash, 'missile'),
  },
  { name: 'door: slingshot', run: checkDoorBreaks('slingshot rock', slingshot, 'slingshot') },
  { name: 'door: shell', run: checkDoorBreaks('Protective Shell', shell, 'shell') },
  { name: 'door: dynamite', run: checkDoorBreaks('dynamite', dynamite, 'explosion') },
  { name: 'Space from every cell tile', run: checkSpaceFromEveryCellTile },
  { name: 'guards unmoved', run: checkGuardsUnmoved },
  { name: 'prompt only in a cell', run: checkPromptOnlyInCell },
  { name: 'blast changes nothing', run: checkBlastChangesNothing },
  { name: 'capture keeps the key', run: checkCaptureKeepsKey },
  { name: 'follower keeps to the trail', run: checkFollowerKeepsToTrail },
  { name: 'trail restart goes round a wall', run: checkTrailRestartAroundWall },
  { name: 'evicted key returns', run: checkEvictedKeyReturns },
  { name: 'guards filed where they stand', run: checkGuardsFiledWhereTheyStand },
  { name: 'struck guard turns to the attacker', run: checkStruckGuardLooksAtAttacker },
  { name: 'struck from beyond the radius', run: checkStruckFromBeyondTheRadius },
  { name: 'capture toast with the key', run: checkKeyHeldCaptureToast },
  { name: 'noise ignored while caught', run: checkNoiseIgnoredWhileCaught },
];

for (const { name, run } of PRISON_CAPTURE_CHECKS) {
  console.log(`\n── ${name} ──`);
  const harness = await enterPrison(ctx);
  await run(harness);
}

console.log(failures.length === 0 ? '\nPASS' : `\nFAIL — ${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
