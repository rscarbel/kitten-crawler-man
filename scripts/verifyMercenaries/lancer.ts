/**
 * Headless checks on Dong Quixote's lancer kit, run by `verify:mercenaries`.
 *
 * - The charge fires on a pack three to seven tiles off down a clear lane,
 *   and runs down every hostile on it: each is struck for charge damage and
 *   flung off its spot. A pack inside lance range gets the jab instead.
 * - The wind-up and the winded stop hold him still for their full length, so
 *   the charge is telegraphed and punishable.
 * - He stops at the first wall, and nothing behind it is touched.
 * - He never charges through a crawler or a friendly creature, and neither is
 *   hurt; the same lane with the body gone, or the body hostile, is charged.
 * - The lane must be a walk his body can take: a stairwell on it, which sight
 *   sees straight across, refuses the charge.
 * - A second charge waits out the cooldown.
 * - The jab lands on the drawn impact frame.
 * - He salutes on being hired and after a kill with nothing else near.
 *
 * Every rule is also run where it must go red, so a gate that cannot see what
 * it measures fails rather than passes.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { Mob } from '../../src/creatures/Mob';
import type { Mercenary } from '../../src/creatures/Mercenary';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { createMercenaryRoster } from '../../src/core/MercenaryRoster';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { MercenaryRow } from '../../src/creatures/mercenaries/MercenaryKit';
import {
  CHARGE_COOLDOWN_FRAMES,
  CHARGE_DAMAGE_MULTIPLE,
  CHARGE_MAX_LENGTH_TILES,
  CHARGE_RECOVER_TICKS,
  CHARGE_WINDUP_TICKS,
  LancerKit,
} from '../../src/creatures/mercenaries/lancerKit';
import {
  DONG_THRUST_FRAMES,
  DONG_THRUST_IMPACT_FRAME,
  dongFrameAtProgress,
} from '../../src/sprites/dongQuixoteTiming';

/** How a gate reports; the caller owns the failure count. */
export interface LancerGateReporter {
  section(name: string): void;
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const DONG = getMercenaryTemplate('dong_quixote');
const CHARGE_DAMAGE = Math.round(DONG.damage * CHARGE_DAMAGE_MULTIPLE);
const FLOOR = 'level3';

const ROOM_WIDTH_TILES = 36;
const ROOM_HEIGHT_TILES = 13;
const LANE_ROW = Math.floor(ROOM_HEIGHT_TILES / 2);
const OWNER_TILE_X = 4;
const DONG_TILE_X = OWNER_TILE_X + 2;
const PACK_SIZE = 3;
const PACK_SPACING_TILES = 1;
/** The nearest of the pack stands this far down the lane: inside the charge window. */
const PACK_NEAREST_TILES = 4;
/** The same pack this close: lance range, no run-up. */
const CLOSE_PACK_NEAREST_TILES = 1;

function packOffsets(nearestTiles: number): readonly number[] {
  return Array.from({ length: PACK_SIZE }, (_, index) => nearestTiles + index * PACK_SPACING_TILES);
}

const PACK_OFFSETS_TILES = packOffsets(PACK_NEAREST_TILES);
const CLOSE_PACK_OFFSETS_TILES = packOffsets(CLOSE_PACK_NEAREST_TILES);
/** A wall across the lane just past the nearest foe, and a foe behind it. */
const WALL_OFFSET_TILES = 5;
const BEHIND_WALL_OFFSET_TILES = 7;
/**
 * Where a friend stands in the lane: between him and a foe a tile further on.
 * Both past the charge's trigger distance by more than a step, so the body,
 * made hostile, is charged rather than walked up to and jabbed.
 */
const FRIEND_OFFSET_TILES = 4;
const FRIEND_TARGET_OFFSET_TILES = 5;
/** Rows off the lane a crawler stands when she is out of the way. */
const OFF_LANE_ROWS = 3;
/** Where a stairwell sits across the lane. */
const STAIRWELL_OFFSET_TILES = 2;

/** Never killed by anything the checks do, so every blow is measurable. */
const UNKILLABLE_HP = 1_000_000;
/** A dummy on this much dies to one jab. */
const ONE_JAB_HP = 1;
/** Slow but not rooted, so a charge may fling it; it never walks, having no AI. */
const DUMMY_SPEED = 1;

/** Room for a wind-up, the run, the winded stop and a little after. */
const FIGHT_FRAMES = 240;
/** Long enough for the jab to start and land. */
const JAB_FRAMES = 120;
/** A body flung by the charge ends at least this far from where it stood. */
const FLUNG_MIN_TILES = 0.5;
/** Frames past the cooldown the second charge may take to start. */
const COOLDOWN_SLACK_FRAMES = 30;
const COOLDOWN_RUN_FRAMES = CHARGE_COOLDOWN_FRAMES + FIGHT_FRAMES;
/** Frames after being hired within which the salute must show. */
const HIRE_SALUTE_FRAMES = 5;
/** Frames after a kill the salute may take to start: the jab plays out first. */
const KILL_SALUTE_FRAMES = 150;
/** Tiles a second hostile stands from the kill, close enough to forbid posing. */
const NEARBY_HOSTILE_OFFSET_TILES = 3;
/** Rows off the lane a foe stands beside the end of a charge: clear of the lance, close to him. */
const NEIGHBOUR_ROWS_OFF_LANE = 2;

/** A target that stands where it is put and decides nothing. */
class SparringDummy extends Mob {
  readonly xpValue = 0;

  constructor(
    tileX: number,
    tileY: number,
    private readonly hostile = true,
  ) {
    super(tileX, tileY, TILE_SIZE, UNKILLABLE_HP, DUMMY_SPEED);
  }

  override get isHostile(): boolean {
    return this.hostile;
  }

  override updateAI(): void {
    // A dummy makes no decisions; every check places it by hand.
  }

  protected override drawSelf(): void {
    // Nothing here is ever rendered.
  }
}

interface RoomFeatures {
  /** Tiles east of Dong at which a wall runs the room's full height. */
  readonly wallOffsetTiles?: number;
  /** Tiles east of Dong, on the lane, of a stairwell tile. */
  readonly stairwellOffsetTiles?: number;
}

interface LancerHarness {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly system: MercenarySystem;
  readonly mobs: MobRoster;
  readonly ctx: SystemContext;
  readonly merc: Mercenary;
  readonly kit: LancerKit;
}

function makeRoom(features: RoomFeatures): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  const wallX =
    features.wallOffsetTiles === undefined ? null : DONG_TILE_X + features.wallOffsetTiles;
  const grid: TileContent[][] = Array.from({ length: ROOM_HEIGHT_TILES }, (_, y) =>
    Array.from({ length: ROOM_WIDTH_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === lastX || y === lastY;
      const isWall = isBorder || x === wallX;
      return {
        tileId: `${x}#${y}`,
        type: isWall ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  // At the real tile height, or every sight test measures against the wrong grid.
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  if (features.stairwellOffsetTiles !== undefined) {
    map.setStairwellTiles([{ x: DONG_TILE_X + features.stairwellOffsetTiles, y: LANE_ROW }]);
  }
  return map;
}

/** Hires Dong beside his owner through the real system, or null if the kit is not his. */
function buildHarness(features: RoomFeatures = {}, introduced = true): LancerHarness | null {
  const map = makeRoom(features);
  const human = new HumanPlayer(OWNER_TILE_X, LANE_ROW, TILE_SIZE);
  // Behind the owner and off the lane, so she is never in the fight by accident.
  const cat = new CatPlayer(OWNER_TILE_X - 2, LANE_ROW + OFF_LANE_ROWS, TILE_SIZE);
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const roster = createMercenaryRoster();
  roster.active = { id: DONG.id, name: DONG.name, contractLevelId: FLOOR, introduced };
  const system = new MercenarySystem(roster, FLOOR);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
  };
  system.update(ctx);
  const merc = system.activeMerc;
  if (merc === null || !(merc.kit instanceof LancerKit)) return null;
  return { human, cat, system, mobs, ctx, merc, kit: merc.kit };
}

function placeBody(harness: LancerHarness, body: Mob, tileX: number, tileY: number): void {
  const ox = body.x;
  const oy = body.y;
  body.x = tileX * TILE_SIZE;
  body.y = tileY * TILE_SIZE;
  harness.mobs.grid.move(body, ox, oy);
}

/** Stands Dong on his mark facing down the lane, with nothing on his mind. */
function placeDong(harness: LancerHarness): void {
  placeBody(harness, harness.merc, DONG_TILE_X, LANE_ROW);
  harness.merc.facingX = 1;
  harness.merc.facingY = 0;
  harness.merc.speech.clear();
}

function addDummy(
  harness: LancerHarness,
  offsetTiles: number,
  hostile = true,
  row = LANE_ROW,
): SparringDummy {
  const dummy = new SparringDummy(DONG_TILE_X + offsetTiles, row, hostile);
  harness.mobs.add(dummy);
  return dummy;
}

/**
 * One frame of the scene, in `MobUpdateLoop`'s order: the system, then every
 * living mob's AI, its knockback, its timers and its grid cell.
 */
function stepFrame(harness: LancerHarness): void {
  harness.system.update(harness.ctx);
  const targets = [harness.human, harness.cat];
  for (const mob of [...harness.mobs.mobs]) {
    if (!mob.isAlive) continue;
    const ox = mob.x;
    const oy = mob.y;
    mob.updateAI(targets);
    mob.advanceKnockback();
    mob.tickTimers();
    harness.mobs.grid.move(mob, ox, oy);
  }
}

interface VictimRecord {
  readonly hpLost: number;
  readonly displacedTiles: number;
}

/** What happened over a fight. */
interface ChargeRecord {
  readonly windupStarts: readonly number[];
  /** Pixels Dong moved while winding up. */
  readonly windupMovementPx: number;
  readonly windupFrames: number;
  /** Pixels Dong moved while winded. */
  readonly recoverMovementPx: number;
  readonly recoverFrames: number;
  readonly victims: readonly VictimRecord[];
  readonly friendsHpLost: number;
  /** HP the onlookers lost on the frames the charge was running. */
  readonly friendsHpLostToCharge: number;
  /** How many victims died on frames the charge was running. */
  readonly chargeKills: number;
  readonly crawlerHpLost: number;
  readonly furthestDongX: number;
  readonly rowsSeen: ReadonlySet<MercenaryRow>;
}

function fight(
  harness: LancerHarness,
  victims: readonly Mob[],
  friends: readonly Mob[],
  frames: number,
  eachFrame: () => void = () => undefined,
): ChargeRecord {
  const { merc, kit } = harness;
  const startHp = victims.map((victim) => victim.hp);
  const startPos = victims.map((victim) => ({ x: victim.x, y: victim.y }));
  const friendHp = friends.reduce((sum, friend) => sum + friend.hp, 0);
  const humanHp = harness.human.hp;
  const catHp = harness.cat.hp;
  const windupStarts: number[] = [];
  const rowsSeen = new Set<MercenaryRow>();
  let windupMovementPx = 0;
  let windupFrames = 0;
  let recoverMovementPx = 0;
  let recoverFrames = 0;
  let furthestDongX = merc.x;
  let previousStage = kit.chargeStage;
  let friendsHpLostToCharge = 0;
  let chargeKills = 0;
  const sumHp = (bodies: readonly Mob[]): number => bodies.reduce((sum, body) => sum + body.hp, 0);
  for (let frame = 0; frame < frames; frame++) {
    eachFrame();
    const beforeX = merc.x;
    const beforeY = merc.y;
    const friendHpBefore = sumHp(friends);
    const livingBefore = victims.filter((victim) => victim.isAlive).length;
    stepFrame(harness);
    const movedPx = Math.hypot(merc.x - beforeX, merc.y - beforeY);
    const stage = kit.chargeStage;
    // The run's last stride is taken on the frame the stage turns to recovery.
    const chargeRan = stage === 'charging' || previousStage === 'charging';
    if (chargeRan) {
      friendsHpLostToCharge += friendHpBefore - sumHp(friends);
      chargeKills += livingBefore - victims.filter((victim) => victim.isAlive).length;
    }
    if (stage === 'windup' && previousStage !== 'windup') windupStarts.push(frame);
    // A stage's first frame also carries the step that led into it — the
    // walk up before the wind-up, the last stride before the stop — so only
    // frames spent wholly inside a stage count as its movement.
    const wholeFrameInStage = stage === previousStage;
    if (stage === 'windup') {
      windupFrames++;
      if (wholeFrameInStage) windupMovementPx += movedPx;
    }
    if (stage === 'recover') {
      recoverFrames++;
      if (wholeFrameInStage) recoverMovementPx += movedPx;
    }
    previousStage = stage;
    furthestDongX = Math.max(furthestDongX, merc.x);
    rowsSeen.add(kit.drawState(merc).row);
  }
  return {
    windupStarts,
    windupMovementPx,
    windupFrames,
    recoverMovementPx,
    recoverFrames,
    victims: victims.map((victim, index) => ({
      hpLost: startHp[index] - victim.hp,
      displacedTiles:
        Math.hypot(victim.x - startPos[index].x, victim.y - startPos[index].y) / TILE_SIZE,
    })),
    friendsHpLost: friendHp - sumHp(friends),
    friendsHpLostToCharge,
    chargeKills,
    crawlerHpLost: Math.max(humanHp - harness.human.hp, catHp - harness.cat.hp),
    furthestDongX,
    rowsSeen,
  };
}

/** A fresh Dong on his mark with hostile dummies at `offsets` down the lane, fought for a while. */
function chargeAt(
  offsets: readonly number[],
  features: RoomFeatures = {},
  setup: (harness: LancerHarness) => readonly Mob[] = () => [],
): ChargeRecord | null {
  const harness = buildHarness(features);
  if (harness === null) return null;
  placeDong(harness);
  const pack = offsets.map((offset) => addDummy(harness, offset));
  const friends = setup(harness);
  return fight(harness, pack, friends, FIGHT_FRAMES);
}

function wasStruckByCharge(victim: VictimRecord): boolean {
  return victim.hpLost >= CHARGE_DAMAGE && victim.displacedTiles >= FLUNG_MIN_TILES;
}

/** Every one of the pack took a charge's damage and was flung off its spot. */
function ranDownEveryone(record: ChargeRecord | null): boolean {
  return record !== null && record.victims.length > 0 && record.victims.every(wasStruckByCharge);
}

function charged(record: ChargeRecord | null): boolean {
  return record !== null && record.windupStarts.length > 0;
}

function describeVictims(record: ChargeRecord | null): string {
  if (record === null) return 'no harness';
  return record.victims
    .map((victim) => `${victim.hpLost} HP/${victim.displacedTiles.toFixed(1)} t`)
    .join(', ');
}

function checkChargeLandsOnThePack(report: LancerGateReporter): void {
  report.section('Dong Quixote: the charge');

  const pack = chargeAt(PACK_OFFSETS_TILES);
  report.check(
    ranDownEveryone(pack),
    `a pack ${PACK_OFFSETS_TILES.join('/')} tiles down the lane is run down: each loses at least ${CHARGE_DAMAGE} and is flung ${FLUNG_MIN_TILES}+ tiles (${describeVictims(pack)})`,
  );
  const close = chargeAt(CLOSE_PACK_OFFSETS_TILES);
  report.checkCatches(
    ranDownEveryone(close),
    `a pack inside lance range (${CLOSE_PACK_OFFSETS_TILES.join('/')} tiles) is jabbed, not run down (${describeVictims(close)})`,
  );

  report.check(
    pack !== null &&
      pack.windupFrames === CHARGE_WINDUP_TICKS &&
      pack.windupMovementPx === 0 &&
      pack.rowsSeen.has('charge_windup'),
    `the wind-up holds him still for all ${CHARGE_WINDUP_TICKS} frames (${pack?.windupFrames ?? 0} frames, ${pack?.windupMovementPx.toFixed(1) ?? '?'} px)`,
  );
  report.check(
    pack !== null &&
      pack.recoverFrames === CHARGE_RECOVER_TICKS &&
      pack.recoverMovementPx === 0 &&
      pack.rowsSeen.has('charge_recover'),
    `he stands winded for all ${CHARGE_RECOVER_TICKS} frames after (${pack?.recoverFrames ?? 0} frames, ${pack?.recoverMovementPx.toFixed(1) ?? '?'} px)`,
  );
  report.checkCatches(
    close !== null && close.windupFrames === CHARGE_WINDUP_TICKS,
    'the wind-up measure sees no wind-up when there was no charge',
  );
}

function checkWall(report: LancerGateReporter): void {
  report.section('Dong Quixote: the first wall stops him');
  const wallX = (DONG_TILE_X + WALL_OFFSET_TILES) * TILE_SIZE;
  const setup = (harness: LancerHarness): readonly Mob[] => [
    addDummy(harness, BEHIND_WALL_OFFSET_TILES),
  ];
  const walled = chargeAt([PACK_NEAREST_TILES], { wallOffsetTiles: WALL_OFFSET_TILES }, setup);
  // The foe behind the wall is handed to the record as an onlooker, so its HP is watched apart.
  const behindWallHit = walled !== null && walled.friendsHpLost !== 0;
  report.check(
    charged(walled) && walled !== null && walled.furthestDongX < wallX && !behindWallHit,
    `a charge at a foe before a wall ends short of the wall, and the foe behind it is untouched (furthest ${((walled?.furthestDongX ?? 0) / TILE_SIZE).toFixed(2)} t, wall at ${DONG_TILE_X + WALL_OFFSET_TILES})`,
  );
  const open = chargeAt([PACK_NEAREST_TILES]);
  report.checkCatches(
    open !== null && open.furthestDongX < wallX,
    `the same charge with no wall runs on past where the wall stood (${((open?.furthestDongX ?? 0) / TILE_SIZE).toFixed(2)} t)`,
  );
}

function checkFriendsInTheLane(report: LancerGateReporter): void {
  report.section('Dong Quixote: never through a friend');

  const catInLane = (harness: LancerHarness): readonly Mob[] => {
    harness.cat.x = (DONG_TILE_X + FRIEND_OFFSET_TILES) * TILE_SIZE;
    harness.cat.y = LANE_ROW * TILE_SIZE;
    return [];
  };
  const withCat = chargeAt([FRIEND_TARGET_OFFSET_TILES], {}, catInLane);
  report.check(
    withCat !== null && !charged(withCat) && withCat.crawlerHpLost === 0,
    `with the cat standing in the lane he does not charge, and no crawler is hurt (${withCat?.crawlerHpLost ?? '?'} HP)`,
  );
  report.checkCatches(
    !charged(chargeAt([FRIEND_TARGET_OFFSET_TILES])),
    'the no-charge measure sees the charge down the same lane with the cat out of it',
  );

  const friendInLane = (hostile: boolean) => (harness: LancerHarness) => [
    addDummy(harness, FRIEND_OFFSET_TILES, hostile),
  ];
  const withFriend = chargeAt([FRIEND_TARGET_OFFSET_TILES], {}, friendInLane(false));
  report.check(
    withFriend !== null && !charged(withFriend) && withFriend.friendsHpLost === 0,
    `with a friendly creature in the lane he does not charge, and it is untouched (${withFriend?.friendsHpLost ?? '?'} HP)`,
  );
  const withFoe = chargeAt([FRIEND_TARGET_OFFSET_TILES], {}, friendInLane(true));
  report.check(
    withFoe !== null && charged(withFoe) && withFoe.friendsHpLostToCharge >= CHARGE_DAMAGE,
    `the same body made hostile is charged and run down with the rest (${withFoe?.friendsHpLostToCharge ?? '?'} HP to the charge)`,
  );
  report.checkCatches(
    withFoe !== null && withFoe.friendsHpLost === 0,
    'the untouched measure sees the damage that body took when hostile',
  );
}

function checkWalkableLane(report: LancerGateReporter): void {
  report.section('Dong Quixote: a lane he can run');
  const stairs = chargeAt([PACK_NEAREST_TILES], {
    stairwellOffsetTiles: STAIRWELL_OFFSET_TILES,
  });
  const sightClear = stairwellLaneIsInSight();
  report.check(
    sightClear && stairs !== null && !charged(stairs),
    `a stairwell across the lane, which sight sees straight over (${sightClear ? 'clear' : 'blocked'}), refuses the charge`,
  );
  report.checkCatches(
    !charged(chargeAt([PACK_NEAREST_TILES])),
    'the no-charge measure sees the charge down the same lane with no stairwell',
  );
}

/** Whether sight runs clear down the lane over the stairwell, so the walk test is what refuses it. */
function stairwellLaneIsInSight(): boolean {
  const harness = buildHarness({ stairwellOffsetTiles: STAIRWELL_OFFSET_TILES });
  if (harness === null) return false;
  placeDong(harness);
  const half = TILE_SIZE / 2;
  const fromX = harness.merc.x + half;
  const toX = (DONG_TILE_X + PACK_NEAREST_TILES) * TILE_SIZE + half;
  const y = harness.merc.y + half;
  return harness.merc.hasClearLine(fromX, y, toX, y);
}

/**
 * Frames from one wind-up to the next, with Dong and the pack put back on
 * their marks every frame between charges so the lane is always open and
 * only the cooldown can hold him.
 */
function framesBetweenCharges(): number | null {
  const harness = buildHarness();
  if (harness === null) return null;
  placeDong(harness);
  const pack = PACK_OFFSETS_TILES.map((offset) => addDummy(harness, offset));
  const reset = (): void => {
    if (harness.kit.chargeStage !== null) return;
    placeDong(harness);
    pack.forEach((dummy, index) => {
      placeBody(harness, dummy, DONG_TILE_X + PACK_OFFSETS_TILES[index], LANE_ROW);
    });
  };
  const record = fight(harness, pack, [], COOLDOWN_RUN_FRAMES, reset);
  if (record.windupStarts.length < 2) return null;
  return record.windupStarts[1] - record.windupStarts[0];
}

function checkCooldown(report: LancerGateReporter): void {
  const gap = framesBetweenCharges();
  report.check(
    gap !== null &&
      gap >= CHARGE_COOLDOWN_FRAMES &&
      gap <= CHARGE_COOLDOWN_FRAMES + COOLDOWN_SLACK_FRAMES,
    `a second charge down an open lane waits out the ${CHARGE_COOLDOWN_FRAMES}-frame cooldown (${gap ?? 'no second charge'} frames apart)`,
  );
  report.checkCatches(
    gap === null,
    'the reset lane is charged a second time once the cooldown is out, so the gap is measured',
  );
}

/** The drawn thrust frame on each frame a jab took HP off its victim. */
function jabImpactFrames(): readonly number[] {
  const harness = buildHarness();
  if (harness === null) return [];
  placeDong(harness);
  const victim = addDummy(harness, 1);
  const frames: number[] = [];
  for (let frame = 0; frame < JAB_FRAMES; frame++) {
    const before = victim.hp;
    stepFrame(harness);
    if (victim.hp >= before) continue;
    const state = harness.kit.drawState(harness.merc);
    if (state.row === 'thrust') {
      frames.push(dongFrameAtProgress(DONG_THRUST_FRAMES, state.progress));
    }
  }
  return frames;
}

function checkJab(report: LancerGateReporter): void {
  report.section('Dong Quixote: the jab');
  const impacts = jabImpactFrames();
  const landsOn = (frame: number): boolean =>
    impacts.length > 0 && impacts.every((impact) => impact === frame);
  report.check(
    landsOn(DONG_THRUST_IMPACT_FRAME),
    `the jab lands on the drawn impact frame ${DONG_THRUST_IMPACT_FRAME} (landed on ${impacts.join(', ') || 'nothing'})`,
  );
  report.checkCatches(
    landsOn(DONG_THRUST_IMPACT_FRAME - 1),
    'the impact-frame check tells the impact frame from the one before it',
  );
}

function salutedOnHire(introduced: boolean): boolean {
  const harness = buildHarness({}, introduced);
  if (harness === null) return false;
  for (let frame = 0; frame < HIRE_SALUTE_FRAMES; frame++) {
    if (harness.kit.drawState(harness.merc).row === 'salute') return true;
    stepFrame(harness);
  }
  return false;
}

/** Whether he salutes after jabbing a one-hit foe dead, with or without a second foe close by. */
function salutedAfterKill(withNeighbour: boolean): boolean {
  const harness = buildHarness();
  if (harness === null) return false;
  placeDong(harness);
  const victim = addDummy(harness, 1);
  victim.hp = ONE_JAB_HP;
  if (withNeighbour) addDummy(harness, NEARBY_HOSTILE_OFFSET_TILES, true, LANE_ROW + 1);
  const record = fight(harness, [victim], [], KILL_SALUTE_FRAMES);
  return !victim.isAlive && record.rowsSeen.has('salute');
}

/**
 * Whether he salutes a one-hit foe his charge killed, once the run and the
 * winded stop are over — with or without a second foe near where he stops.
 */
function salutedAfterChargeKill(withNeighbour: boolean): boolean {
  const harness = buildHarness();
  if (harness === null) return false;
  placeDong(harness);
  const victim = addDummy(harness, PACK_NEAREST_TILES);
  victim.hp = ONE_JAB_HP;
  if (withNeighbour) {
    addDummy(harness, CHARGE_MAX_LENGTH_TILES, true, LANE_ROW + NEIGHBOUR_ROWS_OFF_LANE);
  }
  const record = fight(harness, [victim], [], FIGHT_FRAMES);
  return record.chargeKills === 1 && record.rowsSeen.has('salute');
}

function checkSalute(report: LancerGateReporter): void {
  report.section('Dong Quixote: the salute');
  report.check(salutedOnHire(false), 'he salutes as he steps out newly hired');
  report.checkCatches(salutedOnHire(true), 'a hireling already introduced does not salute again');
  report.check(salutedAfterKill(false), 'he salutes a kill with nothing else near');
  report.checkCatches(
    salutedAfterKill(true),
    'he does not pose with another hostile three tiles off',
  );
  report.check(
    salutedAfterChargeKill(false),
    'he salutes a foe his charge killed, once he has his breath back',
  );
  report.checkCatches(
    salutedAfterChargeKill(true),
    'he does not pose after a charge kill with another hostile beside where he stopped',
  );
}

export function verifyLancerKit(report: LancerGateReporter): void {
  const harness = buildHarness();
  report.section('Dong Quixote: kit');
  report.check(harness !== null, "Dong Quixote's hire fights with the lancer kit");
  if (harness === null) return;
  checkChargeLandsOnThePack(report);
  checkWall(report);
  checkFriendsInTheLane(report);
  checkWalkableLane(report);
  checkCooldown(report);
  checkJab(report);
  checkSalute(report);
}
