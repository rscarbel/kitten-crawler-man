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

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { NoiseField } from '../tilegen/noise.js';
import {
  drawPlane,
  frameYToFacadePlaneY,
  makePlane,
  project,
  type Plane,
  type Projection,
} from './projection.js';
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
} from './lighting.js';
import { applyGrain, applyMoss, applyStreaks, applyTonalWash, planeNoise } from './texture.js';
import { paintWall } from './materials/wall.js';
import { bandEdges, paintFacadeBand, paintPilasters } from './materials/facadeTrim.js';
import { paintRoof } from './materials/roof.js';
import { paintChimney, paintDormer } from './materials/roofFurniture.js';
import { paintDoor } from './components/door.js';
import { paintWindow } from './components/window.js';
import { paintProp } from './components/props.js';
import { getRamp, sampleRamp } from './ramps.js';
import { frameHeightPx, frameWidthPx, type BuildingSpec } from './spec.js';

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
  readonly canvas: Canvas;
  readonly projection: Projection;
}

export function paintBuilding(spec: BuildingSpec): PaintedBuilding {
  const projection = project(spec);
  const canvas = createCanvas(frameWidthPx(spec), frameHeightPx(spec));
  const ctx = canvas.getContext('2d');

  const sidePlane = paintSidePlane(spec, projection);
  const facadePlane = paintFacadePlane(spec, projection);
  const roofReturnPlane = paintRoofPlane(spec, projection, true);
  const roofFrontPlane = paintRoofPlane(spec, projection, false);

  // Walls first, then the roof over them: the eaves overhang the wall head, and
  // an overhang drawn under what it overhangs is just a wider roof.
  drawPlane(ctx, sidePlane);
  drawPlane(ctx, facadePlane);
  drawPlane(ctx, roofReturnPlane);
  drawPlane(ctx, roofFrontPlane);

  paintRoofFurniture(ctx, spec, projection);
  paintFacadeProps(ctx, spec, projection);
  paintGroundContact(ctx, spec, projection);

  paintInteriorInk(ctx, canvas.width, canvas.height, {
    strength: INTERIOR_INK_STRENGTH,
    fullStrengthGradient: INTERIOR_INK_FULL_GRADIENT,
    threshold: INTERIOR_INK_THRESHOLD,
  });
  paintSilhouetteOutline(ctx, canvas.width, canvas.height, {
    seed: spec.seed + SEED_OUTLINE,
    widthPx: OUTLINE_WIDTH_PX,
    alpha: OUTLINE_ALPHA,
    jitterPx: OUTLINE_JITTER_PX,
  });

  return { canvas, projection };
}

function paintFacadePlane(spec: BuildingSpec, projection: Projection): Plane {
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
  if (upper !== undefined) {
    paintWall({
      plane,
      noise,
      seed,
      scale,
      wall: upper,
      band: { top: 0, bottom: storySplitPlaneY },
      quoins: spec.facade.quoins,
      foundationPx: 0,
    });
  }
  paintWall({
    plane,
    noise,
    seed: seed + SEED_TEXTURE,
    scale,
    wall: spec.facade.ground,
    band: { top: upper === undefined ? 0 : storySplitPlaneY, bottom: plane.height },
    quoins: spec.facade.quoins,
    foundationPx: spec.facade.foundationTiles * scale,
  });

  paintFacadeTrim(plane, projection, spec);

  weatherPlane(plane, noise, seed, scale, {
    grime: spec.facade.ground.grime,
    moss: spec.facade.ground.moss,
    grainStretchY: WALL_GRAIN_STRETCH_Y,
  });
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

  return plane;
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

function paintSidePlane(spec: BuildingSpec, projection: Projection): Plane {
  const plane = makePlane(projection.sideQuad);
  const noise = planeNoise(plane);
  const seed = spec.seed + SEED_SIDE;
  paintWall({
    plane,
    noise,
    seed,
    scale: projection.scale,
    wall: spec.facade.ground,
    band: { top: 0, bottom: plane.height },
    quoins: false,
    foundationPx: spec.facade.foundationTiles * projection.scale,
  });
  weatherPlane(plane, noise, seed, projection.scale, {
    grime: spec.facade.ground.grime,
    moss: spec.facade.ground.moss,
    grainStretchY: WALL_GRAIN_STRETCH_Y,
  });
  shadePlane(plane, SIDE_RETURN_SHADE);
  paintEdgeAo(plane.ctx, { x: 0, y: 0, width: plane.width, height: plane.height }, 'left', {
    depth: CREASE_AO_DEPTH,
    reach: CREASE_AO_REACH_TILES * projection.scale,
  });
  return plane;
}

function paintRoofPlane(spec: BuildingSpec, projection: Projection, isReturn: boolean): Plane {
  const quad = isReturn ? projection.roofReturnQuad : projection.roofQuad;
  const plane = makePlane(quad);
  const noise = planeNoise(plane);
  const seed = spec.seed + SEED_ROOF + (isReturn ? SEED_SIDE : 0);
  paintRoof({ plane, noise, seed, scale: projection.scale, roof: spec.roof, isReturn });
  // A roof weathers like a wall does, and for the same reason: the tonal drift
  // and the grain have to cross course boundaries or the courses read as the
  // only thing that ever varies. Moss on a roof is the material's own business,
  // though — it grows on the upslope courses, not at ground contact.
  weatherPlane(plane, noise, seed, projection.scale, {
    grime: spec.roof.disrepair * ROOF_GRIME_FACTOR,
    moss: 0,
    grainStretchY: ROOF_GRAIN_STRETCH_Y,
  });
  shadePlane(plane, isReturn ? ROOF_RETURN_SHADE : ROOF_PLANE_SHADE);
  return plane;
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

function weatherPlane(
  plane: Plane,
  noise: NoiseField,
  seed: number,
  scale: number,
  options: WeatherOptions,
): void {
  applyTonalWash(plane, noise, {
    // Offset off the material's own seed. The wash exists to vary across element
    // boundaries; drawn from the same stream as the elements it crosses, it was
    // correlated with exactly the thing it is meant to be independent of.
    seed: seed + SEED_WASH,
    amplitude: WASH_AMPLITUDE,
    period: WASH_PERIOD,
    warp: WASH_WARP_PX,
  });
  applyGrain(plane, noise, {
    seed: seed + SEED_TEXTURE * 2,
    amplitude: GRAIN_AMPLITUDE,
    period: GRAIN_PERIOD,
    octaves: GRAIN_OCTAVES,
    additive: COARSE_GRAIN_ADDITIVE,
  });
  // A second, much finer pass. One octave range cannot carry both "this wall is
  // weathered" and "this wall has a surface": the coarse layer reads at arm's
  // length and washes out entirely at the 32px display tile, and the fine layer
  // is what survives the downsample.
  applyGrain(plane, noise, {
    seed: seed + SEED_TEXTURE * 5,
    amplitude: FINE_GRAIN_AMPLITUDE,
    period: FINE_GRAIN_PERIOD,
    octaves: FINE_GRAIN_OCTAVES,
    stretchY: options.grainStretchY,
    additive: FINE_GRAIN_ADDITIVE,
  });
  if (options.grime > 0) {
    applyStreaks(plane, noise, {
      seed: seed + SEED_TEXTURE * 3,
      strength: options.grime * STREAK_STRENGTH_FACTOR,
      density: STREAK_DENSITY,
      length: STREAK_LENGTH_TILES * scale,
      originY: 0.05,
    });
  }
  if (options.moss > 0) {
    applyMoss(plane, noise, {
      seed: seed + SEED_TEXTURE * 4,
      color: sampleRamp(getRamp('leaf_green'), 0.4),
      strength: options.moss,
      reach: MOSS_REACH,
      period: MOSS_PERIOD,
    });
  }
}

function paintRoofFurniture(ctx: NodeCtx, spec: BuildingSpec, projection: Projection): void {
  for (const dormer of spec.roof.dormers) {
    paintDormer(ctx, projection, spec, dormer);
  }
  for (const chimney of spec.roof.chimneys) {
    paintChimney(ctx, projection, spec, chimney);
  }
}

function paintFacadeProps(ctx: NodeCtx, spec: BuildingSpec, projection: Projection): void {
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

function paintGroundContact(ctx: NodeCtx, spec: BuildingSpec, projection: Projection): void {
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
