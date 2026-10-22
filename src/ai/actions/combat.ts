/** Challenge and combat actions: hostiles, statuses, stats, HP and the collapse clock. */
import { activeDifficultyProfile, applySpawnDifficulty } from '../../core/difficultyProfiles';
import {
  AILMENT_STATUSES,
  makeBurn,
  makeDrunk,
  makeElectrified,
  makePoison,
  makeWhetstone,
  type StatusEffect,
} from '../../core/StatusEffect';
import { BOUNTY_MAX_BLOW_HP_SHARE } from '../../creatures/mobLevelScaling';
import type { Mob } from '../../creatures/Mob';
import { allLevelDefs, type LevelDef } from '../../levels';
import { MAX_MOB_LEVEL, partyLevelOf, resolveAmbientLevel } from '../../levels/spawner';
import type { StandaloneMobKind } from '../../levels/mobKinds';
import { liveSpawnContext, spawnMob as spawnHostileMob } from '../../levels/spawnFunnel';
import type { MobLevelRange } from '../../levels/types';
import type { GameMap } from '../../map/GameMap';
import { ALL_STATS, STAT_CODE, pendingStatusDamage } from '../../Player';
import {
  AI_CHARACTER_SYSTEM,
  TARGET_PARAM,
  crawlerName,
  formatSeconds,
  levelDefOf,
  notifyPlayer,
  resolveTarget,
  secondsToFrames,
  snakeToWords,
  tileOf,
  type Crawler,
} from './helpers';
import { LOW_HP_FRACTION, LOW_HP_PERCENT } from './governor';
import { enumParam, intParam, optionalEnumParam, optionalIntParam, textParam } from './schema';
import { ok, refused, type AIActionDef, type AISceneContext } from './types';

const SPAWN_COOLDOWN_MS = 45_000;
const ELITE_COOLDOWN_MS = 180_000;
const STATUS_COOLDOWN_MS = 60_000;
const CURE_COOLDOWN_MS = 30_000;
const STAT_COOLDOWN_MS = 90_000;
const HEAL_COOLDOWN_MS = 60_000;
const SET_HP_COOLDOWN_MS = 120_000;
const TIMER_COOLDOWN_MS = 120_000;

const MAX_SPAWN_COUNT = 3;
const SPAWN_CASTS_PER_FLOOR = 5;
const ELITES_PER_FLOOR = 2;
const ELITE_NAME_MAX_CHARS = 40;
/** Levels an elite stands above its kind's band top, still under the floor's own ceiling. */
const ELITE_LEVEL_BONUS = 1;

/** Nothing the AI spawns lands closer than this: every arrival is seen before it bites. */
export const MIN_SPAWN_DISTANCE_TILES = 4;
const NEAR_MAX_DISTANCE_TILES = 6;
const NEAR_DISTANCE_TILES = { min: MIN_SPAWN_DISTANCE_TILES, max: NEAR_MAX_DISTANCE_TILES };
const BEHIND_DISTANCE_TILES = { min: 5, max: 7 } as const;
const AMBUSH_DISTANCE_TILES = { min: 6, max: 8 } as const;
/** How far either side of its aim a spawn may land: an eighth of a turn. */
const EIGHTHS_PER_TURN = 8;
const BEHIND_SPREAD_RADIANS = (Math.PI * 2) / EIGHTHS_PER_TURN;
const PLACEMENT_ATTEMPTS = 30;
const FULL_TURN = Math.PI * 2;

const STATUSES_PER_FLOOR = 4;
const STAT_CHANGES_PER_FLOOR = 4;
const STAT_DELTA_LIMIT = 3;
const STAT_MIN_SECONDS = 10;
const STAT_MAX_SECONDS = 60;
const STAT_DEFAULT_SECONDS = 30;
const REASON_MAX_CHARS = 120;

const HEALS_PER_FLOOR = 3;
const HEAL_MIN_PERCENT = 5;
const HEAL_MAX_PERCENT = 50;
const SET_HP_PER_FLOOR = 2;
const PERCENT = 100;
/** set_hp never puts a crawler under the line the fairness rules shield. */
const SET_HP_MIN_PERCENT = LOW_HP_PERCENT;

export const TIMER_DELTA_LIMIT_SECONDS = 60;
/** The clock is never cut below this many seconds: a floor must stay escapable. */
export const TIMER_FLOOR_SECONDS = 120;

const PLACEMENTS = ['near', 'ambush', 'behind'] as const;
type Placement = (typeof PLACEMENTS)[number];

interface FloorSpawnRule extends MobLevelRange {
  readonly type: StandaloneMobKind;
}

/** Every ambient spawn rule a floor rolls from: rooms, hallways and camps, never bosses. */
function ambientRulesOf(def: LevelDef): FloorSpawnRule[] {
  const camps = Object.values(def.campSpawns ?? {}).flatMap((rules) => rules);
  return [...def.roomMobs, ...def.hallwayMobs, ...camps];
}

function bossTypesOf(def: LevelDef): Set<StandaloneMobKind> {
  return new Set((def.bossRooms ?? []).map((rule) => rule.type));
}

/**
 * Mob types the AI may name: the ambient creatures of every floor. Read from
 * the level tables, so a new creature on a floor's tables joins the tool's
 * vocabulary by itself.
 */
export function aiSpawnableMobTypes(): StandaloneMobKind[] {
  const types = new Set<StandaloneMobKind>();
  for (const def of allLevelDefs()) {
    const bosses = bossTypesOf(def);
    for (const rule of ambientRulesOf(def)) {
      if (!bosses.has(rule.type)) types.add(rule.type);
    }
  }
  return [...types].sort();
}

/** The band this floor spawns `type` at, widened over every rule naming it; null when it never does. */
function floorBandFor(def: LevelDef, type: StandaloneMobKind): MobLevelRange | null {
  const bosses = bossTypesOf(def);
  if (bosses.has(type)) return null;
  let band: { minLevel: number; maxLevel: number } | null = null;
  for (const rule of ambientRulesOf(def)) {
    if (rule.type !== type) continue;
    const min = rule.minLevel ?? 1;
    const max = rule.maxLevel ?? min;
    band =
      band === null
        ? { minLevel: min, maxLevel: max }
        : { minLevel: Math.min(band.minLevel, min), maxLevel: Math.max(band.maxLevel, max) };
  }
  return band;
}

/** The highest level any ambient creature on this floor reaches. */
function floorCeiling(def: LevelDef): number {
  let ceiling = 1;
  for (const rule of ambientRulesOf(def)) {
    ceiling = Math.max(ceiling, rule.maxLevel ?? rule.minLevel ?? 1);
  }
  return ceiling;
}

function insideAnyRect(
  rects: readonly { readonly bounds: { x: number; y: number; w: number; h: number } }[],
  tileX: number,
  tileY: number,
): boolean {
  return rects.some(
    ({ bounds }) =>
      tileX >= bounds.x &&
      tileX < bounds.x + bounds.w &&
      tileY >= bounds.y &&
      tileY < bounds.y + bounds.h,
  );
}

function isFairSpawnTile(map: GameMap, tileX: number, tileY: number): boolean {
  return (
    map.isMobSpawnTile(tileX, tileY) &&
    !insideAnyRect(map.safeRooms, tileX, tileY) &&
    !insideAnyRect(map.bossRooms, tileX, tileY)
  );
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** The bearing a spawn is aimed along before jitter, per placement and index in the group. */
function spawnBearing(placement: Placement, target: Crawler, index: number, count: number): number {
  if (placement === 'behind') {
    const behind = Math.atan2(-target.facingY, -target.facingX);
    return behind + randomBetween(-BEHIND_SPREAD_RADIANS, BEHIND_SPREAD_RADIANS);
  }
  if (placement === 'ambush') {
    const evenlyAround = (FULL_TURN * index) / count;
    return evenlyAround + randomBetween(-BEHIND_SPREAD_RADIANS, BEHIND_SPREAD_RADIANS);
  }
  return Math.random() * FULL_TURN;
}

function spawnDistance(placement: Placement): { min: number; max: number } {
  if (placement === 'behind') return BEHIND_DISTANCE_TILES;
  if (placement === 'ambush') return AMBUSH_DISTANCE_TILES;
  return NEAR_DISTANCE_TILES;
}

function findSpawnTile(
  map: GameMap,
  target: Crawler,
  placement: Placement,
  index: number,
  count: number,
): { x: number; y: number } | null {
  const origin = tileOf(target);
  const distance = spawnDistance(placement);
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const bearing = spawnBearing(placement, target, index, count);
    const radius = randomBetween(distance.min, distance.max);
    const tileX = Math.round(origin.x + Math.cos(bearing) * radius);
    const tileY = Math.round(origin.y + Math.sin(bearing) * radius);
    const tooClose = Math.hypot(tileX - origin.x, tileY - origin.y) < MIN_SPAWN_DISTANCE_TILES;
    if (!tooClose && isFairSpawnTile(map, tileX, tileY)) return { x: tileX, y: tileY };
  }
  return null;
}

/**
 * Builds one mob the way every spawn site does: created, levelled once inside
 * the floor's band for the party, then stamped with the difficulty profile.
 */
function spawnLevelledMob(
  scene: AISceneContext,
  def: LevelDef,
  type: StandaloneMobKind,
  tile: { x: number; y: number },
  level: number,
): Mob {
  const mob = spawnHostileMob(type, tile, scene.getGameMap(), liveSpawnContext('dev:spawn'));
  mob.applyMobLevel(level, def.levelledCurve);
  applySpawnDifficulty(mob, activeDifficultyProfile());
  scene.spawnMob(mob);
  return mob;
}

function ambientLevelFor(scene: AISceneContext, def: LevelDef, band: MobLevelRange): number {
  const partyLevel = partyLevelOf(scene.getHuman().level, scene.getCat().level);
  return resolveAmbientLevel(band, def, partyLevel, activeDifficultyProfile(), Math.random);
}

function nativeTypeRefusal(scene: AISceneContext, type: StandaloneMobKind): string | null {
  const def = levelDefOf(scene);
  if (def === null) return 'nothing can be spawned here';
  if (floorBandFor(def, type) === null) return `${snakeToWords(type)} is not native to this floor`;
  return null;
}

const MOB_TYPE = enumParam(
  'mob_type',
  aiSpawnableMobTypes(),
  'Which creature. Only creatures native to the current floor can be spawned (see the floor in the context).',
);
const SPAWN_COUNT = optionalIntParam('count', {
  min: 1,
  max: MAX_SPAWN_COUNT,
  fallback: 1,
  description: 'How many to spawn.',
});
const PLACEMENT = optionalEnumParam(
  'placement',
  PLACEMENTS,
  'near: a few tiles away in the open. ambush: spread around the crawler. behind: at their back.',
  'near',
);

const spawnMob: AIActionDef = {
  name: 'spawn_mob',
  description:
    'Spawn 1-3 hostile creatures near a crawler, at the floor’s own level. Refused indoors, during boss fights, in menus and in safe rooms.',
  params: [MOB_TYPE, SPAWN_COUNT, PLACEMENT, TARGET_PARAM],
  policy: {
    cost: 4,
    cooldownMs: SPAWN_COOLDOWN_MS,
    severity: 'disruptive',
    forbidsContext: ['isPaused', 'inSafeRoom', 'inBossFight', 'indoors'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: SPAWN_CASTS_PER_FLOOR,
  spawnsMobs: true,
  budget: ({ params }) => ({ pool: 'mobsSpawned', amount: params.get(SPAWN_COUNT) }),
  refusal: ({ params, scene }) => nativeTypeRefusal(scene, params.get(MOB_TYPE)),
  execute({ params, scene }) {
    const def = levelDefOf(scene);
    const type = params.get(MOB_TYPE);
    const band = def === null ? null : floorBandFor(def, type);
    if (def === null || band === null) return refused(`${snakeToWords(type)} cannot spawn here`);
    const target = resolveTarget(scene, params.get(TARGET_PARAM));
    const placement = params.get(PLACEMENT);
    const count = params.get(SPAWN_COUNT);
    let spawned = 0;
    for (let index = 0; index < count; index++) {
      const tile = findSpawnTile(scene.getGameMap(), target, placement, index, count);
      if (tile === null) continue;
      spawnLevelledMob(scene, def, type, tile, ambientLevelFor(scene, def, band));
      spawned++;
    }
    if (spawned === 0) return refused('no fair ground to spawn on near the crawler');
    return ok(`spawned ${spawned}x ${snakeToWords(type)} (${placement})`);
  },
};

const ELITE_NAME = textParam('name', {
  minLength: 1,
  maxLength: ELITE_NAME_MAX_CHARS,
  description: 'The elite’s name, shown to the player. Make it memorable.',
});

const spawnElite: AIActionDef = {
  name: 'spawn_elite',
  description:
    'Spawn one named elite creature: the floor’s own kind at the top of the floor’s level range, with a name you give it. Same fairness limits as spawn_mob.',
  params: [MOB_TYPE, ELITE_NAME, PLACEMENT, TARGET_PARAM],
  policy: {
    cost: 5,
    cooldownMs: ELITE_COOLDOWN_MS,
    severity: 'disruptive',
    forbidsContext: ['isPaused', 'inSafeRoom', 'inBossFight', 'indoors'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: ELITES_PER_FLOOR,
  spawnsMobs: true,
  budget: () => ({ pool: 'mobsSpawned', amount: 1 }),
  refusal: ({ params, scene }) => nativeTypeRefusal(scene, params.get(MOB_TYPE)),
  execute({ params, scene }) {
    const def = levelDefOf(scene);
    const type = params.get(MOB_TYPE);
    const band = def === null ? null : floorBandFor(def, type);
    if (def === null || band === null) return refused(`${snakeToWords(type)} cannot spawn here`);
    const target = resolveTarget(scene, params.get(TARGET_PARAM));
    const tile = findSpawnTile(scene.getGameMap(), target, params.get(PLACEMENT), 0, 1);
    if (tile === null) return refused('no fair ground to spawn on near the crawler');
    const bandTop = band.maxLevel ?? band.minLevel ?? 1;
    const eliteLevel = Math.min(bandTop + ELITE_LEVEL_BONUS, floorCeiling(def), MAX_MOB_LEVEL);
    const mob = spawnLevelledMob(scene, def, type, tile, eliteLevel);
    const name = params.get(ELITE_NAME);
    mob.displayName = name;
    // The cap every bounty mark carries: an elite may hit hard, never from full to nothing.
    mob.blowCapShareOfTargetHp = BOUNTY_MAX_BLOW_HP_SHARE;
    notifyPlayer(scene, `Elite incoming: ${name}`, { tone: 'danger', urgent: true });
    return ok(`spawned elite ${snakeToWords(type)} "${name}" at level ${eliteLevel}`);
  },
};

/**
 * Statuses the AI may inflict, each built by the factory the game itself uses.
 * `make` is set for the ones applied as a plain effect, so the damage a
 * damage-over-time status will still do can be read before it lands.
 */
interface AIStatusEffect {
  readonly harmful: boolean;
  readonly make?: () => StatusEffect;
  readonly apply: (crawler: Crawler) => void;
}

function plainStatus(harmful: boolean, make: () => StatusEffect): AIStatusEffect {
  return { harmful, make, apply: (crawler) => crawler.applyStatus(make()) };
}

const AI_STATUS_EFFECTS = {
  burn: plainStatus(true, () => makeBurn()),
  poison: plainStatus(true, () => makePoison()),
  drunk: plainStatus(true, () => makeDrunk()),
  electrified: plainStatus(true, () => makeElectrified()),
  speed_fizz: { harmful: false, apply: (crawler: Crawler) => crawler.activateSpeedFizz() },
  jugg_juice: { harmful: false, apply: (crawler: Crawler) => crawler.activateJuggJuice() },
  cooldown_crisp: { harmful: false, apply: (crawler: Crawler) => crawler.activateCooldownCrisp() },
  whetstone: plainStatus(false, () => makeWhetstone()),
} as const satisfies Record<string, AIStatusEffect>;
type AIStatus = keyof typeof AI_STATUS_EFFECTS;

/** The HP line nothing the AI does may push a crawler under: the fairness rules' low-HP shield. */
function shieldedHp(crawler: Crawler): number {
  return Math.ceil(crawler.maxHp * LOW_HP_FRACTION);
}

/**
 * HP left once every damage-over-time effect on the crawler, plus `added`,
 * has run its course, counting nothing healed meanwhile.
 */
function hpAfterStatuses(crawler: Crawler, added: StatusEffect | null): number {
  const effects = added === null ? crawler.statusEffects : [...crawler.statusEffects, added];
  return crawler.hp - pendingStatusDamage(effects, crawler.maxHp);
}
const AI_STATUS_IDS = [
  'burn',
  'poison',
  'drunk',
  'electrified',
  'speed_fizz',
  'jugg_juice',
  'cooldown_crisp',
  'whetstone',
] as const satisfies readonly AIStatus[];

const APPLY_STATUS = enumParam(
  'status',
  AI_STATUS_IDS,
  'burn, poison, drunk and electrified hurt; speed_fizz, jugg_juice, cooldown_crisp and whetstone help.',
);

const applyStatus: AIActionDef = {
  name: 'apply_status',
  description: 'Afflict or bless a crawler with a status effect. Never one they already have.',
  params: [TARGET_PARAM, APPLY_STATUS],
  policy: {
    cost: 3,
    cooldownMs: STATUS_COOLDOWN_MS,
    severity: 'harmful',
    forbidsContext: ['isPaused'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: STATUSES_PER_FLOOR,
  isHarmful: ({ params }) => AI_STATUS_EFFECTS[params.get(APPLY_STATUS)].harmful,
  refusal: ({ params, scene }) => {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const status = params.get(APPLY_STATUS);
    if (!crawler.isAlive || crawler.isKnockedOut) return `${crawlerName(scene, crawler)} is down`;
    if (crawler.hasStatus(status)) return `${crawlerName(scene, crawler)} already has ${status}`;
    const effect: AIStatusEffect = AI_STATUS_EFFECTS[status];
    const added = effect.make?.() ?? null;
    if (effect.harmful && hpAfterStatuses(crawler, added) < shieldedHp(crawler)) {
      return `${status} could take ${crawlerName(scene, crawler)} under ${LOW_HP_PERCENT}% HP`;
    }
    return null;
  },
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const status = params.get(APPLY_STATUS);
    AI_STATUS_EFFECTS[status].apply(crawler);
    return ok(`${snakeToWords(status)} on ${crawlerName(scene, crawler)}`);
  },
};

const REMOVE_STATUS = enumParam(
  'status',
  AILMENT_STATUSES,
  'Which ailment to lift. Some afflictions are beyond even the System.',
);

const removeStatus: AIActionDef = {
  name: 'remove_status',
  description: 'Cure a crawler of one ailment they currently have.',
  params: [TARGET_PARAM, REMOVE_STATUS],
  policy: { cost: 1, cooldownMs: CURE_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_SYSTEM],
  refusal: ({ params, scene }) => {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const status = params.get(REMOVE_STATUS);
    return crawler.hasStatus(status) ? null : `${crawlerName(scene, crawler)} has no ${status}`;
  },
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const status = params.get(REMOVE_STATUS);
    const cleared = crawler.cureStatuses([status]);
    if (cleared === 0) return refused(`${status} could not be lifted`);
    return ok(`cured ${snakeToWords(status)} on ${crawlerName(scene, crawler)}`);
  },
};

const STAT = enumParam('stat', ALL_STATS, 'Which stat.');
const STAT_DELTA = intParam('delta', {
  min: -STAT_DELTA_LIMIT,
  max: STAT_DELTA_LIMIT,
  description: 'Points to add (negative to take). Not zero.',
});
const STAT_SECONDS = optionalIntParam('duration_seconds', {
  min: STAT_MIN_SECONDS,
  max: STAT_MAX_SECONDS,
  fallback: STAT_DEFAULT_SECONDS,
  description: 'How long the change lasts.',
});
const STAT_REASON = textParam('reason', {
  minLength: 1,
  maxLength: REASON_MAX_CHARS,
  description: 'Why, shown to the player with the change.',
});

const modifyStat: AIActionDef = {
  name: 'modify_stat',
  description:
    'Temporarily raise or lower one of a crawler’s stats, with a reason they see. Only one change per crawler at a time.',
  params: [TARGET_PARAM, STAT, STAT_DELTA, STAT_SECONDS, STAT_REASON],
  policy: {
    cost: 3,
    cooldownMs: STAT_COOLDOWN_MS,
    severity: 'harmful',
    forbidsContext: ['isPaused'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: STAT_CHANGES_PER_FLOOR,
  isHarmful: ({ params }) => params.get(STAT_DELTA) < 0,
  refusal: ({ params, scene }) => {
    if (params.get(STAT_DELTA) === 0) return 'a change of zero is no change';
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    if (crawler.tempStatMods.length > 0) {
      return `${crawlerName(scene, crawler)} already has a temporary stat change`;
    }
    return null;
  },
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const stat = params.get(STAT);
    const delta = params.get(STAT_DELTA);
    const seconds = params.get(STAT_SECONDS);
    // The stat getters read tempStatMods live, so pushing the entry is the change.
    const hpBefore = crawler.hp;
    const mod = { ticksRemaining: secondsToFrames(seconds), stat, delta };
    crawler.tempStatMods.push(mod);
    crawler.syncHpToMaxHp();
    // A constitution cut lowers max HP and HP with it; undone when that crosses the low-HP line.
    if (delta < 0 && crawler.hp < Math.min(hpBefore, shieldedHp(crawler))) {
      crawler.tempStatMods.splice(crawler.tempStatMods.indexOf(mod), 1);
      crawler.syncHpToMaxHp();
      crawler.hp = hpBefore;
      return refused(`that would take ${crawlerName(scene, crawler)} under ${LOW_HP_PERCENT}% HP`);
    }
    const signed = delta > 0 ? `+${delta}` : `${delta}`;
    const summary = `${signed} ${STAT_CODE[stat]} for ${crawlerName(scene, crawler)} (${formatSeconds(seconds)})`;
    notifyPlayer(scene, `${summary}: ${params.get(STAT_REASON)}`, {
      tone: delta > 0 ? 'success' : 'warning',
    });
    return ok(summary);
  },
};

const HEAL_PERCENT = intParam('percent', {
  min: HEAL_MIN_PERCENT,
  max: HEAL_MAX_PERCENT,
  description: 'Share of max HP to restore.',
});

const heal: AIActionDef = {
  name: 'heal',
  description: 'Restore part of a crawler’s HP. Cannot revive a downed crawler.',
  params: [TARGET_PARAM, HEAL_PERCENT],
  policy: { cost: 2, cooldownMs: HEAL_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: HEALS_PER_FLOOR,
  refusal: ({ params, scene }) => {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    if (!crawler.isAlive || crawler.isKnockedOut) return `${crawlerName(scene, crawler)} is down`;
    return crawler.hp >= crawler.maxHp ? `${crawlerName(scene, crawler)} is at full HP` : null;
  },
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const amount = Math.max(1, Math.round((crawler.maxHp * params.get(HEAL_PERCENT)) / PERCENT));
    const before = crawler.hp;
    crawler.hp = Math.min(crawler.maxHp, crawler.hp + amount);
    return ok(`healed ${crawlerName(scene, crawler)} for ${Math.round(crawler.hp - before)} HP`);
  },
};

const SET_HP_PERCENT = intParam('hp_percent', {
  min: SET_HP_MIN_PERCENT,
  max: PERCENT,
  description: `Set HP to this share of max HP. Never below ${SET_HP_MIN_PERCENT}.`,
});

const setHp: AIActionDef = {
  name: 'set_hp',
  description: `Set a crawler’s HP to a share of their max, never below ${SET_HP_MIN_PERCENT}% and never on a downed crawler.`,
  params: [TARGET_PARAM, SET_HP_PERCENT],
  policy: {
    cost: 3,
    cooldownMs: SET_HP_COOLDOWN_MS,
    severity: 'harmful',
    forbidsContext: ['isPaused', 'inBossFight'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: SET_HP_PER_FLOOR,
  isHarmful: ({ params, scene }) => {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    return (crawler.maxHp * params.get(SET_HP_PERCENT)) / PERCENT < crawler.hp;
  },
  refusal: ({ params, scene }) => {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    if (!crawler.isAlive || crawler.isKnockedOut) return `${crawlerName(scene, crawler)} is down`;
    const target = Math.ceil((crawler.maxHp * params.get(SET_HP_PERCENT)) / PERCENT);
    const lowering = target < crawler.hp;
    const afterStatuses = target - pendingStatusDamage(crawler.statusEffects, crawler.maxHp);
    if (lowering && afterStatuses < shieldedHp(crawler)) {
      return `${crawlerName(scene, crawler)}'s afflictions would carry them under ${LOW_HP_PERCENT}% HP`;
    }
    return null;
  },
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const percent = params.get(SET_HP_PERCENT);
    const wanted = Math.ceil((crawler.maxHp * percent) / PERCENT);
    crawler.hp = Math.min(crawler.maxHp, Math.max(1, shieldedHp(crawler), wanted));
    return ok(`set ${crawlerName(scene, crawler)} to ${percent}% HP`);
  },
};

const TIMER_DELTA = intParam('delta_seconds', {
  min: -TIMER_DELTA_LIMIT_SECONDS,
  max: TIMER_DELTA_LIMIT_SECONDS,
  description: 'Seconds to add to (or take from) the floor collapse timer. Not zero.',
});

const adjustLevelTimer: AIActionDef = {
  name: 'adjust_level_timer',
  description: `Move the floor collapse timer by up to ${TIMER_DELTA_LIMIT_SECONDS}s either way. Never leaves less than ${TIMER_FLOOR_SECONDS}s.`,
  params: [TIMER_DELTA],
  policy: {
    cost: 3,
    cooldownMs: TIMER_COOLDOWN_MS,
    severity: 'harmful',
    forbidsContext: ['isPaused'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  isHarmful: ({ params }) => params.get(TIMER_DELTA) < 0,
  budget: ({ params }) => ({ pool: 'timerSeconds', amount: Math.abs(params.get(TIMER_DELTA)) }),
  refusal: ({ params, scene }) => {
    const delta = params.get(TIMER_DELTA);
    if (delta === 0) return 'a change of zero is no change';
    const timer = scene.getLevelTimer?.() ?? null;
    if (timer === null) return 'this floor has no collapse timer';
    if (
      delta < 0 &&
      timer.remainingFrames - secondsToFrames(-delta) < secondsToFrames(TIMER_FLOOR_SECONDS)
    ) {
      return `the timer cannot drop under ${TIMER_FLOOR_SECONDS}s`;
    }
    if (delta > 0 && timer.remainingFrames >= timer.limitFrames) return 'the timer is already full';
    return null;
  },
  execute({ params, scene }) {
    const timer = scene.getLevelTimer?.() ?? null;
    if (timer === null) return refused('this floor has no collapse timer');
    const delta = params.get(TIMER_DELTA);
    const before = timer.remainingFrames;
    const floorFrames = secondsToFrames(TIMER_FLOOR_SECONDS);
    const wanted = before + secondsToFrames(delta);
    // The floor guards cuts only: a clock already under it may still be topped up by just the delta.
    const next =
      delta < 0
        ? Math.min(before, Math.max(floorFrames, wanted))
        : Math.min(timer.limitFrames, wanted);
    timer.setRemainingFrames(next);
    const movedSeconds = (next - before) / secondsToFrames(1);
    const sign = movedSeconds >= 0 ? '+' : '-';
    const shown = `Collapse timer ${sign}${formatSeconds(movedSeconds)}`;
    notifyPlayer(scene, shown, { tone: delta > 0 ? 'success' : 'danger', urgent: delta < 0 });
    return ok(shown);
  },
};

export const COMBAT_ACTIONS: readonly AIActionDef[] = [
  spawnMob,
  spawnElite,
  applyStatus,
  removeStatus,
  modifyStat,
  heal,
  setHp,
  adjustLevelTimer,
];
