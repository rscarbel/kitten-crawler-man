/**
 * The Quiet Needle. The tattooist will put one living mark on a crawler — expensive,
 * permanent, and strictly one per character (`Player.tattooStat`), so the choice
 * of which stat it raises is the whole decision.
 *
 * Pure data + line selection; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { StatName, Player } from '../Player';
import type { SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

const TATTOO_PRICE = 100;
/** Stat points a tattoo grants. Small, but it never goes away. */
const TATTOO_STAT_POINTS = 1;

/**
 * The parlour's one skill mark. Priced well above a stat tattoo because a skill
 * is worth more than a point, and gated on its own marker rather than
 * `tattooStat`: a crawler may carry one stat tattoo *and* one skill tattoo, but
 * never two of either.
 */
const SKILL_TATTOO_KEY = 'brass_gullet';
const SKILL_TATTOO_PRICE = 250;
const SKILL_TATTOO_SKILL: SkillId = 'iron_stomach';

const TATTOO_DESIGNS: ReadonlyArray<{
  key: string;
  label: string;
  desc: string;
  stat: StatName;
}> = [
  {
    key: 'coiled_fist',
    label: 'The Coiled Fist',
    desc: `It flexes when you do. +${TATTOO_STAT_POINTS} Strength`,
    stat: 'strength',
  },
  {
    key: 'iron_ribs',
    label: 'The Iron Ribs',
    desc: `Bands that tighten. +${TATTOO_STAT_POINTS} Constitution`,
    stat: 'constitution',
  },
  {
    key: 'third_eye',
    label: 'The Third Eye',
    desc: `It blinks. Don't watch it. +${TATTOO_STAT_POINTS} Intelligence`,
    stat: 'intelligence',
  },
  {
    key: 'quick_serpent',
    label: 'The Quick Serpent',
    desc: `It strikes before you flinch. +${TATTOO_STAT_POINTS} Dexterity`,
    stat: 'dexterity',
  },
];

/** The skill-tattoo row, with its availability resolved for `player`. */
function buildSkillTattooOption(player: Player): PricedOption {
  const def = getSkillDef(SKILL_TATTOO_SKILL);
  const option: PricedOption = {
    key: SKILL_TATTOO_KEY,
    label: 'The Brass Gullet',
    price: SKILL_TATTOO_PRICE,
    desc: `A throat inked in beaten brass. Teaches ${def.name}.`,
  };
  if (player.skillTattoo !== null) {
    option.unavailable = 'Already marked';
  } else if (player.skills.previewUnlock(SKILL_TATTOO_SKILL) === 'already_max') {
    option.unavailable = 'Mastered';
  }
  return option;
}

const TATTOOIST_BARKS: ReadonlyArray<string> = [
  'Quiet shop, quiet needle. The screaming is the crawler’s part, not mine.',
  'One mark per skin. Choose like you mean it — I don’t do cover-ups and the ink won’t sit twice.',
  'Pigment’s ground, needle’s hot. What are we putting on you?',
];

/** The tattooist's greeting, rotated by how many times the player has talked to them. */
function tattooistBark(turn: number): string {
  return rotateLine(TATTOOIST_BARKS, turn);
}

/**
 * The tattoo menu for `player`.
 *
 * The stat rows all disable together once they carry a stat mark; the Brass
 * Gullet is gated separately on {@link Player.skillTattoo}, so one of each can
 * coexist.
 *
 * `host` names the resident behind the needle when the room has one, so the
 * greeting is theirs rather than the generic tattooist's.
 */
export function buildTattooMenu(
  player: Player,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const existing = player.tattooStat;
  return {
    title: 'The Quiet Needle',
    bark: host?.line ?? tattooistBark(turn),
    byline: host?.name,
    options: TATTOO_DESIGNS.map((design) => {
      const option: PricedOption = {
        key: design.key,
        label: design.label,
        price: TATTOO_PRICE,
        desc: design.desc,
      };
      if (existing !== null) {
        option.unavailable = existing === design.stat ? 'Yours' : 'Already inked';
      }
      return option;
    }).concat(buildSkillTattooOption(player)),
  };
}

/** Ink the chosen design onto the buyer and return the tattooist's line. */
export const inkTattoo: PricedPurchaseHandler = (option, buyer) => {
  if (option.key === SKILL_TATTOO_KEY) {
    if (buyer.skillTattoo !== null) {
      return { ok: false, line: 'One mark of that kind per skin. You have yours.' };
    }
    buyer.skills.unlockSkill(SKILL_TATTOO_SKILL);
    buyer.skillTattoo = SKILL_TATTOO_SKILL;
    return {
      ok: true,
      line: 'Swallow. There — it settles in the gullet. Try not to test it today.',
    };
  }
  const design = TATTOO_DESIGNS.find((d) => d.key === option.key);
  if (design === undefined) return { ok: false, line: 'The tattooist frowns at the design.' };
  buyer.applyPermanentStat(design.stat, TATTOO_STAT_POINTS);
  buyer.tattooStat = design.stat;
  return { ok: true, line: `${option.label} is yours. It’s already moving.` };
};
