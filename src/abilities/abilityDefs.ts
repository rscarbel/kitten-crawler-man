import type { AbilityDef, AbilityId } from '../core/skills/AbilityManager';
import { MAGIC_MISSILE_DEF } from './magicMissile';
import { MONGO_DEF } from './mongo';
import { PROTECTIVE_SHELL_DEF } from './protectiveShell';
import { SMUSH_DEF } from './smush';

/** Every ability's definition, by id: what a scene registers, and where its name is read. */
export const ABILITY_DEFS: Readonly<Record<AbilityId, AbilityDef>> = {
  magic_missile: MAGIC_MISSILE_DEF,
  protective_shell: PROTECTIVE_SHELL_DEF,
  smush: SMUSH_DEF,
  mongo: MONGO_DEF,
};
