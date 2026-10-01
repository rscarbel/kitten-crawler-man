/**
 * Light and dark on dungeon floors 1 and 2.
 *
 * Every region of the floor has an ambient darkness from its lighting profile
 * — lit rooms are clear, dark rooms near black, hallways in between — and
 * every light cuts a pool out of it. Static lights (torches, braziers, sconces,
 * and every fixture registered later) cut a pool shaped by a shadowcast, so a
 * torch never lights the corridor behind the wall it stands against. Dynamic
 * lights (the crawlers, spells in flight, blasts) are shadowcast too, from
 * the tile centres round them, so they stop at walls and move without
 * jumping. Every edge is soft. How dark anything gets is set in
 * `lighting/lightingTuning.ts`.
 *
 * Shape of a frame, chosen against measured Chrome timings:
 * - A quarter-resolution darkness cache covering half as much again as the
 *   view holds the ambient darkness with every static light already cut out.
 *   It is repainted only when the view leaves it or a static light changes.
 * - Flickering lights are not in the cache: their cuts live on one layer per
 *   flicker profile and group, drawn each frame at that group's flicker.
 * - Each frame copies the cache's view into a small buffer, cuts the flicker
 *   layers, dying lights and dynamic lights out of it, and blits it over the
 *   world with smoothing.
 * - At the sharp preset only, a few additive glows give the light its colour;
 *   at the performance preset the tint of the darkness carries it alone.
 *
 * Nothing here changes what the player can see for any gameplay rule: the
 * visibility fog and every "has the player seen it" test are untouched.
 */

import { TILE_SIZE } from '../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import type { GameMap } from '../map/GameMap';
import {
  BOILER,
  BRAZIER,
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  FloorTypeValue,
  GLOW_FUNGUS,
  METAL_WALL,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_STOVE,
  TORCH,
  VENDING_MACHINE,
  VOID_TYPE,
} from '../map/tileTypes';
import { NO_REGION } from '../map/regionMap';
import { lightSourceTileType } from '../map/dungeon/roomDressing';
import { WALL_FIXTURE_SPECS, isFixturePowered } from '../map/dungeon/wallFixtures';
import type { AmbientLevel, LightColour, LightingProfile } from '../map/dungeon/roomCharacters';
import { LIGHTING_TUNING } from './lighting/lightingTuning';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import { drawRadialGlow } from '../sprites/radialGlow';
import { EYE_COLOR, EYE_GLOW_STOPS } from '../sprites/nurserySprites';
import type { GameSystem } from './GameSystem';
import {
  GLOW_COLOURS,
  isFlameKind,
  lightKindSpec,
  type DynamicLightKind,
  type FlickerProfile,
  type GlowColour,
  type LightKind,
  type LightKindSpec,
} from './lighting/lightKinds';
import {
  LIGHT_BUFFER_SCALE,
  LIGHT_PX_PER_TILE,
  WALL_FACE_ROWS,
  OriginCookieCache,
  VisibilityCache,
  buildLightCookie,
  originsAround,
  parseGlowStops,
  type LightCookie,
  type ParsedGlowStops,
  type PlacedSurface,
} from './lighting/lightCookie';
import type { DynamicLightSink, DynamicLightSource } from './lighting/dynamicLights';
import { drawPuddleGlints } from '../map/tiles/puddleGlints';
import { UINT32_SPAN } from '../core/WorldRandom';

// ── Tuning ──────────────────────────────────────────────────────────────────

/**
 * The region type a floor's tiles fall back to when the generator gave their
 * region no lighting profile: an ordinary dim corridor.
 */
const FALLBACK_AMBIENT: AmbientLevel = 'dim';

/** The colour a floor's unprofiled darkness is tinted with. */
const FLOOR_FALLBACK_COLOUR: Readonly<Record<DungeonFloorThemeId, LightColour>> = {
  cellars: 'warm',
  service_level: 'cool_white',
};

/** The cache covers this many times the view, so a walk repaints it rarely. */
const CACHE_VIEW_SCALE = 1.5;
/** Tiles of slack added round the cache past that scale. */
const CACHE_EDGE_TILES = 2;
/**
 * A clear border round the per-frame buffer, in buffer pixels, that the final
 * blit never samples: stretching a source rect that touches its image's edge
 * makes the edge pixels smear.
 */
const BUFFER_PAD_PX = 2;

/** A moving light's glow up to this radius, in tiles, is drawn as a plain disc. */
const UNSHADOWED_GLOW_MAX_TILES = 2.5;

/** The most additive glows drawn in one frame, nearest the view's centre first. */
const MAX_GLOWS_PER_FRAME = 12;

/**
 * The share of a light's cut its flicker moves: a light at its dimmest cuts
 * `1 - share` of the dark, at its brightest all of it.
 */
export const FLICKER_SHARE: Readonly<Record<FlickerProfile, number>> = {
  steady: 0,
  flame: 0.2,
  brazier: 0.3,
  candle: 0.15,
  faulty_tube: 1,
  pulse: 0.6,
};
/** Flicker groups per profile; lights alternate between them so a room never pulses in step. */
const FLICKER_GROUPS = 2;
/** Below this a group's cut is invisible and its draw is skipped. */
const MIN_VISIBLE_ALPHA = 0.004;

const MS_PER_SECOND = 1000;
/** Bytes of shadow colour stored per tile. */
const RGB_CHANNELS = 3;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const QUARTER = 0.25;

/**
 * Angular rates, in radians a second. A flame is two sines beating against
 * each other at the nursery's sconce rates.
 */
const FLAME_RATE_A = 7.3;
const FLAME_RATE_B = 11.9;
const BRAZIER_RATE_A = 9.1;
const BRAZIER_RATE_B = 15.7;
const CANDLE_RATE = 1.3;
/** About one breath every two seconds. */
const PULSE_RATE = 2.8;
/** Phase offset between the two groups of one profile, in radians. */
const GROUP_PHASE = 2.3;
/** A faulty tube's cycle: every window may hold one dark burst. */
const FAULTY_WINDOW_MS = 2600;
const FAULTY_BURST_CHANCE = 0.4;
const FAULTY_BURST_MIN_MS = 80;
const FAULTY_BURST_MAX_MS = 400;
/** Salts that give a faulty tube's window its burst roll, start and length. */
const FAULTY_BURST_SALT = 2;
const FAULTY_START_SALT = 3;
const FAULTY_LENGTH_SALT = 4;
/** One tube in this many is faulty. */
const FAULTY_TUBE_ONE_IN = 6;

/** A broken light's death: a gutter flash, then darkness, over this long. */
export const LIGHT_DEATH_MS = 250;
/** The flash peaks this far into the death. */
const LIGHT_DEATH_FLASH_MS = 60;
/** How much brighter than its steady glow a dying light flares. */
const LIGHT_DEATH_FLARE = 1.6;
/**
 * A tube losing its power does not gutter like a flame: it fades over this
 * long, catching once on the way down.
 */
export const POWER_DOWN_MS = 400;
/** The dark beat of a powering-down tube's last flicker, as a window of its fade. */
const POWER_DOWN_FLICKER_START_MS = 140;
const POWER_DOWN_FLICKER_END_MS = 200;
/** How much of its cut a tube keeps through that dark beat. */
const POWER_DOWN_FLICKER_DEPTH = 0.15;

/** Smoothing passes that let a lit room's light spill out of its doorways. */
const DOORWAY_SPILL_PASSES = 3;

/** A tile lit this much by a static light is lit enough to see a body in. */
const EYE_SHINE_MAX_STATIC_LIGHT = 0.3;
/** A dynamic light counts as lighting a creature inside this share of its reach. */
const EYE_SHINE_LIGHT_REACH_SHARE = 0.85;
const EYE_SHINE_DOT_RADIUS = 0.035;
const EYE_SHINE_GLOW_RADIUS = 0.22;
const EYE_BLINK_PERIOD_MS = 3700;
/** The share of each blink period the eyes are shut. */
const EYE_BLINK_SHUT_SHARE = 0.06;
/** Spreads blink phases so a pack does not blink in unison. */
const EYE_BLINK_SEED_STEP = 0.37;

/** Bytes per pixel of an image the CPU paints. */
const RGBA_CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTE_MAX = 255;

/** Hash multipliers for per-tile choices; any odd constants with good bit spread. */
const HASH_X = 374761393;
const HASH_Y = 668265263;
const HASH_MIX = 1274126177;
const HASH_SHIFT = 13;

function tileHash(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x, HASH_X) + Math.imul(y, HASH_Y) + Math.imul(salt, HASH_MIX)) | 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_MIX);
  return ((h ^ (h >>> HASH_SHIFT)) >>> 0) / UINT32_SPAN;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * The tile types that carry a light, and the kind each lights as by default.
 *
 * A fixture added later (a sconce, a tube, a vending machine) gets its light
 * by adding its tile type here. A prop standing in for a room's intended light
 * — a torch where the room should have candles — lights as the intended kind
 * when that kind is a flame; see {@link resolveFixtureKind}.
 */
export const STATIC_LIGHT_FIXTURES: ReadonlyMap<number, LightKind> = new Map<number, LightKind>([
  [TORCH, 'standing_torch'],
  [BRAZIER, 'brazier'],
  [CANDLE_CLUSTER, 'candle_cluster'],
  // The guardroom table's candle stub stands over its anchor tile, so only
  // the anchor carries the light and the part tile beside it carries none.
  [CELLAR_TABLE, 'candle_cluster'],
  [GLOW_FUNGUS, 'glow_fungus'],
  // Both lit by their own glow; smashing the vending machine's glass kills it.
  [VENDING_MACHINE, 'vending_glow'],
  [BOILER, 'boiler_window'],
  // A safe room's own lamps: its standing lanterns and the stove's firebox,
  // which warm it on top of the hearth glow that fills the whole room.
  [SAFE_ROOM_LANTERN, 'standing_torch'],
  [SAFE_ROOM_STOVE, 'boiler_window'],
]);

/**
 * The kind a fixture lights as in a region: the region's own intended flame
 * if this fixture type stands in for it, otherwise the fixture's default.
 */
function resolveFixtureKind(
  tileType: number,
  defaultKind: LightKind,
  profile: LightingProfile | null,
): LightKind {
  // On the service level a torch tile is drawn as an electric work lamp, so it
  // carries the region's intended electric light, and never a flame.
  const electricLamp = tileType === TORCH && dungeonFloorTheme().id === 'service_level';
  for (const source of profile?.sources ?? []) {
    const carriesThisKind = electricLamp ? !isFlameKind(source.kind) : isFlameKind(source.kind);
    if (lightSourceTileType(source.kind) === tileType && carriesThisKind) {
      return source.kind;
    }
  }
  return electricLamp ? WORK_LAMP_LIGHT : defaultKind;
}

/** What a service-level work lamp lights as when its region names no electric light for it. */
const WORK_LAMP_LIGHT: LightKind = 'sodium_lamp';

// ── Types ───────────────────────────────────────────────────────────────────

/** Where and what a static light is, as given to {@link DungeonLightingSystem.registerStaticLight}. */
export interface StaticLightRequest {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: LightKind;
  /** Overrides the kind's own colour and the region's. */
  readonly colour?: GlowColour;
  /** The pool's centre in world pixels; by default the middle of the tile it is thrown from. */
  readonly centre?: { readonly x: number; readonly y: number };
  /**
   * The tile type the light is carried by. When the tile stops being this type
   * (a torch smashed) the light goes out, and it comes back on if the type
   * comes back (a checkpoint standing the torch up again).
   */
  readonly carrierTileType?: number;
  /**
   * Whether whatever carries the light is whole and powered, for a light no
   * tile carries (a wall fixture). The light goes out when this turns false
   * and comes back when it turns true again (a checkpoint mending it).
   */
  readonly carrier?: () => boolean;
  /**
   * Whether the light's power is on. A light that loses its power, rather
   * than being smashed, fades over {@link POWER_DOWN_MS} with one last
   * flicker instead of guttering out.
   */
  readonly powered?: () => boolean;
}

interface StaticLight {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: LightKind;
  readonly spec: LightKindSpec;
  readonly colour: GlowColour;
  readonly centreX: number;
  readonly centreY: number;
  /** The tile the shadowcast ran from: the light's own, or the floor in front of its wall. */
  readonly emitterX: number;
  readonly emitterY: number;
  readonly cookie: LightCookie;
  readonly carrierTileType: number | null;
  readonly carrier: (() => boolean) | null;
  readonly powered: (() => boolean) | null;
  /** Set when the light last went out for want of power, which decides how it dies. */
  poweredDown: boolean;
  readonly flicker: FlickerProfile;
  readonly group: number;
  on: boolean;
  /** When the light was broken, on the system's clock; null while it is not dying. */
  diedAtMs: number | null;
}

interface DynamicLight {
  x: number;
  y: number;
  kind: DynamicLightKind;
  strength: number;
  reachTiles: number;
  /** The tile centres round it this frame and their weights; see {@link originsAround}. */
  readonly origins: Array<{ x: number; y: number; weight: number }>;
  originCount: number;
}

interface FlickerLayer {
  readonly profile: FlickerProfile;
  readonly group: number;
  readonly surface: CanvasSurface;
  readonly ctx: CanvasRenderingContext2D;
  /** Whether the current cache put any light on this layer. */
  used: boolean;
}

interface DarknessCache {
  surface: CanvasSurface;
  ctx: CanvasRenderingContext2D;
  tileX: number;
  tileY: number;
  widthTiles: number;
  heightTiles: number;
}

interface GlowCandidate {
  alpha: number;
  distanceSq: number;
  /** The fixed light this glow is from, or null for a dynamic light's. */
  staticLight: StaticLight | null;
  /** Index into the frame's dynamic lights when {@link staticLight} is null. */
  dynamicIndex: number;
}

/** Paints the floor art {@link DungeonLightingSystem.renderOverDarkness} draws back over the dark. */
export interface OverDarknessPainter {
  paintOverDarkness(target: CanvasRenderingContext2D): void;
}

/** A creature that may show eye-shine. */
export interface EyeShineSubject {
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
  readonly isHostile: boolean;
  /** Writes where its eyes are for the way it faces; false when it faces away. */
  eyeShineAnchor(out: { x: number; y: number; spacingPx: number }): boolean;
}

export interface DungeonLightingDeps {
  readonly gameMap: GameMap;
  /** The clock flicker, pulses and dying lights run on, in milliseconds. */
  readonly now: () => number;
  /**
   * Whether the additive colour pass may run: false at the performance render
   * preset, where the darkness's own tint carries the colour.
   */
  readonly additiveGlows: () => boolean;
}

/** What the last frame drew, for gates and the perf overlay. */
export interface LightingFrameStats {
  dynamicLights: number;
  dynamicKinds: Set<DynamicLightKind>;
  glows: number;
  flickerLayers: number;
  cacheRebuilds: number;
}

// ── The system ──────────────────────────────────────────────────────────────

export class DungeonLightingSystem implements GameSystem {
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  /** Ambient darkness of each region before the cap, by region id. */
  private readonly regionAmbient = new Map<number, { level: number; colour: LightColour }>();
  /**
   * The regions this pass never darkens, nor lets a hallway's dark spill into:
   * the spider lab, the boss rooms and the colosseum.
   */
  private readonly pinnedRegions = new Set<number>();
  /** The regions that take mood lights and nothing else: the boss rooms and the colosseum. */
  private readonly moodRegions = new Set<number>();
  /** Ambient darkness per tile before the cap, worked out once. */
  private readonly uncappedDarkness: Float32Array;
  /** {@link uncappedDarkness} as drawn, spilled out of doorways; also worked out once. */
  private readonly spilledDarkness: Float32Array;
  /** Capped ambient darkness per tile. */
  private readonly tileDarkness: Float32Array;
  /** The rgb each tile's darkness is filled with, three bytes per tile. */
  private readonly tileShadowRgb: Uint8ClampedArray;
  private ambientImage: ImageData | null = null;
  /** The strongest static cut on each tile, 0–1, from lights that are on. */
  private readonly staticLightLevel: Float32Array;
  private ambientSurface: CanvasSurface;
  private darknessCap: number = LIGHTING_TUNING.cap;
  private nightVisionLevel = 0;

  private readonly staticLights: StaticLight[] = [];
  private readonly lightsByTile = new Map<number, StaticLight>();
  private readonly carriedLights: StaticLight[] = [];
  private readonly dyingLights: StaticLight[] = [];

  private readonly sources: DynamicLightSource[] = [];
  private readonly dynamicLights: DynamicLight[] = [];
  private dynamicCount = 0;
  private readonly sink: DynamicLightSink;

  private cache: DarknessCache | null = null;
  private cacheDirty = true;
  private readonly cacheLights: StaticLight[] = [];
  private readonly flickerLayers = new Map<string, FlickerLayer>();
  private buffer: { surface: CanvasSurface; ctx: CanvasRenderingContext2D } | null = null;
  private readonly originCookies: OriginCookieCache;
  /** The frame's dynamic cuts, summed on the GPU, then cut out of the buffer in one draw. */
  private dynamicLayer: { surface: CanvasSurface; ctx: CanvasRenderingContext2D } | null = null;
  private readonly glowPool: GlowCandidate[] = [];
  private glowCount = 0;
  /** A screen-sized surface for the warnings drawn back over the dark; made on first use. */
  private overlay: { surface: CanvasSurface; ctx: CanvasRenderingContext2D } | null = null;
  /** Where the last frame's buffer was blitted from, for {@link renderOverDarkness}. */
  private readonly lastBlit = { srcX: 0, srcY: 0, srcW: 0, srcH: 0, valid: false };
  /** A stable blink phase per creature, so a pack does not blink in step as the roster reorders. */
  private readonly blinkSeeds = new WeakMap<object, number>();
  private nextBlinkSeed = 0;
  private readonly eyeScratch = { x: 0, y: 0, spacingPx: 0 };

  readonly stats: LightingFrameStats = {
    dynamicLights: 0,
    dynamicKinds: new Set(),
    glows: 0,
    flickerLayers: 0,
    cacheRebuilds: 0,
  };

  constructor(private readonly deps: DungeonLightingDeps) {
    const { gameMap } = deps;
    this.mapHeight = gameMap.structure.length;
    this.mapWidth = gameMap.structure[0]?.length ?? 0;
    const tiles = this.mapWidth * this.mapHeight;
    this.uncappedDarkness = new Float32Array(tiles);
    this.spilledDarkness = new Float32Array(tiles);
    this.tileDarkness = new Float32Array(tiles);
    this.tileShadowRgb = new Uint8ClampedArray(tiles * RGB_CHANNELS);
    this.staticLightLevel = new Float32Array(tiles);
    const isOpaque = (x: number, y: number): boolean => this.isOpaque(x, y);
    this.originCookies = new OriginCookieCache(new VisibilityCache(isOpaque), isOpaque);
    this.indexRegions();
    this.ambientSurface = allocCanvas(Math.max(1, this.mapWidth), Math.max(1, this.mapHeight));
    this.computeAmbient();
    this.applyCap();
    this.sink = {
      add: (x, y, kind, strength = 1, reachTiles) =>
        this.pushDynamic(x, y, kind, strength, reachTiles),
    };
    this.registerMapFixtures();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Adds a static light at a tile. Returns false when the tile's region is one
   * this system leaves alone (the spider lab, a boss room) or a light already
   * stands there.
   */
  registerStaticLight(request: StaticLightRequest): boolean {
    const region = this.regionOfLight(request.tileX, request.tileY);
    if (this.isExcludedRegion(region)) return false;
    return this.addStaticLight(request, region);
  }

  /**
   * Adds a mood light to a boss room or the colosseum. Those regions are
   * never darkened, so the light only adds its colour, at the sharp preset;
   * every fight in them reads exactly as it was tuned. Returns false anywhere
   * else, or where a light already stands.
   */
  registerMoodLight(request: StaticLightRequest): boolean {
    const region = this.regionOfLight(request.tileX, request.tileY);
    if (!this.moodRegions.has(region)) return false;
    return this.addStaticLight(request, region);
  }

  private addStaticLight(request: StaticLightRequest, region: number): boolean {
    const key = this.tileIndex(request.tileX, request.tileY);
    if (key < 0 || this.lightsByTile.has(key)) return false;

    const spec = lightKindSpec(request.kind);
    const mountedOnWall = this.isOpaque(request.tileX, request.tileY);
    const emitter = mountedOnWall
      ? this.openNeighbour(request.tileX, request.tileY)
      : { x: request.tileX, y: request.tileY };
    const centre = request.centre ?? {
      x: (emitter.x + HALF) * TILE_SIZE,
      y: (emitter.y + HALF) * TILE_SIZE,
    };
    const cookie = buildLightCookie({
      emitterTileX: emitter.x,
      emitterTileY: emitter.y,
      centreX: centre.x,
      centreY: centre.y,
      reachTiles: spec.reachTiles,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      isOpaque: (x, y) => this.isOpaque(x, y),
      alsoLit: mountedOnWall ? { x: request.tileX, y: request.tileY } : undefined,
    });
    const faulty =
      request.kind === 'fluorescent_tube' &&
      Math.floor(tileHash(request.tileX, request.tileY) * FAULTY_TUBE_ONE_IN) === 0;
    const light: StaticLight = {
      tileX: request.tileX,
      tileY: request.tileY,
      kind: request.kind,
      spec,
      colour: request.colour ?? spec.colour ?? this.regionColour(region),
      centreX: centre.x,
      centreY: centre.y,
      emitterX: emitter.x,
      emitterY: emitter.y,
      cookie,
      carrierTileType: request.carrierTileType ?? null,
      carrier: request.carrier ?? null,
      powered: request.powered ?? null,
      poweredDown: false,
      flicker: faulty ? 'faulty_tube' : spec.flicker,
      group: Math.floor(tileHash(request.tileX, request.tileY, 1) * FLICKER_GROUPS),
      on: true,
      diedAtMs: null,
    };
    this.staticLights.push(light);
    this.lightsByTile.set(key, light);
    if (light.carrierTileType !== null || light.carrier !== null) this.carriedLights.push(light);
    if (light.carrier !== null && !this.isCarried(light)) this.putOut(light, false);
    this.applyStaticLevel(light);
    this.cacheDirty = true;
    return true;
  }

  /**
   * Puts out the light at a tile with a gutter flash that dies to darkness
   * over {@link LIGHT_DEATH_MS}. Returns false when no lit light stands there.
   */
  removeStaticLight(tileX: number, tileY: number): boolean {
    const light = this.lightsByTile.get(this.tileIndex(tileX, tileY));
    if (light?.on !== true) return false;
    this.putOut(light, true);
    return true;
  }

  /** Whether a static light stands at this tile and is lit. */
  isLightOnAt(tileX: number, tileY: number): boolean {
    return this.lightsByTile.get(this.tileIndex(tileX, tileY))?.on === true;
  }

  /**
   * Whether the light at a tile is giving light this instant: lit, and not
   * in a faulty tube's dark beat. True where this pass registered no light
   * (a fixture in a room it leaves alone), so that fixture keeps its own art.
   */
  isShiningAt(tileX: number, tileY: number): boolean {
    const light = this.lightsByTile.get(this.tileIndex(tileX, tileY));
    if (light === undefined) return true;
    if (!light.on) return false;
    if (light.flicker !== 'faulty_tube') return true;
    return flickerValue('faulty_tube', light.group, this.deps.now()) > 0;
  }

  /** Whether any static light, lit or not, was registered at this tile. */
  hasStaticLightAt(tileX: number, tileY: number): boolean {
    return this.lightsByTile.has(this.tileIndex(tileX, tileY));
  }

  /** Every static light's tile and kind, in registration order. */
  staticLightTiles(): ReadonlyArray<{ x: number; y: number; kind: LightKind; on: boolean }> {
    return this.staticLights.map((light) => ({
      x: light.tileX,
      y: light.tileY,
      kind: light.kind,
      on: light.on,
    }));
  }

  /**
   * Where a static light's shadowcast ran from, every tile its cookie reaches
   * (as `y * width + x`) and the flicker group it pulses in, for the gates;
   * null when none stands there.
   */
  staticLightGeometry(
    tileX: number,
    tileY: number,
  ): { emitterX: number; emitterY: number; litTiles: Int32Array; flickerGroup: number } | null {
    const light = this.lightsByTile.get(this.tileIndex(tileX, tileY));
    if (light === undefined) return null;
    return {
      emitterX: light.emitterX,
      emitterY: light.emitterY,
      litTiles: light.cookie.litTiles,
      flickerGroup: light.group,
    };
  }

  /** How much of the dark lit static lights cut on a tile, 0–1. */
  staticLightAt(tileX: number, tileY: number): number {
    const index = this.tileIndex(tileX, tileY);
    return index < 0 ? 0 : this.staticLightLevel[index];
  }

  /** Where the puddle glints are drawn this frame, refilled each frame. */
  private readonly glintView = { camX: 0, camY: 0, viewW: 0, viewH: 0, tileSize: TILE_SIZE };

  /**
   * How much light falls on a puddle tile: its static light, or a dynamic
   * light's share by distance — so the crawler's own light glints on the water
   * at its feet. The dynamic part ignores walls; a puddle is open floor in the
   * room the light is in, and the glint is too faint to read through a wall.
   */
  private readonly glintLightAt = (tileX: number, tileY: number): number => {
    let light = this.staticLightAt(tileX, tileY);
    const centreX = (tileX + HALF) * TILE_SIZE;
    const centreY = (tileY + HALF) * TILE_SIZE;
    for (let index = 0; index < this.dynamicCount; index++) {
      const dynamic = this.dynamicLights[index];
      const share =
        Math.hypot(dynamic.x - centreX, dynamic.y - centreY) / (dynamic.reachTiles * TILE_SIZE);
      if (share < 1) light = Math.max(light, (1 - share) * dynamic.strength);
    }
    return light;
  };

  /** The capped ambient darkness at a world point before any light, 0–1. */
  readonly darknessAtWorld = (worldX: number, worldY: number): number =>
    this.ambientDarknessAt(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE));

  /** The capped ambient darkness of a tile before any light, 0–1. */
  ambientDarknessAt(tileX: number, tileY: number): number {
    const index = this.tileIndex(tileX, tileY);
    return index < 0 ? 0 : this.tileDarkness[index];
  }

  /** The current ambient cap, lowered by Night Vision. */
  get ambientCap(): number {
    return this.darknessCap;
  }

  /**
   * Registers something that may carry lights; it is asked for them every
   * frame. Returns the function that unregisters it.
   */
  addDynamicLightSource(source: DynamicLightSource): () => void {
    this.sources.push(source);
    return () => {
      const index = this.sources.indexOf(source);
      if (index >= 0) this.sources.splice(index, 1);
    };
  }

  /**
   * The active crawler's Night Vision level: each level lowers the ambient
   * cap and lengthens the crawlers' lights.
   */
  setNightVisionLevel(level: number): void {
    if (level === this.nightVisionLevel) return;
    this.nightVisionLevel = level;
    this.darknessCap = Math.max(
      LIGHTING_TUNING.nightVisionMinCap,
      LIGHTING_TUNING.cap - level * LIGHTING_TUNING.nightVisionCapDropPerLevel,
    );
    this.applyCap();
    this.cacheDirty = true;
  }

  /** A crawler light's reach at the current Night Vision level, in tiles. */
  crawlerReachTiles(baseTiles: number): number {
    return baseTiles + this.nightVisionLevel * LIGHTING_TUNING.nightVisionReachPerLevel;
  }

  /**
   * Watches every carried light's carrier: a smashed torch or sconce goes out,
   * a restored one relights.
   */
  update(): void {
    this.followCarriers(true);
  }

  /**
   * Brings every carried light in line with its carrier at once, with no
   * dying flash: for a checkpoint restore, which puts the room back as it
   * was rather than breaking anything in it.
   */
  settleCarriedLights(): void {
    this.followCarriers(false);
    this.dyingLights.length = 0;
  }

  /** How much a dying light at a tile still cuts the dark, 0–1; 0 when none is dying there. */
  dyingCutAt(tileX: number, tileY: number): number {
    const light = this.lightsByTile.get(this.tileIndex(tileX, tileY));
    return light === undefined ? 0 : deathAlpha(light, this.deps.now());
  }

  private followCarriers(withDeath: boolean): void {
    for (const light of this.carriedLights) {
      const carried = this.isCarried(light);
      if (light.on && !carried) this.putOut(light, withDeath);
      else if (!light.on && carried) this.relight(light);
    }
  }

  private isCarried(light: StaticLight): boolean {
    const whole =
      light.carrier !== null
        ? light.carrier()
        : this.deps.gameMap.structure[light.tileY][light.tileX].type === light.carrierTileType;
    const powered = light.powered?.() ?? true;
    light.poweredDown = whole && !powered;
    return whole && powered;
  }

  dispose(): void {
    this.sources.length = 0;
    this.flickerLayers.clear();
    this.cache = null;
    this.buffer = null;
  }

  /**
   * Draws the darkness over everything drawn so far in the view, then the
   * lights' colour. Called after the bodies and before every warning.
   */
  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    if (this.mapWidth === 0) return;
    const nowMs = this.deps.now();
    this.collectDynamicLights();
    this.ensureCache(camX, camY, viewW, viewH);
    const cache = this.cache;
    if (cache === null) return;

    const originX = Math.floor(camX * LIGHT_BUFFER_SCALE) - BUFFER_PAD_PX;
    const originY = Math.floor(camY * LIGHT_BUFFER_SCALE) - BUFFER_PAD_PX;
    const bufferW = Math.ceil(viewW * LIGHT_BUFFER_SCALE) + BUFFER_PAD_PX * 2 + 1;
    const bufferH = Math.ceil(viewH * LIGHT_BUFFER_SCALE) + BUFFER_PAD_PX * 2 + 1;
    const buffer = this.ensureBuffer(bufferW, bufferH);
    const b = buffer.ctx;
    const cacheOriginX = cache.tileX * LIGHT_PX_PER_TILE;
    const cacheOriginY = cache.tileY * LIGHT_PX_PER_TILE;
    const srcX = originX - cacheOriginX;
    const srcY = originY - cacheOriginY;

    b.globalAlpha = 1;
    b.globalCompositeOperation = 'copy';
    b.drawImage(cache.surface, srcX, srcY, bufferW, bufferH, 0, 0, bufferW, bufferH);
    b.globalCompositeOperation = 'destination-out';

    let layersDrawn = 0;
    for (const layer of this.flickerLayers.values()) {
      if (!layer.used) continue;
      const share = FLICKER_SHARE[layer.profile];
      const alpha = 1 - share + share * flickerValue(layer.profile, layer.group, nowMs);
      if (alpha < MIN_VISIBLE_ALPHA) continue;
      b.globalAlpha = Math.min(1, alpha);
      b.drawImage(layer.surface, srcX, srcY, bufferW, bufferH, 0, 0, bufferW, bufferH);
      layersDrawn++;
    }

    this.cutDyingLights(b, originX, originY, nowMs);
    this.cutDynamicLights(b, originX, originY, bufferW, bufferH);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';

    const blit = this.lastBlit;
    blit.srcX = camX * LIGHT_BUFFER_SCALE - originX;
    blit.srcY = camY * LIGHT_BUFFER_SCALE - originY;
    blit.srcW = viewW * LIGHT_BUFFER_SCALE;
    blit.srcH = viewH * LIGHT_BUFFER_SCALE;
    blit.valid = true;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer.surface, blit.srcX, blit.srcY, blit.srcW, blit.srcH, 0, 0, viewW, viewH);
    let glows = 0;
    if (this.deps.additiveGlows()) {
      glows = this.drawGlows(ctx, camX, camY, viewW, viewH, nowMs);
      const view = this.glintView;
      view.camX = camX;
      view.camY = camY;
      view.viewW = viewW;
      view.viewH = viewH;
      drawPuddleGlints(ctx, this.deps.gameMap.floorSurface, view, this.glintLightAt, nowMs);
    }
    ctx.restore();

    this.stats.glows = glows;
    this.stats.flickerLayers = layersDrawn;
  }

  /**
   * Two glints for every hostile standing in the dark outside every light,
   * so a creature's position always reads even when its body does not.
   */
  renderEyeShine(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    creatures: Iterable<EyeShineSubject>,
  ): void {
    const nowMs = this.deps.now();
    for (const creature of creatures) {
      if (!creature.isAlive || !creature.isHostile) continue;
      const sx = creature.x - camX;
      const sy = creature.y - camY;
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > viewW || sy > viewH) continue;
      if (!this.isInDarkness(creature.x + TILE_SIZE * HALF, creature.y + TILE_SIZE * HALF)) {
        continue;
      }
      const blink =
        (((nowMs / EYE_BLINK_PERIOD_MS + this.blinkSeedOf(creature) * EYE_BLINK_SEED_STEP) % 1) +
          1) %
        1;
      if (blink < EYE_BLINK_SHUT_SHARE) continue;
      const eyes = this.eyeScratch;
      if (!creature.eyeShineAnchor(eyes)) continue;
      drawEyePair(ctx, eyes.x - camX, eyes.y - camY, eyes.spacingPx);
    }
  }

  /**
   * Draws `painter`'s floor art a second time, added over the darkness and
   * weighted by how dark each pixel is. The copy drawn under the bodies was
   * dimmed by `1 - d`; adding the art again at `d` restores it to full
   * strength (exact but for the shadow's own faint colour under it), and
   * where the floor is lit `d` is 0 and nothing is added, so a body still
   * stands over the art. For floor art that warns of danger or marks a goal.
   * Call after {@link render} in the same frame, with `ctx` carrying only the
   * render scale `scale`.
   */
  renderOverDarkness(
    ctx: CanvasRenderingContext2D,
    scale: number,
    painter: OverDarknessPainter,
  ): void {
    const buffer = this.buffer;
    const blit = this.lastBlit;
    if (buffer === null || !blit.valid) return;
    const target = ctx.canvas;
    let overlay = this.overlay;
    if (overlay?.surface.width !== target.width || overlay.surface.height !== target.height) {
      const surface = allocCanvas(target.width, target.height);
      overlay = { surface, ctx: surfaceContext(surface) };
      this.overlay = overlay;
    }
    const o = overlay.ctx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;
    o.clearRect(0, 0, target.width, target.height);
    o.setTransform(scale, 0, 0, scale, 0, 0);
    painter.paintOverDarkness(o);
    // Keeps each pixel of the art at the darkness's own alpha there.
    o.globalCompositeOperation = 'destination-in';
    o.imageSmoothingEnabled = true;
    o.drawImage(
      buffer.surface,
      blit.srcX,
      blit.srcY,
      blit.srcW,
      blit.srcH,
      0,
      0,
      target.width / scale,
      target.height / scale,
    );
    o.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(overlay.surface, 0, 0);
    ctx.restore();
  }

  private blinkSeedOf(creature: object): number {
    const known = this.blinkSeeds.get(creature);
    if (known !== undefined) return known;
    const seed = this.nextBlinkSeed++;
    this.blinkSeeds.set(creature, seed);
    return seed;
  }

  // ── Floor data ────────────────────────────────────────────────────────────

  private tileIndex(tileX: number, tileY: number): number {
    if (tileX < 0 || tileY < 0 || tileX >= this.mapWidth || tileY >= this.mapHeight) return -1;
    return tileY * this.mapWidth + tileX;
  }

  private isOpaque(tileX: number, tileY: number): boolean {
    if (this.tileIndex(tileX, tileY) < 0) return true;
    return LIGHT_BLOCKING_TYPES.has(this.deps.gameMap.structure[tileY][tileX].type);
  }

  private openNeighbour(tileX: number, tileY: number): { x: number; y: number } {
    for (const [dx, dy] of NEIGHBOUR_PREFERENCE) {
      if (!this.isOpaque(tileX + dx, tileY + dy)) return { x: tileX + dx, y: tileY + dy };
    }
    return { x: tileX, y: tileY };
  }

  /** The region a light belongs to: its own tile's, or a neighbour's for a wall fixture. */
  private regionOfLight(tileX: number, tileY: number): number {
    const own = this.deps.gameMap.regionAt(tileX, tileY);
    if (own !== NO_REGION) return own;
    for (const [dx, dy] of NEIGHBOUR_PREFERENCE) {
      const region = this.deps.gameMap.regionAt(tileX + dx, tileY + dy);
      if (region !== NO_REGION) return region;
    }
    return NO_REGION;
  }

  /** A tile whose darkness this pass must leave exactly as its region sets it. */
  private isPinnedTile(tileX: number, tileY: number): boolean {
    return this.pinnedRegions.has(this.deps.gameMap.regionAt(tileX, tileY));
  }

  private specialTag(region: number): string | null {
    const assignment = this.deps.gameMap.regionCharacters.forRegion(region);
    return assignment?.type === 'special' ? assignment.tag : null;
  }

  /**
   * The spider lab keeps its own darkness and would be darkened twice; a boss
   * room stays fully lit so a tuned fight plays as tuned, and takes only the
   * mood lights given through {@link registerMoodLight}.
   */
  private isExcludedRegion(region: number): boolean {
    const tag = this.specialTag(region);
    return tag === 'spider_lab' || tag === 'boss';
  }

  /** A boss fight's ground: lit through, whatever the hallways round it. */
  private isMoodRegion(region: number): boolean {
    const tag = this.specialTag(region);
    return tag === 'boss' || tag === 'arena';
  }

  private profileOf(region: number): LightingProfile | null {
    return this.deps.gameMap.regionCharacters.lightingFor(region);
  }

  private floorFallbackColour(): LightColour {
    return FLOOR_FALLBACK_COLOUR[dungeonFloorTheme().id];
  }

  private regionColour(region: number): LightColour {
    return this.profileOf(region)?.colour ?? this.floorFallbackColour();
  }

  private indexRegions(): void {
    const { regionMap } = this.deps.gameMap;
    for (const room of regionMap.rooms) this.indexRegion(room.id);
    for (const hallway of regionMap.hallways) this.indexRegion(hallway.id);
  }

  private indexRegion(id: number): void {
    if (this.specialTag(id) === 'spider_lab') {
      this.pinnedRegions.add(id);
      this.regionAmbient.set(id, { level: 0, colour: this.floorFallbackColour() });
      return;
    }
    const profile = this.profileOf(id);
    if (this.isMoodRegion(id)) {
      this.pinnedRegions.add(id);
      this.moodRegions.add(id);
      this.regionAmbient.set(id, {
        level: 0,
        colour: profile?.colour ?? this.floorFallbackColour(),
      });
      return;
    }
    this.regionAmbient.set(id, {
      level: LIGHTING_TUNING.ambient[profile?.ambient ?? FALLBACK_AMBIENT],
      colour: profile?.colour ?? this.floorFallbackColour(),
    });
  }

  /** The darkness of an open tile before the cap, and its colour. */
  private openTileAmbient(tileX: number, tileY: number): { level: number; colour: LightColour } {
    const region = this.deps.gameMap.regionAt(tileX, tileY);
    const known = this.regionAmbient.get(region);
    if (known !== undefined) return known;
    return { level: LIGHTING_TUNING.ambient[FALLBACK_AMBIENT], colour: this.floorFallbackColour() };
  }

  /**
   * Works out each tile's darkness before the cap and its colour, once per
   * floor. A wall takes the lightest darkness of the open tiles on its seen
   * side: a wall with floor to its south is a face of the region below it and
   * looks down {@link WALL_FACE_ROWS} rows, since a face stands that tall;
   * any other wall looks all round. Solid mass takes the darkest level.
   */
  private computeAmbient(): void {
    const width = this.mapWidth;
    const height = this.mapHeight;
    if (width === 0 || height === 0) return;
    const rgbOf = new Map<LightColour, readonly [number, number, number]>();
    const colourRgb = (colour: LightColour): readonly [number, number, number] => {
      const known = rgbOf.get(colour);
      if (known !== undefined) return known;
      const parsed = parseRgb(GLOW_COLOURS[colour].shadowRgb);
      rgbOf.set(colour, parsed);
      return parsed;
    };
    const fallbackRgb = colourRgb(this.floorFallbackColour());
    const darkest = LIGHTING_TUNING.ambient.dark;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        let level: number;
        let rgb = fallbackRgb;
        if (!this.isOpaque(x, y)) {
          const ambient = this.openTileAmbient(x, y);
          level = ambient.level;
          rgb = colourRgb(ambient.colour);
        } else {
          level = Infinity;
          const isFace = !this.isOpaque(x, y + 1);
          const firstRow = isFace ? 1 : -1;
          for (let dy = firstRow; dy <= WALL_FACE_ROWS; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if ((dx === 0 && dy === 0) || this.isOpaque(x + dx, y + dy)) continue;
              const ambient = this.openTileAmbient(x + dx, y + dy);
              if (ambient.level < level) {
                level = ambient.level;
                rgb = colourRgb(ambient.colour);
              }
            }
          }
          if (level === Infinity) level = darkest;
        }
        this.uncappedDarkness[index] = level;
        this.tileShadowRgb[index * RGB_CHANNELS] = rgb[0];
        this.tileShadowRgb[index * RGB_CHANNELS + 1] = rgb[1];
        this.tileShadowRgb[index * RGB_CHANNELS + 2] = rgb[2];
      }
    }
    this.spilledDarkness.set(this.spillAcrossOpenings());
  }

  /**
   * Applies the current cap to the darkness worked out by
   * {@link computeAmbient} and repaints the ambient image: one pass over
   * arrays already filled, cheap enough to run when Night Vision changes.
   */
  private applyCap(): void {
    const width = this.mapWidth;
    const height = this.mapHeight;
    if (width === 0 || height === 0) return;
    const cap = this.darknessCap;
    const ctx = surfaceContext(this.ambientSurface);
    const image = this.ambientImage ?? ctx.createImageData(width, height);
    this.ambientImage = image;
    for (let index = 0; index < width * height; index++) {
      this.tileDarkness[index] = Math.min(this.uncappedDarkness[index], cap);
      image.data[index * RGBA_CHANNELS] = this.tileShadowRgb[index * RGB_CHANNELS];
      image.data[index * RGBA_CHANNELS + 1] = this.tileShadowRgb[index * RGB_CHANNELS + 1];
      image.data[index * RGBA_CHANNELS + 2] = this.tileShadowRgb[index * RGB_CHANNELS + 2];
      image.data[index * RGBA_CHANNELS + ALPHA_OFFSET] = Math.round(
        Math.min(this.spilledDarkness[index], cap) * BYTE_MAX,
      );
    }
    ctx.putImageData(image, 0, 0);
  }

  /**
   * The per-tile darkness as drawn: each open tile averaged with its open
   * neighbours a few times over, so the light of a lit room spills a couple
   * of tiles out of its doorways into the hall instead of stopping at a line.
   * Walls take no part, so nothing leaks through one, and a pinned region's
   * tiles are never changed, so none of the hall's dark spills into the
   * spider lab or onto a boss fight. Only the picture is softened; every rule reads the unsoftened
   * darkness.
   */
  private spillAcrossOpenings(): Float32Array {
    const width = this.mapWidth;
    let current = Float32Array.from(this.uncappedDarkness);
    let next = new Float32Array(current.length);
    for (let pass = 0; pass < DOORWAY_SPILL_PASSES; pass++) {
      next.set(current);
      for (let y = 0; y < this.mapHeight; y++) {
        for (let x = 0; x < width; x++) {
          if (this.isOpaque(x, y) || this.isPinnedTile(x, y)) continue;
          const index = y * width + x;
          let sum = current[index];
          let count = 1;
          for (const [dx, dy] of NEIGHBOUR_PREFERENCE) {
            if (this.isOpaque(x + dx, y + dy)) continue;
            sum += current[(y + dy) * width + x + dx];
            count++;
          }
          next[index] = sum / count;
        }
      }
      const swap = current;
      current = next;
      next = swap;
    }
    // The stretch blends each tile with its neighbours, so a hallway's dark
    // beside a pinned region's doorway would still tint the doorway itself;
    // the tiles round the region are cleared with it.
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < width; x++) {
        if (!this.isPinnedTile(x, y)) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const index = this.tileIndex(x + dx, y + dy);
            if (index >= 0) current[index] = 0;
          }
        }
      }
    }
    return current;
  }

  /** Lights every fixture on the map, and the hearth of every safe room. */
  private registerMapFixtures(): void {
    const { structure, regionMap } = this.deps.gameMap;
    for (let y = 0; y < structure.length; y++) {
      const row = structure[y];
      for (let x = 0; x < row.length; x++) {
        const type = row[x].type;
        const defaultKind = STATIC_LIGHT_FIXTURES.get(type);
        if (defaultKind === undefined) continue;
        const region = this.regionOfLight(x, y);
        const kind = resolveFixtureKind(type, defaultKind, this.profileOf(region));
        this.registerStaticLight({ tileX: x, tileY: y, kind, carrierTileType: type });
      }
    }
    for (const room of regionMap.rooms) {
      if (room.role !== 'safe') continue;
      const centreX = room.bounds.x + Math.floor(room.bounds.w / 2);
      const centreY = room.bounds.y + Math.floor(room.bounds.h / 2);
      this.registerStaticLight({ tileX: centreX, tileY: centreY, kind: 'hearth' });
    }
    const { wallFixtures } = this.deps.gameMap;
    for (const fixture of wallFixtures) {
      const kind = WALL_FIXTURE_SPECS[fixture.kind].light;
      if (kind === null) continue;
      this.registerStaticLight({
        tileX: fixture.tileX,
        tileY: fixture.tileY,
        kind,
        carrier: () => !fixture.state.broken,
        powered: () => isFixturePowered(fixture, wallFixtures),
      });
    }
  }

  // ── Static light state ────────────────────────────────────────────────────

  private putOut(light: StaticLight, withDeath: boolean): void {
    light.on = false;
    light.diedAtMs = withDeath ? this.deps.now() : null;
    if (withDeath) this.dyingLights.push(light);
    this.recomputeStaticLevel(light);
    this.cacheDirty = true;
  }

  private relight(light: StaticLight): void {
    light.on = true;
    light.diedAtMs = null;
    this.applyStaticLevel(light);
    this.cacheDirty = true;
  }

  private applyStaticLevel(light: StaticLight): void {
    const { litTiles, litStrength } = light.cookie;
    for (let index = 0; index < litTiles.length; index++) {
      const tile = litTiles[index];
      this.staticLightLevel[tile] = Math.max(this.staticLightLevel[tile], litStrength[index]);
    }
  }

  /** Re-reads every lit light over the tiles one light used to reach. */
  private recomputeStaticLevel(changed: StaticLight): void {
    for (const tile of changed.cookie.litTiles) this.staticLightLevel[tile] = 0;
    const touched = new Set(changed.cookie.litTiles);
    for (const light of this.staticLights) {
      if (!light.on) continue;
      const { litTiles, litStrength } = light.cookie;
      for (let index = 0; index < litTiles.length; index++) {
        const tile = litTiles[index];
        if (!touched.has(tile)) continue;
        this.staticLightLevel[tile] = Math.max(this.staticLightLevel[tile], litStrength[index]);
      }
    }
  }

  // ── Dynamic lights ────────────────────────────────────────────────────────

  private pushDynamic(
    x: number,
    y: number,
    kind: DynamicLightKind,
    strength: number,
    reachTiles: number | undefined,
  ): void {
    if (strength <= 0) return;
    if (this.dynamicCount >= this.dynamicLights.length) {
      this.dynamicLights.push({
        x: 0,
        y: 0,
        kind,
        strength: 0,
        reachTiles: 0,
        origins: [],
        originCount: 0,
      });
    }
    const light = this.dynamicLights[this.dynamicCount];
    light.x = x;
    light.y = y;
    light.kind = kind;
    light.strength = Math.min(1, strength);
    light.reachTiles = reachTiles ?? lightKindSpec(kind).reachTiles;
    light.originCount = originsAround(x, y, (tx, ty) => this.isOpaque(tx, ty), light.origins);
    this.dynamicCount++;
    this.stats.dynamicKinds.add(kind);
  }

  private collectDynamicLights(): void {
    this.dynamicCount = 0;
    this.stats.dynamicKinds.clear();
    for (const source of this.sources) source.collectLights(this.sink);
    this.stats.dynamicLights = this.dynamicCount;
  }

  /** Whether a world point is dark enough, and far enough from every light, to hide a body. */
  private isInDarkness(worldX: number, worldY: number): boolean {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const index = this.tileIndex(tileX, tileY);
    if (index < 0) return false;
    if (this.tileDarkness[index] < LIGHTING_TUNING.eyeShineMinDarkness) return false;
    if (this.staticLightLevel[index] > EYE_SHINE_MAX_STATIC_LIGHT) return false;
    for (let index2 = 0; index2 < this.dynamicCount; index2++) {
      const light = this.dynamicLights[index2];
      const reachPx = light.reachTiles * TILE_SIZE * EYE_SHINE_LIGHT_REACH_SHARE;
      if (Math.hypot(light.x - worldX, light.y - worldY) < reachPx) return false;
    }
    return true;
  }

  /**
   * Every dynamic light's cut: the cached cuts of the tile centres round it,
   * each shadowcast so it stops at walls, added up on a layer by their
   * weights so the light moves without jumping, and cut out of the buffer in
   * one draw. Nothing is painted on the CPU in a frame.
   */
  private cutDynamicLights(
    b: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    width: number,
    height: number,
  ): void {
    if (this.dynamicCount === 0) return;
    let layer = this.dynamicLayer;
    if (layer?.surface.width !== width || layer.surface.height !== height) {
      const surface = allocCanvas(width, height);
      layer = { surface, ctx: surfaceContext(surface) };
      this.dynamicLayer = layer;
    }
    const l = layer.ctx;
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.clearRect(0, 0, width, height);
    l.globalCompositeOperation = 'lighter';
    for (let index = 0; index < this.dynamicCount; index++) {
      const light = this.dynamicLights[index];
      for (let slot = 0; slot < light.originCount; slot++) {
        const origin = light.origins[slot];
        const cut = this.originCookies.cut(origin.x, origin.y, light.reachTiles);
        l.globalAlpha = origin.weight * light.strength;
        l.drawImage(
          cut.surface,
          cut.tileX * LIGHT_PX_PER_TILE - originX,
          cut.tileY * LIGHT_PX_PER_TILE - originY,
        );
      }
    }
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.drawImage(layer.surface, 0, 0);
  }

  /** A broken light's last flare, then its fade to nothing; forgotten once dark. */
  private cutDyingLights(
    b: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    nowMs: number,
  ): void {
    for (let index = this.dyingLights.length - 1; index >= 0; index--) {
      const light = this.dyingLights[index];
      const alpha = deathAlpha(light, nowMs);
      if (alpha <= 0) {
        this.dyingLights.splice(index, 1);
        continue;
      }
      b.globalAlpha = Math.min(1, alpha);
      b.drawImage(
        light.cookie.surface,
        light.cookie.originTileX * LIGHT_PX_PER_TILE - originX,
        light.cookie.originTileY * LIGHT_PX_PER_TILE - originY,
      );
    }
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  private cacheCovers(camX: number, camY: number, viewW: number, viewH: number): boolean {
    const cache = this.cache;
    if (cache === null) return false;
    const margin = BUFFER_PAD_PX + 1;
    const left = Math.floor(camX * LIGHT_BUFFER_SCALE) - margin;
    const top = Math.floor(camY * LIGHT_BUFFER_SCALE) - margin;
    const right = Math.ceil((camX + viewW) * LIGHT_BUFFER_SCALE) + margin + 1;
    const bottom = Math.ceil((camY + viewH) * LIGHT_BUFFER_SCALE) + margin + 1;
    const cacheLeft = cache.tileX * LIGHT_PX_PER_TILE;
    const cacheTop = cache.tileY * LIGHT_PX_PER_TILE;
    return (
      left >= cacheLeft &&
      top >= cacheTop &&
      right <= cacheLeft + cache.widthTiles * LIGHT_PX_PER_TILE &&
      bottom <= cacheTop + cache.heightTiles * LIGHT_PX_PER_TILE
    );
  }

  private ensureCache(camX: number, camY: number, viewW: number, viewH: number): void {
    if (!this.cacheDirty && this.cacheCovers(camX, camY, viewW, viewH)) return;
    const viewTilesW = Math.ceil(viewW / TILE_SIZE);
    const viewTilesH = Math.ceil(viewH / TILE_SIZE);
    const widthTiles = Math.ceil(viewTilesW * CACHE_VIEW_SCALE) + CACHE_EDGE_TILES * 2;
    const heightTiles = Math.ceil(viewTilesH * CACHE_VIEW_SCALE) + CACHE_EDGE_TILES * 2;
    const centreTileX = Math.floor((camX + viewW * HALF) / TILE_SIZE);
    const centreTileY = Math.floor((camY + viewH * HALF) / TILE_SIZE);
    const tileX = centreTileX - Math.floor(widthTiles / 2);
    const tileY = centreTileY - Math.floor(heightTiles / 2);
    const widthPx = widthTiles * LIGHT_PX_PER_TILE;
    const heightPx = heightTiles * LIGHT_PX_PER_TILE;

    let cache = this.cache;
    if (cache === null || cache.surface.width < widthPx || cache.surface.height < heightPx) {
      const surface = allocCanvas(widthPx, heightPx);
      cache = { surface, ctx: surfaceContext(surface), tileX, tileY, widthTiles, heightTiles };
      this.cache = cache;
      this.flickerLayers.clear();
    }
    cache.tileX = tileX;
    cache.tileY = tileY;
    cache.widthTiles = widthTiles;
    cache.heightTiles = heightTiles;
    this.paintCache(cache);
    this.cacheDirty = false;
    this.stats.cacheRebuilds++;
  }

  /**
   * Paints the cache: each region's ambient darkness stretched up from the
   * one-pixel-per-tile ambient image with every steady static light cut out,
   * and each flickering light on its flicker group's own layer.
   */
  private paintCache(cache: DarknessCache): void {
    const c = cache.ctx;
    const { tileX, tileY, widthTiles, heightTiles } = cache;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, cache.surface.width, cache.surface.height);

    const srcX = Math.max(0, tileX);
    const srcY = Math.max(0, tileY);
    const srcRight = Math.min(this.mapWidth, tileX + widthTiles);
    const srcBottom = Math.min(this.mapHeight, tileY + heightTiles);
    c.fillStyle = `rgba(${GLOW_COLOURS[this.floorFallbackColour()].shadowRgb},${this.darknessCap})`;
    const fullW = widthTiles * LIGHT_PX_PER_TILE;
    const fullH = heightTiles * LIGHT_PX_PER_TILE;
    const mapLeft = (srcX - tileX) * LIGHT_PX_PER_TILE;
    const mapTop = (srcY - tileY) * LIGHT_PX_PER_TILE;
    const mapRight = (srcRight - tileX) * LIGHT_PX_PER_TILE;
    const mapBottom = (srcBottom - tileY) * LIGHT_PX_PER_TILE;
    if (srcRight <= srcX || srcBottom <= srcY) {
      c.fillRect(0, 0, fullW, fullH);
    } else {
      c.fillRect(0, 0, fullW, mapTop);
      c.fillRect(0, mapBottom, fullW, fullH - mapBottom);
      c.fillRect(0, mapTop, mapLeft, mapBottom - mapTop);
      c.fillRect(mapRight, mapTop, fullW - mapRight, mapBottom - mapTop);
      c.imageSmoothingEnabled = true;
      c.drawImage(
        this.ambientSurface,
        srcX,
        srcY,
        srcRight - srcX,
        srcBottom - srcY,
        mapLeft,
        mapTop,
        mapRight - mapLeft,
        mapBottom - mapTop,
      );
    }

    for (const layer of this.flickerLayers.values()) {
      if (layer.used) layer.ctx.clearRect(0, 0, layer.surface.width, layer.surface.height);
      layer.used = false;
    }
    this.cacheLights.length = 0;
    c.globalCompositeOperation = 'destination-out';
    for (const light of this.staticLights) {
      if (!light.on) continue;
      const { cookie } = light;
      const span = cookie.sizeTiles;
      if (
        cookie.originTileX + span < tileX ||
        cookie.originTileY + span < tileY ||
        cookie.originTileX > tileX + widthTiles ||
        cookie.originTileY > tileY + heightTiles
      ) {
        continue;
      }
      this.cacheLights.push(light);
      const x = (cookie.originTileX - tileX) * LIGHT_PX_PER_TILE;
      const y = (cookie.originTileY - tileY) * LIGHT_PX_PER_TILE;
      // A flickering light is cut whole on its group's layer and nowhere else,
      // so one alpha per frame sets exactly how much of the dark it cuts.
      if (FLICKER_SHARE[light.flicker] > 0) {
        const layer = this.flickerLayer(light.flicker, light.group, cache);
        layer.ctx.drawImage(cookie.surface, x, y);
        layer.used = true;
      } else {
        c.drawImage(cookie.surface, x, y);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  private flickerLayer(profile: FlickerProfile, group: number, cache: DarknessCache): FlickerLayer {
    const key = `${profile}:${group}`;
    const existing = this.flickerLayers.get(key);
    if (existing !== undefined) return existing;
    const surface = allocCanvas(cache.surface.width, cache.surface.height);
    const layer: FlickerLayer = {
      profile,
      group,
      surface,
      ctx: surfaceContext(surface),
      used: false,
    };
    this.flickerLayers.set(key, layer);
    return layer;
  }

  private ensureBuffer(
    width: number,
    height: number,
  ): { surface: CanvasSurface; ctx: CanvasRenderingContext2D } {
    const existing = this.buffer;
    if (
      existing !== null &&
      existing.surface.width === width &&
      existing.surface.height === height
    ) {
      return existing;
    }
    const surface = allocCanvas(width, height);
    const buffer = { surface, ctx: surfaceContext(surface) };
    this.buffer = buffer;
    return buffer;
  }

  // ── Glows ─────────────────────────────────────────────────────────────────

  /** Queues one glow for this frame, reusing the pool's candidates. */
  private considerGlow(
    x: number,
    y: number,
    radiusTiles: number,
    alpha: number,
    staticLight: StaticLight | null,
    dynamicIndex: number,
    view: { camX: number; camY: number; viewW: number; viewH: number },
  ): void {
    const radius = radiusTiles * TILE_SIZE;
    if (radius <= 0 || alpha <= MIN_VISIBLE_ALPHA) return;
    if (x + radius < view.camX || y + radius < view.camY) return;
    if (x - radius > view.camX + view.viewW || y - radius > view.camY + view.viewH) return;
    if (this.glowCount >= this.glowPool.length) {
      this.glowPool.push({ alpha: 0, distanceSq: 0, staticLight: null, dynamicIndex: -1 });
    }
    const candidate = this.glowPool[this.glowCount];
    this.glowCount++;
    const midX = view.camX + view.viewW * HALF;
    const midY = view.camY + view.viewH * HALF;
    candidate.alpha = alpha;
    candidate.distanceSq = (x - midX) ** 2 + (y - midY) ** 2;
    candidate.staticLight = staticLight;
    candidate.dynamicIndex = dynamicIndex;
  }

  /**
   * The colour pass: each light's glow, shaped by what the light sees so the
   * colour stops softly at walls, added, for the lights nearest the middle of
   * the view. Returns how many it drew.
   */
  private drawGlows(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    nowMs: number,
  ): number {
    this.glowCount = 0;
    const view = this.glowView;
    view.camX = camX;
    view.camY = camY;
    view.viewW = viewW;
    view.viewH = viewH;

    for (const light of this.cacheLights) {
      if (!light.on) continue;
      const share = FLICKER_SHARE[light.flicker];
      const flicker = share > 0 ? flickerValue(light.flicker, light.group, nowMs) : 1;
      this.considerGlow(
        light.centreX,
        light.centreY,
        light.spec.glowRadiusTiles,
        light.spec.glowStrength * (1 - share + share * flicker),
        light,
        -1,
        view,
      );
    }
    for (const light of this.dyingLights) {
      this.considerGlow(
        light.centreX,
        light.centreY,
        light.spec.glowRadiusTiles,
        deathAlpha(light, nowMs) * LIGHT_DEATH_FLARE,
        light,
        -1,
        view,
      );
    }
    for (let index = 0; index < this.dynamicCount; index++) {
      const light = this.dynamicLights[index];
      const spec = lightKindSpec(light.kind);
      const radiusTiles = spec.glowRadiusTiles * (light.reachTiles / spec.reachTiles);
      this.considerGlow(
        light.x,
        light.y,
        radiusTiles,
        spec.glowStrength * light.strength,
        null,
        index,
        view,
      );
    }

    const pool = this.glowPool;
    const candidates = this.glowCount;
    // Partial selection rather than a sort of the whole pool: only the nearest few are drawn.
    const count = Math.min(MAX_GLOWS_PER_FRAME, candidates);
    for (let slot = 0; slot < count; slot++) {
      let nearest = slot;
      for (let other = slot + 1; other < candidates; other++) {
        if (pool[other].distanceSq < pool[nearest].distanceSq) nearest = other;
      }
      if (nearest !== slot) {
        const swap = pool[slot];
        pool[slot] = pool[nearest];
        pool[nearest] = swap;
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index++) {
      const glow = pool[index];
      // A glow stronger than 1 (a flaring death, a brazier) is added again for
      // what is left over, rather than clipped to a single full-strength draw.
      for (let remaining = glow.alpha; remaining > MIN_VISIBLE_ALPHA; remaining -= 1) {
        ctx.globalAlpha = Math.min(1, remaining);
        this.drawGlow(ctx, camX, camY, glow);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return count;
  }

  private readonly glowView = { camX: 0, camY: 0, viewW: 0, viewH: 0 };

  private drawGlow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    glow: GlowCandidate,
  ): void {
    const light = glow.staticLight;
    if (light !== null) {
      drawPlaced(
        ctx,
        light.cookie.glow(light.spec.glowRadiusTiles, parsedGlow(light.colour)),
        camX,
        camY,
      );
      return;
    }
    this.drawDynamicGlow(ctx, camX, camY, glow.dynamicIndex);
  }

  /**
   * One dynamic light's glow: the cached glows of the tile centres round it,
   * added at their weights on top of the alpha the caller set.
   */
  private drawDynamicGlow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    lightIndex: number,
  ): void {
    const light = this.dynamicLights[lightIndex];
    const spec = lightKindSpec(light.kind);
    const colour = spec.colour ?? 'warm';
    const radiusTiles = spec.glowRadiusTiles * (light.reachTiles / spec.reachTiles);
    // A small glow barely reaches past the tile it is on, so it is drawn as a
    // plain disc: four shadowed masks would cost four draws for nothing seen.
    if (radiusTiles <= UNSHADOWED_GLOW_MAX_TILES) {
      drawRadialGlow(
        ctx,
        light.x - camX,
        light.y - camY,
        radiusTiles * TILE_SIZE,
        GLOW_COLOURS[colour].stops,
      );
      return;
    }
    const alpha = ctx.globalAlpha;
    for (let slot = 0; slot < light.originCount; slot++) {
      const origin = light.origins[slot];
      ctx.globalAlpha = alpha * origin.weight;
      drawPlaced(
        ctx,
        this.originCookies.glow(origin.x, origin.y, radiusTiles, colour, parsedGlow(colour)),
        camX,
        camY,
      );
    }
    ctx.globalAlpha = alpha;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The tile types light stops at: the structure of the floor. Props, however
 * solid, are left out — a crate does not cast a room-sized shadow.
 */
export const LIGHT_BLOCKING_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.wall,
  VOID_TYPE,
  METAL_WALL,
]);

/** South first: a wall fixture's light falls on the floor in front of the face it hangs on. */
const NEIGHBOUR_PREFERENCE: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
];

/** Draws a painted surface over the tiles it was painted for, stretched to world size. */
function drawPlaced(
  ctx: CanvasRenderingContext2D,
  placed: PlacedSurface,
  camX: number,
  camY: number,
): void {
  const sizePx = placed.sizeTiles * TILE_SIZE;
  ctx.drawImage(
    placed.surface,
    placed.tileX * TILE_SIZE - camX,
    placed.tileY * TILE_SIZE - camY,
    sizePx,
    sizePx,
  );
}

const parsedGlows = new Map<GlowColour, ParsedGlowStops>();

/** A glow colour's stops, parsed once. */
function parsedGlow(colour: GlowColour): ParsedGlowStops {
  const cached = parsedGlows.get(colour);
  if (cached !== undefined) return cached;
  const parsed = parseGlowStops(GLOW_COLOURS[colour].stops);
  parsedGlows.set(colour, parsed);
  return parsed;
}

function parseRgb(rgb: string): readonly [number, number, number] {
  const [r = 0, g = 0, b = 0] = rgb.split(',').map(Number);
  return [r, g, b];
}

/**
 * Where a flicker profile's group stands at a moment, 0 (its dimmest) to 1
 * (its brightest).
 */
export function flickerValue(profile: FlickerProfile, group: number, nowMs: number): number {
  const seconds = nowMs / MS_PER_SECOND;
  const phase = group * GROUP_PHASE;
  switch (profile) {
    case 'steady':
      return 1;
    case 'flame':
      return (
        HALF +
        QUARTER *
          (Math.sin(seconds * FLAME_RATE_A + phase) + Math.sin(seconds * FLAME_RATE_B + phase * 2))
      );
    case 'brazier':
      return (
        HALF +
        QUARTER *
          (Math.sin(seconds * BRAZIER_RATE_A + phase) +
            Math.sin(seconds * BRAZIER_RATE_B + phase * 2))
      );
    case 'candle':
      return HALF + HALF * Math.sin(seconds * CANDLE_RATE + phase);
    case 'pulse':
      return HALF + HALF * Math.sin(seconds * PULSE_RATE + phase);
    case 'faulty_tube': {
      const window = Math.floor(nowMs / FAULTY_WINDOW_MS);
      if (tileHash(window, group, FAULTY_BURST_SALT) >= FAULTY_BURST_CHANCE) return 1;
      const room = FAULTY_WINDOW_MS - FAULTY_BURST_MAX_MS;
      const start = tileHash(window, group, FAULTY_START_SALT) * room;
      const length =
        FAULTY_BURST_MIN_MS +
        tileHash(window, group, FAULTY_LENGTH_SALT) * (FAULTY_BURST_MAX_MS - FAULTY_BURST_MIN_MS);
      const into = nowMs - window * FAULTY_WINDOW_MS;
      return into >= start && into < start + length ? 0 : 1;
    }
  }
}

/**
 * How much a broken light still cuts the dark: up from its steady cut to a
 * full flare, then down to nothing by {@link LIGHT_DEATH_MS}.
 */
function deathAlpha(light: StaticLight, nowMs: number): number {
  if (light.diedAtMs === null) return 0;
  const age = nowMs - light.diedAtMs;
  if (age < 0) return 1;
  if (light.poweredDown) return powerDownAlpha(age);
  if (age >= LIGHT_DEATH_MS) return 0;
  if (age < LIGHT_DEATH_FLASH_MS) return 1;
  return 1 - (age - LIGHT_DEATH_FLASH_MS) / (LIGHT_DEATH_MS - LIGHT_DEATH_FLASH_MS);
}

/** A tube's fade as its power goes: down to nothing, with one dark catch on the way. */
function powerDownAlpha(age: number): number {
  if (age >= POWER_DOWN_MS) return 0;
  const fade = 1 - age / POWER_DOWN_MS;
  const inLastFlicker = age >= POWER_DOWN_FLICKER_START_MS && age < POWER_DOWN_FLICKER_END_MS;
  return inLastFlicker ? fade * POWER_DOWN_FLICKER_DEPTH : fade;
}

function drawEyePair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spacingPx: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRadialGlow(ctx, cx, cy, TILE_SIZE * EYE_SHINE_GLOW_RADIUS, EYE_GLOW_STOPS);
  ctx.restore();
  ctx.fillStyle = EYE_SHINE_FILL;
  const radius = TILE_SIZE * EYE_SHINE_DOT_RADIUS;
  const halfSpacing = spacingPx * HALF;
  ctx.beginPath();
  ctx.arc(cx - halfSpacing, cy, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + halfSpacing, cy, radius, 0, FULL_TURN);
  ctx.fill();
}

/** An eye's glint at full strength. */
const EYE_SHINE_FILL = `${EYE_COLOR}1)`;
