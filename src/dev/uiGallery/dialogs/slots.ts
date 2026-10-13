/**
 * Fixtures for the Desperado Club's slot machine: at rest, mid-spin, a reel
 * slowing in anticipation, a line win, the BIG, MEGA and EPIC banners, the
 * free-spin feature, the jackpot, a purse too light to spin and the paytable. Each is a real
 * `ClubSlotsSystem` staged on a fake clock, mounted through its own surfaces,
 * so the phone close-button audit tests the layout the game ships.
 */

import type { Surface } from '../../../ui/core/UiRoot';
import { openStagedSlots, stageSlots, type SlotsStage } from '../../slotsStaging';
import type { DialogFixture } from './fixture';

/** The rules sheet's page of payline diagrams. */
const PAYLINES_PAGE = 3;

function slotsFixture(
  name: string,
  stage: SlotsStage,
  rulesPage: number | null = null,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const staged = openStagedSlots();
      stageSlots(staged, stage);
      if (rulesPage !== null) staged.host.openRules(rulesPage);
      const surfaces = [
        staged.host.machineSurface(name, staged.seat),
        staged.host.rulesSurface(`${name}-rules`),
      ];
      return surfaces.map((surface): Surface => ({
        ...surface,
        isOpen: () => shown() && surface.isOpen(),
      }));
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  slotsFixture('slots-idle', 'idle'),
  slotsFixture('slots-spinning', 'spinning'),
  slotsFixture('slots-anticipation', 'anticipation'),
  slotsFixture('slots-line-win', 'line-win'),
  slotsFixture('slots-big-win', 'big-win'),
  slotsFixture('slots-mega-win', 'mega-win'),
  slotsFixture('slots-epic-win', 'epic-win'),
  slotsFixture('slots-free-spins', 'free-spins'),
  slotsFixture('slots-jackpot', 'jackpot'),
  slotsFixture('slots-broke', 'broke'),
  slotsFixture('slots-rules', 'idle', 0),
  slotsFixture('slots-rules-paylines', 'idle', PAYLINES_PAGE),
];
