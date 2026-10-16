/**
 * The Quiet Needle. The tattooist will put one living mark on a crawler — expensive,
 * permanent, and strictly one per character (`Player.tattoo`), so the choice
 * of which mark to wear is the whole decision.
 *
 * Pure data + line selection; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { Player } from '../Player';
import { getSkillDef } from '../core/SkillManager';
import {
  BRASS_GULLET_LABEL,
  BRASS_GULLET_SKILL,
  STAT_TATTOO_DESIGNS,
  STAT_TATTOO_IDS,
  brassGulletDesc,
  isStatTattooId,
} from '../core/tattoos';
import type { ShopMenu, ShopRow, ShopPurchaseHandler } from '../ui/screens/shop/shopSession';
import type { PlannedBuildingName } from '../map/town/townPlan';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

export const QUIET_NEEDLE_NAME = 'The Quiet Needle' as const satisfies PlannedBuildingName;

const TATTOO_PRICE = 100;
/** Each mark's description is the whole of its rules, so a row wraps rather than cutting it off. */
const TATTOO_DESC_LINES = 6;

/**
 * The parlour's one skill mark. Priced well above a stat mark because it
 * teaches a skill on top of its effect, and gated on its own marker rather than
 * `tattoo`: a crawler may carry one stat mark *and* one skill mark, but never
 * two of either.
 */
const SKILL_TATTOO_KEY = 'brass_gullet';
const SKILL_TATTOO_PRICE = 250;

function brassGulletOnSale(player: Player): boolean {
  return (
    player.skillTattoo === null && player.skills.previewUnlock(BRASS_GULLET_SKILL) !== 'already_max'
  );
}

/** Whether the parlour still has a mark `player` could buy. */
export function hasTattooForSale(player: Player): boolean {
  return player.tattoo === null || brassGulletOnSale(player);
}

/** The skill-tattoo row, with its availability resolved for `player`. */
function buildSkillTattooOption(player: Player): ShopRow {
  const def = getSkillDef(BRASS_GULLET_SKILL);
  const option: ShopRow = {
    key: SKILL_TATTOO_KEY,
    label: BRASS_GULLET_LABEL,
    price: SKILL_TATTOO_PRICE,
    desc: brassGulletDesc(def.name),
  };
  if (player.skillTattoo !== null) {
    option.unavailable = 'Already marked';
  } else if (player.skills.previewUnlock(BRASS_GULLET_SKILL) === 'already_max') {
    option.unavailable = 'Mastered';
  }
  return option;
}

const TATTOOIST_BARKS: ReadonlyArray<string> = [
  'Quiet shop, quiet needle. The screaming is the crawler’s part, not mine.',
  'One mark per skin. Choose like you mean it — I don’t do cover-ups and the ink won’t sit twice.',
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
    title: QUIET_NEEDLE_NAME,
    bark: host?.line ?? tattooistBark(turn),
    byline: host?.name,
    descLines: TATTOO_DESC_LINES,
    options: STAT_TATTOO_IDS.map((id) => {
      const design = STAT_TATTOO_DESIGNS[id];
      const option: ShopRow = {
        key: id,
        label: design.label,
        price: TATTOO_PRICE,
        desc: design.desc,
      };
      if (existing !== null) {
        option.unavailable = existing === id ? 'Yours' : 'Already inked';
      }
      return option;
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
