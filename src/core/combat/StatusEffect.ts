import type { Player } from '../../Player';
import type { StatId } from '../party/stats';
import type { ResistanceType } from '../items/defs/ItemDefs';
import { MAGIC_HIT, UNTAGGED_HIT, type DamageTags } from './damageTags';
import { BURN_WARD_SKILL, type ProficiencySkillId } from '../skills/proficiency';
import {
  AEGIS_DAMAGE_SCALE,
  BLOOD_VOMIT_RETCH_FRAMES,
  CHILLED_FRAMES,
  DOUBLE_DAMAGE_FRAMES,
  DOUBLE_DAMAGE_SCALE,
  FROZEN_FRAMES,
} from './statusTuning';
import {
  HAMBURGER_FED_DURATION_SECONDS,
  HAMBURGER_MELEE_BONUS,
} from '../items/consumables/foodEffects';

/**
 * Every status the game can put on a body. A new status is added here first;
 * the tables keyed by it ({@link STATUS_DEFS} for its rules, `STATUS_VISUALS`
 * in `statusEffectVisuals.ts` for its look) then fail to compile until it
 * declares its entry.
 */
export const STATUS_IDS = [
  'burn',
  'magic_burn',
  'poison',
  'spit_venom',
  'electrified',
  'stuck',
  'stun',
  'drunk',
  'catnip_buzz',
  'ink',
  'blood_vomit',
  'double_damage',
  'chilled',
  'frozen',
  'shield',
  'overheal',
  'fairy_ward',
  'fairy_aegis',
  'speed_fizz',
  'jugg_juice',
  'cooldown_crisp',
  'whetstone',
  'well_rested',
  'hearth_warmed',
  'deep_slumber',
  'hamburger_fed',
  'refreshed',
] as const;

export type StatusId = (typeof STATUS_IDS)[number];

/** Whether `value` names a status this build defines, for ids read back from a save. */
export function isStatusId(value: string): value is StatusId {
  return STATUS_IDS.some((id) => id === value);
}

/**
 * Who may take a status off its carrier.
 *
 * - `ailment`: done *to* the carrier rather than bought by it. Every rest and
 *   cure that clears ailments takes it.
 * - `named`: a boon, a ward or a mark. Cleared by a full cleanse or by a caller
 *   that names it, never by an ailment cure, so a service that takes coin cannot
 *   delete the Speed Fizz the player just paid for.
 * - `death_only`: nothing clears it but a death; see {@link INCURABLE_STATUSES}.
 */
export type StatusCure = 'ailment' | 'named' | 'death_only';

/** A status that bites its carrier on a fixed clock for as long as it lasts. */
export interface StatusDamageOverTime {
  /** Frames between bites; a bite lands on every positive multiple of it. */
  readonly intervalTicks: number;
  /** The resistance that blunts each bite, or null when none does. */
  readonly resistedBy: ResistanceType | null;
  /** What kind of hit each bite is, when a crawler laid the status on. */
  readonly tags: DamageTags;
  /**
   * Frames each bite seizes its carrier for, unable to walk or attack, or null
   * for a bite that only hurts. Derived from the effect's own clock (see
   * {@link seizureRemainingFraction}), so a snapshot restores a seizure exactly.
   */
  readonly seizeTicks: number | null;
}

/** Stat deltas a boon status grants while it is live. */
type StatBoon = Readonly<Partial<Record<StatId, number>>>;

/** Everything the rules need to know about one status. */
export interface StatusDef {
  readonly cure: StatusCure;
  /**
   * Set on a status that carries an absorb pool. A blow drains every ward on
   * the body in ascending `drainOrder`; see {@link WARD_STATUSES}.
   */
  readonly ward: { readonly drainOrder: number } | null;
  /**
   * Whether the status lasts only while whoever applied it lives: the caster's
   * death strips it (`removeWardsAppliedBy`).
   */
  readonly heldByCaster: boolean;
  /**
   * Stat deltas the status grants while it is live, read by
   * `Player.effectiveStat`; see {@link STAT_BOON_BONUSES}.
   */
  readonly statBoon: StatBoon | null;
  /**
   * What every blow on the carrier is multiplied by, from any source; see
   * {@link statusIncomingDamageScale}.
   */
  readonly incomingDamageScale: number;
  /**
   * Whether the carrier can neither walk, attack, cast nor use an item for as
   * long as it lasts: read by `Player.canAct` for crawlers and mobs alike.
   */
  readonly incapacitates: boolean;
  readonly damageOverTime: StatusDamageOverTime | null;
  /** The proficiency skill that shortens the status on whoever carries it, or null when none does. */
  readonly durationWardedBy: ProficiencySkillId | null;
  /**
   * Whether the status survives a snapshot: `transient` for one that only lasts
   * as long as an on-screen moment, which a restore would otherwise replay for
   * as long as the saved record says. `snapPlayer` leaves every transient entry
   * out, and a saved snapshot holding one fails validation.
   */
  readonly persistence: 'saved' | 'transient';
}

/** The scale of a status that leaves the damage its carrier takes alone. */
const DAMAGE_UNCHANGED = 1;

const BURN_BITE_INTERVAL_TICKS = 60;
const POISON_BITE_INTERVAL_TICKS = 120;
const MAGIC_BURN_BITE_INTERVAL_TICKS = 60;
const ELECTRIFIED_BITE_INTERVAL_TICKS = 180;
/** One second of seizure per electrified bite. */
const ELECTRIFIED_SEIZE_FRAMES = 60;
const SPIT_VENOM_BITE_INTERVAL_TICKS = 40;

/** Every bite of a burn is fire. */
const FIRE_BITE: DamageTags = ['fire'];

const DRAINED_FIRST = 0;
const DRAINED_SECOND = 1;

const ROOM_BOON_STAT_BONUS = 2;
/** Health is counted one point per HP, so a room's health boon is twice its other stat boons. */
const ROOM_BOON_HEALTH_BONUS = 4;

/** A status that changes nothing the rules read; each entry overrides what it does. */
const PLAIN_STATUS: StatusDef = {
  cure: 'named',
  ward: null,
  heldByCaster: false,
  statBoon: null,
  incomingDamageScale: DAMAGE_UNCHANGED,
  incapacitates: false,
  damageOverTime: null,
  durationWardedBy: null,
  persistence: 'saved',
};

const PLAIN_AILMENT: StatusDef = { ...PLAIN_STATUS, cure: 'ailment' };

/**
 * Every status's rules, one entry per {@link StatusId}. The lists below
 * ({@link INCURABLE_STATUSES}, {@link WARD_STATUSES}, {@link AILMENT_STATUSES}
 * and the rest) are derived from it, never kept by hand.
 */
export const STATUS_DEFS: Readonly<Record<StatusId, StatusDef>> = {
  burn: {
    ...PLAIN_AILMENT,
    damageOverTime: {
      intervalTicks: BURN_BITE_INTERVAL_TICKS,
      resistedBy: null,
      tags: FIRE_BITE,
      seizeTicks: null,
    },
    durationWardedBy: BURN_WARD_SKILL,
  },
  magic_burn: {
    ...PLAIN_AILMENT,
    damageOverTime: {
      intervalTicks: MAGIC_BURN_BITE_INTERVAL_TICKS,
      resistedBy: null,
      tags: MAGIC_HIT,
      seizeTicks: null,
    },
  },
  poison: {
    ...PLAIN_AILMENT,
    damageOverTime: {
      intervalTicks: POISON_BITE_INTERVAL_TICKS,
      resistedBy: 'poison',
      tags: UNTAGGED_HIT,
      seizeTicks: null,
    },
  },
  spit_venom: {
    ...PLAIN_AILMENT,
    damageOverTime: {
      intervalTicks: SPIT_VENOM_BITE_INTERVAL_TICKS,
      resistedBy: 'poison',
      tags: UNTAGGED_HIT,
      seizeTicks: null,
    },
  },
  electrified: {
    ...PLAIN_AILMENT,
    damageOverTime: {
      intervalTicks: ELECTRIFIED_BITE_INTERVAL_TICKS,
      resistedBy: null,
      tags: MAGIC_HIT,
      seizeTicks: ELECTRIFIED_SEIZE_FRAMES,
    },
  },
  stuck: PLAIN_AILMENT,
  stun: { ...PLAIN_AILMENT, incapacitates: true },
  // A real handicap, even when self-inflicted.
  drunk: PLAIN_AILMENT,
  catnip_buzz: PLAIN_AILMENT,
  ink: PLAIN_STATUS,
  blood_vomit: { ...PLAIN_STATUS, persistence: 'transient' },
  double_damage: {
    ...PLAIN_STATUS,
    cure: 'death_only',
    incomingDamageScale: DOUBLE_DAMAGE_SCALE,
  },
  chilled: PLAIN_AILMENT,
  frozen: { ...PLAIN_AILMENT, incapacitates: true },
  shield: { ...PLAIN_STATUS, ward: { drainOrder: DRAINED_SECOND }, heldByCaster: true },
  // Drained before the shield because it decays on its own clock whatever
  // happens, so spending it first wastes the least.
  overheal: { ...PLAIN_STATUS, ward: { drainOrder: DRAINED_FIRST }, heldByCaster: true },
  fairy_ward: { ...PLAIN_STATUS, heldByCaster: true },
  fairy_aegis: { ...PLAIN_STATUS, incomingDamageScale: AEGIS_DAMAGE_SCALE },
  speed_fizz: PLAIN_STATUS,
  jugg_juice: PLAIN_STATUS,
  cooldown_crisp: PLAIN_STATUS,
  whetstone: PLAIN_STATUS,
  well_rested: { ...PLAIN_STATUS, statBoon: { health: ROOM_BOON_HEALTH_BONUS } },
  hearth_warmed: { ...PLAIN_STATUS, statBoon: { melee: ROOM_BOON_STAT_BONUS } },
  deep_slumber: {
    ...PLAIN_STATUS,
    statBoon: { evasiveness: ROOM_BOON_STAT_BONUS, magic: ROOM_BOON_STAT_BONUS },
  },
  hamburger_fed: { ...PLAIN_STATUS, statBoon: { melee: HAMBURGER_MELEE_BONUS } },
  refreshed: PLAIN_STATUS,
};

function statusesWhere(rule: (def: StatusDef) => boolean): ReadonlyArray<StatusId> {
  return STATUS_IDS.filter((id) => rule(STATUS_DEFS[id]));
}

/**
 * A status effect applied to a Player (e.g. Burn, Frozen, Paralyzed).
 *
 * Per-type behaviour is handled in Player.tickStatusEffects().
 * Per-type rendering is handled in `statusEffectVisuals.ts`.
 */
export interface StatusEffect {
  /** Which status this is; an effect of the same type replaces it rather than stacking. */
  type: StatusId;
  /** Remaining duration in game ticks (frames at 60 fps). */
  ticksRemaining: number;
  /** Original total duration — used to draw the progress bar in the HUD. */
  totalTicks: number;
  /**
   * Who inflicted this effect, so a tick that lands the killing point of HP is
   * an attributable kill rather than an anonymous one — a mob that dies to the
   * poison a piece of gear applied credits the crawler wearing the piece.
   *
   * Null for anything nobody owns: an acid pool, a burning tree, a lava flame,
   * a status restored from a snapshot taken in another scene. Every consumer of
   * kill credit already treats null as "not killed by anyone".
   */
  applier: Player | null;
  /**
   * Set when the applier is only credited with the effect and did not lay it
   * on with a blow of their own: a burning boulder from the trebuchet they
   * built. The kill is still theirs, but its bites are not their hits, so they
   * neither boost nor train the applier's skills.
   */
  readonly creditOnly?: true;
  /**
   * Damage this effect will still soak up before any reaches HP. Only an
   * absorbing effect (see {@link makeShield}) carries it; `Player.takeDamage`
   * drains it ahead of HP. Kept as flat numbers on the record rather than a
   * nested object because snapshots copy effects with a shallow spread, and a
   * shared pool would drain the snapshot along with the live effect.
   */
  absorbRemaining?: number;
  /** What {@link absorbRemaining} started at, for the HUD's how-much-is-left bar. */
  absorbTotal?: number;
}

/** The status every damage-absorbing ward is filed under. */
export const SHIELD_STATUS = 'shield' as const satisfies StatusId;

/** A shield fairy's ward, which makes its carrier invulnerable; see {@link makeFairyWard}. */
export const FAIRY_WARD_STATUS = 'fairy_ward' as const satisfies StatusId;

/** Surplus health from a healing wave, held as a decaying ward; see {@link makeOverheal}. */
export const OVERHEAL_STATUS = 'overheal' as const satisfies StatusId;

/** Halved incoming damage; see {@link makeFairyAegis}. */
export const FAIRY_AEGIS_STATUS = 'fairy_aegis' as const satisfies StatusId;

/** Slowed walking and slowed swings; see {@link makeChilled}. */
export const CHILLED_STATUS = 'chilled' as const satisfies StatusId;

/** Encased in ice: no walking, attacking, casting or item use; see {@link makeFrozen}. */
export const FROZEN_STATUS = 'frozen' as const satisfies StatusId;

/**
 * One retch of blood, which a crawler brings up on entering the lowest HP
 * band (`CRAWLER_HP_THRESHOLDS.retch`). It costs nothing: it is the warning
 * that the next blow may be the last, and it lasts only as long as the retch
 * plays, so it is never restored from a snapshot (its `persistence` in
 * {@link STATUS_DEFS}).
 */
export const BLOOD_VOMIT_STATUS = 'blood_vomit' as const satisfies StatusId;

/**
 * The Wheel of Fortune's curse: every blow taken counts double (its
 * `incomingDamageScale` in {@link STATUS_DEFS}). Incurable, cleared only by a
 * death. Its remaining time is saved per crawler outside the snapshot too
 * (`doubleDamageSave.ts`), so a reload restores it whatever the snapshot kept.
 */
export const DOUBLE_DAMAGE_STATUS = 'double_damage' as const satisfies StatusId;

/**
 * Statuses nothing clears but a death: not a cure, not a knockout and revive,
 * not the level-15 energy shield's cleanse — `Player.clearStatusEffects` keeps them.
 * A party death that respawns does clear them (`checkpointSnapshot` for the
 * in-place rewind, `progressForRespawn` for the rebuild from the save), or a
 * crawler with no way to heal would die to them again on every respawn.
 */
export const INCURABLE_STATUSES = statusesWhere((def) => def.cure === 'death_only');

/** One retch of blood, from the frame it comes up. */
export function makeBloodVomit(): StatusEffect {
  return {
    type: BLOOD_VOMIT_STATUS,
    ticksRemaining: BLOOD_VOMIT_RETCH_FRAMES,
    totalTicks: BLOOD_VOMIT_RETCH_FRAMES,
    applier: null,
  };
}

/**
 * How far through its retch the body is, in 0..1, or null once it is over.
 * Read straight off the effect's own clock, so the pose and the spray stay in
 * step without the body keeping a timer of its own.
 */
export function bloodVomitRetchProgress(effect: StatusEffect): number | null {
  const elapsed = effect.totalTicks - effect.ticksRemaining;
  if (elapsed < 0 || elapsed >= effect.totalTicks) return null;
  return elapsed / effect.totalTicks;
}

/** Double damage for `ticks`, the full five minutes unless a save says otherwise. */
export function makeDoubleDamage(ticks: number = DOUBLE_DAMAGE_FRAMES): StatusEffect {
  return { type: DOUBLE_DAMAGE_STATUS, ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

function wardStatusesInDrainOrder(): ReadonlyArray<StatusId> {
  const wards = STATUS_IDS.flatMap((id) => {
    const ward = STATUS_DEFS[id].ward;
    return ward === null ? [] : [{ id, drainOrder: ward.drainOrder }];
  });
  wards.sort((a, b) => a.drainOrder - b.drainOrder);
  return wards.map((ward) => ward.id);
}

/** Every status that carries an absorb pool, in the order a blow drains them. */
export const WARD_STATUSES = wardStatusesInDrainOrder();

/**
 * Every status a caster keeps up only while it lives, stripped together by
 * `removeWardsAppliedBy` on its death.
 */
export const CASTER_HELD_STATUSES = statusesWhere((def) => def.heldByCaster);

/**
 * Long enough to outlast any fight. A fairy's ward has no clock of its own: it
 * ends only when the fairy holding it dies and strips it.
 */
const FAIRY_WARD_TICKS = 999999;

/**
 * A shield fairy's ward: its carrier takes no damage from any source while
 * `applier`, the fairy, lives. Nothing wears it down, so the only answer is the
 * fairy — and its death strips exactly the wards it was holding up.
 */
export function makeFairyWard(applier: Player): StatusEffect {
  return {
    type: FAIRY_WARD_STATUS,
    ticksRemaining: FAIRY_WARD_TICKS,
    totalTicks: FAIRY_WARD_TICKS,
    applier,
  };
}

/**
 * Surplus health beyond max HP, held as a ward that absorbs `amount` of damage
 * and then decays after `ticks` whether spent or not. A ward rather than extra
 * HP so the health bar never has to show more than full.
 */
export function makeOverheal(amount: number, ticks: number): StatusEffect {
  return {
    type: OVERHEAL_STATUS,
    ticksRemaining: ticks,
    totalTicks: ticks,
    applier: null,
    absorbRemaining: amount,
    absorbTotal: amount,
  };
}

/**
 * Halves every blow the carrier takes for `ticks`. Re-applied, it replaces
 * rather than stacks, like every status.
 */
export function makeFairyAegis(ticks: number): StatusEffect {
  return { type: FAIRY_AEGIS_STATUS, ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Chilled for `ticks`. Apply through `applyIceHit`/`applyChillOnly` so freezes follow their rules. */
export function makeChilled(ticks: number = CHILLED_FRAMES): StatusEffect {
  return { type: CHILLED_STATUS, ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Frozen for `ticks`. Apply through `applyIceHit` so the grace window that follows is honoured. */
export function makeFrozen(ticks: number = FROZEN_FRAMES): StatusEffect {
  return { type: FROZEN_STATUS, ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/**
 * How long a broken ward stays on the character after its pool runs dry: long
 * enough for the dome to be seen coming apart, rather than vanishing between
 * one frame and the next. It absorbs nothing while it lingers.
 */
export const ABSORB_BREAK_LINGER_TICKS = 18;

/**
 * A damage-absorbing ward: the next `absorb` points of damage from any source
 * are taken off the ward rather than off HP, for up to `ticks` ticks. Cast
 * again on the same body, it is replaced whole — a fresh pool and a fresh
 * clock — rather than stacked.
 */
export function makeShield(absorb: number, ticks: number): StatusEffect {
  return {
    type: SHIELD_STATUS,
    ticksRemaining: ticks,
    totalTicks: ticks,
    applier: null,
    absorbRemaining: absorb,
    absorbTotal: absorb,
  };
}

/** Whether an effect still has any damage left to absorb. */
export function isAbsorbing(effect: StatusEffect): boolean {
  return (effect.absorbRemaining ?? 0) > 0;
}

/**
 * How much of an effect is left, 0–1: its clock, or for a ward whichever of
 * its clock and its pool will run out first, since either one ends it.
 */
export function statusRemainingFraction(effect: StatusEffect): number {
  const timeLeft = effect.totalTicks > 0 ? effect.ticksRemaining / effect.totalTicks : 0;
  const total = effect.absorbTotal;
  if (total === undefined || total <= 0) return timeLeft;
  const poolLeft = (effect.absorbRemaining ?? 0) / total;
  return Math.max(0, Math.min(timeLeft, poolLeft));
}

/**
 * What every blow on a body carrying `effects` is multiplied by: the product of
 * each status's `incomingDamageScale` in {@link STATUS_DEFS}. Applied once per
 * blow by `Player.takeDamage` (crawlers) and `Mob`'s own door (mobs), whatever the
 * source, so a status that doubles or halves damage does it to a swing, a
 * status tick and a hazard alike.
 */
export function statusIncomingDamageScale(effects: ReadonlyArray<StatusEffect>): number {
  let scale = 1;
  for (const effect of effects) scale *= STATUS_DEFS[effect.type].incomingDamageScale;
  return scale;
}

/**
 * How much of the seizure from `effect`'s latest bite is still to run, from 1
 * on the frame after the bite down to 0 once the carrier is free again; 0 for
 * a status whose bites do not seize.
 *
 * Read off the effect's own clock rather than kept as a countdown, because a
 * bite lands on every positive multiple of its interval (`Player`'s status
 * tick), so the frames since the last bite are already known.
 */
export function seizureRemainingFraction(effect: StatusEffect): number {
  const damageOverTime = STATUS_DEFS[effect.type].damageOverTime;
  const seizeTicks = damageOverTime?.seizeTicks ?? null;
  if (damageOverTime === null || seizeTicks === null) return 0;
  const elapsed = effect.totalTicks - effect.ticksRemaining;
  if (elapsed < damageOverTime.intervalTicks) return 0;
  const framesSinceBite = elapsed % damageOverTime.intervalTicks;
  if (framesSinceBite === 0) return 0;
  const seizedFramesLeft = seizeTicks - framesSinceBite + 1;
  return Math.max(0, seizedFramesLeft / seizeTicks);
}

/**
 * What a body carries once `applied` lands on top of `existing`, an effect of
 * the same type.
 *
 * A status that bites keeps the existing effect's clock and only gains time:
 * its bites (and any seizure) are read off how many frames it has already run,
 * so restarting that clock on every reapply would end a seizure in progress and
 * let a source that reapplies faster than the bite interval starve the status
 * of ever biting. Every other status is simply replaced.
 */
export function reappliedStatus(existing: StatusEffect, applied: StatusEffect): StatusEffect {
  if (STATUS_DEFS[applied.type].damageOverTime === null) return applied;
  const elapsed = Math.max(0, existing.totalTicks - existing.ticksRemaining);
  const ticksRemaining = Math.max(existing.ticksRemaining, applied.ticksRemaining);
  return { ...applied, ticksRemaining, totalTicks: elapsed + ticksRemaining };
}

/** Whether `effect` holds its carrier unable to walk, attack, cast or use an item this frame. */
export function statusIncapacitates(effect: StatusEffect): boolean {
  return STATUS_DEFS[effect.type].incapacitates || seizureRemainingFraction(effect) > 0;
}

/**
 * The statuses that are done *to* a crawler rather than bought by one.
 *
 * Anything that cures or clears status effects must work from this list rather
 * than wiping `statusEffects` wholesale: a service that takes coin and deletes
 * the Speed Fizz the player just paid for is a trap, not a service.
 */
export const AILMENT_STATUSES = statusesWhere((def) => def.cure === 'ailment');

/**
 * The statuses a drink lays on that blur the room: the camera sways, the walk
 * wanders and the carrier swings harder. `Intoxication.ts` holds how each one
 * feels.
 */
export const INTOXICATIONS = ['drunk', 'catnip_buzz'] as const satisfies readonly StatusId[];
export type Intoxication = (typeof INTOXICATIONS)[number];

function isIntoxication(type: StatusId): type is Intoxication {
  return INTOXICATIONS.some((intoxication) => intoxication === type);
}

/**
 * The ailments the apothecary's antidote and the Brass Gullet draw out: every
 * one except an intoxication. Sobering up is the inn's service, and leaving it
 * to the inn keeps an antidote and a room from being the same purchase.
 */
export const CURABLE_AILMENT_STATUSES: ReadonlyArray<StatusId> = AILMENT_STATUSES.filter(
  (type) => !isIntoxication(type),
);

// Preset constructors

/** Eight seconds at 60 fps. */
const BURN_TICKS = 480;

/** 8-second burn: 1 damage / second for 8 seconds. */
export function makeBurn(applier: Player | null = null): StatusEffect {
  return { type: 'burn', ticksRemaining: BURN_TICKS, totalTicks: BURN_TICKS, applier };
}

/** A burn credited to `creditedTo` that something they built, not their own hand, set. */
export function makeCreditedBurn(creditedTo: Player): StatusEffect {
  return { ...makeBurn(creditedTo), creditOnly: true };
}

/** Thirty seconds at 60 fps. */
const POISON_TICKS = 1800;

/** Poison: 1 damage every 2 seconds, for 30 seconds unless `ticks` says longer. */
export function makePoison(
  applier: Player | null = null,
  ticks: number = POISON_TICKS,
): StatusEffect {
  return { type: 'poison', ticksRemaining: ticks, totalTicks: ticks, applier };
}

/** Ten seconds at 60 fps. */
const MAGIC_BURN_TICKS = 600;

/** Magic Burn: 10-second arcane DoT from a level-15 Magic Missile shockwave. 1 dmg/s. */
export function makeMagicBurn(applier: Player | null = null): StatusEffect {
  return {
    type: 'magic_burn',
    ticksRemaining: MAGIC_BURN_TICKS,
    totalTicks: MAGIC_BURN_TICKS,
    applier,
  };
}

/** Ten seconds at 60 fps. */
const ELECTRIFIED_TICKS = 600;

/** Electrified: ten seconds of bites, each of which seizes the carrier for a moment. */
export function makeElectrified(applier: Player | null = null): StatusEffect {
  return {
    type: 'electrified',
    ticksRemaining: ELECTRIFIED_TICKS,
    totalTicks: ELECTRIFIED_TICKS,
    applier,
  };
}

/** Four seconds at 60 fps. */
const SPIDER_WEB_TICKS = 240;

/**
 * Immobilises the target. Defaults to the spider's web, which is where the
 * effect started; callers that root for a different length pass their own ticks
 * rather than mutating the returned effect.
 */
export function makeStuck(ticks: number = SPIDER_WEB_TICKS): StatusEffect {
  return { type: 'stuck', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Four seconds at 60 fps. */
const SPIT_VENOM_TICKS = 240;

/** Spider spit venom: acid DoT applied alongside stuck — 1 damage every 40 ticks (~6 dmg over 4 s). */
export function makeSpitVenom(applier: Player | null = null): StatusEffect {
  return {
    type: 'spit_venom',
    ticksRemaining: SPIT_VENOM_TICKS,
    totalTicks: SPIT_VENOM_TICKS,
    applier,
  };
}

/**
 * Ink in the eyes: a mob carrying it misses a share of its blows
 * (`Mob.deliverBlow`). Laid by the party's gear, so only mobs ever carry it.
 */
export const INK_STATUS = 'ink' as const satisfies StatusId;

/** Inked for `ticks`. */
export function makeInk(ticks: number): StatusEffect {
  return { type: INK_STATUS, ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Stun: the target can neither walk nor attack for the given number of ticks. */
export function makeStun(ticks: number): StatusEffect {
  return { type: 'stun', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** The status filed under a Speed Fizz potion — its own constant because {@link Player} checks for it by name to draw motion afterimages. */
export const SPEED_FIZZ_STATUS = 'speed_fizz' as const satisfies StatusId;

/** Twenty-five seconds at 60 fps. */
const SPEED_FIZZ_TICKS = 1500;

/** Speed Fizz: doubles movement speed for 25 seconds. */
export function makeSpeedFizz(): StatusEffect {
  return {
    type: SPEED_FIZZ_STATUS,
    ticksRemaining: SPEED_FIZZ_TICKS,
    totalTicks: SPEED_FIZZ_TICKS,
    applier: null,
  };
}

/** Thirty seconds at 60 fps. */
const JUGG_JUICE_TICKS = 1800;

/** Jugg Juice: temporarily boosts max HP by 50% + 5 for 30 seconds. */
export function makeJuggJuice(): StatusEffect {
  return {
    type: 'jugg_juice',
    ticksRemaining: JUGG_JUICE_TICKS,
    totalTicks: JUGG_JUICE_TICKS,
    applier: null,
  };
}

/** Base drunk duration: 30 seconds at 60 fps. */
const DRUNK_TICKS = 1800;

/**
 * Drunk: 30 seconds (1800 ticks at 60 fps) of swaying camera, a wandering walk and
 * a little extra melee damage. Re-drinking refreshes rather than stacks, which is
 * the intended "keep the round going" loop. See `src/core/combat/Intoxication.ts`.
 *
 * @param durationScale Shortens the effect — Iron Stomach passes its time scale.
 */
export function makeDrunk(durationScale = 1): StatusEffect {
  const ticks = Math.max(1, Math.round(DRUNK_TICKS * durationScale));
  return { type: 'drunk', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** A catnip buzz runs as long as a drunk round does: the same trade, poured for the cat. */
const CATNIP_BUZZ_TICKS = DRUNK_TICKS;

/**
 * Catnip buzz: the cat's intoxication, swaying loose and happy rather than
 * listing. See `src/core/combat/Intoxication.ts`.
 *
 * @param durationScale Shortens the effect — Iron Stomach passes its time scale.
 */
export function makeCatnipBuzz(durationScale = 1): StatusEffect {
  const ticks = Math.max(1, Math.round(CATNIP_BUZZ_TICKS * durationScale));
  return { type: 'catnip_buzz', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

const INTOXICATION_MAKERS = {
  drunk: makeDrunk,
  catnip_buzz: makeCatnipBuzz,
} as const satisfies Record<Intoxication, (durationScale?: number) => StatusEffect>;

/** `intoxication` as a fresh effect, shortened by `durationScale`. */
export function makeIntoxication(intoxication: Intoxication, durationScale = 1): StatusEffect {
  return INTOXICATION_MAKERS[intoxication](durationScale);
}

/** Whetstone: three minutes at 60 fps — long enough to be worth carrying out the door. */
const WHETSTONE_TICKS = 10800;

/** Melee damage a freshly-stoned edge adds, on top of the Melee stat. */
export const WHETSTONE_MELEE_DAMAGE_BONUS = 3;

/**
 * Whetstone: the smith's edge. Pure melee damage for as long as it holds — no
 * per-tick behaviour, so `Player.tickStatusEffects` only has to count it down.
 */
export function makeWhetstone(): StatusEffect {
  return {
    type: 'whetstone',
    ticksRemaining: WHETSTONE_TICKS,
    totalTicks: WHETSTONE_TICKS,
    applier: null,
  };
}

/** Twenty-five seconds at 60 fps. */
const COOLDOWN_CRISP_TICKS = 1500;

/** Cooldown Crisp: halves all ability cooldowns for 25 seconds. */
export function makeCooldownCrisp(): StatusEffect {
  return {
    type: 'cooldown_crisp',
    ticksRemaining: COOLDOWN_CRISP_TICKS,
    totalTicks: COOLDOWN_CRISP_TICKS,
    applier: null,
  };
}

// -- Room boons: what a night in a rented bed is actually worth ---------------

/**
 * Stat deltas each boon grants while it is live. Read by `Player.effectiveStat`,
 * which is the whole of the mechanism: nothing is applied on grant and nothing
 * is unwound on expiry, so a boon cannot leave a stale bonus behind.
 *
 * A health entry moves max HP, so every path that starts or ends one of
 * these has to call `syncHpToMaxHp` — otherwise the HP bar and the max disagree
 * until some unrelated event happens to reconcile them.
 */
export const STAT_BOON_BONUSES: ReadonlyMap<StatusId, StatBoon> = new Map(
  STATUS_IDS.flatMap((id) => {
    const statBoon = STATUS_DEFS[id].statBoon;
    return statBoon === null ? [] : [[id, statBoon] as const];
  }),
);

const TICKS_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;

/**
 * Long enough that a room bought in town is still running when the crawlers
 * reach whatever the stairs open onto — the boon is the product, and a buff that
 * expires on the walk out is a con.
 */
export const ROOM_BOON_DURATION_MINUTES = 8;

export const ROOM_BOON_TICKS = ROOM_BOON_DURATION_MINUTES * SECONDS_PER_MINUTE * TICKS_PER_SECOND;

const WELL_RESTED_STATUS = 'well_rested' as const satisfies StatusId;
const HEARTH_WARMED_STATUS = 'hearth_warmed' as const satisfies StatusId;
const DEEP_SLUMBER_STATUS = 'deep_slumber' as const satisfies StatusId;

/**
 * The boons an inn room grants. Exported so the inn can clear the other two when
 * it grants one: three rooms rented in a row would otherwise stack every bonus,
 * and the choice between the rooms would stop being a choice.
 */
export const ROOM_BOON_STATUSES: ReadonlyArray<StatusId> = [
  WELL_RESTED_STATUS,
  HEARTH_WARMED_STATUS,
  DEEP_SLUMBER_STATUS,
];

function makeRoomBoon(type: StatusId): StatusEffect {
  return { type, ticksRemaining: ROOM_BOON_TICKS, totalTicks: ROOM_BOON_TICKS, applier: null };
}

/** Well Rested: the attic cot's boon. */
export function makeWellRested(): StatusEffect {
  return makeRoomBoon(WELL_RESTED_STATUS);
}

/** Hearth Warmed: the hearthside room's boon. */
export function makeHearthWarmed(): StatusEffect {
  return makeRoomBoon(HEARTH_WARMED_STATUS);
}

/** Deep Slumber: the cat's own room's boon. */
export function makeDeepSlumber(): StatusEffect {
  return makeRoomBoon(DEEP_SLUMBER_STATUS);
}

// -- Food boons -----------------------------------------------------------------

/** The Melee bonus a Hamburger lends; see {@link makeHamburgerFed}. */
export const HAMBURGER_FED_STATUS = 'hamburger_fed' as const satisfies StatusId;

export const HAMBURGER_FED_TICKS = HAMBURGER_FED_DURATION_SECONDS * TICKS_PER_SECOND;

/**
 * Hamburger Fed: a short melee boon. Eating another while fed refreshes the
 * timer rather than adding a second bonus, because `applyStatus` replaces an
 * effect of the same type and {@link STAT_BOON_BONUSES} reads each type once.
 */
export function makeHamburgerFed(): StatusEffect {
  return {
    type: HAMBURGER_FED_STATUS,
    ticksRemaining: HAMBURGER_FED_TICKS,
    totalTicks: HAMBURGER_FED_TICKS,
    applier: null,
  };
}

// -- The Clogged Bathroom --------------------------------------------------------

/** A quick turn in a fixed bathroom stall; see {@link makeRefreshed}. */
export const REFRESHED_STATUS = 'refreshed' as const satisfies StatusId;

/** How much faster a refreshed crawler walks. */
export const REFRESHED_SPEED_FACTOR = 1.1;

export const REFRESHED_DURATION_SECONDS = 150;

export const REFRESHED_DURATION_TICKS = REFRESHED_DURATION_SECONDS * TICKS_PER_SECOND;

/**
 * Refreshed: a mild walking-speed boon from using a bathroom stall. Using a
 * stall again refreshes the clock rather than stacking, because `applyStatus`
 * replaces an effect of the same type and `Player.speedMultiplier` reads the
 * type once.
 */
export function makeRefreshed(): StatusEffect {
  return {
    type: REFRESHED_STATUS,
    ticksRemaining: REFRESHED_DURATION_TICKS,
    totalTicks: REFRESHED_DURATION_TICKS,
    applier: null,
  };
}
