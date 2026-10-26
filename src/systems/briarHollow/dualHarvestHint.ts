/**
 * The one-time nudge that both crawlers can harvest at once. A player who
 * has gathered a fair haul with one crawler while the other stands idle is
 * shown the explainer; a player who finds dual harvesting on their own never
 * sees it.
 */

import type { PartyCraftsState } from '../../core/labour/partyCrafts';
import { sessionTallyOf } from '../../core/items/gathering/resourceSessionTally';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HarvestSystem } from './HarvestSystem';

type Crawler = HumanPlayer | CatPlayer;

/** Wood and stone gathered this session past which a solo harvester is shown the hint. */
export const DUAL_HARVEST_HINT_SESSION_GAIN = 25;

export interface DualHarvestHintDeps {
  readonly harvest: Pick<HarvestSystem, 'isHarvesting'>;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly crafts: Pick<PartyCraftsState, 'dualHarvestHintDone'>;
  readonly open: () => void;
}

export class DualHarvestHint {
  constructor(private readonly deps: DualHarvestHintDeps) {}

  /** `menuOpen`: an overlay owns the screen, so the hint waits rather than stacking over it. */
  update(active: Crawler, menuOpen: boolean): void {
    const { harvest, human, cat, crafts } = this.deps;
    if (crafts.dualHarvestHintDone) return;
    if (harvest.isHarvesting(human) && harvest.isHarvesting(cat)) {
      crafts.dualHarvestHintDone = true;
      return;
    }
    if (menuOpen || !harvest.isHarvesting(active)) return;
    const companion = active === human ? cat : human;
    const companionCanWork = companion.isAlive && !companion.isKnockedOut;
    if (!companionCanWork) return;
    const sessionGain = sessionTallyOf('wood') + sessionTallyOf('stone');
    if (sessionGain <= DUAL_HARVEST_HINT_SESSION_GAIN) return;
    crafts.dualHarvestHintDone = true;
    this.deps.open();
  }
}
