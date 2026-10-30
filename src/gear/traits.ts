/**
 * The gear trait engine: every mechanic a piece of gear can carry, as data on
 * its item definition, and the one handler per trait kind that describes,
 * scores and runs it.
 *
 * `GEAR_TRAIT_HANDLERS` is a complete record over the trait kinds, so a trait
 * added to the union without a handler does not compile. Each hook has one
 * entry point that walks a crawler's worn traits (`gearHooks.ts`), so no
 * combat or player code ever checks for an item id.
 *
 * No trait changes what a crawler can see: light reach, the fog's radius and
 * the ambient are fixed, and darkness is contrast only, never an obstruction.
 */

import { ABILITY_DEFS } from '../abilities/abilityDefs';
import type { AbilityId } from '../core/skills/AbilityManager';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { WEAPON_FAMILY_LABELS, type MeleeWeaponFamily } from '../core/items/equipment/weapons';
import { applyChillOnly } from '../core/combat/frostStatus';
import {
  combineGroundHazardShares,
  FULL_GROUND_HAZARD_SHARES,
  groundHazardSharesWith,
  type GroundHazard,
  type GroundHazardShares,
} from '../core/combat/groundHazard';
import { QUEST_SLOT_IDX, type ItemId } from '../core/items/defs/ItemDefs';
import {
  makeBurn,
  makeInk,
  makePoison,
  makeShield,
  makeStuck,
  makeStun,
  FULL_SHARE,
} from '../core/combat/StatusEffect';
import type { Mob } from '../creatures/Mob';
import type { DamageSource, Player, RegenModifierKey } from '../Player';
import { magicRechargeScale } from '../core/party/crawlerFormulas';
import { hitTrainingOn, resolveCrawlerHit, type CrawlerDealer } from '../core/combat/outgoingHit';
import { UNTAGGED_HIT } from '../core/combat/damageTags';
import type { GearItemState } from './gearState';

/** Multiplier→percentage conversion for generated lines. */
const PERCENT = 100;
const HALF_TILE = TILE_SIZE / 2;

function percent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

function seconds(frames: number): number {
  return Math.round(frames / WORLD_TICKS_PER_SECOND);
}

/** The statuses a blow can carry onto what it hits. */
export type OnHitStatusKind = 'poison' | 'chill' | 'burn' | 'stun' | 'web' | 'ink';

/** Which of the wearer's hits a trait rides on: melee blows only, or her missiles too. */
export type HitDelivery = 'melee' | 'any';

/** What a relic circling its wearer does each time it recharges. */
export type RelicBehaviour = 'bolt' | 'ward' | 'bramble';

/** Every gear trait but the awakening, which carries a list of these. */
export type BaseGearTrait =
  | {
      readonly kind: 'onHitStatus';
      readonly status: OnHitStatusKind;
      readonly chance: number;
      readonly on: HitDelivery;
      /** How long a timed status lasts; statuses with a fixed length ignore it. */
      readonly durationFrames?: number;
    }
  | {
      readonly kind: 'chainSpark';
      readonly targets: number;
      readonly rangeTiles: number;
      readonly damageShare: number;
    }
  | { readonly kind: 'lifesteal'; readonly share: number }
  | { readonly kind: 'onKillHeal'; readonly maxHpShare: number }
  | { readonly kind: 'coinBonus'; readonly share: number }
  | { readonly kind: 'dodgeChance'; readonly chance: number }
  | { readonly kind: 'thorns'; readonly share: number }
  | { readonly kind: 'riposte'; readonly windowFrames: number; readonly multiplier: number }
  | {
      readonly kind: 'combo';
      readonly hits: number;
      readonly windowFrames: number;
      readonly stunFrames: number;
      readonly shockwaveTiles: number;
    }
  | { readonly kind: 'stillnessRegen'; readonly afterFrames: number; readonly multiplier: number }
  | { readonly kind: 'unseenStrike'; readonly multiplier: number }
  /**
   * An enemy not yet fighting the wearer notices her only within
   * `noticeShare` of its usual range, and the same holds for the other
   * crawler while within `partnerRangeTiles` of her.
   */
  | {
      readonly kind: 'quietPaws';
      readonly noticeShare: number;
      readonly partnerRangeTiles: number;
    }
  | { readonly kind: 'vanishOnKill'; readonly durationFrames: number }
  | {
      readonly kind: 'lastStand';
      readonly hpShare: number;
      readonly durationFrames: number;
      readonly cooldownFrames: number;
    }
  | { readonly kind: 'ninthLife'; readonly hpShare: number }
  | {
      readonly kind: 'partnerLink';
      /** The piece the other crawler must wear for the link to form. */
      readonly partner: ItemId;
      readonly rangeTiles: number;
      readonly regenMultiplier: number;
      /** Added to every stat while the link holds; health takes `PARTNER_LINK_HEALTH_PER_POINT` times it. */
      readonly statBonus: number;
      readonly shieldFrames: number;
    }
  | {
      readonly kind: 'flinchNova';
      readonly chance: number;
      readonly rangeTiles: number;
      readonly stunFrames: number;
    }
  | { readonly kind: 'explosiveCraft'; readonly radiusTiles: number; readonly refundChance: number }
  | { readonly kind: 'harvestYield'; readonly bonus: number }
  | { readonly kind: 'grantsAbility'; readonly ability: AbilityId }
  | { readonly kind: 'cursed'; readonly maxHpPenaltyShare: number }
  | { readonly kind: 'ricochet'; readonly bounces: number }
  | {
      readonly kind: 'relic';
      readonly behaviour: RelicBehaviour;
      readonly cooldownFrames: number;
      /** Whether the wearer's magic shortens the recharge (`magicRechargeScale`). */
      readonly rechargeScalesWithMagic: boolean;
      readonly rangeTiles: number;
      /** What a bolt lands on what it hits; a bolt without one only wounds. */
      readonly status?: OnHitStatusKind;
    }
  /** The wearer's punches land as blows from this kind of weapon, and train its skill. */
  | { readonly kind: 'fistFamily'; readonly family: MeleeWeaponFamily }
  /** Fairies never start a fight with the wearer; one she has struck answers in kind. */
  | { readonly kind: 'fairyTruce' }
  /** Each missile that hits an enemy splits into this many copies that hunt nearby foes. */
  | { readonly kind: 'missileSplit'; readonly copies: number }
  | { readonly kind: 'missileSpeed'; readonly multiplier: number }
  /** Every Nth swipe also throws a slash wave this many tiles. */
  | { readonly kind: 'slashWave'; readonly everyNth: number; readonly rangeTiles: number }
  /**
   * A shield on the arm: while it is at the ready — in hand, and the wearer not
   * swinging — a shot loosed from within `arcDegrees` of where the wearer
   * faces is stopped this often.
   */
  | { readonly kind: 'frontalBlock'; readonly chance: number; readonly arcDegrees: number }
  /**
   * The wearer takes only `damageShare` of what `hazard` underfoot deals; a
   * share of 0 makes the wearer immune to it.
   */
  | {
      readonly kind: 'groundHazardWard';
      readonly hazard: GroundHazard;
      readonly damageShare: number;
    };

/** After enough kills while worn, the piece gains `awakensTo` on top of its own traits. */
export interface AwakeningTrait {
  readonly kind: 'awakening';
  readonly kills: number;
  readonly awakensTo: ReadonlyArray<BaseGearTrait>;
}

export type GearTrait = BaseGearTrait | AwakeningTrait;
export type GearTraitKind = GearTrait['kind'];

/** The trait of one kind, for handlers and code that dispatches on a kind. */
export type GearTraitOf<K extends GearTraitKind> = Extract<GearTrait, { kind: K }>;

/** Passive numbers worn traits add up to, read by the code each one changes. */
export interface GearModifiers {
  /** Share of a landed mob melee blow sent back at the attacker. */
  readonly thornsShare: number;
  /** The kind of weapon the wearer's punches land as, or null for a bare fist. */
  readonly fistFamily: MeleeWeaponFamily | null;
  /** Copies each landed missile splits into; 0 when nothing worn splits them. */
  readonly missileSplitCopies: number;
  /** Added to the dodge chance before its cap (`computeDodgeChance`). */
  readonly dodgeChance: number;
  /** Added share of coins from kills and chests. */
  readonly coinBonusShare: number;
  /** Tiles added to every dynamite blast the wearer sets off. */
  readonly explosiveRadiusTiles: number;
  /** Chance a thrown stick goes back in the bag. */
  readonly explosiveRefundChance: number;
  /** Units added to each wood or stone harvest award. */
  readonly harvestYieldBonus: number;
  /** Multiplies how fast the wearer's missiles fly. */
  readonly missileSpeedMultiplier: number;
  /** How many times each sling stone bounces on to another enemy. */
  readonly ricochetBounces: number;
  /** Share of max HP worn curses take away. */
  readonly maxHpPenaltyShare: number;
  /** Whether fairies leave the wearer be until she strikes one. */
  readonly fairyTruce: boolean;
  /** The share of each ground hazard's damage that reaches the wearer. */
  readonly groundHazardShares: GroundHazardShares;
}

export const NO_GEAR_MODIFIERS: GearModifiers = {
  thornsShare: 0,
  fistFamily: null,
  missileSplitCopies: 0,
  dodgeChance: 0,
  coinBonusShare: 0,
  explosiveRadiusTiles: 0,
  explosiveRefundChance: 0,
  harvestYieldBonus: 0,
  missileSpeedMultiplier: 1,
  ricochetBounces: 0,
  maxHpPenaltyShare: 0,
  fairyTruce: false,
  groundHazardShares: FULL_GROUND_HAZARD_SHARES,
};

const sum = (a: number, b: number): number => a + b;

/** How two traits' contributions to one modifier combine. */
const MODIFIER_COMBINERS: {
  readonly [K in keyof GearModifiers]: (
    a: GearModifiers[K],
    b: GearModifiers[K],
  ) => GearModifiers[K];
} = {
  thornsShare: sum,
  fistFamily: (a, b) => a ?? b,
  missileSplitCopies: (a, b) => Math.max(a, b),
  dodgeChance: sum,
  coinBonusShare: sum,
  explosiveRadiusTiles: sum,
  explosiveRefundChance: (a, b) => Math.min(1, a + b),
  harvestYieldBonus: sum,
  missileSpeedMultiplier: (a, b) => a * b,
  ricochetBounces: (a, b) => Math.max(a, b),
  maxHpPenaltyShare: sum,
  fairyTruce: (a, b) => a || b,
  groundHazardShares: combineGroundHazardShares,
};

function combineModifier<K extends keyof GearModifiers>(
  key: K,
  total: GearModifiers,
  part: Partial<GearModifiers>,
): GearModifiers[K] {
  const added = part[key];
  return added === undefined ? total[key] : MODIFIER_COMBINERS[key](total[key], added);
}

/** `total` with `part` folded in, each field by its own rule. */
export function addModifiers(total: GearModifiers, part: Partial<GearModifiers>): GearModifiers {
  return {
    thornsShare: combineModifier('thornsShare', total, part),
    fistFamily: combineModifier('fistFamily', total, part),
    missileSplitCopies: combineModifier('missileSplitCopies', total, part),
    dodgeChance: combineModifier('dodgeChance', total, part),
    coinBonusShare: combineModifier('coinBonusShare', total, part),
    explosiveRadiusTiles: combineModifier('explosiveRadiusTiles', total, part),
    explosiveRefundChance: combineModifier('explosiveRefundChance', total, part),
    harvestYieldBonus: combineModifier('harvestYieldBonus', total, part),
    missileSpeedMultiplier: combineModifier('missileSpeedMultiplier', total, part),
    ricochetBounces: combineModifier('ricochetBounces', total, part),
    maxHpPenaltyShare: combineModifier('maxHpPenaltyShare', total, part),
    fairyTruce: combineModifier('fairyTruce', total, part),
    groundHazardShares: combineModifier('groundHazardShares', total, part),
  };
}

/**
 * What traits can reach of the place they run in. Absent where a scene runs
 * combat without a `GearSystem`; a trait that needs the world then does
 * nothing rather than reaching for one.
 */
export interface GearWorld {
  /** Living enemies a crawler may strike within `radiusPx` of a world point, nearest first. */
  enemiesNear(x: number, y: number, radiusPx: number): readonly Mob[];
  /** Looses a relic's bolt from beside `wearer` at `target`. */
  fireRelicBolt(wearer: Player, target: Mob, status: OnHitStatusKind | undefined): void;
  /** Plants a relic's rooting thorn patch at a world point, credited to `wearer`. */
  plantBramble(wearer: Player, x: number, y: number): void;
}

/** Who a hook is running for: the wearer, the piece and what that piece remembers. */
export interface GearHookContext {
  readonly wearer: Player;
  readonly itemId: ItemId;
  readonly state: GearItemState;
}

/** A blow or missile of the wearer's that landed on a mob and earned something. */
export interface GearHit {
  /** The crawler whose blow it was, and who wears the gear it sets off. */
  readonly dealer: CrawlerDealer;
  readonly mob: Mob;
  readonly delivery: 'melee' | 'spell';
  /** What the blow dealt. */
  readonly damage: number;
  readonly world: GearWorld | null;
}

/** A blow of the wearer's about to land, which a trait may scale. */
export interface GearStrike {
  readonly mob: Mob;
  readonly delivery: 'melee' | 'spell';
}

/** One melee swing of the wearer's, measured from her centre along her facing. */
export interface GearSwing {
  readonly originX: number;
  readonly originY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly reachPx: number;
}

export interface GearKill {
  readonly mob: Mob;
  readonly world: GearWorld | null;
}

export interface GearHurt {
  readonly damage: number;
  /** What dealt the blow, when the damage path names it. */
  readonly source: DamageSource | undefined;
}

/** A hostile shot about to reach the wearer: where it was loosed from, when the shot knows. */
/**
 * A ranged blow about to reach the wearer, and which way it is coming in: a
 * projectile by its own flight, or a ranged blow with no projectile of its
 * own by where its striker stands.
 */
export type IncomingShot =
  | {
      readonly kind: 'flight';
      /** The shot's travel, in world pixels; only its direction is read. */
      readonly velocityX: number;
      readonly velocityY: number;
    }
  | {
      readonly kind: 'striker';
      /** The striker's world position, its tile's top-left. */
      readonly from: { readonly x: number; readonly y: number };
    };

export interface GearTick {
  readonly dtFrames: number;
  /** The other crawler, for traits that work between the two. */
  readonly partner: Player | null;
  readonly world: GearWorld | null;
}

/**
 * What one trait kind does. Only `describe` and `score` are required; a
 * handler implements just the hooks its trait needs.
 */
export interface TraitHandler<T extends GearTrait> {
  /** The generated line the item's detail pane shows for the trait. */
  describe(trait: T): string;
  /** How much the trait adds to a piece's worth, for the upgrade badge. */
  score(trait: T): number;
  onMeleeHit?(ctx: GearHookContext, trait: T, hit: GearHit): void;
  onSpellHit?(ctx: GearHookContext, trait: T, hit: GearHit): void;
  /** Multiplies a blow before it lands; may spend whatever earned the multiple. */
  strikeMultiplier?(ctx: GearHookContext, trait: T, strike: GearStrike): number;
  onSwing?(ctx: GearHookContext, trait: T, swing: GearSwing): void;
  onKill?(ctx: GearHookContext, trait: T, kill: GearKill): void;
  /** Returns the damage the wearer actually takes. */
  onHurt?(ctx: GearHookContext, trait: T, hurt: GearHurt): number;
  /** Told what a blow finally costs once every `onHurt` has had its say, before HP is written. */
  afterHurt?(ctx: GearHookContext, trait: T, damageTaken: number): void;
  /** A mob's blow landed on the wearer in contact. */
  onStruck?(ctx: GearHookContext, trait: T, attacker: Mob): void;
  /** A ranged blow is about to reach the wearer; true swallows it whole. */
  onRangedIncoming?(ctx: GearHookContext, trait: T, shot: IncomingShot): boolean;
  onTick?(ctx: GearHookContext, trait: T, tick: GearTick): void;
  onEquip?(ctx: GearHookContext, trait: T): void;
  onUnequip?(ctx: GearHookContext, trait: T): void;
  modifiers?(trait: T): Partial<GearModifiers>;
}

/** The status names as the detail pane spells them. */
const STATUS_LABELS: Readonly<Record<OnHitStatusKind, string>> = {
  poison: 'poison',
  chill: 'chill',
  burn: 'burn',
  stun: 'stun',
  web: 'web',
  ink: 'ink',
};

/** Each ground hazard as the detail pane names it. */
const GROUND_HAZARD_LABELS: Readonly<Record<GroundHazard, string>> = {
  electricity: 'electrified ground',
  acid: 'acid on the ground',
};

const RELIC_LABELS: Readonly<Record<RelicBehaviour, string>> = {
  bolt: 'Fires a bolt at the nearest enemy',
  ward: 'Shatters the next ranged blow aimed at you',
  bramble: 'Plants a rooting thorn patch under a nearby enemy',
};

/**
 * Score weights, chosen so a trait reads as roughly as valuable as a few
 * points of a raw stat, against the stat weight of 1 in `gearScore`.
 */
const SCORE_PER_PROC_CHANCE = 20;
const SCORE_PER_SHARE = 30;
const SCORE_PER_MULTIPLIER_STEP = 4;
const SCORE_FLAT_MECHANIC = 3;
const SCORE_SIGNATURE_MECHANIC = 6;
const SCORE_PER_TILE = 1;
const SCORE_PER_YIELD = 2;
const SCORE_PER_COPY = 2;
/** A cursed piece's cost counts against it, so a bound piece never reads as a free upgrade. */
const SCORE_PER_CURSE_PENALTY_SHARE = -20;

/**
 * Bosses shrug off a gear stun or root: a flat per-blow proc that stacks with
 * attack speed would hold one in a permanent stun loop, which stops being a
 * fight, and a boss's scripted movement must never be pinned by a ring.
 */
function takesGearHold(mob: Mob): boolean {
  return !mob.isBoss;
}

/** How long a gear stun holds when the trait names no length (1.5 s at 60 fps). */
const GEAR_STUN_FRAMES = 90;
/**
 * How long a web holds when the trait names no length: a short root, much
 * weaker than the spider's own web the status is borrowed from.
 */
const GEAR_WEB_FRAMES = 45;
/** How long ink stays in a mob's eyes when the trait names no length (4 s). */
const GEAR_INK_FRAMES = 240;
/** What a gear web's root is recorded against, so only it can release the hold early. */
const GEAR_WEB_ROOT_SOURCE = { gear: 'web' } as const;

/** Lands `status` from `wearer` on `mob`, whatever rolled for it. */
export function landGearStatus(
  wearer: Player,
  mob: Mob,
  status: OnHitStatusKind,
  durationFrames?: number,
): void {
  switch (status) {
    case 'poison':
      mob.applyStatus(
        durationFrames === undefined ? makePoison(wearer) : makePoison(wearer, durationFrames),
      );
      return;
    case 'burn':
      mob.applyStatus(makeBurn(FULL_SHARE, wearer));
      return;
    case 'chill':
      applyChillOnly(mob, FULL_SHARE, durationFrames);
      return;
    case 'stun':
      if (takesGearHold(mob)) mob.applyStatus(makeStun(durationFrames ?? GEAR_STUN_FRAMES));
      return;
    case 'web': {
      if (!takesGearHold(mob)) return;
      const frames = durationFrames ?? GEAR_WEB_FRAMES;
      mob.root(frames, GEAR_WEB_ROOT_SOURCE);
      // The stuck status carries no hold on a mob; it is there for its web picture.
      mob.applyStatus(makeStuck(FULL_SHARE, frames));
      return;
    }
    case 'ink':
      mob.applyStatus(makeInk(durationFrames ?? GEAR_INK_FRAMES));
      return;
  }
}

function applyHitStatus(
  ctx: GearHookContext,
  trait: GearTraitOf<'onHitStatus'>,
  hit: GearHit,
): void {
  if (Math.random() >= trait.chance) return;
  landGearStatus(ctx.wearer, hit.mob, trait.status, trait.durationFrames);
}

function centreOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

/** Heals `wearer` by `amount`, never past full and never off the floor. */
function healWearer(wearer: Player, amount: number): void {
  if (!wearer.isAlive || amount <= 0) return;
  wearer.hp = Math.min(wearer.maxHp, wearer.hp + amount);
}

/** Least damage a gear-thrown strike deals, so a weak blow's share never rounds to nothing. */
export const MIN_GEAR_STRIKE_DAMAGE = 1;

/**
 * Wounds `mob` in `dealer`'s name for a share of a blow she has already
 * landed. It runs no procs of its own, so one gear strike can never chain into
 * another. The share was taken of a blow her stat and her proficiency skills
 * had already sized, so neither is counted again: it is untagged and grows
 * with no stat.
 */
function gearStrike(dealer: CrawlerDealer, mob: Mob, damage: number): void {
  const strike = resolveCrawlerHit({
    dealer,
    delivery: 'unscaled',
    blow: Math.max(MIN_GEAR_STRIKE_DAMAGE, Math.round(damage)),
    tags: UNTAGGED_HIT,
    training: hitTrainingOn(mob),
    damageType: 'melee',
    struckBy: 'unguardable',
  });
  mob.takeHit(strike);
}

/** Stuns every enemy within `radiusPx` of a point that a gear hold can take, and shows the ring. */
function stunAround(
  wearer: Player,
  world: GearWorld,
  x: number,
  y: number,
  radiusPx: number,
  stunFrames: number,
  source: 'comboStun' | 'flinchNova',
): void {
  for (const mob of world.enemiesNear(x, y, radiusPx)) {
    if (takesGearHold(mob)) mob.applyStatus(makeStun(stunFrames));
  }
  wearer.gear.live.queueFx({ kind: 'shockwave', x, y, radiusPx, source });
}

/** The unit direction from `wearer` back toward where `shot` comes from, or null when it has none. */
function incomingFrom(wearer: Player, shot: IncomingShot): { x: number; y: number } | null {
  if (shot.kind === 'striker') return towardShooter(wearer, shot.from);
  const speed = Math.hypot(shot.velocityX, shot.velocityY);
  return speed === 0 ? null : { x: -shot.velocityX / speed, y: -shot.velocityY / speed };
}

function towardShooter(
  wearer: Player,
  from: { readonly x: number; readonly y: number },
): { x: number; y: number } | null {
  const at = centreOf(wearer);
  const shooter = centreOf(from);
  const dx = shooter.x - at.x;
  const dy = shooter.y - at.y;
  const distance = Math.hypot(dx, dy);
  return distance === 0 ? null : { x: dx / distance, y: dy / distance };
}

const DEGREES_PER_HALF_TURN = 180;

/** Whether `direction` lies within an arc `arcDegrees` wide centred on where `wearer` faces. */
function withinFacingArc(
  wearer: Player,
  direction: { readonly x: number; readonly y: number },
  arcDegrees: number,
): boolean {
  const facingLength = Math.hypot(wearer.facingX, wearer.facingY);
  if (facingLength === 0) return false;
  const along = (direction.x * wearer.facingX + direction.y * wearer.facingY) / facingLength;
  const halfArc = ((arcDegrees / 2) * Math.PI) / DEGREES_PER_HALF_TURN;
  return along >= Math.cos(halfArc);
}

/** The regen modifier keys gear sets on a wearer, cleared and re-set by `GearSystem` each tick. */
export const STILLNESS_REGEN_KEY = 'gear_stillness' as const satisfies RegenModifierKey;
export const PARTNER_LINK_REGEN_KEY = 'gear_partner_link' as const satisfies RegenModifierKey;
/** Every regen modifier key gear owns. */
export const GEAR_REGEN_KEYS = [STILLNESS_REGEN_KEY, PARTNER_LINK_REGEN_KEY] as const;

/**
 * Health a partner link adds per point of its bonus. One health is one max HP,
 * so like every gear health bonus it counts twice what it adds to other stats.
 */
export const PARTNER_LINK_HEALTH_PER_POINT = 2;

/** A partner's shield when the other crawler goes down, as a share of the wearer's own max HP. */
const PARTNER_SHIELD_MAX_HP_SHARE = 0.25;

/** Whether `crawler` is down: out of HP, or knocked out waiting on a revive. */
function isDown(crawler: Player): boolean {
  return !crawler.isAlive || crawler.isKnockedOut;
}

/** Narrows how far away enemies notice `crawler` this tick; the narrowest hush wins. */
function hushNotice(crawler: Player, noticeShare: number): void {
  const live = crawler.gear.live;
  live.noticeRangeShare = Math.min(live.noticeRangeShare, noticeShare);
}

function abilityName(ability: AbilityId): string {
  return ABILITY_DEFS[ability].name;
}

/** How long `relic` takes to recharge on `wearer`, after any magic that shortens it. */
function relicRechargeFrames(wearer: Player, relic: Extract<GearTrait, { kind: 'relic' }>): number {
  if (!relic.rechargeScalesWithMagic) return relic.cooldownFrames;
  return Math.round(relic.cooldownFrames * magicRechargeScale(wearer.magic));
}

/** The relic's own recharge, read without the persisted record ever holding `undefined` as a value. */
function relicCooldown(state: GearItemState): number {
  return state.cooldownFrames.relic ?? 0;
}

const GEAR_TRAIT_HANDLERS: { readonly [K in GearTraitKind]: TraitHandler<GearTraitOf<K>> } = {
  onHitStatus: {
    describe: (t) => {
      const target = t.on === 'any' ? 'Hits and spells' : 'Melee hits';
      return `${target}: ${percent(t.chance)}% chance to ${STATUS_LABELS[t.status]}`;
    },
    score: (t) => t.chance * SCORE_PER_PROC_CHANCE,
    onMeleeHit: applyHitStatus,
    onSpellHit: (ctx, t, hit) => {
      if (t.on === 'any') applyHitStatus(ctx, t, hit);
    },
  },
  chainSpark: {
    describe: (t) =>
      `Hits arc to ${t.targets} more enemies within ${t.rangeTiles} tiles for ${percent(t.damageShare)}% damage`,
    score: (t) => t.targets * t.damageShare * SCORE_PER_SHARE,
    onMeleeHit: (ctx, t, hit) => {
      if (hit.world === null) return;
      const from = centreOf(hit.mob);
      const reach = t.rangeTiles * TILE_SIZE;
      let arcs = 0;
      for (const mob of hit.world.enemiesNear(from.x, from.y, reach)) {
        if (arcs >= t.targets) break;
        if (mob === hit.mob) continue;
        const to = centreOf(mob);
        gearStrike(hit.dealer, mob, hit.damage * t.damageShare);
        ctx.wearer.gear.live.queueFx({
          kind: 'chainArc',
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
        });
        arcs++;
      }
    },
  },
  lifesteal: {
    describe: (t) => `Heals ${percent(t.share)}% of damage dealt`,
    score: (t) => t.share * SCORE_PER_SHARE * SCORE_PER_MULTIPLIER_STEP,
    onMeleeHit: (ctx, t, hit) => healWearer(ctx.wearer, Math.round(hit.damage * t.share)),
    onSpellHit: (ctx, t, hit) => healWearer(ctx.wearer, Math.round(hit.damage * t.share)),
  },
  onKillHeal: {
    describe: (t) => `Each kill heals ${percent(t.maxHpShare)}% max HP`,
    score: (t) => t.maxHpShare * SCORE_PER_SHARE * SCORE_PER_MULTIPLIER_STEP,
    onKill: (ctx, t) => healWearer(ctx.wearer, Math.round(ctx.wearer.maxHp * t.maxHpShare)),
  },
  coinBonus: {
    describe: (t) => `+${percent(t.share)}% coins from kills and chests`,
    score: (t) => t.share * SCORE_PER_SHARE,
    modifiers: (t) => ({ coinBonusShare: t.share }),
  },
  dodgeChance: {
    describe: (t) => `+${percent(t.chance)}% dodge chance`,
    score: (t) => t.chance * SCORE_PER_SHARE * SCORE_PER_MULTIPLIER_STEP,
    modifiers: (t) => ({ dodgeChance: t.chance }),
  },
  thorns: {
    describe: (t) => `Reflects ${percent(t.share)}% of melee damage`,
    score: (t) => t.share * SCORE_PER_SHARE,
    modifiers: (t) => ({ thornsShare: t.share }),
  },
  riposte: {
    describe: (t) =>
      `After a melee hit lands on you, your next blow within ${seconds(t.windowFrames)}s deals ×${t.multiplier}`,
    score: (t) => (t.multiplier - 1) * SCORE_PER_MULTIPLIER_STEP,
    onStruck: (ctx, t) => {
      const live = ctx.wearer.gear.live;
      live.riposteFrames = Math.max(live.riposteFrames, t.windowFrames);
    },
    strikeMultiplier: (ctx, t, strike) => {
      const live = ctx.wearer.gear.live;
      if (strike.delivery !== 'melee' || live.riposteFrames <= 0) return 1;
      live.riposteFrames = 0;
      return t.multiplier;
    },
  },
  combo: {
    describe: (t) =>
      `Every ${t.hits}th hit in a row stuns and sends out a ${t.shockwaveTiles}-tile shockwave`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    onMeleeHit: (ctx, t, hit) => {
      const live = ctx.wearer.gear.live;
      live.comboTarget = t.hits;
      if (live.comboWindowFrames <= 0) live.comboHits = 0;
      live.comboHits++;
      live.comboWindowFrames = t.windowFrames;
      if (live.comboHits < t.hits) return;
      live.comboHits = 0;
      if (takesGearHold(hit.mob)) hit.mob.applyStatus(makeStun(t.stunFrames));
      if (hit.world === null) return;
      const at = centreOf(hit.mob);
      stunAround(
        ctx.wearer,
        hit.world,
        at.x,
        at.y,
        t.shockwaveTiles * TILE_SIZE,
        t.stunFrames,
        'comboStun',
      );
    },
    onTick: (ctx, _t, tick) => {
      const live = ctx.wearer.gear.live;
      live.comboWindowFrames = Math.max(0, live.comboWindowFrames - tick.dtFrames);
      if (live.comboWindowFrames === 0) live.comboHits = 0;
    },
  },
  stillnessRegen: {
    describe: (t) => `Standing still ${seconds(t.afterFrames)}s: HP regen ×${t.multiplier}`,
    score: (t) => (t.multiplier - 1) * SCORE_PER_MULTIPLIER_STEP,
    onTick: (ctx, t) => {
      const live = ctx.wearer.gear.live;
      if (live.stillFrames < t.afterFrames || !ctx.wearer.isAlive) return;
      live.stillnessRegenActive = true;
      ctx.wearer.setRegenModifier(STILLNESS_REGEN_KEY, t.multiplier);
    },
  },
  unseenStrike: {
    describe: (t) => `×${t.multiplier} damage on enemies that have not noticed you`,
    score: (t) => (t.multiplier - 1) * SCORE_PER_MULTIPLIER_STEP,
    strikeMultiplier: (ctx, t, strike) => (strike.mob.hasNoticed(ctx.wearer) ? 1 : t.multiplier),
  },
  quietPaws: {
    describe: (t) =>
      `Enemies notice you, and your partner within ${t.partnerRangeTiles} tiles, only at ${percent(t.noticeShare)}% of their range`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    onTick: (ctx, t, tick) => {
      const { wearer } = ctx;
      if (isDown(wearer)) return;
      hushNotice(wearer, t.noticeShare);
      const partner = tick.partner;
      if (partner === null || isDown(partner)) return;
      const apart = Math.hypot(partner.x - wearer.x, partner.y - wearer.y);
      if (apart <= t.partnerRangeTiles * TILE_SIZE) hushNotice(partner, t.noticeShare);
    },
  },
  vanishOnKill: {
    describe: (t) => `A kill hides you from enemies for ${seconds(t.durationFrames)}s`,
    score: () => SCORE_FLAT_MECHANIC,
    onKill: (ctx, t) => {
      const live = ctx.wearer.gear.live;
      live.vanishFrames = Math.max(live.vanishFrames, t.durationFrames);
    },
  },
  lastStand: {
    describe: (t) =>
      `Below ${percent(t.hpShare)}% HP, the world slows for ${seconds(t.durationFrames)}s (every ${seconds(t.cooldownFrames)}s)`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    afterHurt: (ctx, t, damageTaken) => {
      const { wearer, state } = ctx;
      const hpAfter = wearer.hp - damageTaken;
      const recharging = (state.cooldownFrames.lastStand ?? 0) > 0;
      if (recharging || hpAfter <= 0 || hpAfter >= wearer.maxHp * t.hpShare) return;
      wearer.gear.live.lastStandFrames = t.durationFrames;
      state.cooldownFrames.lastStand = t.cooldownFrames;
    },
    onTick: (ctx, _t, tick) => {
      const left = ctx.state.cooldownFrames.lastStand;
      if (left === undefined) return;
      const next = left - tick.dtFrames;
      if (next > 0) ctx.state.cooldownFrames.lastStand = next;
      else delete ctx.state.cooldownFrames.lastStand;
    },
  },
  ninthLife: {
    describe: (t) => `Once per floor, a downing blow leaves you at ${percent(t.hpShare)}% HP`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    onHurt: (ctx, t, hurt) => {
      const { wearer, state } = ctx;
      if (hurt.damage < wearer.hp || state.floorOnceSpent.includes('ninthLife')) {
        return hurt.damage;
      }
      state.floorOnceSpent.push('ninthLife');
      wearer.gear.live.queueFx({ kind: 'lifeSaved' });
      const leftAt = Math.max(1, Math.round(wearer.maxHp * t.hpShare));
      // Already lower than the share it saves her at: the save lifts her to it.
      if (wearer.hp < leftAt) {
        wearer.hp = leftAt;
        return 0;
      }
      return wearer.hp - leftAt;
    },
  },
  partnerLink: {
    describe: (t) =>
      `Within ${t.rangeTiles} tiles of the partner piece: regen ×${t.regenMultiplier} and +${t.statBonus} to all stats (+${t.statBonus * PARTNER_LINK_HEALTH_PER_POINT} Health)`,
    score: (t) => t.statBonus * SCORE_PER_MULTIPLIER_STEP,
    onTick: (ctx, t, tick) => {
      const { wearer } = ctx;
      const partner = tick.partner;
      const live = wearer.gear.live;
      if (partner?.inventory.equipment.isEquipped(t.partner) !== true) {
        live.partnerWasDown = false;
        return;
      }
      const partnerDown = isDown(partner);
      if (partnerDown && !live.partnerWasDown && !isDown(wearer)) {
        wearer.applyStatus(
          makeShield(Math.round(wearer.maxHp * PARTNER_SHIELD_MAX_HP_SHARE), t.shieldFrames),
        );
      }
      live.partnerWasDown = partnerDown;
      if (partnerDown || isDown(wearer)) return;
      const apart = Math.hypot(partner.x - wearer.x, partner.y - wearer.y);
      if (apart > t.rangeTiles * TILE_SIZE) return;
      live.partnerLinked = true;
      live.partnerLinkStatBonus = Math.max(live.partnerLinkStatBonus, t.statBonus);
      wearer.setRegenModifier(PARTNER_LINK_REGEN_KEY, t.regenMultiplier);
    },
  },
  flinchNova: {
    describe: (t) =>
      `Hits: ${percent(t.chance)}% chance enemies within ${t.rangeTiles} tiles flinch`,
    score: (t) => t.chance * SCORE_PER_PROC_CHANCE,
    onMeleeHit: (ctx, t, hit) => {
      if (hit.world === null || Math.random() >= t.chance) return;
      const at = centreOf(ctx.wearer);
      stunAround(
        ctx.wearer,
        hit.world,
        at.x,
        at.y,
        t.rangeTiles * TILE_SIZE,
        t.stunFrames,
        'flinchNova',
      );
    },
  },
  explosiveCraft: {
    describe: (t) => {
      const parts: string[] = [];
      if (t.radiusTiles > 0) parts.push(`+${t.radiusTiles} tile dynamite blast`);
      if (t.refundChance > 0) parts.push(`${percent(t.refundChance)}% chance to keep the stick`);
      return parts.join(', ');
    },
    score: (t) => t.radiusTiles * SCORE_PER_TILE + t.refundChance * SCORE_PER_SHARE,
    modifiers: (t) => ({
      explosiveRadiusTiles: t.radiusTiles,
      explosiveRefundChance: t.refundChance,
    }),
  },
  harvestYield: {
    describe: (t) => `+${t.bonus} wood and stone per harvest`,
    score: (t) => t.bonus * SCORE_PER_YIELD,
    modifiers: (t) => ({ harvestYieldBonus: t.bonus }),
  },
  grantsAbility: {
    describe: (t) => `Grants ${abilityName(t.ability)} while worn`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    // The piece's hotbar slot is what casts the ability (`hotbarAbilityOf`),
    // so putting it on puts it within reach there when a slot is free.
    onEquip: (ctx) => {
      const { inventory } = ctx.wearer;
      const slots = inventory.actionBar.slots;
      if (slots.some((slot) => slot?.id === ctx.itemId)) return;
      const free = slots.findIndex((slot, index) => slot === null && index !== QUEST_SLOT_IDX);
      if (free !== -1) inventory.placeOnHotbar(ctx.itemId, free);
    },
  },
  cursed: {
    describe: (t) =>
      `Cursed: binds until the next safe room; −${percent(t.maxHpPenaltyShare)}% max HP`,
    score: (t) => t.maxHpPenaltyShare * SCORE_PER_CURSE_PENALTY_SHARE,
    onEquip: (ctx) => {
      ctx.state.bound = true;
    },
    modifiers: (t) => ({ maxHpPenaltyShare: t.maxHpPenaltyShare }),
  },
  ricochet: {
    describe: (t) =>
      t.bounces === 1 ? 'Shots bounce to another target' : `Shots bounce ${t.bounces} times`,
    score: (t) => t.bounces * SCORE_FLAT_MECHANIC,
    modifiers: (t) => ({ ricochetBounces: t.bounces }),
  },
  relic: {
    describe: (t) =>
      `${RELIC_LABELS[t.behaviour]} every ${seconds(t.cooldownFrames)}s (${t.rangeTiles} tiles)` +
      (t.rechargeScalesWithMagic ? '; recharges faster with Magic' : ''),
    score: () => SCORE_SIGNATURE_MECHANIC,
    onTick: (ctx, t, tick) => {
      const { wearer, state } = ctx;
      const left = relicCooldown(state) - tick.dtFrames;
      if (left > 0) {
        state.cooldownFrames.relic = left;
        return;
      }
      delete state.cooldownFrames.relic;
      // A ward is armed while recharged and spent by the blow it stops.
      if (t.behaviour === 'ward' || tick.world === null || isDown(wearer)) return;
      // Asleep in a safe room: it neither shoots nor plants where nothing may fight.
      if (wearer.isProtected) return;
      const at = centreOf(wearer);
      const inReach = tick.world.enemiesNear(at.x, at.y, t.rangeTiles * TILE_SIZE);
      if (inReach.length === 0) return;
      const target = inReach[0];
      if (t.behaviour === 'bolt') tick.world.fireRelicBolt(wearer, target, t.status);
      else {
        const spot = centreOf(target);
        tick.world.plantBramble(wearer, spot.x, spot.y);
      }
      state.cooldownFrames.relic = relicRechargeFrames(wearer, t);
    },
    onRangedIncoming: (ctx, t) => {
      if (t.behaviour !== 'ward' || relicCooldown(ctx.state) > 0) return false;
      ctx.state.cooldownFrames.relic = relicRechargeFrames(ctx.wearer, t);
      ctx.wearer.gear.live.queueFx({ kind: 'wardShatter' });
      return true;
    },
  },
  frontalBlock: {
    describe: (t) => `Blocks ${percent(t.chance)}% of shots from the front while not attacking`,
    score: (t) => t.chance * SCORE_PER_PROC_CHANCE,
    onRangedIncoming: (ctx, t, shot) => {
      const { wearer } = ctx;
      if (!wearer.shieldAtTheReady) return false;
      const toShooter = incomingFrom(wearer, shot);
      if (toShooter === null || !withinFacingArc(wearer, toShooter, t.arcDegrees)) return false;
      if (Math.random() >= t.chance) return false;
      wearer.gear.live.queueFx({ kind: 'bucklerBlock', dirX: toShooter.x, dirY: toShooter.y });
      return true;
    },
  },
  fairyTruce: {
    describe: () => "Fairies won't start a fight with you",
    score: () => SCORE_SIGNATURE_MECHANIC,
    modifiers: () => ({ fairyTruce: true }),
  },
  groundHazardWard: {
    describe: (t) => {
      const hazard = GROUND_HAZARD_LABELS[t.hazard];
      if (t.damageShare === 0) return `Immune to ${hazard}`;
      return `${percent(1 - t.damageShare)}% less damage from ${hazard}`;
    },
    score: (t) => (1 - t.damageShare) * SCORE_FLAT_MECHANIC,
    modifiers: (t) => ({ groundHazardShares: groundHazardSharesWith(t.hazard, t.damageShare) }),
  },
  fistFamily: {
    describe: (t) => `Punches land as ${WEAPON_FAMILY_LABELS[t.family].toLowerCase()} blows`,
    score: () => SCORE_FLAT_MECHANIC,
    modifiers: (t) => ({ fistFamily: t.family }),
  },
  missileSplit: {
    describe: (t) => `Missile hits split into ${t.copies} hunting copies`,
    score: (t) => t.copies * SCORE_PER_COPY,
    modifiers: (t) => ({ missileSplitCopies: t.copies }),
  },
  missileSpeed: {
    describe: (t) => `Missiles fly ×${t.multiplier} faster`,
    score: (t) => (t.multiplier - 1) * SCORE_PER_MULTIPLIER_STEP,
    modifiers: (t) => ({ missileSpeedMultiplier: t.multiplier }),
  },
  slashWave: {
    describe: (t) => `Every ${t.everyNth}th swipe throws a ${t.rangeTiles}-tile slash wave`,
    score: () => SCORE_SIGNATURE_MECHANIC,
    onSwing: (ctx, t, swing) => {
      const live = ctx.wearer.gear.live;
      live.swipeCount++;
      if (live.swipeCount < t.everyNth) return;
      live.swipeCount = 0;
      live.queueFx({
        kind: 'slashWave',
        x: swing.originX,
        y: swing.originY,
        dirX: swing.dirX,
        dirY: swing.dirY,
        rangePx: t.rangeTiles * TILE_SIZE,
      });
    },
  },
  awakening: {
    describe: (t) => `Awakens after ${t.kills} kills while worn`,
    score: (t) => t.awakensTo.reduce((total, inner) => total + traitScore(inner), 0),
    onKill: (ctx, t) => {
      const { state } = ctx;
      if (state.awakened) return;
      state.awakeningKills++;
      if (state.awakeningKills < t.kills) return;
      state.awakened = true;
      ctx.wearer.gear.noteChanged();
      ctx.wearer.gear.live.queueFx({ kind: 'awakened' });
    },
  },
};

/** The handler for `kind`, typed to the trait it handles. */
export function traitHandler<K extends GearTraitKind>(kind: K): TraitHandler<GearTraitOf<K>> {
  return GEAR_TRAIT_HANDLERS[kind];
}

export function describeTrait(trait: GearTrait): string {
  return dispatchDescribe(trait.kind, trait);
}

export function traitScore(trait: GearTrait): number {
  return dispatchScore(trait.kind, trait);
}

function dispatchDescribe<K extends GearTraitKind>(kind: K, trait: GearTraitOf<K>): string {
  return traitHandler(kind).describe(trait);
}

function dispatchScore<K extends GearTraitKind>(kind: K, trait: GearTraitOf<K>): number {
  return traitHandler(kind).score(trait);
}
