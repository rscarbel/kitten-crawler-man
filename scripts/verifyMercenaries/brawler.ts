/**
 * Headless checks on Gluteus Maxx's brawler kit, run by `verify:mercenaries`.
 *
 * - The Glute Crush fires on a nearly dead target and finishes it in one blow
 *   that no jab could have dealt, on the drawn frame his seat lands, with his
 *   line for it.
 * - It is never tried on a boss or on anything more than twice his size, and
 *   not again until its cooldown has run.
 * - Neither the crush nor the jabs hurt a crawler standing where the seat
 *   comes down, or a friendly creature lying at his feet nearly dead.
 * - He is reckless: he chases a hostile further from his owner than the
 *   default engage radius, and at low health he keeps fighting and says so.
 * - His jabs alternate and land on the drawn impact frame.
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
import { TerrorTheClown } from '../../src/creatures/TerrorTheClown';
import type { Mercenary } from '../../src/creatures/Mercenary';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { createMercenaryRoster } from '../../src/core/MercenaryRoster';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import { progressFrameIndex } from '../../src/core/SpriteRenderer';
import { MERCENARY_VOICES } from '../../src/creatures/mercenaries/mercenaryVoices';
import {
  BrawlerKit,
  CRUSH_COOLDOWN_FRAMES,
  CRUSH_MAX_TARGET_HP_MULTIPLE,
  CRUSH_TARGET_HP_FRACTION,
} from '../../src/creatures/mercenaries/brawlerKit';
import { DEFAULT_ENGAGE_RADIUS_TILES } from '../../src/creatures/mercenaries/MercenaryKit';
import type { MercenaryRow } from '../../src/creatures/mercenaries/MercenaryKit';
import {
  MAXX_CRUSH_FRAMES,
  MAXX_CRUSH_IMPACT_FRAME,
  MAXX_CRUSH_SEAT_REACH_TILES,
  MAXX_JAB_FRAMES,
  MAXX_JAB_IMPACT_FRAME,
} from '../../src/sprites/gluteusMaxxTiming';

/** How a gate reports; the caller owns the failure count. */
export interface BrawlerGateReporter {
  section(name: string): void;
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const MAXX = getMercenaryTemplate('gluteus_maxx');
const MAXX_VOICE = MERCENARY_VOICES[MAXX.voice];
const FLOOR = 'level3';

const ROOM_WIDTH_TILES = 36;
const ROOM_HEIGHT_TILES = 12;
const ROOM_MIDDLE_ROW = Math.floor(ROOM_HEIGHT_TILES / 2);
const OWNER_TILE_X = 4;

/** Max HP of the sparring dummy: inside his size limit, with a crushable fifth that a jab cannot clear. */
const DUMMY_MAX_HP = 70;
const DUMMY_SPEED = 0;
/** Nearly dead: under the crush threshold, but more than one jab. */
const CRUSHABLE_HP = Math.floor(DUMMY_MAX_HP * CRUSH_TARGET_HP_FRACTION) - 1;
/** Hurt, but nowhere near the crush threshold. */
const HEALTHY_HP = Math.floor(DUMMY_MAX_HP / 2);
/** Twice his size and a little more: too big to sit on however hurt. */
const OVERSIZED_MAX_HP_MARGIN = 10;
const OVERSIZED_MAX_HP = MAXX.hp * CRUSH_MAX_TARGET_HP_MULTIPLE + OVERSIZED_MAX_HP_MARGIN;
const OVERSIZED_HP = Math.floor(OVERSIZED_MAX_HP * CRUSH_TARGET_HP_FRACTION) - 1;

/** Room to start and finish one crush or several jabs. */
const FIGHT_FRAMES = 240;
/** Long enough to cross most of the room at his speed. */
const CHASE_FRAMES = 150;
/** Tiles he must close on a hostile to count as chasing it. */
const CHASE_CLOSED_TILES = 3;
/** Past the default engage radius, inside his. */
const RECKLESS_ENGAGE_OFFSET_TILES = DEFAULT_ENGAGE_RADIUS_TILES + 1;
/** Past his own engage radius. */
const OUT_OF_REACH_OFFSET_TILES = 15;
/** Share of his health he is left on for the low-health check. */
const LOW_HP_FRACTION = 0.1;
/** Frames past the cooldown the second crush may take to start, to walk up to its victim. */
const COOLDOWN_SLACK_FRAMES = 60;
const COOLDOWN_RUN_FRAMES = CRUSH_COOLDOWN_FRAMES + FIGHT_FRAMES;
/** Jabs needed to see them take turns. */
const JABS_TO_WATCH = 4;
/** More than enough frames for four jabs against a dummy that cannot die. */
const JAB_WATCH_FRAMES = 400;
/** Where the target starts for the seat check: closer than his seat reaches, and off his line. */
const CLOSE_START_OFFSET_X_TILES = 0.4;
const CLOSE_START_OFFSET_Y_TILES = 0.3;
/** The seat counts as on the target within this, in tiles — close enough to read as sitting on it. */
const SEAT_ON_TARGET_TILES = 0.1;
const PERCENT = 100;
/** Terror the Clown's levels that still fit inside his size limit, so only the boss test spares it. */
const TERROR_TOP_LEVEL_CHECKED = 3;
/** Enough to show on the cat's health, and nowhere near a knockout. */
const STRAY_HIT_DAMAGE = 1;
/** A dummy this sturdy outlasts any number of jabs the checks watch. */
const UNKILLABLE_HP = 1_000_000;

/** A target that stands where it is put and decides nothing. */
class SparringDummy extends Mob {
  readonly xpValue = 0;

  constructor(
    tileX: number,
    tileY: number,
    maxHp: number,
    private readonly hostile = true,
  ) {
    super(tileX, tileY, TILE_SIZE, maxHp, DUMMY_SPEED);
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

interface BrawlerHarness {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly system: MercenarySystem;
  readonly mobs: MobRoster;
  readonly ctx: SystemContext;
  readonly merc: Mercenary;
  readonly kit: BrawlerKit;
}

function makeRoom(): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_HEIGHT_TILES }, (_, y) =>
    Array.from({ length: ROOM_WIDTH_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === lastX || y === lastY;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  // At the real tile height, or every sight test measures against the wrong grid.
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** Spawns Maxx beside his owner through the real system, or null if the kit is not his. */
function buildHarness(): BrawlerHarness | null {
  const map = makeRoom();
  const human = new HumanPlayer(OWNER_TILE_X, ROOM_MIDDLE_ROW, TILE_SIZE);
  // Out of the way behind the owner, so she is never in the fight by accident.
  const cat = new CatPlayer(OWNER_TILE_X - 2, ROOM_MIDDLE_ROW, TILE_SIZE);
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const roster = createMercenaryRoster();
  roster.active = { id: MAXX.id, name: MAXX.name, contractLevelId: FLOOR, introduced: true };
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
  if (merc === null || !(merc.kit instanceof BrawlerKit)) return null;
  return { map, human, cat, system, mobs, ctx, merc, kit: merc.kit };
}

/** Stands Maxx on a tile, facing east, with nothing on his mind. */
function placeMaxx(harness: BrawlerHarness, tileX: number, tileY: number): void {
  const { merc } = harness;
  const ox = merc.x;
  const oy = merc.y;
  merc.x = tileX * TILE_SIZE;
  merc.y = tileY * TILE_SIZE;
  merc.facingX = 1;
  merc.facingY = 0;
  harness.mobs.grid.move(merc, ox, oy);
  merc.speech.clear();
}

function addDummy(harness: BrawlerHarness, dummy: SparringDummy, hp: number): SparringDummy {
  dummy.hp = hp;
  harness.mobs.add(dummy);
  return dummy;
}

/** One frame of the scene, in its order: the system, then every living mob's AI, timers and grid cell. */
function stepFrame(harness: BrawlerHarness): void {
  harness.system.update(harness.ctx);
  const targets = [harness.human, harness.cat];
  for (const mob of [...harness.mobs.mobs]) {
    if (!mob.isAlive) continue;
    const ox = mob.x;
    const oy = mob.y;
    mob.updateAI(targets);
    mob.tickTimers();
    harness.mobs.grid.move(mob, ox, oy);
  }
}

/** What happened to one victim over a fight. */
interface FightRecord {
  /** Each drop in the victim's HP, with the row Maxx was showing when it landed. */
  readonly blows: readonly {
    readonly damage: number;
    readonly row: MercenaryRow;
    /** The frame of the row drawn as it landed. */
    readonly drawnFrame: number;
    /** The fight tick it landed on. */
    readonly tick: number;
  }[];
  readonly crushStarts: readonly number[];
  readonly spoken: readonly string[];
  readonly victimDied: boolean;
  /** Worst HP loss suffered by either crawler. */
  readonly crawlerHpLost: number;
  readonly closestApproachPx: number;
}

function drawnFrameOf(row: MercenaryRow, progress: number): number {
  const frames = row === 'crush' ? MAXX_CRUSH_FRAMES : MAXX_JAB_FRAMES;
  return progressFrameIndex(progress, frames);
}

/**
 * Runs the scene for `frames`, watching `victim`. `beforeFrame` runs ahead of
 * each frame, for a check that has to hold the victim in some state.
 */
function fight(
  harness: BrawlerHarness,
  victim: Mob,
  frames: number,
  beforeFrame: () => void = () => undefined,
): FightRecord {
  const blows: { damage: number; row: MercenaryRow; drawnFrame: number; tick: number }[] = [];
  const crushStarts: number[] = [];
  const spoken: string[] = [];
  const humanHp = harness.human.hp;
  const catHp = harness.cat.hp;
  let closestApproachPx = Infinity;
  let wasCrushing = harness.kit.isCrushing;
  for (let frame = 0; frame < frames; frame++) {
    beforeFrame();
    const before = victim.hp;
    stepFrame(harness);
    const { merc, kit } = harness;
    if (kit.isCrushing && !wasCrushing) crushStarts.push(frame);
    wasCrushing = kit.isCrushing;
    if (victim.hp < before) {
      const state = kit.drawState(merc);
      blows.push({
        damage: before - victim.hp,
        row: state.row,
        drawnFrame: drawnFrameOf(state.row, state.progress),
        tick: frame,
      });
    }
    const line = merc.speech.current;
    if (line !== null && spoken[spoken.length - 1] !== line) spoken.push(line);
    closestApproachPx = Math.min(
      closestApproachPx,
      Math.hypot(victim.x - merc.x, victim.y - merc.y),
    );
  }
  return {
    blows,
    crushStarts,
    spoken,
    victimDied: !victim.isAlive,
    crawlerHpLost: Math.max(humanHp - harness.human.hp, catHp - harness.cat.hp),
    closestApproachPx,
  };
}

/** A fresh Maxx a tile west of a dummy with `hp` of `maxHp`, fought for `frames`. */
function sparWith(
  maxHp: number,
  hp: number,
  frames: number,
  setup: (harness: BrawlerHarness, dummy: SparringDummy) => void = () => undefined,
  beforeFrame: (harness: BrawlerHarness) => void = () => undefined,
): FightRecord | null {
  const harness = buildHarness();
  if (harness === null) return null;
  const maxxTileX = OWNER_TILE_X + 2;
  placeMaxx(harness, maxxTileX, ROOM_MIDDLE_ROW);
  const dummy = addDummy(harness, new SparringDummy(maxxTileX + 1, ROOM_MIDDLE_ROW, maxHp), hp);
  setup(harness, dummy);
  return fight(harness, dummy, frames, () => beforeFrame(harness));
}

/**
 * Terror the Clown as a crawler meets it: a boss whose systems leave `isBoss`
 * false, answering for it through its blast share instead.
 */
function makeTerror(tileX: number, tileY: number): Mob {
  return new TerrorTheClown(tileX, tileY, TILE_SIZE);
}

/** The same clown with its boss share taken away: nothing left marks it as a boss. */
class UnmarkedTerror extends TerrorTheClown {
  override get blastDamageScale(): number {
    return 1;
  }
}

function makeUnmarkedTerror(tileX: number, tileY: number): Mob {
  return new UnmarkedTerror(tileX, tileY, TILE_SIZE);
}

/** Spared although small enough to sit on; a bout that never ran spares nothing. */
function terrorSpared(bout: TerrorBout | null): boolean {
  return bout !== null && bout.smallEnough && !bout.crushed;
}

interface TerrorBout {
  /** Inside his size limit, so only the boss test can be what spares it. */
  readonly smallEnough: boolean;
  readonly crushed: boolean;
}

/** Whether Maxx tries to sit on a nearly dead clown at `level` over a fight. */
function terrorBout(make: (tileX: number, tileY: number) => Mob, level: number): TerrorBout | null {
  const harness = buildHarness();
  if (harness === null) return null;
  const maxxTileX = OWNER_TILE_X + 2;
  placeMaxx(harness, maxxTileX, ROOM_MIDDLE_ROW);
  const terror = make(maxxTileX + 1, ROOM_MIDDLE_ROW);
  terror.applyMobLevel(level);
  terror.hp = Math.floor(terror.maxHp * CRUSH_TARGET_HP_FRACTION) - 1;
  harness.mobs.add(terror);
  return {
    smallEnough: terror.maxHp <= MAXX.hp * CRUSH_MAX_TARGET_HP_MULTIPLE,
    crushed: crushTried(fight(harness, terror, FIGHT_FRAMES)),
  };
}

function isSpecialLine(line: string): boolean {
  return (MAXX_VOICE.lines.special ?? []).includes(line);
}

/** The crush started, finished the victim in one blow bigger than a jab, and he said his line. */
function crushFinished(record: FightRecord | null): boolean {
  if (record === null || record.crushStarts.length === 0 || !record.victimDied) return false;
  const killingBlow = record.blows[record.blows.length - 1];
  return (
    record.blows.length === 1 &&
    killingBlow.row === 'crush' &&
    killingBlow.damage > MAXX.damage &&
    record.spoken.some(isSpecialLine)
  );
}

/** Every blow the crush landed came down on the frame the art draws his seat landing. */
function crushLandsOnFrame(record: FightRecord | null, impactFrame: number): boolean {
  if (record === null) return false;
  const crushBlows = record.blows.filter((blow) => blow.row === 'crush');
  return crushBlows.length > 0 && crushBlows.every((blow) => blow.drawnFrame === impactFrame);
}

function crushTried(record: FightRecord | null): boolean {
  return record !== null && record.crushStarts.length > 0;
}

function checkCrush(report: BrawlerGateReporter): void {
  report.section('Gluteus Maxx: the Glute Crush');

  const finisher = sparWith(DUMMY_MAX_HP, CRUSHABLE_HP, FIGHT_FRAMES);
  const blow = finisher?.blows[0];
  report.check(
    crushFinished(finisher),
    `a target on ${CRUSHABLE_HP}/${DUMMY_MAX_HP} HP is sat on and dies of that one blow (${blow?.damage ?? 0} dealt, a jab is ${MAXX.damage}), with his line`,
  );
  report.checkCatches(
    crushFinished(sparWith(DUMMY_MAX_HP, HEALTHY_HP, FIGHT_FRAMES)),
    `a target on ${HEALTHY_HP}/${DUMMY_MAX_HP} HP is not finished by a crush`,
  );
  report.check(
    crushLandsOnFrame(finisher, MAXX_CRUSH_IMPACT_FRAME),
    `the crush lands on the drawn seat frame ${MAXX_CRUSH_IMPACT_FRAME}`,
  );
  report.checkCatches(
    crushLandsOnFrame(finisher, MAXX_JAB_IMPACT_FRAME),
    'the seat-frame check tells the crush frame from a jab frame',
  );

  report.check(
    !crushTried(
      sparWith(DUMMY_MAX_HP, CRUSHABLE_HP, FIGHT_FRAMES, (_h, dummy) => {
        dummy.isBoss = true;
      }),
    ),
    'a nearly dead boss is never sat on',
  );
  for (let level = 1; level <= TERROR_TOP_LEVEL_CHECKED; level++) {
    report.check(
      terrorSpared(terrorBout(makeTerror, level)),
      `a nearly dead level-${level} Terror the Clown, a boss that leaves isBoss unset, is never sat on`,
    );
  }
  report.checkCatches(
    terrorSpared(terrorBout(makeUnmarkedTerror, 1)),
    'the same clown without its boss blast share would be sat on, so the boss test is what spares it',
  );
  report.check(
    !crushTried(sparWith(OVERSIZED_MAX_HP, OVERSIZED_HP, FIGHT_FRAMES)),
    `a nearly dead target of ${OVERSIZED_MAX_HP} max HP (over ${CRUSH_MAX_TARGET_HP_MULTIPLE}x his ${MAXX.hp}) is never sat on`,
  );
  report.checkCatches(
    !crushTried(finisher),
    'the never-sat-on check sees a crush when one happens',
  );

  checkSeatPlacement(report);
  checkCrushCooldown(report);
}

/** How far from where his seat would come down the target is, in tiles. */
function seatMissTiles(merc: Mercenary, victim: Mob): number {
  const seatX = merc.x + merc.facingX * TILE_SIZE * MAXX_CRUSH_SEAT_REACH_TILES;
  const seatY = merc.y + merc.facingY * TILE_SIZE * MAXX_CRUSH_SEAT_REACH_TILES;
  return Math.hypot(victim.x - seatX, victim.y - seatY) / TILE_SIZE;
}

interface SeatMisses {
  /** Where the seat would land if he sat down where he stood when the crush began. */
  readonly atStart: number;
  /** Where it lands on the impact frame. */
  readonly atImpact: number;
}

/**
 * A crush begun with the target closer than his seat reaches, and off to one
 * side: he has to back up and turn to sit on it.
 */
function seatMissesFromCloseRange(): SeatMisses | null {
  const harness = buildHarness();
  if (harness === null) return null;
  const maxxTileX = OWNER_TILE_X + 2;
  placeMaxx(harness, maxxTileX, ROOM_MIDDLE_ROW);
  const dummy = new SparringDummy(maxxTileX, ROOM_MIDDLE_ROW, DUMMY_MAX_HP);
  dummy.x += TILE_SIZE * CLOSE_START_OFFSET_X_TILES;
  dummy.y += TILE_SIZE * CLOSE_START_OFFSET_Y_TILES;
  addDummy(harness, dummy, CRUSHABLE_HP);
  let atStart: number | null = null;
  for (let frame = 0; frame < FIGHT_FRAMES; frame++) {
    const before = dummy.hp;
    // A `let`, so the check below reads the kit afresh rather than the value
    // this line narrowed it to.
    let wasCrushing = harness.kit.isCrushing;
    stepFrame(harness);
    if (!wasCrushing && harness.kit.isCrushing && atStart === null) {
      atStart = seatMissTiles(harness.merc, dummy);
    }
    wasCrushing = harness.kit.isCrushing;
    if (dummy.hp < before && harness.kit.drawState(harness.merc).row === 'crush') {
      return atStart === null ? null : { atStart, atImpact: seatMissTiles(harness.merc, dummy) };
    }
  }
  return null;
}

function checkSeatPlacement(report: BrawlerGateReporter): void {
  const misses = seatMissesFromCloseRange();
  report.check(
    misses !== null && misses.atImpact <= SEAT_ON_TARGET_TILES,
    `from half a tile off, he backs round so his seat lands on the target (${misses?.atImpact.toFixed(2) ?? 'no crush'} tiles off)`,
  );
  report.checkCatches(
    misses !== null && misses.atStart <= SEAT_ON_TARGET_TILES,
    `sitting down where he started would have missed (${misses?.atStart.toFixed(2) ?? 'no crush'} tiles off), so the placement is his doing`,
  );
}

/** The first entry, or undefined for an empty list — which is what a missed event looks like. */
function firstOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[0] : undefined;
}

interface CrushGaps {
  /** Ticks from the first crush starting to the second. */
  readonly toSecondCrush: number;
  /** Ticks from the first crush starting to his first blow on the second target. */
  readonly toFirstBlow: number;
}

/** How long a second crushable target waits, after a first crush, for a blow and for a crush. */
function gapsAfterACrush(): CrushGaps | null {
  const harness = buildHarness();
  if (harness === null) return null;
  const maxxTileX = OWNER_TILE_X + 2;
  placeMaxx(harness, maxxTileX, ROOM_MIDDLE_ROW);
  const first = addDummy(
    harness,
    new SparringDummy(maxxTileX + 1, ROOM_MIDDLE_ROW, DUMMY_MAX_HP),
    CRUSHABLE_HP,
  );
  const opening = fight(harness, first, FIGHT_FRAMES);
  const firstStart = firstOf(opening.crushStarts);
  if (firstStart === undefined) return null;
  const second = addDummy(
    harness,
    new SparringDummy(maxxTileX + 1, ROOM_MIDDLE_ROW + 1, DUMMY_MAX_HP),
    CRUSHABLE_HP,
  );
  // Held nearly dead however often he jabs it, so the only thing standing
  // between it and a second crush is the cooldown.
  const rematch = fight(harness, second, COOLDOWN_RUN_FRAMES, () => {
    if (!harness.kit.isCrushing) second.hp = CRUSHABLE_HP;
  });
  const secondStart = firstOf(rematch.crushStarts);
  const firstBlow = firstOf(rematch.blows)?.tick;
  if (secondStart === undefined || firstBlow === undefined) return null;
  const openingTicksLeft = FIGHT_FRAMES - firstStart;
  return {
    toSecondCrush: openingTicksLeft + secondStart,
    toFirstBlow: openingTicksLeft + firstBlow,
  };
}

function waitsOutCooldown(gap: number | undefined): boolean {
  return (
    gap !== undefined &&
    gap >= CRUSH_COOLDOWN_FRAMES &&
    gap <= CRUSH_COOLDOWN_FRAMES + COOLDOWN_SLACK_FRAMES
  );
}

function checkCrushCooldown(report: BrawlerGateReporter): void {
  const gaps = gapsAfterACrush();
  report.check(
    waitsOutCooldown(gaps?.toSecondCrush),
    `a second crushable target waits out the ${CRUSH_COOLDOWN_FRAMES}-frame cooldown (${gaps?.toSecondCrush ?? 'no second crush'} frames apart)`,
  );
  report.checkCatches(
    waitsOutCooldown(gaps?.toFirstBlow),
    `he is jabbing it long before then (${gaps?.toFirstBlow ?? 'never'} frames), so the wait is the cooldown and not a stalled fight`,
  );
}

function checkFriendlyFire(report: BrawlerGateReporter): void {
  report.section('Gluteus Maxx: friendly fire');

  // The cat stands on the very spot the seat comes down, beside the victim.
  const withCatUnder = sparWith(DUMMY_MAX_HP, CRUSHABLE_HP, FIGHT_FRAMES, (harness, dummy) => {
    harness.cat.x = dummy.x;
    harness.cat.y = dummy.y;
  });
  report.check(
    withCatUnder !== null && crushTried(withCatUnder) && withCatUnder.crawlerHpLost === 0,
    `a crawler standing under the seat loses nothing (${withCatUnder?.crawlerHpLost ?? 'no fight'} HP)`,
  );
  // The same scene with a stray point of damage landing on her mid-crush: the
  // measure has to see it, or a crush that did hurt her would pass too.
  let strayLanded = false;
  const withStrayHit = sparWith(
    DUMMY_MAX_HP,
    CRUSHABLE_HP,
    FIGHT_FRAMES,
    (harness, dummy) => {
      harness.cat.x = dummy.x;
      harness.cat.y = dummy.y;
    },
    (harness) => {
      if (strayLanded || !harness.kit.isCrushing) return;
      strayLanded = harness.cat.takeDamage(STRAY_HIT_DAMAGE);
    },
  );
  report.checkCatches(
    withStrayHit !== null && crushTried(withStrayHit) && withStrayHit.crawlerHpLost === 0,
    `a stray hit on her during the crush is seen (${withStrayHit?.crawlerHpLost ?? 'no fight'} HP)`,
  );

  report.check(
    friendUntouched(false),
    'a friendly creature lying nearly dead at his feet is neither jabbed nor sat on',
  );
  report.checkCatches(
    friendUntouched(true),
    'the untouched check sees him set about the same body when it is hostile',
  );
}

/** Whether a nearly dead body at his feet comes through a fight without a blow or a crush. */
function friendUntouched(hostile: boolean): boolean {
  const harness = buildHarness();
  if (harness === null) return false;
  const maxxTileX = OWNER_TILE_X + 2;
  placeMaxx(harness, maxxTileX, ROOM_MIDDLE_ROW);
  const body = addDummy(
    harness,
    new SparringDummy(maxxTileX + 1, ROOM_MIDDLE_ROW, DUMMY_MAX_HP, hostile),
    CRUSHABLE_HP,
  );
  const record = fight(harness, body, FIGHT_FRAMES);
  return record.blows.length === 0 && record.crushStarts.length === 0 && body.isAlive;
}

function checkReckless(report: BrawlerGateReporter): void {
  report.section('Gluteus Maxx: reckless');

  const chasesAt = (offsetTiles: number): boolean => {
    const harness = buildHarness();
    if (harness === null) return false;
    const dummyTileX = OWNER_TILE_X + offsetTiles;
    const dummy = addDummy(
      harness,
      new SparringDummy(dummyTileX, ROOM_MIDDLE_ROW, DUMMY_MAX_HP),
      DUMMY_MAX_HP,
    );
    const startPx = Math.hypot(dummy.x - harness.merc.x, dummy.y - harness.merc.y);
    const record = fight(harness, dummy, CHASE_FRAMES);
    return startPx - record.closestApproachPx > TILE_SIZE * CHASE_CLOSED_TILES;
  };
  report.check(
    chasesAt(RECKLESS_ENGAGE_OFFSET_TILES),
    `he runs at a hostile ${RECKLESS_ENGAGE_OFFSET_TILES} tiles from his owner, past the usual ${DEFAULT_ENGAGE_RADIUS_TILES}`,
  );
  report.checkCatches(
    chasesAt(OUT_OF_REACH_OFFSET_TILES),
    `a hostile ${OUT_OF_REACH_OFFSET_TILES} tiles out, past his own reach, is not chased`,
  );

  const hurtFight = (hpFraction: number): FightRecord | null =>
    sparWith(DUMMY_MAX_HP, DUMMY_MAX_HP, FIGHT_FRAMES, (harness) => {
      harness.merc.hp = Math.ceil(harness.merc.maxHp * hpFraction);
    });
  const lowHpLines = MAXX_VOICE.lines.low_hp ?? [];
  const saysLowHp = (record: FightRecord | null): boolean =>
    record?.spoken.some((line) => lowHpLines.includes(line)) === true;
  const hurt = hurtFight(LOW_HP_FRACTION);
  const dealt = hurt?.blows.reduce((sum, blow) => sum + blow.damage, 0) ?? 0;
  report.check(
    hurt !== null && dealt > 0 && hurt.closestApproachPx <= TILE_SIZE && saysLowHp(hurt),
    `on ${LOW_HP_FRACTION * PERCENT}% health he keeps swinging (${dealt} dealt) and complains instead of backing off`,
  );
  report.checkCatches(
    saysLowHp(hurtFight(1)),
    'the complaint check hears nothing from him at full health',
  );
}

function checkJabs(report: BrawlerGateReporter): void {
  report.section('Gluteus Maxx: the jabs');
  const record = sparWith(UNKILLABLE_HP, UNKILLABLE_HP, JAB_WATCH_FRAMES);
  const jabs = record?.blows.slice(0, JABS_TO_WATCH) ?? [];
  const alternate = (rows: readonly MercenaryRow[]): boolean =>
    rows.length === JABS_TO_WATCH &&
    rows.every((row, i) => i === 0 || row !== rows[i - 1]) &&
    rows.every((row) => row === 'jab_left' || row === 'jab_right');
  report.check(
    alternate(jabs.map((jab) => jab.row)),
    `left and right take turns (${jabs.map((jab) => jab.row).join(', ')})`,
  );
  report.checkCatches(
    alternate(jabs.map(() => 'jab_left')),
    'the turn-taking check catches one hand doing all the work',
  );
  report.check(
    jabs.length > 0 && jabs.every((jab) => jab.drawnFrame === MAXX_JAB_IMPACT_FRAME),
    `every jab lands on the drawn full-extension frame ${MAXX_JAB_IMPACT_FRAME}`,
  );
}

/** Runs every brawler-kit check through the caller's reporter. */
export function verifyBrawlerKit(report: BrawlerGateReporter): void {
  const harness = buildHarness();
  report.check(harness !== null, 'Gluteus Maxx spawns with the brawler kit');
  if (harness === null) return;
  checkCrush(report);
  checkFriendlyFire(report);
  checkReckless(report);
  checkJabs(report);
}
