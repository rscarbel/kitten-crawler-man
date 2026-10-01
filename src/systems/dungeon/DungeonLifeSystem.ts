/**
 * Small moving things on dungeon floors 1 and 2, all cosmetic: drips landing
 * in puddles, splash rings where anyone walks through water, beetles or
 * roaches that scatter from the party, flies over bones, dust motes hanging
 * in the strongest torchlight, and paper lifting where Carl walks through a
 * drift.
 *
 * Everything here is world: it draws under the darkness pass, so a dark
 * room's beetles are as hard to see as the room. The ground layer (ripples,
 * rings, critters) draws with the floor, under every body; the air layer
 * (falling drops, flies, motes, paper) after the bodies and before the dark.
 *
 * Cheap by construction: every list has a cap, flies and motes are drawn
 * from the clock with no state at all, critters are seated only in rooms near
 * the camera, and only what is on screen is touched. At the performance
 * render preset only the drips and the splashes are kept — they are the two
 * that tell the player something (there is water here; something walked
 * through it).
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import type { Rect } from '../../map/roomDoorways';
import { FloorTypeValue, PAPER_DRIFT } from '../../map/tileTypes';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import { lightKindSpec, type LightKind } from '../lighting/lightKinds';
import {
  NO_RESIDENT,
  ScatterSwarm,
  type CritterLook,
  type ResidentGroup,
  type WorldPoint,
} from '../critters/ScatterSwarm';
import {
  FLY_SITES_PER_REGION,
  flySiteCandidates,
  boneRemainsTiles,
  liveFlySites,
  type StaticLightTile,
  type TilePoint,
} from './dungeonEmitters';
import type { DungeonCue } from './dungeonSoundCues';
import { UINT32_SPAN } from '../../core/WorldRandom';

/** Whether standing water covers a tile; the floor surface answers it. */
export interface PuddleQuery {
  isPuddleAt(tileX: number, tileY: number): boolean;
}

/** What the motes ask of the lighting pass. */
export interface LightPoolSource {
  staticLightTiles(): ReadonlyArray<StaticLightTile>;
  /** How much of the dark lit static lights cut on a tile, 0–1. */
  staticLightAt(tileX: number, tileY: number): number;
  isShiningAt(tileX: number, tileY: number): boolean;
}

export interface DungeonLifeDeps {
  readonly gameMap: GameMap;
  readonly floor: DungeonFloorThemeId;
  /** Null on a floor with no floor surface; there are then no puddles. */
  readonly puddles: PuddleQuery | null;
  /** Null on a floor the lighting pass does not light; there are then no motes. */
  readonly lights: LightPoolSource | null;
  /** False at the performance render preset. */
  readonly fullDetail: () => boolean;
  /** Plays a cue from a point in the world. */
  readonly raiseCue: (cue: DungeonCue, worldX: number, worldY: number, volume?: number) => void;
  readonly random?: () => number;
  /** What broken props left on the floor, so flies stay over smashed bones; absent for none. */
  readonly wreckage?: () => ReadonlyArray<{
    readonly tileX: number;
    readonly tileY: number;
    readonly kind: string | null;
  }>;
}

/**
 * Anything that walks: a crawler, a companion, a mob. Its centre is
 * `x + TILE_SIZE/2`. A flying walker never touches the water.
 */
export interface Walker {
  readonly x: number;
  readonly y: number;
  readonly isFlying?: boolean;
}

export interface LifeFrame {
  /** The crawlers and companions: they splash with a sound, lift paper and scare critters. */
  readonly party: ReadonlyArray<Walker>;
  /** Every other walker in the scene; filtered to the view here. */
  readonly others: ReadonlyArray<Walker>;
  readonly camX: number;
  readonly camY: number;
  readonly viewW: number;
  readonly viewH: number;
}

interface Drip {
  readonly x: number;
  readonly groundY: number;
  readonly region: number;
  /** The drip one-shot's volume, played as the drop lands; null for a silent drop. */
  readonly volume: number | null;
  frame: number;
}

interface Ring {
  readonly x: number;
  readonly y: number;
  readonly region: number;
  frame: number;
}

interface PaperScrap {
  x: number;
  y: number;
  readonly groundY: number;
  readonly region: number;
  vx: number;
  vy: number;
  angle: number;
  readonly spin: number;
  frame: number;
  readonly shade: string;
}

interface MotePool {
  /** The light's own tile, for whether it is shining. */
  readonly lightX: number;
  readonly lightY: number;
  /** The pool's centre on the floor, in world pixels. */
  readonly x: number;
  readonly y: number;
  readonly colour: string;
  readonly seed: number;
}

interface FlySite {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
}

/** Where a walker last splashed or lifted paper; reused, never reallocated. */
interface Mark {
  x: number;
  y: number;
}

/** A room that keeps critters, and whether they are sitting there now. */
interface CritterRoom {
  readonly roomId: number;
  readonly bounds: Rect;
  readonly groups: ReadonlyArray<ResidentGroup>;
  /** Swarm handles of the groups seated now; empty while none are. */
  readonly seated: number[];
  /** Whether the room has ever had its critters seated. */
  everSeated: boolean;
  /** Frames until a scattered room may be seated again; 0 when it may. */
  regroupFrames: number;
}

const HALF = 0.5;
const TWO_PI = Math.PI * 2;
const TILE_CENTRE = 0.5;

// ── Drips ──
const MAX_DRIPS = 6;
const DRIPS_PER_REGION = 3;
/** Frames a drop takes to fall; its drip one-shot plays as it lands. */
export const DROP_FALL_FRAMES = 18;
const DROP_FALL_HEIGHT_PX = 40;
const DRIP_RIPPLE_FRAMES = 40;
const DROP_LENGTH_PX = 3;
const DROP_COLOUR = 'rgba(190,215,230,0.85)';
/** Puddles on screen drip on their own, silently, between these many frames. */
const VISUAL_DRIP_GAP_MIN_FRAMES = 120;
const VISUAL_DRIP_GAP_SPREAD_FRAMES = 180;

// ── Splash rings ──
const MAX_RINGS = 24;
const RINGS_PER_REGION = 8;
/** Short-lived, so a walker's previous ring is mostly gone before the next lands. */
const RING_FRAMES = 20;
const RING_START_RADIUS_PX = 2;
const RING_GROWTH_PX = 8;
/** Water seen from three-quarters above: a ring is far wider than it is tall. */
const RING_FLATTEN = 0.32;
const RING_START_ALPHA = 0.3;
const RING_LINE_WIDTH = 1;
const RING_COLOUR = 'rgb(200,222,236)';
const RIPPLE_SECOND_RING_DELAY = 0.35;
/**
 * A walker splashes again after moving this far through water: far enough
 * that its last ring has faded before the next one lands beside it.
 */
const SPLASH_STRIDE_PX = 22;
/** Feet sit this far below a walker's centre. */
const FEET_BELOW_CENTRE_PX = 12;
const PUDDLE_STEP_VOLUME = 0.5;

// ── Critters ──
/** A room this big may hold a second group. */
const LARGE_ROOM_TILES = 80;
const CRITTER_GROUPS_SMALL_ROOM = 1;
const CRITTER_GROUPS_LARGE_ROOM = 2;
/** Share of rooms that keep critters, picked by a hash of the room so it never changes. */
const CRITTER_ROOM_SHARE = 0.5;
const CRITTER_GROUP_MIN = 3;
const CRITTER_GROUP_SPREAD = 3;
/** The crack a critter runs for sits this far inside its tile's wall edge. */
const HIDE_INSET_PX = 1;
const BURST_COUNT_MIN = 5;
const BURST_COUNT_SPREAD = 4;
/** A surprise burst looks this far for a wall foot to run to. */
const BURST_HIDE_SEARCH_TILES = 4;
const SCUTTLE_VOLUME = 0.6;
/** Rooms are seated once they come within this many tiles of the view. */
const SEAT_MARGIN_TILES = 6;
/** Seated rooms this many tiles beyond the view are emptied, unseen. */
const RELEASE_MARGIN_TILES = 14;
/** How often the seating near the camera is looked at, in frames. */
const SEAT_CHECK_FRAMES = 15;
/** At most this many rooms keep critters seated at once. */
const MAX_SEATED_ROOMS = 12;
/** A scattered room's critters creep back out after this long, unseen. */
const REGROUP_FRAMES = 900;
const CRITTER_LOOK: Readonly<Record<DungeonFloorThemeId, CritterLook>> = {
  cellars: 'beetle',
  service_level: 'roach',
};

// ── Flies ──
const MAX_FLY_SITES_DRAWN = 6;
const FLIES_PER_SITE = 3;
const FLY_ORBIT_MIN_PX = 4;
const FLY_ORBIT_SPREAD_PX = 5;
const FLY_HOVER_PX = 7;
const FLY_RATE_MIN = 0.09;
const FLY_RATE_SPREAD = 0.08;
const FLY_BOB_PX = 2;
/** The bob runs at an irrational multiple of the orbit, so a fly never retraces its path. */
const FLY_BOB_RATE = Math.E;
const FLY_SIZE_PX = 1.2;
const FLY_COLOUR = 'rgba(12,10,8,0.9)';
const FLY_WING_COLOUR = 'rgba(200,200,190,0.25)';
const FLY_WING_PX = 1.4;
/** Flies trace a figure that is wider than it is tall. */
const FLY_ORBIT_FLATTEN = 0.5;
const FLY_ORBIT_WOBBLE = 1.7;

// ── Motes ──
const MAX_MOTE_POOLS = 3;
const MOTES_PER_POOL = 5;
/** Only lights reaching at least this far make pools strong enough to show motes. */
const MOTE_MIN_REACH_TILES = 4;
/** How far round a pool's centre motes hang, in tiles. */
const MOTE_SPREAD_TILES = 1.4;
const MOTE_SPREAD_PX = TILE_SIZE * MOTE_SPREAD_TILES;
const MOTE_RISE_PX_PER_FRAME = 0.06;
const MOTE_DRIFT_PX = 4;
const MOTE_DRIFT_RATE = 0.012;
/** A mote at its brightest: a speck that catches the eye in the pool, not a glow. */
const MOTE_MAX_ALPHA = 0.7;
/** A mote is drawn only where the light cuts at least this much of the dark. */
const MOTE_MIN_LIGHT = 0.35;
const MOTE_SIZE_PX = 1.5;
const WARM_MOTE = 'rgb(255,226,170)';
const COOL_MOTE = 'rgb(232,242,255)';
const FLAME_KINDS: ReadonlySet<LightKind> = new Set(['wall_sconce', 'standing_torch', 'brazier']);
/** Lights hung on a wall face throw their pool onto the floor below the face. */
const WALL_HUNG_KINDS: ReadonlySet<LightKind> = new Set([
  'wall_sconce',
  'fluorescent_tube',
  'sodium_lamp',
  'emergency_light',
]);

// ── Paper ──
const MAX_PAPER = 16;
const PAPER_PER_REGION = 8;
const PAPER_PER_STEP = 2;
const PAPER_STRIDE_PX = 10;
const PAPER_LIFE_FRAMES = 46;
const PAPER_LIFT_SPEED = 1.1;
const PAPER_SIDE_SPEED = 0.9;
const PAPER_GRAVITY = 0.06;
const PAPER_DRAG = 0.94;
const PAPER_SPIN_MAX = 0.25;
const PAPER_W_PX = 3;
const PAPER_H_PX = 2;
const PAPER_SHADES = ['#e8e2d0', '#c9c1a8', '#d8d2bc'] as const;
const PAPER_RUSTLE_GAP_FRAMES = 20;
const PAPER_RUSTLE_VOLUME = 0.5;

const HASH_A = 0x9e3779b1;
const HASH_B = 0x85ebca77;
const HASH_SHIFT = 15;

/**
 * The caps every effect is held to, for the gates. Each effect has a cap per
 * room or hallway, and a floor-wide one behind it so a crowd of rooms in view
 * at once still costs a fixed amount.
 */
export const DUNGEON_LIFE_CAPS = {
  drips: MAX_DRIPS,
  dripsPerRegion: DRIPS_PER_REGION,
  rings: MAX_RINGS,
  ringsPerRegion: RINGS_PER_REGION,
  paper: MAX_PAPER,
  paperPerRegion: PAPER_PER_REGION,
  critterGroupsPerRoom: CRITTER_GROUPS_LARGE_ROOM,
  critterGroupSize: CRITTER_GROUP_MIN + CRITTER_GROUP_SPREAD - 1,
  seatedRooms: MAX_SEATED_ROOMS,
  flySitesPerRegion: FLY_SITES_PER_REGION,
  seatCheckFrames: SEAT_CHECK_FRAMES,
} as const;

function hash01(seed: number, index: number): number {
  let h = Math.imul(seed ^ Math.imul(index + 1, HASH_A), HASH_B);
  h ^= h >>> HASH_SHIFT;
  return (h >>> 0) / UINT32_SPAN;
}

function tileSeed(x: number, y: number): number {
  return Math.imul(x, HASH_A) ^ Math.imul(y, HASH_B);
}

function rectNearView(bounds: Rect, frame: LifeFrame, marginTiles: number): boolean {
  const margin = marginTiles * TILE_SIZE;
  const left = bounds.x * TILE_SIZE;
  const top = bounds.y * TILE_SIZE;
  const right = (bounds.x + bounds.w) * TILE_SIZE;
  const bottom = (bounds.y + bounds.h) * TILE_SIZE;
  return (
    right >= frame.camX - margin &&
    left <= frame.camX + frame.viewW + margin &&
    bottom >= frame.camY - margin &&
    top <= frame.camY + frame.viewH + margin
  );
}

export class DungeonLifeSystem {
  private readonly random: () => number;
  /** The groups sitting at wall feet. */
  private readonly residents: ScatterSwarm;
  /**
   * Swarms let out of broken props, on their own budget so a screen full of
   * sitting groups still leaves room for a surprise.
   */
  private readonly bursts: ScatterSwarm;
  private readonly critterRooms: CritterRoom[] = [];
  private seatedRoomCount = 0;
  private framesToSeatCheck = 0;
  private readonly drips: Drip[] = [];
  private readonly rings: Ring[] = [];
  private readonly paper: PaperScrap[] = [];
  private readonly lastSplash = new WeakMap<Walker, Mark>();
  private readonly lastPaper = new WeakMap<Walker, Mark>();
  private readonly puddleTiles: Array<{ readonly x: number; readonly y: number }> = [];
  private motePools: MotePool[] = [];
  private flySites: FlySite[] = [];
  /** Every tile that held bones when the floor was built. */
  private readonly flyCandidates: ReadonlyArray<TilePoint>;
  private framesToVisualDrip: number;
  private framesSinceRustle = Number.POSITIVE_INFINITY;
  private frame = 0;
  private readonly viewWalkers: Walker[] = [];
  /** The party's centres this frame, reused. */
  private readonly threats: Mark[] = [];
  /** Scratch for {@link drawMotes}: the closest pools in view, nearest first. */
  private readonly nearestPools: MotePool[] = [];
  private readonly nearestPoolDistances: number[] = [];
  /** Scratch for a walker's centre. */
  private readonly centre: Mark = { x: 0, y: 0 };

  constructor(private readonly deps: DungeonLifeDeps) {
    this.random = deps.random ?? Math.random;
    this.residents = new ScatterSwarm((x, y) => this.isFloor(x, y), this.random);
    this.bursts = new ScatterSwarm((x, y) => this.isFloor(x, y), this.random);
    this.flyCandidates = flySiteCandidates(deps.gameMap.structure);
    this.collectPuddles();
    this.planCritterRooms();
    this.rescan();
    this.framesToVisualDrip = this.nextVisualDripGap();
  }

  /** Every tile of standing water, for the ambience's drip. */
  get puddles(): ReadonlyArray<{ readonly x: number; readonly y: number }> {
    return this.puddleTiles;
  }

  /** Living critters' positions, for the gates. */
  critterPositions(): WorldPoint[] {
    return [...this.residents.critterPositions(), ...this.bursts.critterPositions()];
  }

  /** Surprise critters still running, for the gates. */
  burstPositions(): WorldPoint[] {
    return this.bursts.critterPositions();
  }

  /** Where every splash ring sits, in world pixels; for the gates. */
  ringPositions(): WorldPoint[] {
    return this.rings.map((ring) => ({ x: ring.x, y: ring.y }));
  }

  /** The rooms that keep critters, by id and bounds; for the gates. */
  critterRoomBounds(): ReadonlyArray<{ readonly roomId: number; readonly bounds: Rect }> {
    return this.critterRooms;
  }

  /** Where flies gather, in world pixels; for the gates. */
  flySitePositions(): WorldPoint[] {
    return this.flySites.map((site) => ({ x: site.x, y: site.y }));
  }

  /** How many effects of each kind are alive, for the gates and the cost probe. */
  get counts(): {
    drips: number;
    rings: number;
    paper: number;
    critters: number;
    seatedRooms: number;
  } {
    return {
      drips: this.drips.length,
      rings: this.rings.length,
      paper: this.paper.length,
      critters: this.residents.critterCount + this.bursts.critterCount,
      seatedRooms: this.seatedRoomCount,
    };
  }

  /** The most of one effect alive in any one region, for the gates. */
  peakPerRegion(kind: 'drips' | 'rings' | 'paper'): number {
    const list = kind === 'drips' ? this.drips : kind === 'rings' ? this.rings : this.paper;
    const counts = new Map<number, number>();
    let peak = 0;
    for (const item of list) {
      const count = (counts.get(item.region) ?? 0) + 1;
      counts.set(item.region, count);
      peak = Math.max(peak, count);
    }
    return peak;
  }

  /**
   * Drops every critter a broken prop let out. For a checkpoint restore: the
   * prop that held them stands again, so its swarm has nowhere to come from.
   */
  clearSurprises(): void {
    this.bursts.clear();
  }

  /** Re-reads the lights and the bone piles, after something broke or was put back. */
  rescan(): void {
    this.motePools = this.collectMotePools();
    this.flySites = this.collectFlySites();
  }

  /**
   * A drop falls onto a puddle tile and ripples out. With a `volume`, the
   * drip one-shot plays at that volume the moment the drop lands. Returns
   * false — and nothing falls — on dry ground and past the caps.
   */
  spawnDrip(tileX: number, tileY: number, volume: number | null = null): boolean {
    if (this.deps.puddles?.isPuddleAt(tileX, tileY) !== true) return false;
    const region = this.deps.gameMap.regionAt(tileX, tileY);
    if (this.drips.length >= MAX_DRIPS) return false;
    if (countInRegion(this.drips, region) >= DRIPS_PER_REGION) return false;
    this.drips.push({
      x: (tileX + TILE_CENTRE) * TILE_SIZE,
      groundY: (tileY + TILE_CENTRE) * TILE_SIZE,
      region,
      volume,
      frame: 0,
    });
    return true;
  }

  /**
   * A swarm of beetles or roaches bursting out of something broken and
   * running for the nearest wall. Never a mob: cosmetic only. Returns whether
   * any came out — never at the performance preset, nor where nothing fits.
   */
  scatterSurprise(worldX: number, worldY: number): boolean {
    if (!this.deps.fullDetail()) return false;
    const hide = this.nearestWallFoot(worldX, worldY);
    const count = BURST_COUNT_MIN + Math.floor(this.random() * BURST_COUNT_SPREAD);
    const look = CRITTER_LOOK[this.deps.floor];
    return this.bursts.burst(look, { x: worldX, y: worldY }, count, hide) > 0;
  }

  update(frame: LifeFrame): void {
    this.frame++;
    this.framesSinceRustle++;
    this.collectViewWalkers(frame);
    this.updateDrips(frame);
    this.updateSplashes(frame.party, true);
    this.updateSplashes(this.viewWalkers, false);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if (++this.rings[i].frame >= RING_FRAMES) this.rings.splice(i, 1);
    }
    if (!this.deps.fullDetail()) return;
    const threats = this.threats;
    while (threats.length < frame.party.length) threats.push({ x: 0, y: 0 });
    threats.length = frame.party.length;
    for (let i = 0; i < frame.party.length; i++) writeCentre(frame.party[i], threats[i]);
    this.bursts.update(threats);
    for (const at of this.residents.update(threats)) {
      this.deps.raiseCue('critterScuttle', at.x, at.y, SCUTTLE_VOLUME);
    }
    this.seatCritters(frame);
    this.updatePaper(frame.party);
  }

  /** Ripples, rings and critters: floor-level, under every body. */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    ctx.save();
    ctx.lineWidth = RING_LINE_WIDTH;
    ctx.strokeStyle = RING_COLOUR;
    for (const drip of this.drips) {
      if (drip.frame < DROP_FALL_FRAMES) continue;
      const share = (drip.frame - DROP_FALL_FRAMES) / DRIP_RIPPLE_FRAMES;
      drawRing(ctx, drip.x - camX, drip.groundY - camY, share);
      if (share > RIPPLE_SECOND_RING_DELAY) {
        const second = (share - RIPPLE_SECOND_RING_DELAY) / (1 - RIPPLE_SECOND_RING_DELAY);
        drawRing(ctx, drip.x - camX, drip.groundY - camY, second);
      }
    }
    for (const ring of this.rings) {
      drawRing(ctx, ring.x - camX, ring.y - camY, ring.frame / RING_FRAMES);
    }
    ctx.restore();
    if (!this.deps.fullDetail()) return;
    this.residents.render(ctx, camX, camY, viewW, viewH);
    this.bursts.render(ctx, camX, camY, viewW, viewH);
  }

  /** Falling drops, flies, motes and paper: in the air, after the bodies, under the dark. */
  renderAir(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = DROP_COLOUR;
    ctx.lineWidth = RING_LINE_WIDTH;
    for (const drip of this.drips) {
      if (drip.frame >= DROP_FALL_FRAMES) continue;
      const fallen = drip.frame / DROP_FALL_FRAMES;
      const y = drip.groundY - DROP_FALL_HEIGHT_PX * (1 - fallen * fallen) - camY;
      ctx.beginPath();
      ctx.moveTo(drip.x - camX, y - DROP_LENGTH_PX);
      ctx.lineTo(drip.x - camX, y);
      ctx.stroke();
    }
    ctx.restore();
    if (!this.deps.fullDetail()) return;
    this.drawFlies(ctx, camX, camY, viewW, viewH);
    this.drawMotes(ctx, camX, camY, viewW, viewH);
    this.drawPaper(ctx, camX, camY);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  private isFloor(tileX: number, tileY: number): boolean {
    return this.deps.gameMap.isWalkable(tileX, tileY);
  }

  private isWall(tileX: number, tileY: number): boolean {
    const structure = this.deps.gameMap.structure;
    if (tileY < 0 || tileY >= structure.length) return false;
    const row = structure[tileY];
    if (tileX < 0 || tileX >= row.length) return false;
    return row[tileX].type === FloorTypeValue.wall;
  }

  private collectPuddles(): void {
    const puddles = this.deps.puddles;
    if (puddles === null) return;
    const structure = this.deps.gameMap.structure;
    for (let y = 0; y < structure.length; y++) {
      for (let x = 0; x < structure[y].length; x++) {
        if (puddles.isPuddleAt(x, y)) this.puddleTiles.push({ x, y });
      }
    }
  }

  /**
   * Picks the rooms that keep critters and where each group sits: up to one
   * group a room (two in a large one), on a floor tile at the foot of a wall.
   * Nothing is seated yet; {@link seatCritters} does that as the camera nears.
   */
  private planCritterRooms(): void {
    const { gameMap } = this.deps;
    gameMap.roomBounds.forEach((bounds, roomId) => {
      const assignment = gameMap.regionCharacters.forRegion(roomId);
      if (assignment?.type !== 'room') return;
      const roomSeed = Math.imul(gameMap.worldSeed ^ roomId, HASH_A);
      if (hash01(roomSeed, 0) >= CRITTER_ROOM_SHARE) return;
      const feet: Array<{ x: number; y: number; hide: WorldPoint }> = [];
      for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
        for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
          const hide = this.wallFootHide(x, y);
          if (hide !== null) feet.push({ x, y, hide });
        }
      }
      const wanted =
        bounds.w * bounds.h >= LARGE_ROOM_TILES
          ? CRITTER_GROUPS_LARGE_ROOM
          : CRITTER_GROUPS_SMALL_ROOM;
      const groups: ResidentGroup[] = [];
      for (let g = 0; g < wanted && feet.length > 0; g++) {
        const pick = Math.floor(hash01(roomSeed, g + 1) * feet.length);
        const [spot] = feet.splice(pick, 1);
        groups.push({
          tileX: spot.x,
          tileY: spot.y,
          count:
            CRITTER_GROUP_MIN + Math.floor(hash01(roomSeed, g + wanted + 1) * CRITTER_GROUP_SPREAD),
          hide: spot.hide,
          seed: tileSeed(spot.x, spot.y),
        });
      }
      if (groups.length === 0) return;
      this.critterRooms.push({
        roomId,
        bounds,
        groups,
        seated: [],
        everSeated: false,
        regroupFrames: 0,
      });
    });
  }

  /**
   * The crack a critter on this tile runs for: the foot of the wall beside
   * it, just inside the tile. Null when the tile is not floor or has no wall
   * on its north, west or east side.
   */
  private wallFootHide(tileX: number, tileY: number): WorldPoint | null {
    if (!this.isFloor(tileX, tileY)) return null;
    const left = tileX * TILE_SIZE;
    const top = tileY * TILE_SIZE;
    const centreX = left + TILE_SIZE * HALF;
    const centreY = top + TILE_SIZE * HALF;
    if (this.isWall(tileX, tileY - 1)) return { x: centreX, y: top + HIDE_INSET_PX };
    if (this.isWall(tileX - 1, tileY)) return { x: left + HIDE_INSET_PX, y: centreY };
    if (this.isWall(tileX + 1, tileY)) return { x: left + TILE_SIZE - HIDE_INSET_PX, y: centreY };
    return null;
  }

  /** The nearest wall foot within {@link BURST_HIDE_SEARCH_TILES}, or a point off to one side. */
  private nearestWallFoot(worldX: number, worldY: number): WorldPoint {
    const originX = Math.floor(worldX / TILE_SIZE);
    const originY = Math.floor(worldY / TILE_SIZE);
    let best: WorldPoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dy = -BURST_HIDE_SEARCH_TILES; dy <= BURST_HIDE_SEARCH_TILES; dy++) {
      for (let dx = -BURST_HIDE_SEARCH_TILES; dx <= BURST_HIDE_SEARCH_TILES; dx++) {
        const hide = this.wallFootHide(originX + dx, originY + dy);
        if (hide === null) continue;
        const distance = Math.hypot(hide.x - worldX, hide.y - worldY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = hide;
        }
      }
    }
    if (best !== null) return best;
    // No wall in reach: they run off one way until they hit something they
    // cannot cross, and are gone into it.
    const angle = this.random() * TWO_PI;
    const runPx = BURST_HIDE_SEARCH_TILES * TILE_SIZE;
    return { x: worldX + Math.cos(angle) * runPx, y: worldY + Math.sin(angle) * runPx };
  }

  private collectMotePools(): MotePool[] {
    const lights = this.deps.lights;
    if (lights === null) return [];
    const pools: MotePool[] = [];
    for (const light of lights.staticLightTiles()) {
      if (!light.on) continue;
      if (lightKindSpec(light.kind).reachTiles < MOTE_MIN_REACH_TILES) continue;
      const poolTileY = WALL_HUNG_KINDS.has(light.kind) ? light.y + 1 : light.y;
      pools.push({
        lightX: light.x,
        lightY: light.y,
        x: (light.x + TILE_CENTRE) * TILE_SIZE,
        y: (poolTileY + TILE_CENTRE) * TILE_SIZE,
        colour: FLAME_KINDS.has(light.kind) ? WARM_MOTE : COOL_MOTE,
        seed: tileSeed(light.x, light.y),
      });
    }
    return pools;
  }

  private collectFlySites(): FlySite[] {
    const remains = boneRemainsTiles(this.deps.wreckage?.() ?? []);
    return liveFlySites(this.deps.gameMap, this.flyCandidates, remains).map((site) => ({
      x: (site.x + TILE_CENTRE) * TILE_SIZE,
      y: (site.y + TILE_CENTRE) * TILE_SIZE,
      seed: tileSeed(site.x, site.y),
    }));
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Seats the critter rooms near the camera and empties the far ones, every
   * {@link SEAT_CHECK_FRAMES}. A room is seated as it comes within
   * {@link SEAT_MARGIN_TILES} of the view — while it is still off screen, so
   * nothing pops in, except on its first visit (the room the party arrives
   * in). A room whose critters all ran waits {@link REGROUP_FRAMES} and then
   * fills again only while it is off screen.
   */
  private seatCritters(frame: LifeFrame): void {
    this.framesToSeatCheck--;
    if (this.framesToSeatCheck > 0) return;
    this.framesToSeatCheck = SEAT_CHECK_FRAMES;
    const look = CRITTER_LOOK[this.deps.floor];
    for (const room of this.critterRooms) {
      room.regroupFrames = Math.max(0, room.regroupFrames - SEAT_CHECK_FRAMES);
      if (room.seated.length > 0) {
        if (!rectNearView(room.bounds, frame, RELEASE_MARGIN_TILES)) {
          this.emptyRoom(room);
          continue;
        }
        if (this.anySitting(room)) continue;
        this.emptyRoom(room);
        room.regroupFrames = REGROUP_FRAMES;
        continue;
      }
      if (this.seatedRoomCount >= MAX_SEATED_ROOMS) continue;
      if (room.regroupFrames > 0) continue;
      if (!rectNearView(room.bounds, frame, SEAT_MARGIN_TILES)) continue;
      if (room.everSeated && rectNearView(room.bounds, frame, 0)) continue;
      for (const group of room.groups) {
        const id = this.residents.addResident(look, group);
        if (id !== NO_RESIDENT) room.seated.push(id);
      }
      if (room.seated.length === 0) continue;
      room.everSeated = true;
      this.seatedRoomCount++;
    }
  }

  private anySitting(room: CritterRoom): boolean {
    for (const id of room.seated) if (this.residents.isSitting(id)) return true;
    return false;
  }

  private emptyRoom(room: CritterRoom): void {
    for (const id of room.seated) this.residents.releaseResident(id);
    room.seated.length = 0;
    this.seatedRoomCount--;
  }

  private collectViewWalkers(frame: LifeFrame): void {
    const walkers = this.viewWalkers;
    walkers.length = 0;
    for (const walker of frame.others) {
      const sx = walker.x - frame.camX;
      const sy = walker.y - frame.camY;
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > frame.viewW || sy > frame.viewH) continue;
      walkers.push(walker);
    }
  }

  private updateDrips(frame: LifeFrame): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const drip = this.drips[i];
      drip.frame++;
      if (drip.frame === DROP_FALL_FRAMES && drip.volume !== null) {
        this.deps.raiseCue('waterDrip', drip.x, drip.groundY, drip.volume);
      }
      if (drip.frame >= DROP_FALL_FRAMES + DRIP_RIPPLE_FRAMES) this.drips.splice(i, 1);
    }
    if (this.puddleTiles.length === 0) return;
    this.framesToVisualDrip--;
    if (this.framesToVisualDrip > 0) return;
    this.framesToVisualDrip = this.nextVisualDripGap();
    const minX = Math.floor(frame.camX / TILE_SIZE);
    const minY = Math.floor(frame.camY / TILE_SIZE);
    const maxX = Math.ceil((frame.camX + frame.viewW) / TILE_SIZE);
    const maxY = Math.ceil((frame.camY + frame.viewH) / TILE_SIZE);
    // One random puddle in view, picked in one pass without collecting them.
    let picked: { x: number; y: number } | null = null;
    let seen = 0;
    for (const tile of this.puddleTiles) {
      if (tile.x < minX || tile.x > maxX || tile.y < minY || tile.y > maxY) continue;
      seen++;
      if (this.random() * seen < 1) picked = tile;
    }
    if (picked !== null) this.spawnDrip(picked.x, picked.y);
  }

  private nextVisualDripGap(): number {
    return VISUAL_DRIP_GAP_MIN_FRAMES + Math.floor(this.random() * VISUAL_DRIP_GAP_SPREAD_FRAMES);
  }

  /** Rings where a walker's feet move through water; flying walkers never touch it. */
  private updateSplashes(walkers: ReadonlyArray<Walker>, audible: boolean): void {
    const puddles = this.deps.puddles;
    if (puddles === null) return;
    const feet = this.centre;
    for (const walker of walkers) {
      if (walker.isFlying === true) continue;
      writeCentre(walker, feet);
      feet.y += FEET_BELOW_CENTRE_PX;
      const tileX = Math.floor(feet.x / TILE_SIZE);
      const tileY = Math.floor(feet.y / TILE_SIZE);
      if (!puddles.isPuddleAt(tileX, tileY)) {
        this.lastSplash.delete(walker);
        continue;
      }
      const last = this.lastSplash.get(walker);
      // Standing in a puddle is not walking through it: the first sight of a
      // walker on water marks where it stands, and only moving on splashes.
      if (last === undefined) {
        this.lastSplash.set(walker, { x: feet.x, y: feet.y });
        continue;
      }
      if (Math.hypot(feet.x - last.x, feet.y - last.y) < SPLASH_STRIDE_PX) continue;
      last.x = feet.x;
      last.y = feet.y;
      const region = this.deps.gameMap.regionAt(tileX, tileY);
      const roomForRing =
        this.rings.length < MAX_RINGS && countInRegion(this.rings, region) < RINGS_PER_REGION;
      if (roomForRing) this.rings.push({ x: feet.x, y: feet.y, region, frame: 0 });
      if (audible) this.deps.raiseCue('puddleStep', feet.x, feet.y, PUDDLE_STEP_VOLUME);
    }
  }

  private updatePaper(party: ReadonlyArray<Walker>): void {
    for (let i = this.paper.length - 1; i >= 0; i--) {
      const scrap = this.paper[i];
      scrap.frame++;
      scrap.vy += PAPER_GRAVITY;
      scrap.vx *= PAPER_DRAG;
      scrap.x += scrap.vx;
      scrap.y = Math.min(scrap.groundY, scrap.y + scrap.vy);
      scrap.angle += scrap.spin;
      if (scrap.frame >= PAPER_LIFE_FRAMES) this.paper.splice(i, 1);
    }
    const structure = this.deps.gameMap.structure;
    const feet = this.centre;
    for (const walker of party) {
      writeCentre(walker, feet);
      feet.y += FEET_BELOW_CENTRE_PX;
      const tileX = Math.floor(feet.x / TILE_SIZE);
      const tileY = Math.floor(feet.y / TILE_SIZE);
      const onPaper =
        tileY >= 0 &&
        tileY < structure.length &&
        tileX >= 0 &&
        tileX < structure[tileY].length &&
        structure[tileY][tileX].type === PAPER_DRIFT;
      if (!onPaper) {
        this.lastPaper.delete(walker);
        continue;
      }
      const last = this.lastPaper.get(walker);
      if (last === undefined) {
        this.lastPaper.set(walker, { x: feet.x, y: feet.y });
        continue;
      }
      if (Math.hypot(feet.x - last.x, feet.y - last.y) < PAPER_STRIDE_PX) continue;
      last.x = feet.x;
      last.y = feet.y;
      const region = this.deps.gameMap.regionAt(tileX, tileY);
      for (let i = 0; i < PAPER_PER_STEP; i++) {
        if (this.paper.length >= MAX_PAPER) break;
        if (countInRegion(this.paper, region) >= PAPER_PER_REGION) break;
        this.paper.push({
          x: feet.x,
          y: feet.y,
          groundY: feet.y,
          region,
          vx: (this.random() * 2 - 1) * PAPER_SIDE_SPEED,
          vy: -PAPER_LIFT_SPEED * (HALF + this.random() * HALF),
          angle: this.random() * TWO_PI,
          spin: (this.random() * 2 - 1) * PAPER_SPIN_MAX,
          frame: 0,
          shade: PAPER_SHADES[Math.floor(this.random() * PAPER_SHADES.length)],
        });
      }
      if (this.framesSinceRustle >= PAPER_RUSTLE_GAP_FRAMES) {
        this.framesSinceRustle = 0;
        this.deps.raiseCue('paperRustle', feet.x, feet.y, PAPER_RUSTLE_VOLUME);
      }
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private drawFlies(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    let drawn = 0;
    for (const site of this.flySites) {
      if (drawn >= MAX_FLY_SITES_DRAWN) break;
      const sx = site.x - camX;
      const sy = site.y - camY;
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > viewW + TILE_SIZE || sy > viewH + TILE_SIZE) {
        continue;
      }
      drawn++;
      for (let i = 0; i < FLIES_PER_SITE; i++) {
        const radius = FLY_ORBIT_MIN_PX + hash01(site.seed, i) * FLY_ORBIT_SPREAD_PX;
        const rate = FLY_RATE_MIN + hash01(site.seed, i + FLIES_PER_SITE) * FLY_RATE_SPREAD;
        const phase = hash01(site.seed, i + 2 * FLIES_PER_SITE) * TWO_PI;
        const t = this.frame * rate + phase;
        const fx = sx + Math.cos(t) * radius;
        const fy =
          sy -
          FLY_HOVER_PX +
          Math.sin(t * FLY_ORBIT_WOBBLE) * radius * FLY_ORBIT_FLATTEN +
          Math.sin(t * FLY_BOB_RATE) * FLY_BOB_PX;
        ctx.fillStyle = FLY_WING_COLOUR;
        ctx.fillRect(
          fx - FLY_WING_PX,
          fy - FLY_WING_PX * HALF,
          FLY_WING_PX * 2,
          FLY_WING_PX * HALF,
        );
        ctx.fillStyle = FLY_COLOUR;
        ctx.fillRect(fx - FLY_SIZE_PX * HALF, fy - FLY_SIZE_PX * HALF, FLY_SIZE_PX, FLY_SIZE_PX);
      }
    }
  }

  /** Keeps the {@link MAX_MOTE_POOLS} shining pools nearest the view's centre, in reused arrays. */
  private pickMotePools(camX: number, camY: number, viewW: number, viewH: number): void {
    const lights = this.deps.lights;
    const pools = this.nearestPools;
    const distances = this.nearestPoolDistances;
    pools.length = 0;
    distances.length = 0;
    if (lights === null) return;
    const centreX = camX + viewW * HALF;
    const centreY = camY + viewH * HALF;
    for (const pool of this.motePools) {
      const sx = pool.x - camX;
      const sy = pool.y - camY;
      if (sx < 0 || sy < 0 || sx > viewW || sy > viewH) continue;
      if (!lights.isShiningAt(pool.lightX, pool.lightY)) continue;
      const distance = Math.hypot(pool.x - centreX, pool.y - centreY);
      let at = pools.length;
      while (at > 0 && distances[at - 1] > distance) at--;
      if (at >= MAX_MOTE_POOLS) continue;
      pools.splice(at, 0, pool);
      distances.splice(at, 0, distance);
      if (pools.length > MAX_MOTE_POOLS) {
        pools.length = MAX_MOTE_POOLS;
        distances.length = MAX_MOTE_POOLS;
      }
    }
  }

  private drawMotes(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    const lights = this.deps.lights;
    if (lights === null || this.motePools.length === 0) return;
    this.pickMotePools(camX, camY, viewW, viewH);
    const spreadSpan = MOTE_SPREAD_PX * 2;
    ctx.save();
    for (const pool of this.nearestPools) {
      ctx.fillStyle = pool.colour;
      for (let i = 0; i < MOTES_PER_POOL; i++) {
        const baseX = (hash01(pool.seed, i) - HALF) * spreadSpan;
        const rise =
          (hash01(pool.seed, i + MOTES_PER_POOL) * spreadSpan +
            this.frame * MOTE_RISE_PX_PER_FRAME) %
          spreadSpan;
        const drift = Math.sin(this.frame * MOTE_DRIFT_RATE + hash01(pool.seed, i) * TWO_PI);
        const wx = pool.x + baseX + drift * MOTE_DRIFT_PX;
        const wy = pool.y + MOTE_SPREAD_PX - rise;
        const light = lights.staticLightAt(Math.floor(wx / TILE_SIZE), Math.floor(wy / TILE_SIZE));
        if (light < MOTE_MIN_LIGHT) continue;
        // Motes fade in at the bottom of their rise and out at the top, so
        // the wrap back to the bottom is never seen.
        const lifeShare = rise / spreadSpan;
        ctx.globalAlpha = MOTE_MAX_ALPHA * Math.sin(lifeShare * Math.PI) * light;
        ctx.fillRect(wx - camX, wy - camY, MOTE_SIZE_PX, MOTE_SIZE_PX);
      }
    }
    ctx.restore();
  }

  private drawPaper(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const scrap of this.paper) {
      const fade = 1 - scrap.frame / PAPER_LIFE_FRAMES;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 2);
      ctx.translate(scrap.x - camX, scrap.y - camY);
      ctx.rotate(scrap.angle);
      ctx.fillStyle = scrap.shade;
      ctx.fillRect(-PAPER_W_PX * HALF, -PAPER_H_PX * HALF, PAPER_W_PX, PAPER_H_PX);
      ctx.restore();
    }
  }
}

/** Writes a walker's centre into `out`, without allocating. */
function writeCentre(walker: Walker, out: Mark): void {
  out.x = walker.x + TILE_SIZE * HALF;
  out.y = walker.y + TILE_SIZE * HALF;
}

function countInRegion(list: ReadonlyArray<{ readonly region: number }>, region: number): number {
  let count = 0;
  for (const item of list) if (item.region === region) count++;
  return count;
}

/**
 * One ring on water, `share` of the way through its life, in the stroke
 * colour already set: a flat ellipse that widens and fades.
 */
function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, share: number): void {
  if (share < 0 || share >= 1) return;
  const radius = RING_START_RADIUS_PX + RING_GROWTH_PX * share;
  ctx.globalAlpha = RING_START_ALPHA * (1 - share);
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * RING_FLATTEN, 0, 0, TWO_PI);
  ctx.stroke();
}
