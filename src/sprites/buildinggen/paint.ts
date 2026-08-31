/**
 * The pass order. Everything a building is, in the sequence it has to happen in.
 *
 * The ordering is the design: materials lay down unlit surface, texture weathers
 * it across element boundaries, the plane's own shade multiplies the result,
 * components cut openings into it at their own values, and only then does the
 * silhouette get its ink. Reorder any two of those and the building reads wrong
 * in a way no single pass looks responsible for — grime that sits on top of a
 * window, a glow the plane shade has dimmed to brown, an outline drawn before
 * half the clutter existed and so tracing only the walls.
 *
 * Components do not do their own lighting. They ask `lighting.ts` for a recess,
 * an edge light or a glow, so a door's reveal and a window's reveal are the same
 * shadow and stay the same shadow when it is tuned.
 */

import { allocReadableCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { NoiseField } from '../../map/tilegen/noise';
import {
  drawPlane,
  frameYToFacadePlaneY,
  makePlane,
  project,
  type Plane,
  type Projection,
} from './projection';
import {
  FACADE_PLANE_SHADE,
  ROOF_PLANE_SHADE,
  ROOF_RETURN_SHADE,
  SIDE_RETURN_SHADE,
  paintEdgeAo,
  paintInteriorInk,
  paintSilhouetteOutline,
  paintStructuralLine,
  shadePlane,
} from './lighting';
import { applyGrain, applyMoss, applyStreaks, applyTonalWash, planeNoise } from './texture';
import { paintWall } from './materials/wall';
import { bandEdges, paintFacadeBand, paintPilasters } from './materials/facadeTrim';
import { paintRoof } from './materials/roof';
import { paintChimney, paintDormer } from './materials/roofFurniture';
import { paintDoor } from './components/door';
import { paintWindow } from './components/window';
import { paintProp } from './components/props';
import { getRamp, sampleRamp } from './ramps';
import { frameHeightPx, frameWidthPx, type BuildingSpec } from './spec';

/** The game's own 2D context — the offline bakers bridge node-canvas to it. */
type Ctx = CanvasRenderingContext2D;

/** Seed strides, so two passes on one building never share a noise field by accident. */
const SEED_FACADE = 101;
const SEED_ROOF = 211;
const SEED_SIDE = 307;
const SEED_TEXTURE = 419;
const SEED_OUTLINE = 523;
const SEED_PROPS = 631;
const SEED_TRIM = 743;
/** Keeps each band's and the piers' element streams off each other. */
const SEED_BAND_STRIDE = 149;
const SEED_PILASTER_OFFSET = 1279;
const SEED_WASH = 857;

/** How deep the eaves shadow falls onto the wall, in tiles, and how dark it starts. */
const EAVES_AO_REACH_TILES = 0.5;
const EAVES_AO_DEPTH = 0.35;

/** The band of shadow where the building meets the ground. */
const GROUND_AO_REACH_TILES = 0.3;
const GROUND_AO_DEPTH = 0.3;

/** The crease where the front wall meets the side return, painted on the return. */
const CREASE_AO_REACH_TILES = 0.25;
const CREASE_AO_DEPTH = 0.45;

/**
 * Interior linework.
 *
 * The threshold has to clear the *grain's* own gradients, which is much higher
 * than it looks: a Sobel kernel sums eight neighbours with weights up to two, so
 * a ten-level step between adjacent pixels already reads as a magnitude near
 * forty. Set below that, the pass inks a dark ring around every blob of surface
 * noise and turns an ashlar wall into a cellular net — the exact failure this
 * kit exists to avoid, produced by the pass meant to prevent it.
 */
const INTERIOR_INK_STRENGTH = 0.16;
const INTERIOR_INK_FULL_GRADIENT = 90;
const INTERIOR_INK_THRESHOLD = 92;

/** Silhouette ink. */
const OUTLINE_WIDTH_PX = 2;
const OUTLINE_ALPHA = 0.85;
const OUTLINE_JITTER_PX = 0.5;

/**
 * Texture amplitudes.
 *
 * Two scales, and the split matters: the coarse layer reads as weathering at
 * arm's length and washes out entirely once the sheet is drawn down to the 32px
 * display tile, and the fine layer is what survives that downsample. Each
 * carries an additive term as well as a multiplicative one, because a multiply
 * scales its own variation down with the surface's value and would leave every
 * dark building in town flat.
 *
 * They were tuned against the measured local contrast of the art being replaced,
 * then pulled back when the picture showed what the number could not: past about
 * here the grain starts competing with the masonry instead of sitting on it.
 */
const GRAIN_AMPLITUDE = 0.14;
const GRAIN_PERIOD = 26;
const GRAIN_OCTAVES = 3;
const COARSE_GRAIN_ADDITIVE = 6;
const FINE_GRAIN_AMPLITUDE = 0.16;
/**
 * Absolute luminance the fine grain adds on top of the multiply.
 *
 * Sized so a near-black wall carries as much visible working as a cream one; a
 * purely proportional pass leaves the dark half of the town flat.
 */
const FINE_GRAIN_ADDITIVE = 9;
const FINE_GRAIN_PERIOD = 190;
const FINE_GRAIN_OCTAVES = 1;
const WASH_AMPLITUDE = 0.16;
const WASH_PERIOD = 3;
const WASH_WARP_PX = 14;
const STREAK_LENGTH_TILES = 1.3;
/** Grime reads as rain on a facade long before it reads as dirt; keep it under. */
const STREAK_STRENGTH_FACTOR = 0.55;
const STREAK_DENSITY = 0.013;
const MOSS_REACH = 0.32;
/**
 * How far the fine grain is squashed along the axis it should NOT vary on.
 *
 * A wall's fine texture runs vertically — that is the way water leaves it — and
 * a roof's runs downhill along the strands and tile channels. Both are `+y` in
 * their own plane's coordinates, so one constant serves both.
 */
const WALL_GRAIN_STRETCH_Y = 0.8;
const ROOF_GRAIN_STRETCH_Y = 0.4;

/** A roof's disrepair drives its staining, but a roof streaks far less than a wall. */
const ROOF_GRIME_FACTOR = 0.45;
const MOSS_PERIOD = 9;

export interface PaintedBuilding {
  readonly canvas: CanvasSurface;
  readonly projection: Projection;
}

/** One stage of a building's paint, and what it is for. */
export interface BuildingPaintStage {
  /** Names the stage in a benchmark or a paced-queue readout. */
  readonly label: string;
  run(): void;
}

/**
 * A building's paint, broken into stages that can be run on different frames.
 *
 * A facade costs seventy to three hundred milliseconds to paint, which is far
 * more than a frame can give up in one piece — so the game runs these a few at a
 * time while a floor fades in, and the offline bakers run them back to back.
 * They share the canvas and the four painted planes through this closure, which
 * is what lets them be suspended between any two of them.
 *
 * The order is the design, not a convenience. Materials lay down unlit surface,
 * texture weathers it across element boundaries, the plane's own shade
 * multiplies the result, components cut openings into it at their own values,
 * and only then does the silhouette get its ink. Reorder any two and the
 * building reads wrong in a way no single stage looks responsible for.
 */
export interface BuildingPaintPlan {
  readonly canvas: CanvasSurface;
  readonly projection: Projection;
  readonly stages: ReadonlyArray<BuildingPaintStage>;
}

/**
 * How far a floor's art seed reaches into a facade: the weathering layers, and
 * nothing else.
 *
 * Added to the seed the tonal wash, the two grain passes, the grime streaks and
 * the moss are drawn from — never to the seed a wall's courses, a roof's tiles,
 * a window's glazing or a life effect's phase come from. Those are what a
 * building *is*, and they are also what the footprint, the doorway and the
 * animation gates measure; a seed that moved them would be varying the town's
 * collision and its animation rather than its weather.
 */
export function planBuildingPaint(spec: BuildingSpec, weatherSeed = 0): BuildingPaintPlan {
  const projection = project(spec);
  // Read back pixel by pixel by the ink and outline stages, which is the whole
  // reason this one asks: a GPU-backed surface pays a full synchronisation for
  // every one of those reads.
  const canvas = allocReadableCanvas(frameWidthPx(spec), frameHeightPx(spec));
  const ctx = surfaceContext(canvas);

  // Allocated now and painted by the stages below, so the composite stage after
  // them can close over the same four surfaces.
  const side = sidePlanePaint(spec, projection, weatherSeed);
  const facade = facadePlanePaint(spec, projection, weatherSeed);
  const roofReturn = roofPlanePaint(spec, projection, true, weatherSeed);
  const roofFront = roofPlanePaint(spec, projection, false, weatherSeed);

  return {
    canvas,
    projection,
    stages: [
      ...side.stages,
      ...facade.stages,
      ...roofReturn.stages,
      ...roofFront.stages,
      {
        label: 'compose planes',
        run: () => {
          // Walls first, then the roof over them: the eaves overhang the wall
          // head, and an overhang drawn under what it overhangs is just a wider
          // roof.
          for (const plane of [side.plane, facade.plane, roofReturn.plane, roofFront.plane]) {
            drawPlane(ctx, plane);
            // Nothing reads a plane after it is drawn, and four of them are most
            // of what painting a facade holds. Given back here rather than left
            // to the collector, so a floor loading fifteen buildings holds one
            // building's worth of surfaces rather than fifteen.
            plane.canvas.width = 0;
            plane.canvas.height = 0;
          }
        },
      },
      { label: 'roof furniture', run: () => paintRoofFurniture(ctx, spec, projection) },
      { label: 'facade props', run: () => paintFacadeProps(ctx, spec, projection) },
      { label: 'ground contact', run: () => paintGroundContact(ctx, spec, projection) },
      {
        label: 'interior ink',
        run: () =>
          paintInteriorInk(ctx, canvas.width, canvas.height, {
            strength: INTERIOR_INK_STRENGTH,
            fullStrengthGradient: INTERIOR_INK_FULL_GRADIENT,
            threshold: INTERIOR_INK_THRESHOLD,
          }),
      },
      {
        label: 'silhouette outline',
        run: () =>
          paintSilhouetteOutline(ctx, canvas.width, canvas.height, {
            seed: spec.seed + SEED_OUTLINE,
            widthPx: OUTLINE_WIDTH_PX,
            alpha: OUTLINE_ALPHA,
            jitterPx: OUTLINE_JITTER_PX,
          }),
      },
    ],
  };
}

/** Paints a whole building in one go, for a caller with no frames to spread it over. */
export function paintBuilding(spec: BuildingSpec, weatherSeed = 0): PaintedBuilding {
  const plan = planBuildingPaint(spec, weatherSeed);
  for (const stage of plan.stages) stage.run();
  return { canvas: plan.canvas, projection: plan.projection };
}

/**
 * A plane's paint as stages, plus the plane itself.
 *
 * The plane is allocated up front so the stages that follow can close over it;
 * everything that draws into it happens inside a stage, which is what lets the
 * paint be suspended between any two of them.
 */
interface PlanePaint {
  readonly plane: Plane;
  readonly stages: ReadonlyArray<BuildingPaintStage>;
}

function facadePlanePaint(
  spec: BuildingSpec,
  projection: Projection,
  weatherSeed: number,
): PlanePaint {
  const plane = makePlane(projection.facadeQuad);
  const noise = planeNoise(plane);
  const seed = spec.seed + SEED_FACADE;
  const scale = projection.scale;

  const storySplitPlaneY =
    spec.stories === 1
      ? plane.height
      : ((projection.storySplitY - projection.eavesY) /
          (projection.facadeBaseY - projection.eavesY)) *
        plane.height;

  const upper = spec.facade.upper;
  const stages: BuildingPaintStage[] = [];
  if (upper !== undefined) {
    stages.push({
      label: 'upper wall',
      run: () =>
        paintWall({
          plane,
          noise,
          seed,
          scale,
          wall: upper,
          band: { top: 0, bottom: storySplitPlaneY },
          quoins: spec.facade.quoins,
          foundationPx: 0,
        }),
    });
  }
  stages.push({
    label: 'ground wall',
    run: () =>
      paintWall({
        plane,
        noise,
        seed: seed + SEED_TEXTURE,
        scale,
        wall: spec.facade.ground,
        band: { top: upper === undefined ? 0 : storySplitPlaneY, bottom: plane.height },
        quoins: spec.facade.quoins,
        foundationPx: spec.facade.foundationTiles * scale,
      }),
  });
  stages.push({ label: 'facade trim', run: () => paintFacadeTrim(plane, projection, spec) });
  stages.push(
    ...weatherPlaneStages(plane, noise, seed + weatherSeed, scale, {
      grime: spec.facade.ground.grime,
      moss: spec.facade.ground.moss,
      grainStretchY: WALL_GRAIN_STRETCH_Y,
    }),
  );
  stages.push({
    label: 'facade shade and openings',
    run: () => {
      shadePlane(plane, FACADE_PLANE_SHADE);

      paintEdgeAo(plane.ctx, { x: 0, y: 0, width: plane.width, height: plane.height }, 'top', {
        depth: EAVES_AO_DEPTH,
        reach: EAVES_AO_REACH_TILES * scale,
      });
      paintEdgeAo(plane.ctx, { x: 0, y: 0, width: plane.width, height: plane.height }, 'bottom', {
        depth: GROUND_AO_DEPTH,
        reach: GROUND_AO_REACH_TILES * scale,
      });

      if (spec.stories === 2) {
        paintStructuralLine(
          plane.ctx,
          { x: 0, y: storySplitPlaneY },
          { x: plane.width, y: storySplitPlaneY },
        );
      }

      for (const window of spec.windows) {
        paintWindow(plane, projection, spec, window);
      }
      paintDoor(plane, projection, spec);
    },
  });

  return { plane, stages };
}

/**
 * String courses and piers, painted before the weathering so the grime runs over
 * them: a moulding the dirt stops politely short of reads as a decal.
 */
function paintFacadeTrim(plane: Plane, projection: Projection, spec: BuildingSpec): void {
  for (const [index, band] of spec.facade.bands.entries()) {
    const edges = bandEdges(band, projection.scale, projection.groundY);
    paintFacadeBand({
      plane,
      // Per band. Sharing one seed gave every course on a facade a
      // pixel-identical run of block tones — six of them on the temple, stacked
      // one above another, which reads as a repeat rather than as masonry.
      seed: spec.seed + SEED_TRIM + index * SEED_BAND_STRIDE,
      scale: projection.scale,
      top: frameYToFacadePlaneY(projection, plane, edges.topFrameY),
      bottom: frameYToFacadePlaneY(projection, plane, edges.bottomFrameY),
      band,
    });
  }
  if (spec.facade.pilasters >= 2) {
    paintPilasters({
      plane,
      seed: spec.seed + SEED_TRIM + SEED_PILASTER_OFFSET,
      scale: projection.scale,
      count: spec.facade.pilasters,
      rampId: spec.facade.pilasterRamp ?? spec.facade.ground.ramp,
      top: 0,
      bottom: plane.height,
    });
  }
}

function sidePlanePaint(
  spec: BuildingSpec,
  projection: Projection,
  weatherSeed: number,
): PlanePaint {
  const plane = makePlane(projection.sideQuad);
  const noise = planeNoise(plane);
  const seed = spec.seed + SEED_SIDE;
  return {
    plane,
    stages: [
      {
        label: 'side wall',
        run: () =>
          paintWall({
            plane,
            noise,
            seed,
            scale: projection.scale,
            wall: spec.facade.ground,
            band: { top: 0, bottom: plane.height },
            quoins: false,
            foundationPx: spec.facade.foundationTiles * projection.scale,
          }),
      },
      ...weatherPlaneStages(plane, noise, seed + weatherSeed, projection.scale, {
        grime: spec.facade.ground.grime,
        moss: spec.facade.ground.moss,
        grainStretchY: WALL_GRAIN_STRETCH_Y,
      }),
      {
        label: 'side shade',
        run: () => {
          shadePlane(plane, SIDE_RETURN_SHADE);
          paintEdgeAo(plane.ctx, { x: 0, y: 0, width: plane.width, height: plane.height }, 'left', {
            depth: CREASE_AO_DEPTH,
            reach: CREASE_AO_REACH_TILES * projection.scale,
          });
        },
      },
    ],
  };
}

function roofPlanePaint(
  spec: BuildingSpec,
  projection: Projection,
  isReturn: boolean,
  weatherSeed: number,
): PlanePaint {
  const quad = isReturn ? projection.roofReturnQuad : projection.roofQuad;
  const plane = makePlane(quad);
  const noise = planeNoise(plane);
  const seed = spec.seed + SEED_ROOF + (isReturn ? SEED_SIDE : 0);
  const face = isReturn ? 'roof return' : 'roof';
  return {
    plane,
    stages: [
      {
        label: `${face} material`,
        run: () =>
          paintRoof({ plane, noise, seed, scale: projection.scale, roof: spec.roof, isReturn }),
      },
      // A roof weathers like a wall does, and for the same reason: the tonal
      // drift and the grain have to cross course boundaries or the courses read
      // as the only thing that ever varies. Moss on a roof is the material's own
      // business, though — it grows on the upslope courses, not at ground contact.
      ...weatherPlaneStages(plane, noise, seed + weatherSeed, projection.scale, {
        grime: spec.roof.disrepair * ROOF_GRIME_FACTOR,
        moss: 0,
        grainStretchY: ROOF_GRAIN_STRETCH_Y,
      }),
      {
        label: `${face} shade`,
        run: () => shadePlane(plane, isReturn ? ROOF_RETURN_SHADE : ROOF_PLANE_SHADE),
      },
    ],
  };
}

/**
 * The passes that run over a finished wall regardless of what it is made of.
 *
 * Kept in one place rather than inside each material because the whole point of
 * these layers is that they do not know where the stones are.
 */
interface WeatherOptions {
  readonly grime: number;
  readonly moss: number;
  /**
   * How far the fine grain's features are stretched vertically.
   *
   * A roof wants them long: they read as the strands and channels running
   * downhill, which is the direction its material is actually laid in. A wall
   * wants them much shorter — at the roof's setting a whole street of facades
   * came out looking rained on, because a vertical streak on a wall reads as
   * water and there is only so much water a town can have run down it.
   */
  readonly grainStretchY: number;
}

/**
 * The weathering passes, one stage each.
 *
 * Split because they are the expensive half of a plane and each is a separate
 * full-buffer read and write — so they are also the natural places to suspend a
 * paint between frames. Their order is fixed by `weatherPlane`'s contract and
 * this list is that order.
 */
function weatherPlaneStages(
  plane: Plane,
  noise: NoiseField,
  seed: number,
  scale: number,
  options: WeatherOptions,
): BuildingPaintStage[] {
  const stages: BuildingPaintStage[] = [
    { label: 'tonal wash', run: () => applyTonalWashPass(plane, noise, seed) },
    { label: 'coarse grain', run: () => applyCoarseGrainPass(plane, noise, seed) },
    {
      label: 'fine grain',
      run: () => applyFineGrainPass(plane, noise, seed, options.grainStretchY),
    },
  ];
  if (options.grime > 0) {
    stages.push({
      label: 'grime streaks',
      run: () => applyGrimePass(plane, noise, seed, scale, options.grime),
    });
  }
  if (options.moss > 0) {
    stages.push({ label: 'moss', run: () => applyMossPass(plane, noise, seed, options.moss) });
  }
  return stages;
}

function applyTonalWashPass(plane: Plane, noise: NoiseField, seed: number): void {
  applyTonalWash(plane, noise, {
    // Offset off the material's own seed. The wash exists to vary across element
    // boundaries; drawn from the same stream as the elements it crosses, it was
    // correlated with exactly the thing it is meant to be independent of.
    seed: seed + SEED_WASH,
    amplitude: WASH_AMPLITUDE,
    period: WASH_PERIOD,
    warp: WASH_WARP_PX,
  });
}

function applyCoarseGrainPass(plane: Plane, noise: NoiseField, seed: number): void {
  applyGrain(plane, noise, {
    seed: seed + SEED_TEXTURE * 2,
    amplitude: GRAIN_AMPLITUDE,
    period: GRAIN_PERIOD,
    octaves: GRAIN_OCTAVES,
    additive: COARSE_GRAIN_ADDITIVE,
  });
}

/**
 * A second, much finer pass. One octave range cannot carry both "this wall is
 * weathered" and "this wall has a surface": the coarse layer reads at arm's
 * length and washes out entirely at the 32px display tile, and the fine layer
 * is what survives the downsample.
 */
function applyFineGrainPass(plane: Plane, noise: NoiseField, seed: number, stretchY: number): void {
  applyGrain(plane, noise, {
    seed: seed + SEED_TEXTURE * 5,
    amplitude: FINE_GRAIN_AMPLITUDE,
    period: FINE_GRAIN_PERIOD,
    octaves: FINE_GRAIN_OCTAVES,
    stretchY,
    additive: FINE_GRAIN_ADDITIVE,
  });
}

function applyGrimePass(
  plane: Plane,
  noise: NoiseField,
  seed: number,
  scale: number,
  grime: number,
): void {
  applyStreaks(plane, noise, {
    seed: seed + SEED_TEXTURE * 3,
    strength: grime * STREAK_STRENGTH_FACTOR,
    density: STREAK_DENSITY,
    length: STREAK_LENGTH_TILES * scale,
    originY: 0.05,
  });
}

function applyMossPass(plane: Plane, noise: NoiseField, seed: number, moss: number): void {
  applyMoss(plane, noise, {
    seed: seed + SEED_TEXTURE * 4,
    color: sampleRamp(getRamp('leaf_green'), 0.4),
    strength: moss,
    reach: MOSS_REACH,
    period: MOSS_PERIOD,
  });
}

function paintRoofFurniture(ctx: Ctx, spec: BuildingSpec, projection: Projection): void {
  for (const dormer of spec.roof.dormers) {
    paintDormer(ctx, projection, spec, dormer);
  }
  for (const chimney of spec.roof.chimneys) {
    paintChimney(ctx, projection, spec, chimney);
  }
}

function paintFacadeProps(ctx: Ctx, spec: BuildingSpec, projection: Projection): void {
  const noise = new NoiseField(Math.max(projection.frameWidth, projection.frameHeight));
  for (const [index, prop] of spec.props.entries()) {
    paintProp(ctx, projection, prop, noise, spec.seed + SEED_PROPS + index);
  }
}

/**
 * The dark band where the building meets the dirt.
 *
 * The runtime already darkens the ground tiles at a building's base; this is the
 * matching half on the art's own side of the join, without which the building
 * has a shadow beside it and none under it.
 */
const CONTACT_SHADOW_HEIGHT_TILES = 0.22;
const CONTACT_SHADOW_ALPHA = 0.42;

function paintGroundContact(ctx: Ctx, spec: BuildingSpec, projection: Projection): void {
  const height = CONTACT_SHADOW_HEIGHT_TILES * projection.scale;
  const top = projection.groundY - height;
  const gradient = ctx.createLinearGradient(0, top, 0, projection.groundY);
  const shadow = sampleRamp(getRamp('ground_shadow'), 0);
  const MID_STOP = 0.45;
  const MID_ALPHA_FRACTION = 0.5;
  gradient.addColorStop(0, `rgba(${shadow[0]},${shadow[1]},${shadow[2]},0)`);
  gradient.addColorStop(
    MID_STOP,
    `rgba(${shadow[0]},${shadow[1]},${shadow[2]},${CONTACT_SHADOW_ALPHA * MID_ALPHA_FRACTION})`,
  );
  gradient.addColorStop(1, `rgba(${shadow[0]},${shadow[1]},${shadow[2]},${CONTACT_SHADOW_ALPHA})`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, projection.frameWidth, height + spec.facade.sinkTiles * projection.scale);
  ctx.restore();
}
