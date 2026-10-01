import { TILE_SIZE } from '../core/constants';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameMap } from '../map/GameMap';
import {
  BARREL,
  BARREL_SIDE,
  BOOKSHELF,
  BRAZIER,
  CRATE,
  HOARD_BAG,
  TORCH,
  PROP_DAMAGE_STAGE_CRACKED,
  PROP_DAMAGE_STAGE_DENTED,
  PROP_DAMAGE_STAGE_INTACT,
  type TileContent,
} from '../map/tileTypes';
import { inferFloorType } from '../map/tiles/helpers';
import {
  MULTI_TILE_PROP_FOOTPRINTS,
  PROP_PART_TILE_TYPES,
  multiTileAnchorOf,
  multiTileFootprintTiles,
} from '../map/serviceLevelProps';
import {
  SIGN_SKID_FRAMES,
  type ServicePropKind,
} from '../sprites/art/serviceProps/serviceFurnitureArt';
import {
  GAS_CYLINDER_BLAST_RADIUS_PX,
  GAS_CYLINDER_FUSE_FRAMES,
  SERVICE_PROP_KIND_LIST,
  SERVICE_PROP_KINDS,
  perServiceKind,
  rollContents,
  servicePropKindForTileType,
} from './destruction/serviceLevelPropKinds';
import {
  CELLAR_PROP_KINDS,
  CELLAR_PROP_KIND_LIST,
  cellarPropKindForTileType,
  isCellarPropKind,
  perCellarKind,
} from './destruction/cellarPropKinds';
import type { CellarBreakableKind } from '../sprites/sheets/cellarPropSheets';
import { cellarPropVariant } from '../map/tiles/cellarPropTiles';
import {
  REMAINS_PROP_KINDS,
  REMAINS_PROP_KIND_LIST,
  isRemainsPropKind,
  perRemainsKind,
  remainsPropKindForTileType,
} from './destruction/remainsPropKinds';
import {
  serviceLevelSplinterShades,
  themedPropMaterials,
  themedPropSmashCue,
  themedPropSpill,
} from './destruction/themedPropMaterials';
import type { RemainsKind } from '../sprites/art/remainsArt';
import { onServiceLevel, propVariantIndex } from '../map/dungeon/propVariants';
import {
  isThemedPropKind,
  themedPropLookFrame,
  themedPropSpriteKey,
} from '../sprites/breakablePropSprites';
import type { SpriteKey } from '../core/SpriteLoader';
import { drawSpriteKey, progressFrameIndex } from '../core/SpriteRenderer';
import { randomInt } from '../utils';
import type { GameSystem } from './GameSystem';
import type { LootSystem } from './LootSystem';
import { MELEE_POINT_BLANK_RANGE } from './CombatSystem';
import { tileCoordKey } from '../map/tileIndex';
import type { WallFixture, WallFixtureKind } from '../map/dungeon/wallFixtures';
import type { Mob } from '../creatures/Mob';
import type { DamageSource, Player } from '../Player';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import {
  MATERIAL_REACTIONS,
  dentsBeforeBreaking,
  type BreakMaterial,
  type DebrisShape,
  type SmashCue,
} from './destruction/breakMaterials';
import { Debris } from './destruction/debris';
import type { SpillKind } from './destruction/spillDecals';
import { WreckageField, type FixtureSpill, type Wreckage } from './destruction/wreckageField';
import type { DynamicLightSink, DynamicLightSource } from './lighting/dynamicLights';
import type { DynamicLightKind } from './lighting/lightKinds';
import type { GroundHazardSource } from './GroundHazardSource';
import {
  WallFixtureDamage,
  type WallFixtureEvent,
  type WallFixtureSnapshot,
} from './wallFixtureDamage';

const CARDINAL_NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Tile center offset as a fraction of tile size. */
const TILE_CENTER_OFFSET = 0.5;
/** Full turn in radians. */
const TWO_PI = Math.PI * 2;

/** The prop tile types a melee swing can break. */
export type DestructiblePropKind =
  | 'barrel'
  | 'barrel_side'
  | 'crate'
  | 'torch'
  | 'brazier'
  | 'bookshelf'
  | 'garbage_bag'
  | ServicePropKind
  | CellarBreakableKind
  | RemainsKind;

/** Whether a kind is one of the service level's, whose particulars live in its own table. */
function isServiceKind(kind: DestructiblePropKind): kind is ServicePropKind {
  return kind in SERVICE_PROP_KINDS;
}

/**
 * Which of a kind's wreckage pictures a broken piece leaves: a cellar piece's
 * wreckage is painted per variant, so it is the same variant that stood there.
 */
function remainsFrameFor(kind: DestructiblePropKind, tileX: number, tileY: number): number {
  if (isCellarKind(kind)) return cellarPropVariant(kind, tileX, tileY);
  if (isThemedPropKind(kind)) return themedPropLookFrame(kind, tileX, tileY);
  if (isRemainsPropKind(kind)) return propVariantIndex(tileX, tileY);
  return 0;
}

/**
 * The sheet a broken prop's break and wreckage are drawn from: the floor's
 * own version of a barrel, crate, bookshelf, torch or brazier, and every other
 * kind's own sheet.
 */
function spriteKeyFor(kind: DestructiblePropKind, tileX: number, tileY: number): SpriteKey {
  return isThemedPropKind(kind) ? themedPropSpriteKey(kind, tileX, tileY) : kind;
}

/** Whether a kind is one of the cellars', whose particulars live in its own table. */
function isCellarKind(kind: DestructiblePropKind): kind is CellarBreakableKind {
  return isCellarPropKind(kind);
}

/**
 * Everything breakable, which is what a dungeon floor and a building interior
 * both allow.
 */
export const ALL_BREAKABLE_PROPS: ReadonlySet<DestructiblePropKind> = new Set([
  'barrel',
  'barrel_side',
  'crate',
  'torch',
  'brazier',
  'bookshelf',
  'garbage_bag',
  ...SERVICE_PROP_KIND_LIST,
  ...CELLAR_PROP_KIND_LIST,
  ...REMAINS_PROP_KIND_LIST,
]);

/**
 * Nothing breakable, for a map whose props are scenery. The outdoor town's
 * street torches and gate braziers are architecture — a crawler knocking the
 * lamps out of a peaceful town square is not a mechanic anyone asked for.
 */
export const NO_BREAKABLE_PROPS: ReadonlySet<DestructiblePropKind> = new Set();

const BARREL_HP = 6;
const BARREL_SIDE_HP = 5;
const CRATE_HP = 6;
/** A torch is a stick in a stand — the flimsiest of the props. */
const TORCH_HP = 4;
/** All iron and squat with it, so a brazier takes the most punishment of the lot. */
const BRAZIER_HP = 9;
/** A joined case standing a whole tile tall — more timber than a crate carries. */
const BOOKSHELF_HP = 8;
/** A split bag of rubbish in the Hoarder's lair: two punches and it goes. */
const GARBAGE_BAG_HP = 2;
/**
 * The share of breaks that leave coins. One in ten for a garbage bag — the odd
 * coin in a bag of rubbish is the find; paying out on every bag would make
 * seven of them in one room a purse.
 */
const COIN_DROP_CHANCE: Readonly<Partial<Record<DestructiblePropKind, number>>> = {
  garbage_bag: 0.1,
};
/**
 * HP a prop that is already wearing its cracked art comes back missing when its
 * health entry has to be rebuilt. It cannot come back at full: `damageStage`
 * outlives this system, so an undamaged rebuild would show damaged art.
 */
const CRACKED_REBUILD_HP_PENALTY = 1;
/** Frames a prop flashes white after being struck. */
const HIT_FLASH_FRAMES = 6;
/** Peak opacity of the hit flash. */
const HIT_FLASH_MAX_ALPHA = 0.5;
/** Radius of the hit flash glow, as a fraction of a tile. */
const HIT_FLASH_RADIUS_TILE_FRACTION = 0.55;
const HIT_FLASH_RADIUS_PX = TILE_SIZE * HIT_FLASH_RADIUS_TILE_FRACTION;

const SHATTER_FRAME_COUNT = 6;
const SHATTER_FRAMES_PER_STEP = 5;
const SHATTER_TOTAL_FRAMES = SHATTER_FRAME_COUNT * SHATTER_FRAMES_PER_STEP;
/** A knocked sign's skid: quick, a fifth of a second from standing to down. */
const SIGN_SKID_FRAMES_PER_STEP = 3;
const SIGN_SKID_TOTAL_FRAMES = SIGN_SKID_FRAMES * SIGN_SKID_FRAMES_PER_STEP;

const SPLINTER_SPEED_MIN = 1.2;
const SPLINTER_SPEED_MAX = 3.0;
const SPLINTER_LIFETIME_MIN = 30;
const SPLINTER_LIFETIME_MAX = 50;
/** Fraction of splinters thrown away from the puncher rather than in a full circle. */
const SPLINTER_FORWARD_CONE_BIAS = 0.7;
/** Half-angle of that forward cone. */
const SPLINTER_FORWARD_CONE_NUMERATOR = 2;
const SPLINTER_FORWARD_CONE_DENOMINATOR = 3;
const SPLINTER_FORWARD_CONE_HALF_ANGLE =
  Math.PI * (SPLINTER_FORWARD_CONE_NUMERATOR / SPLINTER_FORWARD_CONE_DENOMINATOR);
const SPLINTER_LENGTH_MIN = 3;
const SPLINTER_LENGTH_MAX = 7;
/** Splinters spawn scattered up to this far either side of their origin. */
const SPLINTER_SPAWN_SCATTER_PX = 4;
/**
 * The share of a break's pieces drawn from its second material — the oak
 * staves of an iron-hooped cask, the paper out of a steel cabinet — so a
 * piece made of two things comes apart as both.
 */
const SECOND_MATERIAL_SHARE = 0.3;
/** A blow's pieces are thrown slower than a break's: knocked off, not burst out. */
const HIT_DEBRIS_SPEED_SCALE = 0.6;
const HIT_DEBRIS_LIFE_SCALE = 0.6;
/** Puffs and drops are smaller than splinters; sparks are short streaks. */
const ROUND_PIECE_SIZE_SCALE = 0.6;
/** Every blow knocks a little dust off the floor at the piece's foot. */
const DUST_PUFFS = 3;
const DUST_COLOURS = ['#7a7062', '#8c8273'] as const;
const DUST_PUFF_SIZE_PX = 5;
const DUST_PUFF_SPEED = 0.5;
const DUST_PUFF_LIFE = 22;
/** The foot of a piece, where its dust rises: just above the bottom of its tile. */
const DUST_FOOT_OFFSET_TILES = 0.35;
/** A blow's shudder, in pixels either way. */
const WOBBLE_AMPLITUDE_PX = 1;
const STILL = { x: 0, y: 0 } as const;
const WOBBLE_RIGHT = { x: WOBBLE_AMPLITUDE_PX, y: 0 } as const;
const WOBBLE_LEFT = { x: -WOBBLE_AMPLITUDE_PX, y: 0 } as const;
/** Health a dented piece holds at after the blow that would have broken it whole. */
const DENTED_HOLD_HP = 1;

/**
 * How often something in a broken piece turns out to have been living in it:
 * a swarm of beetles (cellars) or roaches (service level) bolting for the
 * walls. Cosmetic and rare, so it stays a surprise.
 */
const SWARM_CHANCE = 0.07;
/**
 * The pieces something could be living in: sealed, dark, left alone. Only the
 * dungeon's own furniture — never a building's barrel or the Hoarder's
 * rubbish, whose room has real cockroaches in it.
 */
export const SWARM_HIDING_KINDS: ReadonlySet<DestructiblePropKind> = new Set<DestructiblePropKind>([
  'clay_urn',
  'grain_sack',
  'wine_cask',
  'bone_pile',
  'slumped_skeleton',
  'rubble_heap',
  'locker_bank',
  'filing_cabinet',
  'vending_machine',
  'pallet_stack',
]);

/** A broken flame lights an oil spill this close to it. */
const BROKEN_FLAME_IGNITE_TILES = 1.5;
const BROKEN_FLAME_IGNITE_PX = TILE_SIZE * BROKEN_FLAME_IGNITE_TILES;
/** A fireball, a blast or a patch of fire lights an oil spill within this of its centre. */
const FLAME_IGNITE_PX = TILE_SIZE;
/** The dynamic lights that are fire, and so set oil alight. */
const FLAME_LIGHT_KINDS: ReadonlySet<DynamicLightKind> = new Set<DynamicLightKind>([
  'fireball',
  'lava_bolt',
  'explosion',
  'coals',
]);
/** Damage a burning spill does to anyone standing in it, per tick. */
const OIL_FIRE_DAMAGE = 1;
/** No one is to blame for a burning floor, so it is undodgeable, like the llama's fire. */
const OIL_FIRE_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'burningOil' };

/** What a wall fixture leaves on the floor below it when it breaks. */
const FIXTURE_SPILLS: Readonly<Partial<Record<WallFixtureKind, FixtureSpill>>> = {
  sconce: 'coals',
  fluorescent_tube: 'glass',
  sodium_lamp: 'glass',
};

/**
 * Whether a mob knocked back into a breakable prop damages it. Off: it adds a
 * lot of physicality but touches how fights play, so it waits on playtest.
 */
export const MOBS_BREAK_PROPS = false;
/** The blow a shoved mob lands on the prop it slams into. */
const KNOCKBACK_PROP_DAMAGE = 3;
/** How far past its own edge a shoved mob feels for a prop in its way, in pixels. */
const KNOCKBACK_CONTACT_PX = 4;
/**
 * Where a kind's splinters come off, in tile heights relative to the tile
 * centre: the middle of the prop's own mass, and the span its pieces reach over.
 *
 * The boxy props are a tile wide and sit inside their tile, so a point source at
 * its centre is exactly right. A torch is a pole standing a tile above the floor
 * — spawning its debris at the tile centre would drop the whole burst around the
 * player's feet instead of down the length of the thing that just snapped. A
 * bookshelf is a case standing most of a tile taller than its own, so its pieces
 * come off over that whole height rather than out of a single point.
 */
const SPLINTER_ORIGIN_OFFSET_TILES: Record<DestructiblePropKind, number> = {
  barrel: 0,
  barrel_side: 0,
  crate: 0,
  torch: -0.16,
  brazier: -0.06,
  bookshelf: -0.4,
  garbage_bag: 0,
  ...perServiceKind((def) => def.splinterOffsetTiles),
  ...perCellarKind((def) => def.splinterOffsetTiles),
  ...perRemainsKind((def) => def.splinterOffsetTiles),
};
const SPLINTER_ORIGIN_SPAN_TILES: Record<DestructiblePropKind, number> = {
  barrel: 0,
  barrel_side: 0,
  crate: 0,
  torch: 1.05,
  brazier: 0.3,
  bookshelf: 1.4,
  garbage_bag: 0,
  ...perServiceKind((def) => def.splinterSpanTiles),
  ...perCellarKind((def) => def.splinterSpanTiles),
  ...perRemainsKind((def) => def.splinterSpanTiles),
};

/** A uniform random number in [-1, 1]. */
const bipolarRandom = () => Math.random() * 2 - 1;

/** Wood tones for the splinter shards — the same ramp the prop sheets are drawn in. */
const WOOD_SPLINTER_SHADES = ['#3a2413', '#5a3a1e', '#7a5028', '#9a6a38', '#c09050'] as const;
/**
 * Bent iron and spilled coals, for the one prop with no wood in it. Sharing the
 * wood ramp would throw brown splinters out of an iron bowl.
 */
const IRON_SPLINTER_SHADES = ['#3a4048', '#4a5058', '#6b7480', '#ff8a1e', '#e2450f'] as const;

/** Which break cue a kind plays, which decides how its break sounds and looks. */
function materialFor(kind: DestructiblePropKind): SmashCue {
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].smashCue;
  if (isCellarKind(kind)) return CELLAR_PROP_KINDS[kind].smashCue;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].smashCue;
  if (isThemedPropKind(kind)) return themedPropSmashCue(kind);
  return 'trash';
}

/** A garbage bag is torn bin liner round paper rubbish. */
const GARBAGE_BAG_MATERIALS: readonly [BreakMaterial, ...BreakMaterial[]] = ['plastic', 'paper'];

/** What a kind is made of on the current floor, chief material first. */
export function materialsOf(
  kind: DestructiblePropKind,
): readonly [BreakMaterial, ...BreakMaterial[]] {
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].materials;
  if (isCellarKind(kind)) return CELLAR_PROP_KINDS[kind].materials;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].materials;
  if (isThemedPropKind(kind)) return themedPropMaterials(kind);
  return GARBAGE_BAG_MATERIALS;
}

/** What a kind spills round its wreckage when it breaks on this tile, or null for a clean break. */
function spillFor(kind: DestructiblePropKind, tileX: number, tileY: number): SpillKind | null {
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].spill;
  if (isCellarKind(kind)) return CELLAR_PROP_KINDS[kind].spill;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].spill;
  if (isThemedPropKind(kind)) return themedPropSpill(kind, tileX, tileY);
  return null;
}

/**
 * Whether a kind is a naked flame, whose break drops fire on the floor: a
 * cellar torch or a candle cluster. The service level's torch tile is an
 * electric work lamp. A brazier is fire too, but it spills coals, which do
 * their own lighting.
 */
function isOpenFlame(kind: DestructiblePropKind): boolean {
  if (kind === 'candle_cluster') return true;
  return kind === 'torch' && !onServiceLevel();
}

/** Whether a damage stage is any of the hurt-but-standing ones. */
function isDamagedStage(stage: number | undefined): boolean {
  return (stage ?? PROP_DAMAGE_STAGE_INTACT) !== PROP_DAMAGE_STAGE_INTACT;
}

/** Torn black plastic and the rubbish it held, for a burst garbage bag. */
const TRASH_SPLINTER_SHADES = ['#1d1f23', '#34373e', '#d3cbb2', '#b3322b', '#d9a23a'] as const;

/** The debris palette a kind throws when it breaks. */
function splinterShadesFor(
  kind: DestructiblePropKind,
  tileX: number,
  tileY: number,
): ReadonlyArray<string> {
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].splinterShades;
  if (isCellarKind(kind)) return CELLAR_PROP_KINDS[kind].splinterShades;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].splinterShades;
  if (isThemedPropKind(kind)) {
    const serviceLevelShades = serviceLevelSplinterShades(kind, tileX, tileY);
    if (serviceLevelShades !== null) return serviceLevelShades;
  }
  if (kind === 'garbage_bag') return TRASH_SPLINTER_SHADES;
  return materialFor(kind) === 'iron' ? IRON_SPLINTER_SHADES : WOOD_SPLINTER_SHADES;
}

/** Breaks that happened since the scene last drained them, by material. */
export type SmashCounts = Record<SmashCue, number>;

/**
 * Something a prop did that has a sound of its own, for the owner to give a
 * cue (`propEventCues` in `src/systems/dungeon/dungeonSoundCues.ts`).
 *
 * - `struck`: took a blow and held.
 * - `broken`: gave way.
 * - `sign_skid`: a mop bucket's wet-floor sign knocked flat by its first crack.
 * - `ignited`: a spill caught light.
 * - `scuttled`: a broken prop let out a swarm of critters.
 */
export interface PropAudioEvent {
  readonly name: 'struck' | 'broken' | 'sign_skid' | 'ignited' | 'scuttled';
  readonly kind: DestructiblePropKind;
  /** The kind's material cue, for a kind with no cue of its own. */
  readonly smashCue: SmashCue;
  /** World pixels, at the prop's centre. */
  readonly x: number;
  readonly y: number;
  /** Whether the break dropped coins. */
  readonly coins: boolean;
}

/**
 * Damage large enough to flatten any prop in one application, whatever its
 * remaining health. Used by blasts, which have no business chipping a crate.
 */
const INSTANT_DESTROY_DAMAGE = Number.MAX_SAFE_INTEGER;

/** Coins a break drops: floor 1 → 1–2, floor 2 → 2–3, and so on. */
const COIN_SPREAD = 1;

export interface PropHealth {
  tileX: number;
  tileY: number;
  kind: DestructiblePropKind;
  hp: number;
  maxHp: number;
  hitFlashFrames: number;
  /** Frames left of the shudder a blow leaves; cosmetic, never checkpointed. */
  wobbleFrames: number;
}

/** A broken gas bottle hissing towards its blast. */
export interface GasFuse {
  readonly tileX: number;
  readonly tileY: number;
  /** The blast's centre, in world pixels. */
  readonly x: number;
  readonly y: number;
  framesLeft: number;
}

/** Where a burnt-out fuse goes off, in world pixels, and how far its blast reaches. */
export interface GasDetonation {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
}

interface ShatterBurst {
  tileX: number;
  tileY: number;
  kind: DestructiblePropKind;
  frames: number;
}

/**
 * The map-side half of one prop, which the tile owns rather than this system.
 *
 * A smashed prop is smashed *on the GameMap*: its tile becomes floor and its
 * health entry is deleted outright, so `health` alone carries no record that the
 * prop ever existed. Without the tile there is nothing to rewind it from.
 */
export interface PropTileState {
  tileX: number;
  tileY: number;
  type: number;
  damageStage: number | undefined;
  groundType: number | undefined;
}

/**
 * An undamaged prop's tile has these fields *absent* rather than set to
 * `undefined`, and the renderers read absence — so a restore has to delete
 * them, not write undefined over them.
 */
function applyPropTileState(tile: TileContent, state: PropTileState): void {
  if (state.damageStage === undefined) delete tile.damageStage;
  else tile.damageStage = state.damageStage;

  if (state.groundType === undefined) delete tile.groundType;
  else tile.groundType = state.groundType;
}

/** Everything a safe-room checkpoint has to rewind about the floor's props. */
export interface DestructiblePropCheckpoint {
  health: ReadonlyMap<number, PropHealth>;
  smashCounts: SmashCounts;
  wreckage: ReadonlyArray<Wreckage>;
  propTiles: ReadonlyArray<PropTileState>;
  /** Every wall fixture's health, broken state and tear, by fixture id. */
  wallFixtures: ReadonlyArray<WallFixtureSnapshot>;
  /**
   * Gas bottles still hissing when the checkpoint was taken. The bottle is
   * already broken in `propTiles`, so a restore that dropped its fuse would
   * leave wreckage that never goes off.
   */
  fuses: ReadonlyArray<GasFuse>;
}

function kindForTileType(type: number): DestructiblePropKind | null {
  if (type === BARREL) return 'barrel';
  if (type === BARREL_SIDE) return 'barrel_side';
  if (type === CRATE) return 'crate';
  if (type === TORCH) return 'torch';
  if (type === BRAZIER) return 'brazier';
  if (type === BOOKSHELF) return 'bookshelf';
  if (type === HOARD_BAG) return 'garbage_bag';
  return (
    servicePropKindForTileType(type) ??
    cellarPropKindForTileType(type) ??
    remainsPropKindForTileType(type)
  );
}

/** Tile type for each breakable kind, the inverse of {@link kindForTileType}. */
export const TILE_TYPE_FOR_KIND: Record<DestructiblePropKind, number> = {
  barrel: BARREL,
  barrel_side: BARREL_SIDE,
  crate: CRATE,
  torch: TORCH,
  brazier: BRAZIER,
  bookshelf: BOOKSHELF,
  garbage_bag: HOARD_BAG,
  ...perServiceKind((def) => def.tileType),
  ...perCellarKind((def) => def.tileType),
  ...perRemainsKind((def) => def.tileType),
};

/** A kind's health when whole. */
export function startingHpFor(kind: DestructiblePropKind): number {
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].hp;
  if (isCellarKind(kind)) return CELLAR_PROP_KINDS[kind].hp;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].hp;
  if (kind === 'barrel') return BARREL_HP;
  if (kind === 'barrel_side') return BARREL_SIDE_HP;
  if (kind === 'torch') return TORCH_HP;
  if (kind === 'brazier') return BRAZIER_HP;
  if (kind === 'bookshelf') return BOOKSHELF_HP;
  if (kind === 'garbage_bag') return GARBAGE_BAG_HP;
  return CRATE_HP;
}

/**
 * Lets a melee swing break the barrels, crates, torches, braziers and bookshelves
 * strewn through a dungeon floor: the prop cracks, then shatters into splinters
 * and a wreckage decal, the tile opens up for both players and mob pathfinding,
 * and a small depth-scaled coin drop is left behind.
 *
 * Prop health is created lazily on the first hit, so a floor carrying thousands
 * of props costs nothing until the player actually swings at one.
 */
export class DestructiblePropSystem implements GameSystem, GroundHazardSource, DynamicLightSource {
  private readonly health = new Map<number, PropHealth>();
  private readonly bursts: ShatterBurst[] = [];
  /** Wet-floor signs skidding off their bucket after its first knock. */
  private readonly signSkids: Array<{ tileX: number; tileY: number; frames: number }> = [];
  /** What the floor's broken props left lying: wreckage, spills, coals and burning oil. */
  private readonly field = new WreckageField();
  private readonly debris = new Debris();
  /**
   * Told when something was living in what just broke, at the break, so the
   * floor's critters can come bursting out of it. Answers whether any did:
   * none do at the performance preset, and a scuttle with nothing scuttling
   * is a sound with no cause.
   */
  private surpriseSink: ((worldX: number, worldY: number) => boolean) | null = null;
  /**
   * Whatever carries fire this frame — fireballs, blasts, burning patches —
   * asked only while an oil spill lies waiting for a flame.
   */
  private flameSources: ReadonlyArray<DynamicLightSource> = [];
  private readonly flameProbe: DynamicLightSink = {
    add: (x, y, kind) => {
      if (FLAME_LIGHT_KINDS.has(kind)) this.field.igniteNear(x, y, FLAME_IGNITE_PX);
    },
  };
  /** Mobs whose current knockback has already slammed them into a prop. */
  private readonly shovedIntoProp = new Set<Mob>();
  /** See {@link MOBS_BREAK_PROPS}; a gate turns it on for the system it tests. */
  mobsBreakProps = MOBS_BREAK_PROPS;
  private readonly smashCounts: SmashCounts = { wood: 0, iron: 0, trash: 0 };
  private readonly audioEvents: PropAudioEvent[] = [];
  /** Broken gas bottles still hissing towards their blast. */
  private readonly fuses: GasFuse[] = [];
  /** Blasts whose fuse has burnt out, waiting for the dynamite system to set them off. */
  private readonly detonations: GasDetonation[] = [];
  private fusesLit = 0;
  /** Tile types of every breakable prop kind this map allows, for the smash-through sight test. */
  private readonly breakableTileTypes: ReadonlySet<number>;
  /** Sconces, panels, chains and banners hung on the floor's wall faces. */
  private readonly wallFixtures: WallFixtureDamage;

  constructor(
    private readonly gameMap: GameMap,
    private readonly loot: LootSystem,
    private readonly floorNumber: number,
    /**
     * Which prop kinds this map lets a swing break. A floor whose props are
     * scenery passes {@link NO_BREAKABLE_PROPS} rather than going without the
     * system, so every scene builds the same shape and nothing downstream has to
     * carry a null.
     */
    private readonly breakable: ReadonlySet<DestructiblePropKind> = ALL_BREAKABLE_PROPS,
  ) {
    this.breakableTileTypes = new Set(Array.from(breakable, (kind) => TILE_TYPE_FOR_KIND[kind]));
    this.wallFixtures = new WallFixtureDamage(
      gameMap,
      (cue) => this.smashCounts[cue]++,
      (fixture) => this.spillFromFixture(fixture),
    );
  }

  /**
   * Names what a surprise in a broken prop sets running — the floor's
   * beetles or roaches — so they burst out of it.
   */
  setSurpriseSink(sink: (worldX: number, worldY: number) => boolean): void {
    this.surpriseSink = sink;
  }

  /** A broken sconce drops its coals, a broken tube its glass, on the floor in front of the wall. */
  private spillFromFixture(fixture: WallFixture): void {
    const spill = FIXTURE_SPILLS[fixture.kind];
    if (spill === undefined) return;
    this.field.addFixtureSpill(fixture.tileX, fixture.tileY + 1, spill);
  }

  /**
   * The breakable piece a tile belongs to — itself, or for a part tile of a
   * multi-tile piece, that piece's anchor — or null when there is nothing to
   * break there.
   */
  private breakableTargetAt(
    tx: number,
    ty: number,
  ): { readonly x: number; readonly y: number; readonly kind: DestructiblePropKind } | null {
    const structure = this.gameMap.structure;
    const type = structure[ty][tx].type;
    if (!PROP_PART_TILE_TYPES.has(type)) {
      const kind = this.breakableKindAt(type);
      return kind === null ? null : { x: tx, y: ty, kind };
    }
    const anchor = multiTileAnchorOf(structure, tx, ty);
    if (anchor === null) return null;
    const kind = this.breakableKindAt(structure[anchor.y][anchor.x].type);
    return kind === null ? null : { x: anchor.x, y: anchor.y, kind };
  }

  /** The kind of breakable prop on this tile, or null when there is nothing to break. */
  private breakableKindAt(type: number): DestructiblePropKind | null {
    const kind = kindForTileType(type);
    if (kind === null || !this.breakable.has(kind)) return null;
    return kind;
  }

  /**
   * Resolve a melee swing against every destructible prop in range.
   * Returns true if at least one prop was struck.
   *
   * A single swing can hit several props — that is what makes clearing a crate
   * stack feel worth doing.
   */
  tryMeleeHit(attacker: HumanPlayer | CatPlayer, range: number, damage: number): boolean {
    return this.damagePropsInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      range,
      damage,
      attacker,
      { x: attacker.facingX, y: attacker.facingY },
    );
  }

  /**
   * Resolve an area attack against every destructible prop inside its radius.
   * Unlike a swing there is no facing cone — a stomp comes down on everything
   * around the player, behind them included.
   */
  tryAreaHit(attacker: HumanPlayer | CatPlayer, radius: number, damage: number): boolean {
    return this.damagePropsInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      radius,
      damage,
      attacker,
      null,
    );
  }

  /**
   * Resolve a projectile impact at a world point. Returns true if it struck a
   * prop, which the caller uses to detonate the projectile.
   */
  tryProjectileHit(
    x: number,
    y: number,
    radius: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
  ): boolean {
    return this.damagePropsInRange(x, y, radius, damage, owner, null);
  }

  /**
   * Flatten every prop inside a blast, whatever its remaining health. A stick
   * of dynamite does not chip a crate.
   */
  destroyInRadius(x: number, y: number, radius: number, owner: HumanPlayer | CatPlayer): boolean {
    const hit = this.damagePropsInRange(x, y, radius, INSTANT_DESTROY_DAMAGE, owner, null);
    // A blast is fire: oil anywhere in it goes up, a drum it has just split included.
    this.field.igniteNear(x, y, radius);
    return hit;
  }

  /**
   * Flatten every prop in radius the way {@link destroyInRadius} does, but from
   * a crawler's own centre rather than an arbitrary blast point, and with the
   * sight test treating every other breakable prop as glass: a crate standing
   * behind a barrel is still in reach of the same stomp that just splintered
   * the barrel. A real wall still shadows both.
   */
  smashAllInRadius(attacker: HumanPlayer | CatPlayer, radius: number): boolean {
    return this.damagePropsInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      radius,
      INSTANT_DESTROY_DAMAGE,
      attacker,
      null,
      true,
    );
  }

  private damagePropsInRange(
    originX: number,
    originY: number,
    range: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
    facing: { x: number; y: number } | null,
    ignoreBreakableSight = false,
  ): boolean {
    const originTileX = Math.floor(originX / TILE_SIZE);
    const originTileY = Math.floor(originY / TILE_SIZE);
    const searchRadiusTiles = Math.ceil(range / TILE_SIZE) + 1;

    const structure = this.gameMap.structure;
    const firstTileY = Math.max(0, originTileY - searchRadiusTiles);
    const lastTileY = Math.min(structure.length - 1, originTileY + searchRadiusTiles);

    let hitAnything = false;
    // A piece wider than one tile is in reach through any of its tiles, but one
    // blow lands on it once however many of them the blow covers.
    const struckPieces = new Set<number>();
    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      const row = structure[ty];
      const firstTileX = Math.max(0, originTileX - searchRadiusTiles);
      const lastTileX = Math.min(row.length - 1, originTileX + searchRadiusTiles);
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const target = this.breakableTargetAt(tx, ty);
        if (target === null) continue;
        const { kind } = target;
        const key = tileCoordKey(target.x, target.y);
        if (struckPieces.has(key)) continue;
        const tile = structure[target.y][target.x];

        const centerX = (tx + TILE_CENTER_OFFSET) * TILE_SIZE;
        const centerY = (ty + TILE_CENTER_OFFSET) * TILE_SIZE;
        const dx = centerX - originX;
        const dy = centerY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > range) continue;
        // Same forward hemisphere the mob filter uses, so props and mobs answer
        // to the same swing.
        if (facing !== null && dist > MELEE_POINT_BLANK_RANGE) {
          const dot = (dx / dist) * facing.x + (dy / dist) * facing.y;
          if (dot <= 0) continue;
        }
        // Melee reaches a little under two tiles, far enough to clip a prop
        // through a wall — without this the player could pop crates in a room
        // they have not entered. The prop's own tile is named as exempt so the
        // test stays correct however the ray decides to treat its end tile.
        const inSight = ignoreBreakableSight
          ? this.gameMap.hasLineOfSightIgnoringTypes(
              originX,
              originY,
              centerX,
              centerY,
              this.breakableTileTypes,
              { tileX: tx, tileY: ty },
            )
          : this.gameMap.hasLineOfSight(originX, originY, centerX, centerY, {
              tileX: tx,
              tileY: ty,
            });
        if (!inSight) continue;

        hitAnything = true;
        struckPieces.add(key);
        let health = this.health.get(key);
        // Any damage cracks the art, so stored damage on a prop wearing whole
        // art is stale: something stood the prop back up since (a boss room
        // putting its fight back after an abort), and it starts fresh.
        if (health !== undefined && !isDamagedStage(tile.damageStage)) {
          this.health.delete(key);
          health = undefined;
        }
        if (health === undefined) {
          const maxHp = startingHpFor(kind);
          // A prop already wearing its cracked art must not rebuild at full
          // health: `damageStage` lives on the GameMap, which outlives this
          // system, so an undamaged rebuild would show damaged art.
          const wasCracked = isDamagedStage(tile.damageStage);
          const startingHp = wasCracked ? Math.max(1, maxHp - CRACKED_REBUILD_HP_PENALTY) : maxHp;
          health = {
            tileX: target.x,
            tileY: target.y,
            kind,
            hp: startingHp,
            maxHp,
            hitFlashFrames: 0,
            wobbleFrames: 0,
          };
          this.health.set(key, health);
        }
        health.hp -= damage;
        health.hitFlashFrames = HIT_FLASH_FRAMES;
        const materials = materialsOf(kind);
        const dents = dentsBeforeBreaking(materials[0], health.maxHp);
        // Sheet metal buckles before it gives: the first blow that would have
        // broken it whole dents it instead. A blast is not a blow.
        const isBlast = damage >= INSTANT_DESTROY_DAMAGE;
        const reprieved =
          dents && !isBlast && health.hp <= 0 && tile.damageStage !== PROP_DAMAGE_STAGE_DENTED;
        if (reprieved) health.hp = DENTED_HOLD_HP;
        health.wobbleFrames = MATERIAL_REACTIONS[materials[0]].wobbleFrames;

        if (health.hp <= 0) {
          this.breakProp(target.x, target.y, kind, owner, originX, originY);
          this.health.delete(key);
        } else {
          // Any damage at all cracks the art: a swing that lands but leaves the
          // prop looking untouched reads as a swing that missed. No chunk
          // invalidation needed — props draw live in the Y-sorted pass.
          const firstCrack = !isDamagedStage(tile.damageStage);
          tile.damageStage = dents ? PROP_DAMAGE_STAGE_DENTED : PROP_DAMAGE_STAGE_CRACKED;
          this.spawnHitDebris(target.x, target.y, kind, materials, originX, originY);
          const skidsSign =
            firstCrack && isServiceKind(kind) && SERVICE_PROP_KINDS[kind].skidsSignOnCrack;
          if (skidsSign) {
            this.signSkids.push({ tileX: target.x, tileY: target.y, frames: 0 });
          }
          this.pushAudioEvent(skidsSign ? 'sign_skid' : 'struck', kind, target.x, target.y, false);
        }
      }
    }
    if (this.wallFixtures.strike(originX, originY, range, damage, facing)) hitAnything = true;
    return hitAnything;
  }

  /**
   * Snapshots the floor's props so a death rewinds every crate the player
   * cracked or smashed since they entered the safe room.
   *
   * `smashCounts` is in here because it is progress, not effect: it feeds the
   * achievement tally, and a break that has been rewound must not still be
   * counted. The wreckage decals come along for the same reason the tree
   * system's stumps do — a decal is what is left *of a destroyed prop*, so
   * leaving one lying under a crate that is standing again would be the world
   * disagreeing with itself for as long as the floor lasts. The shatter
   * bursts and the flying splinters are deliberately not captured: they are
   * sub-second animations of the moment of breaking, they mark nothing, and both
   * have burnt out long before the death screen clears.
   *
   * Every container is copied on the way out and again on the way back in
   * (`restoreCheckpoint`), the `PropHealth` values included, because one
   * snapshot is restored once per death and handing the stored objects to the
   * live map would let the first restore's gameplay mutate the snapshot.
   */
  captureCheckpoint(): DestructiblePropCheckpoint {
    const health = new Map<number, PropHealth>();
    for (const [key, prop] of this.health) health.set(key, { ...prop });
    return {
      health,
      smashCounts: { ...this.smashCounts },
      wreckage: this.field.capture(),
      propTiles: this.capturePropTiles(),
      wallFixtures: this.wallFixtures.captureCheckpoint(),
      fuses: this.fuses.map((fuse) => ({ ...fuse })),
    };
  }

  /**
   * Sweeps the whole grid for prop tiles. O(map) once per safe-room entry, and
   * only tiles that *are* props at capture time need recording: nothing in the
   * game builds a crate, so a tile that is floor now can never become a prop
   * that would have to be rewound.
   */
  private capturePropTiles(): PropTileState[] {
    const tiles: PropTileState[] = [];
    const structure = this.gameMap.structure;
    for (let ty = 0; ty < structure.length; ty++) {
      const row = structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const tile = row[tx];
        // A multi-tile piece's part tiles go back with its anchor, or a rewound
        // desk would stand on one tile with open floor where its other half was.
        const isPiecePart = PROP_PART_TILE_TYPES.has(tile.type);
        if (this.breakableKindAt(tile.type) === null && !isPiecePart) continue;
        tiles.push({
          tileX: tx,
          tileY: ty,
          type: tile.type,
          damageStage: tile.damageStage,
          groundType: tile.groundType,
        });
      }
    }
    return tiles;
  }

  restoreCheckpoint(snapshot: DestructiblePropCheckpoint): void {
    this.health.clear();
    // The flash and shudder answer a blow struck before the save, not one in the rewound room.
    for (const [key, prop] of snapshot.health) {
      this.health.set(key, { ...prop, hitFlashFrames: 0, wobbleFrames: 0 });
    }

    this.smashCounts.wood = snapshot.smashCounts.wood;
    this.smashCounts.iron = snapshot.smashCounts.iron;
    this.smashCounts.trash = snapshot.smashCounts.trash;

    this.field.restore(snapshot.wreckage);
    // Moments of breaking, not state: none of them belongs to the rewound room.
    this.debris.clear();
    this.bursts.length = 0;
    this.signSkids.length = 0;
    this.audioEvents.length = 0;
    this.shovedIntoProp.clear();

    this.restorePropTiles(snapshot.propTiles);
    this.fuses.length = 0;
    for (const fuse of snapshot.fuses) this.fuses.push({ ...fuse });
    // A bottle still hissing at the save hisses again, or its blast comes unannounced.
    this.fusesLit = this.fuses.length;
    // A detonation is handed over and drained within the frame it is raised,
    // so none is ever outstanding at a checkpoint.
    this.detonations.length = 0;
    this.wallFixtures.restoreCheckpoint(snapshot.wallFixtures);
  }

  /**
   * Puts the map back under the rewound system: a prop smashed after the
   * checkpoint stands again — solid to both players and to mob pathfinding,
   * since walkability is read off the tile type — and one merely cracked loses
   * its cracked art.
   */
  private restorePropTiles(propTiles: ReadonlyArray<PropTileState>): void {
    for (const state of propTiles) {
      const tile = this.gameMap.structure[state.tileY][state.tileX];
      const isUnchanged =
        tile.type === state.type &&
        tile.damageStage === state.damageStage &&
        tile.groundType === state.groundType;
      if (isUnchanged) continue;

      tile.type = state.type;
      applyPropTileState(tile, state);
      this.gameMap.markTileDirty(state.tileX, state.tileY);
    }
  }

  /**
   * Gas bottles whose fuse burnt out since the last call. The dynamite system
   * sets each off through its own blast, so a bottle hurts, knocks back and
   * flattens exactly as a stick does.
   */
  drainDetonations(): GasDetonation[] {
    return this.detonations.splice(0, this.detonations.length);
  }

  /**
   * Gas bottles whose fuse was lit since the last call, so the owner can start
   * each one's hiss.
   */
  drainFusesLit(): number {
    const lit = this.fusesLit;
    this.fusesLit = 0;
    return lit;
  }

  /**
   * What happened to the floor's wall fixtures since the last drain — a
   * breaker blown, chains swung — named so each can be given its own cue.
   */
  drainWallFixtureEvents(): WallFixtureEvent[] {
    return this.wallFixtures.drainEvents();
  }

  /** Every prop blow, break and skid since the last call, in the order they happened. */
  drainPropAudioEvents(): PropAudioEvent[] {
    return this.audioEvents.splice(0, this.audioEvents.length);
  }

  private pushAudioEvent(
    name: PropAudioEvent['name'],
    kind: DestructiblePropKind,
    tileX: number,
    tileY: number,
    coins: boolean,
  ): void {
    this.audioEvents.push({
      name,
      kind,
      smashCue: materialFor(kind),
      x: (tileX + TILE_CENTER_OFFSET) * TILE_SIZE,
      y: (tileY + TILE_CENTER_OFFSET) * TILE_SIZE,
      coins,
    });
  }

  /**
   * Smashes drained by DungeonScene to fire the break cues, split by material so
   * an iron brazier does not collapse to the sound of splitting planks.
   */
  drainSmashes(): SmashCounts {
    const counts = { ...this.smashCounts };
    this.smashCounts.wood = 0;
    this.smashCounts.iron = 0;
    this.smashCounts.trash = 0;
    return counts;
  }

  private breakProp(
    tileX: number,
    tileY: number,
    kind: DestructiblePropKind,
    attacker: HumanPlayer | CatPlayer,
    impactFromX: number,
    impactFromY: number,
  ): void {
    const structure = this.gameMap.structure;
    const footprint = MULTI_TILE_PROP_FOOTPRINTS.get(structure[tileY][tileX].type);
    const pieceTiles =
      footprint === undefined
        ? [{ x: tileX, y: tileY }]
        : multiTileFootprintTiles(tileX, tileY, footprint);
    for (const piece of pieceTiles) {
      const row = piece.y >= 0 && piece.y < structure.length ? structure[piece.y] : null;
      if (row === null || piece.x < 0 || piece.x >= row.length) continue;
      const tile = row[piece.x];
      tile.type = tile.groundType ?? inferFloorType(structure, piece.x, piece.y);
      delete tile.damageStage;
      delete tile.groundType;
      this.gameMap.markTileDirty(piece.x, piece.y);
      // Neighbours too: a floor painter may shade a tile by what stands beside it.
      for (const [dx, dy] of CARDINAL_NEIGHBOURS) {
        this.gameMap.markTileDirty(piece.x + dx, piece.y + dy);
      }
    }

    this.bursts.push({ tileX, tileY, kind, frames: 0 });

    const widthTiles = footprint?.w ?? 1;
    const centerX = (tileX + widthTiles / 2) * TILE_SIZE;
    const centerY = (tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
    this.spawnBreakDebris(
      centerX,
      centerY,
      centerX - impactFromX,
      centerY - impactFromY,
      kind,
      materialsOf(kind),
    );

    this.field.add(tileX, tileY, kind, spillFor(kind, tileX, tileY));
    if (isOpenFlame(kind)) this.field.igniteNear(centerX, centerY, BROKEN_FLAME_IGNITE_PX);
    if (SWARM_HIDING_KINDS.has(kind) && Math.random() < SWARM_CHANCE) {
      const burst = this.surpriseSink?.(centerX, centerY) ?? false;
      if (burst) this.pushAudioEvent('scuttled', kind, tileX, tileY, false);
    }

    if (isServiceKind(kind) && SERVICE_PROP_KINDS[kind].explosive) {
      this.fuses.push({
        tileX,
        tileY,
        x: centerX,
        y: centerY,
        framesLeft: GAS_CYLINDER_FUSE_FRAMES,
      });
      this.fusesLit++;
    }

    const contentsTable = isServiceKind(kind)
      ? SERVICE_PROP_KINDS[kind].contents
      : isCellarKind(kind)
        ? CELLAR_PROP_KINDS[kind].contents
        : isRemainsPropKind(kind)
          ? REMAINS_PROP_KINDS[kind].contents
          : null;
    const contents =
      contentsTable === null
        ? { coins: Math.random() < (COIN_DROP_CHANCE[kind] ?? 1), item: null }
        : rollContents(contentsTable, Math.random);
    if (contents.coins || contents.item !== null) {
      this.loot.addLoot(
        centerX,
        centerY,
        {
          coins: contents.coins ? randomInt(this.floorNumber, this.floorNumber + COIN_SPREAD) : 0,
          items: contents.item === null ? [] : [{ id: contents.item, quantity: 1 }],
        },
        attacker,
        false,
        // Both players are paid the full amount: floor 1 can roll a single coin,
        // and splitting that would pay one of them nothing.
        true,
        // A prop's coins fall and bounce the same as a kill's — the drop is a
        // beat the player is meant to see, not a pile that simply exists.
        true,
      );
    }

    this.smashCounts[materialFor(kind)]++;
    this.pushAudioEvent('broken', kind, tileX, tileY, contents.coins);
  }

  /**
   * The pieces a breaking prop comes apart into: mostly its chief material's,
   * the rest its second material's, thrown mostly away from the blow.
   */
  private spawnBreakDebris(
    cx: number,
    cy: number,
    awayX: number,
    awayY: number,
    kind: DestructiblePropKind,
    materials: readonly [BreakMaterial, ...BreakMaterial[]],
  ): void {
    const chief = MATERIAL_REACTIONS[materials[0]];
    const secondMaterial = materials.length > 1 ? materials[1] : materials[0];
    const second = MATERIAL_REACTIONS[secondMaterial];
    const count = randomInt(chief.breakPiecesMin, chief.breakPiecesMax);
    const shades = splinterShadesFor(kind, Math.floor(cx / TILE_SIZE), Math.floor(cy / TILE_SIZE));
    for (let i = 0; i < count; i++) {
      const fromSecond = materials.length > 1 && Math.random() < SECOND_MATERIAL_SHARE;
      const reaction = fromSecond ? second : chief;
      const colours = fromSecond ? reaction.hitColours : shades;
      this.throwPiece(cx, cy, awayX, awayY, kind, reaction.shape, colours, 1);
    }
  }

  /**
   * What a blow it survives knocks off a piece — a few chips of its chief
   * material — and the dust it shakes off the floor at its foot.
   */
  private spawnHitDebris(
    tileX: number,
    tileY: number,
    kind: DestructiblePropKind,
    materials: readonly [BreakMaterial, ...BreakMaterial[]],
    fromX: number,
    fromY: number,
  ): void {
    const anchorType = this.gameMap.structure[tileY][tileX].type;
    const widthTiles = MULTI_TILE_PROP_FOOTPRINTS.get(anchorType)?.w ?? 1;
    const cx = (tileX + widthTiles / 2) * TILE_SIZE;
    const cy = (tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
    const reaction = MATERIAL_REACTIONS[materials[0]];
    const shades = splinterShadesFor(kind, tileX, tileY);
    for (let i = 0; i < reaction.hitPieces; i++) {
      this.throwPiece(
        cx,
        cy,
        cx - fromX,
        cy - fromY,
        kind,
        reaction.shape,
        shades,
        HIT_DEBRIS_SPEED_SCALE,
      );
    }
    const footY = (tileY + TILE_CENTER_OFFSET + DUST_FOOT_OFFSET_TILES) * TILE_SIZE;
    for (let i = 0; i < DUST_PUFFS; i++) {
      const angle = Math.random() * TWO_PI;
      this.debris.launch({
        x: cx + bipolarRandom() * SPLINTER_SPAWN_SCATTER_PX * 2,
        y: footY,
        vx: Math.cos(angle) * DUST_PUFF_SPEED,
        vy: Math.sin(angle) * DUST_PUFF_SPEED * TILE_CENTER_OFFSET,
        shape: 'puff',
        colour: DUST_COLOURS[i % DUST_COLOURS.length],
        size: DUST_PUFF_SIZE_PX,
        life: DUST_PUFF_LIFE,
      });
    }
  }

  /**
   * One piece off a prop: from somewhere down the prop's own mass, mostly away
   * from whatever struck it. `scale` slows and shortens a blow's pieces
   * against a break's.
   */
  private throwPiece(
    cx: number,
    cy: number,
    awayX: number,
    awayY: number,
    kind: DestructiblePropKind,
    shape: DebrisShape,
    colours: ReadonlyArray<string>,
    scale: number,
  ): void {
    const hasDirection = awayX !== 0 || awayY !== 0;
    const awayAngle = hasDirection ? Math.atan2(awayY, awayX) : 0;
    const originY = cy + SPLINTER_ORIGIN_OFFSET_TILES[kind] * TILE_SIZE;
    const originHalfSpan = (SPLINTER_ORIGIN_SPAN_TILES[kind] * TILE_SIZE) / 2;
    const inForwardCone = hasDirection && Math.random() < SPLINTER_FORWARD_CONE_BIAS;
    const angle = inForwardCone
      ? awayAngle + bipolarRandom() * SPLINTER_FORWARD_CONE_HALF_ANGLE
      : Math.random() * TWO_PI;
    const speed =
      (SPLINTER_SPEED_MIN + Math.random() * (SPLINTER_SPEED_MAX - SPLINTER_SPEED_MIN)) * scale;
    const length =
      SPLINTER_LENGTH_MIN + Math.random() * (SPLINTER_LENGTH_MAX - SPLINTER_LENGTH_MIN);
    const isRound = shape === 'puff' || shape === 'drop' || shape === 'crumb';
    const colour = colours[Math.floor(Math.random() * colours.length)] ?? DUST_COLOURS[0];
    this.debris.launch({
      x: cx + bipolarRandom() * SPLINTER_SPAWN_SCATTER_PX,
      y: originY + bipolarRandom() * originHalfSpan + bipolarRandom() * SPLINTER_SPAWN_SCATTER_PX,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      shape,
      colour,
      size: isRound ? length * ROUND_PIECE_SIZE_SCALE : length,
      life: Math.round(
        randomInt(SPLINTER_LIFETIME_MIN, SPLINTER_LIFETIME_MAX) *
          (scale < 1 ? HIT_DEBRIS_LIFE_SCALE : 1),
      ),
    });
  }

  update(): void {
    this.wallFixtures.update();
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const fuse = this.fuses[i];
      fuse.framesLeft--;
      if (fuse.framesLeft > 0) continue;
      this.detonations.push({ x: fuse.x, y: fuse.y, radiusPx: GAS_CYLINDER_BLAST_RADIUS_PX });
      this.fuses.splice(i, 1);
    }
    for (const health of this.health.values()) {
      if (health.hitFlashFrames > 0) health.hitFlashFrames--;
      if (health.wobbleFrames > 0) health.wobbleFrames--;
    }

    for (let i = this.signSkids.length - 1; i >= 0; i--) {
      this.signSkids[i].frames++;
      if (this.signSkids[i].frames >= SIGN_SKID_TOTAL_FRAMES) this.signSkids.splice(i, 1);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].frames++;
      if (this.bursts[i].frames >= SHATTER_TOTAL_FRAMES) {
        this.bursts[i] = this.bursts[this.bursts.length - 1];
        this.bursts.pop();
      }
    }

    this.debris.update();
    // A prop stood back up where it broke takes its wreckage with it.
    this.field.update(
      (tileX, tileY) => this.breakableKindAt(this.gameMap.structure[tileY][tileX].type) !== null,
    );
    if (this.field.hasUnlitOil) {
      for (const source of this.flameSources) source.collectLights(this.flameProbe);
    }
    for (const lit of this.field.drainIgnitions()) {
      this.pushAudioEvent('ignited', lit.kind, lit.tileX, lit.tileY, false);
    }
  }

  /**
   * Names what carries fire on this floor — fireballs, blasts, burning
   * patches — so a flame passing over an oil spill sets it alight. Each is
   * asked for its lights only while an unlit spill lies waiting.
   */
  setFlameSources(sources: ReadonlyArray<DynamicLightSource>): void {
    this.flameSources = sources;
  }

  /**
   * Sets alight every oil spill within `radius` of world `(x, y)`: what a
   * blast or a spell of fire does to the floor it lands on.
   */
  igniteSpillsInRadius(x: number, y: number, radius: number): number {
    return this.field.igniteNear(x, y, radius);
  }

  /**
   * Burns whoever stands in a spill on fire, crawler and mob alike, a tick at
   * a time. Fire that has not finished rising hurts no one.
   */
  burnOccupants(bodies: Iterable<Player>): void {
    if (!this.field.bitesThisFrame) return;
    for (const body of bodies) {
      if (!body.isAlive) continue;
      if (!this.field.bitesAt(body.x + HALF_TILE, body.y + HALF_TILE)) continue;
      body.takeDamage(OIL_FIRE_DAMAGE, OIL_FIRE_DAMAGE_SOURCE);
    }
  }

  /** Whether any spill is burning. */
  get hasFire(): boolean {
    return this.field.hasFire;
  }

  /** Whether a burning spill bites this frame, so callers gather bodies for {@link burnOccupants} only then. */
  get firesBiteThisFrame(): boolean {
    return this.field.bitesThisFrame;
  }

  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    return this.field.fireEscape(x + HALF_TILE, y + HALF_TILE);
  }

  /** Coals and burning spills light the room round them. */
  collectLights(sink: DynamicLightSink): void {
    this.field.collectLights(sink);
  }

  /** Whether {@link renderGroundWarnings} has anything to draw: a spill on fire. */
  get hasGroundArt(): boolean {
    return this.field.hasFire;
  }

  /** The burning spills, for drawing a second time over the darkness. */
  renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.field.renderFires(ctx, camX, camY);
  }

  /**
   * Lets a mob knocked back into a breakable prop slam it, once per shove,
   * when {@link mobsBreakProps} is on. `credit` is whoever is owed what falls
   * out of it.
   */
  knockMobsIntoProps(mobs: Iterable<Mob>, credit: HumanPlayer | CatPlayer): void {
    if (!this.mobsBreakProps) return;
    for (const mob of mobs) {
      if (mob.knockbackFramesRemaining <= 0) {
        this.shovedIntoProp.delete(mob);
        continue;
      }
      if (this.shovedIntoProp.has(mob)) continue;
      const cx = mob.x + HALF_TILE;
      const cy = mob.y + HALF_TILE;
      const reach = HALF_TILE + KNOCKBACK_CONTACT_PX;
      const aheadTileX = Math.floor((cx + mob.knockbackDirX * reach) / TILE_SIZE);
      const aheadTileY = Math.floor((cy + mob.knockbackDirY * reach) / TILE_SIZE);
      const structure = this.gameMap.structure;
      const insideMap =
        aheadTileY >= 0 &&
        aheadTileY < structure.length &&
        aheadTileX >= 0 &&
        aheadTileX < structure[aheadTileY].length;
      if (!insideMap) continue;
      if (this.breakableTargetAt(aheadTileX, aheadTileY) === null) continue;
      const toTileCentre = Math.hypot(
        (aheadTileX + TILE_CENTER_OFFSET) * TILE_SIZE - cx,
        (aheadTileY + TILE_CENTER_OFFSET) * TILE_SIZE - cy,
      );
      this.shovedIntoProp.add(mob);
      this.damagePropsInRange(cx, cy, toTileCentre, KNOCKBACK_PROP_DAMAGE, credit, {
        x: mob.knockbackDirX,
        y: mob.knockbackDirY,
      });
    }
  }

  /**
   * How far the prop at a tile is shuddering from a blow this frame, in
   * pixels, for the pass that draws it. Zero for a still prop.
   */
  wobbleAt(tileX: number, tileY: number): { readonly x: number; readonly y: number } {
    // Asked for every visible decoration tile every frame, and almost always
    // with nothing struck at all.
    if (this.health.size === 0) return STILL;
    const health = this.health.get(tileCoordKey(tileX, tileY));
    if (health === undefined || health.wobbleFrames <= 0) return STILL;
    // Alternating sides frame by frame: a jolt, not a slide.
    return health.wobbleFrames % 2 === 0 ? WOBBLE_RIGHT : WOBBLE_LEFT;
  }

  /** What broken props left lying on the floor, oldest first; read-only. */
  get wreckage(): ReadonlyArray<Wreckage> {
    return this.field.all;
  }

  /** Settled debris and its spills, drawn on the floor beneath everything else in the world. */
  renderWreckage(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.field.noteView(camX, camY, viewportWidth(), viewportHeight());
    this.field.renderSpills(ctx, camX, camY);
    for (const w of this.field.all) {
      if (w.kind === null) continue;
      drawSpriteKey(
        ctx,
        spriteKeyFor(w.kind, w.tileX, w.tileY),
        'remains',
        remainsFrameFor(w.kind, w.tileX, w.tileY),
        w.tileX * TILE_SIZE - camX,
        w.tileY * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }
    this.field.renderLive(ctx, camX, camY);
  }

  /**
   * The pieces of a break, which belong to the room and are lit as it is: a
   * fixture's flecks, a sign's skid, the shatter and the flying debris. A scene
   * with darkness draws them under it, so splinters in a pitch-dark room are
   * dark too.
   */
  renderBreak(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.wallFixtures.renderEffects(ctx, camX, camY);
    for (const skid of this.signSkids) {
      drawSpriteKey(
        ctx,
        'mop_bucket',
        'skid',
        progressFrameIndex(skid.frames / SIGN_SKID_TOTAL_FRAMES, SIGN_SKID_FRAMES),
        skid.tileX * TILE_SIZE - camX,
        skid.tileY * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }
    for (const burst of this.bursts) {
      drawSpriteKey(
        ctx,
        spriteKeyFor(burst.kind, burst.tileX, burst.tileY),
        'shatter',
        progressFrameIndex(burst.frames / SHATTER_TOTAL_FRAMES, SHATTER_FRAME_COUNT),
        burst.tileX * TILE_SIZE - camX,
        burst.tileY * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }

    this.debris.render(ctx, camX, camY);
  }

  /**
   * What must read whatever the light: a gas bottle's warning, and the flash
   * on a prop that survived a blow, so a hit always shows. Also the pieces of
   * a break unless `breakDrawn` says the scene already drew them, under its
   * darkness, with {@link renderBreak}.
   */
  renderEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    breakDrawn = false,
  ): void {
    if (!breakDrawn) this.renderBreak(ctx, camX, camY);
    for (const fuse of this.fuses) renderGasFuse(ctx, fuse, camX, camY);
    for (const health of this.health.values()) {
      if (health.hitFlashFrames <= 0) continue;
      const flash = (health.hitFlashFrames / HIT_FLASH_FRAMES) * HIT_FLASH_MAX_ALPHA;
      // A two-tile piece is struck in the middle of its width, not on its anchor.
      const anchorType = this.gameMap.structure[health.tileY][health.tileX].type;
      const widthTiles = MULTI_TILE_PROP_FOOTPRINTS.get(anchorType)?.w ?? 1;
      const sx = (health.tileX + widthTiles / 2) * TILE_SIZE - camX;
      // Struck on the prop's own mass, which for a torch is up the pole rather
      // than in the middle of the tile it stands on.
      const sy =
        (health.tileY + TILE_CENTER_OFFSET + SPLINTER_ORIGIN_OFFSET_TILES[health.kind]) *
          TILE_SIZE -
        camY;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, HIT_FLASH_RADIUS_PX);
      glow.addColorStop(0, `rgba(255,240,210,${flash})`);
      glow.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, HIT_FLASH_RADIUS_PX, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** How fast the blast ring pulses while a fuse burns, in pulses per fuse. */
const FUSE_RING_PULSES = 6;
const FUSE_RING_ALPHA_MIN = 0.25;
const FUSE_RING_ALPHA_SPREAD = 0.45;
const FUSE_RING_WIDTH = 2;
const FUSE_FILL_MAX_ALPHA = 0.22;
const FUSE_RING_RGB = '230,60,40';
/** The jet of escaping gas, from the valve at the bottle's top. */
const FUSE_JET_RISE_TILES = 0.85;
const FUSE_JET_PUFFS = 4;
const FUSE_JET_RADIUS_MIN = 2;
const FUSE_JET_RADIUS_GROWTH = 5;
const FUSE_JET_ALPHA = 0.55;
const FUSE_JET_SWAY_PX = 3;
const FUSE_JET_RGB = '230,238,240';

/**
 * A hissing bottle's warning: a jet of gas out of its valve, and the blast's
 * full reach drawn on the floor, filling as the fuse burns down.
 */
function renderGasFuse(
  ctx: CanvasRenderingContext2D,
  fuse: GasFuse,
  camX: number,
  camY: number,
): void {
  const burnt = 1 - fuse.framesLeft / GAS_CYLINDER_FUSE_FRAMES;
  const cx = fuse.x - camX;
  const cy = fuse.y - camY;
  const pulse = (Math.sin(burnt * FUSE_RING_PULSES * TWO_PI) + 1) / 2;
  ctx.save();
  ctx.fillStyle = `rgba(${FUSE_RING_RGB},${FUSE_FILL_MAX_ALPHA * burnt})`;
  ctx.beginPath();
  ctx.arc(cx, cy, GAS_CYLINDER_BLAST_RADIUS_PX * burnt, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = `rgba(${FUSE_RING_RGB},${FUSE_RING_ALPHA_MIN + FUSE_RING_ALPHA_SPREAD * pulse})`;
  ctx.lineWidth = FUSE_RING_WIDTH;
  ctx.beginPath();
  ctx.arc(cx, cy, GAS_CYLINDER_BLAST_RADIUS_PX, 0, TWO_PI);
  ctx.stroke();
  const jetBaseY = cy - HALF_TILE;
  for (let i = 0; i < FUSE_JET_PUFFS; i++) {
    const t = (burnt * FUSE_JET_PUFFS + i / FUSE_JET_PUFFS) % 1;
    const radius = FUSE_JET_RADIUS_MIN + t * FUSE_JET_RADIUS_GROWTH;
    ctx.fillStyle = `rgba(${FUSE_JET_RGB},${FUSE_JET_ALPHA * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(
      cx + Math.sin((t + i) * TWO_PI) * FUSE_JET_SWAY_PX,
      jetBaseY - t * FUSE_JET_RISE_TILES * TILE_SIZE,
      radius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}
