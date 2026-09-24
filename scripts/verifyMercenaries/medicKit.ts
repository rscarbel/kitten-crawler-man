/**
 * Headless checks on Bucket Boy's medic kit, run from `verify-mercenaries.ts`.
 *
 * - Triage heals: a crawler below half health nearby gains the heal's worth of
 *   HP — measured on her HP, not by counting casts — and it lands on the frame
 *   the glow peaks, not when the channel starts. He heals himself the same way.
 * - Triage waits: a healthy party gets nothing, and with a hostile at his elbow
 *   he cowers instead of channelling.
 * - He runs: a hostile inside two tiles is left behind, with no back-and-forth
 *   while a slower one chases him.
 * - Cornered, he slaps: the hostile loses HP, the crawler beside him loses none.
 * - The party never loses a talk press to him: parked in his follow band he is
 *   in talk range, and a nearby hostile still wins the press.
 *
 * Every rule is paired with a control that must go the other way, so a check
 * that cannot see its effect fails rather than passes.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mercenary } from '../../src/creatures/Mercenary';
import type { Mob } from '../../src/creatures/Mob';
import { createMercenaryRoster } from '../../src/core/MercenaryRoster';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import { createMob } from '../../src/levels/spawner';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { withWorldSeed } from '../../src/core/WorldRandom';
import { resetPathfindBudget } from '../../src/creatures/pathfindBudget';
import {
  CORNERED_FRAMES,
  MEDIC_FLEE_ENTER_TILES,
  MedicKit,
  MEDIC_ADJACENT_TILES,
  MEDIC_LEFT_BEHIND_TILES,
  TRIAGE_CHANNEL_FRAMES,
  TRIAGE_COOLDOWN_FRAMES,
  TRIAGE_HEAL_FRACTION,
  TRIAGE_RELEASE_FRAME,
  TRIAGE_TRIGGER_HP_FRACTION,
} from '../../src/creatures/mercenaries/medicKit';

let failures = 0;
function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

const FLOOR = 'level3';
const MEDIC_GATE_SEED = 0x6b75636b;
const ROOM_SIZE_TILES = 20;
const ROOM_MIDDLE_TILE = Math.floor(ROOM_SIZE_TILES / 2);
/** Well under the trigger, so the patient is unambiguous. */
const WOUNDED_HP_FRACTION = 0.3;
/** Comfortably over the trigger. */
const HEALTHY_HP_FRACTION = 0.8;
/** Long enough for any cooldown-free channel to start, play and land. */
const TRIAGE_WATCH_CHANNELS = 3;
const TRIAGE_WATCH_FRAMES = TRIAGE_CHANNEL_FRAMES * TRIAGE_WATCH_CHANNELS;
/** Long enough for a full triage cooldown and a second chance to go wrong. */
const QUIET_WATCH_FRAMES = 700;
const FLEE_WATCH_FRAMES = 120;
/** A hostile this close is inside the flee trigger. */
const THREAT_START_TILES = 1.5;
/** Past the flee exit, with some to spare. */
const ESCAPED_TILES = 3;
const CHASE_FRAMES = 1200;
/** Well under his own speed, so he can open a gap and the chase keeps re-closing it. */
const CHASER_SPEED_PX = 1.4;
/** Consecutive steps pointing more than this far apart count as a reversal. */
const REVERSAL_DOT = -0.5;
/**
 * A clean chase measures under ten, from corners. Flee and follow taking turns
 * measures past thirty; with no hysteresis at all, hundreds.
 */
const MAX_CHASE_REVERSALS = 20;
/** Room for the corner to be found, and several slaps after it. */
const CORNER_WATCH_SPANS = 4;
const CORNER_WATCH_FRAMES = CORNERED_FRAMES * CORNER_WATCH_SPANS;
/** Close enough to slap, far enough not to share his tile. */
const CORNER_THREAT_OFFSET_TILES = 0.6;
const CORNER_THREAT_OFFSET_PX = TILE_SIZE * CORNER_THREAT_OFFSET_TILES;
const NEARBY_HOSTILE_OFFSET_TILES = 4;
/** Straight below him and inside the flee trigger. */
const WALL_THREAT_OFFSET_TILES = 1.25;
const PARK_FRAMES = 240;
/** Rows left open under a partition, so the room is still one room. */
const PARTITION_GAP_ROWS = 2;
const PARTITION_COLUMN = ROOM_MIDDLE_TILE + 1;
/** In range either side of the partition: two tiles this side of it, two tiles past it. */
const PARTITION_NEAR_SIDE_TILE = PARTITION_COLUMN - 2;
const PARTITION_FAR_SIDE_TILE = PARTITION_COLUMN + 2;
/** Frames into the channel before the patient steps out of sight. */
const STEP_BEHIND_WALL_FRAME = 10;
/** Past a full cooldown and a second channel, so a second heal has every chance to land. */
const COOLDOWN_WATCH_FRAMES =
  TRIAGE_COOLDOWN_FRAMES + TRIAGE_CHANNEL_FRAMES * TRIAGE_WATCH_CHANNELS;
/**
 * Frames a wounded party may leave him within reach of a chaser beyond what a
 * healthy one does: one cut-short channel's worth, not a fight's.
 */
const CHASE_ADJACENT_ALLOWANCE_FRAMES = TRIAGE_CHANNEL_FRAMES;
/** A long hall, so an owner can walk far past a mob standing in it. */
const HALL_WIDTH_TILES = 44;
const HALL_HEIGHT_TILES = 9;
const HALL_MIDDLE_ROW = Math.floor(HALL_HEIGHT_TILES / 2);
const HALL_OWNER_START_TILE = 4;
const HALL_MEDIC_START_TILE = 6;
/** Inside his wary radius from where he starts, and squarely between him and where the owner goes. */
const HALL_IDLE_HOSTILE_TILE = 10;
const HALL_OWNER_END_TILE = 40;
const HALL_OWNER_WALK_PX = 2;
const HALL_WATCH_FRAMES = 1500;
const FIELD_SIZE_TILES = 40;
const FIELD_MIDDLE_TILE = FIELD_SIZE_TILES / 2;
/** Far enough east of the middle that he is left behind from the start. */
const FIELD_OWNER_WALL_GAP_TILES = 4;
const FIELD_OWNER_TILE = FIELD_SIZE_TILES - FIELD_OWNER_WALL_GAP_TILES;
/** How often the fickle hostile changes its mind. */
const FICKLE_SWITCH_FRAMES = 25;
const FICKLE_STRIKE_DAMAGE = 1;
const FICKLE_STRIKE_COOLDOWN_FRAMES = 30;
/**
 * Each time the chaser closes in again he may start and end one flee — a
 * couple of dozen over the watch. A flee that ends whenever it looks away
 * starts and stops on every change of mind, over sixty.
 */
const MAX_FICKLE_FLEE_TOGGLES = 40;
/** Back at his owner's side, give or take a band. */
const REJOINED_TILES = 3;
/** HP a crawler is left on for the slap test — below the triage trigger it would draw a heal. */
const CRAWLER_FULL = 1;

/**
 * A walled room. `partitionColumn`, when given, is a wall down that column
 * from the top border to two rows short of the bottom one, leaving a gap.
 */
function makeRoom(widthTiles: number, heightTiles: number, partitionColumn?: number): GameMap {
  const grid: TileContent[][] = Array.from({ length: heightTiles }, (_, y) =>
    Array.from({ length: widthTiles }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === widthTiles - 1 || y === heightTiles - 1;
      const isPartition = x === partitionColumn && y < heightTiles - PARTITION_GAP_ROWS;
      return {
        tileId: `${x}#${y}`,
        type: isBorder || isPartition ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

interface Harness {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly mobs: MobRoster;
  readonly system: MercenarySystem;
  readonly ctx: SystemContext;
  readonly merc: Mercenary;
  readonly kit: MedicKit;
}

function build(
  widthTiles = ROOM_SIZE_TILES,
  heightTiles = ROOM_SIZE_TILES,
  partitionColumn?: number,
): Harness | null {
  const map = makeRoom(widthTiles, heightTiles, partitionColumn);
  const human = new HumanPlayer(ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, TILE_SIZE);
  const cat = new CatPlayer(ROOM_MIDDLE_TILE + 1, ROOM_MIDDLE_TILE, TILE_SIZE);
  const mobs = new MobRoster(map, new SpellSystem());
  const roster = createMercenaryRoster();
  roster.active = {
    id: 'bucket_boy',
    name: getMercenaryTemplate('bucket_boy').name,
    contractLevelId: FLOOR,
    introduced: true,
  };
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
  if (merc === null || !(merc.kit instanceof MedicKit)) return null;
  return { map, human, cat, mobs, system, ctx, merc, kit: merc.kit };
}

/**
 * One frame, as `MobUpdateLoop` runs it. The A* quota is per frame and global:
 * left unreset, whatever ran before this check — another kit's, or an earlier
 * section — decides when his next path search is allowed.
 */
function frame(h: Harness): void {
  resetPathfindBudget();
  h.system.update(h.ctx);
  h.merc.tickTimers();
  h.merc.updateAI([]);
}

function placeAt(body: { x: number; y: number }, tileX: number, tileY: number): void {
  body.x = tileX * TILE_SIZE;
  body.y = tileY * TILE_SIZE;
}

function woundTo(body: { hp: number; maxHp: number }, fraction: number): void {
  body.hp = Math.max(1, Math.floor(body.maxHp * fraction));
}

function addHostile(h: Harness, x: number, y: number): Mob {
  const mob = createMob('goblin', 0, 0, h.map);
  mob.x = x;
  mob.y = y;
  mob.hp = mob.maxHp;
  h.mobs.add(mob);
  return mob;
}

const PERCENT = 100;
function percent(fraction: number): string {
  return `${fraction * PERCENT}%`;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Triage ─────────────────────────────────────────────────────────────────

interface HealOutcome {
  readonly restored: number;
  readonly expected: number;
  /** Frames from the channel's first frame to the frame the HP rose. */
  readonly landedAfter: number | null;
  readonly rowAtLanding: string | null;
}

/** Runs until `patient` gains HP or the watch ends, and reports how it went. */
function watchHeal(
  h: Harness,
  patient: { hp: number; maxHp: number },
  frames: number,
): HealOutcome {
  const start = patient.hp;
  const expected = Math.min(
    patient.maxHp - start,
    Math.max(1, Math.round(patient.maxHp * TRIAGE_HEAL_FRACTION)),
  );
  let channelStart: number | null = null;
  for (let f = 0; f < frames; f++) {
    frame(h);
    if (channelStart === null && h.kit.isChanneling) channelStart = f;
    if (patient.hp > start) {
      return {
        restored: patient.hp - start,
        expected,
        landedAfter: channelStart === null ? null : f - channelStart,
        rowAtLanding: h.kit.drawState(h.merc).row,
      };
    }
  }
  return { restored: 0, expected, landedAfter: null, rowAtLanding: null };
}

function checkTriage(): void {
  section('Bucket Boy: Triage heals whoever is hurt worst');

  const crawler = build();
  if (crawler === null) {
    check(false, 'fixture: a bucket_boy contract spawns a medic-kit hireling');
    return;
  }
  woundTo(crawler.human, WOUNDED_HP_FRACTION);
  const healed = watchHeal(crawler, crawler.human, TRIAGE_WATCH_FRAMES);
  check(
    healed.restored === healed.expected && healed.expected > 0,
    `a crawler at ${percent(WOUNDED_HP_FRACTION)} HP gains ${healed.restored} HP (expected ${healed.expected})`,
  );
  check(
    healed.landedAfter === TRIAGE_RELEASE_FRAME && healed.rowAtLanding === 'cast_triage',
    `the heal lands on the release frame, mid-channel (frame ${healed.landedAfter ?? 'never'} of ${TRIAGE_CHANNEL_FRAMES}, want ${TRIAGE_RELEASE_FRAME}; row ${healed.rowAtLanding ?? 'none'})`,
  );
  checkCooldown();
  checkReleaseRecheck();

  const self = build();
  if (self !== null) {
    woundTo(self.merc, WOUNDED_HP_FRACTION);
    // His own draught would reach him first; this measures Triage alone.
    self.merc.survival.potionCooldownFrames = TRIAGE_WATCH_FRAMES;
    const selfHeal = watchHeal(self, self.merc, TRIAGE_WATCH_FRAMES);
    check(
      selfHeal.restored === selfHeal.expected && selfHeal.expected > 0,
      `wounded himself, he heals himself (+${selfHeal.restored}, expected ${selfHeal.expected})`,
    );
  }

  const healthy = build();
  if (healthy !== null) {
    woundTo(healthy.human, HEALTHY_HP_FRACTION);
    const start = healthy.human.hp;
    const quiet = watchHeal(healthy, healthy.human, QUIET_WATCH_FRAMES);
    check(
      quiet.restored === 0 && healthy.human.hp === start,
      `a crawler at ${percent(HEALTHY_HP_FRACTION)} HP (over the ${percent(TRIAGE_TRIGGER_HP_FRACTION)} trigger) is left alone`,
    );
  }

  const hostileHeal = build();
  if (hostileHeal !== null) {
    const enemy = addHostile(
      hostileHeal,
      hostileHeal.human.x + TILE_SIZE * NEARBY_HOSTILE_OFFSET_TILES,
      hostileHeal.human.y,
    );
    enemy.hp = 1;
    // Unmoving and unhurt, it is only here to be a wounded body he might wrongly treat.
    for (let f = 0; f < QUIET_WATCH_FRAMES; f++) frame(hostileHeal);
    check(enemy.hp === 1, 'a wounded hostile in range is never healed');
  }
}

/**
 * A patient who stays under the trigger after one heal: the second heal must
 * come, and not before the cooldown since the first channel started.
 */
function checkCooldown(): void {
  const h = build();
  if (h === null) return;
  woundTo(h.human, WOUNDED_HP_FRACTION);
  const channelStarts: number[] = [];
  let heals = 0;
  let wasChanneling = false;
  let lastHp = h.human.hp;
  for (let f = 0; f < COOLDOWN_WATCH_FRAMES; f++) {
    frame(h);
    if (h.kit.isChanneling && !wasChanneling) channelStarts.push(f);
    wasChanneling = h.kit.isChanneling;
    if (h.human.hp > lastHp) heals++;
    lastHp = h.human.hp;
  }
  const gap = channelStarts.length >= 2 ? channelStarts[1] - channelStarts[0] : null;
  check(
    heals >= 2 && gap !== null && gap >= TRIAGE_COOLDOWN_FRAMES,
    `a patient still under the trigger gets a second heal, a cooldown later (${heals} heals; channels ${gap ?? 'never'} frames apart, at least ${TRIAGE_COOLDOWN_FRAMES})`,
  );
}

/**
 * A patient who steps behind a wall mid-channel is not healed through it. In
 * the control she stays in sight, so the watch can see a heal at all.
 */
function healThroughWall(stepsBehind: boolean): boolean {
  const h = build(ROOM_SIZE_TILES, ROOM_SIZE_TILES, PARTITION_COLUMN);
  if (h === null) return false;
  placeAt(h.merc, PARTITION_NEAR_SIDE_TILE - 1, ROOM_MIDDLE_TILE);
  placeAt(h.human, PARTITION_NEAR_SIDE_TILE, ROOM_MIDDLE_TILE);
  placeAt(h.cat, PARTITION_NEAR_SIDE_TILE, ROOM_MIDDLE_TILE + 1);
  woundTo(h.human, WOUNDED_HP_FRACTION);
  const start = h.human.hp;
  let channelFrames = 0;
  for (let f = 0; f < TRIAGE_CHANNEL_FRAMES; f++) {
    frame(h);
    if (h.kit.isChanneling) channelFrames++;
    if (stepsBehind && channelFrames === STEP_BEHIND_WALL_FRAME) {
      placeAt(h.human, PARTITION_FAR_SIDE_TILE, ROOM_MIDDLE_TILE);
    }
  }
  return h.human.hp > start;
}

function checkReleaseRecheck(): void {
  check(
    !healThroughWall(true),
    'a patient who steps behind a wall mid-channel is not healed through it',
  );
  check(healThroughWall(false), 'control: the same patient staying in sight is healed');
}

/** With a hostile at his elbow and a patient waiting, whether he channels, and whether he cowers. */
function adjacentHostileOutcome(withHostile: boolean): { healed: boolean; cowered: boolean } {
  const h = build();
  if (h === null) return { healed: false, cowered: false };
  woundTo(h.human, WOUNDED_HP_FRACTION);
  placeAt(h.merc, 1, 1);
  placeAt(h.human, 2, 2);
  const enemy = withHostile ? addHostile(h, h.merc.x + CORNER_THREAT_OFFSET_PX, h.merc.y) : null;
  const start = h.human.hp;
  let cowered = false;
  for (let f = 0; f < TRIAGE_WATCH_FRAMES; f++) {
    // It stays at his elbow however he runs.
    if (enemy !== null) {
      enemy.x = h.merc.x + CORNER_THREAT_OFFSET_PX;
      enemy.y = h.merc.y;
    }
    frame(h);
    if (h.kit.drawState(h.merc).row === 'cower') cowered = true;
  }
  return { healed: h.human.hp > start, cowered };
}

function checkNoChannelUnderThreat(): void {
  section('Bucket Boy: never channels with a hostile adjacent');
  const threatened = adjacentHostileOutcome(true);
  check(
    !threatened.healed && threatened.cowered,
    `with a hostile adjacent he cowers and does not heal (healed ${threatened.healed}, cowered ${threatened.cowered})`,
  );
  const control = adjacentHostileOutcome(false);
  check(control.healed, 'control: the same patient in the same corner, no hostile, is healed');
}

// ── Fear ───────────────────────────────────────────────────────────────────

function checkFlee(): void {
  section('Bucket Boy: runs from a hostile that gets close');
  const h = build();
  if (h === null) return;
  placeAt(h.merc, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE + 2);
  const enemy = addHostile(h, h.merc.x + TILE_SIZE * THREAT_START_TILES, h.merc.y);
  let fled = false;
  for (let f = 0; f < FLEE_WATCH_FRAMES; f++) {
    frame(h);
    if (h.kit.isFleeing) fled = true;
  }
  const gap = distance(h.merc, enemy) / TILE_SIZE;
  check(
    fled && gap >= ESCAPED_TILES,
    `a hostile at ${THREAT_START_TILES} tiles (inside ${MEDIC_FLEE_ENTER_TILES}) is left ${gap.toFixed(2)} tiles behind`,
  );

  const control = build();
  if (control === null) return;
  placeAt(control.merc, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE + 2);
  const far = addHostile(control, control.merc.x + TILE_SIZE * (ESCAPED_TILES + 1), control.merc.y);
  let everFled = false;
  for (let f = 0; f < FLEE_WATCH_FRAMES; f++) {
    frame(control);
    if (control.kit.isFleeing) everFled = true;
  }
  check(
    !everFled && far.isAlive,
    'control: a hostile outside the trigger does not send him running',
  );
}

/**
 * A hostile directly below him with his back to the north wall: the straight
 * way out is masonry, and a body that keeps taking it never moves. He has to
 * find the way along the wall instead.
 */
function checkWallEscape(): void {
  section('Bucket Boy: backed against a wall, he runs along it');
  const h = build();
  if (h === null) return;
  placeAt(h.merc, ROOM_MIDDLE_TILE, 1);
  const enemy = addHostile(h, h.merc.x, h.merc.y + TILE_SIZE * WALL_THREAT_OFFSET_TILES);
  for (let f = 0; f < FLEE_WATCH_FRAMES; f++) frame(h);
  const gap = distance(h.merc, enemy) / TILE_SIZE;
  check(
    gap >= ESCAPED_TILES && h.kit.framesStuck === 0,
    `with the only straight escape into a wall he still gets ${gap.toFixed(2)} tiles clear (stuck ${h.kit.framesStuck} frames)`,
  );
}

/**
 * Frames a slower chaser spends within reach of him over a chase, with the
 * owner standing wounded or healthy. A medic who stops to channel every time
 * the chaser falls a little behind spends the fight within its reach.
 */
function chaseAdjacentFrames(wounded: boolean): { adjacentFrames: number; healed: boolean } {
  const h = build();
  if (h === null) return { adjacentFrames: CHASE_FRAMES, healed: false };
  woundTo(h.human, wounded ? WOUNDED_HP_FRACTION : HEALTHY_HP_FRACTION);
  const start = h.human.hp;
  placeAt(h.merc, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE + 2);
  const chaser = addHostile(h, h.merc.x + TILE_SIZE * THREAT_START_TILES, h.merc.y);
  // A chaser has noticed him; that is what makes it one.
  chaser.currentTarget = h.merc;
  let adjacentFrames = 0;
  for (let f = 0; f < CHASE_FRAMES; f++) {
    const toMerc = { x: h.merc.x - chaser.x, y: h.merc.y - chaser.y };
    const length = Math.hypot(toMerc.x, toMerc.y);
    if (length > 0) {
      chaser.x += (toMerc.x / length) * CHASER_SPEED_PX;
      chaser.y += (toMerc.y / length) * CHASER_SPEED_PX;
    }
    frame(h);
    if (distance(h.merc, chaser) <= TILE_SIZE * MEDIC_ADJACENT_TILES) adjacentFrames++;
  }
  return { adjacentFrames, healed: h.human.hp > start };
}

function checkHealingUnderChase(): void {
  section('Bucket Boy: a wounded party does not pin him in reach of a chaser');
  const healthy = chaseAdjacentFrames(false);
  const wounded = chaseAdjacentFrames(true);
  check(
    wounded.adjacentFrames <= healthy.adjacentFrames + CHASE_ADJACENT_ALLOWANCE_FRAMES,
    `with a wounded crawler he is within reach of the chaser ${wounded.adjacentFrames} of ${CHASE_FRAMES} frames (healthy party: ${healthy.adjacentFrames}; allowance ${CHASE_ADJACENT_ALLOWANCE_FRAMES})`,
  );
  check(wounded.healed, 'and the wounded crawler is still healed during the chase');
}

/**
 * An idle hostile stands between him and an owner who walks the length of a
 * hall away. Left behind, he must go past it rather than hold off forever.
 */
function checkNotStranded(): void {
  section('Bucket Boy: an idle hostile does not strand him from a departing owner');
  const h = build(HALL_WIDTH_TILES, HALL_HEIGHT_TILES);
  if (h === null) return;
  placeAt(h.human, HALL_OWNER_START_TILE, HALL_MIDDLE_ROW);
  placeAt(h.cat, HALL_OWNER_START_TILE, HALL_MIDDLE_ROW + 1);
  placeAt(h.merc, HALL_MEDIC_START_TILE, HALL_MIDDLE_ROW);
  addHostile(h, HALL_IDLE_HOSTILE_TILE * TILE_SIZE, HALL_MIDDLE_ROW * TILE_SIZE);
  const endX = HALL_OWNER_END_TILE * TILE_SIZE;
  for (let f = 0; f < HALL_WATCH_FRAMES; f++) {
    // The owner walks through the hostile's tile; it has not noticed anyone.
    h.human.x = Math.min(endX, h.human.x + HALL_OWNER_WALK_PX);
    h.cat.x = h.human.x;
    frame(h);
  }
  const gap = distance(h.merc, h.human) / TILE_SIZE;
  checkFlickeringAttention();
  check(
    gap <= REJOINED_TILES,
    `he ends ${gap.toFixed(2)} tiles from an owner who walked ${HALL_OWNER_END_TILE - HALL_OWNER_START_TILE} tiles off (at most ${REJOINED_TILES}; left behind past ${MEDIC_LEFT_BEHIND_TILES})`,
  );
}

/**
 * Left behind, with a hostile on his heels whose attention flips between him
 * and the cat. It keeps coming at him and strikes him when it is after him
 * and in reach. A flee that ends every time it looks away hands him
 * to the follow drive, which walks him back into it.
 */
function checkFlickeringAttention(): void {
  // An open field, so running away never corners him: any hit taken is the
  // flee giving up, not a wall.
  const h = build(FIELD_SIZE_TILES, FIELD_SIZE_TILES);
  if (h === null) return;
  placeAt(h.human, FIELD_OWNER_TILE, FIELD_MIDDLE_TILE);
  placeAt(h.cat, FIELD_OWNER_TILE, FIELD_MIDDLE_TILE + 1);
  placeAt(h.merc, FIELD_MIDDLE_TILE, FIELD_MIDDLE_TILE);
  // Between him and his owner, where the follow drive leads him.
  const fickle = addHostile(
    h,
    h.merc.x + TILE_SIZE * THREAT_START_TILES,
    FIELD_MIDDLE_TILE * TILE_SIZE,
  );
  const hpStart = h.merc.hp;
  let toggles = 0;
  let wasFleeing = h.kit.isFleeing;
  let strikeCooldown = 0;
  for (let f = 0; f < HALL_WATCH_FRAMES; f++) {
    const afterHim = Math.floor(f / FICKLE_SWITCH_FRAMES) % 2 === 0;
    fickle.currentTarget = afterHim ? h.merc : h.cat;
    // It keeps coming at him either way; only what it is looking at changes.
    const toQuarry = { x: h.merc.x - fickle.x, y: h.merc.y - fickle.y };
    const length = Math.hypot(toQuarry.x, toQuarry.y);
    if (length > 0) {
      fickle.x += (toQuarry.x / length) * CHASER_SPEED_PX;
      fickle.y += (toQuarry.y / length) * CHASER_SPEED_PX;
    }
    if (strikeCooldown > 0) strikeCooldown--;
    const inReach = distance(fickle, h.merc) <= TILE_SIZE * MEDIC_ADJACENT_TILES;
    if (afterHim && inReach && strikeCooldown === 0) {
      h.merc.hp -= FICKLE_STRIKE_DAMAGE;
      strikeCooldown = FICKLE_STRIKE_COOLDOWN_FRAMES;
    }
    frame(h);
    if (h.kit.isFleeing !== wasFleeing) toggles++;
    wasFleeing = h.kit.isFleeing;
  }
  const hpLost = hpStart - h.merc.hp;
  check(
    toggles <= MAX_FICKLE_FLEE_TOGGLES && hpLost === 0,
    `a hostile whose attention flips every ${FICKLE_SWITCH_FRAMES} frames: ${toggles} flee starts and stops (at most ${MAX_FICKLE_FLEE_TOGGLES}), ${hpLost} HP lost`,
  );
}

/**
 * A chaser slower than him, walked straight at him each frame. Counts how often
 * his own step turns back on the one before: flee and follow taking turns shows
 * up as a reversal on most frames.
 */
function checkNoZigzag(): void {
  section('Bucket Boy: a chase does not make him zigzag');
  const h = build();
  if (h === null) return;
  placeAt(h.merc, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE + 2);
  const chaser = addHostile(h, h.merc.x + TILE_SIZE * THREAT_START_TILES, h.merc.y);
  // A chaser has noticed him; that is what makes it one.
  chaser.currentTarget = h.merc;
  let reversals = 0;
  let fleeFrames = 0;
  let lastStep: { x: number; y: number } | null = null;
  for (let f = 0; f < CHASE_FRAMES; f++) {
    const toMerc = { x: h.merc.x - chaser.x, y: h.merc.y - chaser.y };
    const length = Math.hypot(toMerc.x, toMerc.y);
    if (length > 0) {
      chaser.x += (toMerc.x / length) * CHASER_SPEED_PX;
      chaser.y += (toMerc.y / length) * CHASER_SPEED_PX;
    }
    const beforeX = h.merc.x;
    const beforeY = h.merc.y;
    frame(h);
    if (h.kit.isFleeing) fleeFrames++;
    const step = { x: h.merc.x - beforeX, y: h.merc.y - beforeY };
    const stepLength = Math.hypot(step.x, step.y);
    if (stepLength === 0) continue;
    const unit = { x: step.x / stepLength, y: step.y / stepLength };
    if (lastStep !== null && unit.x * lastStep.x + unit.y * lastStep.y < REVERSAL_DOT) reversals++;
    lastStep = unit;
  }
  check(
    fleeFrames > 0 && reversals <= MAX_CHASE_REVERSALS,
    `${reversals} step reversals over a ${CHASE_FRAMES}-frame chase (at most ${MAX_CHASE_REVERSALS}; fled ${fleeFrames} frames)`,
  );
}

// ── The cornered slap ──────────────────────────────────────────────────────

interface CornerOutcome {
  readonly hostileLost: number;
  readonly crawlerLost: number;
  /** The frame the first slap landed, or null for none. */
  readonly firstSlapFrame: number | null;
}

function cornerOutcome(cornered: boolean): CornerOutcome {
  const h = build();
  if (h === null) return { hostileLost: 0, crawlerLost: 0, firstSlapFrame: null };
  if (cornered) {
    placeAt(h.merc, 1, 1);
  } else {
    placeAt(h.merc, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE + 2);
  }
  // Beside him, inside his swing, so a slap that went the wrong way would find her.
  h.human.x = h.merc.x;
  h.human.y = h.merc.y + CORNER_THREAT_OFFSET_PX;
  h.human.hp = h.human.maxHp * CRAWLER_FULL;
  const enemy = addHostile(
    h,
    h.merc.x + CORNER_THREAT_OFFSET_PX,
    h.merc.y + CORNER_THREAT_OFFSET_PX,
  );
  const enemyStart = enemy.hp;
  const humanStart = h.human.hp;
  const catStart = h.cat.hp;
  let firstSlapFrame: number | null = null;
  for (let f = 0; f < CORNER_WATCH_FRAMES; f++) {
    // Cornered, it stays on him. In the open it stands still: a kit that
    // slapped whatever came near would slap it before he got away.
    if (cornered) {
      enemy.x = h.merc.x + CORNER_THREAT_OFFSET_PX;
      enemy.y = h.merc.y + CORNER_THREAT_OFFSET_PX;
    }
    frame(h);
    if (firstSlapFrame === null && enemy.hp < enemyStart) firstSlapFrame = f;
  }
  return {
    firstSlapFrame,
    hostileLost: enemyStart - enemy.hp,
    crawlerLost: humanStart - h.human.hp + (catStart - h.cat.hp),
  };
}

function checkCorneredSlap(): void {
  section('Bucket Boy: cornered, he slaps');
  const corner = cornerOutcome(true);
  check(
    corner.hostileLost > 0,
    `pinned in a corner with a hostile on him, he slaps it (${corner.hostileLost} HP taken)`,
  );
  check(
    corner.firstSlapFrame !== null && corner.firstSlapFrame >= CORNERED_FRAMES,
    `he slaps only after running has failed for ${CORNERED_FRAMES} frames (first slap on frame ${corner.firstSlapFrame ?? 'never'})`,
  );
  check(
    corner.crawlerLost === 0,
    `the crawlers beside him lose nothing (${corner.crawlerLost} HP)`,
  );
  const open = cornerOutcome(false);
  check(
    open.hostileLost === 0,
    `control: with room to run he never slaps (${open.hostileLost} HP taken)`,
  );
}

// ── Talking ────────────────────────────────────────────────────────────────

function checkTalkGuard(): void {
  section('Bucket Boy: parked close, he never takes an attack press');
  const h = build();
  if (h === null) return;
  placeAt(h.merc, ROOM_MIDDLE_TILE - NEARBY_HOSTILE_OFFSET_TILES, ROOM_MIDDLE_TILE);
  for (let f = 0; f < PARK_FRAMES; f++) frame(h);
  const parkedTiles = distance(h.merc, h.human) / TILE_SIZE;
  check(
    h.system.talkTarget(h.human, h.mobs.mobs) === h.merc,
    `parked ${parkedTiles.toFixed(2)} tiles off in his follow band, he can be talked to`,
  );
  addHostile(h, h.human.x + TILE_SIZE * NEARBY_HOSTILE_OFFSET_TILES, h.human.y);
  check(
    h.system.talkTarget(h.human, h.mobs.mobs) === null,
    'with a hostile nearby, the same press is not spent on talk',
  );
}

/**
 * Runs every medic-kit check and returns how many failed.
 *
 * Seeded, because every mob draws its A* repath stagger from `randomInt` when
 * it is built, and the stagger decides which frame a path search lands on — in
 * a chase, a few more or fewer step reversals from one run to the next.
 */
export function verifyMedicKit(): number {
  return withWorldSeed(MEDIC_GATE_SEED, runMedicChecks);
}

function runMedicChecks(): number {
  failures = 0;
  checkTriage();
  checkNoChannelUnderThreat();
  checkFlee();
  checkWallEscape();
  checkNoZigzag();
  checkHealingUnderChase();
  checkNotStranded();
  checkCorneredSlap();
  checkTalkGuard();
  return failures;
}
