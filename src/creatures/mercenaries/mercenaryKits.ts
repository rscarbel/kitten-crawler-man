import type { MercenaryKitId, MercenaryTemplate } from '../../core/mercenaryTemplates';
import type { MercenaryKit } from './MercenaryKit';
import { BrawlerKit } from './brawlerKit';
import { CretinGuardKit } from './cretinGuardKit';
import { GolemKit } from './golemKit';
import { LancerKit } from './lancerKit';
import { MedicKit } from './medicKit';
import { WaterMageKit } from './waterMageKit';

/** A `Record` so a new kit id fails the typecheck until it has a constructor here. */
const KIT_FACTORIES: Readonly<
  Record<MercenaryKitId, (template: MercenaryTemplate) => MercenaryKit>
> = {
  cretin_guard: (template) => new CretinGuardKit(template),
  lancer: (template) => new LancerKit(template),
  water_mage: (template) => new WaterMageKit(template),
  brawler: (template) => new BrawlerKit(template),
  medic: (template) => new MedicKit(template.damage),
  golem: (template) => new GolemKit(template.damage),
};

/** A fresh kit for one hireling. Kits hold per-hireling state, so each needs its own. */
export function createMercenaryKit(template: MercenaryTemplate): MercenaryKit {
  return KIT_FACTORIES[template.kit](template);
}
