import { TILE_SIZE } from '../core/constants';
import { awardXp } from '../core/progression/awardXp';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { Deinonychus } from '../creatures/Deinonychus';
import { DEINONYCHUS_ASSIST_XP } from '../abilities/deinonychus';
import { CatPlayer } from '../creatures/CatPlayer';
import { DAMAGE_IMMUNE_LABEL, type Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { EventBus } from '../core/EventBus';
import type { AbilityManager } from '../core/skills/AbilityManager';
import type { SpellSystem } from './SpellSystem';
import { makeMagicBurn, makePoison, makeStun } from '../core/combat/StatusEffect';
import {
  gearModifiers,
  runHitHooks,
  runKillHooks,
  runStrikeHooks,
  runSwingHooks,
} from '../gear/gearHooks';
import type { GearWorld } from '../gear/traits';
import { hitTrainingOn, resolveCrawlerHit, type ResolvedHit } from '../core/combat/outgoingHit';
import { MAGIC_HIT, UNTAGGED_HIT } from '../core/combat/damageTags';
import {
  COILED_FIST_UNCOIL_DAMAGE_SHARE,
  QUICK_SERPENT_BITE_DAMAGE_SHARE,
  QUICK_SERPENT_POISON_TICKS,
  UNCOIL_TEXT,
  VENOM_TEXT,
} from '../core/skills/tattoos';
import { getSeismicStompStats } from '../abilities/seismicStomp';
import { getMagicMissileVisualTier } from '../abilities/magicMissile';
import {
  missileCanStrike,
  missileMayHitMob,
  missileStrikesScenery,
} from '../abilities/kaleidoscopeSpecs';
import type { ExplosionVariant } from '../sprites/art/magicMissileArt';
import type { MagicMissileImpactEffectSystem } from './MagicMissileImpactEffectSystem';
import type { MeleeImpactEffectSystem } from './MeleeImpactEffectSystem';
import type { SeismicStompEffectSystem } from './SeismicStompEffectSystem';
import type { Missile } from '../sprites/catSprite';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import type { TownInteriorPropDestructionSystem } from './TownInteriorPropDestructionSystem';
import type { TreeSystem } from './TreeSystem';
import {
  POWERFUL_STRIKE_CHANCE_PER_LEVEL,
  POWERFUL_STRIKE_DAMAGE_MULTIPLIER,
} from '../core/skills/SkillManager';
import type { SlingshotRock } from '../sprites/slingshotSprite';
import { SLING_HIT_RADIUS_FRACTION } from '../core/items/equipment/weapons';
import { CLAWS_KEY, type ItemId } from '../core/items/defs/ItemDefs';
import type { MeleeWeaponStats, WeaponProcId } from '../core/items/equipment/weapons';

/** From an entity's tile origin to the centre of its tile. */
const HALF_TILE = TILE_SIZE / 2;
/** Melee hit cone: targets within this range ignore the facing-dot check. */
export const MELEE_POINT_BLANK_RANGE = TILE_SIZE * 1;
/** Fraction of total kill XP awarded to the top damage dealer. */
const XP_TOP_DEALER_FRACTION = 0.85;

/**
 * Minimum share of a kill's XP the lower-levelled crawler is guaranteed, by
 * how many levels separate the two crawlers. A floor, not the dealer share:
 * the top dealer still keeps {@link XP_TOP_DEALER_FRACTION} when that is
 * larger, which it always is, since no floor here reaches it.
 */
const XP_CATCH_UP_LEVEL_GAP_1 = 1;
const XP_CATCH_UP_LEVEL_GAP_2 = 2;
const XP_CATCH_UP_LEVEL_GAP_3 = 3;
const XP_CATCH_UP_FLOOR_GAP_1 = 0.25;
const XP_CATCH_UP_FLOOR_GAP_2 = 0.4;
const XP_CATCH_UP_FLOOR_GAP_3 = 0.5;
const XP_CATCH_UP_FLOOR_GAP_4_PLUS = 0.75;

/** The catch-up floor for a given level gap between the two crawlers (0 at no gap). */
export function xpCatchUpFloorFraction(levelGap: number): number {
  if (levelGap <= 0) return 0;
  if (levelGap === XP_CATCH_UP_LEVEL_GAP_1) return XP_CATCH_UP_FLOOR_GAP_1;
  if (levelGap === XP_CATCH_UP_LEVEL_GAP_2) return XP_CATCH_UP_FLOOR_GAP_2;
  if (levelGap === XP_CATCH_UP_LEVEL_GAP_3) return XP_CATCH_UP_FLOOR_GAP_3;
  return XP_CATCH_UP_FLOOR_GAP_4_PLUS;
}

export interface KillXpSplitInput {
  readonly totalXp: number;
  readonly humanLevel: number;
  readonly catLevel: number;
  /** Which crawler dealt the most credited damage, or null when neither did. */
  readonly topDealer: 'human' | 'cat' | null;
}

export interface KillXpSplit {
  readonly human: number;
  readonly cat: number;
}

/**
 * How one kill's XP splits between the two crawlers. Pure so
 * `scripts/verify-xp-split.ts` can assert every gap and dealer ordering
 * headlessly, against exactly the arithmetic `resolveKills` uses.
 *
 * At equal levels this is today's shipped 85/15 dealer split, unclaimed
 * top-dealer share and all — a non-crawler top dealer (friendly fire, a
 * hireling) leaves the 85% on the table, same as before this feature existed.
 * Once the crawlers' levels differ, the lower-levelled one is guaranteed
 * {@link xpCatchUpFloorFraction} of the kill no matter who gets credit for it,
 * and the other crawler always gets the rest — so a non-crawler top dealer no
 * longer leaves anything unclaimed once there is a gap to close.
 */
export function splitKillXp(input: KillXpSplitInput): KillXpSplit {
  const { totalXp, humanLevel, catLevel, topDealer } = input;
  const levelGap = Math.abs(humanLevel - catLevel);

  if (levelGap === 0) {
    const topXp = Math.max(1, Math.round(totalXp * XP_TOP_DEALER_FRACTION));
    const shareXp = Math.max(1, totalXp - topXp);
    if (topDealer === 'human') return { human: topXp, cat: shareXp };
    if (topDealer === 'cat') return { human: shareXp, cat: topXp };
    return { human: shareXp, cat: 0 };
  }

  const lowerLevelled: 'human' | 'cat' = humanLevel <= catLevel ? 'human' : 'cat';
  const floorFraction = xpCatchUpFloorFraction(levelGap);
  const lowerFraction =
    topDealer === lowerLevelled ? Math.max(floorFraction, XP_TOP_DEALER_FRACTION) : floorFraction;
  // The lower-levelled crawler is the one catching up, so on a kill too small
  // to split it takes the lone point; the higher one gets exactly the rest.
  const lowerXp = Math.min(totalXp, Math.max(1, Math.round(totalXp * lowerFraction)));
  const higherXp = totalXp - lowerXp;
  return lowerLevelled === 'human'
    ? { human: lowerXp, cat: higherXp }
    : { human: higherXp, cat: lowerXp };
}
/** Minimum missile level to trigger AoE splash damage. */
const MISSILE_SPLASH_LEVEL = 5;
/** Splash damage as a fraction of direct missile damage. */
const MISSILE_SPLASH_DAMAGE_FRACTION = 0.4;
/** Least a splash deals, so a weak missile's share never rounds to nothing. */
const MISSILE_SPLASH_MIN_DAMAGE = 1;

/**
 * How far the level-5 splash reaches from the point of impact, in tiles.
 *
 * Exported because the explosion art is drawn against it: a blast painted wider
 * than this promises damage it does not deal, and one painted much narrower
 * hides damage it does. `scripts/gates-magic-missile.ts` measures the painted
 * reach against this number.
 */
export const MISSILE_SPLASH_RADIUS_TILES = 1.5;
/** Minimum missile level to spawn sub-missiles on impact. */
const MISSILE_SUB_MISSILE_LEVEL = 10;
/** Minimum missile level to slow bosses. */
const MISSILE_SLOW_BOSS_LEVEL = 15;
/** Shockwave radius in tiles for level-15 missile kill. */
const MISSILE_SHOCKWAVE_RADIUS_TILES = 5;
/** Minimum shield level for chain lightning to trigger on kill. */
const ENERGY_SHIELD_CHAIN_LIGHTNING_LEVEL = 15;
/** Missile collision hit radius as a fraction of TILE_SIZE. */
const MISSILE_HIT_RADIUS_FRACTION = 0.7;

/**
 * How much further than an ordinary mob's a missile meets `mob`: it detonates
 * on the drawn body, so a body wider than its own tile is struck at its edge
 * rather than only near its centre.
 */
function bodyBeyondOwnTile(mob: Mob): number {
  return mob.bodyRadiusPx - TILE_SIZE / 2;
}

/**
 * The widest {@link bodyBeyondOwnTile} among `mobs`, so the grid query around
 * a missile reaches a wide body whose position — its tile's corner — sits
 * further off than an ordinary mob's would.
 */
function widestBodyBeyondOwnTileOf(mobs: readonly Mob[]): number {
  let widest = 0;
  for (const mob of mobs) widest = Math.max(widest, bodyBeyondOwnTile(mob));
  return widest;
}
/** Boss stun duration in frames when seismic stomp lands in the inner blast zone. */
const SEISMIC_STOMP_BOSS_STUN_FRAMES = 150;
/** Seismic Stomp heal-on-hit chance (10th-level+). */
const SEISMIC_STOMP_HEAL_CHANCE = 0.2;
/** Seismic Stomp heal fraction of total damage dealt. */
const SEISMIC_STOMP_HEAL_FRACTION = 0.5;
/** Stun duration in frames for seismic stomp non-boss stun. */
const SEISMIC_STOMP_STUN_FRAMES = 150;
/** Least a stomp deals anything it reaches, however far out in the ring. */
const SEISMIC_STOMP_MIN_DAMAGE = 1;
/** The multiple a strike lands at when nothing scales it: no weapon, gear or ring. */
const UNSCALED_STRIKE = 1;
/** Shown over a creature the stomp passes under. */
export const SEISMIC_STOMP_IMMUNE_LABEL = DAMAGE_IMMUNE_LABEL;

/** Anything a crawler's melee swing can knock down besides mobs, props and trees. */
export interface MeleeStructureTarget {
  /** Resolves the swing against the structures in reach and facing; returns whether one was struck. */
  tryMeleeHit(attacker: Player, rangePx: number): boolean;
}

/** Shared context passed to combat resolution functions. */
export interface CombatContext {
  human: HumanPlayer;
  cat: CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  gameMap: GameMap;
  /** Null in scenes without safe rooms (e.g. building interiors) — attacks always resolve. */
  safeRoom: Pick<SafeRoomSystem, 'isEntityInSafeRoom'> | null;
  bus: EventBus;
  abilityManager: AbilityManager;
  spells: SpellSystem;
  /** Absent in scenes without smashable props (the overworld, building interiors). */
  destructibles?: DestructiblePropSystem;
  /** A building interior's placed-prop breakables (barrels, crates, jars…) — absent everywhere else. */
  interiorProps?: TownInteriorPropDestructionSystem;
  /** Absent everywhere but the overworld, which is the only map that grows trees. */
  trees?: TreeSystem;
  /** Built structures a crawler's swing can reach — in practice, a village fence it flattens. */
  structures?: MeleeStructureTarget;
  /** Absent in scenes that draw no world effects (e.g. building interiors). */
  seismicStompFx?: Pick<SeismicStompEffectSystem, 'spawn'>;
  /** Absent in scenes that draw no world effects (e.g. building interiors). */
  meleeFx?: Pick<MeleeImpactEffectSystem, 'spawn'>;
  /** Absent in scenes that draw no world effects (e.g. building interiors). */
  missileFx?: Pick<MagicMissileImpactEffectSystem, 'spawn'>;
  /**
   * The systems that run each weapon's named proc. Absent where a scene builds
   * its own context; a weapon then swings without its proc.
   */
  weaponProcs?: WeaponProcs;
  /**
   * What worn gear can reach of the scene — enemies round a point, the relics'
   * shots. Absent where a scene builds its own context; gear that needs the
   * world then does nothing beyond the blow itself.
   */
  gearWorld?: GearWorld;
  /** Set to true by resolvePlayerAttacks when any hit connected this frame. */
  hitLanded: boolean;
}

/**
 * The tier a missile's flung sparks and ground dust should match — the same
 * lookup its baked explosion animation uses, so the live debris always reads
 * as the same blast rather than a mismatched colour or size.
 */
function missileExplosionVariant(missile: Missile): ExplosionVariant {
  return missile.isSubMissile ? 'sub_missile' : getMagicMissileVisualTier(missile.abilityLevel);
}

/**
 * What one of this crawler's basic melee strikes deals with `melee` behind
 * it: the same number the swing below lands, the human's Powerful Strike roll
 * included. Shared so anything that strikes "as the crawler would" — a spiked
 * snare — cannot drift from the real blow when the formula is retuned.
 *
 * Rolled per call rather than inside `getMeleeDamage`, which stays
 * deterministic: the companion AI reads it to budget its own damage, and a
 * random doubling would make that estimate flap frame to frame.
 */
export function crawlerMeleeStrikeDamage(
  crawler: HumanPlayer | CatPlayer,
  melee = crawler.melee,
): number {
  if (crawler instanceof CatPlayer) return crawler.getMeleeDamage(melee);
  const damage = crawler.getStrikeDamage(melee);
  const powerfulStrikeChance =
    POWERFUL_STRIKE_CHANCE_PER_LEVEL * crawler.effectiveSkillLevel('powerful_strike');
  const strikeMultiplier =
    Math.random() < powerfulStrikeChance ? POWERFUL_STRIKE_DAMAGE_MULTIPLIER : 1;
  return Math.round(damage * strikeMultiplier);
}

/**
 * The riders a crawler's worn gear puts on a hit that landed on `mob`, melee
 * blow or missile alike: every worn trait's hit hook. Shared by every blow a
 * crawler lands, fist, claw or blade, so a weapon in hand never quietly drops
 * what the gear promises.
 */
export function landGearProcs(
  ctx: Pick<CombatContext, 'gearWorld'>,
  crawler: HumanPlayer | CatPlayer,
  mob: Mob,
  delivery: 'melee' | 'spell',
  damage: number,
): void {
  // A guarded blow never touched the mob, so nothing rides in on it.
  if (delivery === 'melee' && mob.lastBlowWasGuarded) return;
  runHitHooks({ dealer: crawler, mob, delivery, damage, world: ctx.gearWorld ?? null });
}

/**
 * What worn gear multiplies a blow about to land on `mob` by — an armed
 * riposte, a strike on an enemy that never saw her coming. Asked once per
 * blow, before it lands, since landing it is what makes the mob notice, and
 * spending a riposte is part of asking.
 */
function gearStrikeScale(
  crawler: HumanPlayer | CatPlayer,
  mob: Mob,
  delivery: 'melee' | 'spell',
): number {
  return runStrikeHooks(crawler, { mob, delivery });
}

/**
 * One melee strike of `crawler`'s landing on `mob`, `scale` times the blow:
 * the weapon's multiple, the gear's, both, or one for a plain strike.
 */
function meleeStrikeHit(crawler: HumanPlayer | CatPlayer, mob: Mob, scale: number): ResolvedHit {
  return resolveCrawlerHit({
    dealer: crawler,
    delivery: crawler.meleeDelivery,
    blowAt: (melee) => scale * crawlerMeleeStrikeDamage(crawler, melee),
    tags: crawler.meleeHitTags(),
    training: hitTrainingOn(mob),
    damageType: 'melee',
    struckBy: 'dealer',
  });
}

/**
 * Seismic Stomp landing on `mob`, `scale` times a punch: a stomp is the
 * human's foot, not his weapon, so it carries no weapon's tags.
 */
function seismicStompHit(human: HumanPlayer, mob: Mob, scale: number): ResolvedHit {
  return resolveCrawlerHit({
    dealer: human,
    delivery: 'melee',
    blowAt: (melee) =>
      Math.max(SEISMIC_STOMP_MIN_DAMAGE, Math.round(human.getMeleeDamage(melee) * scale)),
    tags: UNTAGGED_HIT,
    training: hitTrainingOn(mob),
    damageType: 'seismic_stomp',
    struckBy: 'dealer',
  });
}

/** One of the cat's missiles, or its splash, landing on `mob` for what `blowAt` makes of her magic. */
function missileHit(cat: CatPlayer, mob: Mob, blowAt: (magic: number) => number): ResolvedHit {
  return resolveCrawlerHit({
    dealer: cat,
    delivery: 'spell',
    blowAt,
    tags: MAGIC_HIT,
    training: hitTrainingOn(mob),
    damageType: 'missile',
    struckBy: 'dealer',
  });
}

/**
 * A free extra strike a tattoo throws in on top of a landed blow. Dealt straight
 * to the mob in the crawler's name, so kill credit and XP are unchanged, and it
 * runs no procs of its own: a bonus hit that could trigger another would chain.
 */
function tattooBonusStrike(crawler: HumanPlayer | CatPlayer, mob: Mob, damageShare: number): void {
  const hit = resolveCrawlerHit({
    dealer: crawler,
    delivery: crawler.meleeDelivery,
    blowAt: (melee) => Math.round(damageShare * crawlerMeleeStrikeDamage(crawler, melee)),
    tags: crawler.meleeHitTags(),
    training: hitTrainingOn(mob),
    damageType: 'melee',
    struckBy: 'dealer',
  });
  mob.takeHit(hit);
}

/**
 * The riders a crawler's Quiet Needle mark puts on a melee blow that landed on
 * `mob`: the Coiled Fist's uncoil and the Quick Serpent's counter-bite. A
 * guarded blow never touched the mob, so it neither builds the streak nor
 * spends the bite.
 */
export function landTattooStrikeProcs(crawler: HumanPlayer | CatPlayer, mob: Mob): void {
  if (mob.lastBlowWasGuarded) return;
  if (crawler.noteLandedBlowForCoiledFist() && mob.isAlive) {
    tattooBonusStrike(crawler, mob, COILED_FIST_UNCOIL_DAMAGE_SHARE);
    crawler.queueFloatingText(UNCOIL_TEXT, 'trigger');
  }
  if (mob.isAlive && crawler.consumeSerpentBite()) {
    tattooBonusStrike(crawler, mob, QUICK_SERPENT_BITE_DAMAGE_SHARE);
    mob.applyStatus(makePoison(crawler, QUICK_SERPENT_POISON_TICKS));
    crawler.queueFloatingText(VENOM_TEXT, 'trigger');
  }
}

/** One swing of a weapon in the human crawler's hand, as the generic strike hands it to the weapon's proc. */
export interface WeaponSwing {
  readonly weaponId: ItemId;
  readonly weapon: MeleeWeaponStats;
  /** His centre, which the swing is measured from. */
  readonly originX: number;
  readonly originY: number;
  /** The unit facing the blow was thrown along. */
  readonly dirX: number;
  readonly dirY: number;
  /**
   * Everything this swing has struck. A proc that strikes more adds to it, so
   * nothing is struck twice by one swing, whatever reaches it first.
   */
  readonly struck: Set<Mob>;
  /** Every enemy the edge cut. */
  readonly cut: readonly Mob[];
  /** The cut enemies whose blows earn something, which are the ones a proc carries on from. */
  readonly earned: readonly Mob[];
}

/** A special effect a weapon's swing carries, run once its edge has landed. */
export interface WeaponProc {
  onStrike(ctx: CombatContext, swing: WeaponSwing): void;
}

/** The system that runs each weapon proc, by the name a weapon's definition gives it. */
export type WeaponProcs = Readonly<Record<WeaponProcId, WeaponProc>>;

/**
 * A weapon's edge, or anything its proc throws in the edge's name, cutting one
 * enemy for the weapon's multiple of a blow. Reports whether the cut earns
 * something: a mob whose blows earn nothing still takes the cut, but no gear
 * proc rides in on it and nothing carries on from it.
 */
export function cutWithWeapon(ctx: CombatContext, mob: Mob, damageMultiplier: number): boolean {
  const { human } = ctx;
  // Read once: the cut itself can flip a phased boss into an immune phase, and
  // the blow that earned its way in still pays out.
  const earnsNothing = mob.blowsEarnNothing;
  const gearScale = earnsNothing ? UNSCALED_STRIKE : gearStrikeScale(human, mob, 'melee');
  const hit = meleeStrikeHit(human, mob, damageMultiplier * gearScale);
  mob.takeHit(hit);
  if (earnsNothing) return false;
  ctx.hitLanded = true;
  landGearProcs(ctx, human, mob, 'melee', hit.damage);
  landTattooStrikeProcs(human, mob);
  return true;
}

/**
 * The one strike every melee weapon in the human crawler's hand swings through: its edge
 * cuts everything in its reach and facing, exactly as a fist would find it,
 * then its proc runs, then it lands on whatever props it reaches.
 *
 * Every target is claimed before any is cut, so which of them the grid happens
 * to list first never decides what a proc can still reach.
 */
function strikeWithWeapon(ctx: CombatContext, weaponId: ItemId, weapon: MeleeWeaponStats): void {
  const { human, mobGrid, gameMap } = ctx;
  const originX = human.x + HALF_TILE;
  const originY = human.y + HALF_TILE;
  const facingLength = Math.hypot(human.strikeFacingX, human.strikeFacingY);
  const dirX = facingLength > 0 ? human.strikeFacingX / facingLength : 1;
  const dirY = facingLength > 0 ? human.strikeFacingY / facingLength : 0;
  const range = human.getMeleeRange();

  const inArc: Mob[] = [];
  // Widened by a tile because the grid keys a mob by its origin while the
  // test measures its centre.
  for (const mob of mobGrid.queryCircle(originX, originY, range + TILE_SIZE)) {
    if (!mob.isAlive || !mob.takesPlayerDamage('melee')) continue;
    const dx = mob.x + HALF_TILE - originX;
    const dy = mob.y + HALF_TILE - originY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist > range) continue;
    const ahead = (dx / dist) * dirX + (dy / dist) * dirY > 0;
    if (dist > MELEE_POINT_BLANK_RANGE && !ahead) continue;
    if (!gameMap.hasLineOfSight(originX, originY, mob.x + HALF_TILE, mob.y + HALF_TILE)) continue;
    inArc.push(mob);
  }

  const struck = new Set<Mob>(inArc);
  const cut = human.zeroDamage ? [] : inArc;
  const earned: Mob[] = [];
  for (const mob of cut) {
    if (cutWithWeapon(ctx, mob, weapon.damageMultiplier)) earned.push(mob);
  }
  const proc = weapon.onStrike === undefined ? undefined : ctx.weaponProcs?.[weapon.onStrike];
  proc?.onStrike(ctx, { weaponId, weapon, originX, originY, dirX, dirY, struck, cut, earned });

  let hit = inArc.length > 0;
  if (!human.zeroDamage) {
    const propDamage = weapon.damageMultiplier * human.getStrikeDamage();
    hit = (ctx.destructibles?.tryMeleeHit(human, range, propDamage) ?? false) || hit;
    hit = (ctx.interiorProps?.tryMeleeHit(human, range, propDamage) ?? false) || hit;
    hit = (ctx.trees?.tryMeleeHit(human, range, propDamage) ?? false) || hit;
    hit = (ctx.structures?.tryMeleeHit(human, range) ?? false) || hit;
  }
  if (hit) {
    const contact = human.strikeContactWorldPosition();
    if (contact !== null) ctx.meleeFx?.spawn(contact.x, contact.y, dirX, dirY);
  }
  if (proc === undefined) ctx.bus.emit('weaponSwing', { weaponId, hit });
}

export function resolvePlayerAttacks(ctx: CombatContext): void {
  const { human, cat, mobGrid, gameMap, safeRoom } = ctx;
  ctx.hitLanded = false;
  const centerOf = (e: { x: number; y: number }) => ({
    x: e.x + HALF_TILE,
    y: e.y + HALF_TILE,
  });
  const inSafeRoom = (entity: HumanPlayer | CatPlayer): boolean =>
    safeRoom?.isEntityInSafeRoom(entity) ?? false;

  const humanSwings = human.isAttackPeak() && !inSafeRoom(human);
  const swungWeapon = human.drawnMeleeWeapon;
  const swungWeaponId = human.mainHandWeaponId;
  if (humanSwings && swungWeapon !== null && swungWeaponId !== null) {
    strikeWithWeapon(ctx, swungWeaponId, swungWeapon);
  } else if (humanSwings) {
    const hc = centerOf(human);
    const range = human.getMeleeRange();
    const damage = human.getMeleeDamage();
    // Widened by a tile because the grid measures a mob's origin while the test
    // below measures its centre: without the slack, reach is a third shorter
    // swinging up or left than it is swinging down or right, and the narrow
    // phase never gets to reject the candidates it was meant to.
    const nearHuman = mobGrid.queryCircle(hc.x, hc.y, range + TILE_SIZE);
    let humanHit = false;
    for (const mob of nearHuman) {
      if (!mob.isAlive || !mob.takesPlayerDamage('melee')) continue;
      const mc = centerOf(mob);
      const dx = mc.x - hc.x;
      const dy = mc.y - hc.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      if (dist > MELEE_POINT_BLANK_RANGE) {
        // The facing the blow was thrown along, not the one input steers now:
        // the hit lands where the fist is drawn.
        const dot = (dx / dist) * human.strikeFacingX + (dy / dist) * human.strikeFacingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
      if (!human.zeroDamage && mob.blowsEarnNothing) {
        mob.takeHit(meleeStrikeHit(human, mob, UNSCALED_STRIKE));
        humanHit = true;
        continue;
      }
      if (!human.zeroDamage) {
        const punch = meleeStrikeHit(human, mob, gearStrikeScale(human, mob, 'melee'));
        mob.takeHit(punch);
        ctx.hitLanded = true;
        humanHit = true;
        landGearProcs(ctx, human, mob, 'melee', punch.damage);
        landTattooStrikeProcs(human, mob);
      }
    }
    // OR-ed in so a swing that connects only with a crate still plays the
    // solid punch cue rather than the whiffed one. Gated on `zeroDamage` for the
    // same reason the mob loop above is: debug tough mode deals no damage to
    // anything, props included.
    if (!human.zeroDamage) {
      humanHit = (ctx.destructibles?.tryMeleeHit(human, range, damage) ?? false) || humanHit;
      humanHit = (ctx.interiorProps?.tryMeleeHit(human, range, damage) ?? false) || humanHit;
      humanHit = (ctx.trees?.tryMeleeHit(human, range, damage) ?? false) || humanHit;
      humanHit = (ctx.structures?.tryMeleeHit(human, range) ?? false) || humanHit;
    }
    // Read off the rig rather than the target: the same dust puff belongs at
    // the fist or foot that threw the blow whatever it happened to connect
    // with, and a swing that lands on several things still throws only one.
    if (humanHit) {
      const contact = human.strikeContactWorldPosition();
      if (contact !== null) {
        ctx.meleeFx?.spawn(contact.x, contact.y, human.strikeFacingX, human.strikeFacingY);
      }
    }
    ctx.bus.emit('humanMeleeSwing', { hit: humanHit });
  }

  if (cat.isAttackPeak() && !inSafeRoom(cat)) {
    const cc = centerOf(cat);
    const range = cat.getMeleeRange();
    const damage = cat.getMeleeDamage();
    runSwingHooks(cat, {
      originX: cc.x,
      originY: cc.y,
      dirX: cat.facingX,
      dirY: cat.facingY,
      reachPx: range,
    });
    const nearCat = mobGrid.queryCircle(cc.x, cc.y, range + TILE_SIZE);
    let catHit = false;
    for (const mob of nearCat) {
      if (!mob.isAlive || !mob.takesPlayerDamage('melee')) continue;
      const mc = centerOf(mob);
      const dx = mc.x - cc.x;
      const dy = mc.y - cc.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      if (dist > MELEE_POINT_BLANK_RANGE) {
        const dot = (dx / dist) * cat.facingX + (dy / dist) * cat.facingY;
        if (dot <= 0.0) continue;
      }
      if (!gameMap.hasLineOfSight(cc.x, cc.y, mc.x, mc.y)) continue;
      if (!cat.zeroDamage && mob.blowsEarnNothing) {
        mob.takeHit(meleeStrikeHit(cat, mob, UNSCALED_STRIKE));
        catHit = true;
        continue;
      }
      if (!cat.zeroDamage) {
        const swipe = meleeStrikeHit(cat, mob, gearStrikeScale(cat, mob, 'melee'));
        mob.takeHit(swipe);
        ctx.hitLanded = true;
        catHit = true;
        landGearProcs(ctx, cat, mob, 'melee', swipe.damage);
        landTattooStrikeProcs(cat, mob);
      }
    }
    if (!cat.zeroDamage) {
      catHit = (ctx.destructibles?.tryMeleeHit(cat, range, damage) ?? false) || catHit;
      catHit = (ctx.interiorProps?.tryMeleeHit(cat, range, damage) ?? false) || catHit;
      catHit = (ctx.trees?.tryMeleeHit(cat, range, damage) ?? false) || catHit;
      catHit = (ctx.structures?.tryMeleeHit(cat, range) ?? false) || catHit;
    }
    const clawsId = cat.inventory.equipment.getEquippedId(CLAWS_KEY) ?? null;
    ctx.bus.emit('catMeleeSwing', { hit: catHit, clawsId });
  }

  // ── Seismic Stomp AoE stomp ──
  if (human.isSeismicStompPeak() && !inSafeRoom(human)) {
    const seismicStompLevel = ctx.abilityManager.getLevel('seismic_stomp');
    const stats = getSeismicStompStats(seismicStompLevel);
    const hc = centerOf(human);
    const innerRadius = stats.innerBlastRadius * TILE_SIZE;
    const outerRadius = stats.outerBlastRadius * TILE_SIZE;

    // Spawned before the damage pass so the shockwave and the hits it explains
    // start on the same frame. Centred on the heel that made it, read off the
    // row being drawn: the damage query still runs off his centre, and every
    // Seismic Stomp row lands its heel within a few pixels of that centre across the
    // tile, but a wave that starts at his waist reads as coming out of his body.
    const stamp = human.seismicStompStampTile();
    ctx.seismicStompFx?.spawn(
      human.x + stamp.x * TILE_SIZE,
      human.y + stamp.y * TILE_SIZE,
      outerRadius,
      stats.isFullPower,
      () => human.seismicStompGrindBeat(),
    );

    let totalSeismicStompDamage = 0;
    /**
     * Whether the stomp reached anything at all, props included — which is what
     * earns its usage XP. Separate from `ctx.hitLanded`, which means "an attack
     * connected with a *mob*": that flag drives the combat-started telemetry,
     * and a stomp that only splintered a crate is not a fight starting.
     */
    let seismicStompConnected = false;
    let seismicStompKills = 0;

    // Query both rings in one pass using the outer radius
    const nearSeismicStomp = mobGrid.queryCircle(hc.x, hc.y, outerRadius + TILE_SIZE);
    for (const mob of nearSeismicStomp) {
      if (!mob.isAlive || !mob.takesPlayerDamage('seismic_stomp')) continue;
      const mc = centerOf(mob);
      const dist = Math.hypot(mc.x - hc.x, mc.y - hc.y);
      if (dist > outerRadius) continue;
      if (mob.evadesSeismicStomp) {
        mob.queueFloatingText(SEISMIC_STOMP_IMMUNE_LABEL, 'immune');
        continue;
      }
      if (!human.zeroDamage && mob.blowsEarnNothing) {
        mob.takeHit(seismicStompHit(human, mob, UNSCALED_STRIKE));
        continue;
      }
      if (!human.zeroDamage) {
        const isInner = dist <= innerRadius;
        const mult = isInner ? stats.damageMultiplier : stats.outerDamageMultiplier;
        const bossMult = mob.isBoss ? stats.bossDamageMultiplier : UNSCALED_STRIKE;
        const stomp = seismicStompHit(human, mob, mult * bossMult);
        // Death resolves synchronously inside `takeHit`, so the health either
        // side of the call is what says whether this stomp did it. The
        // `justDied` flag cannot answer: it stays latched for a whole frame.
        const wasAlive = mob.hp > 0;
        mob.takeHit(stomp);
        if (wasAlive && mob.hp <= 0 && mob.isHostile) seismicStompKills++;
        ctx.hitLanded = true;
        seismicStompConnected = true;
        totalSeismicStompDamage += stomp.damage;

        // Level 5+: stun non-boss enemies
        if (isInner && stats.stunSmallEnemies && !mob.isBoss) {
          mob.applyStatus(makeStun(SEISMIC_STOMP_STUN_FRAMES));
        }
        // Level 14+: stun bosses at 25% chance
        if (
          isInner &&
          stats.stunBossChance > 0 &&
          mob.isBoss &&
          Math.random() < stats.stunBossChance
        ) {
          mob.applyStatus(makeStun(SEISMIC_STOMP_BOSS_STUN_FRAMES));
        }
      }
    }

    // A stomp flattens every breakable in reach outright, crates and trees
    // alike, rather than merely chipping them like a normal hit: no health left
    // to compare between an inner and outer ring, and no wall of crates left
    // standing to shield the ones behind it.
    if (!human.zeroDamage) {
      // Assigned rather than OR-ed on each line so neither call is skipped by
      // short-circuiting: a stomp splinters the crate *and* the sapling.
      if (ctx.destructibles?.smashAllInRadius(human, outerRadius) ?? false) {
        seismicStompConnected = true;
      }
      if (ctx.interiorProps?.smashAllInRadius(human, outerRadius) ?? false) {
        seismicStompConnected = true;
      }
      if (ctx.trees?.smashAllInRadius(human, outerRadius) ?? false) {
        seismicStompConnected = true;
      }
    }

    // Level 10+: 20% chance to heal human for 50% of total damage dealt
    if (
      stats.healOnHit &&
      totalSeismicStompDamage > 0 &&
      Math.random() < SEISMIC_STOMP_HEAL_CHANCE
    ) {
      const healAmt = Math.round(totalSeismicStompDamage * SEISMIC_STOMP_HEAL_FRACTION);
      human.hp = Math.min(human.hp + healAmt, human.maxHp);
    }

    if (seismicStompKills > 0) {
      ctx.bus.emit('multiKill', { killer: human, count: seismicStompKills });
    }

    if (seismicStompConnected) {
      ctx.abilityManager.addUsageXp('seismic_stomp');
    }
  }

  if (!inSafeRoom(cat)) {
    const missileLevel = cat.getMagicMissileLevel();
    const hitRadius = TILE_SIZE * MISSILE_HIT_RADIUS_FRACTION;
    const splashRadius = TILE_SIZE * MISSILE_SPLASH_RADIUS_TILES;

    const missileSplitCopies = gearModifiers(cat).missileSplitCopies;
    const missiles = cat.getMissiles();
    const widestBodyBeyondOwnTile = missiles.length > 0 ? widestBodyBeyondOwnTileOf(ctx.mobs) : 0;
    const missileQueryRadius = hitRadius + TILE_SIZE + widestBodyBeyondOwnTile;

    for (const missile of missiles) {
      if (missile.state !== 'flying' || missile.hit || !missileCanStrike(missile)) continue;
      const damage = cat.getMissileDamage();
      const strikesScenery = missileStrikesScenery(missile);

      // Props are checked before mobs so a missile flying into a crate stack
      // detonates on the wood rather than sailing through it.
      if (
        strikesScenery &&
        !cat.zeroDamage &&
        (ctx.destructibles?.tryProjectileHit(missile.x, missile.y, hitRadius, damage, cat) ?? false)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('missileImpact', { x: missile.x, y: missile.y });
        missile.hit = true;
        missile.state = 'exploding';
        ctx.missileFx?.spawn(missile.x, missile.y, missileExplosionVariant(missile));
        continue;
      }

      // Interior props take the same detonate-on-impact check as dungeon
      // destructibles; the two never coexist on one map, same as trees below.
      if (
        strikesScenery &&
        !cat.zeroDamage &&
        (ctx.interiorProps?.tryProjectileHit(missile.x, missile.y, hitRadius, damage) ?? false)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('missileImpact', { x: missile.x, y: missile.y });
        missile.hit = true;
        missile.state = 'exploding';
        ctx.missileFx?.spawn(missile.x, missile.y, missileExplosionVariant(missile));
        continue;
      }

      // Trees are checked after props purely so the two blocks read in the order
      // they were written; the choice is free, because props exist only on the
      // dungeon floors and trees only on the overworld, so no map ever has both.
      const trees = ctx.trees;
      if (
        strikesScenery &&
        trees !== undefined &&
        !cat.zeroDamage &&
        trees.tryProjectileHit(missile.x, missile.y, hitRadius, damage)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('missileImpact', { x: missile.x, y: missile.y });
        missile.hit = true;
        missile.state = 'exploding';
        ctx.missileFx?.spawn(missile.x, missile.y, missileExplosionVariant(missile));
        // Every missile that connects with a tree sets it alight, including each
        // sub-missile from a burst — `igniteRadius` is a no-op on a tree that is
        // already burning, so a second or third hit on the same trunk costs
        // nothing extra.
        //
        // Ignited by the same radius the hit was resolved with, not by the tile
        // the missile happens to be standing in: a missile detonating on the
        // edge of a tree's tile is inside the neighbouring one, and that
        // neighbour is usually empty grass.
        trees.igniteRadius(missile.x, missile.y, hitRadius);
        continue;
      }

      const nearMissile = mobGrid.queryCircle(missile.x, missile.y, missileQueryRadius);
      for (const mob of nearMissile) {
        // A missile passes clean through anything it cannot hurt rather than
        // detonating on it: an ally who wanders into the line of fire should
        // cost the player nothing at all, not even the shot.
        if (!mob.isAlive || !mob.takesPlayerDamage('missile')) continue;
        if (!missileMayHitMob(missile, mob)) continue;
        const mc = centerOf(mob);
        const dist = Math.hypot(missile.x - mc.x, missile.y - mc.y);
        if (dist < hitRadius + bodyBeyondOwnTile(mob)) {
          if (mob.tryBlockProjectile('missile')) {
            missile.hit = true;
            missile.state = 'exploding';
            ctx.missileFx?.spawn(missile.x, missile.y, missileExplosionVariant(missile));
            break;
          }
          if (!cat.zeroDamage && mob.blowsEarnNothing) {
            mob.takeHit(missileHit(cat, mob, (magic) => cat.getMissileDamage(magic)));
            ctx.bus.emit('missileImpact', { x: missile.x, y: missile.y });
          } else if (!cat.zeroDamage) {
            const gearScale = gearStrikeScale(cat, mob, 'spell');
            const struck = missileHit(cat, mob, (magic) => gearScale * cat.getMissileDamage(magic));
            mob.takeHit(struck);
            ctx.hitLanded = true;
            ctx.bus.emit('missileImpact', { x: missile.x, y: missile.y });

            landGearProcs(ctx, cat, mob, 'spell', struck.damage);

            // Level 5+: AoE magic splash
            if (missileLevel >= MISSILE_SPLASH_LEVEL) {
              const splashBlowAt = (magic: number): number =>
                Math.max(
                  MISSILE_SPLASH_MIN_DAMAGE,
                  Math.round(cat.getMissileDamage(magic) * MISSILE_SPLASH_DAMAGE_FRACTION),
                );
              const nearSplash = mobGrid.queryCircle(
                missile.x,
                missile.y,
                splashRadius + TILE_SIZE,
              );
              for (const splashMob of nearSplash) {
                if (!splashMob.isAlive || splashMob === mob) continue;
                if (!splashMob.takesPlayerDamage('missile')) continue;
                const splashDx = splashMob.x + HALF_TILE - missile.x;
                const splashDy = splashMob.y + HALF_TILE - missile.y;
                if (Math.hypot(splashDx, splashDy) < splashRadius) {
                  splashMob.takeHit(missileHit(cat, splashMob, splashBlowAt));
                }
              }
            }

            const isKaleidoscopeCopy = missile.kaleidoscope !== undefined;
            if (
              missileLevel >= MISSILE_SUB_MISSILE_LEVEL &&
              !missile.isSubMissile &&
              !isKaleidoscopeCopy
            ) {
              cat.queueSubMissileSpawn(missile.x, missile.y);
            }
            if (missileSplitCopies > 0 && !isKaleidoscopeCopy) {
              cat.queueKaleidoscopeCopies(missile, missileSplitCopies);
            }

            // Level 15: slow bosses and grant kill XP tracked separately in resolveKills
            if (missileLevel >= MISSILE_SLOW_BOSS_LEVEL && mob.isBoss) {
              mob.applyHitSlow();
            }
          }

          missile.hit = true;
          missile.state = 'exploding';
          ctx.missileFx?.spawn(missile.x, missile.y, missileExplosionVariant(missile));
          break;
        }
      }
    }
  }

  // ── Slingshot stones ──
  if (!inSafeRoom(human)) {
    const rockHitRadius = TILE_SIZE * SLING_HIT_RADIUS_FRACTION;

    const ricochetBounces = gearModifiers(human).ricochetBounces;
    for (const rock of human.getRocks()) {
      if (rock.state !== 'flying' || rock.hit) continue;
      const damage = human.getSlingshotDamage();

      // Props first, then trees, then mobs — the same order the missiles use, so
      // a stone flying into a crate cracks the wood rather than sailing through
      // it to whatever is stood behind.
      if (
        !human.zeroDamage &&
        (ctx.destructibles?.tryProjectileHit(rock.x, rock.y, rockHitRadius, damage, human) ?? false)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('slingshotImpact', { x: rock.x, y: rock.y });
        rock.hit = true;
        rock.state = 'done';
        continue;
      }

      if (
        !human.zeroDamage &&
        (ctx.interiorProps?.tryProjectileHit(rock.x, rock.y, rockHitRadius, damage) ?? false)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('slingshotImpact', { x: rock.x, y: rock.y });
        rock.hit = true;
        rock.state = 'done';
        continue;
      }

      const rockTrees = ctx.trees;
      if (
        rockTrees !== undefined &&
        !human.zeroDamage &&
        rockTrees.tryProjectileHit(rock.x, rock.y, rockHitRadius, damage)
      ) {
        ctx.hitLanded = true;
        ctx.bus.emit('slingshotImpact', { x: rock.x, y: rock.y });
        rock.hit = true;
        rock.state = 'done';
        continue;
      }

      const nearRock = mobGrid.queryCircle(rock.x, rock.y, rockHitRadius + TILE_SIZE);
      for (const mob of nearRock) {
        // A stone passes clean through anything it cannot hurt, for the same
        // reason a missile does: a shot aimed correctly must not be spent on an
        // ally who wandered into the line.
        if (!mob.isAlive || !mob.takesPlayerDamage('slingshot')) continue;
        if (mob === rock.bouncedOff) continue;
        const mc = centerOf(mob);
        if (Math.hypot(rock.x - mc.x, rock.y - mc.y) >= rockHitRadius) continue;
        if (!human.zeroDamage) {
          const stone = resolveCrawlerHit({
            dealer: human,
            delivery: 'sling',
            blowAt: (ranged) => human.getSlingshotDamage(ranged),
            tags: rock.tags,
            training: hitTrainingOn(mob),
            damageType: 'slingshot',
            struckBy: 'dealer',
          });
          mob.takeHit(stone);
          if (!mob.blowsEarnNothing) ctx.hitLanded = true;
          ctx.bus.emit('slingshotImpact', { x: rock.x, y: rock.y });
        }
        if (rock.bounces < ricochetBounces && bounceRock(rock, mob, mobGrid, gameMap)) break;
        rock.hit = true;
        rock.state = 'done';
        break;
      }
    }
  }
}

/** How far a ricocheting stone looks for its next enemy. */
const RICOCHET_SEEK_TILES = 4;

/**
 * Sends a stone that just struck `struck` on to the nearest other enemy it can
 * see, with a fresh flight of the seek distance. Returns false, leaving the
 * stone spent, when nothing is in reach.
 */
function bounceRock(
  rock: SlingshotRock,
  struck: Mob,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
): boolean {
  const seekPx = RICOCHET_SEEK_TILES * TILE_SIZE;
  let next: Mob | null = null;
  let nearest = Infinity;
  for (const mob of mobGrid.queryCircle(rock.x, rock.y, seekPx + TILE_SIZE)) {
    if (mob === struck || !mob.isHostileTarget || !mob.takesPlayerDamage('slingshot')) continue;
    const dx = mob.x + HALF_TILE - rock.x;
    const dy = mob.y + HALF_TILE - rock.y;
    const dist = Math.hypot(dx, dy);
    if (dist > seekPx || dist >= nearest) continue;
    if (!gameMap.hasLineOfSight(rock.x, rock.y, mob.x + HALF_TILE, mob.y + HALF_TILE)) continue;
    nearest = dist;
    next = mob;
  }
  if (next === null || nearest === 0) return false;
  const speed = Math.hypot(rock.vx, rock.vy);
  rock.vx = ((next.x + HALF_TILE - rock.x) / nearest) * speed;
  rock.vy = ((next.y + HALF_TILE - rock.y) / nearest) * speed;
  rock.distTraveled = 0;
  rock.maxDist = seekPx;
  rock.launchOffsetX = 0;
  rock.launchOffsetY = 0;
  rock.bounces++;
  rock.bouncedOff = struck;
  return true;
}

export function resolveKills(ctx: CombatContext): void {
  const { mobs, human, cat, mobGrid, bus, abilityManager, spells } = ctx;

  // Mobs that leave a body behind stay in the grid past death so their corpse
  // keeps being drawn; they drop out here once it has played out. Runs before
  // this frame's kills so a corpse never renders after it has expired.
  for (const mob of mobs) {
    if (mob.isAlive || !mob.rendersWhenDead) continue;
    if (mob.corpseGone) continue;
    mob.advanceCorpse();
    if (!mob.belongsInMobGrid) mobGrid.remove(mob);
  }

  for (const mob of mobs) {
    if (!mob.justDied) continue;
    mob.justDied = false;
    mob.dispose();
    if (!mob.belongsInMobGrid) mobGrid.remove(mob);

    // Damage is attributed through `xpCreditTarget`, which is the dealer itself
    // for a crawler and the owner for a summon. Deinonychus hits in his own name so
    // that mobs retaliate against *him*; without this mapping his damage would
    // simply drop out of the split and the cat would lose XP for sending him in.
    const creditedDamage = new Map<Player, number>();
    let totalDmg = 0;
    for (const [dealer, dmg] of mob.damageTakenBy) {
      totalDmg += dmg;
      const credited = dealer.xpCreditTarget;
      creditedDamage.set(credited, (creditedDamage.get(credited) ?? 0) + dmg);
    }
    // The XP split, and only the XP split, needs somebody to have dealt damage.
    // The death itself does not: a mob finished by a burn or a poison — or one
    // the game kills outright, like the Trash Gremlin's swarm when it drops — has an
    // empty ledger, and bailing out here would take its gore, its corpse marker
    // and its `mobKilled` event along with the XP it has nobody to give.
    const hasDamageLedger = totalDmg > 0;
    // A kill already paid for once, or a body an enemy conjured, still dies,
    // bleeds and fires `mobKilled`; it just trains and pays nothing.
    const paysRewards = mob.paysRewards;

    // Non-players stay in the running for top dealer without being able to win
    // it: a mob that out-damages both crawlers — through friendly fire, say —
    // leaves the top dealer's share unclaimed rather than handing it to
    // whichever crawler came second, which would reward them for being out-hit.
    let topPlayer: HumanPlayer | CatPlayer | null = null;
    let maxDmg = 0;
    for (const [player, dmg] of creditedDamage) {
      if (dmg > maxDmg) {
        maxDmg = dmg;
        topPlayer = player instanceof HumanPlayer || player instanceof CatPlayer ? player : null;
      }
    }

    if (hasDamageLedger && paysRewards) {
      const topDealer = topPlayer === human ? 'human' : topPlayer === cat ? 'cat' : null;
      const split = splitKillXp({
        totalXp: mob.scaledXpValue,
        humanLevel: human.level,
        catLevel: cat.level,
        topDealer,
      });
      awardXp(human, split.human, bus);
      awardXp(cat, split.cat, bus);
    }

    const killer =
      mob.killedBy instanceof HumanPlayer || mob.killedBy instanceof CatPlayer
        ? mob.killedBy
        : null;
    if (killer !== null && paysRewards) {
      runKillHooks(killer, { mob, world: ctx.gearWorld ?? null });
    }

    // A kill the pet finished feeds the pet's own ability, and the cat keeps the
    // crawler XP through the credit mapping above. A kill he only contributed to
    // pays the smaller assist — see DEINONYCHUS_ASSIST_XP for why contribution has to
    // pay at all.
    if (paysRewards && mob.killedByDealer instanceof Deinonychus) {
      abilityManager.addKillXp('deinonychus');
    } else if (paysRewards) {
      for (const dealer of mob.damageTakenBy.keys()) {
        if (!(dealer instanceof Deinonychus)) continue;
        abilityManager.addXp('deinonychus', DEINONYCHUS_ASSIST_XP);
        break;
      }
    }

    // Pugilism trains on knockouts, not swings — a landed punch is cheap, a
    // finished fight is not.
    if (paysRewards && mob.killType === 'melee' && killer === human) {
      human.skills.recordUse('pugilism');
    }

    // Magic missile kill XP + level-15 death shockwave
    if (mob.killType === 'missile' && killer === cat) {
      if (paysRewards) abilityManager.addKillXp('magic_missile');

      if (cat.getMagicMissileLevel() >= MISSILE_SLOW_BOSS_LEVEL) {
        const shockwaveRadius = TILE_SIZE * MISSILE_SHOCKWAVE_RADIUS_TILES;
        const cx = mob.x + HALF_TILE;
        const cy = mob.y + HALF_TILE;
        // Widened for the same reason the melee queries are: the grid measures a
        // mob's origin and the test below measures its centre, so without the
        // slack the burn field comes up short on one side of the corpse.
        const nearShock = mobGrid.queryCircle(cx, cy, shockwaveRadius + TILE_SIZE);
        for (const nearMob of nearShock) {
          if (!nearMob.isAlive || !nearMob.takesPlayerDamage('missile')) continue;
          const sdx = nearMob.x + HALF_TILE - cx;
          const sdy = nearMob.y + HALF_TILE - cy;
          if (Math.hypot(sdx, sdy) < shockwaveRadius) {
            nearMob.applyStatus(makeMagicBurn(cat));
          }
        }
      }
    }

    // Seismic Stomp kill XP + level 14 double gold
    if (mob.killType === 'seismic_stomp' && killer === human) {
      if (paysRewards) abilityManager.addKillXp('seismic_stomp');
      const seismicStompLevel = abilityManager.getLevel('seismic_stomp');
      if (
        getSeismicStompStats(seismicStompLevel).doubleGoldOnKill &&
        mob.droppedLoot !== null &&
        !mob.droppedLoot.goldDoubled
      ) {
        mob.droppedLoot.coins = Math.round(mob.droppedLoot.coins * 2);
        mob.droppedLoot.goldDoubled = true;
      }
    }

    if (mob.killType === 'energy_shield' && killer === human) {
      if (paysRewards) abilityManager.addKillXp('energy_shield');

      // Level-15 chain lightning: if mob died inside the active shield, queue origin
      if (
        spells.activeEnergyShieldLevel >= ENERGY_SHIELD_CHAIN_LIGHTNING_LEVEL &&
        spells.isInsideEnergyShield(mob.x, mob.y)
      ) {
        spells.addChainLightningOrigin(mob.x + HALF_TILE, mob.y + HALF_TILE);
      }
    }

    bus.emit('mobKilled', {
      mob,
      killer,
      killType: mob.killType,
      topDamageDealer: topPlayer,
    });
  }
}
