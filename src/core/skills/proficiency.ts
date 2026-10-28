/**
 * The proficiency skills: long-trained skills that each make one kind of hit
 * land harder, or one kind of harm land softer. They share a level ceiling,
 * one effect curve and one slow use curve, so tuning any of the three retunes
 * every proficiency at once.
 */

import type { DamageTag, DamageTags } from '../combat/damageTags';

/** Every proficiency skill, in the order the Skills tab and the books list them. */
export const PROFICIENCY_SKILL_IDS = [
  'swordsmanship',
  'archery',
  'clawmanship',
  'magic_eye',
  'mechanical_fist',
  'blunt_proficiency',
  'pyros_touch',
  'demolitionist',
] as const;

export type ProficiencySkillId = (typeof PROFICIENCY_SKILL_IDS)[number];

/** The level every proficiency skill tops out at. */
export const PROFICIENCY_MAX_LEVEL = 50;

/** What a proficiency skill is worth at {@link PROFICIENCY_MAX_LEVEL}, as a fraction. */
export const PROFICIENCY_EFFECT_CAP = 0.3;

/**
 * Bends the effect curve so the first level is worth about 1% and each level
 * after adds a little less than the one before.
 */
export const PROFICIENCY_CURVE_EXPONENT = 1.68;

/** Uses that take a proficiency skill from level 1 to level 2. */
export const PROFICIENCY_BASE_USES = 20;

/**
 * How steeply the uses each later level needs climb. With the base above, the
 * whole climb to the ceiling is well over a hundred thousand tagged hits: the
 * last levels are a run's work, not a floor's.
 */
export const PROFICIENCY_USES_EXPONENT = 1.5;

/**
 * What a proficiency skill at `level` adds to the hits it boosts, or takes off
 * the harm it softens, as a fraction: 0 untrained, about 0.01 at level 1 and
 * {@link PROFICIENCY_EFFECT_CAP} at the ceiling.
 */
export function proficiencyEffect(level: number): number {
  const clamped = Math.min(PROFICIENCY_MAX_LEVEL, Math.max(0, level));
  const untrainedShare = 1 - clamped / PROFICIENCY_MAX_LEVEL;
  return PROFICIENCY_EFFECT_CAP * (1 - untrainedShare ** PROFICIENCY_CURVE_EXPONENT);
}

/** The hits each proficiency skill boosts: any hit carrying one of its tags. */
export const PROFICIENCY_SKILL_TAGS = {
  swordsmanship: ['sword'],
  archery: ['bow', 'crossbow', 'sling'],
  clawmanship: ['claw'],
  magic_eye: ['magic'],
  mechanical_fist: ['gauntlet'],
  blunt_proficiency: ['blunt', 'staff'],
  pyros_touch: ['fire'],
  demolitionist: ['explosion'],
} as const satisfies Record<ProficiencySkillId, readonly DamageTag[]>;

/** Whether a hit carrying `tags` is one `skill` boosts. */
export function proficiencyBoosts(skill: ProficiencySkillId, tags: DamageTags): boolean {
  const boosted: readonly DamageTag[] = PROFICIENCY_SKILL_TAGS[skill];
  return tags.some((tag) => boosted.includes(tag));
}

/** Pyro's Touch shortens the burns its owner suffers by its effect. */
export const BURN_WARD_SKILL = 'pyros_touch' as const satisfies ProficiencySkillId;

/** Demolitionist softens the harm its owner's own blasts do the party by its effect. */
export const BLAST_WARD_SKILL = 'demolitionist' as const satisfies ProficiencySkillId;

/** How a proficiency's level reads on its Skills card. */
export function proficiencyLevelLabel(level: number): string {
  return `Level ${level} / ${PROFICIENCY_MAX_LEVEL}`;
}
