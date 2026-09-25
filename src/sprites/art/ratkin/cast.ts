/**
 * Every ratkin look in the game, as data: Mordecai and the people of Briar
 * Hollow.
 *
 * Each look is one {@link RatkinOutfit}. The painter is shared, so a character
 * is nothing but a fur, a build, a garment stack and a prop — and at a 32px
 * tile he has to be recognisable by **silhouette and one colour** before any of
 * the detail here registers: the mayor's chain, the cook's white apron, Hobb's
 * cloak, Marta's sash, Midge's lantern.
 */

import { VILLAGER_IDS, type VillagerId } from '../../../systems/briarHollow/ratkinDialogue';
import type { RatkinOutfit } from './outfit';
import {
  SHIRT_HEM,
  apron,
  belt,
  beltPouch,
  browGoggles,
  bucketYoke,
  cap,
  chainOfOffice,
  cloak,
  gloves,
  headscarf,
  hood,
  kettleHat,
  kneePads,
  longCoat,
  mantle,
  muddyLegs,
  neckKerchief,
  notchedEar,
  paddedJack,
  patches,
  pencilBehindEar,
  pincushion,
  purse,
  robe,
  sash,
  satchel,
  shawl,
  shirt,
  shoulderStrap,
  skirt,
  smock,
  speckle,
  spectacles,
  strawHat,
  toolBelt,
  trousers,
  tunic,
  vest,
  whiskerScar,
  wrap,
} from './garments';
import type { Ramp } from './paint';

// ── Mordecai ─────────────────────────────────────────────────────────────────

/** Dusty brown-grey back and limbs, the colour a sewer rat actually is. */
const MORDECAI_FUR: Ramp = { dark: '#3b3128', mid: '#6c5b49', light: '#93806a' };
/** The paler underside: throat, chest, belly, cheek, underjaw. */
const MORDECAI_BELLY: Ramp = { dark: '#6a5b4c', mid: '#9d8c77', light: '#c0af98' };
/** A mossy, much-mended tunic. Light enough to hold its own on a dark floor. */
const MORDECAI_TUNIC: Ramp = { dark: '#26382e', mid: '#405f4b', light: '#5a8064' };
/** Belt, satchel strap and pouch. */
const MORDECAI_LEATHER: Ramp = { dark: '#3a2a1c', mid: '#6c4a2e', light: '#916a41' };
const MORDECAI_BUCKLE = '#c2a24e';

/**
 * Mordecai's rodent form: a mossy tunic with cap sleeves, a satchel strap, a
 * buckled belt and a pouch. His cells are held byte for byte against a stored
 * baseline (`npm run verify:mordecai-identity`), so a change to the shared
 * painter that moves a single pixel of him fails loudly.
 */
export const MORDECAI_OUTFIT: RatkinOutfit = {
  fur: MORDECAI_FUR,
  belly: MORDECAI_BELLY,
  build: 'standard',
  garments: [
    tunic({ cloth: MORDECAI_TUNIC, sleeve: 'cap' }),
    shoulderStrap({ leather: MORDECAI_LEATHER }),
    belt({ leather: MORDECAI_LEATHER, buckle: MORDECAI_BUCKLE }),
    beltPouch({ leather: MORDECAI_LEATHER }),
  ],
};

// ── Briar Hollow ─────────────────────────────────────────────────────────────

/**
 * Every ratkin of Briar Hollow: the seventeen named villagers and the four
 * unnamed townsfolk (two elders, two children) who make it feel lived in.
 */
export type RatkinCastId =
  VillagerId | 'elder_bracken' | 'elder_thistle' | 'child_nib' | 'child_burr';

/** The four militia, who get the fighting rows. */
export const RATKIN_SOLDIER_IDS = ['sedge', 'hobb', 'marta', 'pru'] as const;
export type RatkinSoldierId = (typeof RATKIN_SOLDIER_IDS)[number];

export function isRatkinSoldier(id: RatkinCastId): id is RatkinSoldierId {
  return RATKIN_SOLDIER_IDS.some((soldier) => soldier === id);
}

/** Shades a single colour into a three-stop ramp, for the many one-off cloths below. */
function ramp(dark: string, mid: string, light: string): Ramp {
  return { dark, mid, light };
}

// Shared materials: the village's leather, iron and brass are one supplier's.
const LEATHER = ramp('#3b2717', '#6d4a2c', '#94693f');
const DARK_LEATHER = ramp('#1f150e', '#3a281a', '#5a4029');
const BRASS = ramp('#6b4f1c', '#c09a3e', '#ecd27a');
const STEEL = ramp('#3d434a', '#7c858f', '#b9c2cb');
const WOOD = ramp('#4a3120', '#7a5433', '#a57a4e');
const BUCKLE = '#c2a24e';
const WATER = '#6f9fb8';

/** The rodent pink every ratkin's bare skin shares, darkened for black fur. */
const DUSKY_SKIN = ramp('#5a3d3a', '#7f5b56', '#a07872');

const BRAMBLEWICK: RatkinOutfit = {
  fur: ramp('#3f3a33', '#766c60', '#a0968a'),
  belly: ramp('#b8b2a6', '#e2ddd2', '#f4f1ea'),
  build: 'elder',
  garments: [
    shirt({ cloth: ramp('#9d9480', '#d6ccb4', '#eee6d2') }),
    longCoat({
      cloth: ramp('#1c3a22', '#2f6338', '#4c8a55'),
      trim: ramp('#6b4f1c', '#b28a36', '#e3c46d'),
    }),
    chainOfOffice({ metal: BRASS }),
    spectacles({ frame: BRASS.light }),
  ],
  heldProp: 'ledger',
};

const MERRIT: RatkinOutfit = {
  fur: ramp('#5a2e17', '#9a5530', '#c47e4f'),
  belly: ramp('#a9795a', '#d6a67c', '#ecc9a6'),
  build: 'standard',
  garments: [
    trousers({ cloth: ramp('#3a2c20', '#5d4631', '#7d6247') }),
    shirt({ cloth: ramp('#4f7394', '#7fa6c9', '#a9c8e3'), sleeve: 'rolled' }),
    apron({ cloth: ramp('#4a5732', '#6c7f4a', '#8fa266'), drop: 0.46 }),
    strawHat({ straw: ramp('#9c7a2c', '#e0bc55', '#f4dc8a'), band: '#b0402c' }),
  ],
  heldProp: 'hoe',
};

const PIPKIN: RatkinOutfit = {
  fur: ramp('#9a8a6a', '#d2c29c', '#ece1c3'),
  belly: ramp('#cfc6b0', '#efe8d6', '#fbf8ef'),
  build: 'stocky',
  garments: [
    trousers({ cloth: ramp('#2b3340', '#46526a', '#66748e') }),
    shirt({ cloth: ramp('#3b4a60', '#59708a', '#7d94ad'), sleeve: 'rolled' }),
    apron({ cloth: ramp('#c9c6bc', '#f7f6f1', '#ffffff'), drop: 0.44 }),
    headscarf({ cloth: ramp('#7c2518', '#c24a36', '#e0735c'), tie: 'nape' }),
    speckle({
      colour: '#ffffff',
      alpha: 0.6,
      count: 6,
      size: 0.014,
      areas: ['arms', 'torso'],
      seed: 3,
    }),
  ],
  heldProp: 'ladle',
};

const SELLA: RatkinOutfit = {
  fur: ramp('#24252a', '#45474f', '#6a6d76'),
  belly: ramp('#6b6d74', '#8a8c93', '#aeb0b6'),
  skin: DUSKY_SKIN,
  build: 'slight',
  garments: [
    robe({ cloth: ramp('#2a3446', '#435270', '#62739a') }),
    satchel({ leather: LEATHER, emblem: '#c8352b' }),
    mantle({ cloth: ramp('#a8b8b1', '#dbe6e1', '#f4f9f6') }),
  ],
};

const VETCH: RatkinOutfit = {
  fur: ramp('#6b4a1e', '#b0803d', '#d4a766'),
  belly: ramp('#bda475', '#e2c796', '#f2e2c0'),
  build: 'slight',
  garments: [
    trousers({ cloth: ramp('#2f2a24', '#4c443a', '#6c6254') }),
    shirt({ cloth: ramp('#1c5459', '#2f7f86', '#56a6ac') }),
    vest({ cloth: ramp('#3e1f4a', '#6a3d7a', '#8e5ea0'), opening: '#2f7f86', pattern: '#d7b25a' }),
    purse({ leather: LEATHER, over: SHIRT_HEM }),
    cap({ cloth: ramp('#4d1a24', '#7a2c3a', '#a04b5a') }),
  ],
  heldProp: 'bag',
};

const OREN: RatkinOutfit = {
  fur: ramp('#141417', '#2e2e34', '#62626c'),
  belly: ramp('#2e2b2c', '#48444a', '#66606a'),
  skin: DUSKY_SKIN,
  eyeTint: '#3a1a0a',
  build: 'stocky',
  garments: [
    trousers({ cloth: ramp('#231f1c', '#3a3430', '#56504a') }),
    speckle({ colour: '#9a4a1c', alpha: 0.7, count: 3, size: 0.013, areas: ['arms'], seed: 7 }),
    apron({ cloth: ramp('#3a2414', '#6b4424', '#8f6238'), drop: 0.5 }),
    gloves({ leather: ramp('#4a2a14', '#8a5028', '#b87840') }),
    speckle({
      colour: '#000000',
      alpha: 0.35,
      count: 3,
      size: 0.018,
      areas: ['arms', 'head'],
      seed: 11,
    }),
  ],
  heldProp: 'smith_hammer',
};

const TIKKA: RatkinOutfit = {
  fur: ramp('#7d6a45', '#c2a878', '#e0cc9f'),
  belly: ramp('#cdbd9a', '#eee0bf', '#faf2de'),
  build: 'standard',
  garments: [
    trousers({ cloth: ramp('#2f2d38', '#4d4a5a', '#6d6a7e') }),
    shirt({ cloth: ramp('#8a6412', '#c8962e', '#e6b955'), sleeve: 'rolled' }),
    toolBelt({
      leather: LEATHER,
      buckle: BUCKLE,
      handle: WOOD,
      blueprint: ramp('#22426e', '#3f6ea8', '#6d9bd2'),
      over: SHIRT_HEM,
    }),
    browGoggles({ strap: LEATHER, lens: '#5fc7c0', rim: BRASS.mid }),
  ],
};

const FENNA: RatkinOutfit = {
  fur: ramp('#4d2418', '#86402b', '#b0664b'),
  belly: ramp('#a57a62', '#c99a80', '#e2bca4'),
  build: 'standard',
  garments: [
    trousers({ cloth: ramp('#2e3a33', '#4a5c50', '#6a7f71') }),
    shirt({ cloth: ramp('#5c6f60', '#8a9d8c', '#adbfae'), sleeve: 'rolled' }),
    apron({ cloth: ramp('#8a7650', '#bba77c', '#d8c79f'), drop: 0.46 }),
    neckKerchief({ cloth: ramp('#1c4f8a', '#2f78c8', '#62a0e2') }),
    speckle({
      colour: '#f1dcaa',
      alpha: 0.8,
      count: 9,
      size: 0.012,
      areas: ['arms', 'torso', 'head'],
      seed: 5,
    }),
  ],
};

const GARN: RatkinOutfit = {
  fur: ramp('#2f3438', '#58616a', '#7f8993'),
  belly: ramp('#7b848c', '#9aa3ab', '#bac2c8'),
  build: 'stocky',
  garments: [
    kneePads({ leather: ramp('#6b5a44', '#a58e6c', '#c8b294') }),
    tunic({ cloth: ramp('#8e8676', '#c4bba8', '#e0d9c8'), sleeve: 'rolled' }),
    belt({ leather: DARK_LEATHER, buckle: STEEL.mid }),
    speckle({
      colour: '#d8d2c4',
      alpha: 0.4,
      count: 8,
      size: 0.016,
      areas: ['torso', 'arms'],
      seed: 13,
    }),
    cap({ cloth: ramp('#3a2414', '#5a3a22', '#7c5634') }),
  ],
};

const JACK_GORGET = LEATHER;

const SEDGE: RatkinOutfit = {
  fur: ramp('#5b4632', '#957556', '#bb9c7c'),
  belly: ramp('#b8a283', '#d6c0a3', '#ecdcc4'),
  build: 'slight',
  garments: [
    trousers({ cloth: ramp('#332d24', '#4f4636', '#6d624e') }),
    paddedJack({ cloth: ramp('#2f4f7a', '#4f7cb4', '#7ea6d8'), gorget: JACK_GORGET }),
    belt({ leather: DARK_LEATHER, buckle: STEEL.light, over: SHIRT_HEM }),
    kettleHat({ steel: STEEL }),
  ],
  heldProp: 'spear',
};

const HOBB: RatkinOutfit = {
  fur: ramp('#3c3c3e', '#6d6d70', '#96969a'),
  belly: ramp('#94938f', '#b2b1ad', '#cfcecb'),
  build: 'stocky',
  garments: [
    cloak({ cloth: ramp('#3e4246', '#6f7478', '#949a9e'), clasp: STEEL.light }),
    trousers({ cloth: ramp('#2c2821', '#443e34', '#5f574a') }),
    paddedJack({ cloth: ramp('#7a6640', '#a38d5c', '#c4ae80'), gorget: JACK_GORGET }),
    notchedEar(),
  ],
  heldProp: 'spear',
};

const MARTA: RatkinOutfit = {
  fur: ramp('#5a2414', '#9c4424', '#c96a45'),
  belly: ramp('#b88568', '#dba98c', '#f0cbb2'),
  build: 'standard',
  garments: [
    trousers({ cloth: ramp('#2c2821', '#443e34', '#5f574a') }),
    paddedJack({ cloth: ramp('#76603a', '#9e8456', '#c2a978'), gorget: JACK_GORGET }),
    sash({ cloth: ramp('#7a1418', '#c4242a', '#e8555a') }),
    kettleHat({ steel: STEEL }),
    whiskerScar({ colour: '#f1e2d2' }),
  ],
  heldProp: 'spear',
};

const PRU: RatkinOutfit = {
  fur: ramp('#231710', '#4a3223', '#6e5040'),
  belly: ramp('#6e5646', '#8e725e', '#ae937f'),
  skin: DUSKY_SKIN,
  build: 'stocky',
  garments: [
    trousers({ cloth: ramp('#332d24', '#4f4636', '#6d624e') }),
    paddedJack({ cloth: ramp('#6c5a36', '#8f7a52', '#b09a70'), gorget: JACK_GORGET }),
    headscarf({ cloth: ramp('#8a3c0c', '#dd7a22', '#f4a85a'), tie: 'nape' }),
  ],
  heldProp: 'rough_spear',
};

const NELLA: RatkinOutfit = {
  fur: ramp('#8a6f55', '#c4a585', '#e3c9ab'),
  belly: ramp('#d2bea6', '#f0e0cb', '#fbf3e6'),
  build: 'slight',
  garments: [
    skirt({ cloth: ramp('#5a2440', '#8a3f5e', '#b0647f') }),
    shirt({ cloth: ramp('#b7aa92', '#e6d8c0', '#f7eedf') }),
    pincushion({ cloth: ramp('#7a1418', '#c4242a', '#e8555a'), pin: '#e8e8e8' }),
    shawl({ cloth: ramp('#9c7218', '#d6a53a', '#f0c86a') }),
  ],
};

const CRICKET: RatkinOutfit = {
  fur: ramp('#3e2f1f', '#6e5638', '#937a58'),
  belly: ramp('#8f7a5c', '#b09a7a', '#cdb99b'),
  build: 'standard',
  garments: [
    trousers({ cloth: ramp('#3a4652', '#5b6b7a', '#7d8e9e'), rolled: true }),
    muddyLegs({ mud: '#3a2a18' }),
    shirt({ cloth: ramp('#7d6a44', '#a8905f', '#c9b385') }),
    bucketYoke({ wood: WOOD, bucket: ramp('#6a4a2c', '#9c7448', '#c49a6a'), water: WATER }),
  ],
};

const WICKER: RatkinOutfit = {
  fur: ramp('#9c9483', '#d3cbb8', '#ede7d8'),
  belly: ramp('#dcd6c8', '#f5f1e6', '#fdfbf6'),
  build: 'standard',
  incisorScale: 1.7,
  garments: [
    trousers({ cloth: ramp('#4a3c2e', '#6b5846', '#8c7760') }),
    shirt({ cloth: ramp('#a89c80', '#d8ccb2', '#eee6d4'), sleeve: 'rolled' }),
    vest({ cloth: ramp('#213750', '#3c5a7a', '#5e7e9f'), opening: '#d8ccb2' }),
    pencilBehindEar({ wood: '#e6b83c' }),
  ],
  heldProp: 'claw_hammer',
};

const MIDGE: RatkinOutfit = {
  fur: ramp('#7a3a10', '#c46a2a', '#e89655'),
  belly: ramp('#d2a67c', '#f1c9a0', '#fbe3c8'),
  build: 'slight',
  garments: [
    tunic({ cloth: ramp('#4e4238', '#7a6a58', '#9c8b77'), sleeve: 'long' }),
    shawl({ cloth: ramp('#1b2748', '#2f4270', '#51679a') }),
    hood({ cloth: ramp('#1b2748', '#2f4270', '#51679a') }),
  ],
  heldProp: 'lantern',
};

const ELDER_BRACKEN: RatkinOutfit = {
  fur: ramp('#6e7074', '#aeb0b4', '#d6d8db'),
  belly: ramp('#c9cacb', '#e8e8e6', '#f7f7f5'),
  build: 'elder',
  garments: [
    trousers({ cloth: ramp('#35322d', '#555049', '#77716a') }),
    wrap({ cloth: ramp('#7a3a1a', '#b0603a', '#d88a5e') }),
  ],
  heldProp: 'cane',
};

const ELDER_THISTLE: RatkinOutfit = {
  fur: ramp('#4a4238', '#86796a', '#ab9e8e'),
  belly: ramp('#a39684', '#c4b8a6', '#ded4c5'),
  build: 'elder',
  garments: [
    skirt({ cloth: ramp('#3a2e24', '#5a4a3c', '#7a6856') }),
    tunic({ cloth: ramp('#6c6250', '#9a8c72', '#bcae92'), sleeve: 'long' }),
    speckle({
      colour: '#3a3128',
      alpha: 0.6,
      count: 5,
      size: 0.022,
      areas: ['arms', 'head'],
      seed: 17,
    }),
    shawl({ cloth: ramp('#5c5a2a', '#8c8a48', '#b0ae6a') }),
    headscarf({ cloth: ramp('#43275a', '#6c4a86', '#9270ab'), tie: 'chin' }),
  ],
  heldProp: 'basket',
};

const CHILD_NIB: RatkinOutfit = {
  fur: ramp('#8f7f6b', '#c9b89e', '#e6d8c2'),
  belly: ramp('#d4c7b3', '#efe5d4', '#faf5ec'),
  build: 'child',
  garments: [smock({ cloth: ramp('#a28e48', '#d9c47a', '#efdea2') })],
  heldProp: 'toy',
};

const CHILD_BURR: RatkinOutfit = {
  fur: ramp('#2a2019', '#51402f', '#766250'),
  belly: ramp('#6e5d4c', '#8e7b67', '#ad9a86'),
  build: 'child',
  garments: [
    tunic({ cloth: ramp('#44566b', '#6d7f93', '#93a4b6'), sleeve: 'rolled' }),
    patches({ cloth: ramp('#9c8a62', '#cdb88a', '#e6d6b0'), thread: '#3a2a18' }),
  ],
};

/** Every Briar Hollow look, keyed by cast id. */
/**
 * Every villager carries in the right paw, so every villager sweeps the tail
 * past the left hip, where it cannot hang beside the prop and fuse with it.
 */
function villagerLook(outfit: RatkinOutfit): RatkinOutfit {
  return { ...outfit, tailHip: 'left' };
}

export const RATKIN_CAST_OUTFITS: Readonly<Record<RatkinCastId, RatkinOutfit>> = {
  bramblewick: villagerLook(BRAMBLEWICK),
  merrit: villagerLook(MERRIT),
  pipkin: villagerLook(PIPKIN),
  sella: villagerLook(SELLA),
  vetch: villagerLook(VETCH),
  oren: villagerLook(OREN),
  tikka: villagerLook(TIKKA),
  fenna: villagerLook(FENNA),
  garn: villagerLook(GARN),
  sedge: villagerLook(SEDGE),
  hobb: villagerLook(HOBB),
  marta: villagerLook(MARTA),
  pru: villagerLook(PRU),
  nella: villagerLook(NELLA),
  cricket: villagerLook(CRICKET),
  wicker: villagerLook(WICKER),
  midge: villagerLook(MIDGE),
  elder_bracken: villagerLook(ELDER_BRACKEN),
  elder_thistle: villagerLook(ELDER_THISTLE),
  child_nib: villagerLook(CHILD_NIB),
  child_burr: villagerLook(CHILD_BURR),
};

/** Every cast id, named villagers first, in a stable order. */
export const RATKIN_CAST_IDS: readonly RatkinCastId[] = [
  ...VILLAGER_IDS,
  'elder_bracken',
  'elder_thistle',
  'child_nib',
  'child_burr',
];
