/**
 * The Quiet Needle. The tattooist puts living marks on a crawler — expensive and
 * permanent, and at most one of each kind per character: one stat mark
 * (`Player.tattoo`) and one skill mark (`Player.skillTattoo`), so the choice
 * of which stat mark to wear is the whole decision.
 *
 * Pure data + line selection; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import { buildingDisplayName } from '../map/buildingIds';
import type { Player } from '../Player';
import { getSkillDef } from '../core/skills/SkillManager';
import {
  BRASS_GULLET_LABEL,
  BRASS_GULLET_SKILL,
  STAT_TATTOO_DESIGNS,
  STAT_TATTOO_IDS,
  brassGulletDesc,
  isStatTattooId,
  type StatTattooId,
} from '../core/skills/tattoos';
import type { ServiceIconId } from '../sprites/art/itemIcons/serviceIcons';
import {
  offerUnless,
  type ShopMenu,
  type ShopRow,
  type ShopPurchaseHandler,
} from '../ui/screens/shop/shopSession';
import { hostByline, type ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';
import { SERVICE_PRICES } from '../economy/servicePrices';

/**
 * The parlour's one skill mark, gated on its own marker rather than `tattoo`:
 * a crawler may carry one stat mark *and* one skill mark, but never two of
 * either.
 */
const SKILL_TATTOO_KEY = 'brass_gullet';

const STAT_TATTOO_ART = {
  coiled_fist: 'tattoo_coiled_fist',
  iron_ribs: 'tattoo_iron_ribs',
  third_eye: 'tattoo_third_eye',
  quick_serpent: 'tattoo_quick_serpent',
} as const satisfies Record<StatTattooId, ServiceIconId>;

function brassGulletOnSale(player: Player): boolean {
  return (
    player.skillTattoo === null && player.skills.previewUnlock(BRASS_GULLET_SKILL) !== 'already_max'
  );
}

/** Whether the parlour still has a mark `player` could buy. */
export function hasTattooForSale(player: Player): boolean {
  return player.tattoo === null || brassGulletOnSale(player);
}

/** Why `player` cannot take the skill mark, or null when they can. */
function skillTattooRefusal(player: Player): string | null {
  if (player.skillTattoo !== null) return 'Already marked';
  if (player.skills.previewUnlock(BRASS_GULLET_SKILL) === 'already_max') return 'Mastered';
  return null;
}

/** The skill-tattoo row, with its availability resolved for `player`. */
function buildSkillTattooOption(player: Player): ShopRow {
  const def = getSkillDef(BRASS_GULLET_SKILL);
  return {
    key: SKILL_TATTOO_KEY,
    label: BRASS_GULLET_LABEL,
    desc: brassGulletDesc(def.name),
    art: { kind: 'service', service: 'tattoo_brass_gullet' },
    offer: offerUnless(skillTattooRefusal(player), {
      kind: 'coins',
      coins: SERVICE_PRICES.tattoo_parlor.skill_tattoo,
    }),
    questErrand: false,
  };
}

const TATTOOIST_BARKS: ReadonlyArray<string> = [
  'Quiet shop, quiet needle. The screaming is the crawler’s part, not mine.',
  'One mark of each kind per skin. Choose like you mean it — I don’t do cover-ups and the ink won’t sit twice.',
  'Pigment’s ground, needle’s hot. What are we putting on you?',
];

/** The tattooist's greeting, rotated by how many times the player has talked to them. */
function tattooistBark(turn: number): string {
  return rotateLine(TATTOOIST_BARKS, turn);
}

/**
 * The tattoo menu for `player`.
 *
 * The stat rows all disable together once they carry a stat mark; the Brass
 * Gullet is gated separately on {@link Player.skillTattoo}, so one of each can
 * coexist.
 *
 * `host` names the resident behind the needle when the room has one, so the
 * greeting is theirs rather than the generic tattooist's.
 */
export function buildTattooMenu(player: Player, turn: number, host: ResidentHost | null): ShopMenu {
  const existing = player.tattoo;
  return {
    title: buildingDisplayName('taloncrest_tattoo_parlor'),
    bark: host?.line ?? tattooistBark(turn),
    byline: hostByline(host),
    emblem: null,
    options: STAT_TATTOO_IDS.map((id): ShopRow => {
      const design = STAT_TATTOO_DESIGNS[id];
      const refusal = existing === null ? null : existing === id ? 'Yours' : 'Already inked';
      return {
        key: id,
        label: design.label,
        desc: design.desc,
        art: { kind: 'service', service: STAT_TATTOO_ART[id] },
        offer: offerUnless(refusal, {
          kind: 'coins',
          coins: SERVICE_PRICES.tattoo_parlor.stat_tattoo,
        }),
        questErrand: false,
      };
    }).concat(buildSkillTattooOption(player)),
  };
}

/** Ink the chosen design onto the buyer and return the tattooist's line. */
export const inkTattoo: ShopPurchaseHandler = (option, buyer) => {
  if (option.key === SKILL_TATTOO_KEY) {
    if (buyer.skillTattoo !== null) {
      return { ok: false, line: 'One mark of that kind per skin. You have yours.' };
    }
    buyer.skills.unlockSkill(BRASS_GULLET_SKILL);
    buyer.skillTattoo = BRASS_GULLET_SKILL;
    return {
      ok: true,
      line: 'Swallow. There — it settles in the gullet. Try not to test it today.',
    };
  }
  const { key } = option;
  if (!isStatTattooId(key)) return { ok: false, line: 'The tattooist frowns at the design.' };
  buyer.tattoo = key;
  return { ok: true, line: `${option.label} is yours. It’s already moving.` };
};
