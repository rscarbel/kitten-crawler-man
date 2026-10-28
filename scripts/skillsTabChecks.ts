/**
 * The rules behind the Skills tab's proficiency cards, checked headless for
 * `verify:menus`: which crawler can learn each skill, what a duplicate book
 * does, where the ceiling is, which hits each skill boosts, and the two harms
 * Pyro's Touch and Demolitionist soften.
 *
 * No damage number is written here. Every expected value is worked out from
 * `proficiencyEffect` and the skill tables, so retuning the curve or the
 * tables never turns this red; only a rule breaking does.
 */

import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import {
  CRAWLER_KINDS,
  getSkillDef,
  isEligible,
  SKILL_IDS,
  usesToNextLevel,
  type CrawlerKind,
} from '../src/core/skills/SkillManager';
import {
  PROFICIENCY_MAX_LEVEL,
  PROFICIENCY_SKILL_IDS,
  PROFICIENCY_SKILL_TAGS,
  proficiencyBoosts,
  proficiencyEffect,
  type ProficiencySkillId,
} from '../src/core/skills/proficiency';
import {
  friendlyBlastDamage,
  outgoingHitDamage,
  proficiencyDamageBonus,
} from '../src/core/combat/outgoingHit';
import type { DamageTag } from '../src/core/combat/damageTags';
import { WEAPON_FAMILY_LABELS, type WeaponFamily } from '../src/core/items/equipment/weapons';
import {
  makeBurn,
  makeCreditedBurn,
  makeMagicBurn,
  STATUS_DEFS,
} from '../src/core/combat/StatusEffect';
import { Rat } from '../src/creatures/Rat';
import { skillBookRefusal } from '../src/systems/skillBookUse';

/** One rule's outcome, for the gate to count and report. */
export interface SkillsTabCheck {
  readonly ok: boolean;
  readonly message: string;
}

/** A level partway up the climb, where every proficiency is worth something. */
const TRAINED_LEVEL = 20;
/** A blow big enough that every level's share of it is at least a point. */
const TEST_BLOW = 1000;
/** A roll that always pays the leftover fraction of a point, and one that never does. */
const ROLL_ALWAYS = (): number => 0;
const ROLL_NEVER = (): number => 1 - Number.EPSILON;
const PERCENT = 100;
/** How far two sums of the same fractions may differ in floating point. */
const FLOAT_TOLERANCE = 1e-9;

const ELEMENT_TAGS = ['magic', 'fire', 'explosion'] as const satisfies readonly DamageTag[];

function isWeaponFamily(value: string): value is WeaponFamily {
  return Object.prototype.hasOwnProperty.call(WEAPON_FAMILY_LABELS, value);
}

const ALL_TAGS: readonly DamageTag[] = [
  ...Object.keys(WEAPON_FAMILY_LABELS).filter(isWeaponFamily),
  ...ELEMENT_TAGS,
];

type Crawler = HumanPlayer | CatPlayer;

/** Frames enough for a status to bite several times. */
const BITE_FRAMES = 600;

/** A rat a crawler can strike forever for nothing, like the bathroom queue. */
class EarnsNothingRat extends Rat {
  override get blowsEarnNothing(): boolean {
    return true;
  }
}

/** Uses `crawler` has banked toward `skill`'s next level. */
function usesToward(crawler: Crawler, skill: ProficiencySkillId): number | undefined {
  return crawler.skills.unlockedStates().find((state) => state.id === skill)?.usesTowardNext;
}

/** Far more health than any number of bites takes, so every bite lands on a living body. */
const STURDY_HP = 1000;

/** Lets `effect` bite `target` for {@link BITE_FRAMES} frames. */
function letBite(target: Rat, effect: Parameters<Rat['applyStatus']>[0]): void {
  target.hp = STURDY_HP;
  target.applyStatus(effect);
  for (let frame = 0; frame < BITE_FRAMES; frame++) target.tickTimers();
}

function makeCrawler(kind: CrawlerKind): Crawler {
  return kind === 'human' ? new HumanPlayer(0, 0, TILE_SIZE) : new CatPlayer(0, 0, TILE_SIZE);
}

/** A crawler who can learn `skill`, the human where both can. */
function learnerOf(skill: ProficiencySkillId): CrawlerKind {
  return isEligible(getSkillDef(skill), 'human') ? 'human' : 'cat';
}

function trainTo(crawler: Crawler, skill: ProficiencySkillId, level: number): void {
  while (crawler.skills.getLevel(skill) < level) crawler.skills.unlockSkill(skill);
}

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < FLOAT_TOLERANCE;
}

export function runSkillsTabChecks(): SkillsTabCheck[] {
  const results: SkillsTabCheck[] = [];
  const check = (ok: boolean, message: string): void => void results.push({ ok, message });

  for (const id of SKILL_IDS) {
    const def = getSkillDef(id);
    const proficiency = PROFICIENCY_SKILL_IDS.some((skill) => skill === id);
    check(
      (def.progression === 'proficiency') === proficiency,
      `${def.name} is ${proficiency ? 'a proficiency' : 'a standard skill'}`,
    );
  }

  for (let level = 1; level <= PROFICIENCY_MAX_LEVEL; level++) {
    const gain = proficiencyEffect(level) - proficiencyEffect(level - 1);
    const previousGain =
      level === 1 ? Infinity : proficiencyEffect(level - 1) - proficiencyEffect(level - 2);
    if (gain <= 0 || gain > previousGain + FLOAT_TOLERANCE) {
      check(false, `level ${level} adds more than level ${level - 1} did, or nothing`);
    }
  }
  check(proficiencyEffect(0) === 0, 'an untrained proficiency is worth nothing');
  check(
    proficiencyEffect(PROFICIENCY_MAX_LEVEL + 1) === proficiencyEffect(PROFICIENCY_MAX_LEVEL),
    'nothing past the ceiling is worth more than the ceiling',
  );

  for (const skill of PROFICIENCY_SKILL_IDS) {
    const def = getSkillDef(skill);

    for (const kind of CRAWLER_KINDS) {
      if (isEligible(def, kind)) continue;
      const outsider = makeCrawler(kind);
      check(
        outsider.skills.unlockSkill(skill) === 'not_eligible' &&
          outsider.skills.getLevel(skill) === 0,
        `the ${kind} cannot learn ${def.name}`,
      );
      check(
        skillBookRefusal(outsider, skill)?.refusalReason === 'wrong_crawler',
        `the ${kind} is refused ${def.name}'s book`,
      );
    }

    const learner = makeCrawler(learnerOf(skill));
    check(learner.skills.unlockSkill(skill) === 'unlocked', `a first ${def.name} book teaches it`);
    check(
      learner.skills.unlockSkill(skill) === 'leveled' && learner.skills.getLevel(skill) === 2,
      `a duplicate ${def.name} book raises it a level`,
    );
    const toNext = usesToNextLevel(def, learner.skills.getLevel(skill));
    for (let use = 0; use < toNext; use++) learner.skills.recordUse(skill);
    check(learner.skills.getLevel(skill) === 3, `${def.name} levels on its own use curve`);

    trainTo(learner, skill, PROFICIENCY_MAX_LEVEL);
    check(
      learner.skills.getLevel(skill) === PROFICIENCY_MAX_LEVEL &&
        learner.skills.unlockSkill(skill) === 'already_max' &&
        !learner.skills.recordUse(skill) &&
        learner.skills.getLevel(skill) === PROFICIENCY_MAX_LEVEL,
      `${def.name} stops at level ${PROFICIENCY_MAX_LEVEL}`,
    );
    check(
      skillBookRefusal(learner, skill)?.refusalReason === 'already_mastered',
      `a mastered ${def.name} refuses its book`,
    );
    check(
      def
        .describeEffect(TRAINED_LEVEL)
        .includes(`${Math.round(proficiencyEffect(TRAINED_LEVEL) * PERCENT)}%`),
      `${def.name}'s card shows its current effect`,
    );

    const trained = makeCrawler(learnerOf(skill));
    trainTo(trained, skill, TRAINED_LEVEL);
    const share = proficiencyEffect(TRAINED_LEVEL);
    for (const tag of ALL_TAGS) {
      const boosted = proficiencyBoosts(skill, [tag]);
      const bonus = proficiencyDamageBonus(trained, [tag]);
      check(
        nearly(bonus, boosted ? share : 0),
        `${def.name} ${boosted ? 'boosts' : 'leaves alone'} a hit tagged ${tag}`,
      );
    }
    const tag = PROFICIENCY_SKILL_TAGS[skill][0];
    const extra = TEST_BLOW * share;
    check(
      outgoingHitDamage(trained, TEST_BLOW, [tag], 'trainsNothing', ROLL_NEVER) ===
        TEST_BLOW + Math.floor(extra) &&
        outgoingHitDamage(trained, TEST_BLOW, [tag], 'trainsNothing', ROLL_ALWAYS) ===
          TEST_BLOW + Math.ceil(extra),
      `a ${tag} hit lands for its share more with ${def.name}`,
    );
    check(
      outgoingHitDamage(trained, TEST_BLOW, [], 'trainsNothing', ROLL_ALWAYS) === TEST_BLOW,
      `an untagged hit is untouched by ${def.name}`,
    );

    const usesBefore = trained.skills.unlockedStates().find((s) => s.id === skill)?.usesTowardNext;
    outgoingHitDamage(trained, TEST_BLOW, [tag], 'trains');
    const usesAfter = trained.skills.unlockedStates().find((s) => s.id === skill)?.usesTowardNext;
    check(
      usesBefore !== undefined && usesAfter === usesBefore + 1,
      `a ${tag} hit counts as a use of ${def.name}`,
    );
  }

  {
    const human = makeCrawler('human');
    trainTo(human, 'swordsmanship', TRAINED_LEVEL);
    trainTo(human, 'pyros_touch', TRAINED_LEVEL);
    check(
      nearly(
        proficiencyDamageBonus(human, ['sword', 'fire']),
        2 * proficiencyEffect(TRAINED_LEVEL),
      ),
      'a flaming sword hit takes Swordsmanship and Pyro’s Touch together',
    );
  }

  {
    const human = new HumanPlayer(0, 0, TILE_SIZE);
    check(human.meleeHitTags().length === 0, 'a bare punch carries no weapon family');
    human.inventory.addItem('iron_knuckle_gauntlet', 1);
    human.inventory.equipment.equipById('iron_knuckle_gauntlet');
    check(
      human.meleeHitTags().includes('gauntlet'),
      'a punch in the Iron Knuckle Gauntlet is a gauntlet hit',
    );
    human.inventory.addItem('dev_plain_sword', 1);
    human.drawWeapon('dev_plain_sword');
    const tags = human.meleeHitTags();
    check(tags.includes('sword') && !tags.includes('gauntlet'), 'a drawn sword hits as a sword');

    const cat = new CatPlayer(0, 0, TILE_SIZE);
    check(cat.meleeHitTags().length === 0, 'a bare paw carries no weapon family');
    cat.inventory.addItem('tin_claw_caps', 1);
    cat.inventory.equipment.equipById('tin_claw_caps');
    check(cat.meleeHitTags().includes('claw'), 'a swipe in worn claws is a claw hit');
  }

  {
    const burnBites = STATUS_DEFS.burn.damageOverTime?.tags ?? [];
    check(burnBites.includes('fire'), 'every bite of a burn is a fire hit');
    const plainTicks = makeBurn().ticksRemaining;
    const untrained = makeCrawler('cat');
    untrained.applyStatus(makeBurn());
    check(
      untrained.statusEffects.find((e) => e.type === 'burn')?.ticksRemaining === plainTicks,
      'a burn runs its full length without Pyro’s Touch',
    );
    const pyro = makeCrawler('cat');
    trainTo(pyro, 'pyros_touch', TRAINED_LEVEL);
    pyro.applyStatus(makeBurn());
    pyro.applyStatus(makeMagicBurn());
    const shortened = Math.ceil(plainTicks * (1 - proficiencyEffect(TRAINED_LEVEL)));
    check(
      pyro.statusEffects.find((e) => e.type === 'burn')?.ticksRemaining === shortened,
      'Pyro’s Touch shortens a burn on its owner by its effect',
    );
    check(
      pyro.statusEffects.find((e) => e.type === 'magic_burn')?.ticksRemaining ===
        makeMagicBurn().ticksRemaining,
      'Pyro’s Touch leaves a magic burn alone',
    );
  }

  {
    const cat = makeCrawler('cat');
    trainTo(cat, 'magic_eye', TRAINED_LEVEL);
    const before = usesToward(cat, 'magic_eye');
    letBite(new Rat(0, 0, TILE_SIZE), makeMagicBurn(cat));
    const afterEarning = usesToward(cat, 'magic_eye');
    check(
      before !== undefined && afterEarning !== undefined && afterEarning > before,
      'every bite of a burn she laid on trains her matching skill',
    );
    letBite(new EarnsNothingRat(0, 0, TILE_SIZE), makeMagicBurn(cat));
    check(
      usesToward(cat, 'magic_eye') === afterEarning,
      'a burn on a body that earns nothing trains nothing',
    );

    const builder = makeCrawler('human');
    trainTo(builder, 'pyros_touch', TRAINED_LEVEL);
    const builderBefore = usesToward(builder, 'pyros_touch');
    const plain = new Rat(0, 0, TILE_SIZE);
    letBite(plain, makeBurn());
    const credited = new Rat(0, 0, TILE_SIZE);
    letBite(credited, makeCreditedBurn(builder));
    check(
      usesToward(builder, 'pyros_touch') === builderBefore &&
        plain.hp < STURDY_HP &&
        plain.hp === credited.hp,
      'a burn a crawler only built the source of neither trains nor boosts her',
    );
  }

  {
    const thrower = makeCrawler('human');
    check(
      friendlyBlastDamage(thrower, TEST_BLOW, ROLL_ALWAYS) === TEST_BLOW,
      'a blast hurts the party in full without Demolitionist',
    );
    trainTo(thrower, 'demolitionist', TRAINED_LEVEL);
    const softened = TEST_BLOW * (1 - proficiencyEffect(TRAINED_LEVEL));
    check(
      friendlyBlastDamage(thrower, TEST_BLOW, ROLL_NEVER) === Math.floor(softened) &&
        friendlyBlastDamage(thrower, TEST_BLOW, ROLL_ALWAYS) === Math.ceil(softened),
      'Demolitionist softens its owner’s blast on the party by its effect',
    );
  }

  return results;
}
