import { type ItemId, weaponStatsOf } from '../../core/items/defs/ItemDefs';
import { heldVisualIdOf } from '../../core/items/equipment/weapons';
import type { SkillId } from '../../core/skills/SkillManager';
import type { Rect } from '../core/geom';
import { drawDynamiteInventoryIcon } from '../../sprites/dynamiteSprite';
import {
  drawBenchPressInventoryIcon,
  drawDumbbellInventoryIcon,
  drawTreadmillInventoryIcon,
} from '../../sprites/gymEquipmentSprite';
import { drawAnchorShardIcon, drawAnchorStoneIcon } from './anchorStoneIcon';
import { drawBlueprintsQuestIcon, type BlueprintsQuestIconId } from './blueprintsQuestIcons';
import { drawGearHeadIcon, type GearHeadIconId } from '../../sprites/art/itemIcons/gearHeadIcons';
import {
  drawGearTorsoIcon,
  type GearTorsoIconId,
} from '../../sprites/art/itemIcons/gearTorsoIcons';
import { drawGearLimbIcon, type GearLimbIconId } from '../../sprites/art/itemIcons/gearLimbIcons';
import {
  drawGearClawRelicIcon,
  type GearClawRelicIconId,
} from '../../sprites/art/itemIcons/gearClawRelicIcons';
import {
  drawGearTrinketIcon,
  type GearTrinketIconId,
} from '../../sprites/art/itemIcons/gearTrinketIcons';
import { drawFoodIcon, type FoodIconId } from './foodIcons';
import { drawPrisonKeyIcon } from '../../sprites/art/itemIcons/prisonKeyIcon';
import { drawCatnipTunaWaterIcon } from '../../sprites/art/itemIcons/catnipTunaWaterIcon';
import { drawBlackPowderBombIcon } from '../../sprites/art/itemIcons/blackPowderBombIcon';
import { drawKitIcon, type KitIconId } from './kitIcons';
import { drawMagistratesWritIcon, drawUnreadableLetterIcon } from './murderMysteryLetterIcons';
import {
  drawCooldownCrispIcon,
  drawHealthPotionIcon,
  drawJuggJuiceIcon,
  drawSpeedFizzIcon,
  drawStatBoostIcon,
} from './potionIcons';
import { drawResourceIcon, type ResourceIconId } from './resourceIcons';
import { drawConfusingFogScrollIcon } from '../../sprites/art/itemIcons/scrollIcons';
import { drawSkillBookIcon } from './skillBookIcon';
import { drawSoulCrystalIcon } from './soulCrystalIcon';
import { drawToolIcon, type ToolIconId } from '../../sprites/art/itemIcons/toolIcons';
import { drawHeldVisualIcon } from '../../sprites/art/itemIcons/heldVisualIcon';
import type { HeldVisualId } from '../../sprites/held/heldVisualIds';
import {
  drawExplosivesTomeIcon,
  drawMagicMissileTomeIcon,
  drawSeismicStompTomeIcon,
} from './tomeIcons';

/** Paints one item's picture into `rect`. Square art is centred in a non-square rect. */
export type ItemIconPainter = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

const heldVisual =
  (id: HeldVisualId): ItemIconPainter =>
  (ctx, rect) =>
    drawHeldVisualIcon(ctx, rect, id);
const skillBook =
  (skillId: SkillId): ItemIconPainter =>
  (ctx, rect) =>
    drawSkillBookIcon(ctx, rect, skillId);
const gearHead =
  (id: GearHeadIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawGearHeadIcon(ctx, rect, id);
const gearTorso =
  (id: GearTorsoIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawGearTorsoIcon(ctx, rect, id);
const gearLimb =
  (id: GearLimbIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawGearLimbIcon(ctx, rect, id);
const gearClawRelic =
  (id: GearClawRelicIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawGearClawRelicIcon(ctx, rect, id);
const gearTrinket =
  (id: GearTrinketIconId): ItemIconPainter =>
  (ctx, rect) =>
    drawGearTrinketIcon(ctx, rect, id);
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
  catnip_tuna_water: drawCatnipTunaWaterIcon,
  scroll_of_confusing_fog: drawConfusingFogScrollIcon,
  goblin_dynamite: drawDynamiteInventoryIcon,
  black_powder_bomb: drawBlackPowderBombIcon,
  hamburger: food('hamburger'),
  hollow_stew: food('hollow_stew'),

  lucky_hoodie: gearTorso('lucky_hoodie'),
  scrappers_wraps: gearLimb('scrappers_wraps'),
  hobnail_boots: gearLimb('hobnail_boots'),
  riot_kneeguards: gearLimb('riot_kneeguards'),
  iron_knuckle_gauntlet: gearLimb('iron_knuckle_gauntlet'),
  patched_duster: gearTorso('patched_duster'),
  hazard_goggles: gearHead('hazard_goggles'),
  demolition_apron: gearTorso('demolition_apron'),
  foremans_hardhat: gearHead('foremans_hardhat'),
  silkspinner_gloves: gearLimb('silkspinner_gloves'),
  hamhock_boots: gearLimb('hamhock_boots'),
  rebar_shiv: heldVisual('rebar_shiv'),
  pipe_wrench: heldVisual('pipe_wrench'),
  rattlestick_sling: heldVisual('rattlestick_sling'),
  fire_axe: heldVisual('fire_axe'),
  gravediggers_spade: heldVisual('gravediggers_spade'),
  stormcaller: heldVisual('stormcaller'),
  the_last_word: heldVisual('the_last_word'),
  pot_lid_buckler: gearLimb('pot_lid_buckler'),
  velvet_harness: gearTorso('velvet_harness'),
  mousehide_booties: gearLimb('mousehide_booties'),
  plumed_coat: gearTorso('plumed_coat'),
  stargazers_cap: gearHead('stargazers_cap'),
  moonmoth_pendant: gearHead('moonmoth_pendant'),
  kaleidoscope_specs: gearHead('kaleidoscope_specs'),
  halo_of_the_ninth_life: gearHead('halo_of_the_ninth_life'),
  prowler_hood: gearHead('prowler_hood'),
  prowler_mantle: gearTorso('prowler_mantle'),
  prowler_booties: gearLimb('prowler_booties'),
  tin_claw_caps: gearClawRelic('tin_claw_caps'),
  venom_claws: gearClawRelic('venom_claws'),
  frostbite_claws: gearClawRelic('frostbite_claws'),
  prowler_claws: gearClawRelic('prowler_claws'),
  ink_dipped_claws: gearClawRelic('ink_dipped_claws'),
  sunsteel_talons: gearClawRelic('sunsteel_talons'),
  hearthguard_cap: gearHead('hearthguard_cap'),
  hearthguard_quilted_vest: gearTorso('hearthguard_quilted_vest'),
  hearthguard_bracers: gearLimb('hearthguard_bracers'),
  hearthguard_boots: gearLimb('hearthguard_boots'),
  scrapmail_vest: gearTorso('scrapmail_vest'),
  cockscomb_crest: gearHead('cockscomb_crest'),
  stoneheart_amulet: gearHead('stoneheart_amulet'),
  sun_locket: gearHead('sun_locket'),
  moon_locket: gearHead('moon_locket'),
  showmans_top_hat: gearHead('showmans_top_hat'),
  sequin_tailcoat: gearTorso('sequin_tailcoat'),
  gilded_monocle: gearHead('gilded_monocle'),
  grinning_mask: gearHead('grinning_mask'),
  nimble_bangle: gearTrinket('nimble_bangle'),
  lucky_penny: gearTrinket('lucky_penny'),
  fang_charm: gearTrinket('fang_charm'),
  frostward_charm: gearTrinket('frostward_charm'),
  emberward_charm: gearTrinket('emberward_charm'),
  fae_iron_charm: gearTrinket('fae_iron_charm'),
  hourglass_charm: gearTrinket('hourglass_charm'),
  ember_wisp: gearClawRelic('ember_wisp'),
  ward_stone: gearClawRelic('ward_stone'),
  sproutling_seed: gearClawRelic('sproutling_seed'),
  dev_plain_sword: heldVisual('plain_arming_sword'),
  dev_spiked_club: heldVisual('spiked_club'),
  dev_felling_axe: heldVisual('felling_axe'),

  magic_missile_tome: drawMagicMissileTomeIcon,
  seismic_stomp_tome: drawSeismicStompTomeIcon,
  explosives_handling_tome: drawExplosivesTomeIcon,
  skill_book_nine_lives: skillBook('nine_lives'),
  skill_book_cat_reflexes: skillBook('cat_reflexes'),
  skill_book_pugilism: skillBook('pugilism'),
  skill_book_iron_stomach: skillBook('iron_stomach'),
  skill_book_swordsmanship: skillBook('swordsmanship'),
  skill_book_archery: skillBook('archery'),
  skill_book_clawmanship: skillBook('clawmanship'),
  skill_book_magic_eye: skillBook('magic_eye'),
  skill_book_mechanical_fist: skillBook('mechanical_fist'),
  skill_book_blunt_proficiency: skillBook('blunt_proficiency'),
  skill_book_pyros_touch: skillBook('pyros_touch'),
  skill_book_demolitionist: skillBook('demolitionist'),

  wayfinders_anchor: (ctx, rect) => drawAnchorStoneIcon(ctx, rect),
  anchor_shard_tinker: anchorShard,
  anchor_shard_lori: anchorShard,
  anchor_shard_temple: anchorShard,
  quest_wood_board: resource('wood_board'),
  magistrates_writ: drawMagistratesWritIcon,
  unreadable_letter: drawUnreadableLetterIcon,
  doomsday_scenario: (ctx, rect) => drawSoulCrystalIcon(ctx, rect),
  quest_scythe: blueprintsQuest('quest_scythe'),
  quest_blueprints: blueprintsQuest('quest_blueprints'),
  quest_prison_key: drawPrisonKeyIcon,

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

/**
 * The icon `id` is drawn with: a weapon that has woken shows its awakened
 * look, read off the same stat block its held visual is, so the icon and the
 * blade in his hand always agree.
 */
export function itemIconPainter(id: ItemId, awakened: boolean): ItemIconPainter {
  const weapon = awakened ? weaponStatsOf(id) : null;
  if (weapon === null) return ITEM_ICONS[id];
  const look = heldVisualIdOf(weapon, true);
  return look === weapon.heldVisual ? ITEM_ICONS[id] : heldVisual(look);
}
