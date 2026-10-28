import type { MercenaryTemplate } from '../../core/party/mercenaryTemplates';
import type { MercenaryKit } from './MercenaryKit';
import { ArcherKit } from './archerKit';
import { EARTH_ELEMENTAL_GUARD_CONFIGS, EarthElementalGuardKit } from './earthElementalGuardKit';
import { GolemKit } from './golemKit';
import { MedicKit } from './medicKit';

/** A fresh kit for one hireling. Kits hold per-hireling state, so each needs its own. */
export function createMercenaryKit(template: MercenaryTemplate): MercenaryKit {
  const spec = template.kit;
  switch (spec.id) {
    case 'earth_elemental_guard':
      return new EarthElementalGuardKit(template, EARTH_ELEMENTAL_GUARD_CONFIGS[spec.guard]);
    case 'archer':
      return new ArcherKit(template);
    case 'medic':
      return new MedicKit(template.damage);
    case 'golem':
      return new GolemKit(template.damage);
    default: {
      const unhandled: never = spec;
      throw new Error(`No kit for ${JSON.stringify(unhandled)}`);
    }
  }
}
