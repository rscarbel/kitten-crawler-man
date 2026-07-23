/**
 * Signet's Ink. The tattooist will put one living mark on a crawler — expensive,
 * permanent, and strictly one per character (`Player.tattooStat`), so the choice
 * of which stat it raises is the whole decision.
 *
 * Pure data + line selection; `ServiceMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { PermanentStat, Player } from '../Player';
import type { ServiceMenu, ServiceOption, ServicePurchaseHandler } from '../ui/ServiceMenuPanel';

const TATTOO_PRICE = 100;
/** Stat points a tattoo grants. Small, but it never goes away. */
const TATTOO_STAT_POINTS = 1;

const TATTOO_DESIGNS: ReadonlyArray<{
  key: string;
  label: string;
  desc: string;
  stat: PermanentStat;
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
];

const TATTOOIST_BARKS: ReadonlyArray<string> = [
  'They move, mine. Tsarina Signet’s trick — hold still and you’ll feel it settle.',
  'One per skin. Choose like you mean it, because I don’t do cover-ups.',
  'Needle’s hot, ink’s awake. What are we putting on you?',
];

/** The tattooist's greeting, rotated by how many times the player has talked to them. */
function tattooistBark(turn: number): string {
  const index = ((turn % TATTOOIST_BARKS.length) + TATTOOIST_BARKS.length) % TATTOOIST_BARKS.length;
  return TATTOOIST_BARKS[index];
}

/** The tattoo menu for `player` — every row disabled once they already carry a mark. */
export function buildTattooMenu(player: Player, turn: number): ServiceMenu {
  const existing = player.tattooStat;
  return {
    title: "Signet's Ink",
    bark: tattooistBark(turn),
    options: TATTOO_DESIGNS.map((design) => {
      const option: ServiceOption = {
        key: design.key,
        label: design.label,
        price: TATTOO_PRICE,
        desc: design.desc,
      };
      if (existing !== null) {
        option.unavailable = existing === design.stat ? 'Yours' : 'Already inked';
      }
      return option;
    }),
  };
}

/** Ink the chosen design onto the buyer and return the tattooist's line. */
export const inkTattoo: ServicePurchaseHandler = (option, buyer) => {
  const design = TATTOO_DESIGNS.find((d) => d.key === option.key);
  if (design === undefined) return 'The tattooist frowns at the design.';
  buyer.applyPermanentStat(design.stat, TATTOO_STAT_POINTS);
  buyer.tattooStat = design.stat;
  return `${option.label} is yours. It’s already moving.`;
};
