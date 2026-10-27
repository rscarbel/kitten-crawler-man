import type { MercenaryKitId, MercenaryTemplate } from '../../core/party/mercenaryTemplates';
import type { MercenaryKit } from './MercenaryKit';
import { ArcherKit } from './archerKit';
import { EarthElementalGuardKit } from './earthElementalGuardKit';
import { GolemKit } from './golemKit';
import { MedicKit } from './medicKit';

/** A `Record` so a new kit id fails the typecheck until it has a constructor here. */
const KIT_FACTORIES: Readonly<
  Record<MercenaryKitId, (template: MercenaryTemplate) => MercenaryKit>
> = {
  earth_elemental_guard: (template) => new EarthElementalGuardKit(template),
  archer: (template) => new ArcherKit(template),
  medic: (template) => new MedicKit(template.damage),
  golem: (template) => new GolemKit(template.damage),
};

/** A fresh kit for one hireling. Kits hold per-hireling state, so each needs its own. */
export function createMercenaryKit(template: MercenaryTemplate): MercenaryKit {
  return KIT_FACTORIES[template.kit](template);
}
