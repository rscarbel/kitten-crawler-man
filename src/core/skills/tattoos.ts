/**
 * The Quiet Needle's marks: which ones exist and how each one behaves. Pure data,
 * so `Player` and the combat code can read a mark's tuning without reaching into
 * the parlour's shop code.
 */

import type { SkillId } from './SkillManager';
import { WORLD_TICKS_PER_SECOND } from '../constants';

export const STAT_TATTOO_IDS = ['coiled_fist', 'iron_ribs', 'third_eye', 'quick_serpent'] as const;

export type StatTattooId = (typeof STAT_TATTOO_IDS)[number];

export function isStatTattooId(value: unknown): value is StatTattooId {
  return STAT_TATTOO_IDS.some((id) => id === value);
}

/** The skill the parlour's brass mark teaches. */
export const BRASS_GULLET_SKILL = 'iron_stomach' as const satisfies SkillId;

/** Landed melee blows in a row it takes the Coiled Fist to uncoil. */
export const COILED_FIST_BLOWS_TO_UNCOIL = 5;
/** The uncoiled extra strike, as a share of a basic strike. */
export const COILED_FIST_UNCOIL_DAMAGE_SHARE = 0.75;
const COILED_FIST_STREAK_RESET_SECONDS = 3;
/** How long the Coiled Fist's streak survives without a landed blow. */
export const COILED_FIST_STREAK_RESET_FRAMES =
  COILED_FIST_STREAK_RESET_SECONDS * WORLD_TICKS_PER_SECOND;

/** Share of max HP a single blow may deal before the Iron Ribs brace against the rest. */
export const IRON_RIBS_BRACE_THRESHOLD_SHARE = 0.2;
/** How much of a blow's excess over the brace threshold still lands. */
export const IRON_RIBS_EXCESS_KEPT_SHARE = 0.5;

const THIRD_EYE_FORESIGHT_COOLDOWN_SECONDS = 20;
const MS_PER_SECOND = 1000;
/** Wall-clock milliseconds between two of the Third Eye's foreseen dodges. */
export const THIRD_EYE_FORESIGHT_COOLDOWN_MS = THIRD_EYE_FORESIGHT_COOLDOWN_SECONDS * MS_PER_SECOND;

const QUICK_SERPENT_PRIMED_SECONDS = 2;
/** How long after a dodge the Quick Serpent's counter-bite stays ready. */
export const QUICK_SERPENT_PRIMED_FRAMES = QUICK_SERPENT_PRIMED_SECONDS * WORLD_TICKS_PER_SECOND;
/** The counter-bite's extra strike, as a share of a basic strike. */
export const QUICK_SERPENT_BITE_DAMAGE_SHARE = 1;
const QUICK_SERPENT_POISON_SECONDS = 10;
/** How long the counter-bite's poison runs, in ticks. */
export const QUICK_SERPENT_POISON_TICKS = QUICK_SERPENT_POISON_SECONDS * WORLD_TICKS_PER_SECOND;

export const UNCOIL_TEXT = 'UNCOIL!';
export const BRACED_TEXT = 'BRACED';
export const FORESEEN_TEXT = 'FORESEEN!';
export const VENOM_TEXT = 'VENOM!';
export const BRASS_BELCH_TEXT = 'BRASS BELCH';

/** Each stat mark's shop name and the line that says what it does. */
export const STAT_TATTOO_DESIGNS: Readonly<Record<StatTattooId, { label: string; desc: string }>> =
  {
    coiled_fist: {
      label: 'The Coiled Fist',
      desc: 'It flexes when you do. Every fifth blow in a row lands a free extra hit.',
    },
    iron_ribs: {
      label: 'The Iron Ribs',
      desc: 'Bands that tighten. Any big blow past a fifth of your health is halved.',
    },
    third_eye: {
      label: 'The Third Eye',
      desc: "It blinks. Don't watch it. Every 20 seconds it sees a blow coming and you sidestep it.",
    },
    quick_serpent: {
      label: 'The Quick Serpent',
      desc: 'It strikes before you flinch. After a dodge, your next blow bites twice and poisons.',
    },
  };

export const BRASS_GULLET_LABEL = 'The Brass Gullet';

/** The Brass Gullet's shop line, given the display name of the skill it teaches. */
export function brassGulletDesc(skillName: string): string {
  return `A throat inked in beaten brass. Teaches ${skillName}. Potions also burn out poison, venom and burns.`;
}
