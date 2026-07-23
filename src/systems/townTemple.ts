/**
 * The Temple of the Sky's blessing. The priest will mend the whole party for a
 * donation — the town's only heal that touches the companion as well as whoever
 * you're steering.
 *
 * It needs no cooldown because it can only be bought while somebody is actually
 * hurt: an unhurt party has nothing to buy, which is a gate that survives walking
 * out of the building and back in, unlike a scene-local timer would.
 *
 * Pure data + line selection; `ServiceMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds.
 */

import type { Player } from '../Player';
import type { ServiceMenu, ServiceOption } from '../ui/ServiceMenuPanel';

const BLESSING_PRICE = 25;

const GRACE_LINES: ReadonlyArray<string> = [
  'The skyfowl sees you. Rise mended, and go carefully.',
  'Feathers over your shoulders, crawler. Walk on.',
  'Wounds are only a debt. Consider it settled.',
];

const PRIEST_BARKS: ReadonlyArray<string> = [
  'You carry the dungeon on you. Set some of it down.',
  'The sky is closer here than it looks. Will you be blessed?',
  'Coin for the roof, mercy for the body. Fair, I think.',
];

/** A priest's greeting, rotated by how many times the player has talked to them. */
function priestBark(turn: number): string {
  const index = ((turn % PRIEST_BARKS.length) + PRIEST_BARKS.length) % PRIEST_BARKS.length;
  return PRIEST_BARKS[index];
}

function graceLine(turn: number): string {
  const index = ((turn % GRACE_LINES.length) + GRACE_LINES.length) % GRACE_LINES.length;
  return GRACE_LINES[index];
}

/** The blessing menu for `party`, disabled while nobody in it is wounded. */
export function buildBlessingMenu(party: ReadonlyArray<Player>, turn: number): ServiceMenu {
  const option: ServiceOption = {
    key: 'blessing',
    label: 'Blessing of the Sky',
    price: BLESSING_PRICE,
    desc: 'Fully heals you and your companion',
  };
  if (party.every((member) => member.hp >= member.maxHp)) option.unavailable = 'Unhurt';
  return {
    title: 'Temple of the Sky',
    bark: priestBark(turn),
    options: [option],
  };
}

/** Heal the whole party and return the priest's parting grace. */
export function grantBlessing(party: ReadonlyArray<Player>, turn: number): string {
  for (const member of party) member.hp = member.maxHp;
  return graceLine(turn);
}
