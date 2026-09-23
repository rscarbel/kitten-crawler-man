/**
 * Headless checks on the cretin bodyguards' kit (Sledge and Bomo), run from
 * `verify-mercenaries.ts`.
 *
 * - The ward: a Shield soaks up exactly its pool from a blow before any
 *   reaches HP, from a crawler and from Mongo alike; a spent ward lingers only
 *   long enough to be seen breaking; a scene-crossing snapshot carries the pool
 *   without sharing it, and a checkpoint strips it.
 * - Sledge's Shield goes up on the cast frame, on the cat first, and takes a
 *   blow for her — measured on her HP; it waits for a fight, and for a wound.
 * - Bomo's Shield goes to whoever is worst hurt, Mongo included, where
 *   Sledge's would pass Mongo over.
 * - Protect the Princess: whoever hurts the cat loses HP to Sledge, while the
 *   hostile nearest him is left alone; Bomo in the same spot hits the nearest.
 * - The punch lands on the tick its extended frame is drawn.
 * - The robot: after a fight with the cat near, Sledge sometimes dances, once.
 * - Bomo's body-block: with his owner hurt and something closing, he walks —
 *   never jumps — to the spot in its path; with her healthy he goes for it.
 * - Friendly fire: through all of it, the crawlers lose nothing to his fists.
 *
 * Every rule is paired with a control that must go the other way, so a check
 * that cannot see its effect fails rather than passes.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { Mongo } from '../../src/creatures/Mongo';
import type { Mob } from '../../src/creatures/Mob';
import type { Mercenary } from '../../src/creatures/Mercenary';
import type { DamageSource, Player } from '../../src/Player';
import { createMercenaryRoster } from '../../src/core/MercenaryRoster';
import { getMercenaryTemplate, type MercenaryTemplateId } from '../../src/core/mercenaryTemplates';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import { createMob } from '../../src/levels/spawner';
import {
  ABSORB_BREAK_LINGER_TICKS,
  SHIELD_STATUS,
  makeShield,
  statusRemainingFraction,
  type StatusEffect,
} from '../../src/core/StatusEffect';
import { checkpointSnapshot, restorePlayer, snapPlayer } from '../../src/core/PlayerSnapshot';
import { MERCENARY_VOICES } from '../../src/creatures/mercenaries/mercenaryVoices';
import {
  BODY_BLOCK_STANDOFF_TILES,
  CretinGuardKit,
  PUNCH_IMPACT_TICK,
  PUNCH_TOTAL_TICKS,
  ROBOT_DANCE_TICKS,
  ROBOT_LULL_FRAMES,
  SHIELD_ABSORB,
  SHIELD_CAST_RELEASE_TICK,
  SHIELD_CAST_TOTAL_TICKS,
  SHIELD_DURATION_TICKS,
  SLEDGE_CONFIG,
  SLEDGE_SHIELD_COOLDOWN_FRAMES,
} from '../../src/creatures/mercenaries/cretinGuardKit';
import type { MercenaryKitContext } from '../../src/creatures/mercenaries/MercenaryKit';
import {
  CRETIN_CAST_SHIELD_CAST_FRAME,
  CRETIN_CAST_SHIELD_FRAMES,
  CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
  CRETIN_PUNCH_FRAMES,
  CRETIN_PUNCH_IMPACT_FRAME,
  CRETIN_PUNCH_TICKS_PER_FRAME,
  cretinOneShotFrame,
} from '../../src/sprites/cretinTiming';

/** How a gate reports; the caller owns the failure count. */
export interface CretinGuardGateReporter {
  section(name: string): void;
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const FLOOR = 'level3';
const SLEDGE_TEMPLATE = getMercenaryTemplate('sledge');
const ROOM_WIDTH_TILES = 24;
const ROOM_HEIGHT_TILES = 16;
const HUMAN_TILE_X = 8;
const HUMAN_TILE_Y = 7;

/** Well under both cretins' triggers. */
const BADLY_HURT_FRACTION = 0.4;
/** Under Bomo's trigger, over Sledge's. */
const BETWEEN_TRIGGERS_FRACTION = 0.65;
/** Over both triggers. */
const HEALTHY_FRACTION = 0.9;
const MONGO_LEVEL = 1;
/** Mongo worse off than anyone, so worst-hurt picks him if he counts at all. */
const MONGO_HURT_FRACTION = 0.3;

/** Inside the engage radius of the owner, well outside a punch. */
const DISTANT_HOSTILE_TILES = 8;
const CAST_WATCH_FRAMES = SHIELD_CAST_TOTAL_TICKS * 2;
/** A blow small enough for one ward to hold whole. */
const HELD_BLOW = SHIELD_ABSORB - 1;
/** How far past what is left of the pool the breaking blow goes: a wound, not a kill. */
const BREAKING_OVERFLOW = 3;
/** Small enough for Mongo's softening to charge something, and for a ward to hold. */
const MONGO_BLOW = 6;

const PRINCESS_WATCH_FRAMES = 240;
/** The foe near the cat stands this far from her, inside the attacker search. */
const PRINCESS_FOE_OFFSET_TILES = 2;
/** The decoy stands this close to the hireling, so it is his nearest by a margin. */
const DECOY_OFFSET_TILES = 1.2;
const CAT_WOUND = 1;

const ROBOT_FAR_CAT_TILES = 8;
const ROBOT_AFTERWARDS_FRAMES = 600;
const ROBOT_ROLL_WINS = 0;
const ROBOT_ROLL_LOSES = 0.99;

const BLOCK_THREAT_START_TILES = 3.5;
const BLOCK_BEHIND_OWNER_TILES = 1.5;
/** Slow enough that it is still well short of the owner when the check is made. */
const BLOCK_THREAT_STEP_PX = 0.4;
const BLOCK_WATCH_FRAMES = 60;
/** How close to the spot in the threat's path counts as standing in it. */
const BLOCK_SPOT_TOLERANCE_TILES = 0.5;
/** Short enough to come round twice inside Sledge's real cooldown. */
const HASTY_SHIELD_COOLDOWN_FRAMES = 300;
/** A walk, not a teleport: no frame's step may be much more than his speed. */
const WALK_STEP_SLACK_PX = 0.5;

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
  readonly kit: CretinGuardKit;
}

function build(id: MercenaryTemplateId, extras: Player[] = []): Harness | null {
  const map = makeRoom();
  const human = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  const cat = new CatPlayer(HUMAN_TILE_X + 1, HUMAN_TILE_Y, TILE_SIZE);
  const mobs = new MobRoster(map, new SpellSystem());
  const roster = createMercenaryRoster();
  roster.active = {
    id,
    name: getMercenaryTemplate(id).name,
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
    extraTargets: extras,
  };
  system.update(ctx);
  const merc = system.activeMerc;
  if (merc === null || !(merc.kit instanceof CretinGuardKit)) return null;
  return { map, human, cat, mobs, system, ctx, merc, kit: merc.kit };
}

function frame(h: Harness): void {
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

function addHostile(h: Harness, tileX: number, tileY: number): Mob {
  const mob = createMob('goblin', 0, 0, h.map);
  placeAt(mob, tileX, tileY);
  mob.hp = mob.maxHp;
  h.mobs.add(mob);
  return mob;
}

function shieldOf(body: Player): StatusEffect | undefined {
  return body.statusEffects.find((effect) => effect.type === SHIELD_STATUS);
}

function blowFrom(tileX: number, tileY: number): DamageSource {
  return {
    kind: 'mob',
    mobType: 'goblin',
    undodgeable: true,
    from: { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE },
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Runs the Mongo constructor the way `MongoSystem` does: at full health for his level. */
function makeMongo(owner: Player, tileX: number, tileY: number): Mongo {
  const probe = new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, 1);
  return new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, probe.maxHp);
}

// ── The ward itself ──────────────────────────────────────────────────────────

function checkWard(report: CretinGuardGateReporter): void {
  report.section('The Shield ward absorbs its pool, then breaks');
  const source = blowFrom(HUMAN_TILE_X + 1, HUMAN_TILE_Y);

  const human = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  human.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS));
  const before = human.hp;
  const landed = human.takeDamage(HELD_BLOW, source);
  const heldPrice = human.incomingDamage(HELD_BLOW, source);
  const heldWhole = heldPrice <= SHIELD_ABSORB;
  report.check(
    heldWhole && human.hp === before && !landed,
    `a ${heldPrice}-point blow into a ${SHIELD_ABSORB}-point ward costs no HP and does not connect (${before} -> ${human.hp})`,
  );
  const poolLeft = shieldOf(human)?.absorbRemaining ?? -1;
  report.check(
    poolLeft === SHIELD_ABSORB - heldPrice,
    `the ward is down by what it took (${poolLeft} of ${SHIELD_ABSORB} left)`,
  );
  const expectedFraction = poolLeft / SHIELD_ABSORB;
  const badgeFraction = statusRemainingFraction(shieldOf(human) ?? makeShield(0, 1));
  report.check(
    Math.abs(badgeFraction - expectedFraction) < Number.EPSILON,
    `the HUD strip shows the pool, not the clock (${badgeFraction.toFixed(2)})`,
  );

  const beforeBreak = human.hp;
  const breakingBlow = poolLeft + BREAKING_OVERFLOW;
  const breakingPrice = human.incomingDamage(breakingBlow, source);
  human.takeDamage(breakingBlow, source);
  const lost = beforeBreak - human.hp;
  report.check(
    lost === breakingPrice - poolLeft,
    `a blow past the pool wounds by what the ward could not hold (${lost} of ${breakingPrice})`,
  );
  const broken = shieldOf(human);
  report.check(
    broken !== undefined && broken.ticksRemaining <= ABSORB_BREAK_LINGER_TICKS,
    `a drained ward lingers only for its break (${broken?.ticksRemaining ?? 'gone'} ticks)`,
  );
  for (let i = 0; i <= ABSORB_BREAK_LINGER_TICKS; i++) human.tickTimers();
  report.check(shieldOf(human) === undefined, 'the drained ward is gone once its break has played');
  const afterBreak = human.hp;
  human.takeDamage(HELD_BLOW, source);
  report.check(human.hp < afterBreak, 'a broken ward holds nothing more');

  const bare = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  const bareBefore = bare.hp;
  bare.takeDamage(HELD_BLOW, source);
  report.checkCatches(
    bare.hp === bareBefore,
    'the same held blow on a crawler with no ward is caught costing HP',
  );

  const cat = new CatPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  const shieldedMongo = makeMongo(cat, HUMAN_TILE_X, HUMAN_TILE_Y);
  shieldedMongo.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS));
  const mongoBefore = shieldedMongo.hp;
  shieldedMongo.takeDamage(MONGO_BLOW, source);
  report.check(shieldedMongo.hp === mongoBefore, 'the ward holds a blow for Mongo too');
  const bareMongo = makeMongo(cat, HUMAN_TILE_X, HUMAN_TILE_Y);
  const bareMongoBefore = bareMongo.hp;
  bareMongo.takeDamage(MONGO_BLOW, source);
  report.checkCatches(
    bareMongo.hp === bareMongoBefore,
    'the same blow on an unwarded Mongo is caught costing HP',
  );

  const goblin = createMob('goblin', HUMAN_TILE_X + 1, HUMAN_TILE_Y, makeRoom());
  const struckMongo = makeMongo(cat, HUMAN_TILE_X, HUMAN_TILE_Y);
  struckMongo.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS));
  const struckBefore = struckMongo.hp;
  struckMongo.takeDamageFrom(MONGO_BLOW, goblin, 'melee');
  report.check(
    struckMongo.hp === struckBefore,
    `the ward holds a mob-on-mob blow for Mongo — a boulder, a trample (${struckBefore} -> ${struckMongo.hp})`,
  );
  const openMongo = makeMongo(cat, HUMAN_TILE_X, HUMAN_TILE_Y);
  const openBefore = openMongo.hp;
  openMongo.takeDamageFrom(MONGO_BLOW, goblin, 'melee');
  report.checkCatches(
    openMongo.hp === openBefore,
    'the same mob-on-mob blow on an unwarded Mongo is caught costing HP',
  );

  const traveller = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  traveller.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS));
  const snap = snapPlayer(traveller);
  traveller.takeDamage(HELD_BLOW, source);
  const crossed = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  restorePlayer(crossed, snap);
  report.check(
    shieldOf(crossed)?.absorbRemaining === SHIELD_ABSORB,
    `a doorway snapshot carries the ward's pool, untouched by blows after it was taken (${shieldOf(crossed)?.absorbRemaining ?? 'none'})`,
  );
  const checkpointed = new HumanPlayer(HUMAN_TILE_X, HUMAN_TILE_Y, TILE_SIZE);
  restorePlayer(checkpointed, checkpointSnapshot(snap));
  report.check(
    shieldOf(checkpointed) === undefined,
    'a checkpoint restore brings no ward back from the fight that ended',
  );
}

// ── Sledge's Shield ──────────────────────────────────────────────────────────

interface CastOutcome {
  readonly shielded: Player | null;
  readonly landedAfter: number | null;
  readonly drawnFrame: number | null;
  readonly line: string | null;
}

function watchCast(h: Harness, candidates: readonly Player[], frames: number): CastOutcome {
  let castStart: number | null = null;
  for (let i = 0; i < frames; i++) {
    frame(h);
    if (castStart === null && h.kit.isCastingShield) castStart = i;
    const shielded = candidates.find((ally) => shieldOf(ally) !== undefined);
    if (shielded === undefined) continue;
    const state = h.kit.drawState(h.merc);
    const castTicks =
      state.progress * CRETIN_CAST_SHIELD_FRAMES * CRETIN_CAST_SHIELD_TICKS_PER_FRAME;
    const drawnFrame =
      state.row === 'cast_shield'
        ? cretinOneShotFrame(
            castTicks,
            CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
            CRETIN_CAST_SHIELD_FRAMES,
          )
        : null;
    return {
      shielded,
      landedAfter: castStart === null ? null : i - castStart,
      drawnFrame,
      line: h.merc.speech.current,
    };
  }
  return { shielded: null, landedAfter: null, drawnFrame: null, line: null };
}

function checkSledgeShield(report: CretinGuardGateReporter): void {
  report.section("Sledge's Shield: the cat first, on the cast frame");
  const h = build('sledge');
  report.check(h !== null, 'Sledge spawns with the cretin guard kit');
  if (h === null) return;
  woundTo(h.human, BADLY_HURT_FRACTION);
  woundTo(h.cat, BADLY_HURT_FRACTION);
  addHostile(h, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
  const outcome = watchCast(h, [h.human, h.cat], CAST_WATCH_FRAMES);
  report.check(
    outcome.shielded === h.cat,
    `with both crawlers hurt, the cat gets the Shield (${outcome.shielded === h.human ? 'the human' : outcome.shielded === null ? 'nobody' : 'the cat'})`,
  );
  const castLandsInGlyphFrame =
    outcome.landedAfter !== null &&
    outcome.landedAfter >= SHIELD_CAST_RELEASE_TICK &&
    outcome.landedAfter < SHIELD_CAST_RELEASE_TICK + CRETIN_CAST_SHIELD_TICKS_PER_FRAME;
  report.check(
    castLandsInGlyphFrame && outcome.drawnFrame === CRETIN_CAST_SHIELD_CAST_FRAME,
    `it goes up ${outcome.landedAfter ?? 'never'} ticks into the cast, on drawn frame ${outcome.drawnFrame ?? 'none'} (the glyph's frame is ${CRETIN_CAST_SHIELD_CAST_FRAME})`,
  );
  const specialLines = MERCENARY_VOICES.sledge.lines.special ?? [];
  report.check(
    outcome.line !== null && specialLines.includes(outcome.line),
    `he says so: "${outcome.line ?? ''}"`,
  );
  const catBefore = h.cat.hp;
  h.cat.takeDamage(HELD_BLOW, blowFrom(HUMAN_TILE_X + 2, HUMAN_TILE_Y));
  report.check(h.cat.hp === catBefore, `and it takes a blow for her (${catBefore} -> ${h.cat.hp})`);

  const cooldownWatch = SLEDGE_SHIELD_COOLDOWN_FRAMES - SHIELD_CAST_TOTAL_TICKS * 2;
  const casts = castsOver(new CretinGuardKit(SLEDGE_TEMPLATE), cooldownWatch);
  report.check(
    casts === 1,
    `one Shield in the ${cooldownWatch} frames after the first, with the fight on throughout (${casts})`,
  );
  const hasty = new CretinGuardKit(SLEDGE_TEMPLATE, {
    ...SLEDGE_CONFIG,
    shield: { ...SLEDGE_CONFIG.shield, cooldownFrames: HASTY_SHIELD_COOLDOWN_FRAMES },
  });
  const hastyCasts = castsOver(hasty, cooldownWatch);
  report.checkCatches(
    hastyCasts <= 1,
    `a cooldown cut to ${HASTY_SHIELD_COOLDOWN_FRAMES} frames is caught casting again (${hastyCasts})`,
  );

  const quiet = build('sledge');
  if (quiet !== null) {
    woundTo(quiet.human, BADLY_HURT_FRACTION);
    woundTo(quiet.cat, BADLY_HURT_FRACTION);
    const idle = watchCast(quiet, [quiet.human, quiet.cat], CAST_WATCH_FRAMES);
    report.checkCatches(
      idle.shielded !== null,
      'with nothing hostile about, a Shield is caught not going up',
    );
  }
  const healthy = build('sledge');
  if (healthy !== null) {
    woundTo(healthy.human, HEALTHY_FRACTION);
    woundTo(healthy.cat, HEALTHY_FRACTION);
    addHostile(healthy, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
    const unneeded = watchCast(healthy, [healthy.human, healthy.cat], CAST_WATCH_FRAMES);
    report.checkCatches(
      unneeded.shielded !== null,
      'with the party healthy, a Shield is caught not going up',
    );
  }
}

/**
 * Drives one kit by hand for `frames` frames over the Sledge harness's party,
 * both crawlers hurt and a hostile kept in engage range the whole time — it is
 * never struck, since only the kit's own tick and update run — and counts the
 * Shields that go up. Each is taken off as it lands, so every cast shows.
 */
function castsOver(kit: CretinGuardKit, frames: number): number {
  const h = build('sledge');
  if (h === null) return -1;
  woundTo(h.human, BADLY_HURT_FRACTION);
  woundTo(h.cat, BADLY_HURT_FRACTION);
  const hostile = addHostile(h, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
  const ctx: MercenaryKitContext = {
    merc: h.merc,
    owner: h.human,
    allMobs: h.mobs.mobs,
    allies: [h.human, h.cat],
    cat: h.cat,
    isInSafeRoom: () => false,
    bark: () => undefined,
  };
  let casts = 0;
  // Starting from the first cast, as the cooldown does.
  const watch = frames + SHIELD_CAST_TOTAL_TICKS;
  for (let i = 0; i < watch && hostile.isAlive; i++) {
    kit.tick(ctx);
    kit.update(ctx);
    for (const ally of [h.human, h.cat]) {
      if (shieldOf(ally) === undefined) continue;
      casts++;
      ally.clearStatusEffects();
    }
  }
  return hostile.isAlive ? casts : -1;
}

// ── Bomo's Shield ────────────────────────────────────────────────────────────

function checkBomoShield(report: CretinGuardGateReporter): void {
  report.section("Bomo's Shield: whoever is worst hurt, Mongo included");
  const probeCat = new CatPlayer(HUMAN_TILE_X + 1, HUMAN_TILE_Y, TILE_SIZE);
  const mongo = makeMongo(probeCat, HUMAN_TILE_X, HUMAN_TILE_Y + 1);
  const h = build('bomo', [mongo]);
  report.check(h !== null, 'Bomo spawns with the cretin guard kit');
  if (h === null) return;
  woundTo(h.human, BETWEEN_TRIGGERS_FRACTION);
  woundTo(h.cat, HEALTHY_FRACTION);
  woundTo(mongo, MONGO_HURT_FRACTION);
  addHostile(h, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
  const outcome = watchCast(h, [h.human, h.cat, mongo], CAST_WATCH_FRAMES);
  report.check(
    outcome.shielded === mongo,
    `Mongo, worst hurt, gets it (${outcome.shielded === null ? 'nobody' : outcome.shielded === mongo ? 'Mongo' : 'a crawler'})`,
  );
  const mongoBefore = mongo.hp;
  mongo.takeDamage(MONGO_BLOW, blowFrom(HUMAN_TILE_X, HUMAN_TILE_Y + 2));
  report.check(mongo.hp === mongoBefore, 'and it takes a blow for him');

  const sledgeMongo = makeMongo(probeCat, HUMAN_TILE_X, HUMAN_TILE_Y + 1);
  const sledge = build('sledge', [sledgeMongo]);
  if (sledge !== null) {
    woundTo(sledge.human, BETWEEN_TRIGGERS_FRACTION);
    woundTo(sledge.cat, HEALTHY_FRACTION);
    woundTo(sledgeMongo, MONGO_HURT_FRACTION);
    addHostile(sledge, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
    const passed = watchCast(sledge, [sledge.human, sledge.cat, sledgeMongo], CAST_WATCH_FRAMES);
    report.checkCatches(
      passed.shielded !== null,
      "Sledge in Bomo's place is caught shielding nobody (Mongo is not his, the human is over his trigger)",
    );
  }
}

// ── Protect the Princess, and the punch ─────────────────────────────────────

interface PrincessOutcome {
  /** Which hostile his first blow landed on. */
  readonly firstHit: 'foe' | 'decoy' | null;
  readonly humanLost: number;
  readonly catLost: number;
  readonly impactAfter: number | null;
  readonly drawnPunchFrame: number | null;
}

function runPrincess(id: MercenaryTemplateId): PrincessOutcome | null {
  const h = build(id);
  if (h === null) return null;
  const mercTileX = HUMAN_TILE_X;
  const mercTileY = HUMAN_TILE_Y + 2;
  placeAt(h.merc, mercTileX, mercTileY);
  const decoy = addHostile(h, mercTileX, mercTileY + DECOY_OFFSET_TILES);
  const foe = addHostile(h, HUMAN_TILE_X + 1 + PRINCESS_FOE_OFFSET_TILES, HUMAN_TILE_Y);
  frame(h);
  foe.currentTarget = h.cat;
  h.cat.hp -= CAT_WOUND;
  const humanStart = h.human.hp;
  const catStart = h.cat.hp;
  const foeStart = foe.hp;
  const decoyStart = decoy.hp;
  let swingStart: number | null = null;
  let impactAfter: number | null = null;
  let drawnPunchFrame: number | null = null;
  let firstHit: PrincessOutcome['firstHit'] = null;
  // The whole watch runs, past the first blow, so the friendly-fire tally
  // covers the rest of the fight too.
  for (let i = 0; i < PRINCESS_WATCH_FRAMES; i++) {
    frame(h);
    const state = h.kit.drawState(h.merc);
    if (swingStart === null && state.row === 'punch') swingStart = i;
    if (firstHit !== null) continue;
    if (foe.hp < foeStart) firstHit = 'foe';
    else if (decoy.hp < decoyStart) firstHit = 'decoy';
    if (firstHit !== null && swingStart !== null) {
      impactAfter = i - swingStart;
      const ticks = state.progress * PUNCH_TOTAL_TICKS;
      drawnPunchFrame =
        state.row === 'punch'
          ? cretinOneShotFrame(ticks, CRETIN_PUNCH_TICKS_PER_FRAME, CRETIN_PUNCH_FRAMES)
          : null;
    }
  }
  return {
    firstHit,
    humanLost: humanStart - h.human.hp,
    catLost: catStart - h.cat.hp,
    impactAfter,
    drawnPunchFrame,
  };
}

function checkPrincess(report: CretinGuardGateReporter): void {
  report.section('Protect the Princess: whoever hurts the cat answers to Sledge');
  const sledge = runPrincess('sledge');
  report.check(sledge !== null, 'Sledge spawns for the princess drill');
  if (sledge === null) return;
  report.check(
    sledge.firstHit === 'foe',
    `his first blow lands on the cat's attacker, not the hostile at his elbow (${sledge.firstHit ?? 'no blow'})`,
  );
  const landsInFistFrame =
    sledge.impactAfter !== null &&
    sledge.impactAfter >= PUNCH_IMPACT_TICK &&
    sledge.impactAfter < PUNCH_IMPACT_TICK + CRETIN_PUNCH_TICKS_PER_FRAME;
  report.check(
    landsInFistFrame && sledge.drawnPunchFrame === CRETIN_PUNCH_IMPACT_FRAME,
    `the punch lands ${sledge.impactAfter ?? 'never'} ticks in, on drawn frame ${sledge.drawnPunchFrame ?? 'none'} (fist out on ${CRETIN_PUNCH_IMPACT_FRAME})`,
  );
  report.check(
    sledge.humanLost === 0 && sledge.catLost === 0,
    `friendly fire: the crawlers lose ${sledge.humanLost} and ${sledge.catLost} HP to his fists`,
  );
  const bomo = runPrincess('bomo');
  if (bomo !== null) {
    report.checkCatches(
      bomo.firstHit === 'foe',
      `Bomo in Sledge's place is caught hitting the nearest instead (${bomo.firstHit ?? 'no blow'})`,
    );
    report.check(
      bomo.humanLost === 0 && bomo.catLost === 0,
      `friendly fire: the crawlers lose ${bomo.humanLost} and ${bomo.catLost} HP to Bomo's fists`,
    );
  }
}

// ── The robot ────────────────────────────────────────────────────────────────

interface DanceOutcome {
  readonly danced: boolean;
  readonly drewRobot: boolean;
  readonly dances: number;
  readonly dancingFrames: number;
}

function runDance(roll: number, catTilesAway: number): DanceOutcome | null {
  const h = build('sledge');
  if (h === null) return null;
  placeAt(h.cat, HUMAN_TILE_X, HUMAN_TILE_Y);
  placeAt(h.merc, HUMAN_TILE_X + catTilesAway, HUMAN_TILE_Y);
  const goblin = addHostile(h, HUMAN_TILE_X + DISTANT_HOSTILE_TILES, HUMAN_TILE_Y);
  const realRandom = Math.random;
  Math.random = () => roll;
  let danced = false;
  let drewRobot = false;
  let dances = 0;
  let wasDancing = false;
  let dancingFrames = 0;
  try {
    frame(h);
    goblin.hp = 0;
    const watch = ROBOT_LULL_FRAMES + ROBOT_DANCE_TICKS + ROBOT_AFTERWARDS_FRAMES;
    for (let i = 0; i < watch; i++) {
      // Hold him in place: a follow walk would carry him to the cat's side
      // and the far-cat control would stop being far.
      placeAt(h.merc, HUMAN_TILE_X + catTilesAway, HUMAN_TILE_Y);
      frame(h);
      if (h.kit.isDancing) {
        danced = true;
        if (h.kit.drawState(h.merc).row === 'robot') drewRobot = true;
        if (!wasDancing) dances++;
        dancingFrames++;
      }
      wasDancing = h.kit.isDancing;
    }
  } finally {
    Math.random = realRandom;
  }
  return { danced, drewRobot, dances, dancingFrames };
}

function checkRobot(report: CretinGuardGateReporter): void {
  report.section('The robot: after a fight, with the cat near, sometimes, once');
  const lucky = runDance(ROBOT_ROLL_WINS, 1);
  report.check(lucky !== null, 'Sledge spawns for the dance');
  if (lucky === null) return;
  report.check(
    lucky.danced && lucky.drewRobot,
    'a won roll with the cat beside him plays the robot row',
  );
  // One tick of slack: the start and end ticks fall either side of the update
  // that reads them, so the count is exact to within one.
  const oneDanceLong = Math.abs(lucky.dancingFrames - ROBOT_DANCE_TICKS) <= 1;
  report.check(
    lucky.dances === 1 && oneDanceLong,
    `once per fight (${lucky.dances} dance, ${lucky.dancingFrames} of ${ROBOT_DANCE_TICKS} ticks)`,
  );
  const unlucky = runDance(ROBOT_ROLL_LOSES, 1);
  if (unlucky !== null) {
    report.checkCatches(unlucky.danced, 'a lost roll is caught not dancing');
  }
  const far = runDance(ROBOT_ROLL_WINS, ROBOT_FAR_CAT_TILES);
  if (far !== null) {
    report.checkCatches(
      far.danced,
      'with the cat across the room, the dance is caught not happening',
    );
  }
}

// ── Body-block ───────────────────────────────────────────────────────────────

interface BlockOutcome {
  readonly spotMiss: number;
  readonly maxStep: number;
  readonly speed: number;
  readonly blocking: boolean;
}

function runBlock(ownerFraction: number): BlockOutcome | null {
  const h = build('bomo');
  if (h === null) return null;
  woundTo(h.human, ownerFraction);
  // A ward already up keeps him from spending the drill casting another.
  h.human.applyStatus(makeShield(SHIELD_ABSORB, SHIELD_DURATION_TICKS * 2));
  placeAt(h.cat, HUMAN_TILE_X, HUMAN_TILE_Y + BLOCK_THREAT_START_TILES);
  placeAt(h.merc, HUMAN_TILE_X - BLOCK_BEHIND_OWNER_TILES, HUMAN_TILE_Y);
  const threat = addHostile(h, HUMAN_TILE_X + BLOCK_THREAT_START_TILES, HUMAN_TILE_Y);
  threat.currentTarget = h.human;
  let maxStep = 0;
  let blocking = false;
  for (let i = 0; i < BLOCK_WATCH_FRAMES; i++) {
    threat.x -= BLOCK_THREAT_STEP_PX;
    const beforeX = h.merc.x;
    const beforeY = h.merc.y;
    frame(h);
    maxStep = Math.max(maxStep, Math.hypot(h.merc.x - beforeX, h.merc.y - beforeY));
    if (h.kit.bodyBlockTarget === threat) blocking = true;
  }
  const standoffPx = TILE_SIZE * BODY_BLOCK_STANDOFF_TILES;
  const toThreat = distance(threat, h.human);
  const spot = {
    x: h.human.x + ((threat.x - h.human.x) / toThreat) * standoffPx,
    y: h.human.y + ((threat.y - h.human.y) / toThreat) * standoffPx,
  };
  return { spotMiss: distance(h.merc, spot), maxStep, speed: h.merc.template.speed, blocking };
}

function checkBodyBlock(report: CretinGuardGateReporter): void {
  report.section("Bomo's body-block: into the path of what is coming for her");
  const hurt = runBlock(BADLY_HURT_FRACTION);
  report.check(hurt !== null, 'Bomo spawns for the block drill');
  if (hurt === null) return;
  const tolerancePx = TILE_SIZE * BLOCK_SPOT_TOLERANCE_TILES;
  report.check(
    hurt.blocking && hurt.spotMiss <= tolerancePx,
    `with his owner hurt he stands in the threat's path (${hurt.spotMiss.toFixed(1)} px off the spot)`,
  );
  report.check(
    hurt.maxStep > 0 && hurt.maxStep <= hurt.speed + WALK_STEP_SLACK_PX,
    `he walks there, never jumps (largest step ${hurt.maxStep.toFixed(2)} px at speed ${hurt.speed})`,
  );
  const healthy = runBlock(HEALTHY_FRACTION);
  if (healthy !== null) {
    report.checkCatches(
      healthy.spotMiss <= tolerancePx,
      `with his owner healthy, he is caught going for the threat instead (${healthy.spotMiss.toFixed(1)} px off the spot)`,
    );
  }
}

export function verifyCretinGuardKit(report: CretinGuardGateReporter): void {
  checkWard(report);
  checkSledgeShield(report);
  checkBomoShield(report);
  checkPrincess(report);
  checkRobot(report);
  checkBodyBlock(report);
}
