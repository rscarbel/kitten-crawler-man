import type { ItemId } from '../../core/ItemDefs';
import type { SkillId } from '../../core/SkillManager';
import type { Rect } from '../core/geom';
import { drawDynamiteInventoryIcon } from '../../sprites/dynamiteSprite';
import {
  drawBenchPressInventoryIcon,
  drawDumbbellInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../../sprites/gymEquipmentSprite';
import { drawAnchorShardIcon, drawAnchorStoneIcon } from './anchorStoneIcon';
import { drawBlueprintsQuestIcon, type BlueprintsQuestIconId } from './blueprintsQuestIcons';
import { drawEnchantedGearIcon, type EnchantedGearItemId } from './enchantedGearIcons';
import {
  drawBigBoiBoxersIcon,
  drawSepsisCrownIcon,
  drawTrollskinShirtIcon,
} from './enchantedApparelIcons';
import { drawFoodIcon, type FoodIconId } from './foodIcons';
import { drawIssueKitIcon, type IssueKitItemId } from './issueKitIcon';
import { drawKitIcon, type KitIconId } from './kitIcons';
import { drawMagistratesWritIcon, drawUnreadableLetterIcon } from './murderMysteryLetterIcons';
import {
  drawCooldownCrispIcon,
  drawDirtyShirleyIcon,
  drawHealthPotionIcon,
  drawJuggJuiceIcon,
  drawSpeedFizzIcon,
  drawStatBoostIcon,
} from './potionIcons';
import { drawResourceIcon, type ResourceIconId } from './resourceIcons';
import { drawConfusingFogScrollIcon } from './scrollIcons';
import { drawSkillBookIcon } from './skillBookIcon';
import { drawSoulCrystalIcon } from './soulCrystalIcon';
import { drawToolIcon, type ToolIconId } from './toolIcons';
import { drawExplosivesTomeIcon, drawMagicMissileTomeIcon, drawSmushTomeIcon } from './tomeIcons';

/** Paints one item's picture into `rect`. Square art is centred in a non-square rect. */
export type ItemIconPainter = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

const skillBook =
  (skillId: SkillId): ItemIconPainter =>
  (ctx, rect) =>
    drawSkillBookIcon(ctx, rect, skillId);
const issueKit =
  (id: IssueKitItemId): ItemIconPainter =>
  (ctx, rect) =>
    drawIssueKitIcon(ctx, rect, id);
const enchantedGear =
  (id: EnchantedGearItemId): ItemIconPainter =>
  (ctx, rect) =>
    drawEnchantedGearIcon(ctx, rect, id);
const resource =
  (id: ResourceIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawResourceIcon(ctx, rect, id);
const tool =
  (id: ToolIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawToolIcon(ctx, rect, id);
const food =
  (id: FoodIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawFoodIcon(ctx, rect, id);
const kit =
  (id: KitIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawKitIcon(ctx, rect, id);
const blueprintsQuest =
  (id: BlueprintsQuestIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawBlueprintsQuestIcon(ctx, rect, id);

const anchorShard: ItemIconPainter = (ctx, rect) => drawAnchorShardIcon(ctx, rect);

/**
 * Every item's icon painter, keyed by id. Exhaustive, so an item cannot ship
 * without art.
 */
export const ITEM_ICONS: Record<ItemId, ItemIconPainter> = {
  health_potion: drawHealthPotionIcon,
  speed_fizz: drawSpeedFizzIcon,
  jugg_juice: drawJuggJuiceIcon,
  cooldown_crisp: drawCooldownCrispIcon,
  stat_boost_potion: drawStatBoostIcon,
  dirty_shirley: drawDirtyShirleyIcon,
  scroll_of_confusing_fog: drawConfusingFogScrollIcon,
  goblin_dynamite: drawDynamiteInventoryIcon,
  hamburger: food('hamburger'),
  hollow_stew: food('hollow_stew'),

  enchanted_bigboi_boxers: drawBigBoiBoxersIcon,
  trollskin_shirt: drawTrollskinShirtIcon,
  enchanted_crown_sepsis_whore: drawSepsisCrownIcon,
  issue_kettle_helm: issueKit('issue_kettle_helm'),
  padded_gambeson: issueKit('padded_gambeson'),
  riveted_bracers: issueKit('riveted_bracers'),
  marching_boots: issueKit('marching_boots'),
  nightgaunt_cloak: enchantedGear('nightgaunt_cloak'),
  slate_butterfly_talisman: enchantedGear('slate_butterfly_talisman'),
  fae_scale_crupper: enchantedGear('fae_scale_crupper'),
  bracelet_of_dex: enchantedGear('bracelet_of_dex'),
  splatter_skunk_toe_ring: enchantedGear('splatter_skunk_toe_ring'),
  shade_gnoll_kneepads: enchantedGear('shade_gnoll_kneepads'),
  grull_war_gauntlet: enchantedGear('grull_war_gauntlet'),
  slingshot: enchantedGear('slingshot'),

  magic_missile_tome: drawMagicMissileTomeIcon,
  smush_tome: drawSmushTomeIcon,
  explosives_handling_tome: drawExplosivesTomeIcon,
  skill_book_cockroach: skillBook('cockroach'),
  skill_book_cat_reflexes: skillBook('cat_reflexes'),
  skill_book_pugilism: skillBook('pugilism'),
  skill_book_iron_stomach: skillBook('iron_stomach'),
  skill_book_night_vision: skillBook('night_vision'),

  wayfinders_anchor: (ctx, rect) => drawAnchorStoneIcon(ctx, rect),
  anchor_shard_tinker: anchorShard,
  anchor_shard_hilda: anchorShard,
  anchor_shard_temple: anchorShard,
  quest_wood_board: resource('wood_board'),
  magistrates_writ: drawMagistratesWritIcon,
  unreadable_letter: drawUnreadableLetterIcon,
  doomsday_scenario: (ctx, rect) => drawSoulCrystalIcon(ctx, rect),
  quest_scythe: blueprintsQuest('quest_scythe'),
  quest_blueprints: blueprintsQuest('quest_blueprints'),

  wood: resource('wood'),
  stone: resource('stone'),
  wood_board: resource('wood_board'),
  rope: resource('rope'),

  basic_axe: tool('basic_axe'),
  hardened_axe: tool('hardened_axe'),
  lumberjacks_axe: tool('lumberjacks_axe'),
  ratkin_forge_axe: tool('ratkin_forge_axe'),
  deepwood_cleaver: tool('deepwood_cleaver'),
  graveyards_bane: tool('graveyards_bane'),
  basic_pickaxe: tool('basic_pickaxe'),
  hardened_pickaxe: tool('hardened_pickaxe'),
  quarrymans_pick: tool('quarrymans_pick'),
  ratkin_forge_pick: tool('ratkin_forge_pick'),
  stonebreaker: tool('stonebreaker'),
  worldscar_pick: tool('worldscar_pick'),

  trebuchet_kit: kit('trebuchet_kit'),
  snare_kit: kit('snare_kit'),
  gym_dumbbell: drawDumbbellInventoryIcon,
  gym_bench_press: drawBenchPressInventoryIcon,
  gym_treadmill: drawTreadmillInventoryIcon,
};
