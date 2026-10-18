/**
 * The live part of the spider lab's approach: sheets of silk curtained wall to
 * wall overhead, the wrapped bodies and hung prey at the lane's edges, and a
 * few silk motes; and what the hallways sound like — their bed, the odd strand
 * creaking overhead, a pile of eggshell crunching underfoot near the lab, and
 * the dying tube's stutter in time with its light.
 *
 * Everything static about the approach is baked into the floor and wall
 * chunks (`labHallwayDecor.ts`); this draws only while the approach is in
 * view and only what must sit over a crawler or move. The curtains are
 * opaque only where they meet the walls and thin to a veil across the lane,
 * so a crawler under one always reads. The station between the hallways is
 * held ground: no bed, no creaks.
 */

import { TILE_SIZE } from '../../core/constants';
import type { AudioManager } from '../../audio/AudioManager';
import type { AudioScope } from '../../audio/AudioScope';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import type { GameMap } from '../../map/GameMap';
import { labApproachZoneAt } from '../../map/labApproach';
import {
  labHallwayDecorOf,
  type CocoonSize,
  type DecorPoint,
  type HangingPrey,
  type HungCocoon,
  type LabHallwayDecor,
  type OverheadWeb,
} from '../../map/dungeon/labHallwayDecor';
import type { WallFixture } from '../../map/dungeon/wallFixtures';
import { mulberry32 } from '../../sprites/person/rng';
import type { TownPropRenderable } from '../townPropRenderable';
import { playSpiderQuestCueAt, spiderQuestLoop, type SpiderQuestCue } from './spiderQuestSoundCues';

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

const FRAMES_PER_SECOND = 60;
const HALF = 0.5;
const TWO_PI = Math.PI * 2;

// ── Sheet webs ───────────────────────────────────────────────────────────────

const SILK_RGB = '236,234,224';
/** Below this a web is still gossamer: a few fine threads, not yet a sheet. */
const GOSSAMER_DECAY = 0.2;
const GOSSAMER_ALPHA = 0.35;
/** Below this a site hangs one sheet; layers start only where the nest proper begins. */
const LAYERED_DECAY = 0.5;
/** Sheets hung one behind another at a site: more of them the nearer the lab. */
const CURTAIN_EXTRA_LAYERS = 2;
/** How far apart the layers of one site hang along the run, in tiles. */
const CURTAIN_LAYER_GAP_TILES = 0.6;
/** How far one end of a sheet may be fixed along the run from the other, so it hangs aslant. */
const CURTAIN_SKEW_TILES = 0.7;
/** How far across the run a sheet spreads either side of its line, in tiles. */
const CURTAIN_MIN_SPREAD_TILES = 0.3;
const CURTAIN_SPREAD_DECAY_TILES = 0.35;
const CURTAIN_MIN_SAG_TILES = 0.05;
const CURTAIN_SAG_SPREAD_TILES = 0.45;
/** Where along each wall the sheet is fixed: a few points, more toward the lab. */
const MESH_MIN_ANCHORS = 2;
const MESH_DECAY_ANCHORS = 2;
/** Knots the silk is gathered into between the walls, scattered over the sheet. */
const MESH_MIN_KNOTS = 6;
const MESH_DECAY_KNOTS = 8;
/** Knots keep this far in from both walls, as a share of the span. */
const MESH_KNOT_MARGIN = 0.08;
/** Each knot is tied to this many of its nearest neighbours, whichever way they lie. */
const MESH_TIES = 3;
/** Thick cables strung wall to wall through a run of knots, which the mesh hangs from. */
const MESH_CABLES = 2;
const MESH_CABLE_STOPS = [{ along: 0.33 }, { along: 0.66 }] as const;
/** Film slung between a knot and its two nearest neighbours, catching the light unevenly. */
const MESH_MIN_FILMS = 2;
const MESH_DECAY_FILMS = 4;
const MESH_FILM_MIN_SHARE = 0.35;
const MESH_FILM_SPREAD_SHARE = 0.45;
const MESH_KNOT_RADIUS_PX = 1.2;
/** How far a strand droops at its middle, as a share of its length, and at most. */
const STRAND_MIN_DROOP_SHARE = 0.06;
const STRAND_DROOP_SPREAD_SHARE = 0.34;
/** Rates the slack is read off a strand's ends at: any pair that does not repeat over a tile. */
const STRAND_SLACK_RATE_X = 0.37;
const STRAND_SLACK_RATE_Y = 0.53;
const STRAND_MAX_DROOP_TILES = 0.6;
const STRAND_MAX_DROOP_PX = TILE_SIZE * STRAND_MAX_DROOP_TILES;
/** Below this a strand's square is too near level for it to sag down the screen. */
const STEEP_STRAND_NORMAL = 0.35;
/** Where along the span an orb may be spun: near each wall, where the silk is dense. */
const ORB_ENDS = [{ t: 0.1 }, { t: 0.9 }] as const;
const ORB_CHANCE = 0.6;
/** How far across the sheet an orb's hub may sit off its middle, as a share of the spread. */
const ORB_ACROSS_SHARE = 0.6;
const ORB_MIN_RADIUS_TILES = 0.3;
const ORB_RADIUS_SPREAD_TILES = 0.25;
const ORB_MIN_SPOKES = 7;
const ORB_SPOKE_SPREAD = 3;
const ORB_ANGLE_JITTER = 0.3;
const ORB_MIN_REACH_SHARE = 0.7;
const ORB_RINGS = [{ share: 0.3 }, { share: 0.5 }, { share: 0.7 }, { share: 0.9 }] as const;
/** A tie shorter than this would only crowd a knot into a starburst. */
const MESH_MIN_TIE_TILES = 0.35;
const FILM_CORNERS = 3;
const GOSSAMER_TIES = 1;
const CURTAIN_TENDRILS = 3;
const CURTAIN_MIN_TENDRIL_TILES = 0.2;
const CURTAIN_TENDRIL_SPREAD_TILES = 0.4;
/** Where a sheet meets the walls its silk is dense enough to be near-opaque. */
const CURTAIN_WALL_ALPHA = 0.6;
/** Across the lane it thins to wisps, so a crawler under it always reads. */
const CURTAIN_LANE_MIN_ALPHA = 0.14;
const CURTAIN_LANE_DECAY_ALPHA = 0.1;
/** Film over the lane is barely there; at the walls it is near the threads' own weight. */
const FILM_WALL_ALPHA = 0.3;
const FILM_LANE_ALPHA = 0;
/** The share of the span at each end that stays dense before the wisps. */
const CURTAIN_WALL_SHARE = 0.12;
const CURTAIN_VEIL_SHARE = 0.28;
const CURTAIN_CABLE_WIDTH_PX = 1.6;
/** How far round a sheet's anchors its silk may reach, in pixels, for the view cull. */
const CURTAIN_CULL_MARGIN_PX = TILE_SIZE * 2;

interface Curtain {
  /** Every point the sheet reaches, for the view cull. */
  readonly outline: ReadonlyArray<DecorPoint>;
  readonly cables: ReadonlyArray<ReadonlyArray<DecorPoint>>;
  readonly strands: ReadonlyArray<readonly [DecorPoint, DecorPoint]>;
  readonly films: ReadonlyArray<readonly [DecorPoint, DecorPoint, DecorPoint]>;
  readonly knots: ReadonlyArray<DecorPoint>;
  readonly from: DecorPoint;
  readonly to: DecorPoint;
  readonly laneAlpha: number;
  readonly gossamer: boolean;
  /** Built on the first draw, in world space, and kept. */
  silk: CanvasGradient | null;
  film: CanvasGradient | null;
}

interface CurtainSite {
  readonly curtains: ReadonlyArray<Curtain>;
  readonly centre: DecorPoint;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// ── Wrapped bodies and prey ──────────────────────────────────────────────────

/** How big each size of wrapped body is drawn, as a share of the cocoon sprite's tile. */
const COCOON_SCALE = {
  husk: 0.65,
  body: 1,
  human: 1.55,
} as const satisfies Record<CocoonSize, number>;
/** A cocoon twitches for a beat once in about this many seconds. */
const COCOON_TWITCH_PERIOD_S = 7;
const COCOON_TWITCH_FRAMES = 18;
const COCOON_IDLE_FRAME = 0;
const COCOON_TWITCH_FRAME = 1;
/** How high above its tile's top the cocoon's strand is tied, in tiles. */
const STRAND_TIE_TILES = 1.4;
const STRAND_WIDTH_PX = 1.5;
const STRAND_ALPHA = 0.7;
/** How tall the cocoon's art stands above the foot of its tile, in tiles of its own size. */
const COCOON_DRAWN_HEIGHT = 1.38;
/** How far into the cocoon's top its strand runs, in tiles of its own size. */
const COCOON_STRAND_OVERLAP = 0.08;
const PREY_HANG_TILES = 0.7;
const PREY_RX_TILES = 0.13;
const PREY_RY_TILES = 0.22;
const PREY_WRAPS = 4;
const PREY_SWAY_PX = 1.5;
const PREY_SWAY_RATE = 0.03;
const PREY_LIMB_TILES = 0.14;
const PREY_SHADOW_RX_TILES = 0.18;
const PREY_SHADOW_RY_TILES = 0.06;
const PREY_SILK = 'rgba(234,232,222,0.95)';
const PREY_WRAP = 'rgba(140,138,128,0.8)';
const PREY_LIMB = 'rgba(96,74,60,0.9)';
const PREY_SHADOW = 'rgba(0,0,0,0.28)';
/** How many pixels a hung thing's art reaches past its anchor, for the Y-sort's cull. */
const HUNG_CULL_MARGIN_TILES = 3;

// ── Motes ────────────────────────────────────────────────────────────────────

const MOTE_COUNT = 8;
/** Rows below a tube's face tile its light pools on: past the face's own foot. */
const TUBE_POOL_ROWS_BELOW_FACE = 2;
/** How far below a web, in tiles, its motes drift: down where a crawler walks under it. */
const WEB_MOTE_DROP_TILES = 1;
const MOTE_RISE_FRAMES = 420;
const MOTE_RISE_TILES = 1.2;
const MOTE_RISE_PX = TILE_SIZE * MOTE_RISE_TILES;
const MOTE_DRIFT_PX = 5;
const MOTE_DRIFT_RATE = 0.02;
const MOTE_SPREAD_TILES = 1.5;
const MOTE_ALPHA = 0.55;
const MOTE_SIZE_PX = 1;

interface Mote {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
}

// ── Sound ────────────────────────────────────────────────────────────────────

const CREAK_GAP_MIN_S = 8;
const CREAK_GAP_MAX_S = 20;
/** A creak comes from a web this close to the listener, in tiles, or none plays. */
const CREAK_REACH_TILES = 9;
const CREAK_VOLUME = 0.55;
/** A pile of eggshell is stepped in within this many tiles of its middle. */
const SHARD_PILE_REACH_TILES = 0.6;
/** Never two crunches closer together than this, however many piles are crossed. */
const CRUNCH_MIN_GAP_S = 6;
const CRUNCH_MIN_GAP_FRAMES = CRUNCH_MIN_GAP_S * FRAMES_PER_SECOND;
const CRUNCH_VOLUME = 0.5;
/** The tube is heard stuttering from this far, in tiles. */
const TUBE_EARSHOT_TILES = 12;
const TUBE_MIN_GAP_FRAMES = 30;
const TUBE_VOLUME = 0.6;

export interface LabHallwayAtmosphereDeps {
  readonly gameMap: GameMap;
  readonly audio: AudioManager | null;
  readonly audioScope: AudioScope | null;
  /** Whether a static light is giving light this instant; null where nothing is lit. */
  readonly lights: { isShiningAt(tileX: number, tileY: number): boolean } | null;
  readonly random?: () => number;
}

/** What the atmosphere needs of the frame. */
export interface LabHallwayFrame {
  /** The controlled crawler's centre, in world pixels. */
  readonly listenerX: number;
  readonly listenerY: number;
}

export class LabHallwayAtmosphere {
  private readonly sites: ReadonlyArray<CurtainSite>;
  private readonly motes: ReadonlyArray<Mote>;
  private readonly tube: WallFixture | null;
  private readonly random: () => number;
  private readonly hallwayBed = spiderQuestLoop('hallwayBed');
  private readonly hungRenderables: ReadonlyArray<TownPropRenderable>;
  private frame = 0;
  private bedOn = false;
  private framesToCreak: number;
  private framesSinceCrunch = CRUNCH_MIN_GAP_FRAMES;
  private framesSinceFlicker = TUBE_MIN_GAP_FRAMES;
  private tubeWasShining = true;
  private controlled: object | null = null;
  /** The pile of eggshell the listener stands in, by index, or null. */
  private inPile: number | null = null;

  /** The approach's atmosphere, or null on a floor with no lab. */
  static forMap(deps: LabHallwayAtmosphereDeps): LabHallwayAtmosphere | null {
    const decor = labHallwayDecorOf(deps.gameMap.structure);
    return decor === undefined ? null : new LabHallwayAtmosphere(deps, decor);
  }

  private constructor(
    private readonly deps: LabHallwayAtmosphereDeps,
    private readonly decor: LabHallwayDecor,
  ) {
    this.random = deps.random ?? Math.random;
    this.sites = decor.overheadWebs.map(buildCurtainSite);
    this.tube = deps.gameMap.wallFixtures.find((fixture) => fixture.dying) ?? null;
    this.motes = buildMotes(decor, this.tube);
    this.framesToCreak = this.nextCreakGap();
    this.hungRenderables = [
      ...decor.cocoons.map((cocoon, index) => this.cocoonRenderable(cocoon, index)),
      ...decor.hangingPrey.map((prey) => this.preyRenderable(prey)),
    ];
  }

  /**
   * The wrapped bodies and hung prey, for the Y-sorted pass: they are solid,
   * and a crawler north of one is drawn behind it.
   */
  sortedRenderables(): ReadonlyArray<TownPropRenderable> {
    return this.hungRenderables;
  }

  /** `controlled` is the crawler the player is driving, whose footfalls are heard. */
  update(frame: LabHallwayFrame, controlled: object): void {
    this.frame++;
    this.framesSinceCrunch++;
    this.framesSinceFlicker++;
    const swapped = controlled !== this.controlled;
    this.controlled = controlled;
    const tileX = Math.floor(frame.listenerX / TILE_SIZE);
    const tileY = Math.floor(frame.listenerY / TILE_SIZE);
    const zone = labApproachZoneAt(this.decor.lab, tileX, tileY);
    const inHallway = zone === 'outer_hallway' || zone === 'inner_hallway';
    this.setBed(inHallway);
    this.listenToTube(frame);
    this.crunchIfStepping(frame, zone === 'inner_hallway', swapped);
    if (!inHallway) return;
    this.framesToCreak--;
    if (this.framesToCreak <= 0) {
      this.framesToCreak = this.nextCreakGap();
      this.creakNear(frame.listenerX, frame.listenerY);
    }
  }

  /**
   * An end screen, under which gameplay stops ticking this: the bed stops now
   * rather than holding behind the screen, and the next update picks it up.
   */
  silence(): void {
    this.setBed(false);
  }

  dispose(): void {
    this.setBed(false);
  }

  /** The curtains and motes over the bodies, when the approach is in view. */
  render(ctx: Ctx, camX: number, camY: number, viewW: number, viewH: number): void {
    const { bounds } = this.decor;
    const left = bounds.x * TILE_SIZE;
    const top = bounds.y * TILE_SIZE;
    const outOfView =
      left > camX + viewW ||
      top > camY + viewH ||
      left + bounds.w * TILE_SIZE < camX ||
      top + bounds.h * TILE_SIZE < camY;
    if (outOfView) return;
    ctx.save();
    ctx.translate(-camX, -camY);
    for (const site of this.sites) {
      const visible =
        site.maxX + CURTAIN_CULL_MARGIN_PX >= camX &&
        site.minX - CURTAIN_CULL_MARGIN_PX <= camX + viewW &&
        site.maxY + CURTAIN_CULL_MARGIN_PX >= camY &&
        site.minY - CURTAIN_CULL_MARGIN_PX <= camY + viewH;
      if (!visible) continue;
      for (const curtain of site.curtains) drawCurtain(ctx, curtain);
    }
    ctx.restore();
    this.renderMotes(ctx, camX, camY, viewW, viewH);
  }

  private cocoonRenderable(cocoon: HungCocoon, index: number): TownPropRenderable {
    return {
      x: cocoon.x * TILE_SIZE,
      y: cocoon.y * TILE_SIZE,
      cullMarginTiles: HUNG_CULL_MARGIN_TILES,
      render: (ctx, camX, camY, tileSize) =>
        this.drawCocoon(ctx, cocoon, index, camX, camY, tileSize),
    };
  }

  private preyRenderable(prey: HangingPrey): TownPropRenderable {
    return {
      x: Math.floor(prey.at.x) * TILE_SIZE,
      y: Math.floor(prey.at.y) * TILE_SIZE,
      cullMarginTiles: HUNG_CULL_MARGIN_TILES,
      render: (ctx, camX, camY, tileSize) => this.drawPrey(ctx, prey, camX, camY, tileSize),
    };
  }

  private drawCocoon(
    ctx: Ctx,
    cocoon: HungCocoon,
    index: number,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const period = COCOON_TWITCH_PERIOD_S * FRAMES_PER_SECOND;
    const beat = (this.frame + index * Math.floor(period * HALF)) % period;
    const frame = beat < COCOON_TWITCH_FRAMES ? COCOON_TWITCH_FRAME : COCOON_IDLE_FRAME;
    const size = tileSize * COCOON_SCALE[cocoon.size];
    // Scaled about the foot of its own tile, so a bigger one stands where a small one would.
    const footX = (cocoon.x + HALF) * tileSize - camX;
    const footY = (cocoon.y + 1) * tileSize - camY;
    const left = footX - size * HALF;
    const top = footY - size;
    const crown = footY - size * COCOON_DRAWN_HEIGHT;
    drawStrand(
      ctx,
      footX,
      crown - STRAND_TIE_TILES * tileSize,
      crown + size * COCOON_STRAND_OVERLAP,
    );
    drawSpriteKey(ctx, 'spider_lab_cocoon', 'idle', frame, left, top, size);
  }

  private drawPrey(
    ctx: Ctx,
    prey: HangingPrey,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const rand = mulberry32(prey.seed);
    const phase = rand() * TWO_PI;
    const sway = Math.sin(this.frame * PREY_SWAY_RATE + phase) * PREY_SWAY_PX;
    const footX = prey.at.x * tileSize - camX;
    const footY = prey.at.y * tileSize - camY;
    const bundleX = footX + sway;
    const bundleY = footY - PREY_HANG_TILES * tileSize;
    const rx = PREY_RX_TILES * tileSize;
    const ry = PREY_RY_TILES * tileSize;
    ctx.fillStyle = PREY_SHADOW;
    ctx.beginPath();
    ctx.ellipse(
      footX,
      footY,
      PREY_SHADOW_RX_TILES * tileSize,
      PREY_SHADOW_RY_TILES * tileSize,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    drawStrand(ctx, bundleX, footY - (PREY_HANG_TILES + STRAND_TIE_TILES) * tileSize, bundleY - ry);
    ctx.strokeStyle = PREY_LIMB;
    ctx.lineWidth = STRAND_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(bundleX + rx * HALF, bundleY + ry * HALF);
    ctx.lineTo(
      bundleX + rx + PREY_LIMB_TILES * tileSize * HALF,
      bundleY + ry + PREY_LIMB_TILES * tileSize,
    );
    ctx.stroke();
    ctx.fillStyle = PREY_SILK;
    ctx.beginPath();
    ctx.ellipse(bundleX, bundleY, rx, ry, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = PREY_WRAP;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wrap = 0; wrap < PREY_WRAPS; wrap++) {
      const y = bundleY - ry + ((wrap + HALF) / PREY_WRAPS) * ry * 2;
      ctx.moveTo(bundleX - rx, y - ry * HALF * HALF);
      ctx.lineTo(bundleX + rx, y + ry * HALF * HALF);
    }
    ctx.stroke();
  }

  private renderMotes(ctx: Ctx, camX: number, camY: number, viewW: number, viewH: number): void {
    ctx.fillStyle = `rgba(${SILK_RGB},${MOTE_ALPHA})`;
    for (const mote of this.motes) {
      const life =
        ((this.frame + mote.phase * MOTE_RISE_FRAMES) % MOTE_RISE_FRAMES) / MOTE_RISE_FRAMES;
      const x =
        mote.x +
        Math.sin(this.frame * MOTE_DRIFT_RATE + mote.phase * TWO_PI) * MOTE_DRIFT_PX -
        camX;
      const y = mote.y - life * MOTE_RISE_PX - camY;
      if (x < 0 || y < 0 || x > viewW || y > viewH) continue;
      // Fades in and out over its rise, so none pops into being.
      ctx.globalAlpha = Math.sin(life * Math.PI);
      ctx.fillRect(x, y, MOTE_SIZE_PX, MOTE_SIZE_PX);
    }
    ctx.globalAlpha = 1;
  }

  private setBed(on: boolean): void {
    if (on === this.bedOn) return;
    this.bedOn = on;
    const { audioScope } = this.deps;
    if (audioScope === null || this.hallwayBed === null) return;
    if (on) audioScope.startLoop(this.hallwayBed);
    else audioScope.stopLoop(this.hallwayBed);
  }

  private play(cue: SpiderQuestCue, worldX: number, worldY: number, volume: number): void {
    playSpiderQuestCueAt(this.deps.audio, cue, worldX, worldY, { volume });
  }

  private nextCreakGap(): number {
    const seconds = CREAK_GAP_MIN_S + this.random() * (CREAK_GAP_MAX_S - CREAK_GAP_MIN_S);
    return Math.round(seconds * FRAMES_PER_SECOND);
  }

  private creakNear(worldX: number, worldY: number): void {
    const reach = CREAK_REACH_TILES * TILE_SIZE;
    const near = this.sites.filter(
      (site) => Math.hypot(site.centre.x - worldX, site.centre.y - worldY) <= reach,
    );
    if (near.length === 0) return;
    const site = near[Math.floor(this.random() * near.length)];
    this.play('webCreak', site.centre.x, site.centre.y, CREAK_VOLUME);
  }

  /**
   * One crunch as the listener walks into a pile of eggshell in the inner
   * hallway, and no more until they have left it, nor for some seconds after.
   * A swap of crawlers is no step: the new one's pile is noted, not crunched.
   */
  private crunchIfStepping(
    frame: LabHallwayFrame,
    inInnerHallway: boolean,
    swapped: boolean,
  ): void {
    const reach = SHARD_PILE_REACH_TILES * TILE_SIZE;
    const pile = this.decor.shardPiles.findIndex(
      (at) =>
        Math.hypot(at.x * TILE_SIZE - frame.listenerX, at.y * TILE_SIZE - frame.listenerY) <= reach,
    );
    const here = pile < 0 || !inInnerHallway ? null : pile;
    const entered = here !== null && here !== this.inPile;
    this.inPile = here;
    if (!entered || swapped || this.framesSinceCrunch < CRUNCH_MIN_GAP_FRAMES) return;
    this.framesSinceCrunch = 0;
    this.play('eggshellCrunch', frame.listenerX, frame.listenerY, CRUNCH_VOLUME);
  }

  /** The tube's stutter, played the moment its light cuts out, from the tube. */
  private listenToTube(frame: LabHallwayFrame): void {
    const tube = this.tube;
    const lights = this.deps.lights;
    if (tube === null || lights === null) return;
    const shining = lights.isShiningAt(tube.tileX, tube.tileY);
    const cutOut = this.tubeWasShining && !shining;
    this.tubeWasShining = shining;
    if (!cutOut || tube.state.broken || this.framesSinceFlicker < TUBE_MIN_GAP_FRAMES) return;
    const tubeX = (tube.tileX + HALF) * TILE_SIZE;
    const tubeY = (tube.tileY + 1) * TILE_SIZE;
    const earshot = TUBE_EARSHOT_TILES * TILE_SIZE;
    if (Math.hypot(tubeX - frame.listenerX, tubeY - frame.listenerY) > earshot) return;
    this.framesSinceFlicker = 0;
    this.play('tubeFlicker', tubeX, tubeY, TUBE_VOLUME);
  }
}

/** A strand of silk straight down from where it is tied to the thing it holds, in screen pixels. */
function drawStrand(ctx: Ctx, x: number, fromY: number, toY: number): void {
  ctx.strokeStyle = `rgba(${SILK_RGB},${STRAND_ALPHA})`;
  ctx.lineWidth = STRAND_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(x, fromY);
  ctx.lineTo(x, toY);
  ctx.stroke();
}

/** Every sheet hung at one web's site, in world pixels, decided once. */
function buildCurtainSite(web: OverheadWeb): CurtainSite {
  const rand = mulberry32(web.seed);
  const a = { x: web.from.x * TILE_SIZE, y: web.from.y * TILE_SIZE };
  const b = { x: web.to.x * TILE_SIZE, y: web.to.y * TILE_SIZE };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // Along the run: square to the span.
  const runX = -dy / length;
  const runY = dx / length;
  // A sheet bellies down the screen across a run going north-south, and to
  // one side, the same for the whole site, across one going east-west, where
  // a downward sag would only run along the span.
  const side = Math.abs(runY) > Math.abs(runX) ? Math.sign(runY) : rand() < HALF ? -1 : 1;
  const belly = { x: runX * side, y: runY * side };
  const run = { x: runX, y: runY };
  const gossamer = web.decay < GOSSAMER_DECAY;
  const layers = web.decay >= LAYERED_DECAY ? 1 + Math.round(CURTAIN_EXTRA_LAYERS * web.decay) : 1;
  const curtains: Curtain[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const shift = (layer - (layers - 1) * HALF + (rand() - HALF) * HALF) * CURTAIN_LAYER_GAP_TILES;
    const skew = (rand() - HALF) * CURTAIN_SKEW_TILES;
    const along = (offset: number): DecorPoint => ({
      x: run.x * offset * TILE_SIZE,
      y: run.y * offset * TILE_SIZE,
    });
    const fromShift = along(shift - skew * HALF);
    const toShift = along(shift + skew * HALF);
    const from = { x: a.x + fromShift.x, y: a.y + fromShift.y };
    const to = { x: b.x + toShift.x, y: b.y + toShift.y };
    curtains.push(buildCurtain(from, to, run, belly, web.decay, layers, gossamer, rand));
  }
  const all = curtains.flatMap((curtain) => curtain.outline);
  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  return {
    curtains,
    centre: { x: (a.x + b.x) * HALF, y: (a.y + b.y) * HALF },
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * One sheet web: a tangle, not a fringe. Knots scattered over the sheet and
 * tied to their nearest neighbours whichever way those lie, a few thick
 * cables strung wall to wall through them at their own slopes, and film slung
 * unevenly between knots. Tattered tendrils hang off its lowest knots.
 */
function buildCurtain(
  from: DecorPoint,
  to: DecorPoint,
  run: DecorPoint,
  belly: DecorPoint,
  decay: number,
  layers: number,
  gossamer: boolean,
  rand: Rand,
): Curtain {
  const spread = (CURTAIN_MIN_SPREAD_TILES + CURTAIN_SPREAD_DECAY_TILES * decay) * TILE_SIZE;
  const at = (t: number, across: number, sag: number): DecorPoint => {
    const bow = Math.sin(t * Math.PI) * sag;
    return {
      x: from.x + (to.x - from.x) * t + run.x * across * spread + belly.x * bow,
      y: from.y + (to.y - from.y) * t + run.y * across * spread + belly.y * bow,
    };
  };
  const sag = (): number => (CURTAIN_MIN_SAG_TILES + rand() * CURTAIN_SAG_SPREAD_TILES) * TILE_SIZE;
  const across = (): number => (rand() - HALF) * 2;
  const anchorCount = MESH_MIN_ANCHORS + Math.round(MESH_DECAY_ANCHORS * decay);
  const fromAnchors = Array.from({ length: anchorCount }, () => at(0, across(), 0));
  const toAnchors = Array.from({ length: anchorCount }, () => at(1, across(), 0));
  const knotCount = gossamer
    ? MESH_MIN_KNOTS
    : MESH_MIN_KNOTS + Math.round(MESH_DECAY_KNOTS * decay);
  const knotSpan = 1 - MESH_KNOT_MARGIN * 2;
  const knots = Array.from({ length: knotCount }, () =>
    at(MESH_KNOT_MARGIN + rand() * knotSpan, across(), sag()),
  );
  const nodes = [...fromAnchors, ...knots, ...toAnchors];
  const nearest = (point: DecorPoint, count: number): DecorPoint[] =>
    nodes
      .filter((other) => other !== point)
      .sort(
        (a, b) =>
          Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y),
      )
      .slice(0, count);
  const strands: Array<readonly [DecorPoint, DecorPoint]> = [];
  const ties = gossamer ? GOSSAMER_TIES : MESH_TIES;
  for (const knot of knots) {
    const farEnough = nodes.filter(
      (other) => Math.hypot(other.x - knot.x, other.y - knot.y) >= MESH_MIN_TIE_TILES * TILE_SIZE,
    );
    const byDistance = farEnough.sort(
      (a, b) => Math.hypot(a.x - knot.x, a.y - knot.y) - Math.hypot(b.x - knot.x, b.y - knot.y),
    );
    for (const other of byDistance.slice(0, ties)) strands.push([knot, other]);
  }
  const cables: DecorPoint[][] = [];
  for (let cable = 0; cable < (gossamer ? 1 : MESH_CABLES); cable++) {
    const start = fromAnchors[Math.floor(rand() * fromAnchors.length)];
    const end = toAnchors[Math.floor(rand() * toAnchors.length)];
    const path: DecorPoint[] = [start];
    for (const { along } of MESH_CABLE_STOPS) {
      const target = {
        x: start.x + (end.x - start.x) * along,
        y: start.y + (end.y - start.y) * along,
      };
      const stop = nearest(target, 1)[0];
      if (!path.includes(stop)) path.push(stop);
    }
    path.push(end);
    cables.push(path);
  }
  const films: Array<readonly [DecorPoint, DecorPoint, DecorPoint]> = [];
  const filmCount = gossamer ? 0 : MESH_MIN_FILMS + Math.round(MESH_DECAY_FILMS * decay);
  for (let film = 0; film < filmCount && knots.length > 0; film++) {
    const knot = knots[Math.floor(rand() * knots.length)];
    const [first, second] = nearest(knot, 2);
    // Shrunk toward its own middle by a different amount each, so no two
    // films are the same weight or shape.
    const shrink = MESH_FILM_MIN_SHARE + rand() * MESH_FILM_SPREAD_SHARE;
    const middle = {
      x: (knot.x + first.x + second.x) / FILM_CORNERS,
      y: (knot.y + first.y + second.y) / FILM_CORNERS,
    };
    const pull = (point: DecorPoint): DecorPoint => ({
      x: middle.x + (point.x - middle.x) * shrink,
      y: middle.y + (point.y - middle.y) * shrink,
    });
    films.push([pull(knot), pull(first), pull(second)]);
  }
  if (!gossamer) {
    for (const end of ORB_ENDS) {
      if (rand() < ORB_CHANCE) spinOrb(at(end.t, across() * ORB_ACROSS_SHARE, 0), strands, rand);
    }
  }
  const lowestFirst = [...knots].sort(
    (a, b) => b.x * belly.x + b.y * belly.y - (a.x * belly.x + a.y * belly.y),
  );
  for (const hem of lowestFirst.slice(0, gossamer ? 0 : CURTAIN_TENDRILS)) {
    const drop = (CURTAIN_MIN_TENDRIL_TILES + rand() * CURTAIN_TENDRIL_SPREAD_TILES) * TILE_SIZE;
    strands.push([hem, { x: hem.x + (rand() - HALF) * drop * HALF, y: hem.y + drop }]);
  }
  return {
    outline: nodes,
    cables,
    strands,
    films,
    knots,
    from,
    to,
    // Shared between the layers of a site, so however many hang one behind
    // another the silk over the lane stays as thin as one heavy sheet.
    laneAlpha: (CURTAIN_LANE_MIN_ALPHA + CURTAIN_LANE_DECAY_ALPHA * decay) / layers,
    gossamer,
    silk: null,
    film: null,
  };
}

/**
 * An orb spun where the sheet meets a wall: spokes out from a hub at every
 * angle and a spiral of rings between them, each ring a little lopsided, so
 * the sheet reads as built by a spider rather than draped.
 */
function spinOrb(
  hub: DecorPoint,
  strands: Array<readonly [DecorPoint, DecorPoint]>,
  rand: Rand,
): void {
  const radius = (ORB_MIN_RADIUS_TILES + rand() * ORB_RADIUS_SPREAD_TILES) * TILE_SIZE;
  const spokes = ORB_MIN_SPOKES + Math.floor(rand() * (ORB_SPOKE_SPREAD + 1));
  const turn = rand() * TWO_PI;
  const tips: DecorPoint[] = [];
  for (let spoke = 0; spoke < spokes; spoke++) {
    const angle = turn + (spoke / spokes) * TWO_PI + (rand() - HALF) * ORB_ANGLE_JITTER;
    const reach = radius * (ORB_MIN_REACH_SHARE + rand() * (1 - ORB_MIN_REACH_SHARE));
    const tip = { x: hub.x + Math.cos(angle) * reach, y: hub.y + Math.sin(angle) * reach };
    tips.push(tip);
    strands.push([hub, tip]);
  }
  for (const { share } of ORB_RINGS) {
    const ring = tips.map((tip) => ({
      x: hub.x + (tip.x - hub.x) * share,
      y: hub.y + (tip.y - hub.y) * share,
    }));
    ring.forEach((point, index) => strands.push([point, ring[(index + 1) % ring.length]]));
  }
}

/** A gradient along a sheet's span: dense at both walls, thin over the lane. */
function spanGradient(
  ctx: Ctx,
  curtain: Curtain,
  wallAlpha: number,
  laneAlpha: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(
    curtain.from.x,
    curtain.from.y,
    curtain.to.x,
    curtain.to.y,
  );
  const wall = `rgba(${SILK_RGB},${wallAlpha})`;
  const lane = `rgba(${SILK_RGB},${laneAlpha})`;
  gradient.addColorStop(0, wall);
  gradient.addColorStop(CURTAIN_WALL_SHARE, wall);
  gradient.addColorStop(CURTAIN_VEIL_SHARE, lane);
  gradient.addColorStop(1 - CURTAIN_VEIL_SHARE, lane);
  gradient.addColorStop(1 - CURTAIN_WALL_SHARE, wall);
  gradient.addColorStop(1, wall);
  return gradient;
}

/** One sheet, in world space. */
function drawCurtain(ctx: Ctx, curtain: Curtain): void {
  if (curtain.gossamer) {
    ctx.strokeStyle = `rgba(${SILK_RGB},${GOSSAMER_ALPHA})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const cable of curtain.cables) traceSagging(ctx, cable);
    for (const [start, end] of curtain.strands) traceSagging(ctx, [start, end]);
    ctx.stroke();
    return;
  }
  curtain.film ??= spanGradient(ctx, curtain, FILM_WALL_ALPHA, FILM_LANE_ALPHA);
  curtain.silk ??= spanGradient(ctx, curtain, CURTAIN_WALL_ALPHA, curtain.laneAlpha);
  ctx.fillStyle = curtain.film;
  ctx.beginPath();
  for (const [a, b, c] of curtain.films) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = curtain.silk;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [start, end] of curtain.strands) traceSagging(ctx, [start, end]);
  ctx.stroke();
  ctx.lineWidth = CURTAIN_CABLE_WIDTH_PX;
  ctx.beginPath();
  for (const cable of curtain.cables) traceSagging(ctx, cable);
  ctx.stroke();
  ctx.fillStyle = curtain.silk;
  ctx.beginPath();
  for (const knot of curtain.knots) {
    ctx.moveTo(knot.x + MESH_KNOT_RADIUS_PX, knot.y);
    ctx.arc(knot.x, knot.y, MESH_KNOT_RADIUS_PX, 0, TWO_PI);
  }
  ctx.fill();
  ctx.lineCap = 'butt';
}

/**
 * A run of silk through `points`, each span bellied out square to itself by a
 * share of its length — toward the bottom of the screen where it can, and to
 * one side where the span itself runs up and down the screen — so no strand
 * is drawn ruler straight, whichever way it lies.
 */
function traceSagging(ctx: Ctx, points: ReadonlyArray<DecorPoint>): void {
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
      return;
    }
    const previous = points[index - 1];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    // Each strand sags its own amount, read off where it runs, so strands tied
    // to one knot fan out unevenly instead of in parallel combs.
    const slack =
      STRAND_MIN_DROOP_SHARE +
      STRAND_DROOP_SPREAD_SHARE *
        (HALF + HALF * Math.sin(previous.x * STRAND_SLACK_RATE_X + point.y * STRAND_SLACK_RATE_Y));
    const droop = Math.min(length * slack, STRAND_MAX_DROOP_PX);
    let normalX = -dy / length;
    let normalY = dx / length;
    const steep = Math.abs(normalY) < STEEP_STRAND_NORMAL;
    // A steep strand has no downhill to sag toward; which side it bellies to
    // is read off where it starts, so it never flickers between frames.
    const flip = steep ? Math.floor(previous.x + previous.y) % 2 === 0 : normalY < 0;
    if (flip) {
      normalX = -normalX;
      normalY = -normalY;
    }
    ctx.quadraticCurveTo(
      (previous.x + point.x) * HALF + normalX * droop,
      (previous.y + point.y) * HALF + normalY * droop,
      point.x,
      point.y,
    );
  });
}

/** A few motes round the dying tube's pool and the webs nearest the lab. */
function buildMotes(decor: LabHallwayDecor, tube: WallFixture | null): Mote[] {
  const rand = mulberry32(decor.bounds.x * decor.bounds.y + decor.overheadWebs.length);
  const centres: DecorPoint[] = [];
  if (tube !== null) {
    centres.push({ x: tube.tileX + HALF, y: tube.tileY + TUBE_POOL_ROWS_BELOW_FACE });
  }
  const byDecay = [...decor.overheadWebs].sort((a, b) => b.decay - a.decay);
  if (byDecay.length > 0) {
    const deepest = byDecay[0];
    centres.push({
      x: (deepest.from.x + deepest.to.x) * HALF,
      y: (deepest.from.y + deepest.to.y) * HALF + WEB_MOTE_DROP_TILES,
    });
  }
  if (centres.length === 0) return [];
  return Array.from({ length: MOTE_COUNT }, (_, index) => {
    const centre = centres[index % centres.length];
    return {
      x: (centre.x + (rand() - HALF) * 2 * MOTE_SPREAD_TILES) * TILE_SIZE,
      y: (centre.y + (rand() - HALF) * MOTE_SPREAD_TILES) * TILE_SIZE,
      phase: rand(),
    };
  });
}
