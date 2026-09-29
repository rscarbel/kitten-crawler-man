/**
 * The circus grounds' ground decals: the chalk ring, sawdust trodden out of
 * the tent doors, wagon ruts, litter, a clown's oversized shoe prints walking
 * into the Big Top, a stain by the cage wagon, and the vine runners fanning
 * out from under the Big Top's skirt.
 *
 * Every decal is one shape in map-tile coordinates, compiled once per site.
 * A tile draws whichever shapes cross it, clipped to itself, so a shape that
 * spans twenty tiles comes out whole across them with no seam, and no tile
 * reads its neighbours — swapping one tile never leaves a stale edge on the
 * next.
 *
 * Kept low in contrast and sparse on purpose: the lot is the backdrop the
 * fights are read against, and every decal lies under the mobs and the
 * telegraphs. Dirt here is a tonal shift, never speckle. The geometry is the
 * layout's; the site's position only picks variants (which litter lies
 * where, how a vine wanders), never where anything is.
 */

import {
  CIRCUS_DECALS,
  CIRCUS_VINE_RUNNER_ANGLES_DEG,
  type CircusDecal,
  type GroundsPoint,
  type PlacedCircusStructure,
} from '../overworld/circusGroundsLayout';
import type { TileContent } from '../tileTypes';
import { mulberry32, range, rangeInt, type Rng } from '../../sprites/person/rng';
import { getCircusRamp, mix, type RGB } from '../../sprites/art/town/townPalette';
import { rgba } from '../../sprites/art/town/townArt';
import { circusGroundsFor, type CircusGroundsRecord } from './circusSiteRegistry';
import { tileHash } from './hollowTileHash';

type Ctx = CanvasRenderingContext2D;

/** A point in map tiles. */
interface MapPoint {
  readonly x: number;
  readonly y: number;
}

/** One decal: the map tiles it can ink, and how to draw it at a tile scale. */
interface DecalShape {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Whether this shape is a vine runner, which bakes differently once the vine dies. */
  readonly vine: boolean;
  /**
   * Draws the shape with map tile (0, 0)'s north-west corner at
   * `(originX, originY)`. `withered` is the site's vine state, so one compiled
   * shape serves both the living vine and the dead one.
   */
  draw(ctx: Ctx, originX: number, originY: number, ts: number, withered: boolean): void;
}

const BONE = getCircusRamp('circus_bone');
const STRAW = getCircusRamp('circus_straw');
const BLOOD = getCircusRamp('circus_blood');
const VINE = getCircusRamp('circus_vine');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const NAVY = getCircusRamp('circus_navy');
const BRUISE = getCircusRamp('circus_bruise');
const BRASS = getCircusRamp('circus_brass');
/** Wet lot mud, a shade under the lot's own darkest tone. */
const MUD: RGB = [52, 42, 30];

const FULL_TURN = Math.PI * 2;
const DEGREES_PER_HALF_TURN = 180;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / DEGREES_PER_HALF_TURN;
}

function boundsOf(
  points: ReadonlyArray<MapPoint>,
  reach: number,
): Omit<DecalShape, 'draw' | 'vine'> {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - reach,
    minY: Math.min(...ys) - reach,
    maxX: Math.max(...xs) + reach,
    maxY: Math.max(...ys) + reach,
  };
}

// ── Chalk ring ────────────────────────────────────────────────────────────────

const CHALK_SEGMENTS = 22;
/** A scuffed curb: most of it is still there, some has been walked away. */
const CHALK_SURVIVING_SHARE = 0.72;
const CHALK_WIDTH_TILES = 0.08;
const CHALK_ALPHA = 0.2;
const CHALK_INNER_OFFSET_TILES = 0.3;
const CHALK_INNER_ALPHA = 0.1;
const CHALK_INNER_WIDTH_TILES = 0.05;

function chalkRing(centre: MapPoint, radius: number, rng: Rng): DecalShape {
  const surviving = Array.from({ length: CHALK_SEGMENTS }, () => rng() < CHALK_SURVIVING_SHARE);
  const innerSurviving = Array.from(
    { length: CHALK_SEGMENTS },
    () => rng() < CHALK_SURVIVING_SHARE,
  );
  const step = FULL_TURN / CHALK_SEGMENTS;
  const ring = (ctx: Ctx, cx: number, cy: number, r: number, keep: boolean[]): void => {
    for (let index = 0; index < CHALK_SEGMENTS; index++) {
      if (!keep[index]) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, r, index * step, (index + 1) * step);
      ctx.stroke();
    }
  };
  return {
    ...boundsOf([centre], radius + CHALK_WIDTH_TILES),
    vine: false,
    draw(ctx, originX, originY, ts) {
      const cx = originX + centre.x * ts;
      const cy = originY + centre.y * ts;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(BONE.accent, CHALK_ALPHA);
      ctx.lineWidth = CHALK_WIDTH_TILES * ts;
      ring(ctx, cx, cy, radius * ts, surviving);
      ctx.strokeStyle = rgba(BONE.light, CHALK_INNER_ALPHA);
      ctx.lineWidth = CHALK_INNER_WIDTH_TILES * ts;
      ring(ctx, cx, cy, (radius - CHALK_INNER_OFFSET_TILES) * ts, innerSurviving);
    },
  };
}

// ── Sawdust paths ─────────────────────────────────────────────────────────────

const SAWDUST_BODY_ALPHA = 0.2;
const SAWDUST_CORE_ALPHA = 0.13;
const SAWDUST_CORE_SHARE = 0.5;
const SAWDUST_DRIFTS = 5;
const SAWDUST_DRIFT_RADIUS_TILES = 0.22;
const SAWDUST_DRIFT_ALPHA = 0.16;
/** Drifts lie flat along the ground, wider than deep. */
const SAWDUST_DRIFT_ASPECT = 0.6;
/** Worn wider where it leaves the door, narrowing as the traffic spreads out. */
const SAWDUST_FAN_SHARE = 0.55;

function sawdustPath(from: MapPoint, to: MapPoint, width: number, rng: Rng): DecalShape {
  const drifts = Array.from({ length: SAWDUST_DRIFTS }, () => {
    const along = rng();
    const across = range(rng, -0.5, 0.5) * width;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const normalX = -(to.y - from.y) / length;
    const normalY = (to.x - from.x) / length;
    return {
      x: from.x + (to.x - from.x) * along + normalX * across,
      y: from.y + (to.y - from.y) * along + normalY * across,
    };
  });
  return {
    ...boundsOf([from, to], width),
    vine: false,
    draw(ctx, originX, originY, ts) {
      const ax = originX + from.x * ts;
      const ay = originY + from.y * ts;
      const bx = originX + to.x * ts;
      const by = originY + to.y * ts;
      ctx.lineCap = 'round';
      const band = (alpha: number, startWidth: number, endWidth: number): void => {
        const gradient = ctx.createLinearGradient(ax, ay, bx, by);
        gradient.addColorStop(0, rgba(STRAW.light, alpha));
        gradient.addColorStop(1, rgba(STRAW.light, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = ((startWidth + endWidth) / 2) * ts;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      };
      band(SAWDUST_BODY_ALPHA, width, width * SAWDUST_FAN_SHARE);
      band(SAWDUST_CORE_ALPHA, width * SAWDUST_CORE_SHARE, width * SAWDUST_CORE_SHARE);
      ctx.fillStyle = rgba(STRAW.accent, SAWDUST_DRIFT_ALPHA);
      for (const drift of drifts) {
        ctx.beginPath();
        ctx.ellipse(
          originX + drift.x * ts,
          originY + drift.y * ts,
          SAWDUST_DRIFT_RADIUS_TILES * ts,
          SAWDUST_DRIFT_RADIUS_TILES * ts * SAWDUST_DRIFT_ASPECT,
          0,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
    },
  };
}

// ── Litter ────────────────────────────────────────────────────────────────────

const LITTER_ITEMS = 11;
const POPCORN_RADIUS_TILES = 0.06;
const POPCORN_ALPHA = 0.42;
/** A second kernel beside the first, so a piece reads as popcorn rather than a dot. */
const POPCORN_PAIR_OFFSET = { x: 1.4, y: 0.5, size: 0.8 } as const;
const TICKET_LENGTH_TILES = 0.22;
const TICKET_WIDTH_TILES = 0.11;
const TICKET_ALPHA = 0.36;
const CONFETTI_SIZE_TILES = 0.07;
const CONFETTI_ALPHA = 0.38;
const CONFETTI_HUES: ReadonlyArray<RGB> = [BLOOD.light, NAVY.light, BRASS.light, BRUISE.light];
type LitterKind = 'popcorn' | 'ticket' | 'confetti';
const LITTER_KINDS: ReadonlyArray<LitterKind> = ['popcorn', 'popcorn', 'ticket', 'confetti'];

function litter(centre: MapPoint, radius: number, rng: Rng): DecalShape {
  const items = Array.from({ length: LITTER_ITEMS }, () => {
    const angle = rng() * FULL_TURN;
    // Denser toward the middle, the way a crowd's leavings pile.
    const out = Math.sqrt(rng()) * radius;
    return {
      x: centre.x + Math.cos(angle) * out,
      y: centre.y + Math.sin(angle) * out,
      kind: LITTER_KINDS[rangeInt(rng, 0, LITTER_KINDS.length - 1)],
      turn: rng() * Math.PI,
      hue: CONFETTI_HUES[rangeInt(rng, 0, CONFETTI_HUES.length - 1)],
    };
  });
  return {
    ...boundsOf([centre], radius + TICKET_LENGTH_TILES),
    vine: false,
    draw(ctx, originX, originY, ts) {
      for (const item of items) {
        const x = originX + item.x * ts;
        const y = originY + item.y * ts;
        if (item.kind === 'popcorn') {
          ctx.fillStyle = rgba(BONE.accent, POPCORN_ALPHA);
          ctx.beginPath();
          ctx.arc(x, y, POPCORN_RADIUS_TILES * ts, 0, FULL_TURN);
          const kernel = POPCORN_RADIUS_TILES * ts;
          ctx.arc(
            x + kernel * POPCORN_PAIR_OFFSET.x,
            y + kernel * POPCORN_PAIR_OFFSET.y,
            kernel * POPCORN_PAIR_OFFSET.size,
            0,
            FULL_TURN,
          );
          ctx.fill();
          continue;
        }
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(item.turn);
        if (item.kind === 'ticket') {
          ctx.fillStyle = rgba(BLOOD.light, TICKET_ALPHA);
          ctx.fillRect(
            (-TICKET_LENGTH_TILES / 2) * ts,
            (-TICKET_WIDTH_TILES / 2) * ts,
            TICKET_LENGTH_TILES * ts,
            TICKET_WIDTH_TILES * ts,
          );
        } else {
          ctx.fillStyle = rgba(item.hue, CONFETTI_ALPHA);
          const size = CONFETTI_SIZE_TILES * ts;
          ctx.fillRect(-size / 2, -size / 2, size, size);
        }
        ctx.restore();
      }
    },
  };
}

// ── Shoe prints ───────────────────────────────────────────────────────────────

/** A clown's stride, in tiles: short for the size of the shoe. */
const SHOE_STRIDE_TILES = 0.85;
const SHOE_GAIT_OFFSET_TILES = 0.2;
const SHOE_SOLE_LENGTH_TILES = 0.2;
const SHOE_SOLE_WIDTH_TILES = 0.1;
const SHOE_TOE_FORWARD_TILES = 0.12;
const SHOE_TOE_RADIUS_TILES = 0.11;
const SHOE_TOE_ASPECT = 0.9;
const SHOE_ALPHA = 0.26;

function shoePrints(from: MapPoint, to: MapPoint): DecalShape {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const dirX = (to.x - from.x) / length;
  const dirY = (to.y - from.y) / length;
  const steps = Math.floor(length / SHOE_STRIDE_TILES);
  const heading = Math.atan2(dirY, dirX);
  const prints = Array.from({ length: steps }, (_unused, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const along = (index + 0.5) * SHOE_STRIDE_TILES;
    return {
      x: from.x + dirX * along - dirY * side * SHOE_GAIT_OFFSET_TILES,
      y: from.y + dirY * along + dirX * side * SHOE_GAIT_OFFSET_TILES,
    };
  });
  return {
    ...boundsOf(
      [from, to],
      SHOE_SOLE_LENGTH_TILES + SHOE_TOE_FORWARD_TILES + SHOE_TOE_RADIUS_TILES,
    ),
    vine: false,
    draw(ctx, originX, originY, ts) {
      ctx.fillStyle = rgba(MUD, SHOE_ALPHA);
      for (const print of prints) {
        ctx.save();
        ctx.translate(originX + print.x * ts, originY + print.y * ts);
        ctx.rotate(heading);
        ctx.beginPath();
        // The heel and the long sole, then the bulbous toe a clown shoe ends in.
        ctx.ellipse(0, 0, SHOE_SOLE_LENGTH_TILES * ts, SHOE_SOLE_WIDTH_TILES * ts, 0, 0, FULL_TURN);
        ctx.ellipse(
          (SHOE_SOLE_LENGTH_TILES + SHOE_TOE_FORWARD_TILES / 2) * ts,
          0,
          SHOE_TOE_RADIUS_TILES * ts,
          SHOE_TOE_RADIUS_TILES * ts * SHOE_TOE_ASPECT,
          0,
          0,
          FULL_TURN,
        );
        ctx.fill();
        ctx.restore();
      }
    },
  };
}

// ── Vine runners ──────────────────────────────────────────────────────────────

/**
 * The Big Top's skirt, as a plan ellipse on the ground, from the grounds'
 * centre tile's north-west corner. The runners start a little inside it, under
 * the canvas, so each is seen coming out from beneath the skirt.
 */
const BIG_TOP_SKIRT = { x: 0, y: -1.5, radiusX: 5.9, radiusY: 2.5 } as const;
const VINE_START_INSET = 0.88;
const VINE_SEGMENTS = 11;
const VINE_MIN_LENGTH_TILES = 2.4;
const VINE_MAX_LENGTH_TILES = 4.6;
const VINE_WANDER_RADIANS = 0.38;
/** Each step turns this share of the way back to the runner's heading, so it meanders rather than curls up. */
const VINE_HEADING_PULL = 0.3;
/** Branches leave from the middle of the stem, never at its root or its tip. */
const VINE_BRANCH_FROM_SHARE = 0.3;
const VINE_BRANCH_TO_SHARE = 0.7;
const VINE_LEAF_ASPECT = 0.5;
const VINE_ROOT_WIDTH_TILES = 0.15;
const VINE_TIP_WIDTH_TILES = 0.03;
const VINE_ROOT_ALPHA = 0.5;
const VINE_TIP_ALPHA = 0.12;
const VINE_BRANCHES_MAX = 2;
const VINE_BRANCH_LENGTH_SHARE = 0.35;
const VINE_BRANCH_TURN_RADIANS = 0.7;
const VINE_LEAVES = 9;
const VINE_LEAF_LENGTH_TILES = 0.14;
const VINE_LEAF_ALPHA = 0.36;
const VINE_LEAF_FAINTEST = 0.5;
/** Dead vine: dried to the brown of old rope, and drier still at the leaves. */
const WITHERED_STEM: RGB = mix(ROT_TIMBER.shadow, MUD, 0.4);
const WITHERED_LEAF: RGB = mix(ROT_TIMBER.mid, STRAW.shadow, 0.5);
const WITHERED_LEAF_SHARE = 0.6;
/** Green enough to read as a plant on the lot rather than a crack in it. */
const LIVING_STEM: RGB = mix(VINE.shadow, VINE.mid, 0.55);

interface VinePath {
  readonly points: ReadonlyArray<MapPoint>;
  /** The width share at the path's root, so a branch starts as thin as the stem it leaves. */
  readonly rootShare: number;
}

function wander(start: MapPoint, heading: number, length: number, rng: Rng): MapPoint[] {
  const points: MapPoint[] = [start];
  let angle = heading;
  let here = start;
  const step = length / VINE_SEGMENTS;
  for (let index = 0; index < VINE_SEGMENTS; index++) {
    angle += range(rng, -VINE_WANDER_RADIANS, VINE_WANDER_RADIANS);
    angle += (heading - angle) * VINE_HEADING_PULL;
    here = { x: here.x + Math.cos(angle) * step, y: here.y + Math.sin(angle) * step };
    points.push(here);
  }
  return points;
}

function vineRunner(skirtCentre: MapPoint, angleDeg: number, rng: Rng): DecalShape {
  const angle = toRadians(angleDeg);
  const start = {
    x: skirtCentre.x + Math.cos(angle) * BIG_TOP_SKIRT.radiusX * VINE_START_INSET,
    y: skirtCentre.y + Math.sin(angle) * BIG_TOP_SKIRT.radiusY * VINE_START_INSET,
  };
  // Out along the ellipse's normal, the way a runner leaves a rim.
  const heading = Math.atan2(
    Math.sin(angle) / BIG_TOP_SKIRT.radiusY,
    Math.cos(angle) / BIG_TOP_SKIRT.radiusX,
  );
  const length = range(rng, VINE_MIN_LENGTH_TILES, VINE_MAX_LENGTH_TILES);
  const stem = wander(start, heading, length, rng);
  const paths: VinePath[] = [{ points: stem, rootShare: 1 }];
  const branches = rangeInt(rng, 1, VINE_BRANCHES_MAX);
  for (let branch = 0; branch < branches; branch++) {
    const at = rangeInt(
      rng,
      Math.floor(VINE_SEGMENTS * VINE_BRANCH_FROM_SHARE),
      Math.floor(VINE_SEGMENTS * VINE_BRANCH_TO_SHARE),
    );
    const side = rng() < 0.5 ? -1 : 1;
    paths.push({
      points: wander(
        stem[at],
        heading + side * VINE_BRANCH_TURN_RADIANS,
        length * VINE_BRANCH_LENGTH_SHARE,
        rng,
      ),
      rootShare: 1 - at / VINE_SEGMENTS,
    });
  }
  const leaves = Array.from({ length: VINE_LEAVES }, () => {
    const path = paths[rangeInt(rng, 0, paths.length - 1)];
    const index = rangeInt(rng, 1, path.points.length - 1);
    return {
      at: path.points[index],
      turn: rng() * Math.PI,
      share: path.rootShare * (1 - index / VINE_SEGMENTS),
    };
  });
  const allPoints = paths.flatMap((path) => path.points);
  return {
    ...boundsOf(allPoints, VINE_ROOT_WIDTH_TILES + VINE_LEAF_LENGTH_TILES),
    vine: true,
    draw(ctx, originX, originY, ts, withered) {
      const stemColour = withered ? WITHERED_STEM : LIVING_STEM;
      ctx.lineCap = 'round';
      for (const path of paths) {
        // Segment by segment, each thinner and fainter than the last: the
        // runner thins with distance from the tent until it gives out.
        for (let index = 1; index < path.points.length; index++) {
          const share = path.rootShare * (1 - index / path.points.length);
          const a = path.points[index - 1];
          const b = path.points[index];
          ctx.strokeStyle = rgba(
            stemColour,
            VINE_TIP_ALPHA + (VINE_ROOT_ALPHA - VINE_TIP_ALPHA) * share,
          );
          ctx.lineWidth =
            (VINE_TIP_WIDTH_TILES + (VINE_ROOT_WIDTH_TILES - VINE_TIP_WIDTH_TILES) * share) * ts;
          ctx.beginPath();
          ctx.moveTo(originX + a.x * ts, originY + a.y * ts);
          ctx.lineTo(originX + b.x * ts, originY + b.y * ts);
          ctx.stroke();
        }
      }
      const leafColour = withered ? WITHERED_LEAF : VINE.mid;
      const leafScale = withered ? WITHERED_LEAF_SHARE : 1;
      for (const leaf of leaves) {
        // Leaves near the root read stronger, fading out along the runner.
        ctx.fillStyle = rgba(leafColour, VINE_LEAF_ALPHA * (VINE_LEAF_FAINTEST + leaf.share));
        ctx.beginPath();
        ctx.ellipse(
          originX + leaf.at.x * ts,
          originY + leaf.at.y * ts,
          VINE_LEAF_LENGTH_TILES * ts * leafScale,
          VINE_LEAF_LENGTH_TILES * ts * VINE_LEAF_ASPECT * leafScale,
          leaf.turn,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
    },
  };
}

// ── Wagon ruts and the stain ──────────────────────────────────────────────────

const WAGONS_WITH_WHEELS: ReadonlySet<string> = new Set([
  'cage_wagon',
  'clown_caravan',
  'prop_wagon',
]);
/** Wheel gauge: the two ruts either side of the footprint's middle row. */
const RUT_HALF_GAUGE_TILES = 0.26;
const RUT_STRAIGHT_TILES = 1.4;
const RUT_CURVE_TILES = 2.4;
const RUT_WIDTH_TILES = 0.08;
const RUT_ALPHA = 0.13;
const RUT_LIP_ALPHA = 0.06;
const RUT_LIP_OFFSET_TILES = 0.07;
const RUT_LIP_WIDTH_SHARE = 0.6;
/** How far back under the wagon the ruts start, so they run out from beneath it. */
const RUT_UNDER_WAGON_TILES = 0.4;
/** Where along the bend its control point sits: most of the turn happens late. */
const RUT_BEND_CONTROL_SHARE = 0.7;

function wagonRuts(wagon: PlacedCircusStructure, centre: MapPoint): DecalShape {
  const { rect } = wagon;
  const middleY = rect.y + rect.h / 2;
  const middleX = rect.x + rect.w / 2;
  // Driven in along the rim from whichever end faces the field's open side,
  // then bending in from the field, where it came from.
  const leaveEast = middleX < centre.x;
  const endX = leaveEast ? rect.x + rect.w : rect.x;
  const along = leaveEast ? 1 : -1;
  const inward = Math.sign(centre.y - middleY) || 1;
  const tracks = [-1, 1].map((side) => {
    const y = middleY + side * RUT_HALF_GAUGE_TILES;
    const start = { x: endX - along * RUT_UNDER_WAGON_TILES, y };
    const straightEnd = { x: endX + along * RUT_STRAIGHT_TILES, y };
    const control = { x: straightEnd.x + along * RUT_CURVE_TILES * RUT_BEND_CONTROL_SHARE, y };
    const end = {
      x: straightEnd.x + along * RUT_CURVE_TILES,
      y: y + inward * RUT_CURVE_TILES,
    };
    return { start, straightEnd, control, end };
  });
  const allPoints = tracks.flatMap((track) => [track.start, track.control, track.end]);
  return {
    ...boundsOf(allPoints, RUT_WIDTH_TILES + RUT_LIP_OFFSET_TILES),
    vine: false,
    draw(ctx, originX, originY, ts) {
      const px = (point: MapPoint): MapPoint => ({
        x: originX + point.x * ts,
        y: originY + point.y * ts,
      });
      ctx.lineCap = 'round';
      for (const track of tracks) {
        const trace = (offsetY: number): void => {
          const a = px(track.start);
          const b = px(track.straightEnd);
          const c = px(track.control);
          const d = px(track.end);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y + offsetY);
          ctx.lineTo(b.x, b.y + offsetY);
          ctx.quadraticCurveTo(c.x, c.y + offsetY, d.x, d.y + offsetY);
          ctx.stroke();
        };
        ctx.strokeStyle = rgba(MUD, RUT_ALPHA);
        ctx.lineWidth = RUT_WIDTH_TILES * ts;
        trace(0);
        // The churned lip thrown up on the sun side of the rut.
        ctx.strokeStyle = rgba(BONE.mid, RUT_LIP_ALPHA);
        ctx.lineWidth = RUT_WIDTH_TILES * ts * RUT_LIP_WIDTH_SHARE;
        trace(-RUT_LIP_OFFSET_TILES * ts);
      }
    },
  };
}

const STAIN_INWARD_TILES = 1.2;
const STAIN_BLOTS = 5;
const STAIN_RADIUS_TILES = 0.42;
const STAIN_ALPHA = 0.15;
const STAIN_CORE_ALPHA = 0.1;
const STAIN_SPATTER = 6;
const STAIN_SPATTER_RADIUS_TILES = 0.05;
/** How far the blots and the spatter spread about the stain's middle, in tiles. */
const STAIN_BLOT_SPREAD = { x: 0.3, y: 0.2 } as const;
const STAIN_BLOT_MIN_SHARE = 0.5;
const STAIN_SPATTER_REACH = { min: 0.5, max: 1.1 } as const;
/** Pooled on flat ground: wider than deep. */
const STAIN_ASPECT = 0.62;
const STAIN_CORE_SHARE = 0.5;
const STAIN_MUD_SHARE = 0.35;

function stainBy(wagon: PlacedCircusStructure, centre: MapPoint, rng: Rng): DecalShape {
  const middle = { x: wagon.rect.x + wagon.rect.w / 2, y: wagon.rect.y + wagon.rect.h / 2 };
  const toCentre = Math.hypot(centre.x - middle.x, centre.y - middle.y) || 1;
  const at = {
    x: middle.x + ((centre.x - middle.x) / toCentre) * STAIN_INWARD_TILES,
    y: middle.y + ((centre.y - middle.y) / toCentre) * STAIN_INWARD_TILES,
  };
  const blots = Array.from({ length: STAIN_BLOTS }, () => ({
    x: at.x + range(rng, -STAIN_BLOT_SPREAD.x, STAIN_BLOT_SPREAD.x),
    y: at.y + range(rng, -STAIN_BLOT_SPREAD.y, STAIN_BLOT_SPREAD.y),
    r: STAIN_RADIUS_TILES * range(rng, STAIN_BLOT_MIN_SHARE, 1),
  }));
  const spatter = Array.from({ length: STAIN_SPATTER }, () => {
    const angle = rng() * FULL_TURN;
    const out = range(rng, STAIN_SPATTER_REACH.min, STAIN_SPATTER_REACH.max);
    return { x: at.x + Math.cos(angle) * out, y: at.y + Math.sin(angle) * out * STAIN_ASPECT };
  });
  const stain = mix(BLOOD.shadow, MUD, STAIN_MUD_SHARE);
  return {
    ...boundsOf([at], STAIN_RADIUS_TILES + STAIN_SPATTER_REACH.max),
    vine: false,
    draw(ctx, originX, originY, ts) {
      ctx.fillStyle = rgba(stain, STAIN_ALPHA);
      for (const blot of blots) {
        ctx.beginPath();
        ctx.ellipse(
          originX + blot.x * ts,
          originY + blot.y * ts,
          blot.r * ts,
          blot.r * ts * STAIN_ASPECT,
          0,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
      ctx.fillStyle = rgba(stain, STAIN_CORE_ALPHA);
      ctx.beginPath();
      const core = STAIN_RADIUS_TILES * ts * STAIN_CORE_SHARE;
      ctx.ellipse(
        originX + at.x * ts,
        originY + at.y * ts,
        core,
        core * STAIN_ASPECT,
        0,
        0,
        FULL_TURN,
      );
      ctx.fill();
      for (const drop of spatter) {
        ctx.beginPath();
        ctx.arc(
          originX + drop.x * ts,
          originY + drop.y * ts,
          STAIN_SPATTER_RADIUS_TILES * ts,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
    },
  };
}

// ── Compilation ───────────────────────────────────────────────────────────────

const VARIANT_SALT = 0x5a1d0c;

function onMap(centre: MapPoint, point: GroundsPoint): MapPoint {
  return { x: centre.x + point.x, y: centre.y + point.y };
}

function layoutDecal(decal: CircusDecal, centre: MapPoint, rng: Rng): DecalShape {
  switch (decal.kind) {
    case 'chalk_ring':
      return chalkRing(onMap(centre, decal.at), decal.radiusTiles, rng);
    case 'sawdust_path':
      return sawdustPath(onMap(centre, decal.from), onMap(centre, decal.to), decal.widthTiles, rng);
    case 'litter':
      return litter(onMap(centre, decal.at), decal.radiusTiles, rng);
    case 'shoe_prints':
      return shoePrints(onMap(centre, decal.from), onMap(centre, decal.to));
  }
}

const compiled = new WeakMap<CircusGroundsRecord, ReadonlyArray<DecalShape>>();

function shapesFor(record: CircusGroundsRecord): ReadonlyArray<DecalShape> {
  const cached = compiled.get(record);
  if (cached !== undefined) return cached;
  const { site } = record;
  const centre = { x: site.centre.x, y: site.centre.y };
  // Varies with where the grounds stand, and so with the world: which litter
  // lies where and how each runner wanders, never where a decal is.
  const rng = mulberry32(tileHash(site.centre.x, site.centre.y, VARIANT_SALT));
  const shapes: DecalShape[] = CIRCUS_DECALS.map((decal) => layoutDecal(decal, centre, rng));
  const skirtCentre = { x: centre.x + BIG_TOP_SKIRT.x, y: centre.y + BIG_TOP_SKIRT.y };
  for (const angle of CIRCUS_VINE_RUNNER_ANGLES_DEG)
    shapes.push(vineRunner(skirtCentre, angle, rng));
  for (const placed of site.structures) {
    if (WAGONS_WITH_WHEELS.has(placed.structure)) shapes.push(wagonRuts(placed, centre));
    if (placed.structure === 'cage_wagon') shapes.push(stainBy(placed, centre, rng));
  }
  compiled.set(record, shapes);
  return shapes;
}

/**
 * Draws whatever circus decals cross this tile, clipped to it. A no-op on
 * any map without circus grounds and on every tile no decal reaches.
 */
export function drawCircusDecals(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const record = circusGroundsFor(structure);
  if (record === undefined) return;
  const originX = sx - tx * ts;
  const originY = sy - ty * ts;
  let clipped = false;
  for (const shape of shapesFor(record)) {
    if (shape.maxX < tx || shape.minX > tx + 1 || shape.maxY < ty || shape.minY > ty + 1) continue;
    if (!clipped) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, ts, ts);
      ctx.clip();
      clipped = true;
    }
    shape.draw(ctx, originX, originY, ts, record.vinesWithered);
  }
  if (clipped) ctx.restore();
}

/**
 * Every map tile a vine runner can ink: the tiles to re-bake when the vine
 * dies back.
 */
export function circusVineTiles(structure: TileContent[][]): MapPoint[] {
  const record = circusGroundsFor(structure);
  if (record === undefined) return [];
  const tiles: MapPoint[] = [];
  const seen = new Set<string>();
  for (const shape of shapesFor(record)) {
    if (!shape.vine) continue;
    for (let y = Math.floor(shape.minY); y <= Math.floor(shape.maxY); y++) {
      for (let x = Math.floor(shape.minX); x <= Math.floor(shape.maxX); x++) {
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}
