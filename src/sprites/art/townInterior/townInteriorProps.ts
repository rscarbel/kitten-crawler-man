/**
 * The town's interior furniture library: counters, tables, seating, shelving,
 * barrels and crates, a hearth and a forge brazier, a rug, and a handful of
 * wall-mounted dressings, painted through the shared town vocabulary
 * (`src/sprites/art/town/`) rather than as one-tile tile types.
 *
 * Every prop's *painter* follows the frame contract `townArt.ts` states for
 * street props (a `TownPropFrame`'s own bottom-left-anchored coordinate
 * space, used only while painting one cached frame in isolation).
 *
 * Placement on a room's grid is a separate contract, deliberately different
 * because it has to agree with every other grid convention in the codebase
 * (screen Y increases south): a room's layout (`src/map/town/interiors/`)
 * places instances by their footprint's **north-west** tile — `(x, y)` is
 * the top-left corner, and the footprint runs south across `h` rows and east
 * across `w` columns from there. `GameMap.applyTownInteriorLayout` blocks
 * exactly those rows/columns, `drawTownInteriorProp` paints the art with its
 * bottom edge on the footprint's southmost row, and `townInteriorPropSortY`
 * Y-sorts on that same southmost row — all three read `(x, y)` the same way,
 * which `gates-town-interior-props.ts`'s footprint-anchor-agreement check
 * enforces for both a wide (2×1) and a tall (1×2) footprint.
 *
 * Each variant is painted once per `(propId, variant)` pair and cached to an
 * offscreen canvas — the material painters below are real canvas work
 * (gradients, per-board/per-block loops), too costly to repaint every frame
 * for a room that may hold a few dozen instances.
 */

import {
  TOWN_TILE_SCALE,
  footprintBox,
  withFootprintClip,
  forkRng,
  jitter,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type FootprintBox,
  type Rng,
} from '../town/townArt';
import {
  getTownRamp,
  sampleRamp,
  mix,
  TOWN_INK,
  type Ramp,
  type RGB,
  type TownRampId,
} from '../town/townPalette';
import { paintPlankBoard, paintStoneCourses, paintGlazing } from '../town/townMaterials';
import { mulberry32 } from '../../person/rng';
import type { AnchorKind } from '../../../systems/InteriorOccupantSystem';
import type { SoundId } from '../../../audio/sounds';
import {
  paintCatPortrait,
  paintDairyChurn,
  paintCaskRack,
  paintInnHearth,
  paintInnBackBar,
  paintInnBar,
  paintInnDresser,
  paintCatStool,
  paintFiresideChair,
  paintLogBasket,
  paintInnTable,
  paintInnBench,
  paintInnGuestBed,
  paintInnCot,
  paintRagRug,
  paintWashstand,
} from './rooms/sleepingCatInn';
import {
  paintTabLedger,
  paintTrophyBanner,
  paintFlagonHearth,
  paintGuildBooth,
  paintBoothScreen,
  paintBoothTable,
  paintFeastTable,
  paintFeastBench,
  paintFlagonBackBar,
  paintFlagonBar,
  paintFlagonTrophy,
  paintTorchere,
  paintTrestleTable,
  paintFlagonCarpet,
  paintCoatRack,
  paintFlagonChair,
  paintDealBench,
  paintFlagonSideboard,
} from './rooms/hornedFlagon';
import {
  paintDraftingStation,
  paintPlanChest,
  paintRollBin,
  paintToolWall,
  paintDoorOnTrestles,
  paintBuildersHearth,
  paintGoodChair,
  paintDairyWall,
  paintChurnStand,
  paintMilkingStool,
  paintFeedStack,
  paintMadeCot,
  paintTimberStack,
  paintSupperTable,
  paintToolChest,
  paintPailStack,
  paintDoorPegPost,
  paintBootTray,
  paintOffcutBox,
  paintStairShelf,
} from './rooms/plumblineFarm';
import {
  paintDartboard,
  paintBoltedDoor,
  paintStumpBackShelf,
  paintStumpBar,
  paintChalkTally,
  paintDiceTable,
  paintStumpTable,
  paintBarrelTable,
  paintKegStack,
  paintJunkHeap,
  paintFloorStain,
  paintSmokyLamp,
  paintStumpStove,
} from './rooms/sunkenStumpPub';
import {
  paintStill,
  paintHerbBundleRack,
  paintApothecaryCabinet,
  paintApothecaryCounter,
  paintHerbDryingRack,
  paintPottingBench,
  paintHerbBins,
  paintRemedyDisplay,
  paintLiveHerbPots,
  paintSpecimenCase,
  paintPottedBay,
  paintSortingTable,
} from './rooms/herbAndRemedy';
import {
  paintBookStack,
  paintHedgeStool,
  paintBroom,
  paintMushroomBasket,
  paintJarDresser,
  paintWitchHearth,
  paintDryingBeam,
  paintWitchWorktable,
  paintCatArmchair,
  paintBookHeap,
  paintBirdcageStand,
  paintCrockCluster,
  paintCottageBed,
} from './rooms/oldHildasCottage';
import {
  paintAltarStone,
  paintLectern,
  paintSkyBanner,
  paintTempleDais,
  paintSkyWindow,
  paintTempleCandelabrum,
  paintPerchStand,
  paintVotiveRack,
  paintSkyFont,
  paintOfferingTable,
  paintScriptureShelf,
} from './rooms/templeOfTheSky';
import {
  paintNeedleTray,
  paintFeatherChart,
  paintFlashWall,
  paintInkChair,
  paintPigmentCabinet,
  paintArmLamp,
  paintGrindingBench,
  paintSettee,
  paintLowTable,
  paintSideTable,
  paintCoatStand,
} from './rooms/quietNeedle';
import {
  paintForge,
  paintBarStock,
  paintViceBench,
  paintAnvil,
  paintBladeRack,
  paintSmithBellows,
  paintSmithToolWall,
  paintSmithCounter,
  paintCoalHeap,
  paintIronmongeryTable,
  paintMailStand,
  paintSlackTub,
  paintForgeFloor,
  paintMandrelSwage,
} from './rooms/rustyAnvil';
import {
  paintLodgeMapTable,
  paintLodgeBunk,
  paintLodgeSpearRack,
  paintLodgeDutyBoard,
  paintLodgeStove,
  paintLodgeKitPegs,
  paintKesslerFootlocker,
  paintCellarTrapdoor,
  LODGE_BUNK_VARIANTS,
} from './rooms/blackwoodLodge';
import {
  paintWheelBuildStand,
  paintTimberRack,
  paintSawhorse,
  paintWagonBed,
  paintLathe,
  paintJoinerBench,
  paintFinishedWheels,
  paintShavingHorse,
  paintFirewoodStack,
  paintSpokeTub,
  paintGluePot,
  paintShavingsFloor,
  paintAxleSet,
  paintPlankPile,
} from './rooms/cartwrightsWorkshop';
import {
  paintPotRack,
  paintFlourBin,
  paintSieveRack,
  paintHandCart,
  paintMillWorks,
  paintSteelyardScale,
  paintFarmHearth,
  paintFarmTable,
  paintBakeTrough,
  paintFarmDresser,
  paintLarderShelf,
  paintCorvinPallet,
  paintFlourSackStack,
  paintFlourDrift,
  paintGrainBin,
} from './rooms/millersFarm';
import {
  paintGoodsWall,
  paintPotionCabinet,
  paintStoreCounter,
  paintCounterBellEnd,
  paintDisplayTable,
  paintBulkBins,
  paintToolBarrel,
  paintDynamiteCrate,
  paintClerkDesk,
  paintStockStack,
  paintSackPile,
  paintCrockStack,
} from './rooms/generalStore';
import {
  paintGarrisonWeaponRack,
  paintArmourStandRow,
  paintIssueCounter,
  paintStrawDummy,
  paintPellPost,
  paintArcheryButt,
  paintDrillSlate,
  paintWaterTrough,
  paintSandbags,
  paintBunkBed,
  paintMusterBoard,
  paintBriefingTable,
  paintSparringRing,
} from './rooms/barracks';
import {
  paintRecordsCabinet,
  paintPigeonholeWall,
  paintScrivenerDesk,
  paintMagistrateDesk,
  paintArchiveBoxes,
  paintWritBoard,
  paintCoilBench,
  paintConduitCoil,
  paintPetitionCounter,
  paintTowerHearth,
} from './rooms/townCenterTower';

type Ctx = CanvasRenderingContext2D;

/**
 * What a swing breaks an interior prop instance into. Kept separate from
 * `DestructiblePropKind` (`src/systems/DestructiblePropSystem.ts`), which
 * keys a dungeon floor's tile-type props and renders through the sprite-sheet
 * manifest `drawSpriteKey` reads — these props have no sheet, only the
 * painters below, so `TownInteriorPropDestructionSystem` resolves and
 * renders them on its own rather than folding into that system.
 */
export type TownInteriorDestructibleKind =
  | 'barrel'
  | 'crate'
  | 'shelf'
  | 'brazier'
  | 'candelabrum'
  | 'sack'
  | 'crockery'
  | 'jars'
  | 'basket'
  | 'lamp'
  | 'chair'
  | 'table'
  | 'stool';

export interface TownInteriorDestructibleSpec {
  readonly kind: TownInteriorDestructibleKind;
  readonly hp: number;
  /** Alternated on repeated breaks so back-to-back smashes never sound identical. */
  readonly breakCues: readonly [SoundId, ...SoundId[]];
  /** Coins a first-time break (per `TownInteriorPropEntry.dropsLoot`) leaves — a range, inclusive. */
  readonly coinsMin: number;
  readonly coinsMax: number;
  /** Whether this kind pays out unless a layout entry says otherwise — false for shop merchandise. */
  readonly dropsLootByDefault: boolean;
}

/**
 * A prop with something to do besides stand there. `id` looks up the actual
 * text/table/effect in `src/dialog/scripts/interiorObjects.ts`, the way a
 * `Readable`'s `id` looks up its body in `townReadables.ts` — kept as a
 * string reference rather than an inline value so every interactable prop's
 * words live in one dialog file, like all speech.
 */
export type TownInteriorExamineId =
  | 'jars'
  | 'ledger_desk'
  | 'price_board'
  | 'blade_rack'
  | 'wagon_bed'
  | 'joiner_bench'
  | 'lathe'
  | 'shaving_horse'
  | 'firewood_stack'
  | 'axle_set'
  | 'armour_stand'
  | 'millstone'
  | 'grain_scale'
  | 'crawler_scraps'
  | 'field_log'
  | 'lodge_map_table'
  | 'lodge_bunks'
  | 'lodge_spear_rack'
  | 'lodge_duty_board'
  | 'lodge_stove'
  | 'milk_churn'
  | 'slate_menu'
  | 'cat_portrait'
  | 'dairy_churn'
  | 'tab_ledger'
  | 'trophy_banner'
  | 'bolted_door'
  | 'still'
  | 'witch_jars'
  | 'book_stack'
  | 'cottage_familiar'
  | 'altar_stone'
  | 'lectern'
  | 'sky_banner'
  | 'needle_tray'
  | 'feather_chart'
  | 'flash_wall'
  | 'ink_chair'
  | 'pigment_cabinet'
  | 'grinding_bench'
  | 'birdcage'
  | 'mushroom_basket'
  | 'witch_worktable'
  | 'apothecary_drawer_wall'
  | 'herb_drying_rack'
  | 'herb_bins'
  | 'remedy_display'
  | 'specimen_case'
  | 'potting_bench'
  | 'live_herb_pots'
  | 'forge'
  | 'vice_bench'
  | 'anvil'
  | 'smith_bellows'
  | 'smith_tool_wall'
  | 'ironmongery_table'
  | 'mail_stand'
  | 'wheel_build_stand'
  | 'timber_rack'
  | 'flour_bin'
  | 'sieve_rack'
  | 'farm_dresser'
  | 'larder_shelf'
  | 'flour_sacks'
  | 'scripture_shelf'
  | 'sky_window'
  | 'perch_stand'
  | 'votive_rack'
  | 'sky_font'
  | 'tool_wall'
  | 'dairy_wall'
  | 'feed_sacks'
  | 'repair_door'
  | 'potion_cabinet'
  | 'bulk_bins'
  | 'dynamite_crate'
  | 'goods_wall'
  | 'garrison_spear_rack'
  | 'issue_counter'
  | 'straw_dummy'
  | 'pell_post'
  | 'archery_butt'
  | 'drill_slate'
  | 'briefing_table'
  | 'guild_booth'
  | 'feast_bench'
  | 'flagon_back_bar'
  | 'flagon_trophy'
  | 'chalk_tally'
  | 'dice_table'
  | 'records_cabinet'
  | 'pigeonhole_wall'
  | 'scrivener_desk'
  | 'magistrate_desk'
  | 'writ_board'
  | 'coil_bench'
  | 'conduit_coil'
  | 'petition_counter';
export type TownInteriorSearchId = 'chest' | 'coat_hook' | 'drawer_unit' | 'open_crate';
export type TownInteriorUseId =
  | 'shop_bell'
  | 'offering_bowl'
  | 'bench_seat'
  | 'hearth'
  | 'grindstone'
  | 'wheelwright_stand'
  | 'throw_dart'
  | 'biting_stool';

export type TownInteriorInteraction =
  | { readonly kind: 'examine'; readonly id: TownInteriorExamineId }
  | { readonly kind: 'search'; readonly id: TownInteriorSearchId }
  | { readonly kind: 'use'; readonly id: TownInteriorUseId };

/** Warm ember glow used by the hearth and forge brazier — no shared ramp covers open flame. */
const FLAME_CORE: RGB = [252, 208, 120];
const FLAME_MID: RGB = [214, 108, 42];
const FLAME_EDGE: RGB = [96, 40, 20];

/** Polished brass for the bell and the offering bowl's rim — no shared town ramp covers metal this warm. */
const BRASS_DIM: RGB = [150, 116, 54];
const BRASS_BRIGHT: RGB = [214, 176, 96];

/** Corked potion-vial liquids — no shared town ramp covers a dyed glass fill. */
const POTION_RED: RGB = [168, 40, 44];
const POTION_BLUE: RGB = [46, 90, 168];
const POTION_GREEN: RGB = [72, 140, 62];
const POTION_LIQUID_COLORS: readonly RGB[] = [POTION_RED, POTION_BLUE, POTION_GREEN];

/** A duster's feather cluster — no shared town ramp covers plumage this pale. */
const DUSTER_FEATHER: RGB = [222, 208, 176];

/** Coal — no shared town ramp covers fuel this dead-black with a cracked-edge sheen. */
const COAL_BLACK: RGB = [24, 22, 22];
const COAL_SHEEN: RGB = [64, 62, 64];

/** The quench trough's own water — dark, faintly reflective, never the bright glass ramp a jar uses. */
const QUENCH_WATER: RGB = [30, 40, 46];
const QUENCH_WATER_LIGHT: RGB = [58, 78, 88];

/** Parchment — warmer and paler than any cloth ramp. */
const PARCHMENT: RGB = [216, 200, 164];

/**
 * Stocked-shelf goods — fired clay, glass, dyed cloth, tallow and rope, none
 * of which any shared town ramp covers (those ramps are building materials,
 * not stock). Individually painted goods, not jittered colour blocks, are
 * what makes a shelf read as stocked rather than merely furnished.
 */
const GOODS_CLAY_DARK: RGB = [78, 46, 32];
const GOODS_CLAY_BODY: RGB = [131, 80, 58];
const GOODS_CLAY_LIGHT: RGB = [168, 112, 82];
const GOODS_GLASS_BODY: RGB = [78, 114, 98];
const GOODS_GLASS_LIGHT: RGB = [140, 176, 154];
const GOODS_CLOTH_MADDER: RGB = [150, 54, 46];
const GOODS_CLOTH_WOAD: RGB = [54, 78, 132];
const GOODS_CLOTH_WELD: RGB = [176, 150, 56];
const GOODS_ROPE: RGB = [168, 134, 84];
const GOODS_CANDLE: RGB = [222, 206, 158];
const GOODS_PAN: RGB = [96, 98, 104];

/** The one counter tile variant that carries the till and scales. */
const COUNTER_TILL_VARIANT = 2;

/** Whether a prop stands free on the floor or is mounted against a wall face. */
export type TownInteriorPropMount = 'free' | 'wall';

/**
 * A footprint size in tiles. Every prop anchors on its bottom-left tile
 * (matching `TownPropFrame`), so a wider prop's footprint runs east and a
 * taller one's runs north from that corner.
 */
export interface TownInteriorFootprint {
  readonly w: number;
  readonly h: number;
}

export interface TownInteriorPropDef {
  readonly id: string;
  readonly footprint: TownInteriorFootprint;
  /** How many tiles of art rise above the footprint — the frame's headroom, not a hard clip. */
  readonly artHeightTiles: number;
  /** Whether the footprint blocks movement. A rug is the one prop in this set that does not. */
  readonly walkable: boolean;
  /**
   * Whether the footprint blocks sight. Left `undefined` to mean "matches
   * `walkable`'s inverse", which is every ported room's existing behaviour —
   * see the "sight is not a walk line" memory for why a future low-but-solid
   * prop (a wall it should still be possible to see over) would need this
   * wired through per-instance, which this framework does not yet do.
   */
  readonly blocksSight?: boolean;
  readonly anchors: ReadonlyArray<AnchorKind>;
  readonly mount: TownInteriorPropMount;
  readonly variants: number;
  readonly paint: (ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng) => void;
  /** Absent means the instance cannot be broken. */
  readonly destructible?: TownInteriorDestructibleSpec;
  /** Absent means the instance offers nothing to examine, search or use. */
  readonly interaction?: TownInteriorInteraction;
}

const ONE_BY_ONE: TownInteriorFootprint = { w: 1, h: 1 };

// ── Pew segment proportions ─────────────────────────────────────────────────
const PEW_SEAT_HEIGHT_FRACTION = 0.12;
const PEW_SEAT_RISE_FRACTION = 0.4;
const PEW_BACK_HEIGHT_FRACTION = 0.62;
const PEW_BASE_SHADE = 0.3;
const PEW_SEAT_SHADE = 0.55;
const PEW_BACK_SHADE = 0.5;
const PEW_SEAM_SHADE = 0.38;
const PEW_JITTER = 0.05;
const PEW_SEAM_WIDTH_FRACTION = 0.03;
const PEW_PANEL_INSET_FRACTION = 0.07;
const PEW_CAP_HEIGHT_FRACTION = 0.08;
const PEW_CAP_SHADE = 0.55;
const PEW_HIGHLIGHT_SHADE = 0.85;
const PEW_PANEL_LIP_ALPHA = 0.55;
const PEW_DETAIL_OUTLINE_FRACTION = 0.7;
const PEW_CUSHION_HEIGHT_FRACTION = 0.85;
const PEW_CUSHION_SHADE = 0.5;
const PEW_CUSHION_LIGHT_SHADE = 0.9;
const PEW_BOOK_VARIANT = 1;
const PEW_BOOK_WIDTH_FRACTION = 0.26;
const PEW_BOOK_HEIGHT_FRACTION = 0.1;
const PEW_BOOK_OFFSET_FRACTION = 0.4;
/** A book of the office's cover — the same oxblood as the altar's and the lectern's. */
const PEW_BOOK_COVER: RGB = [110, 40, 38];

// ── Shared drawing helpers ──────────────────────────────────────────────────

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.42;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.32);
}

function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function stoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}
function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}

/** A simple shaded box (front face + top face), used for crates, chests and drawers. */
function paintBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  topDepth: number,
  ramp: Ramp,
  rng: Rng,
): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.32));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + topDepth * 0.6, y - topDepth);
  ctx.lineTo(x + w + topDepth * 0.6, y - topDepth);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  paintPlankBoard(ctx, x, y, w, h, rng, { direction: 'vertical', boardPx: w / 3, ramp });
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, TOWN_TILE_SCALE);
}

function paintBarrelBody(
  ctx: Ctx,
  cx: number,
  topY: number,
  height: number,
  radiusTop: number,
  radiusMid: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const bulge = radiusMid;
  const staveCount = 10;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - radiusTop, topY);
  ctx.bezierCurveTo(
    cx - bulge,
    topY + height * 0.3,
    cx - bulge,
    topY + height * 0.7,
    cx - radiusTop,
    topY + height,
  );
  ctx.lineTo(cx + radiusTop, topY + height);
  ctx.bezierCurveTo(
    cx + bulge,
    topY + height * 0.7,
    cx + bulge,
    topY + height * 0.3,
    cx + radiusTop,
    topY,
  );
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.4));
  ctx.fillRect(cx - bulge, topY, bulge * 2, height);
  for (let i = 0; i < staveCount; i++) {
    const t = i / staveCount;
    const sx = cx - bulge + t * bulge * 2;
    const tone = 0.4 + jitter(rng, 0.08);
    ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, Math.max(0, tone))));
    ctx.fillRect(sx, topY, (bulge * 2) / staveCount, height);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx - radiusTop, topY);
  ctx.bezierCurveTo(
    cx - bulge,
    topY + height * 0.3,
    cx - bulge,
    topY + height * 0.7,
    cx - radiusTop,
    topY + height,
  );
  ctx.lineTo(cx + radiusTop, topY + height);
  ctx.bezierCurveTo(
    cx + bulge,
    topY + height * 0.7,
    cx + bulge,
    topY + height * 0.3,
    cx + radiusTop,
    topY,
  );
  ctx.closePath();
  inkOutline(ctx, TOWN_TILE_SCALE);
  const iron = ironRamp();
  const bandInsetFractions = [0.16, 0.5, 0.84];
  for (const t of bandInsetFractions) {
    const by = topY + height * t;
    const spread = bulge - ((bulge - radiusTop) * Math.abs(t - 0.5)) / 0.5;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    ctx.fillRect(cx - spread, by - height * 0.03, spread * 2, height * 0.06);
  }
}

// ── Furniture painters ──────────────────────────────────────────────────────

function paintCounter(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const topHeight = frame.tileScale * 0.18;
    const bodyTop = box.bottom - frame.tileScale * 1.05;
    paintPlankBoard(
      ctx,
      box.left,
      bodyTop + topHeight,
      box.width,
      box.bottom - (bodyTop + topHeight),
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: frame.tileScale * 0.3,
        ramp,
      },
    );
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.75));
    ctx.fillRect(box.left, bodyTop, box.width, topHeight);
    ctx.beginPath();
    ctx.rect(box.left, bodyTop, box.width, box.bottom - bodyTop);
    inkOutline(ctx, frame.tileScale);
    if (variant % 2 === 1) {
      ctx.fillStyle = rgba(sampleRamp(ironRamp(), 0.5), 0.7);
      ctx.fillRect(
        box.left + box.width * 0.5 - 1,
        bodyTop + topHeight,
        2,
        box.bottom - bodyTop - topHeight,
      );
    }
    if (variant === COUNTER_TILL_VARIANT) paintCounterTillAndScale(ctx, box, bodyTop, frame);
  });
}

/**
 * The till and a pair of hanging balance scales, standing on the counter's
 * own top surface — the one counter tile a keeper actually rings a sale
 * through, distinct from the plain run either side of it.
 */
function paintCounterTillAndScale(
  ctx: Ctx,
  box: FootprintBox,
  bodyTop: number,
  frame: TownPropFrame,
): void {
  const iron = ironRamp();
  const bookX = box.left + box.width * 0.08;
  const bookW = box.width * 0.14;
  const bookH = frame.tileScale * 0.1;
  ctx.save();
  ctx.translate(bookX, bodyTop - bookH * 0.3);
  ctx.rotate(-Math.PI * 0.06);
  ctx.fillStyle = rgb(mix(sampleRamp(stoneRamp(), 0.9), [255, 255, 255], 0.1));
  ctx.beginPath();
  ctx.rect(-bookW / 2, -bookH / 2, bookW, bookH);
  ctx.fill();
  inkOutline(ctx, frame.tileScale * 0.5);
  ctx.strokeStyle = rgba(sampleRamp(woodRamp(), 0.2), 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -bookH / 2);
  ctx.lineTo(0, bookH / 2);
  ctx.stroke();
  ctx.restore();
  const tillX = box.left + box.width * 0.28;
  const tillW = box.width * 0.3;
  const tillH = frame.tileScale * 0.22;
  ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.45));
  ctx.fillRect(tillX, bodyTop - tillH, tillW, tillH);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.fillRect(tillX + tillW * 0.15, bodyTop - tillH * 0.8, tillW * 0.7, tillH * 0.35);
  ctx.beginPath();
  ctx.rect(tillX, bodyTop - tillH, tillW, tillH);
  inkOutline(ctx, frame.tileScale);

  const scaleX = box.left + box.width * 0.74;
  const postH = frame.tileScale * 0.3;
  const beamW = box.width * 0.22;
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
  ctx.lineWidth = frame.tileScale * 0.025;
  ctx.beginPath();
  ctx.moveTo(scaleX, bodyTop);
  ctx.lineTo(scaleX, bodyTop - postH);
  ctx.moveTo(scaleX - beamW / 2, bodyTop - postH);
  ctx.lineTo(scaleX + beamW / 2, bodyTop - postH);
  ctx.moveTo(scaleX - beamW / 2, bodyTop - postH);
  ctx.lineTo(scaleX - beamW / 2, bodyTop - postH * 0.6);
  ctx.moveTo(scaleX + beamW / 2, bodyTop - postH);
  ctx.lineTo(scaleX + beamW / 2, bodyTop - postH * 0.6);
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
  ctx.beginPath();
  ctx.ellipse(
    scaleX - beamW / 2,
    bodyTop - postH * 0.5,
    frame.tileScale * 0.05,
    frame.tileScale * 0.03,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    scaleX + beamW / 2,
    bodyTop - postH * 0.5,
    frame.tileScale * 0.05,
    frame.tileScale * 0.03,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

// ── Table proportions ───────────────────────────────────────────────────────
const TABLE_TOP_THICKNESS_FRACTION = 0.1;
const TABLE_APRON_HEIGHT_FRACTION = 0.12;
const TABLE_LEG_HEIGHT_FRACTION = 0.34;
const TABLE_LEG_WIDTH_FRACTION = 0.1;
const TABLE_LEG_INSET_FRACTION = 0.12;

/** A small clay mug with a ring handle, sized to sit on a tabletop next to a plate or a candle. */
function paintTableMug(ctx: Ctx, baseX: number, baseY: number, r: number): void {
  ctx.fillStyle = rgb(GOODS_CLAY_BODY);
  ctx.beginPath();
  ctx.ellipse(baseX, baseY - r * 0.4, r * 0.5, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, r);
  ctx.strokeStyle = rgb(GOODS_CLAY_DARK);
  ctx.lineWidth = r * 0.18;
  ctx.beginPath();
  ctx.ellipse(baseX + r * 0.55, baseY - r * 0.4, r * 0.25, r * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * What sits on a table's own top surface, keyed by the same `variant % 3` a
 * run of the same table id already cycles through — a plain surface, a
 * plate of food with a mug, or shop wares (a display table rather than a
 * dining one).
 */
function paintTableItems(
  ctx: Ctx,
  box: FootprintBox,
  topY: number,
  frame: TownPropFrame,
  variant: number,
): void {
  switch (variant % 3) {
    case 1: {
      const plateR = box.width * 0.12;
      ctx.fillStyle = rgb(sampleRamp(stoneRamp(), 0.72));
      ctx.beginPath();
      ctx.ellipse(
        box.centreX,
        topY - frame.tileScale * 0.04,
        plateR,
        plateR * 0.42,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, frame.tileScale * 0.4);
      ctx.fillStyle = rgb(mix(GOODS_CLAY_LIGHT, [214, 158, 90], 0.4));
      ctx.beginPath();
      ctx.ellipse(
        box.centreX,
        topY - frame.tileScale * 0.06,
        plateR * 0.55,
        plateR * 0.28,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      paintTableMug(ctx, box.left + box.width * 0.26, topY, frame.tileScale * 0.1);
      break;
    }
    case 2: {
      // A display table, not a dining one: a jar and a folded cloth, small
      // enough to sit on a tabletop rather than a shelf.
      paintShelfJar(
        ctx,
        box.left + box.width * 0.32,
        topY,
        box.width * 0.22,
        frame.tileScale * 0.22,
        GOODS_CLAY_BODY,
        GOODS_CLAY_DARK,
      );
      paintClothFoldStack(
        ctx,
        box.left + box.width * 0.7,
        topY,
        box.width * 0.24,
        frame.tileScale * 0.16,
        GOODS_CLOTH_WOAD,
      );
      break;
    }
    default:
      paintTableMug(ctx, box.centreX - box.width * 0.14, topY, frame.tileScale * 0.09);
      paintCandleBundle(
        ctx,
        box.centreX + box.width * 0.18,
        topY,
        box.width * 0.14,
        frame.tileScale * 0.14,
      );
      break;
  }
}

function paintTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const topThickness = frame.tileScale * TABLE_TOP_THICKNESS_FRACTION;
    const apronHeight = frame.tileScale * TABLE_APRON_HEIGHT_FRACTION;
    const legHeight = frame.tileScale * TABLE_LEG_HEIGHT_FRACTION;
    const legWidth = frame.tileScale * TABLE_LEG_WIDTH_FRACTION;
    const legInset = box.width * TABLE_LEG_INSET_FRACTION;
    const topY = box.bottom - legHeight - apronHeight - topThickness;
    const apronTop = topY + topThickness;

    // Sturdy legs — a filled post at each end, not a stroked line — a
    // table this size stands on real wood, not wire.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.22));
    for (const legX of [box.left + legInset, box.right - legInset - legWidth]) {
      ctx.fillRect(legX, apronTop + apronHeight, legWidth, legHeight);
    }
    ctx.beginPath();
    ctx.rect(box.left + legInset, apronTop + apronHeight, legWidth, legHeight);
    ctx.rect(box.right - legInset - legWidth, apronTop + apronHeight, legWidth, legHeight);
    inkOutline(ctx, frame.tileScale * 0.5);

    // The apron: a shadowed skirt below the tabletop's front edge, the
    // plane a real table's underside always shows from a 3/4 view.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.24));
    ctx.fillRect(box.left, apronTop, box.width, apronHeight);
    ctx.beginPath();
    ctx.rect(box.left, apronTop, box.width, apronHeight);
    inkOutline(ctx, frame.tileScale * 0.6);

    // The top surface: the dominant shape, a planked top with a lit front edge.
    paintPlankBoard(ctx, box.left, topY, box.width, topThickness, forkRng(rng), {
      direction: 'horizontal',
      boardPx: box.width / Math.max(2, frame.footprintW * 2),
      ramp,
    });
    ctx.fillStyle = rgba(sampleRamp(ramp, 0.85), 0.5);
    ctx.fillRect(box.left, topY, box.width, topThickness * 0.3);
    ctx.beginPath();
    ctx.rect(box.left, topY, box.width, topThickness);
    inkOutline(ctx, frame.tileScale);

    paintTableItems(ctx, box, topY, frame, variant);
  });
}

// ── Chair proportions: a seat seen from above, plus a back ─────────────────
const CHAIR_SEAT_WIDTH_FRACTION = 0.62;
const CHAIR_SEAT_HEIGHT_FRACTION = 0.14;
const CHAIR_SEAT_RISE_FRACTION = 0.4;
const CHAIR_BACK_HEIGHT_FRACTION = 0.36;
const CHAIR_LEG_WIDTH_FRACTION = 0.08;

function paintChair(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const seatW = box.width * CHAIR_SEAT_WIDTH_FRACTION;
    const seatH = frame.tileScale * CHAIR_SEAT_HEIGHT_FRACTION;
    const seatTop = box.bottom - frame.tileScale * CHAIR_SEAT_RISE_FRACTION;
    const seatX = box.centreX - seatW / 2;
    const legW = frame.tileScale * CHAIR_LEG_WIDTH_FRACTION;

    // Two front legs, filled posts rather than a stroked line, peeking
    // below the seat's own front edge.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.26));
    ctx.fillRect(seatX + seatW * 0.08, seatTop + seatH, legW, box.bottom - (seatTop + seatH));
    ctx.fillRect(
      seatX + seatW * 0.92 - legW,
      seatTop + seatH,
      legW,
      box.bottom - (seatTop + seatH),
    );

    // The seat, seen from above — a rounded square, the shape a chair's own
    // cushion or woven bottom reads as at this angle, not a floating bar.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.46 + jitter(forkRng(rng), 0.05)));
    roundedRectPath(ctx, seatX, seatTop, seatW, seatH, seatH * 0.35);
    ctx.fill();
    roundedRectPath(ctx, seatX, seatTop, seatW, seatH, seatH * 0.35);
    inkOutline(ctx, frame.tileScale);

    // The back rail, tall enough to read as a chair rather than a stool.
    const backH = frame.tileScale * CHAIR_BACK_HEIGHT_FRACTION;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.38));
    ctx.fillRect(seatX, seatTop - backH, seatW, backH * 0.6);
    ctx.beginPath();
    ctx.rect(seatX, seatTop - backH, seatW, backH * 0.6);
    inkOutline(ctx, frame.tileScale);
    ctx.strokeStyle = rgb(sampleRamp(ramp, 0.26));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.centreX, seatTop - backH + backH * 0.1);
    ctx.lineTo(box.centreX, seatTop);
    ctx.stroke();
  });
}

// ── Stool proportions: a round seat on splayed legs ─────────────────────────
const STOOL_SEAT_RADIUS_FRACTION = 0.28;
const STOOL_SEAT_HEIGHT_FRACTION = 0.4;
const STOOL_LEG_COUNT = 3;
const STOOL_LEG_WIDTH_FRACTION = 0.045;

function paintStool(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const seatR = box.width * STOOL_SEAT_RADIUS_FRACTION;
    const seatY = box.bottom - frame.tileScale * STOOL_SEAT_HEIGHT_FRACTION;
    const legTopY = seatY + seatR * 0.3;

    // Three splayed legs — the tripod a round stool always stands on,
    // distinct from a chair's straight rectangular legs.
    ctx.strokeStyle = rgb(sampleRamp(ramp, 0.26));
    ctx.lineWidth = frame.tileScale * STOOL_LEG_WIDTH_FRACTION;
    for (let i = 0; i < STOOL_LEG_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / STOOL_LEG_COUNT + Math.PI / 2;
      const footX = box.centreX + Math.cos(angle) * seatR * 0.85;
      const footY = box.bottom - frame.tileScale * 0.04 + Math.sin(angle) * seatR * 0.2;
      ctx.beginPath();
      ctx.moveTo(box.centreX, legTopY);
      ctx.lineTo(footX, footY);
      ctx.stroke();
    }

    // The seat: a round disc, unlike a chair's rectangular top-down cushion.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.48 + jitter(forkRng(rng), 0.05)));
    ctx.beginPath();
    ctx.ellipse(box.centreX, seatY, seatR, seatR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.6);
    if (variant % 2 === 1) {
      // A worn seat ring — the one detail distinguishing the second variant.
      ctx.strokeStyle = rgba(sampleRamp(ramp, 0.3), 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(box.centreX, seatY, seatR * 0.6, seatR * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

// ── Bench proportions: one long seat across the whole footprint ────────────
const BENCH_SEAT_HEIGHT_FRACTION = 0.13;
const BENCH_SEAT_RISE_FRACTION = 0.38;
const BENCH_LEG_WIDTH_FRACTION = 0.07;
const BENCH_LEG_INSET_FRACTION = 0.08;

function paintBenchSeat(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const seatH = frame.tileScale * BENCH_SEAT_HEIGHT_FRACTION;
    const seatTop = box.bottom - frame.tileScale * BENCH_SEAT_RISE_FRACTION;
    const legW = frame.tileScale * BENCH_LEG_WIDTH_FRACTION;
    const legInset = box.width * BENCH_LEG_INSET_FRACTION;

    ctx.fillStyle = rgb(sampleRamp(ramp, 0.26));
    ctx.fillRect(box.left + legInset, seatTop + seatH, legW, box.bottom - (seatTop + seatH));
    ctx.fillRect(
      box.right - legInset - legW,
      seatTop + seatH,
      legW,
      box.bottom - (seatTop + seatH),
    );

    // A long plank seat, full width — the shape that reads as one bench
    // rather than a run of separate chairs.
    paintPlankBoard(ctx, box.left, seatTop, box.width, seatH, forkRng(rng), {
      direction: 'horizontal',
      boardPx: box.width / Math.max(2, frame.footprintW * 2),
      ramp,
    });
    ctx.beginPath();
    ctx.rect(box.left, seatTop, box.width, seatH);
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * One segment of a church pew — full-width flat seat, a solid kick base (not
 * thin legs) and a tall straight back rail, unlike a chair's short slatted
 * back. Placed one per column across a row (the way the
 * temple's rows already ran one `CHAIR` per column), each 1×1 segment's seat
 * and base run edge to edge with no side inset, so a row of them reads as
 * one continuous bench rather than a line of separate chairs.
 */
function paintPew(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const seatH = frame.tileScale * PEW_SEAT_HEIGHT_FRACTION;
    const seatTop = box.bottom - frame.tileScale * PEW_SEAT_RISE_FRACTION;
    const baseH = box.bottom - (seatTop + seatH);
    const backH = frame.tileScale * PEW_BACK_HEIGHT_FRACTION;

    // Base: a solid kick panel down to the floor, not legs — a pew stands on
    // a continuous plinth, and thin legs would show a gap between segments.
    ctx.fillStyle = rgb(sampleRamp(ramp, PEW_BASE_SHADE));
    ctx.fillRect(box.left, seatTop + seatH, box.width, baseH);
    ctx.beginPath();
    ctx.rect(box.left, seatTop + seatH, box.width, baseH);
    inkOutline(ctx, frame.tileScale);

    // Seat, full width so it butts flush against the next segment.
    ctx.fillStyle = rgb(sampleRamp(ramp, PEW_SEAT_SHADE + jitter(forkRng(rng), PEW_JITTER)));
    ctx.fillRect(box.left, seatTop, box.width, seatH);
    ctx.beginPath();
    ctx.rect(box.left, seatTop, box.width, seatH);
    inkOutline(ctx, frame.tileScale);

    // Back rail: tall and straight, the full width of the segment, with a
    // recessed panel and a lit moulded cap so the rank reads as joinery
    // rather than a dark plank at 32 px.
    const backTop = seatTop - backH;
    ctx.fillStyle = rgb(sampleRamp(ramp, PEW_BACK_SHADE));
    ctx.fillRect(box.left, backTop, box.width, backH);
    ctx.beginPath();
    ctx.rect(box.left, backTop, box.width, backH);
    inkOutline(ctx, frame.tileScale);
    const panelInset = frame.tileScale * PEW_PANEL_INSET_FRACTION;
    const capH = frame.tileScale * PEW_CAP_HEIGHT_FRACTION;
    ctx.fillStyle = rgb(sampleRamp(ramp, PEW_SEAM_SHADE));
    ctx.fillRect(
      box.left + panelInset,
      backTop + capH + panelInset * 0.6,
      box.width - panelInset * 2,
      backH - capH - panelInset * 1.4,
    );
    ctx.fillStyle = rgba(sampleRamp(ramp, PEW_HIGHLIGHT_SHADE), PEW_PANEL_LIP_ALPHA);
    ctx.fillRect(
      box.left + panelInset,
      seatTop - panelInset * 0.8 - 1,
      box.width - panelInset * 2,
      Math.max(1, frame.tileScale * PEW_SEAM_WIDTH_FRACTION * 0.6),
    );
    ctx.fillStyle = rgb(sampleRamp(ramp, PEW_CAP_SHADE));
    ctx.fillRect(box.left, backTop, box.width, capH);
    ctx.fillStyle = rgba(sampleRamp(ramp, PEW_HIGHLIGHT_SHADE), PEW_PANEL_LIP_ALPHA);
    ctx.fillRect(box.left, backTop + 1, box.width, Math.max(1, capH * 0.35));
    ctx.beginPath();
    ctx.rect(box.left, backTop, box.width, capH);
    inkOutline(ctx, frame.tileScale * PEW_DETAIL_OUTLINE_FRACTION);

    // The seat's own long cushion, in the dome's sky cloth, running edge to
    // edge so a whole rank carries one blue stripe.
    const cushion = getTownRamp('oc_cloth_sky');
    const cushionH = seatH * PEW_CUSHION_HEIGHT_FRACTION;
    ctx.fillStyle = rgb(sampleRamp(cushion, PEW_CUSHION_SHADE));
    ctx.fillRect(box.left, seatTop - cushionH * 0.4, box.width, cushionH);
    ctx.fillStyle = rgba(sampleRamp(cushion, PEW_CUSHION_LIGHT_SHADE), PEW_PANEL_LIP_ALPHA);
    ctx.fillRect(box.left, seatTop - cushionH * 0.4, box.width, Math.max(1, cushionH * 0.3));

    // Variant 1 carries a book of the office left lying on the seat.
    if (variant === PEW_BOOK_VARIANT) {
      const bookW = frame.tileScale * PEW_BOOK_WIDTH_FRACTION;
      const bookH = frame.tileScale * PEW_BOOK_HEIGHT_FRACTION;
      const bookX = box.left + box.width * PEW_BOOK_OFFSET_FRACTION;
      const bookY = seatTop - bookH * 0.7;
      ctx.fillStyle = rgb(PEW_BOOK_COVER);
      ctx.beginPath();
      ctx.rect(bookX, bookY, bookW, bookH);
      ctx.fill();
      inkOutline(ctx, frame.tileScale * PEW_DETAIL_OUTLINE_FRACTION);
      ctx.fillStyle = rgb(PARCHMENT);
      ctx.fillRect(bookX + 1, bookY + bookH * 0.55, bookW - 2, Math.max(1, bookH * 0.25));
    }
  });
}

// ── Individually painted shelf goods ────────────────────────────────────────
//
// A stocked shelf reads as stocked when each item on it is its own small
// shape — a jar has a neck and a lid, a cloth stack has folds, a coil of
// rope has rings — not when the whole shelf is one row of jittered colour
// blocks. Every helper below draws one item, anchored on its own base point
// (`baseX`, `baseY`) so `shelfGoodsRow` can lay several out across one
// shelf's width without them overlapping.

/** A corked jar: a rounded clay or glazed-glass body, a narrow neck, a lid, and a shine streak. */
function paintShelfJar(
  ctx: Ctx,
  baseX: number,
  baseY: number,
  w: number,
  h: number,
  body: RGB,
  lid: RGB,
): void {
  const neckW = w * 0.5;
  const neckH = h * 0.22;
  const bodyH = h - neckH;
  const bodyTop = baseY - bodyH;
  ctx.fillStyle = rgb(body);
  ctx.beginPath();
  ctx.moveTo(baseX - w / 2, baseY);
  ctx.lineTo(baseX - w / 2, bodyTop + bodyH * 0.3);
  ctx.quadraticCurveTo(baseX - w / 2, bodyTop, baseX - neckW / 2, bodyTop);
  ctx.lineTo(baseX + neckW / 2, bodyTop);
  ctx.quadraticCurveTo(baseX + w / 2, bodyTop, baseX + w / 2, bodyTop + bodyH * 0.3);
  ctx.lineTo(baseX + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(baseX - neckW / 2, bodyTop - neckH, neckW, neckH);
  inkOutline(ctx, w * 0.6);
  ctx.fillStyle = rgba(lid, 0.95);
  ctx.beginPath();
  ctx.ellipse(baseX, bodyTop - neckH, neckW / 2, neckH * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(mix(body, [255, 255, 255], 0.5), 0.4);
  ctx.fillRect(baseX - w * 0.32, bodyTop + bodyH * 0.15, w * 0.14, bodyH * 0.5);
}

/** A stack of folded, dyed cloth — three shallow bands, the middle one lit. */
function paintClothFoldStack(
  ctx: Ctx,
  baseX: number,
  baseY: number,
  w: number,
  h: number,
  colour: RGB,
): void {
  const folds = 3;
  const foldH = h / folds;
  for (let fold = 0; fold < folds; fold++) {
    const y = baseY - h + fold * foldH;
    const tone = fold === 1 ? mix(colour, [255, 255, 255], 0.25) : colour;
    ctx.fillStyle = rgb(tone);
    ctx.fillRect(baseX - w / 2, y, w, foldH * 0.88);
  }
  ctx.strokeStyle = rgba([0, 0, 0], 0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(baseX - w / 2, baseY - h, w, h);
  ctx.stroke();
}

/** A coiled rope, seen from just off top-down: two nested rings and a loose tail. */
function paintRopeCoil(ctx: Ctx, baseX: number, baseY: number, r: number): void {
  ctx.strokeStyle = rgb(GOODS_ROPE);
  ctx.lineWidth = r * 0.34;
  ctx.beginPath();
  ctx.ellipse(baseX, baseY - r * 0.5, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.22;
  ctx.strokeStyle = rgb(mix(GOODS_ROPE, [255, 255, 255], 0.2));
  ctx.beginPath();
  ctx.ellipse(baseX, baseY - r * 0.5, r * 0.58, r * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgb(mix(GOODS_ROPE, [0, 0, 0], 0.25));
  ctx.lineWidth = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(baseX + r * 0.7, baseY - r * 0.2);
  ctx.quadraticCurveTo(baseX + r * 1.1, baseY, baseX + r * 0.85, baseY + r * 0.15);
  ctx.stroke();
}

/** A bundle of tied candles, wax-coloured, standing on end. */
function paintCandleBundle(ctx: Ctx, baseX: number, baseY: number, w: number, h: number): void {
  const count = 3;
  for (let i = 0; i < count; i++) {
    const cx = baseX - w / 2 + (w * (i + 0.5)) / count;
    const stickW = w / count - 1;
    ctx.fillStyle = rgb(i === 1 ? mix(GOODS_CANDLE, [255, 255, 255], 0.15) : GOODS_CANDLE);
    ctx.fillRect(cx - stickW / 2, baseY - h, stickW, h);
    ctx.fillStyle = rgb([120, 78, 40]);
    ctx.fillRect(cx - stickW * 0.12, baseY - h - h * 0.08, stickW * 0.24, h * 0.1);
  }
  ctx.strokeStyle = rgba([0, 0, 0], 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseX - w / 2, baseY - h * 0.4);
  ctx.lineTo(baseX + w / 2, baseY - h * 0.4);
  ctx.stroke();
}

/** Stacked iron pans, rims overlapping, each with a short handle tick. */
function paintPanStack(ctx: Ctx, baseX: number, baseY: number, r: number): void {
  const stack = 2;
  for (let i = 0; i < stack; i++) {
    const y = baseY - i * r * 0.28;
    ctx.fillStyle = rgb(mix(GOODS_PAN, [0, 0, 0], i * 0.15));
    ctx.beginPath();
    ctx.ellipse(baseX, y, r, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, r * 0.5);
    ctx.strokeStyle = rgb(mix(GOODS_PAN, [0, 0, 0], 0.3));
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(baseX + r * 0.9, y);
    ctx.lineTo(baseX + r * 1.35, y - r * 0.1);
    ctx.stroke();
  }
}

/**
 * One shelf's worth of stocked goods, chosen by a `kit` index so consecutive
 * shelves (and different `shelving_unit` variants) don't repeat the same
 * layout. Each kit lays 2–3 items across the shelf's width, each item's own
 * base sitting on the shelf surface (`shelfY`).
 */
function paintShelfGoodsRow(
  ctx: Ctx,
  left: number,
  width: number,
  shelfY: number,
  unitH: number,
  kit: number,
): void {
  const itemH = unitH * 0.3;
  const slot = (index: number, of: number): number => left + (width * (index + 0.5)) / of;
  switch (kit % 5) {
    case 0:
      paintShelfJar(ctx, slot(0, 3), shelfY, width * 0.26, itemH, GOODS_CLAY_BODY, GOODS_CLAY_DARK);
      paintShelfJar(
        ctx,
        slot(1, 3),
        shelfY,
        width * 0.22,
        itemH * 0.85,
        GOODS_CLAY_LIGHT,
        GOODS_CLAY_DARK,
      );
      paintShelfJar(
        ctx,
        slot(2, 3),
        shelfY,
        width * 0.2,
        itemH * 0.7,
        GOODS_GLASS_BODY,
        GOODS_CLAY_DARK,
      );
      break;
    case 1:
      paintClothFoldStack(ctx, slot(0, 3), shelfY, width * 0.28, itemH, GOODS_CLOTH_MADDER);
      paintClothFoldStack(ctx, slot(1, 3), shelfY, width * 0.28, itemH * 0.85, GOODS_CLOTH_WOAD);
      paintClothFoldStack(ctx, slot(2, 3), shelfY, width * 0.28, itemH * 0.7, GOODS_CLOTH_WELD);
      break;
    case 2:
      paintRopeCoil(ctx, slot(0, 2), shelfY, width * 0.24);
      paintCandleBundle(ctx, slot(1, 2), shelfY, width * 0.34, itemH);
      break;
    case 3:
      paintPanStack(ctx, slot(0, 2), shelfY, width * 0.26);
      paintShelfJar(
        ctx,
        slot(1, 2),
        shelfY,
        width * 0.24,
        itemH * 0.8,
        GOODS_GLASS_LIGHT,
        GOODS_CLAY_DARK,
      );
      break;
    default:
      paintClothFoldStack(ctx, slot(0, 3), shelfY, width * 0.26, itemH * 0.9, GOODS_CLOTH_WELD);
      paintShelfJar(
        ctx,
        slot(1, 3),
        shelfY,
        width * 0.22,
        itemH * 0.75,
        GOODS_CLAY_BODY,
        GOODS_CLAY_DARK,
      );
      paintRopeCoil(ctx, slot(2, 3), shelfY, width * 0.18);
      break;
  }
}

function paintShelving(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const top = box.top;
    const shelfCount = 3;
    const unitH = box.bottom - top;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.22));
    ctx.fillRect(box.left, top, box.width, unitH);
    for (let i = 0; i <= shelfCount; i++) {
      const shelfY = top + (unitH * i) / shelfCount;
      paintPlankBoard(ctx, box.left, shelfY, box.width, unitH * 0.08, forkRng(rng), {
        direction: 'horizontal',
        boardPx: box.width,
        ramp,
      });
    }
    // Goods on each shelf: individually painted jars, folded cloth, rope,
    // candles and pans (see `paintShelfGoodsRow`) rather than jittered
    // colour blocks — every shelf reads as stocked, not merely furnished.
    for (let shelf = 0; shelf < shelfCount; shelf++) {
      const shelfTop = top + (unitH * (shelf + 1)) / (shelfCount + 1);
      paintShelfGoodsRow(ctx, box.left, box.width, shelfTop, unitH, variant * 3 + shelf);
    }
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, unitH);
    inkOutline(ctx, frame.tileScale);
  });
}

function paintBarrel(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const onSide = variant % 2 === 1;
    if (!onSide) {
      const height = frame.tileScale * 1.0;
      const topY = box.bottom - height;
      paintBarrelBody(
        ctx,
        box.centreX,
        topY,
        height,
        box.width * 0.32,
        box.width * 0.44,
        ramp,
        rng,
      );
    } else {
      ctx.save();
      ctx.translate(box.centreX, box.bottom - frame.tileScale * 0.42);
      ctx.rotate(Math.PI / 2);
      paintBarrelBody(
        ctx,
        0,
        -frame.tileScale * 0.42,
        frame.tileScale * 0.84,
        box.width * 0.3,
        box.width * 0.4,
        ramp,
        rng,
      );
      ctx.restore();
    }
  });
}

function paintCrate(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const height = frame.tileScale * 0.9;
    paintBox(
      ctx,
      box.left,
      box.bottom - height,
      box.width,
      height,
      frame.tileScale * 0.1,
      woodRamp(),
      rng,
    );
    ctx.strokeStyle = rgba(sampleRamp(ironRamp(), 0.4), 0.6);
    ctx.lineWidth = frame.tileScale * 0.03;
    ctx.beginPath();
    ctx.moveTo(box.left, box.bottom - height);
    ctx.lineTo(box.right, box.bottom);
    ctx.moveTo(box.right, box.bottom - height);
    ctx.lineTo(box.left, box.bottom);
    ctx.stroke();
  });
}

/** Bedding — warm linen and a dyed quilt, never a cool stone ramp, which reads as a slab rather than a mattress. */
const BEDDING_LINEN: RGB = [222, 206, 172];
const BEDDING_LINEN_SHADOW: RGB = [188, 170, 136];
/** A folded wool blanket at the foot of the bed — undyed, distinct from the quilt's own colour. */
const BLANKET_WOOL: RGB = [172, 156, 120];
const BLANKET_WOOL_SHADOW: RGB = [136, 120, 88];
const QUILT_DYES: readonly RGB[] = [
  [150, 54, 46],
  [54, 78, 132],
  [72, 120, 62],
];

// ── Bed proportions ─────────────────────────────────────────────────────────
const BED_FRAME_HEIGHT_FRACTION = 0.74;
const BED_HEADBOARD_HEIGHT_FRACTION = 0.32;
const BED_FOOTBOARD_HEIGHT_FRACTION = 0.12;
const BED_RAIL_WIDTH_FRACTION = 0.07;
const BED_PILLOW_WIDTH_FRACTION = 0.34;
const BED_PILLOW_HEIGHT_FRACTION = 0.24;
const BED_QUILT_HEIGHT_FRACTION = 0.44;
const BED_BLANKET_HEIGHT_FRACTION = 0.16;
const BED_QUILT_STITCH_COUNT = 3;

/**
 * A bed frame, seen from above: a headboard taller than the footboard so it
 * reads head-to-foot, wooden side rails the mattress sits inside rather
 * than a single outlined box (a bounding rectangle around the whole prop is
 * exactly what reads as a locker door, not a bed), a pillow, a channel-
 * quilted quilt and a separately rolled blanket at the foot.
 */
function paintBed(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const frameH = frame.tileScale * BED_FRAME_HEIGHT_FRACTION;
    const frameTop = box.bottom - frameH;
    const headboardH = frameH * BED_HEADBOARD_HEIGHT_FRACTION;
    const headboardTop = frameTop - headboardH;
    const footboardH = frameH * BED_FOOTBOARD_HEIGHT_FRACTION;
    const railW = box.width * BED_RAIL_WIDTH_FRACTION;

    // The headboard: a rounded wooden panel, not a hard-edged slab.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.3));
    roundedRectPath(ctx, box.left, headboardTop, box.width, headboardH, headboardH * 0.3);
    ctx.fill();
    paintGrainOnRect(ctx, box.left, headboardTop, box.width, headboardH, ramp, rng);
    roundedRectPath(ctx, box.left, headboardTop, box.width, headboardH, headboardH * 0.3);
    inkOutline(ctx, frame.tileScale * 0.6);

    // Side rails run the frame's own length; the mattress sits inside them
    // rather than under one outline spanning the whole footprint.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.22));
    ctx.fillRect(box.left, frameTop, railW, frameH);
    ctx.fillRect(box.right - railW, frameTop, railW, frameH);
    ctx.beginPath();
    ctx.rect(box.left, frameTop, railW, frameH);
    ctx.rect(box.right - railW, frameTop, railW, frameH);
    inkOutline(ctx, frame.tileScale * 0.5);

    // The footboard: a short block at the foot, distinct from the mattress
    // above it rather than one continuous panel.
    const footboardTop = box.bottom - footboardH;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.26));
    ctx.fillRect(box.left, footboardTop, box.width, footboardH);
    ctx.beginPath();
    ctx.rect(box.left, footboardTop, box.width, footboardH);
    inkOutline(ctx, frame.tileScale * 0.5);

    const mattressLeft = box.left + railW;
    const mattressRight = box.right - railW;
    const mattressWidth = mattressRight - mattressLeft;
    const mattressTop = frameTop;
    const mattressHeight = footboardTop - frameTop;
    ctx.fillStyle = rgb(BEDDING_LINEN);
    roundedRectPath(
      ctx,
      mattressLeft,
      mattressTop,
      mattressWidth,
      mattressHeight,
      mattressWidth * 0.05,
    );
    ctx.fill();

    // The quilt: a dyed, channel-stitched band across the foot of the
    // mattress — the stitch lines are the pattern a flat dyed rectangle
    // can't show.
    const quilt = QUILT_DYES[variant % QUILT_DYES.length];
    const quiltHeight = mattressHeight * BED_QUILT_HEIGHT_FRACTION;
    const quiltTop = mattressTop + mattressHeight - quiltHeight;
    ctx.fillStyle = rgb(quilt);
    roundedRectPath(ctx, mattressLeft, quiltTop, mattressWidth, quiltHeight, mattressWidth * 0.04);
    ctx.fill();
    ctx.strokeStyle = rgba(mix(quilt, [0, 0, 0], 0.3), 0.6);
    ctx.lineWidth = 1;
    for (let i = 1; i <= BED_QUILT_STITCH_COUNT; i++) {
      const sy = quiltTop + (quiltHeight * i) / (BED_QUILT_STITCH_COUNT + 1);
      ctx.beginPath();
      ctx.moveTo(mattressLeft + mattressWidth * 0.05, sy);
      ctx.lineTo(mattressRight - mattressWidth * 0.05, sy);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(BEDDING_LINEN_SHADOW, 0.6);
    ctx.beginPath();
    ctx.moveTo(mattressLeft, quiltTop);
    ctx.lineTo(mattressRight, quiltTop);
    ctx.stroke();

    // A neatly folded pillow at the head end, plumped rather than flat.
    const pillowW = mattressWidth * BED_PILLOW_WIDTH_FRACTION;
    const pillowH = mattressHeight * BED_PILLOW_HEIGHT_FRACTION;
    const pillowY = mattressTop + frame.tileScale * 0.04;
    ctx.fillStyle = rgb(mix(BEDDING_LINEN, [255, 255, 255], 0.35));
    roundedRectPath(
      ctx,
      mattressLeft + (mattressWidth - pillowW) / 2,
      pillowY,
      pillowW,
      pillowH,
      pillowH * 0.4,
    );
    ctx.fill();
    ctx.strokeStyle = rgba(BEDDING_LINEN_SHADOW, 0.6);
    roundedRectPath(
      ctx,
      mattressLeft + (mattressWidth - pillowW) / 2,
      pillowY,
      pillowW,
      pillowH,
      pillowH * 0.4,
    );
    ctx.stroke();

    // A folded blanket laid across the footboard — rolled, not flat, and a
    // plain wool tone so it never doubles as a second quilt.
    const blanketH = frame.tileScale * BED_BLANKET_HEIGHT_FRACTION;
    const blanketY = footboardTop - blanketH * 0.5;
    ctx.fillStyle = rgb(BLANKET_WOOL);
    roundedRectPath(ctx, box.left, blanketY, box.width, blanketH, blanketH * 0.45);
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.4);
    ctx.fillStyle = rgb(BLANKET_WOOL_SHADOW);
    ctx.beginPath();
    ctx.ellipse(
      box.left + blanketH * 0.5,
      blanketY + blanketH * 0.5,
      blanketH * 0.4,
      blanketH * 0.48,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      box.right - blanketH * 0.5,
      blanketY + blanketH * 0.5,
      blanketH * 0.4,
      blanketH * 0.48,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.3);
  });
}

function paintGrainOnRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const streaks = 3;
  ctx.strokeStyle = rgba(sampleRamp(ramp, 0), 0.15);
  ctx.lineWidth = 1;
  for (let i = 0; i < streaks; i++) {
    const sy = y + jitter(rng, h * 0.3) + h * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, sy);
    ctx.lineTo(x + w, sy + jitter(rng, h * 0.06));
    ctx.stroke();
  }
}

/**
 * A single stone fireplace: a mantel shelf, an arched firebox rather than a
 * flat rectangle, an iron pot hook with a kettle, and a stacked log pile at
 * the foot. One instance is meant to be the whole hearth — placing two side
 * by side repeats the same mantel and reads as a pair of ovens, so a room
 * wanting a fireplace places exactly one of these, not two.
 */
function paintHearth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(
    ctx,
    frame,
    () => {
      const box = footprintBox(frame);
      const height = frame.tileScale * frameHeightFor('hearth');
      const top = box.bottom - height;
      const stone = stoneRamp();
      paintStoneCourses(ctx, box.left, top, box.width, height, stone, rng);
      ctx.beginPath();
      ctx.rect(box.left, top, box.width, height);
      inkOutline(ctx, frame.tileScale);

      // A projecting mantel lip a third of the way down — lighter stone,
      // with its own cast shadow onto the surround below. Held inside the
      // footprint's own width: `withFootprintClip` clips flush to the
      // footprint on both sides, so a true overhang past it is invisible.
      const mantelY = top + height * 0.32;
      const mantelH = frame.tileScale * 0.06;
      ctx.fillStyle = rgb(sampleRamp(stone, 0.72));
      ctx.fillRect(box.left, mantelY, box.width, mantelH);
      ctx.beginPath();
      ctx.rect(box.left, mantelY, box.width, mantelH);
      inkOutline(ctx, frame.tileScale * 0.5);
      ctx.fillStyle = rgba(TOWN_INK, 0.18);
      ctx.fillRect(box.left, mantelY + mantelH, box.width, frame.tileScale * 0.04);

      // The firebox: an arched dark recess below the mantel, not a flat box.
      const mouthW = box.width * 0.62;
      const mouthX = box.centreX - mouthW / 2;
      const mouthBottom = box.bottom - frame.tileScale * 0.04;
      const mouthTop = mantelY + mantelH + frame.tileScale * 0.06;
      const mouthH = mouthBottom - mouthTop;
      ctx.fillStyle = rgb(FLAME_EDGE);
      ctx.beginPath();
      ctx.moveTo(mouthX, mouthBottom);
      ctx.lineTo(mouthX, mouthTop + mouthH * 0.3);
      ctx.quadraticCurveTo(
        box.centreX,
        mouthTop - mouthH * 0.08,
        mouthX + mouthW,
        mouthTop + mouthH * 0.3,
      );
      ctx.lineTo(mouthX + mouthW, mouthBottom);
      ctx.closePath();
      ctx.fill();
      const glow = ctx.createRadialGradient(
        box.centreX,
        mouthBottom - mouthH * 0.25,
        1,
        box.centreX,
        mouthBottom - mouthH * 0.25,
        mouthW * 0.6,
      );
      glow.addColorStop(0, rgb(FLAME_CORE));
      glow.addColorStop(0.55, rgb(FLAME_MID));
      glow.addColorStop(1, rgba(FLAME_MID, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(
        box.centreX,
        mouthBottom - mouthH * 0.22,
        mouthW * 0.4,
        mouthH * 0.32,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = rgba(TOWN_INK, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mouthX, mouthBottom);
      ctx.lineTo(mouthX, mouthTop + mouthH * 0.3);
      ctx.quadraticCurveTo(
        box.centreX,
        mouthTop - mouthH * 0.08,
        mouthX + mouthW,
        mouthTop + mouthH * 0.3,
      );
      ctx.lineTo(mouthX + mouthW, mouthBottom);
      ctx.stroke();

      // An iron pot hook swung out from the mantel's edge, a kettle hanging from it.
      const iron = ironRamp();
      const hookX = box.left + box.width * 0.16;
      const hookTopY = mantelY;
      const hookDropY = hookTopY + frame.tileScale * 0.22;
      ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
      ctx.lineWidth = frame.tileScale * 0.025;
      ctx.beginPath();
      ctx.moveTo(hookX, hookTopY);
      ctx.lineTo(hookX, hookDropY);
      ctx.stroke();
      const kettleR = frame.tileScale * 0.09;
      ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
      ctx.beginPath();
      ctx.ellipse(hookX, hookDropY + kettleR * 0.8, kettleR, kettleR * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, frame.tileScale * 0.4);

      // A small stacked log pile at the foot, opposite the kettle.
      const logRampWood = woodRamp();
      const logY = box.bottom - frame.tileScale * 0.05;
      const logR = frame.tileScale * 0.07;
      const logBaseX = box.right - box.width * 0.2;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = rgb(sampleRamp(logRampWood, 0.3 + jitter(rng, 0.04)));
        ctx.beginPath();
        ctx.ellipse(
          logBaseX - i * logR * 0.9,
          logY - logR * 0.4,
          logR,
          logR * 0.55,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        inkOutline(ctx, frame.tileScale * 0.3);
      }
    },
    frameHeadroomTilesFor('hearth'),
  );
}

function paintForgeBrazier(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const iron = ironRamp();
    const bowlY = box.bottom - frame.tileScale * 0.55;
    const bowlW = box.width * 0.7;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
    ctx.lineWidth = frame.tileScale * 0.04;
    ctx.beginPath();
    ctx.moveTo(box.centreX - bowlW * 0.3, bowlY);
    ctx.lineTo(box.centreX - bowlW * 0.12, box.bottom);
    ctx.moveTo(box.centreX + bowlW * 0.3, bowlY);
    ctx.lineTo(box.centreX + bowlW * 0.12, box.bottom);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
    ctx.beginPath();
    ctx.ellipse(box.centreX, bowlY, bowlW / 2, frame.tileScale * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    const flameH = frame.tileScale * 0.5;
    const glow = ctx.createRadialGradient(
      box.centreX,
      bowlY - flameH * 0.4,
      1,
      box.centreX,
      bowlY - flameH * 0.4,
      bowlW * 0.55,
    );
    glow.addColorStop(0, rgb(FLAME_CORE));
    glow.addColorStop(0.6, rgb(FLAME_MID));
    glow.addColorStop(1, rgba(FLAME_MID, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(box.centreX - bowlW * 0.24, bowlY);
    ctx.quadraticCurveTo(
      box.centreX - bowlW * 0.1,
      bowlY - flameH,
      box.centreX,
      bowlY - flameH * jitter(rng, 0.15) - flameH * 0.85,
    );
    ctx.quadraticCurveTo(
      box.centreX + bowlW * 0.1,
      bowlY - flameH,
      box.centreX + bowlW * 0.24,
      bowlY,
    );
    ctx.closePath();
    ctx.fill();
  });
}

/** Border/field pairings every rug prop shares, so a room mixing a small rug with a runner still reads as one stock of dyed wool. Indexed by `variant % RUG_COLORWAYS.length`. */
const RUG_COLORWAYS: ReadonlyArray<{ readonly border: TownRampId; readonly field: TownRampId }> = [
  { border: 'oc_cloth_ember', field: 'oc_cloth_sky' },
  { border: 'oc_cloth_sky', field: 'oc_cloth_ember' },
  { border: 'oc_sky_icon', field: 'oc_cloth_ember' },
  { border: 'oc_cloth_ember', field: 'oc_sky_icon' },
];

function rugColorway(variant: number): { readonly border: Ramp; readonly field: Ramp } {
  const entry =
    RUG_COLORWAYS[((variant % RUG_COLORWAYS.length) + RUG_COLORWAYS.length) % RUG_COLORWAYS.length];
  return { border: getTownRamp(entry.border), field: getTownRamp(entry.field) };
}

/** A rectangle with all four corners rounded — the rug field's own shape, and general enough to share. */
function roundedRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Roughly one diamond and 3.5 fringe ticks per tile of run, clamped so a short or long mat both read cleanly. */
const RUG_RUNNER_DIAMONDS_PER_TILE = 0.85;
const RUG_RUNNER_FRINGE_PER_TILE = 3.5;
const RUG_RUNNER_DIAMOND_COUNT_MIN = 2;
const RUG_RUNNER_DIAMOND_COUNT_MAX = 10;
const RUG_RUNNER_FRINGE_COUNT_MIN = 3;
const RUG_RUNNER_FRINGE_COUNT_MAX = 12;

/**
 * A long woven rug spanning several tiles as one continuous mat: one field,
 * one border and one pattern for the whole run, plus a fringe of tassels at
 * each short end — the shape a single `rug` tile placed in a row cannot
 * make, since each tile's own border repeats and reads as floor tiling
 * rather than one mat underfoot. Generic over its own footprint, so the
 * same painter serves a short 3-tile runner and a wide multi-tile area rug
 * alike — every count below scales off the footprint rather than a fixed
 * tile span.
 */
function paintRugRunner(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const { border, field } = rugColorway(variant);
    const cornerRadius = Math.min(box.height, frame.tileScale) * 0.22;
    const fieldInset = frame.tileScale * 0.1;
    const fringeLen = frame.tileScale * 0.12;
    const diamondCount = Math.min(
      RUG_RUNNER_DIAMOND_COUNT_MAX,
      Math.max(
        RUG_RUNNER_DIAMOND_COUNT_MIN,
        Math.round(frame.footprintW * RUG_RUNNER_DIAMONDS_PER_TILE),
      ),
    );
    const fringeCount = Math.min(
      RUG_RUNNER_FRINGE_COUNT_MAX,
      Math.max(
        RUG_RUNNER_FRINGE_COUNT_MIN,
        Math.round(frame.footprintH * RUG_RUNNER_FRINGE_PER_TILE),
      ),
    );

    ctx.fillStyle = rgb(sampleRamp(border, 0.42));
    roundedRectPath(ctx, box.left, box.top, box.width, box.height, cornerRadius);
    ctx.fill();

    ctx.fillStyle = rgb(mix(sampleRamp(field, 0.48), sampleRamp(border, 0.3), 0.15));
    roundedRectPath(
      ctx,
      box.left + fieldInset,
      box.top + fieldInset,
      box.width - fieldInset * 2,
      box.height - fieldInset * 2,
      cornerRadius * 0.7,
    );
    ctx.fill();

    // One diamond-chain motif running the whole length, not one per tile.
    ctx.strokeStyle = rgba(sampleRamp(border, 0.2), 0.4);
    ctx.lineWidth = 1;
    const laneTop = box.top + fieldInset * 2;
    const laneH = box.height - fieldInset * 4;
    const laneMidY = laneTop + laneH / 2;
    const diamondW = box.width / diamondCount;
    for (let i = 0; i < diamondCount; i++) {
      const cx = box.left + diamondW * (i + 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, laneTop);
      ctx.lineTo(cx + diamondW * 0.34, laneMidY);
      ctx.lineTo(cx, laneTop + laneH);
      ctx.lineTo(cx - diamondW * 0.34, laneMidY);
      ctx.closePath();
      ctx.stroke();
    }

    // A tassel fringe at each short end, ticked inward from the border
    // rather than drawn past the footprint's own edge — `withFootprintClip`
    // would cut off anything beyond it.
    ctx.strokeStyle = rgba(sampleRamp(border, 0.1), 0.55);
    ctx.lineWidth = 1;
    for (let i = 0; i < fringeCount; i++) {
      const fy = box.top + (box.height * (i + 0.5)) / fringeCount;
      ctx.beginPath();
      ctx.moveTo(box.left, fy);
      ctx.lineTo(box.left + fringeLen, fy);
      ctx.moveTo(box.right, fy);
      ctx.lineTo(box.right - fringeLen, fy);
      ctx.stroke();
    }
  });
}

/** Undyed burlap — a sack's own colour, distinct from the dyed cloth stock and the clay jars either side of it. */
const SACK_BURLAP_DARK: RGB = [94, 74, 44];
const SACK_BURLAP_BODY: RGB = [140, 116, 72];
const SACK_BURLAP_LIGHT: RGB = [174, 148, 98];

function paintSack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    // Taller than it is wide and cinched hard at the neck, so the silhouette
    // reads as a slumped, standing bag rather than a round-bodied pot — a
    // jar's whole point is roundness, so a sack needs to visibly not have it.
    const h = frame.tileScale * 0.74;
    const top = box.bottom - h;
    const neckHalf = box.width * 0.14;
    const neckY = top + h * 0.16;
    const bellyHalf = box.width * 0.36;
    const baseHalf = box.width * 0.3;
    const body = mix(SACK_BURLAP_BODY, [0, 0, 0], jitter(rng, 0.06));
    ctx.fillStyle = rgb(body);
    ctx.beginPath();
    ctx.moveTo(box.centreX - neckHalf, neckY);
    ctx.bezierCurveTo(
      box.centreX - bellyHalf,
      neckY + h * 0.18,
      box.centreX - bellyHalf,
      box.bottom - h * 0.22,
      box.centreX - baseHalf,
      box.bottom,
    );
    ctx.lineTo(box.centreX + baseHalf, box.bottom);
    ctx.bezierCurveTo(
      box.centreX + bellyHalf,
      box.bottom - h * 0.22,
      box.centreX + bellyHalf,
      neckY + h * 0.18,
      box.centreX + neckHalf,
      neckY,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    // A cinched tie just below the gathered neck — thick and dark, the one
    // mark that reads as "tied cloth" rather than a jar's turned rim.
    ctx.fillStyle = rgb(SACK_BURLAP_DARK);
    ctx.fillRect(box.centreX - neckHalf * 1.3, neckY - h * 0.01, neckHalf * 2.6, h * 0.09);
    inkOutline(ctx, frame.tileScale * 0.5);
    // The loose flop of gathered fabric above the tie: ragged and lopsided,
    // never a clean symmetric cap — that asymmetry is what a lid can't do.
    ctx.beginPath();
    ctx.moveTo(box.centreX - neckHalf * 1.1, neckY - h * 0.02);
    ctx.lineTo(box.centreX - neckHalf * 1.3, top + h * 0.02);
    ctx.lineTo(box.centreX - neckHalf * 0.2, top);
    ctx.lineTo(box.centreX + neckHalf * 0.5, top + h * 0.05);
    ctx.lineTo(box.centreX + neckHalf * 0.9, top + h * 0.015);
    ctx.lineTo(box.centreX + neckHalf * 1.1, neckY - h * 0.02);
    ctx.closePath();
    ctx.fillStyle = rgb(mix(body, [0, 0, 0], 0.1));
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.5);
    // A short spill of grain at the base — the cue no jar or crate carries.
    const spillRng = forkRng(rng);
    for (let i = 0; i < 4; i++) {
      const sx = box.centreX + (spillRng() - 0.5) * box.width * 0.5;
      const sy = box.bottom - h * (0.02 + spillRng() * 0.03);
      ctx.fillStyle = rgb(mix(GOODS_ROPE, [0, 0, 0], spillRng() * 0.2));
      ctx.beginPath();
      ctx.ellipse(sx, sy, box.width * 0.035, h * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // A highlight down one side and a fold crease — cloth catches light unevenly, unlike a pot's glaze.
    ctx.fillStyle = rgba(SACK_BURLAP_LIGHT, 0.5);
    ctx.beginPath();
    ctx.ellipse(
      box.left + box.width * 0.32,
      top + h * 0.55,
      box.width * 0.1,
      h * 0.22,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = rgba(SACK_BURLAP_DARK, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.centreX + box.width * 0.05, top + h * 0.35);
    ctx.quadraticCurveTo(
      box.centreX + box.width * 0.18,
      top + h * 0.6,
      box.centreX + box.width * 0.08,
      box.bottom - h * 0.1,
    );
    ctx.stroke();
  });
}

// ── Wall-mounted dressing (library only — not placed by the ported rooms) ──

function paintWallShelfGoods(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  paintShelving(ctx, frame, variant, rng);
}

function paintHangingTools(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const rail = frame.tileScale * 0.08;
    const top = box.top + frame.tileScale * 0.2;
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.4));
    ctx.fillRect(box.left, top, box.width, rail);
    const iron = ironRamp();
    const tools = 3;
    for (let i = 0; i < tools; i++) {
      const tx = box.left + (box.width * (i + 0.5)) / tools;
      const length = frame.tileScale * (0.3 + jitter(rng, 0.06));
      ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
      ctx.lineWidth = frame.tileScale * 0.035;
      ctx.beginPath();
      ctx.moveTo(tx, top + rail);
      ctx.lineTo(tx, top + rail + length);
      ctx.stroke();
      ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
      ctx.beginPath();
      ctx.ellipse(
        tx,
        top + rail + length,
        frame.tileScale * 0.08,
        frame.tileScale * 0.04,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

/** A warm daylight tone for a shop window's glow — the street outside, not a lamp. */
const WINDOW_DAYLIGHT_GLOW: RGB = [246, 224, 176];

function paintWindowDressing(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const inset = frame.tileScale * 0.14;
    ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.3));
    ctx.fillRect(box.left, box.top, box.width, box.height);
    paintGlazing(
      ctx,
      box.left + inset,
      box.top + inset,
      box.width - inset * 2,
      box.height - inset * 2,
      {
        wallRamp: getTownRamp('oc_cloth_sky'),
        trimRamp: woodRamp(),
        glowColor: WINDOW_DAYLIGHT_GLOW,
      },
    );
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * A price board: a pinned sheet per column with short chalk-tick lines
 * standing in for a price list — legible as "words are written here"
 * without spelling anything (the room's props never carry real text).
 */
function paintNoticeBoard(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    paintPlankBoard(ctx, box.left, box.top, box.width, box.height, rng, {
      direction: 'vertical',
      boardPx: box.width / 3,
      ramp: woodRamp(),
    });
    const sheets = 2;
    for (let i = 0; i < sheets; i++) {
      const sx = box.left + box.width * (0.2 + i * 0.4);
      const sy = box.top + box.height * 0.25;
      const sw = box.width * 0.3;
      const sh = box.height * 0.45;
      ctx.fillStyle = rgb(sampleRamp(stoneRamp(), 0.85));
      ctx.fillRect(sx, sy, sw, sh);
      inkOutline(ctx, frame.tileScale);
      const chalkRows = 4;
      const rowRng = forkRng(rng);
      ctx.strokeStyle = rgba(sampleRamp(ironRamp(), 0.3), 0.55);
      ctx.lineWidth = 1;
      for (let row = 0; row < chalkRows; row++) {
        const ry = sy + sh * (0.2 + (row * 0.6) / chalkRows);
        const rowW = sw * (0.4 + rowRng() * 0.4);
        ctx.beginPath();
        ctx.moveTo(sx + sw * 0.12, ry);
        ctx.lineTo(sx + sw * 0.12 + rowW, ry);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    inkOutline(ctx, frame.tileScale);
  });
}

function paintLampCandle(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const baseY = box.bottom - frame.tileScale * 0.08;
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.4));
    ctx.fillRect(
      box.centreX - frame.tileScale * 0.08,
      baseY - frame.tileScale * 0.05,
      frame.tileScale * 0.16,
      frame.tileScale * 0.05,
    );
    const flameH = frame.tileScale * 0.18;
    const glow = ctx.createRadialGradient(
      box.centreX,
      baseY - flameH,
      1,
      box.centreX,
      baseY - flameH,
      frame.tileScale * 0.3,
    );
    glow.addColorStop(0, rgb(FLAME_CORE));
    glow.addColorStop(1, rgba(FLAME_MID, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      baseY - flameH,
      frame.tileScale * 0.3,
      frame.tileScale * 0.3,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = rgb(FLAME_CORE);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      baseY - flameH * 0.6,
      frame.tileScale * 0.05,
      frame.tileScale * 0.09,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
}

// ── Height table (tiles of art above the footprint) ─────────────────────────

const PROP_ART_HEIGHT_TILES: Record<string, number> = {
  counter: 1.05,
  table_small: 0.5,
  table_medium: 0.5,
  chair: 0.55,
  stool: 0.4,
  bench_seat: 0.55,
  shelving_unit: 1.6,
  wall_shelf_goods: 1.2,
  hanging_tools: 0.7,
  window_dressing: 1.4,
  notice_board: 1.1,
  lamp_candle: 0.4,
  barrel: 1.0,
  crate: 0.9,
  sack: 0.68,
  bed_single: 0.87,
  hearth_wide: 1.6,
  forge_brazier: 1.1,
  altar: 1.4,
  lectern: 1.1,
  sky_banner: 1.8,
  temple_dais: 0,
  sky_window: 1.0,
  temple_candelabrum: 1.75,
  perch_stand: 2.0,
  votive_rack: 0.9,
  sky_font: 0.85,
  offering_table: 0.6,
  rug_runner: 0,
  rug_runner_3: 0,
  rug_runner_4: 0,
  rug_runner_5: 0,
  rug_small: 0,
  rug_medium: 0,
  rug_large: 0,
  rug_ring: 0,
  jars: 0.42,
  crockery_shelf: 1.2,
  basket: 0.5,
  oil_lamp: 0.4,
  chest: 0.66,
  coat_hook: 0.9,
  drawer_unit: 0.62,
  shop_bell: 0.3,
  offering_bowl: 0.4,
  open_crate: 0.95,
  potion_shelf: 1.2,
  perch_rail: 1.5,
  feather_duster: 0.7,
  anvil: 1.1,
  grindstone: 0.8,
  blade_rack: 0.8,
  quench_trough: 0.85,
  coal_bin: 0.4,
  wheelwright_stand: 0.35,
  wagon_bed: 0.4,
  lathe: 1.4,
  joiner_bench: 1.1,
  shaving_horse: 0.2,
  firewood_stack: 0.4,
  spoke_tub: 0.3,
  glue_pot: 0.5,
  shavings_floor: 0,
  axle_set: 0.2,
  plank_pile: 0.2,
  armour_stand: 1.3,
  millstone: 1.0,
  grain_scale: 1.0,
  crawler_scraps: 0.5,
  field_log: 0.4,
  cellar_hatch: 0,
  lodge_map_table: 0.25,
  lodge_bunk: 1.0,
  lodge_spear_rack: 1.0,
  lodge_duty_board: 0.75,
  lodge_stove: 1.5,
  lodge_kit_pegs: 0.5,
  kessler_footlocker: 0.2,
  cellar_trapdoor: 0,
  drafting_table: 1.05,
  plan_chest: 0.75,
  roll_bin: 0.4,
  tool_wall: 1.05,
  door_on_trestles: 0.1,
  builders_hearth: 1.0,
  good_chair: 0.55,
  dairy_wall: 1.05,
  churn_stand: 0.4,
  milking_stool: 0.1,
  feed_stack: 0.2,
  made_cot: 0.45,
  pail_stack: 0.1,
  door_peg_post: 0.75,
  boot_tray: 0.1,
  offcut_box: 0.1,
  stair_shelf: 0.6,
  timber_stack: 0.2,
  supper_table: 0.3,
  tool_chest: 0.2,
  inn_hearth: 1.8,
  inn_back_bar: 1.95,
  inn_bar: 0.75,
  inn_dresser: 1.65,
  cat_stool: 0.2,
  fireside_chair: 0.3,
  log_basket: 0.2,
  inn_table: 0.3,
  inn_bench: 0,
  inn_guest_bed: 0.6,
  inn_cot: 0.35,
  rag_rug: 0,
  rag_rug_small: 0,
  rag_runner: 0,
  washstand: 0.8,
  cat_portrait: 0.9,
  dairy_churn: 0.85,
  cask_rack: 1.2,
  tab_ledger: 0.7,
  flagon_hearth: 1.0,
  guild_booth: 1.0,
  booth_screen: 1.3,
  booth_table: 0.45,
  feast_table: 0.5,
  feast_bench: 0,
  flagon_back_bar: 1.0,
  flagon_bar: 0.8,
  flagon_trophy: 0.7,
  torchere: 0.9,
  trestle_table: 0.45,
  flagon_carpet: 0,
  flagon_hearth_rug: 0,
  flagon_runner: 0,
  coat_rack: 0.75,
  flagon_chair: 0.6,
  deal_bench: 0,
  flagon_sideboard: 0.55,
  trophy_banner: 1.1,
  dartboard: 0.8,
  bolted_door: 1.0,
  stump_back_shelf: 1.0,
  stump_bar: 0.65,
  chalk_tally: 0.8,
  dice_table: 0.4,
  stump_table: 0.3,
  barrel_table: 0.2,
  keg_stack: 0.45,
  junk_heap: 0.3,
  floor_stain: 0,
  smoky_lamp: 0.65,
  stump_stove: 1.0,
  broom: 0.95,
  mushroom_basket: 0.5,
  jar_dresser: 1.0,
  witch_hearth: 1.35,
  drying_beam: 0.85,
  witch_worktable: 0.6,
  cat_armchair: 0.5,
  book_heap: 0.4,
  birdcage_stand: 0.7,
  crock_cluster: 0.3,
  cottage_bed: 0.5,
  still: 0.7,
  apothecary_drawer_wall: 1.7,
  apothecary_counter: 0.75,
  herb_drying_rack: 0.75,
  herb_bins: 0.1,
  remedy_display: 0.2,
  specimen_case: 0.55,
  potted_bay: 0.9,
  sorting_table: 0.1,
  potting_bench: 0.45,
  live_herb_pots: 0.75,
  forge: 1.9,
  bar_stock: 0.9,
  smith_bellows: 0.6,
  smith_tool_wall: 0.8,
  smith_counter: 0.4,
  coal_heap: 0.45,
  ironmongery_table: 0.3,
  mail_stand: 0.55,
  slack_tub: 0.2,
  forge_floor: 0,
  mandrel_swage: 0.55,
  vice_bench: 0.75,
  wheel_build_stand: 0.1,
  timber_rack: 1.0,
  sawhorse: 0.3,
  pot_rack: 0.9,
  flour_bin: 0.7,
  sieve_rack: 1.0,
  hand_cart: 0.9,
  farm_hearth: 1.6,
  farm_table: 0.2,
  bake_trough: 0.6,
  farm_dresser: 1.0,
  larder_shelf: 0.9,
  corvin_pallet: 0.75,
  flour_sack_stack: 0.6,
  flour_drift: 0,
  grain_bin: 0.5,
  needle_tray: 0.75,
  feather_chart: 1.0,
  flash_wall: 1.05,
  ink_chair: 0.8,
  pigment_cabinet: 1.0,
  arm_lamp: 1.6,
  grinding_bench: 0.95,
  settee: 0.6,
  low_table: 0.55,
  side_table: 0.45,
  coat_stand: 1.8,
  garrison_weapon_rack: 1.1,
  armour_stand_row: 1.3,
  issue_counter: 0.8,
  straw_dummy: 0.95,
  pell_post: 0.8,
  archery_butt: 0.9,
  drill_slate: 1.0,
  water_trough: 0.3,
  sandbags: 0.5,
  bunk_bed: 1.3,
  muster_board: 1.3,
  briefing_table: 0.1,
  sparring_ring: 0,
  goods_wall: 1.85,
  potion_cabinet: 1.9,
  store_counter: 1.0,
  counter_bell_end: 0.9,
  display_table: 0.5,
  bulk_bins: 0.6,
  tool_barrel: 1.6,
  dynamite_crate: 0.4,
  clerk_desk: 1.2,
  stock_stack: 0.7,
  sack_pile: 0.5,
  crock_stack: 0.4,
  records_cabinet: 1.45,
  pigeonhole_wall: 1.75,
  scrivener_desk: 1.0,
  magistrate_desk: 1.3,
  archive_boxes: 1.0,
  writ_board: 1.6,
  coil_bench: 1.25,
  conduit_coil: 2.1,
  petition_counter: 1.1,
  tower_hearth: 1.0,
};

function frameHeightFor(id: string): number {
  return PROP_ART_HEIGHT_TILES[id] ?? 1;
}

function frameHeadroomTilesFor(id: string): number {
  return Math.max(1, Math.ceil(frameHeightFor(id)) + 1);
}

// ── Break cues and drop tables (reused across every destructible interior prop) ──

const BREAK_CUES_WOOD: readonly [SoundId, ...SoundId[]] = ['wood_smashing_1', 'wood_smashing_2'];
const BREAK_CUES_WOOD_LIGHT: readonly [SoundId, ...SoundId[]] = [
  'wood_breaking_1',
  'wood_breaking_2',
  'wood_breaking_3',
];
const BREAK_CUES_GLASS: readonly [SoundId, ...SoundId[]] = [
  'glass_break_1',
  'glass_break_2',
  'glass_break_3',
  'glass_break_4',
];
const BREAK_CUES_CANDLE_STAND: readonly [SoundId, ...SoundId[]] = [
  'candle_stand_topple_1',
  'candle_stand_topple_2',
];
const BREAK_CUES_SACK: readonly [SoundId, ...SoundId[]] = [
  'garbage_bag_burst_1',
  'garbage_bag_burst_2',
];

const DESTRUCTIBLE_BARREL: TownInteriorDestructibleSpec = {
  kind: 'barrel',
  hp: 6,
  breakCues: BREAK_CUES_WOOD,
  coinsMin: 1,
  coinsMax: 2,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_CRATE: TownInteriorDestructibleSpec = {
  kind: 'crate',
  hp: 6,
  breakCues: BREAK_CUES_WOOD,
  coinsMin: 1,
  coinsMax: 2,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_SHELF: TownInteriorDestructibleSpec = {
  kind: 'shelf',
  hp: 8,
  breakCues: BREAK_CUES_WOOD,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_BRAZIER: TownInteriorDestructibleSpec = {
  kind: 'brazier',
  hp: 9,
  breakCues: BREAK_CUES_WOOD_LIGHT,
  coinsMin: 1,
  coinsMax: 2,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_CANDELABRUM: TownInteriorDestructibleSpec = {
  ...DESTRUCTIBLE_BRAZIER,
  kind: 'candelabrum',
  breakCues: BREAK_CUES_CANDLE_STAND,
};
const DESTRUCTIBLE_SACK: TownInteriorDestructibleSpec = {
  kind: 'sack',
  hp: 3,
  breakCues: BREAK_CUES_SACK,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_JARS: TownInteriorDestructibleSpec = {
  kind: 'jars',
  hp: 2,
  breakCues: BREAK_CUES_GLASS,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_CROCKERY: TownInteriorDestructibleSpec = {
  kind: 'crockery',
  hp: 3,
  breakCues: BREAK_CUES_GLASS,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_BASKET: TownInteriorDestructibleSpec = {
  kind: 'basket',
  hp: 3,
  breakCues: BREAK_CUES_WOOD_LIGHT,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_LAMP: TownInteriorDestructibleSpec = {
  kind: 'lamp',
  hp: 2,
  breakCues: BREAK_CUES_GLASS,
  coinsMin: 0,
  coinsMax: 0,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_CHAIR: TownInteriorDestructibleSpec = {
  kind: 'chair',
  hp: 4,
  breakCues: BREAK_CUES_WOOD_LIGHT,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_STOOL: TownInteriorDestructibleSpec = {
  kind: 'stool',
  hp: 3,
  breakCues: BREAK_CUES_WOOD_LIGHT,
  coinsMin: 0,
  coinsMax: 1,
  dropsLootByDefault: true,
};
const DESTRUCTIBLE_TABLE: TownInteriorDestructibleSpec = {
  kind: 'table',
  hp: 7,
  breakCues: BREAK_CUES_WOOD,
  coinsMin: 0,
  coinsMax: 2,
  dropsLootByDefault: true,
};

// ── New furniture painters (containers, dressing, use props) ───────────────

function paintJars(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const clay = getTownRamp('oc_cloth_ember');
    const jarCount = 3;
    for (let i = 0; i < jarCount; i++) {
      const jw = box.width / (jarCount + 0.6);
      const jx = box.left + box.width * ((i + 0.7) / jarCount);
      const jh =
        frame.tileScale * (0.32 + jitter(forkRng(rng), 0.08) + (i === variant % 3 ? 0.1 : 0));
      const jy = box.bottom - jh;
      ctx.fillStyle = rgb(sampleRamp(clay, 0.45 + i * 0.08));
      ctx.beginPath();
      ctx.moveTo(jx - jw * 0.22, box.bottom);
      ctx.quadraticCurveTo(jx - jw * 0.3, jy + jh * 0.4, jx - jw * 0.16, jy + jh * 0.12);
      ctx.lineTo(jx - jw * 0.1, jy);
      ctx.lineTo(jx + jw * 0.1, jy);
      ctx.lineTo(jx + jw * 0.16, jy + jh * 0.12);
      ctx.quadraticCurveTo(jx + jw * 0.3, jy + jh * 0.4, jx + jw * 0.22, box.bottom);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
    }
  });
}

function paintCrockeryShelf(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const shelfCount = 2;
    const unitH = box.bottom - box.top;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.22));
    ctx.fillRect(box.left, box.top, box.width, unitH);
    const stoneware = stoneRamp();
    for (let shelf = 0; shelf < shelfCount; shelf++) {
      const shelfY = box.top + (unitH * (shelf + 1)) / (shelfCount + 1);
      paintPlankBoard(ctx, box.left, shelfY, box.width, unitH * 0.1, forkRng(rng), {
        direction: 'horizontal',
        boardPx: box.width,
        ramp,
      });
      // A stack of plates on edge and a row of hung mugs — a crockery shelf
      // reads by silhouette, never a shelving unit's jittered goods blocks.
      const plateCount = 3;
      for (let p = 0; p < plateCount; p++) {
        const px = box.left + box.width * (0.18 + (p / plateCount) * 0.35);
        const r = unitH * 0.08;
        ctx.fillStyle = rgb(sampleRamp(stoneware, 0.8 + jitter(rng, 0.06)));
        ctx.beginPath();
        ctx.ellipse(px, shelfY - r * 0.9, r * 0.32, r, 0, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, frame.tileScale);
      }
      const mugCount = variant % 2 === 0 ? 2 : 3;
      for (let m = 0; m < mugCount; m++) {
        const mx = box.left + box.width * (0.65 + (m / mugCount) * 0.28);
        const mh = unitH * 0.09;
        ctx.fillStyle = rgb(sampleRamp(stoneware, 0.6));
        ctx.fillRect(mx - mh * 0.28, shelfY - mh, mh * 0.56, mh);
        inkOutline(ctx, frame.tileScale);
      }
    }
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, unitH);
    inkOutline(ctx, frame.tileScale);
  });
}

function paintBasket(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const h = frame.tileScale * 0.5;
    const top = box.bottom - h;
    const topW = box.width * 0.82;
    const bottomW = box.width * 0.62;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.5 + jitter(rng, 0.05)));
    ctx.beginPath();
    ctx.moveTo(box.centreX - bottomW / 2, box.bottom);
    ctx.lineTo(box.centreX - topW / 2, top);
    ctx.lineTo(box.centreX + topW / 2, top);
    ctx.lineTo(box.centreX + bottomW / 2, box.bottom);
    ctx.closePath();
    ctx.fill();
    const weaveRows = 4;
    ctx.strokeStyle = rgba(sampleRamp(ramp, 0.2), 0.5);
    ctx.lineWidth = 1;
    for (let i = 1; i < weaveRows; i++) {
      const wy = top + (h * i) / weaveRows;
      const t = i / weaveRows;
      const halfW = (bottomW / 2) * t + (topW / 2) * (1 - t);
      ctx.beginPath();
      ctx.moveTo(box.centreX - halfW, wy);
      ctx.lineTo(box.centreX + halfW, wy);
      ctx.stroke();
    }
    inkOutline(ctx, frame.tileScale);
    if (variant % 2 === 1) {
      // A folded cloth over the rim, so a run of baskets doesn't read as copies.
      ctx.fillStyle = rgb(sampleRamp(getTownRamp('oc_cloth_sky'), 0.6));
      ctx.fillRect(box.centreX - topW * 0.3, top - h * 0.1, topW * 0.6, h * 0.16);
      inkOutline(ctx, frame.tileScale);
    }
  });
}

function paintOilLamp(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const iron = ironRamp();
    const baseY = box.bottom - frame.tileScale * 0.06;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.beginPath();
    ctx.ellipse(box.centreX, baseY, box.width * 0.22, frame.tileScale * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    const bodyH = frame.tileScale * 0.28;
    const bodyTop = baseY - bodyH;
    ctx.fillStyle = rgba(sampleRamp(stoneRamp(), 0.75), 0.85);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      bodyTop + bodyH * 0.6,
      box.width * 0.16,
      bodyH * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    const flameH = frame.tileScale * (0.16 + jitter(rng, 0.03));
    const glow = ctx.createRadialGradient(
      box.centreX,
      bodyTop - flameH * 0.2,
      1,
      box.centreX,
      bodyTop - flameH * 0.2,
      frame.tileScale * 0.22,
    );
    glow.addColorStop(0, rgb(FLAME_CORE));
    glow.addColorStop(1, rgba(FLAME_MID, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      bodyTop - flameH * 0.2,
      frame.tileScale * 0.22,
      frame.tileScale * 0.22,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = rgb(FLAME_CORE);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      bodyTop - flameH * 0.35,
      frame.tileScale * 0.04,
      flameH * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
}

function paintChest(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const bodyH = frame.tileScale * 0.5;
    const lidH = frame.tileScale * 0.16;
    const bodyTop = box.bottom - bodyH;
    paintPlankBoard(ctx, box.left, bodyTop, box.width, bodyH, forkRng(rng), {
      direction: 'vertical',
      boardPx: box.width / 3,
      ramp,
    });
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.35));
    ctx.fillRect(box.left, bodyTop - lidH, box.width, lidH);
    ctx.beginPath();
    ctx.rect(box.left, bodyTop - lidH, box.width, lidH + bodyH);
    inkOutline(ctx, frame.tileScale);
    const iron = ironRamp();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    ctx.fillRect(box.centreX - box.width * 0.05, bodyTop - lidH * 0.3, box.width * 0.1, lidH * 0.6);
    ctx.fillRect(box.left, bodyTop, box.width * 0.06, bodyH);
    ctx.fillRect(box.right - box.width * 0.06, bodyTop, box.width * 0.06, bodyH);
  });
}

function paintCoatHook(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const pegY = box.top + frame.tileScale * 0.22;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    ctx.beginPath();
    ctx.arc(box.centreX, pegY, frame.tileScale * 0.05, 0, Math.PI * 2);
    ctx.fill();
    const cloth = variant % 2 === 0 ? getTownRamp('oc_cloth_ember') : getTownRamp('oc_cloth_sky');
    const coatH = frame.tileScale * 0.62;
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.5));
    ctx.beginPath();
    ctx.moveTo(box.centreX, pegY);
    ctx.lineTo(box.centreX - box.width * 0.24, pegY + frame.tileScale * 0.1);
    ctx.lineTo(box.centreX - box.width * 0.2, pegY + coatH);
    ctx.lineTo(box.centreX + box.width * 0.2, pegY + coatH);
    ctx.lineTo(box.centreX + box.width * 0.24, pegY + frame.tileScale * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
  });
}

function paintDrawerUnit(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const height = frame.tileScale * 0.62;
    const top = box.bottom - height;
    paintPlankBoard(ctx, box.left, top, box.width, height, forkRng(rng), {
      direction: 'horizontal',
      boardPx: height / 3,
      ramp,
    });
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, height);
    inkOutline(ctx, frame.tileScale);
    const drawerCount = 3;
    const iron = ironRamp();
    for (let i = 0; i < drawerCount; i++) {
      const dy = top + (height * (i + 0.5)) / drawerCount;
      ctx.strokeStyle = rgba(sampleRamp(ramp, 0.15), 0.6);
      ctx.beginPath();
      ctx.moveTo(box.left, top + (height * (i + 1)) / drawerCount);
      ctx.lineTo(box.right, top + (height * (i + 1)) / drawerCount);
      ctx.stroke();
      ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
      ctx.beginPath();
      ctx.ellipse(
        box.centreX,
        dy,
        box.width * 0.05,
        (height / drawerCount) * 0.08,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

function paintShopBell(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const baseY = box.bottom - frame.tileScale * 0.1;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.fillRect(
      box.centreX - box.width * 0.14,
      baseY - frame.tileScale * 0.02,
      box.width * 0.28,
      frame.tileScale * 0.05,
    );
    const domeH = frame.tileScale * 0.24;
    const domeTop = baseY - domeH;
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.beginPath();
    ctx.moveTo(box.centreX - box.width * 0.18, baseY);
    ctx.quadraticCurveTo(box.centreX - box.width * 0.18, domeTop, box.centreX, domeTop);
    ctx.quadraticCurveTo(
      box.centreX + box.width * 0.18,
      domeTop,
      box.centreX + box.width * 0.18,
      baseY,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.arc(box.centreX, domeTop, frame.tileScale * 0.035, 0, Math.PI * 2);
    ctx.fill();
  });
}

function paintOfferingBowl(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const stone = stoneRamp();
    const bowlY = box.bottom - frame.tileScale * 0.18;
    const bowlW = box.width * 0.6;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.45));
    ctx.fillRect(
      box.centreX - frame.tileScale * 0.08,
      bowlY,
      frame.tileScale * 0.16,
      frame.tileScale * 0.2,
    );
    ctx.fillStyle = rgb(sampleRamp(stone, 0.6));
    ctx.beginPath();
    ctx.ellipse(box.centreX, bowlY, bowlW / 2, frame.tileScale * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    ctx.fillStyle = rgba(BRASS_BRIGHT, 0.9);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      bowlY - frame.tileScale * 0.015,
      bowlW * 0.38,
      frame.tileScale * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
}

/**
 * A stock crate with its lid pried and leaning against the side, contents
 * visible above the rim — the storeroom's one opened crate (the searchable
 * one), distinct at a glance from the sealed crates around it.
 */
function paintOpenCrate(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const height = frame.tileScale * 0.7;
    const top = box.bottom - height;
    paintPlankBoard(ctx, box.left, top, box.width, height, forkRng(rng), {
      direction: 'vertical',
      boardPx: box.width / 3,
      ramp,
    });
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, height);
    inkOutline(ctx, frame.tileScale);

    // Contents peeking over the rim — a couple of jittered goods blocks, the
    // same silhouette language `paintShelving` uses for stock.
    const goods = 2;
    for (let g = 0; g < goods; g++) {
      const gw = box.width / (goods + 1);
      const gx = box.left + gw * (g + 0.7);
      const gh = height * (0.22 + jitter(rng, 0.05));
      ctx.fillStyle = rgb(sampleRamp(stoneRamp(), 0.55 + g * 0.1));
      ctx.fillRect(gx - gw * 0.2, top - gh * 0.5, gw * 0.4, gh);
      inkOutline(ctx, frame.tileScale);
    }

    // The pried lid, leaned against the crate's own side rather than sealed
    // across the top — the cue that this one has already been searched open.
    ctx.save();
    ctx.translate(box.right - box.width * 0.06, top + height * 0.3);
    ctx.rotate(Math.PI * 0.14);
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.3));
    ctx.fillRect(-box.width * 0.06, -height * 0.4, box.width * 0.12, height * 0.75);
    ctx.strokeStyle = rgba(sampleRamp(ironRamp(), 0.4), 0.7);
    inkOutline(ctx, frame.tileScale);
    ctx.restore();
  });
}

/**
 * A shelf of corked potion vials, each a different dyed liquid — reads by
 * colour and bottle silhouette, never `paintCrockeryShelf`'s plates and mugs
 * or `paintShelving`'s jittered goods blocks.
 */
function paintPotionShelf(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const unitH = box.bottom - box.top;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.22));
    ctx.fillRect(box.left, box.top, box.width, unitH);
    const shelfCount = 2;
    for (let shelf = 0; shelf < shelfCount; shelf++) {
      const shelfY = box.top + (unitH * (shelf + 1)) / (shelfCount + 1);
      paintPlankBoard(ctx, box.left, shelfY, box.width, unitH * 0.08, forkRng(rng), {
        direction: 'horizontal',
        boardPx: box.width,
        ramp,
      });
      const vialCount = 4;
      for (let v = 0; v < vialCount; v++) {
        const vx = box.left + box.width * ((v + 0.5) / vialCount);
        const vh = unitH * (0.16 + jitter(rng, 0.03));
        const vw = box.width * 0.09;
        const liquid = POTION_LIQUID_COLORS[(v + shelf + variant) % POTION_LIQUID_COLORS.length];
        ctx.fillStyle = rgb(liquid);
        ctx.beginPath();
        ctx.rect(vx - vw / 2, shelfY - vh, vw, vh * 0.8);
        ctx.fill();
        inkOutline(ctx, frame.tileScale);
        ctx.fillStyle = rgb(sampleRamp(ramp, 0.35));
        ctx.fillRect(vx - vw * 0.22, shelfY - vh - vh * 0.22, vw * 0.44, vh * 0.22);
      }
    }
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, unitH);
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * A horizontal perch rail on iron wall brackets, set high enough that a
 * skyfowl reaches it by wing rather than by climbing — the counter's own
 * off-duty roost, not a piece of shop furniture.
 */
function paintPerchRail(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const railY = box.top + frame.tileScale * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
    ctx.lineWidth = frame.tileScale * 0.03;
    const bracketInset = box.width * 0.16;
    ctx.beginPath();
    ctx.moveTo(box.left + bracketInset, railY - frame.tileScale * 0.16);
    ctx.lineTo(box.left + bracketInset, railY);
    ctx.moveTo(box.right - bracketInset, railY - frame.tileScale * 0.16);
    ctx.lineTo(box.right - bracketInset, railY);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.4));
    ctx.fillRect(box.left, railY, box.width, frame.tileScale * 0.06);
    ctx.beginPath();
    ctx.rect(box.left, railY, box.width, frame.tileScale * 0.06);
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * A feather duster hung by its handle — the keeper's own housekeeping tool,
 * distinct from `paintHangingTools`' iron rail by its soft, rounded head.
 */
function paintFeatherDuster(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const pegY = box.top + frame.tileScale * 0.22;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    ctx.beginPath();
    ctx.arc(box.centreX, pegY, frame.tileScale * 0.04, 0, Math.PI * 2);
    ctx.fill();
    const handleH = frame.tileScale * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(woodRamp(), 0.35));
    ctx.lineWidth = frame.tileScale * 0.035;
    ctx.beginPath();
    ctx.moveTo(box.centreX, pegY);
    ctx.lineTo(box.centreX, pegY + handleH);
    ctx.stroke();
    const headY = pegY + handleH;
    const tufts = 7;
    ctx.fillStyle = rgb(DUSTER_FEATHER);
    for (let i = 0; i < tufts; i++) {
      const angle = (Math.PI * (i + 0.5)) / tufts;
      const spread = frame.tileScale * (0.18 + jitter(rng, 0.03));
      const tx = box.centreX + Math.cos(angle) * spread * 0.9;
      const ty = headY + Math.sin(angle) * spread * 0.6;
      ctx.beginPath();
      ctx.ellipse(tx, ty, spread * 0.22, spread * 0.4, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * A pedal-cranked grindstone: a round stone wheel in a wood frame, a crank
 * to the side. `use`s as a flavour "work the grindstone" — no mechanic, the
 * forge hall's own version of the offering bowl.
 */
function paintGrindstone(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const wheelR = box.width * 0.36;
    const wheelCy = box.bottom - frame.tileScale * 0.5;
    const rimH = frame.tileScale * 0.14;

    // A splayed wood cradle, planted wide of the wheel's own silhouette
    // rather than hugging it, so the stand reads before the stone does.
    ctx.strokeStyle = rgb(sampleRamp(ramp, 0.28));
    ctx.lineWidth = frame.tileScale * 0.06;
    ctx.beginPath();
    ctx.moveTo(box.centreX - wheelR * 0.7, wheelCy + wheelR * 0.3);
    ctx.lineTo(box.centreX - wheelR * 1.15, box.bottom);
    ctx.moveTo(box.centreX + wheelR * 0.7, wheelCy + wheelR * 0.3);
    ctx.lineTo(box.centreX + wheelR * 1.15, box.bottom);
    ctx.stroke();

    // The wheel stood on edge, coin-fashion: a thick rim band beneath a
    // lit top ellipse, so it reads as a solid stone disc rather than a
    // flat painted circle.
    const stone = stoneRamp();
    ctx.fillStyle = rgb(sampleRamp(stone, 0.32));
    ctx.beginPath();
    ctx.ellipse(box.centreX, wheelCy + rimH, wheelR, wheelR * 0.42, 0, 0, Math.PI, false);
    ctx.fill();
    ctx.fillStyle = rgb(sampleRamp(stone, 0.5 + jitter(rng, 0.04)));
    ctx.beginPath();
    ctx.ellipse(box.centreX, wheelCy, wheelR, wheelR * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(box.centreX, wheelCy, wheelR, wheelR * 0.42, 0, 0, Math.PI * 2);
    inkOutline(ctx, frame.tileScale);
    ctx.beginPath();
    ctx.ellipse(box.centreX, wheelCy + rimH, wheelR, wheelR * 0.42, 0, 0, Math.PI, false);
    inkOutline(ctx, frame.tileScale);

    // A coarse grit texture: short scattered dashes rather than a flat fill.
    ctx.strokeStyle = rgba(sampleRamp(stone, 0.2), 0.4);
    ctx.lineWidth = 1;
    const grit = 10;
    for (let i = 0; i < grit; i++) {
      const gx = box.centreX + jitter(rng, wheelR * 0.85);
      const gy = wheelCy + jitter(rng, wheelR * 0.36);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + jitter(rng, 3), gy + jitter(rng, 3));
      ctx.stroke();
    }

    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.4));
    ctx.beginPath();
    ctx.arc(box.centreX, wheelCy, wheelR * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // The crank: a bent iron handle, not a thin diagonal — a vertical stub
    // off the axle and a perpendicular grip, so it never reads as a clock
    // hand.
    const iron = ironRamp();
    const crankX = box.centreX + wheelR * 0.86;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = frame.tileScale * 0.035;
    ctx.beginPath();
    ctx.moveTo(box.centreX + wheelR * 0.08, wheelCy);
    ctx.lineTo(crankX, wheelCy);
    ctx.lineTo(crankX, wheelCy + wheelR * 0.55);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.beginPath();
    ctx.arc(crankX, wheelCy + wheelR * 0.55, frame.tileScale * 0.05, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
  });
}

/**
 * A wide stone-and-timber quench trough, dark water inside — the wet half of
 * the forge, distinct from a barrel's round profile by its long rectangular
 * basin.
 */
function paintQuenchTrough(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const stone = stoneRamp();
    const basinH = frame.tileScale * 0.62;
    const basinTop = box.bottom - basinH;
    paintStoneCourses(ctx, box.left, basinTop, box.width, basinH, stone, rng);
    ctx.beginPath();
    ctx.rect(box.left, basinTop, box.width, basinH);
    inkOutline(ctx, frame.tileScale);

    // Raised end walls, taller than the trough's own long sides, so the
    // silhouette reads as a basin rather than a flat slab the moment the
    // water inside it goes still.
    const wallW = box.width * 0.06;
    const wallH = basinH + frame.tileScale * 0.12;
    const wallTop = basinTop - frame.tileScale * 0.1;
    for (const wallX of [box.left, box.right - wallW]) {
      ctx.fillStyle = rgb(sampleRamp(stone, 0.42));
      ctx.fillRect(wallX, wallTop, wallW, wallH);
      ctx.beginPath();
      ctx.rect(wallX, wallTop, wallW, wallH);
      inkOutline(ctx, frame.tileScale);
    }

    // A deep, dark waterline filling most of the basin's own top — the one
    // shape a stone slab can never have.
    const waterInset = box.width * 0.09;
    const waterTop = basinTop - frame.tileScale * 0.06;
    const waterH = frame.tileScale * 0.22;
    ctx.fillStyle = rgb(QUENCH_WATER);
    ctx.fillRect(box.left + waterInset, waterTop, box.width - waterInset * 2, waterH);
    ctx.beginPath();
    ctx.rect(box.left + waterInset, waterTop, box.width - waterInset * 2, waterH);
    inkOutline(ctx, frame.tileScale);
    ctx.strokeStyle = rgba(QUENCH_WATER_LIGHT, 0.7);
    ctx.lineWidth = frame.tileScale * 0.02;
    ctx.beginPath();
    ctx.moveTo(box.left + waterInset * 1.4, waterTop + waterH * 0.3);
    ctx.lineTo(box.right - waterInset * 1.4, waterTop + waterH * 0.3);
    ctx.stroke();
    // A faint rising-steam wisp, since this basin only ever holds hot work.
    ctx.strokeStyle = rgba(QUENCH_WATER_LIGHT, 0.35 + jitter(rng, 0.05));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.centreX, waterTop);
    ctx.quadraticCurveTo(
      box.centreX + frame.tileScale * 0.06,
      waterTop - frame.tileScale * 0.14,
      box.centreX,
      waterTop - frame.tileScale * 0.24,
    );
    ctx.stroke();
  });
}

/**
 * A low wood coal bin, chunks of coal heaped above the rim — forge-hall
 * dressing, never destructible: it sits beside the brazier as fuel, not as
 * loot.
 */
function paintCoalBin(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const height = frame.tileScale * 0.36;
    const top = box.bottom - height;
    paintPlankBoard(ctx, box.left, top, box.width, height, forkRng(rng), {
      direction: 'vertical',
      boardPx: box.width / 3,
      ramp,
    });
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, height);
    inkOutline(ctx, frame.tileScale);
    const lumps = 6;
    for (let i = 0; i < lumps; i++) {
      const lx = box.left + box.width * (0.15 + 0.7 * (i / (lumps - 1)));
      const ly = top - frame.tileScale * (0.02 + jitter(rng, 0.03));
      const r = frame.tileScale * (0.06 + jitter(rng, 0.015));
      ctx.fillStyle = rgb(COAL_BLACK);
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(COAL_SHEEN, 0.5);
      ctx.beginPath();
      ctx.arc(lx - r * 0.3, ly - r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * A leather cuirass and helm on a wooden T-stand — the armoury's issued
 * armour, waiting for whoever signs it out, distinct from `paintCoatHook`'s
 * hung cloth by a stiff moulded chest and a helm rather than a draped coat.
 */
function paintArmourStand(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const ramp = woodRamp();
    const postTop = box.bottom - frame.tileScale * 0.85;
    ctx.strokeStyle = rgb(sampleRamp(ramp, 0.3));
    ctx.lineWidth = frame.tileScale * 0.07;
    ctx.beginPath();
    ctx.moveTo(box.centreX, box.bottom);
    ctx.lineTo(box.centreX, postTop);
    ctx.stroke();
    inkOutline(ctx, frame.tileScale);

    // Garrison colours: blue-grey leather, never the Meat Shields' orange.
    const cuirassW = box.width * 0.58;
    const cuirassH = frame.tileScale * 0.42;
    const cuirassTop = postTop + frame.tileScale * 0.14;
    const leather = getTownRamp('oc_cloth_sky');
    ctx.fillStyle = rgb(sampleRamp(leather, 0.42 + jitter(rng, 0.04)));
    ctx.beginPath();
    ctx.moveTo(box.centreX - cuirassW / 2, cuirassTop);
    ctx.lineTo(box.centreX + cuirassW / 2, cuirassTop);
    ctx.lineTo(box.centreX + cuirassW * 0.34, cuirassTop + cuirassH);
    ctx.lineTo(box.centreX - cuirassW * 0.34, cuirassTop + cuirassH);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);

    // Shoulder tabs, so the top edge reads as a garment and not a shield.
    const tabW = cuirassW * 0.2;
    const tabH = frame.tileScale * 0.1;
    ctx.fillStyle = rgb(sampleRamp(leather, 0.3));
    ctx.fillRect(box.centreX - cuirassW / 2, cuirassTop - tabH * 0.6, tabW, tabH);
    ctx.fillRect(box.centreX + cuirassW / 2 - tabW, cuirassTop - tabH * 0.6, tabW, tabH);
    ctx.beginPath();
    ctx.rect(box.centreX - cuirassW / 2, cuirassTop - tabH * 0.6, tabW, tabH);
    inkOutline(ctx, frame.tileScale);
    ctx.beginPath();
    ctx.rect(box.centreX + cuirassW / 2 - tabW, cuirassTop - tabH * 0.6, tabW, tabH);
    inkOutline(ctx, frame.tileScale);

    // A wood-toned belt band and centre seam break up the flat leather field.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.32));
    ctx.fillRect(
      box.centreX - cuirassW * 0.4,
      cuirassTop + cuirassH * 0.6,
      cuirassW * 0.8,
      frame.tileScale * 0.05,
    );
    ctx.strokeStyle = rgba(sampleRamp(leather, 0.15), 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.centreX, cuirassTop);
    ctx.lineTo(box.centreX, cuirassTop + cuirassH);
    ctx.stroke();

    // A domed helm with a nose guard, not a flat disc — the shape that
    // reads as headgear rather than a marker post.
    const iron = ironRamp();
    const helmR = frame.tileScale * 0.14;
    const helmCy = postTop - helmR * 0.5;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.42));
    ctx.beginPath();
    ctx.ellipse(box.centreX, helmCy, helmR, helmR * 0.85, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(box.centreX, helmCy, helmR, helmR * 0.85, 0, 0, Math.PI * 2);
    inkOutline(ctx, frame.tileScale);
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.6));
    ctx.lineWidth = frame.tileScale * 0.025;
    ctx.beginPath();
    ctx.moveTo(box.centreX, helmCy - helmR * 0.1);
    ctx.lineTo(box.centreX, helmCy + helmR * 0.75);
    ctx.stroke();
  });
}

/**
 * A child's private shrine to the crawlers he wants to be one of: a stub
 * candle, a coiled scrap of rope, a chipped hilt with no blade left, and a
 * crude ring sketched in charcoal on a leaned scrap of board.
 */
function paintCrawlerScraps(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const boardW = box.width * 0.5;
    const boardH = frame.tileScale * 0.5;
    const boardX = box.left + box.width * 0.3;
    ctx.save();
    ctx.translate(boardX, box.bottom - boardH * 0.5);
    ctx.rotate(-Math.PI * 0.05);
    ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.4));
    ctx.fillRect(-boardW / 2, -boardH / 2, boardW, boardH);
    inkOutline(ctx, frame.tileScale * 0.5);
    ctx.strokeStyle = rgba(TOWN_INK, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, boardH * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const candleX = box.left + box.width * 0.72;
    const candleH = frame.tileScale * 0.18;
    ctx.fillStyle = rgb(GOODS_CANDLE);
    ctx.fillRect(candleX - box.width * 0.04, box.bottom - candleH, box.width * 0.08, candleH);
    ctx.fillStyle = rgb(FLAME_CORE);
    ctx.beginPath();
    ctx.ellipse(
      candleX,
      box.bottom - candleH - frame.tileScale * 0.03,
      box.width * 0.02,
      frame.tileScale * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    const ropeR = box.width * 0.1;
    paintRopeCoil(ctx, box.left + box.width * 0.5, box.bottom - ropeR * 0.6, ropeR);
    const hiltX = box.centreX - box.width * 0.02;
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.5 + jitter(rng, 0.03)));
    ctx.lineWidth = frame.tileScale * 0.03;
    ctx.beginPath();
    ctx.moveTo(hiltX, box.bottom - frame.tileScale * 0.02);
    ctx.lineTo(hiltX, box.bottom - frame.tileScale * 0.16);
    ctx.stroke();
  });
}

/** A field logbook, kept apart from the wall report — tucked low, unremarkable, iron-cornered. */
function paintFieldLog(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = woodRamp();
    const h = frame.tileScale * 0.22;
    const w = box.width * 0.6;
    const x = box.centreX - w / 2;
    const top = box.bottom - h;
    paintPlankBoard(ctx, x, top, w, h, forkRng(rng), {
      direction: 'vertical',
      boardPx: w / 2,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(x, top, w, h);
    inkOutline(ctx, frame.tileScale * 0.6);
    const iron = ironRamp();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.fillRect(x, top, w * 0.08, h);
    ctx.fillRect(x + w * 0.92, top, w * 0.08, h);
  });
}

/** A wooden hatch flush with the floor — the lid over the row's own cellar network, never opened by a search. */
function paintCellarHatch(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const inset = box.width * 0.14;
    const wood = woodRamp();
    ctx.fillStyle = rgb(sampleRamp(wood, 0.32));
    ctx.beginPath();
    ctx.rect(
      box.left + inset,
      box.top + inset * 0.6,
      box.width - inset * 2,
      box.height - inset * 1.2,
    );
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.7);
    ctx.strokeStyle = rgba(sampleRamp(wood, 0.15), 0.6);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const yy = box.top + inset * 0.6 + ((box.height - inset * 1.2) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(box.left + inset, yy);
      ctx.lineTo(box.right - inset, yy);
      ctx.stroke();
    }
    const iron = ironRamp();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = frame.tileScale * 0.025;
    ctx.beginPath();
    ctx.arc(
      box.centreX,
      box.bottom - inset * 1.4,
      box.width * 0.07,
      Math.PI * 0.15,
      Math.PI * 0.85,
    );
    ctx.stroke();
  });
}

// ── Registry ─────────────────────────────────────────────────────────────

interface TownInteriorPropExtras {
  readonly destructible?: TownInteriorDestructibleSpec;
  readonly interaction?: TownInteriorInteraction;
}

function def(
  id: string,
  footprint: TownInteriorFootprint,
  walkable: boolean,
  anchors: ReadonlyArray<AnchorKind>,
  mount: TownInteriorPropMount,
  variants: number,
  paint: (ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng) => void,
  extras: TownInteriorPropExtras = {},
): TownInteriorPropDef {
  return {
    id,
    footprint,
    artHeightTiles: frameHeightFor(id),
    walkable,
    anchors,
    mount,
    variants,
    paint,
    destructible: extras.destructible,
    interaction: extras.interaction,
  };
}

export const TOWN_INTERIOR_PROPS = {
  still: def('still', { w: 3, h: 2 }, false, [], 'free', 1, paintStill, {
    interaction: { kind: 'examine', id: 'still' },
  }),
  herb_bundle_rack: def('herb_bundle_rack', ONE_BY_ONE, false, [], 'wall', 2, paintHerbBundleRack),
  // Two tiles deep so the cabinet's own footprint closes the strip between
  // it and the partition behind — a one-row cabinet would leave a sealed,
  // unreachable pocket of floor there.
  apothecary_drawer_wall: def(
    'apothecary_drawer_wall',
    { w: 6, h: 2 },
    false,
    [],
    'wall',
    1,
    paintApothecaryCabinet,
    { interaction: { kind: 'examine', id: 'apothecary_drawer_wall' } },
  ),
  // A counter built in sections rather than one tile per segment: only a
  // section's north-west tile carries the `counter` anchor, so each section
  // is one stand for one occupant. Variant 0 is the keeper's end, 1 the
  // customer's end.
  apothecary_counter: def(
    'apothecary_counter',
    { w: 4, h: 1 },
    false,
    ['counter'],
    'free',
    2,
    paintApothecaryCounter,
  ),
  herb_drying_rack: def(
    'herb_drying_rack',
    { w: 5, h: 1 },
    false,
    [],
    'wall',
    1,
    paintHerbDryingRack,
    { interaction: { kind: 'examine', id: 'herb_drying_rack' } },
  ),
  herb_bins: def('herb_bins', { w: 2, h: 1 }, false, [], 'free', 1, paintHerbBins, {
    destructible: DESTRUCTIBLE_CRATE,
    interaction: { kind: 'examine', id: 'herb_bins' },
  }),
  // Carries the shop's `shelf` anchor: a customer browsing Fen's stock
  // stands at the display table on the shop floor, never behind the counter.
  remedy_display: def(
    'remedy_display',
    { w: 2, h: 1 },
    false,
    ['shelf'],
    'free',
    2,
    paintRemedyDisplay,
    {
      destructible: DESTRUCTIBLE_JARS,
      interaction: { kind: 'examine', id: 'remedy_display' },
    },
  ),
  specimen_case: def('specimen_case', { w: 2, h: 1 }, false, [], 'free', 1, paintSpecimenCase, {
    interaction: { kind: 'examine', id: 'specimen_case' },
  }),
  potted_bay: def('potted_bay', ONE_BY_ONE, false, [], 'free', 1, paintPottedBay, {
    destructible: DESTRUCTIBLE_JARS,
  }),
  sorting_table: def('sorting_table', { w: 2, h: 1 }, false, [], 'free', 1, paintSortingTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  potting_bench: def('potting_bench', { w: 2, h: 1 }, false, [], 'free', 1, paintPottingBench, {
    destructible: DESTRUCTIBLE_TABLE,
    interaction: { kind: 'examine', id: 'potting_bench' },
  }),
  live_herb_pots: def('live_herb_pots', ONE_BY_ONE, false, [], 'free', 2, paintLiveHerbPots, {
    destructible: DESTRUCTIBLE_JARS,
    interaction: { kind: 'examine', id: 'live_herb_pots' },
  }),
  book_stack: def('book_stack', ONE_BY_ONE, false, [], 'free', 2, paintBookStack, {
    interaction: { kind: 'examine', id: 'book_stack' },
  }),
  hedge_stool: def('hedge_stool', ONE_BY_ONE, false, [], 'free', 1, paintHedgeStool, {
    interaction: { kind: 'use', id: 'biting_stool' },
  }),
  // Old Hilda's composed centrepieces: the hearth carries the `hearth`
  // anchor her waiting customer stands at, and the dresser the `shelf`
  // anchor she browses, so each big piece also does the job the small props
  // it stands in for used to.
  witch_hearth: def(
    'witch_hearth',
    { w: 3, h: 2 },
    false,
    ['hearth'],
    'wall',
    1,
    paintWitchHearth,
    {
      interaction: { kind: 'use', id: 'hearth' },
    },
  ),
  jar_dresser: def('jar_dresser', { w: 3, h: 1 }, false, ['shelf'], 'wall', 1, paintJarDresser, {
    destructible: DESTRUCTIBLE_SHELF,
    interaction: { kind: 'examine', id: 'witch_jars' },
  }),
  drying_beam: def('drying_beam', { w: 3, h: 1 }, false, [], 'wall', 1, paintDryingBeam),
  witch_worktable: def(
    'witch_worktable',
    { w: 3, h: 1 },
    false,
    [],
    'free',
    1,
    paintWitchWorktable,
    {
      destructible: DESTRUCTIBLE_TABLE,
      interaction: { kind: 'examine', id: 'witch_worktable' },
    },
  ),
  cat_armchair: def('cat_armchair', ONE_BY_ONE, false, [], 'free', 1, paintCatArmchair, {
    interaction: { kind: 'examine', id: 'cottage_familiar' },
  }),
  book_heap: def('book_heap', { w: 2, h: 1 }, false, [], 'free', 1, paintBookHeap, {
    interaction: { kind: 'examine', id: 'book_stack' },
  }),
  crock_cluster: def('crock_cluster', ONE_BY_ONE, false, [], 'free', 2, paintCrockCluster, {
    destructible: DESTRUCTIBLE_JARS,
    interaction: { kind: 'examine', id: 'jars' },
  }),
  cottage_bed: def('cottage_bed', { w: 2, h: 1 }, false, [], 'free', 1, paintCottageBed),
  birdcage_stand: def(
    'birdcage_stand',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f) => paintBirdcageStand(ctx, f),
    {
      interaction: { kind: 'examine', id: 'birdcage' },
    },
  ),
  broom: def('broom', ONE_BY_ONE, false, [], 'wall', 1, paintBroom),
  mushroom_basket: def('mushroom_basket', ONE_BY_ONE, false, [], 'free', 2, paintMushroomBasket, {
    destructible: DESTRUCTIBLE_BASKET,
    interaction: { kind: 'examine', id: 'mushroom_basket' },
  }),
  altar: def('altar', { w: 4, h: 1 }, false, ['table'], 'free', 1, paintAltarStone, {
    interaction: { kind: 'examine', id: 'altar_stone' },
  }),
  lectern: def('lectern', ONE_BY_ONE, false, [], 'free', 1, paintLectern, {
    interaction: { kind: 'examine', id: 'lectern' },
  }),
  sky_banner: def('sky_banner', ONE_BY_ONE, false, [], 'wall', 1, paintSkyBanner, {
    interaction: { kind: 'examine', id: 'sky_banner' },
  }),
  scripture_shelf: def(
    'scripture_shelf',
    ONE_BY_ONE,
    false,
    ['shelf'],
    'free',
    2,
    paintScriptureShelf,
    { interaction: { kind: 'examine', id: 'scripture_shelf' } },
  ),
  temple_dais: def('temple_dais', { w: 14, h: 3 }, true, [], 'free', 1, paintTempleDais),
  sky_window: def('sky_window', { w: 4, h: 2 }, true, [], 'wall', 1, paintSkyWindow, {
    interaction: { kind: 'examine', id: 'sky_window' },
  }),
  temple_candelabrum: def(
    'temple_candelabrum',
    ONE_BY_ONE,
    false,
    [],
    'free',
    2,
    paintTempleCandelabrum,
    { destructible: DESTRUCTIBLE_CANDELABRUM },
  ),
  perch_stand: def('perch_stand', ONE_BY_ONE, false, [], 'free', 2, paintPerchStand, {
    interaction: { kind: 'examine', id: 'perch_stand' },
  }),
  votive_rack: def('votive_rack', { w: 2, h: 1 }, false, [], 'free', 1, paintVotiveRack, {
    interaction: { kind: 'examine', id: 'votive_rack' },
  }),
  sky_font: def('sky_font', ONE_BY_ONE, false, [], 'free', 1, paintSkyFont, {
    interaction: { kind: 'examine', id: 'sky_font' },
  }),
  offering_table: def('offering_table', { w: 2, h: 1 }, false, [], 'free', 1, paintOfferingTable, {
    interaction: { kind: 'use', id: 'offering_bowl' },
  }),
  needle_tray: def('needle_tray', ONE_BY_ONE, false, [], 'free', 1, paintNeedleTray, {
    interaction: { kind: 'examine', id: 'needle_tray' },
  }),
  feather_chart: def('feather_chart', { w: 2, h: 1 }, false, [], 'wall', 1, paintFeatherChart, {
    interaction: { kind: 'examine', id: 'feather_chart' },
  }),
  // The Quiet Needle's composed pieces. The chair carries the `bench` anchor
  // Nim works at, the pigment cabinet the `shelf` anchor the room's slate of
  // rates is propped against, and the waiting room's two tables the `table`
  // anchors both waiting customers stand at — so each big piece also does the
  // job the tile it replaces used to.
  flash_wall: def('flash_wall', { w: 4, h: 1 }, false, [], 'wall', 2, paintFlashWall, {
    interaction: { kind: 'examine', id: 'flash_wall' },
  }),
  ink_chair: def('ink_chair', { w: 3, h: 1 }, false, ['bench'], 'free', 1, paintInkChair, {
    interaction: { kind: 'examine', id: 'ink_chair' },
  }),
  pigment_cabinet: def(
    'pigment_cabinet',
    { w: 3, h: 1 },
    false,
    ['shelf'],
    'wall',
    1,
    paintPigmentCabinet,
    { interaction: { kind: 'examine', id: 'pigment_cabinet' } },
  ),
  arm_lamp: def('arm_lamp', ONE_BY_ONE, false, [], 'free', 2, paintArmLamp, {
    destructible: DESTRUCTIBLE_LAMP,
  }),
  grinding_bench: def('grinding_bench', { w: 2, h: 1 }, false, [], 'wall', 1, paintGrindingBench, {
    destructible: DESTRUCTIBLE_TABLE,
    interaction: { kind: 'examine', id: 'grinding_bench' },
  }),
  settee: def('settee', { w: 3, h: 1 }, false, [], 'free', 2, paintSettee, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  low_table: def('low_table', { w: 2, h: 1 }, false, ['table'], 'free', 1, paintLowTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  side_table: def('side_table', ONE_BY_ONE, false, ['table'], 'free', 1, paintSideTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  coat_stand: def('coat_stand', ONE_BY_ONE, false, [], 'free', 1, paintCoatStand, {
    interaction: { kind: 'search', id: 'coat_hook' },
  }),
  counter: def('counter', ONE_BY_ONE, false, ['counter'], 'free', 3, paintCounter),
  table_small: def('table_small', ONE_BY_ONE, false, ['table'], 'free', 3, paintTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  table_medium: def('table_medium', { w: 2, h: 1 }, false, ['table'], 'free', 2, paintTable),
  chair: def('chair', ONE_BY_ONE, false, [], 'free', 1, paintChair, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  // One segment of a church pew, placed one per column across a row so the
  // row reads as a continuous bench — see `paintPew`'s own doc comment.
  pew: def('pew', ONE_BY_ONE, false, [], 'free', 2, paintPew, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  stool: def('stool', ONE_BY_ONE, false, [], 'free', 2, paintStool, {
    destructible: DESTRUCTIBLE_STOOL,
  }),
  bench_seat: def('bench_seat', { w: 2, h: 1 }, false, [], 'free', 1, paintBenchSeat, {
    interaction: { kind: 'use', id: 'bench_seat' },
  }),
  shelving_unit: def('shelving_unit', ONE_BY_ONE, false, ['shelf'], 'free', 3, paintShelving, {
    destructible: DESTRUCTIBLE_SHELF,
  }),
  wall_shelf_goods: def(
    'wall_shelf_goods',
    ONE_BY_ONE,
    false,
    ['shelf'],
    'wall',
    3,
    paintWallShelfGoods,
  ),
  hanging_tools: def('hanging_tools', ONE_BY_ONE, false, [], 'wall', 2, paintHangingTools),
  window_dressing: def('window_dressing', ONE_BY_ONE, false, [], 'wall', 1, (ctx, f, v) =>
    paintWindowDressing(ctx, f, v),
  ),
  notice_board: def('notice_board', ONE_BY_ONE, false, ['board'], 'wall', 1, paintNoticeBoard, {
    interaction: { kind: 'examine', id: 'price_board' },
  }),
  lamp_candle: def('lamp_candle', ONE_BY_ONE, false, [], 'wall', 1, (ctx, f) =>
    paintLampCandle(ctx, f),
  ),
  barrel: def('barrel', ONE_BY_ONE, false, ['crate'], 'free', 2, paintBarrel, {
    destructible: DESTRUCTIBLE_BARREL,
  }),
  crate: def('crate', ONE_BY_ONE, false, ['crate'], 'free', 1, paintCrate, {
    destructible: DESTRUCTIBLE_CRATE,
  }),
  sack: def('sack', ONE_BY_ONE, false, [], 'free', 1, paintSack, {
    destructible: DESTRUCTIBLE_SACK,
  }),
  bed_single: def('bed_single', ONE_BY_ONE, false, [], 'free', 1, paintBed),
  // Two tiles wide, one mantel, one firebox: `paintHearth` scales to its own
  // footprint, so a broad fireplace is the same painter over a wider box.
  hearth_wide: def('hearth_wide', { w: 2, h: 1 }, false, ['hearth'], 'wall', 1, paintHearth, {
    interaction: { kind: 'use', id: 'hearth' },
  }),
  forge_brazier: def('forge_brazier', ONE_BY_ONE, false, ['forge'], 'free', 1, paintForgeBrazier, {
    destructible: DESTRUCTIBLE_BRAZIER,
  }),
  // A wide runner for a counter or a hearth's own approach — one continuous
  // mat with one border and one fringe. `paintRugRunner` scales to its own
  // footprint, so the same painter also
  // backs every other size below — a short run, a squarish area rug or a
  // wide ring mat, never several small rugs whose borders repeat and read
  // as floor tiling.
  rug_runner: def('rug_runner', { w: 6, h: 1 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  rug_runner_3: def('rug_runner_3', { w: 3, h: 1 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  rug_runner_4: def('rug_runner_4', { w: 4, h: 1 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  rug_runner_5: def('rug_runner_5', { w: 5, h: 1 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  // Rectangular area rugs — a room's own centre mat rather than a runner
  // meant to line a wall or a counter approach.
  rug_small: def('rug_small', { w: 2, h: 2 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  rug_medium: def('rug_medium', { w: 3, h: 2 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  rug_large: def('rug_large', { w: 4, h: 3 }, true, [], 'free', 4, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  // The barracks' own sparring-ring mat: one composed image across the
  // whole ring rather than 36 separate 1×1 tiles.
  rug_ring: def('rug_ring', { w: 9, h: 4 }, true, [], 'free', 2, (ctx, f, v) =>
    paintRugRunner(ctx, f, v),
  ),
  jars: def('jars', ONE_BY_ONE, false, [], 'free', 2, paintJars, {
    destructible: DESTRUCTIBLE_JARS,
    interaction: { kind: 'examine', id: 'jars' },
  }),
  crockery_shelf: def(
    'crockery_shelf',
    ONE_BY_ONE,
    false,
    ['shelf'],
    'free',
    2,
    paintCrockeryShelf,
    { destructible: DESTRUCTIBLE_CROCKERY },
  ),
  basket: def('basket', ONE_BY_ONE, false, [], 'free', 2, paintBasket, {
    destructible: DESTRUCTIBLE_BASKET,
  }),
  oil_lamp: def('oil_lamp', ONE_BY_ONE, false, [], 'free', 1, paintOilLamp, {
    destructible: DESTRUCTIBLE_LAMP,
  }),
  chest: def('chest', ONE_BY_ONE, false, [], 'free', 1, paintChest, {
    interaction: { kind: 'search', id: 'chest' },
  }),
  coat_hook: def(
    'coat_hook',
    ONE_BY_ONE,
    false,
    [],
    'wall',
    2,
    (ctx, f, v) => paintCoatHook(ctx, f, v),
    {
      interaction: { kind: 'search', id: 'coat_hook' },
    },
  ),
  drawer_unit: def('drawer_unit', ONE_BY_ONE, false, [], 'free', 1, paintDrawerUnit, {
    interaction: { kind: 'search', id: 'drawer_unit' },
  }),
  shop_bell: def(
    'shop_bell',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f, v) => paintShopBell(ctx, f, v),
    { interaction: { kind: 'use', id: 'shop_bell' } },
  ),
  offering_bowl: def(
    'offering_bowl',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f, v) => paintOfferingBowl(ctx, f, v),
    { interaction: { kind: 'use', id: 'offering_bowl' } },
  ),
  open_crate: def('open_crate', ONE_BY_ONE, false, ['crate'], 'free', 1, paintOpenCrate, {
    interaction: { kind: 'search', id: 'open_crate' },
  }),
  potion_shelf: def('potion_shelf', ONE_BY_ONE, false, ['shelf'], 'free', 3, paintPotionShelf, {
    destructible: DESTRUCTIBLE_JARS,
  }),
  perch_rail: def('perch_rail', ONE_BY_ONE, false, [], 'wall', 1, (ctx, f) =>
    paintPerchRail(ctx, f),
  ),
  feather_duster: def('feather_duster', ONE_BY_ONE, false, [], 'wall', 1, (ctx, f, _v, rng) =>
    paintFeatherDuster(ctx, f, 0, rng),
  ),
  anvil: def('anvil', { w: 2, h: 1 }, false, [], 'free', 1, paintAnvil, {
    interaction: { kind: 'examine', id: 'anvil' },
  }),
  grindstone: def('grindstone', ONE_BY_ONE, false, [], 'free', 1, paintGrindstone, {
    interaction: { kind: 'use', id: 'grindstone' },
  }),
  blade_rack: def('blade_rack', { w: 3, h: 1 }, false, [], 'wall', 2, paintBladeRack, {
    interaction: { kind: 'examine', id: 'blade_rack' },
  }),
  quench_trough: def('quench_trough', { w: 2, h: 1 }, false, [], 'free', 1, paintQuenchTrough),
  coal_bin: def('coal_bin', ONE_BY_ONE, false, [], 'free', 1, paintCoalBin),
  forge: def('forge', { w: 3, h: 2 }, false, [], 'free', 1, paintForge, {
    interaction: { kind: 'examine', id: 'forge' },
  }),
  bar_stock: def('bar_stock', { w: 2, h: 1 }, false, [], 'wall', 1, paintBarStock),
  // Carries the smithy's `table` anchor: the forge hall's one bench is
  // where a waiting customer stands.
  vice_bench: def('vice_bench', { w: 3, h: 1 }, false, ['table'], 'free', 1, paintViceBench, {
    interaction: { kind: 'examine', id: 'vice_bench' },
  }),
  smith_bellows: def('smith_bellows', { w: 2, h: 2 }, false, [], 'wall', 1, paintSmithBellows, {
    interaction: { kind: 'examine', id: 'smith_bellows' },
  }),
  smith_tool_wall: def(
    'smith_tool_wall',
    { w: 4, h: 1 },
    false,
    [],
    'wall',
    2,
    paintSmithToolWall,
    {
      interaction: { kind: 'examine', id: 'smith_tool_wall' },
    },
  ),
  // One section, one `counter` anchor on its north-west tile: the smith's
  // stand is found from that tile alone.
  smith_counter: def(
    'smith_counter',
    { w: 4, h: 1 },
    false,
    ['counter'],
    'free',
    1,
    paintSmithCounter,
  ),
  coal_heap: def('coal_heap', { w: 2, h: 1 }, false, [], 'free', 1, paintCoalHeap),
  ironmongery_table: def(
    'ironmongery_table',
    { w: 3, h: 1 },
    false,
    [],
    'free',
    1,
    paintIronmongeryTable,
    { interaction: { kind: 'examine', id: 'ironmongery_table' } },
  ),
  mail_stand: def('mail_stand', ONE_BY_ONE, false, [], 'free', 1, paintMailStand, {
    interaction: { kind: 'examine', id: 'mail_stand' },
  }),
  slack_tub: def('slack_tub', ONE_BY_ONE, false, [], 'free', 1, paintSlackTub, {
    destructible: DESTRUCTIBLE_BARREL,
  }),
  forge_floor: def('forge_floor', { w: 7, h: 3 }, true, [], 'free', 1, paintForgeFloor),
  mandrel_swage: def('mandrel_swage', { w: 2, h: 1 }, false, [], 'free', 1, paintMandrelSwage),
  // Two finished wheels leaning on the wall; `use` trues one the way the
  // grindstone lets a crawler put an edge to the smithy's stone.
  wheelwright_stand: def(
    'wheelwright_stand',
    { w: 2, h: 1 },
    false,
    [],
    'wall',
    1,
    paintFinishedWheels,
    { interaction: { kind: 'use', id: 'wheelwright_stand' } },
  ),
  wagon_bed: def('wagon_bed', { w: 5, h: 2 }, false, [], 'free', 1, paintWagonBed, {
    interaction: { kind: 'examine', id: 'wagon_bed' },
  }),
  lathe: def('lathe', { w: 3, h: 1 }, false, [], 'wall', 1, paintLathe, {
    interaction: { kind: 'examine', id: 'lathe' },
  }),
  // The workshop's one `table` anchor: the wheelwright stands at his bench.
  joiner_bench: def('joiner_bench', { w: 5, h: 1 }, false, ['table'], 'wall', 1, paintJoinerBench, {
    interaction: { kind: 'examine', id: 'joiner_bench' },
  }),
  wheel_build_stand: def(
    'wheel_build_stand',
    { w: 2, h: 2 },
    false,
    [],
    'free',
    1,
    paintWheelBuildStand,
    { interaction: { kind: 'examine', id: 'wheel_build_stand' } },
  ),
  timber_rack: def('timber_rack', { w: 3, h: 2 }, false, [], 'wall', 1, paintTimberRack, {
    interaction: { kind: 'examine', id: 'timber_rack' },
  }),
  sawhorse: def('sawhorse', { w: 2, h: 1 }, false, [], 'free', 1, paintSawhorse),
  shaving_horse: def('shaving_horse', { w: 2, h: 1 }, false, [], 'free', 1, paintShavingHorse, {
    interaction: { kind: 'examine', id: 'shaving_horse' },
  }),
  firewood_stack: def('firewood_stack', { w: 3, h: 1 }, false, [], 'wall', 1, paintFirewoodStack, {
    interaction: { kind: 'examine', id: 'firewood_stack' },
  }),
  spoke_tub: def('spoke_tub', ONE_BY_ONE, false, [], 'free', 1, paintSpokeTub, {
    destructible: DESTRUCTIBLE_BASKET,
  }),
  glue_pot: def('glue_pot', ONE_BY_ONE, false, [], 'free', 1, paintGluePot, {
    destructible: DESTRUCTIBLE_BRAZIER,
  }),
  axle_set: def('axle_set', { w: 3, h: 1 }, false, [], 'free', 1, paintAxleSet, {
    interaction: { kind: 'examine', id: 'axle_set' },
  }),
  // Flat and walkable, drawn with the floor like a rug.
  plank_pile: def('plank_pile', { w: 2, h: 1 }, false, [], 'free', 1, paintPlankPile),
  shavings_floor: def('shavings_floor', { w: 2, h: 1 }, true, [], 'free', 2, paintShavingsFloor),
  armour_stand: def('armour_stand', ONE_BY_ONE, false, [], 'free', 1, paintArmourStand, {
    interaction: { kind: 'examine', id: 'armour_stand' },
  }),
  // Three rows deep so the hurst platform, the stones and the sack out
  // front all sit on blocked floor; the mill room is built around it.
  millstone: def('millstone', { w: 4, h: 3 }, false, [], 'free', 1, paintMillWorks, {
    interaction: { kind: 'examine', id: 'millstone' },
  }),
  grain_scale: def('grain_scale', { w: 2, h: 1 }, false, [], 'free', 1, paintSteelyardScale, {
    interaction: { kind: 'examine', id: 'grain_scale' },
  }),
  crawler_scraps: def('crawler_scraps', ONE_BY_ONE, false, [], 'free', 1, paintCrawlerScraps, {
    interaction: { kind: 'examine', id: 'crawler_scraps' },
  }),
  field_log: def('field_log', ONE_BY_ONE, false, [], 'free', 1, paintFieldLog, {
    interaction: { kind: 'examine', id: 'field_log' },
  }),
  cellar_hatch: def('cellar_hatch', ONE_BY_ONE, true, [], 'free', 1, (ctx, f, v) =>
    paintCellarHatch(ctx, f, v),
  ),
  // Blackwood Lodge's composed pieces. The briefing table carries the
  // `table` anchor Kessler stands at and the cellar letter is weighted on,
  // so a room without it loses both without a word.
  lodge_map_table: def(
    'lodge_map_table',
    { w: 4, h: 2 },
    false,
    ['table'],
    'free',
    1,
    paintLodgeMapTable,
    { interaction: { kind: 'examine', id: 'lodge_map_table' } },
  ),
  lodge_bunk: def(
    'lodge_bunk',
    { w: 2, h: 1 },
    false,
    [],
    'free',
    LODGE_BUNK_VARIANTS,
    paintLodgeBunk,
    { interaction: { kind: 'examine', id: 'lodge_bunks' } },
  ),
  lodge_spear_rack: def(
    'lodge_spear_rack',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    2,
    paintLodgeSpearRack,
    { interaction: { kind: 'examine', id: 'lodge_spear_rack' } },
  ),
  lodge_duty_board: def(
    'lodge_duty_board',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    1,
    paintLodgeDutyBoard,
    { interaction: { kind: 'examine', id: 'lodge_duty_board' } },
  ),
  lodge_stove: def('lodge_stove', { w: 2, h: 1 }, false, [], 'wall', 1, paintLodgeStove, {
    interaction: { kind: 'examine', id: 'lodge_stove' },
  }),
  lodge_kit_pegs: def('lodge_kit_pegs', { w: 3, h: 1 }, false, [], 'wall', 2, paintLodgeKitPegs),
  kessler_footlocker: def(
    'kessler_footlocker',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    paintKesslerFootlocker,
    { interaction: { kind: 'examine', id: 'field_log' } },
  ),
  cellar_trapdoor: def('cellar_trapdoor', { w: 4, h: 3 }, true, [], 'free', 1, paintCellarTrapdoor),
  // Wendell's rooms. The drafting table, plan chest and roll bin never carry
  // an interaction and never break: the drawings on and in them belong to his
  // own story, not to the room, so nothing here may read, take or scatter them.
  drafting_table: def('drafting_table', { w: 3, h: 1 }, false, [], 'wall', 1, paintDraftingStation),
  plan_chest: def('plan_chest', { w: 2, h: 1 }, false, [], 'free', 2, paintPlanChest),
  roll_bin: def('roll_bin', ONE_BY_ONE, false, [], 'free', 1, paintRollBin),
  tool_wall: def('tool_wall', { w: 3, h: 1 }, false, [], 'wall', 1, paintToolWall, {
    interaction: { kind: 'examine', id: 'tool_wall' },
  }),
  door_on_trestles: def(
    'door_on_trestles',
    { w: 3, h: 1 },
    false,
    [],
    'free',
    1,
    paintDoorOnTrestles,
    { interaction: { kind: 'examine', id: 'repair_door' } },
  ),
  builders_hearth: def(
    'builders_hearth',
    { w: 3, h: 2 },
    false,
    ['hearth'],
    'wall',
    1,
    paintBuildersHearth,
    { interaction: { kind: 'use', id: 'hearth' } },
  ),
  good_chair: def('good_chair', ONE_BY_ONE, false, [], 'free', 1, paintGoodChair, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  dairy_wall: def('dairy_wall', { w: 3, h: 1 }, false, [], 'wall', 1, paintDairyWall, {
    interaction: { kind: 'examine', id: 'dairy_wall' },
  }),
  churn_stand: def('churn_stand', { w: 2, h: 1 }, false, [], 'free', 2, paintChurnStand, {
    interaction: { kind: 'examine', id: 'milk_churn' },
  }),
  milking_stool: def('milking_stool', ONE_BY_ONE, false, [], 'free', 1, paintMilkingStool, {
    destructible: DESTRUCTIBLE_STOOL,
  }),
  feed_stack: def('feed_stack', { w: 2, h: 1 }, false, [], 'free', 1, paintFeedStack, {
    destructible: DESTRUCTIBLE_SACK,
    interaction: { kind: 'examine', id: 'feed_sacks' },
  }),
  made_cot: def('made_cot', { w: 2, h: 1 }, false, [], 'free', 1, paintMadeCot),
  pail_stack: def('pail_stack', ONE_BY_ONE, false, [], 'free', 1, paintPailStack),
  door_peg_post: def('door_peg_post', ONE_BY_ONE, false, [], 'free', 2, paintDoorPegPost),
  boot_tray: def('boot_tray', ONE_BY_ONE, false, [], 'free', 2, paintBootTray),
  offcut_box: def('offcut_box', ONE_BY_ONE, false, [], 'free', 1, paintOffcutBox),
  stair_shelf: def('stair_shelf', { w: 2, h: 1 }, false, [], 'free', 1, paintStairShelf),
  timber_stack: def('timber_stack', { w: 3, h: 1 }, false, [], 'free', 1, paintTimberStack),
  tool_chest: def('tool_chest', { w: 2, h: 1 }, false, [], 'free', 1, paintToolChest, {
    interaction: { kind: 'search', id: 'chest' },
  }),
  supper_table: def('supper_table', { w: 2, h: 1 }, false, ['table'], 'free', 1, paintSupperTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  pot_rack: def('pot_rack', ONE_BY_ONE, false, [], 'wall', 1, paintPotRack),
  flour_bin: def('flour_bin', ONE_BY_ONE, false, [], 'free', 1, paintFlourBin, {
    interaction: { kind: 'examine', id: 'flour_bin' },
  }),
  sieve_rack: def('sieve_rack', ONE_BY_ONE, false, [], 'wall', 1, paintSieveRack, {
    interaction: { kind: 'examine', id: 'sieve_rack' },
  }),
  hand_cart: def('hand_cart', ONE_BY_ONE, false, [], 'free', 1, paintHandCart),
  // Marta's hearth carries the `hearth` anchor she stands at, and the table
  // and the kneading trough each carry a `table` anchor: the roster seats two
  // occupants at tables, and an anchor is one per placed instance.
  farm_hearth: def('farm_hearth', { w: 4, h: 2 }, false, ['hearth'], 'wall', 1, paintFarmHearth, {
    interaction: { kind: 'use', id: 'hearth' },
  }),
  farm_table: def('farm_table', { w: 3, h: 2 }, false, ['table'], 'free', 1, paintFarmTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  bake_trough: def('bake_trough', { w: 2, h: 1 }, false, ['table'], 'free', 1, paintBakeTrough, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  farm_dresser: def('farm_dresser', { w: 3, h: 1 }, false, [], 'wall', 1, paintFarmDresser, {
    destructible: DESTRUCTIBLE_CROCKERY,
    interaction: { kind: 'examine', id: 'farm_dresser' },
  }),
  larder_shelf: def('larder_shelf', { w: 2, h: 1 }, false, [], 'wall', 1, paintLarderShelf, {
    destructible: DESTRUCTIBLE_SHELF,
    interaction: { kind: 'examine', id: 'larder_shelf' },
  }),
  corvin_pallet: def('corvin_pallet', { w: 2, h: 1 }, false, [], 'wall', 1, paintCorvinPallet),
  flour_sack_stack: def(
    'flour_sack_stack',
    { w: 2, h: 1 },
    false,
    [],
    'free',
    2,
    paintFlourSackStack,
    { destructible: DESTRUCTIBLE_SACK, interaction: { kind: 'examine', id: 'flour_sacks' } },
  ),
  flour_drift: def('flour_drift', { w: 3, h: 1 }, true, [], 'free', 1, paintFlourDrift),
  grain_bin: def('grain_bin', { w: 2, h: 1 }, false, [], 'free', 1, paintGrainBin, {
    destructible: DESTRUCTIBLE_CRATE,
  }),
  // The General Store's fittings. A goods wall carries the `shelf` anchor on
  // its north-west tile, so each wall is one browsing stand, not four. None
  // of these fittings is breakable — they are the shop's built-in joinery,
  // not furniture — so the store's breakables are its barrels, sacks, crocks
  // and crates.
  goods_wall: def('goods_wall', { w: 4, h: 1 }, false, ['shelf'], 'wall', 4, paintGoodsWall, {
    interaction: { kind: 'examine', id: 'goods_wall' },
  }),
  potion_cabinet: def('potion_cabinet', { w: 2, h: 1 }, false, [], 'wall', 1, paintPotionCabinet, {
    interaction: { kind: 'examine', id: 'potion_cabinet' },
  }),
  // One section, one `counter` anchor: the keeper is the counter's only owner.
  store_counter: def(
    'store_counter',
    { w: 5, h: 1 },
    false,
    ['counter'],
    'free',
    1,
    paintStoreCounter,
  ),
  counter_bell_end: def(
    'counter_bell_end',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f, v) => paintCounterBellEnd(ctx, f, v),
    { interaction: { kind: 'use', id: 'shop_bell' } },
  ),
  // Carries a `shelf` anchor so a browsing customer stands out on the shop
  // floor at the table rather than behind the counter.
  display_table: def(
    'display_table',
    { w: 3, h: 2 },
    false,
    ['shelf'],
    'free',
    2,
    paintDisplayTable,
  ),
  bulk_bins: def('bulk_bins', { w: 3, h: 1 }, false, ['crate'], 'free', 1, paintBulkBins, {
    interaction: { kind: 'examine', id: 'bulk_bins' },
  }),
  tool_barrel: def(
    'tool_barrel',
    ONE_BY_ONE,
    false,
    ['crate'],
    'free',
    1,
    (ctx, f, v) => paintToolBarrel(ctx, f, v),
    {
      destructible: DESTRUCTIBLE_BARREL,
    },
  ),
  dynamite_crate: def(
    'dynamite_crate',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f, v) => paintDynamiteCrate(ctx, f, v),
    { interaction: { kind: 'examine', id: 'dynamite_crate' } },
  ),
  clerk_desk: def('clerk_desk', { w: 2, h: 1 }, false, [], 'free', 1, paintClerkDesk, {
    interaction: { kind: 'examine', id: 'ledger_desk' },
  }),
  stock_stack: def('stock_stack', { w: 2, h: 2 }, false, ['crate'], 'free', 1, paintStockStack),
  crock_stack: def(
    'crock_stack',
    ONE_BY_ONE,
    false,
    [],
    'free',
    1,
    (ctx, f, v) => paintCrockStack(ctx, f, v),
    { destructible: DESTRUCTIBLE_CROCKERY },
  ),
  sack_pile: def('sack_pile', { w: 2, h: 1 }, false, [], 'free', 2, (ctx, f, v) =>
    paintSackPile(ctx, f, v),
  ),
  // The Sleeping Cat Inn's composed pieces. The bar is built in sections so
  // each carries its own `counter` anchor: one for Ossie behind it, one for a
  // customer leaning on the near end.
  inn_hearth: def('inn_hearth', { w: 3, h: 2 }, false, ['hearth'], 'wall', 1, paintInnHearth, {
    interaction: { kind: 'use', id: 'hearth' },
  }),
  inn_back_bar: def('inn_back_bar', { w: 6, h: 1 }, false, [], 'wall', 1, paintInnBackBar, {
    interaction: { kind: 'examine', id: 'slate_menu' },
  }),
  inn_bar: def('inn_bar', { w: 3, h: 1 }, false, ['counter'], 'free', 2, paintInnBar),
  inn_dresser: def('inn_dresser', { w: 2, h: 1 }, false, [], 'wall', 1, paintInnDresser, {
    destructible: DESTRUCTIBLE_CROCKERY,
  }),
  cat_stool: def('cat_stool', ONE_BY_ONE, false, [], 'free', 1, paintCatStool),
  fireside_chair: def('fireside_chair', ONE_BY_ONE, false, [], 'free', 1, paintFiresideChair, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  log_basket: def('log_basket', ONE_BY_ONE, false, [], 'free', 1, paintLogBasket, {
    destructible: DESTRUCTIBLE_BASKET,
  }),
  inn_table: def('inn_table', { w: 3, h: 1 }, false, ['table'], 'free', 2, paintInnTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  inn_bench: def('inn_bench', { w: 3, h: 1 }, false, [], 'free', 1, paintInnBench, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  inn_guest_bed: def('inn_guest_bed', { w: 2, h: 2 }, false, [], 'free', 2, paintInnGuestBed),
  inn_cot: def('inn_cot', { w: 1, h: 2 }, false, [], 'free', 2, paintInnCot),
  // One braided-rug painter scaled to three footprints: the hearth and
  // supper-queue mats, a bedside mat, and a runner.
  rag_rug: def('rag_rug', { w: 4, h: 3 }, true, [], 'free', 2, paintRagRug),
  rag_rug_small: def('rag_rug_small', { w: 3, h: 2 }, true, [], 'free', 2, paintRagRug),
  rag_runner: def('rag_runner', { w: 4, h: 1 }, true, [], 'free', 2, paintRagRug),
  washstand: def('washstand', ONE_BY_ONE, false, [], 'free', 1, paintWashstand, {
    destructible: DESTRUCTIBLE_JARS,
  }),
  cat_portrait: def(
    'cat_portrait',
    ONE_BY_ONE,
    false,
    [],
    'wall',
    1,
    (ctx, f) => paintCatPortrait(ctx, f),
    { interaction: { kind: 'examine', id: 'cat_portrait' } },
  ),
  dairy_churn: def('dairy_churn', ONE_BY_ONE, false, [], 'free', 1, paintDairyChurn, {
    interaction: { kind: 'examine', id: 'dairy_churn' },
  }),
  cask_rack: def('cask_rack', { w: 2, h: 1 }, false, [], 'free', 1, paintCaskRack),
  tab_ledger: def('tab_ledger', ONE_BY_ONE, false, [], 'wall', 1, paintTabLedger, {
    interaction: { kind: 'examine', id: 'tab_ledger' },
  }),
  trophy_banner: def('trophy_banner', ONE_BY_ONE, false, [], 'wall', 1, paintTrophyBanner, {
    interaction: { kind: 'examine', id: 'trophy_banner' },
  }),
  // The Horned Flagon's composed pieces. The feast table and the trestles
  // are built in sections so every section carries its own `table` anchor:
  // the hall seats a full house, and an unposted occupant takes one each.
  flagon_hearth: def(
    'flagon_hearth',
    { w: 4, h: 2 },
    false,
    ['hearth'],
    'wall',
    1,
    paintFlagonHearth,
    {
      interaction: { kind: 'use', id: 'hearth' },
    },
  ),
  guild_booth: def('guild_booth', { w: 4, h: 1 }, false, [], 'wall', 1, paintGuildBooth, {
    interaction: { kind: 'examine', id: 'guild_booth' },
  }),
  booth_screen: def('booth_screen', { w: 1, h: 2 }, false, [], 'free', 1, paintBoothScreen),
  booth_table: def('booth_table', { w: 2, h: 1 }, false, ['table'], 'free', 1, paintBoothTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  feast_table: def('feast_table', { w: 2, h: 1 }, false, ['table'], 'free', 3, paintFeastTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  feast_bench: def('feast_bench', { w: 2, h: 1 }, false, [], 'free', 1, paintFeastBench, {
    interaction: { kind: 'examine', id: 'feast_bench' },
  }),
  flagon_back_bar: def(
    'flagon_back_bar',
    { w: 5, h: 1 },
    false,
    [],
    'wall',
    1,
    paintFlagonBackBar,
    {
      interaction: { kind: 'examine', id: 'flagon_back_bar' },
    },
  ),
  flagon_bar: def('flagon_bar', { w: 5, h: 1 }, false, ['counter'], 'free', 1, paintFlagonBar),
  flagon_trophy: def('flagon_trophy', ONE_BY_ONE, false, [], 'wall', 2, paintFlagonTrophy, {
    interaction: { kind: 'examine', id: 'flagon_trophy' },
  }),
  torchere: def('torchere', ONE_BY_ONE, false, [], 'free', 1, paintTorchere, {
    destructible: DESTRUCTIBLE_BRAZIER,
  }),
  trestle_table: def(
    'trestle_table',
    { w: 2, h: 1 },
    false,
    ['table'],
    'free',
    2,
    paintTrestleTable,
    {
      destructible: DESTRUCTIBLE_TABLE,
    },
  ),
  flagon_carpet: def('flagon_carpet', { w: 12, h: 4 }, true, [], 'free', 1, paintFlagonCarpet),
  flagon_hearth_rug: def(
    'flagon_hearth_rug',
    { w: 4, h: 1 },
    true,
    [],
    'free',
    1,
    paintFlagonCarpet,
  ),
  flagon_runner: def('flagon_runner', { w: 3, h: 4 }, true, [], 'free', 1, paintFlagonCarpet),
  coat_rack: def('coat_rack', ONE_BY_ONE, false, [], 'free', 1, paintCoatRack, {
    interaction: { kind: 'search', id: 'coat_hook' },
  }),
  flagon_chair: def('flagon_chair', ONE_BY_ONE, false, [], 'free', 1, paintFlagonChair, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  deal_bench: def('deal_bench', { w: 2, h: 1 }, false, [], 'free', 1, paintDealBench, {
    destructible: DESTRUCTIBLE_CHAIR,
  }),
  flagon_sideboard: def(
    'flagon_sideboard',
    { w: 2, h: 1 },
    false,
    [],
    'free',
    1,
    paintFlagonSideboard,
    {
      destructible: DESTRUCTIBLE_CROCKERY,
    },
  ),
  dartboard: def('dartboard', ONE_BY_ONE, false, [], 'wall', 1, paintDartboard, {
    interaction: { kind: 'use', id: 'throw_dart' },
  }),
  bolted_door: def('bolted_door', ONE_BY_ONE, false, [], 'wall', 1, paintBoltedDoor, {
    interaction: { kind: 'examine', id: 'bolted_door' },
  }),
  // The Sunken Stump's pieces. The bar is built in sections so each carries
  // its own `counter` anchor, and every table, trestle and upturned barrel
  // carries a `table` anchor: the dive's roster is nearly all drinkers.
  stump_back_shelf: def(
    'stump_back_shelf',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    2,
    paintStumpBackShelf,
    {
      destructible: DESTRUCTIBLE_JARS,
    },
  ),
  stump_bar: def('stump_bar', { w: 3, h: 1 }, false, ['counter'], 'free', 2, paintStumpBar),
  chalk_tally: def('chalk_tally', ONE_BY_ONE, false, [], 'wall', 1, paintChalkTally, {
    interaction: { kind: 'examine', id: 'chalk_tally' },
  }),
  dice_table: def('dice_table', { w: 2, h: 1 }, false, ['table'], 'free', 1, paintDiceTable, {
    interaction: { kind: 'examine', id: 'dice_table' },
  }),
  stump_table: def('stump_table', { w: 2, h: 1 }, false, ['table'], 'free', 2, paintStumpTable, {
    destructible: DESTRUCTIBLE_TABLE,
  }),
  barrel_table: def('barrel_table', ONE_BY_ONE, false, ['table'], 'free', 2, paintBarrelTable, {
    destructible: DESTRUCTIBLE_BARREL,
  }),
  keg_stack: def('keg_stack', { w: 2, h: 1 }, false, ['crate'], 'free', 1, paintKegStack, {
    destructible: DESTRUCTIBLE_BARREL,
  }),
  junk_heap: def('junk_heap', ONE_BY_ONE, false, [], 'free', 1, paintJunkHeap, {
    destructible: DESTRUCTIBLE_CRATE,
  }),
  floor_stain: def('floor_stain', ONE_BY_ONE, true, [], 'free', 3, paintFloorStain),
  smoky_lamp: def('smoky_lamp', ONE_BY_ONE, false, [], 'wall', 1, paintSmokyLamp, {
    destructible: DESTRUCTIBLE_LAMP,
  }),
  stump_stove: def('stump_stove', ONE_BY_ONE, false, ['hearth'], 'wall', 1, paintStumpStove, {
    interaction: { kind: 'use', id: 'hearth' },
  }),
  // The Barracks' composed pieces. The counter, the dummies, the muster board
  // and the briefing table each carry the anchor the one-tile fixtures they
  // stand in for used to, so Dann, Pell, the recruit at the board and the
  // posted orders still find their furniture.
  garrison_weapon_rack: def(
    'garrison_weapon_rack',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    2,
    paintGarrisonWeaponRack,
    { interaction: { kind: 'examine', id: 'garrison_spear_rack' } },
  ),
  armour_stand_row: def(
    'armour_stand_row',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    1,
    paintArmourStandRow,
    { interaction: { kind: 'examine', id: 'armour_stand' } },
  ),
  issue_counter: def(
    'issue_counter',
    { w: 5, h: 1 },
    false,
    ['counter'],
    'free',
    1,
    paintIssueCounter,
    { interaction: { kind: 'examine', id: 'issue_counter' } },
  ),
  straw_dummy: def('straw_dummy', ONE_BY_ONE, false, ['dummy'], 'free', 2, paintStrawDummy, {
    interaction: { kind: 'examine', id: 'straw_dummy' },
  }),
  pell_post: def('pell_post', ONE_BY_ONE, false, ['dummy'], 'free', 2, paintPellPost, {
    interaction: { kind: 'examine', id: 'pell_post' },
  }),
  archery_butt: def('archery_butt', { w: 2, h: 1 }, false, [], 'wall', 1, paintArcheryButt, {
    interaction: { kind: 'examine', id: 'archery_butt' },
  }),
  drill_slate: def('drill_slate', { w: 2, h: 1 }, false, [], 'wall', 1, paintDrillSlate, {
    interaction: { kind: 'examine', id: 'drill_slate' },
  }),
  water_trough: def('water_trough', { w: 2, h: 1 }, false, [], 'free', 1, paintWaterTrough, {
    destructible: DESTRUCTIBLE_BARREL,
  }),
  sandbags: def('sandbags', { w: 2, h: 1 }, false, [], 'free', 2, paintSandbags, {
    destructible: DESTRUCTIBLE_SACK,
  }),
  bunk_bed: def('bunk_bed', { w: 2, h: 1 }, false, [], 'free', 2, paintBunkBed),
  muster_board: def('muster_board', { w: 4, h: 1 }, false, ['board'], 'wall', 1, paintMusterBoard),
  briefing_table: def(
    'briefing_table',
    { w: 4, h: 1 },
    false,
    ['table'],
    'free',
    1,
    paintBriefingTable,
    {
      destructible: DESTRUCTIBLE_TABLE,
      interaction: { kind: 'examine', id: 'briefing_table' },
    },
  ),
  sparring_ring: def('sparring_ring', { w: 9, h: 4 }, true, [], 'free', 1, paintSparringRing),
  records_cabinet: def('records_cabinet', ONE_BY_ONE, false, [], 'wall', 2, paintRecordsCabinet, {
    destructible: DESTRUCTIBLE_SHELF,
    interaction: { kind: 'examine', id: 'records_cabinet' },
  }),
  pigeonhole_wall: def(
    'pigeonhole_wall',
    { w: 3, h: 1 },
    false,
    [],
    'wall',
    1,
    paintPigeonholeWall,
    { interaction: { kind: 'examine', id: 'pigeonhole_wall' } },
  ),
  scrivener_desk: def(
    'scrivener_desk',
    { w: 2, h: 1 },
    false,
    ['table'],
    'free',
    2,
    paintScrivenerDesk,
    {
      destructible: DESTRUCTIBLE_TABLE,
      interaction: { kind: 'examine', id: 'scrivener_desk' },
    },
  ),
  magistrate_desk: def(
    'magistrate_desk',
    { w: 4, h: 1 },
    false,
    ['table'],
    'free',
    1,
    paintMagistrateDesk,
    { interaction: { kind: 'examine', id: 'magistrate_desk' } },
  ),
  archive_boxes: def('archive_boxes', ONE_BY_ONE, false, ['crate'], 'free', 2, paintArchiveBoxes, {
    destructible: DESTRUCTIBLE_CRATE,
  }),
  writ_board: def('writ_board', { w: 2, h: 1 }, false, ['board'], 'wall', 1, paintWritBoard, {
    interaction: { kind: 'examine', id: 'writ_board' },
  }),
  coil_bench: def('coil_bench', { w: 3, h: 1 }, false, [], 'free', 1, paintCoilBench, {
    interaction: { kind: 'examine', id: 'coil_bench' },
  }),
  conduit_coil: def('conduit_coil', ONE_BY_ONE, false, [], 'free', 1, paintConduitCoil, {
    interaction: { kind: 'examine', id: 'conduit_coil' },
  }),
  tower_hearth: def(
    'tower_hearth',
    { w: 4, h: 2 },
    false,
    ['hearth'],
    'wall',
    1,
    paintTowerHearth,
    { interaction: { kind: 'use', id: 'hearth' } },
  ),
  petition_counter: def(
    'petition_counter',
    { w: 5, h: 1 },
    false,
    ['counter'],
    'free',
    1,
    paintPetitionCounter,
    { interaction: { kind: 'examine', id: 'petition_counter' } },
  ),
} as const satisfies Record<string, TownInteriorPropDef>;

export type TownInteriorPropId = keyof typeof TOWN_INTERIOR_PROPS;

export function isTownInteriorPropId(value: string): value is TownInteriorPropId {
  return Object.prototype.hasOwnProperty.call(TOWN_INTERIOR_PROPS, value);
}

// ── Runtime cache ────────────────────────────────────────────────────────

interface CachedPropFrame {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

const frameCache = new Map<string, CachedPropFrame>();

/** Deterministic per-`(propId, variant)` seed — the same prop always paints the same picture. */
function propVariantSeed(propId: TownInteriorPropId, variant: number): number {
  let hash = 0;
  for (let i = 0; i < propId.length; i++) hash = (hash * 31 + propId.charCodeAt(i)) >>> 0;
  const VARIANT_SEED_STRIDE = 9973;
  return (hash + variant * VARIANT_SEED_STRIDE) >>> 0;
}

function bakePropFrame(propId: TownInteriorPropId, variant: number): CachedPropFrame {
  const propDef = TOWN_INTERIOR_PROPS[propId];
  const headroomTiles = frameHeadroomTilesFor(propId);
  const width = Math.ceil(propDef.footprint.w * TOWN_TILE_SCALE);
  const height = Math.ceil((propDef.footprint.h + headroomTiles) * TOWN_TILE_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error(`townInteriorProps: 2D context unavailable for ${propId}`);
  const frame: TownPropFrame = {
    originX: 0,
    // `TownPropFrame.originY` is the top of the footprint's bottom-left
    // tile (`footprintBox` puts the foot one tile below it), so it sits one
    // tile above the canvas bottom whatever the footprint's depth — anchoring
    // it `h` tiles up paints every two-row prop one row north of the rows
    // it blocks.
    originY: height - TOWN_TILE_SCALE,
    tileScale: TOWN_TILE_SCALE,
    footprintW: propDef.footprint.w,
    footprintH: propDef.footprint.h,
  };
  const rng = mulberry32(propVariantSeed(propId, variant));
  propDef.paint(ctx, frame, variant, rng);
  return { canvas, width, height };
}

function cacheKey(propId: TownInteriorPropId, variant: number): string {
  return `${propId}:${variant}`;
}

function cachedPropFrame(propId: TownInteriorPropId, variant: number): CachedPropFrame {
  const key = cacheKey(propId, variant);
  const existing = frameCache.get(key);
  if (existing !== undefined) return existing;
  const baked = bakePropFrame(propId, variant);
  frameCache.set(key, baked);
  return baked;
}

/**
 * Draws one placed prop instance at its tile position. `tileX`/`tileY` name
 * the footprint's north-west (top-left) tile — the same grid convention
 * `applyTownInteriorLayout`'s blocking loop and `townInteriorPropSortY` use —
 * in tile units, matching every other interior renderer's
 * `(camX, camY, tileSize)` convention.
 */
export function drawTownInteriorProp(
  ctx: Ctx,
  propId: TownInteriorPropId,
  variant: number,
  tileX: number,
  tileY: number,
  camX: number,
  camY: number,
  tileSize: number,
): void {
  const propDef = TOWN_INTERIOR_PROPS[propId];
  const safeVariant = ((variant % propDef.variants) + propDef.variants) % propDef.variants;
  const frame = cachedPropFrame(propId, safeVariant);
  const footprint = propDef.footprint;
  const destW = (frame.width / TOWN_TILE_SCALE) * tileSize;
  const destH = (frame.height / TOWN_TILE_SCALE) * tileSize;
  const destX = tileX * tileSize - camX;
  const destBottomY = (tileY + footprint.h) * tileSize - camY;
  ctx.drawImage(frame.canvas, destX, destBottomY - destH, destW, destH);
}

/**
 * The `InteriorFigure.y` a placed prop instance sorts on: the *top* of the
 * footprint's southmost row. `BuildingInteriorScene.renderSortedEntities`
 * adds one tile to every figure's `y` to get its actual sort line (the row's
 * bottom edge) — the same convention `propSortY` in `src/core/clubProps.ts`
 * uses for the club's furniture, which this matches so a prop and a club
 * fixture standing on the same row sort identically.
 */
export function townInteriorPropSortY(
  tileY: number,
  footprint: TownInteriorFootprint,
  tileSize: number,
): number {
  return (tileY + footprint.h - 1) * tileSize;
}

/**
 * Alpha a frame pixel must exceed to count as art. A soft shadow's feathered
 * edge sits below it, so the measured top is where the prop visibly ends.
 */
const VISIBLE_ART_ALPHA_THRESHOLD = 8;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL_OFFSET = 3;
/** Measured rise per `propId:variant`; a frame's art never changes once baked. */
const artRiseCache = new Map<string, number>();

/** The first frame row holding any visible pixel, or the frame's height when it holds none. */
function firstOpaqueRow(frame: CachedPropFrame): number {
  const ctx = frame.canvas.getContext('2d');
  if (ctx === null) return frame.height;
  const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
  for (let row = 0; row < frame.height; row++) {
    for (let col = 0; col < frame.width; col++) {
      const alpha = pixels[(row * frame.width + col) * RGBA_CHANNELS + ALPHA_CHANNEL_OFFSET];
      if (alpha > VISIBLE_ART_ALPHA_THRESHOLD) return row;
    }
  }
  return frame.height;
}

/**
 * How many tiles a placed prop's painted art actually reaches above the top
 * row of its footprint (negative when it stops short of it). Measured from the
 * baked frame rather than read from `artHeightTiles`, which is the frame's
 * painting allowance: the camera frames a room by what is drawn, and the
 * allowance overstates a short prop by up to a tile.
 */
export function townInteriorPropArtRiseTiles(propId: TownInteriorPropId, variant: number): number {
  const propDef = TOWN_INTERIOR_PROPS[propId];
  const safeVariant = ((variant % propDef.variants) + propDef.variants) % propDef.variants;
  const key = cacheKey(propId, safeVariant);
  const cached = artRiseCache.get(key);
  if (cached !== undefined) return cached;
  const frame = cachedPropFrame(propId, safeVariant);
  const artHeightTiles = (frame.height - firstOpaqueRow(frame)) / TOWN_TILE_SCALE;
  const rise = artHeightTiles - propDef.footprint.h;
  artRiseCache.set(key, rise);
  return rise;
}
