import type { AbilityDef, AbilityId } from '../core/skills/AbilityManager';
import { MAGIC_MISSILE_DEF } from './magicMissile';
import { DEINONYCHUS_DEF } from './deinonychus';
import { ENERGY_SHIELD_DEF } from './energyShield';
import { SEISMIC_STOMP_DEF } from './seismicStomp';

/** Every ability's definition, by id: what a scene registers, and where its name is read. */
export const ABILITY_DEFS: Readonly<Record<AbilityId, AbilityDef>> = {
  magic_missile: MAGIC_MISSILE_DEF,
  energy_shield: ENERGY_SHIELD_DEF,
  seismic_stomp: SEISMIC_STOMP_DEF,
  deinonychus: DEINONYCHUS_DEF,
};
