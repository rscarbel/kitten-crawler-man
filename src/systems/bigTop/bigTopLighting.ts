import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { perfMonitor } from '../../core/PerfMonitor';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import {
  MAZE_CURTAINS,
  MAZE_FINAL_CHAMBER,
  MAZE_HEIGHT,
  MAZE_PROJECTORS,
  MAZE_SECTIONS,
  MAZE_WIDTH,
  type MazeSectionId,
  type MazeTile,
} from '../../map/bigTopMazeLayout';
import { buildBigTopFloorIndex } from '../../map/bigTopMazeDecor';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';

/**
 * Stage lighting for the Big Top: the tent is dark, and the act being
 * performed is lit.
 *
 * Three layers, cheapest first:
 *
 *  - **The darkness mask**, painted once for the whole tent at a quarter of
 *    its resolution: each act's own tint of dark, with a soft pool cut out
 *    under every lamp the tent has. Darkness is soft, so a quarter is
 *    indistinguishable from full resolution, and one stretched blit of the
 *    part in view is the whole per-frame cost.
 *  - **The house board**: one translucent fill per band of rows that is not
 *    the act on stage — dark ahead, dimmed behind — faded over about a second
 *    when the curtain rises, so the act the party walks into comes up as they
 *    walk in and the act they left goes cold behind them.
 *  - **Live light**, additive, for the things that move or switch: vent flame,
 *    the lanterns' pools, the limelight beams, lit stars, the spill through an
 *    opened curtain and the follow-spot on Grimaldi.
 *
 * The whole of it sits over the floor and the room's furniture and under
 * every warning. Nothing a player reads to stay alive is ever drawn beneath
 * it.
 */

/** The mask is painted at this fraction of the tent's world resolution. */
export const BIG_TOP_MASK_SCALE = 0.25;
/**
 * A clear border round the mask, in mask pixels, that a blit never samples:
 * stretching a source rectangle that touches its image's edge makes a CPU
 * canvas pad the edge for every sample.
 */
export const BIG_TOP_MASK_PAD_PX = 2;
const BYTES_PER_PIXEL = 4;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Per-act darkness ────────────────────────────────────────────────────────

interface ActDark {
  /** The colour of the dark, as `r,g,b`. */
  readonly rgb: string;
  /** How much of the floor the dark covers where no lamp reaches. */
  readonly alpha: number;
}

/**
 * Each act's own dark: the fire walk warm from the embers, the menagerie cold
 * as a night yard, the hall of mirrors violet, and the ring deepest — a green
 * black, the colour of the thing coiled round its pole.
 */
const ACT_DARK: Readonly<Record<MazeSectionId, ActDark>> = {
  firewalk: { rgb: '22,8,2', alpha: 0.5 },
  menagerie: { rgb: '2,8,20', alpha: 0.52 },
  mirrors: { rgb: '12,3,22', alpha: 0.52 },
  finale: { rgb: '2,7,3', alpha: 0.6 },
};

// ── Lamps baked into the mask ───────────────────────────────────────────────

/** Every kind of lamp whose pool is baked into the dark. */
export type LightFixtureKind =
  'footlight' | 'archPost' | 'intervalLamp' | 'limelight' | 'actBoard' | 'hallLamp' | 'ringWash';

interface PoolSpec {
  readonly radiusTiles: number;
  /** How much of the dark the pool removes at its centre, 0 to 1. */
  readonly strength: number;
}

const POOL_SPECS: Readonly<Record<LightFixtureKind, PoolSpec>> = {
  footlight: { radiusTiles: 2.5, strength: 1 },
  archPost: { radiusTiles: 2.4, strength: 0.85 },
  intervalLamp: { radiusTiles: 3.4, strength: 0.9 },
  limelight: { radiusTiles: 3, strength: 0.85 },
  actBoard: { radiusTiles: 2, strength: 0.75 },
  hallLamp: { radiusTiles: 6, strength: 0.7 },
  ringWash: { radiusTiles: 8, strength: 0.7 },
};
/** How much of a pool's radius is lit at close to full strength before it fades. */
const POOL_CORE = 0.35;
/** How much of a pool's full cut is kept at the edge of its core. */
const POOL_CORE_KEEP = 0.85;

/** A lamp, and where on the floor its pool is centred, in tiles (fractional). */
export interface LightFixture {
  readonly kind: LightFixtureKind;
  readonly x: number;
  readonly y: number;
}

/** The centre of a tile, in tile units. */
function tileCentre(tile: MazeTile): { x: number; y: number } {
  return { x: tile.x + HALF, y: tile.y + HALF };
}

/**
 * The lamps the layout itself fixes: a limelight housing on each projector,
 * a lamp over every act board, a work light over each open hall — the
 * menagerie's practice rings and the mirror halls' floor cloths, which is
 * where a hall's middle is — and the wash over the ring. The maze adds the
 * ones its dressing places (footlights, arch posts, the interval lamps).
 */
export function layoutLightFixtures(): LightFixture[] {
  const fixtures: LightFixture[] = MAZE_PROJECTORS.map((projector) => ({
    kind: 'limelight' as const,
    ...tileCentre(projector.tile),
  }));
  for (const curtain of MAZE_CURTAINS) {
    // The board hangs on the dividing wall, which is the column the curtain
    // pair's window pierces.
    fixtures.push({
      kind: 'actBoard',
      ...tileCentre({ x: curtain.windowTile.x, y: curtain.humanBarrier.y }),
    });
  }
  const hallMarks = new Set(
    [...buildBigTopFloorIndex().values()]
      .flat()
      .filter((feature) => feature.kind === 'practiceRing' || feature.kind === 'harlequinCloth'),
  );
  for (const mark of hallMarks) {
    if (mark.kind === 'practiceRing') {
      fixtures.push({ kind: 'hallLamp', ...mark.centre });
    } else {
      fixtures.push({
        kind: 'hallLamp',
        x: (mark.rect.x0 + mark.rect.x1 + 1) / 2,
        y: (mark.rect.y0 + mark.rect.y1 + 1) / 2,
      });
    }
  }
  fixtures.push({
    kind: 'ringWash',
    x: (MAZE_FINAL_CHAMBER.x0 + MAZE_FINAL_CHAMBER.x1 + 1) / 2,
    y: (MAZE_FINAL_CHAMBER.y0 + MAZE_FINAL_CHAMBER.y1 + 1) / 2,
  });
  return fixtures;
}

// ── The mask ────────────────────────────────────────────────────────────────

function maskSize(): { width: number; height: number } {
  return {
    width: Math.ceil(MAZE_WIDTH * TILE_SIZE * BIG_TOP_MASK_SCALE),
    height: Math.ceil(MAZE_HEIGHT * TILE_SIZE * BIG_TOP_MASK_SCALE),
  };
}

/** Bytes the tent's one mask holds, pad included, for the memory gate. */
export function bigTopMaskBytes(): number {
  const { width, height } = maskSize();
  return (width + BIG_TOP_MASK_PAD_PX * 2) * (height + BIG_TOP_MASK_PAD_PX * 2) * BYTES_PER_PIXEL;
}

/** The mask's full size in pixels, pad included. */
export function bigTopMaskDimensions(): { width: number; height: number } {
  const { width, height } = maskSize();
  return { width: width + BIG_TOP_MASK_PAD_PX * 2, height: height + BIG_TOP_MASK_PAD_PX * 2 };
}

/** How far one act's dark blends into the next across the row where they meet, in tiles. */
const ACT_DARK_FEATHER_TILES = 3;

/**
 * Paints the tent's darkness into `ctx`, which must be sized
 * {@link bigTopMaskDimensions}: every act's band filled with its own dark,
 * blended into its neighbour's across the row they share, then a soft pool
 * cut out under every lamp.
 *
 * A painter over a context it is handed rather than a surface it allocates,
 * so a gate can watch every call it makes.
 */
export function paintBigTopDarkness(
  ctx: CanvasRenderingContext2D,
  fixtures: ReadonlyArray<LightFixture>,
): void {
  const tileToMask = TILE_SIZE * BIG_TOP_MASK_SCALE;
  const { width } = maskSize();
  ctx.save();
  try {
    ctx.translate(BIG_TOP_MASK_PAD_PX, BIG_TOP_MASK_PAD_PX);
    for (const section of MAZE_SECTIONS) {
      ctx.fillStyle = actDarkColour(section.id);
      const top = section.rowRange.y0 * tileToMask;
      const rows = section.rowRange.y1 - section.rowRange.y0 + 1;
      ctx.fillRect(0, top, width, rows * tileToMask);
    }
    // Each seam is cleared and refilled with a ramp from one act's dark to the
    // next, rather than two fades laid over each other: overlapping fades thin
    // the dark at the seam into a pale stripe of their own.
    const feather = ACT_DARK_FEATHER_TILES * tileToMask;
    for (const above of MAZE_SECTIONS) {
      const below = MAZE_SECTIONS.find(
        (candidate) => candidate.rowRange.y0 === above.rowRange.y1 + 1,
      );
      if (below === undefined) continue;
      const seam = below.rowRange.y0 * tileToMask;
      const top = seam - feather / 2;
      const ramp = ctx.createLinearGradient(0, top, 0, top + feather);
      ramp.addColorStop(0, actDarkColour(above.id));
      ramp.addColorStop(1, actDarkColour(below.id));
      ctx.clearRect(0, top, width, feather);
      ctx.fillStyle = ramp;
      ctx.fillRect(0, top, width, feather);
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (const fixture of fixtures) {
      const spec = POOL_SPECS[fixture.kind];
      const radius = spec.radiusTiles * tileToMask;
      const pool = ctx.createRadialGradient(
        fixture.x * tileToMask,
        fixture.y * tileToMask,
        0,
        fixture.x * tileToMask,
        fixture.y * tileToMask,
        radius,
      );
      pool.addColorStop(0, `rgba(0,0,0,${spec.strength})`);
      pool.addColorStop(POOL_CORE, `rgba(0,0,0,${spec.strength * POOL_CORE_KEEP})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(fixture.x * tileToMask, fixture.y * tileToMask, radius, 0, FULL_TURN);
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

function actDarkColour(act: MazeSectionId): string {
  const dark = ACT_DARK[act];
  return `rgba(${dark.rgb},${dark.alpha})`;
}

/** Allocates the tent's mask and paints it. */
export function bakeBigTopDarknessMask(fixtures: ReadonlyArray<LightFixture>): CanvasSurface {
  const { width, height } = bigTopMaskDimensions();
  const surface = allocCanvas(width, height);
  paintBigTopDarkness(surfaceContext(surface), fixtures);
  return surface;
}

// ── The house board: which act is lit ───────────────────────────────────────

/**
 * A band of rows lit together. Every act's own rows form one; the pair of
 * curtain rooms at the top of an act's band form another, lit while either
 * the act below them or the act they open onto is on stage, because the party
 * waits there between the two.
 */
interface LightZone {
  readonly y0: number;
  readonly y1: number;
  readonly acts: ReadonlyArray<MazeSectionId>;
  /** The act whose dark the zone wears when its lights are down. */
  readonly tint: MazeSectionId;
}

/** Rows a curtain pair spans, from its barrier row down through its rooms. */
const CURTAIN_ROOM_ROWS = 4;

function buildZones(): ReadonlyArray<LightZone> {
  const zones: LightZone[] = [];
  for (const section of MAZE_SECTIONS) {
    const curtain = MAZE_CURTAINS.find(
      (candidate) => candidate.humanBarrier.y === section.rowRange.y0,
    );
    if (curtain === undefined) {
      zones.push({ ...section.rowRange, acts: [section.id], tint: section.id });
      continue;
    }
    const roomsEnd = section.rowRange.y0 + CURTAIN_ROOM_ROWS - 1;
    zones.push({
      y0: section.rowRange.y0,
      y1: roomsEnd,
      acts: [section.id, curtain.opens],
      tint: section.id,
    });
    zones.push({ y0: roomsEnd + 1, y1: section.rowRange.y1, acts: [section.id], tint: section.id });
  }
  return zones;
}

/** How far a band's lights-down fill fades across each of its edges, in tiles. */
const ZONE_FEATHER_TILES = 1.5;

/** A band's lights-down fill in world pixels, its feather straddling both edges. */
function zoneSpan(zone: LightZone): { top: number; bottom: number } {
  const halfFeather = (ZONE_FEATHER_TILES * TILE_SIZE) / 2;
  return {
    top: zone.y0 * TILE_SIZE - halfFeather,
    bottom: (zone.y1 + 1) * TILE_SIZE + halfFeather,
  };
}

/** Frames an act's lights take to come up when its curtain rises: about a second. */
export const LIGHTS_UP_FRAMES = 60;
/** Frames the act left behind takes to dim. A little slower than the rise, as a house board is. */
const LIGHTS_DOWN_FRAMES = 90;
/** How lit an act the party has finished stays: the house strikes the set, not the work lights. */
export const STRUCK_ACT_LEVEL = 0.4;
/** How far a band with its lights down is darkened past the baked mask. */
const LIGHTS_DOWN_ALPHA = 0.6;
/** Frames every bulb in the tent takes to come up once Grimaldi is freed. */
const HOUSE_LIGHTS_FRAMES = 120;
/** How much of the mask is left once the house lights are up: the tent is lit, not bleached. */
const HOUSE_LIGHTS_MASK_ALPHA = 0.3;

/** What the maze tells the lights each tick. */
export interface StageCue {
  readonly currentAct: MazeSectionId;
  /** How far the cure has run, 0 before the pour to 1 once it has taken. */
  readonly cure: number;
  /** Grimaldi is free and the show is over. */
  readonly freed: boolean;
}

// ── Live light ──────────────────────────────────────────────────────────────

/** What is lit this frame, as the maze sees it. Every tile is in tile units. */
export interface LiveLights {
  readonly ventFlames: Iterable<{ readonly tile: MazeTile; readonly burn: number }>;
  readonly spotlightBeams: Iterable<{ readonly tile: MazeTile; readonly burn: number }>;
  readonly beamSteps: Iterable<{ readonly tile: MazeTile; readonly hot: boolean }>;
  readonly stars: Iterable<{ readonly tile: MazeTile; readonly lit: number }>;
  readonly openedCurtains: Iterable<MazeTile>;
  /** Grimaldi's feet, in world pixels, or null when he is not in the tent. */
  readonly grimaldi: { readonly x: number; readonly y: number } | null;
}

interface GlowStyle {
  readonly radiusTiles: number;
  readonly stops: ReadonlyArray<GlowStop>;
}

/**
 * Heat off a vent's column: a tight warm-white bloom on the boards round its
 * foot. Kept small and pale on purpose — an orange wash spreading to the next
 * grille would read as that grille's warning.
 */
const VENT_FLARE: GlowStyle = {
  radiusTiles: 1.2,
  stops: [
    { offset: 0, color: 'rgba(255,214,160,0.4)' },
    { offset: 0.5, color: 'rgba(255,190,130,0.12)' },
    { offset: 1, color: 'rgba(255,170,110,0)' },
  ],
};
/** The pool a lantern throws on the boards while its cell is lit. */
const SPOTLIGHT_POOL: GlowStyle = {
  radiusTiles: 1.5,
  stops: [
    { offset: 0, color: 'rgba(255,236,190,0.4)' },
    { offset: 0.55, color: 'rgba(255,214,150,0.14)' },
    { offset: 1, color: 'rgba(255,200,130,0)' },
  ],
};
/** The white-hot span of a limelight: bright bloom either side of the beam. */
const BEAM_HOT_BLOOM: GlowStyle = {
  radiusTiles: 1.3,
  stops: [
    { offset: 0, color: 'rgba(255,244,226,0.34)' },
    { offset: 0.5, color: 'rgba(255,200,160,0.1)' },
    { offset: 1, color: 'rgba(255,160,120,0)' },
  ],
};
/** The cold span past the first mirror: a gilded glow. */
const BEAM_COLD_BLOOM: GlowStyle = {
  radiusTiles: 1.1,
  stops: [
    { offset: 0, color: 'rgba(255,214,130,0.24)' },
    { offset: 1, color: 'rgba(255,190,90,0)' },
  ],
};
const STAR_GLOW: GlowStyle = {
  radiusTiles: 1.6,
  stops: [
    { offset: 0, color: 'rgba(255,220,110,0.55)' },
    { offset: 0.4, color: 'rgba(255,200,80,0.2)' },
    { offset: 1, color: 'rgba(255,180,60,0)' },
  ],
};
/** Warm light spilling through a curtain that has gone up, from the act lit beyond it. */
const CURTAIN_SPILL: GlowStyle = {
  radiusTiles: 2.4,
  stops: [
    { offset: 0, color: 'rgba(255,196,120,0.32)' },
    { offset: 0.5, color: 'rgba(255,170,90,0.1)' },
    { offset: 1, color: 'rgba(255,150,70,0)' },
  ],
};
/**
 * Only every other step of a beam gets a bloom: the blooms overlap enough to
 * read as one continuous glow at half the blits.
 */
const BEAM_BLOOM_STRIDE = 2;

/** The follow-spot on Grimaldi: sick green while the vine has him, warm white once cured. */
const FOLLOW_SPOT_RADIUS_TILES = 4.5;
const FOLLOW_SPOT_ALPHA = 0.34;
const SICK_GREEN = { red: 120, green: 200, blue: 70 } as const;
const WARM_WHITE = { red: 255, green: 236, blue: 200 } as const;
/**
 * The cross-fade runs through this many distinct colours: each is one baked
 * glow texture, so the set has to stay bounded.
 */
export const FOLLOW_SPOT_TINT_STEPS = 12;
/** The spot sits a little above his feet, on the coils rather than the floor under them. */
const FOLLOW_SPOT_LIFT_TILES = 0.5;

function followSpotStops(cure: number): ReadonlyArray<GlowStop> {
  const step = Math.round(Math.min(1, Math.max(0, cure)) * FOLLOW_SPOT_TINT_STEPS);
  const mix = step / FOLLOW_SPOT_TINT_STEPS;
  const channel = (from: number, to: number): number => Math.round(from + (to - from) * mix);
  const rgb = `${channel(SICK_GREEN.red, WARM_WHITE.red)},${channel(SICK_GREEN.green, WARM_WHITE.green)},${channel(SICK_GREEN.blue, WARM_WHITE.blue)}`;
  return [
    { offset: 0, color: `rgba(${rgb},${FOLLOW_SPOT_ALPHA})` },
    { offset: POOL_CORE, color: `rgba(${rgb},${FOLLOW_SPOT_ALPHA * POOL_CORE_KEEP})` },
    { offset: 1, color: `rgba(${rgb},0)` },
  ];
}

/** How lit an act should be for a cue: on stage, struck behind the party, or dark ahead. */
function targetLevel(cue: StageCue, act: MazeSectionId): number {
  if (cue.freed || act === cue.currentAct) return 1;
  const order = MAZE_SECTIONS.findIndex((section) => section.id === act);
  const current = MAZE_SECTIONS.findIndex((section) => section.id === cue.currentAct);
  return order < current ? STRUCK_ACT_LEVEL : 0;
}

/**
 * The Big Top's lights: the baked mask, the house board, and the live light
 * the maze feeds it each frame.
 */
export class BigTopLighting {
  private mask: CanvasSurface | null = null;
  private readonly zones = buildZones();
  private readonly actLevels = new Map<MazeSectionId, number>(
    MAZE_SECTIONS.map((section, index) => [section.id, index === 0 ? 1 : 0]),
  );
  private cue: StageCue = { currentAct: MAZE_SECTIONS[0].id, cure: 0, freed: false };
  private houseLights = 0;
  /**
   * Each band's lights-down ramp, built once through the context that fills
   * with it; a different context starts the set over.
   */
  private zoneRamps: {
    readonly ctx: CanvasRenderingContext2D;
    readonly ramps: Map<LightZone, CanvasGradient>;
  } | null = null;

  constructor(private readonly fixtures: ReadonlyArray<LightFixture>) {}

  /** Bakes the mask now rather than on the first frame that draws it. */
  prewarm(): void {
    this.maskSurface();
  }

  private maskSurface(): CanvasSurface {
    this.mask ??= bakeBigTopDarknessMask(this.fixtures);
    return this.mask;
  }

  /** Every lamp whose pool is in the mask. */
  get lightFixtures(): ReadonlyArray<LightFixture> {
    return this.fixtures;
  }

  /** Advances the house board one tick toward what the stage asks for. */
  tick(cue: StageCue): void {
    this.cue = cue;
    for (const section of MAZE_SECTIONS) {
      const level = this.actLevel(section.id);
      const target = targetLevel(cue, section.id);
      const next =
        target > level
          ? Math.min(target, level + 1 / LIGHTS_UP_FRAMES)
          : Math.max(target, level - 1 / LIGHTS_DOWN_FRAMES);
      this.actLevels.set(section.id, next);
    }
    if (cue.freed) this.houseLights = Math.min(1, this.houseLights + 1 / HOUSE_LIGHTS_FRAMES);
  }

  /** How lit an act's own rows are right now, 0 (dark) to 1 (on stage). */
  actLevel(act: MazeSectionId): number {
    return this.actLevels.get(act) ?? 0;
  }

  /** How far the house lights are up after the show, 0 to 1. */
  get houseLightsLevel(): number {
    return this.houseLights;
  }

  /**
   * Whether the board has finished answering `cue`: no act still coming up or
   * going down. Asked against a cue rather than the last one ticked, because
   * the stage can change after the tick that read it.
   */
  settledFor(cue: StageCue): boolean {
    const boardSettled = MAZE_SECTIONS.every(
      (section) => this.actLevel(section.id) === targetLevel(cue, section.id),
    );
    return boardSettled && (!cue.freed || this.houseLights >= 1);
  }

  private zoneLevel(zone: LightZone): number {
    let level = 0;
    for (const act of zone.acts) level = Math.max(level, this.actLevel(act));
    return level;
  }

  /**
   * The dark: the mask, then the house board's fill over every band whose
   * lights are down. One blit and at most a handful of rectangles, each
   * filled with a ramp built on the first frame that needed it.
   */
  renderDarkness(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const startedAt = perfMonitor.begin();
    const maskAlpha = 1 - (1 - HOUSE_LIGHTS_MASK_ALPHA) * this.houseLights;
    blitWorldMask(ctx, this.maskSurface(), camX, camY, maskAlpha);
    const left = Math.max(0, -camX);
    const right = Math.min(viewportWidth(), MAZE_WIDTH * TILE_SIZE - camX);
    if (right > left) {
      for (const zone of this.zones) {
        const down = (1 - this.zoneLevel(zone)) * LIGHTS_DOWN_ALPHA;
        if (down > 0) this.fillZone(ctx, zone, down, left, right, camY);
      }
    }
    perfMonitor.end('lighting', startedAt);
  }

  /**
   * One band's lights-down fill, feathered across its top and bottom edges so
   * a band boundary is a fall-off rather than a ruled line across a corridor.
   * The feather straddles the boundary, so two neighbouring bands cross-fade
   * over it.
   */
  private fillZone(
    ctx: CanvasRenderingContext2D,
    zone: LightZone,
    down: number,
    left: number,
    right: number,
    camY: number,
  ): void {
    const { top, bottom } = zoneSpan(zone);
    const drawTop = Math.max(0, top - camY);
    const drawBottom = Math.min(viewportHeight(), bottom - camY);
    if (drawBottom <= drawTop) return;
    ctx.save();
    try {
      // The ramp is built once in world rows at full strength; the camera and
      // how far the lights are down are applied at the fill.
      ctx.translate(0, -camY);
      ctx.globalAlpha = down;
      ctx.fillStyle = this.zoneRamp(ctx, zone);
      ctx.fillRect(left, drawTop + camY, right - left, drawBottom - drawTop);
    } finally {
      ctx.restore();
    }
  }

  private zoneRamp(ctx: CanvasRenderingContext2D, zone: LightZone): CanvasGradient {
    if (this.zoneRamps?.ctx !== ctx) this.zoneRamps = { ctx, ramps: new Map() };
    const cached = this.zoneRamps.ramps.get(zone);
    if (cached !== undefined) return cached;
    const { top, bottom } = zoneSpan(zone);
    const rgb = ACT_DARK[zone.tint].rgb;
    const ramp = ctx.createLinearGradient(0, top, 0, bottom);
    const edge = (ZONE_FEATHER_TILES * TILE_SIZE) / (bottom - top);
    ramp.addColorStop(0, `rgba(${rgb},0)`);
    ramp.addColorStop(edge, `rgba(${rgb},1)`);
    ramp.addColorStop(1 - edge, `rgba(${rgb},1)`);
    ramp.addColorStop(1, `rgba(${rgb},0)`);
    this.zoneRamps.ramps.set(zone, ramp);
    return ramp;
  }

  /** Additive light for everything lit this frame. */
  renderLiveLights(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    live: LiveLights,
  ): void {
    const startedAt = perfMonitor.begin();
    const previousOperation = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    try {
      const glowAt = (tile: MazeTile, style: GlowStyle, strength: number): void => {
        if (strength <= 0) return;
        const x = (tile.x + HALF) * TILE_SIZE - camX;
        const y = (tile.y + HALF) * TILE_SIZE - camY;
        const radius = style.radiusTiles * TILE_SIZE;
        if (!reachesView(x, y, radius)) return;
        ctx.globalAlpha = Math.min(1, strength);
        drawRadialGlow(ctx, x, y, radius, style.stops);
      };
      for (const vent of live.ventFlames) glowAt(vent.tile, VENT_FLARE, vent.burn);
      for (const cell of live.spotlightBeams) glowAt(cell.tile, SPOTLIGHT_POOL, cell.burn);
      let step = 0;
      for (const beam of live.beamSteps) {
        if (step++ % BEAM_BLOOM_STRIDE !== 0) continue;
        glowAt(beam.tile, beam.hot ? BEAM_HOT_BLOOM : BEAM_COLD_BLOOM, 1);
      }
      for (const star of live.stars) glowAt(star.tile, STAR_GLOW, star.lit);
      for (const curtain of live.openedCurtains) glowAt(curtain, CURTAIN_SPILL, 1);

      const grimaldi = live.grimaldi;
      const finaleLevel = this.actLevel('finale');
      if (grimaldi !== null && finaleLevel > 0) {
        const x = grimaldi.x + TILE_SIZE * HALF - camX;
        const y = grimaldi.y + TILE_SIZE * (HALF - FOLLOW_SPOT_LIFT_TILES) - camY;
        const radius = FOLLOW_SPOT_RADIUS_TILES * TILE_SIZE;
        if (reachesView(x, y, radius)) {
          ctx.globalAlpha = finaleLevel;
          drawRadialGlow(ctx, x, y, radius, followSpotStops(this.cue.cure));
        }
      }
    } finally {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = previousOperation;
      perfMonitor.end('lighting', startedAt);
    }
  }
}

/** Whether a light of `radius` centred at (x, y), in screen pixels, touches the view at all. */
function reachesView(x: number, y: number, radius: number): boolean {
  return (
    x >= -radius && y >= -radius && x <= viewportWidth() + radius && y <= viewportHeight() + radius
  );
}

/**
 * Blits the part of the mask the view can see, and only that. The source
 * rectangle is snapped to whole mask pixels so the stretch stays an exact
 * integer factor, and kept inside the mask's clear pad.
 */
function blitWorldMask(
  ctx: CanvasRenderingContext2D,
  mask: CanvasSurface,
  camX: number,
  camY: number,
  alpha: number,
): void {
  const worldPerMaskPx = 1 / BIG_TOP_MASK_SCALE;
  const pad = BIG_TOP_MASK_PAD_PX;
  const originX = -pad * worldPerMaskPx;
  const originY = -pad * worldPerMaskPx;
  const left = Math.max(pad, Math.floor((camX - originX) / worldPerMaskPx));
  const top = Math.max(pad, Math.floor((camY - originY) / worldPerMaskPx));
  const right = Math.min(
    mask.width - pad,
    Math.ceil((camX + viewportWidth() - originX) / worldPerMaskPx),
  );
  const bottom = Math.min(
    mask.height - pad,
    Math.ceil((camY + viewportHeight() - originY) / worldPerMaskPx),
  );
  if (right <= left || bottom <= top || alpha <= 0) return;
  const fading = alpha < 1;
  if (fading) ctx.globalAlpha = alpha;
  ctx.drawImage(
    mask,
    left,
    top,
    right - left,
    bottom - top,
    originX + left * worldPerMaskPx - camX,
    originY + top * worldPerMaskPx - camY,
    (right - left) * worldPerMaskPx,
    (bottom - top) * worldPerMaskPx,
  );
  if (fading) ctx.globalAlpha = 1;
}
