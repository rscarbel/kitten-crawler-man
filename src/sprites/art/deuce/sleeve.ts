/**
 * Deuce's arms: pressed shirt sleeves over a heavy man's arms, held up by
 * sleeve garters.
 *
 * A sleeve is cloth, not a tube. Its silhouette is built from stations along
 * the bone, each with its own half-width: the shoulder's round cap, the cloth
 * bloused out over the garter and pinched in at it, the elbow, the forearm
 * tapering to the wrist, and the loose fabric bunched above the cuff. A bent
 * arm comes to a point at the elbow, on the outside of the bend, where the
 * cloth is stretched over the bone; the crook on the inside gathers into
 * folds. Folds are filled bands, not lines, so they stay decisive at a glance.
 */

import { type Pt } from '../carlArt';
import {
  type Ctx,
  type Trace,
  fillTrace,
  lerpPt,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceEllipse,
  traceSmoothLoop,
  tracePolygon,
  withinTrace,
} from './paint';
import { GOLD, SHIRT } from './palette';

/** An arm's widths, in the caller's units. */
export interface ArmBuild {
  shoulderRadius: number;
  /** Cloth bloused out over the garter. */
  blouseRadius: number;
  /** Pinched in at the garter. */
  garterRadius: number;
  elbowRadius: number;
  /** The forearm's thickest point, just below the elbow. */
  forearmRadius: number;
  /** The loose fabric bunched just above the cuff. */
  overhangRadius: number;
  wristRadius: number;
  cuffRadius: number;
  cuffLength: number;
  garterThickness: number;
}

/**
 * How much of a sleeve to draw. `simple` is the club floor's few-pixel arm:
 * the silhouette, one crescent, the garter and the crook's main fold.
 */
export type SleeveDetail = 'full' | 'simple';

/** Shares of the shoulder-to-elbow run where the upper sleeve's stations sit. */
const UPPER_STATIONS = {
  deltoid: 0.22,
  blouse: 0.36,
  garter: 0.44,
  belowGarter: 0.52,
  aboveElbow: 0.86,
} as const;
/** Shares of the elbow-to-wrist run where the forearm's stations sit. */
const FOREARM_STATIONS = { belly: 0.3, overhang: 0.78, bunch: 0.88 } as const;
/** The deltoid swells the sleeve a touch past the shoulder seam's width. */
const DELTOID_SWELL = 1.04;
const BELOW_GARTER_SWELL = 0.94;
const ABOVE_ELBOW_SWELL = 1.04;
const BUNCH_SWELL = 1.04;

/** How far the elbow's point stands off the joint, as a share of the elbow's half-width. */
const ELBOW_POINT_REACH = 1.25;
/** Below this the arm is straight and has no outside of a bend to point. */
const STRAIGHT_ARM_EPSILON = 1e-3;
/** Points on a rounded cap, as angles from the limb's axis. */
const CAP_ANGLES: readonly number[] = [Math.PI / 4, 0, -Math.PI / 4];

const SLEEVE_SHADING = { shadow: 0.4, highlight: 0.16 } as const;
const OUTLINE_PIXELS = 2;
const SIMPLE_OUTLINE_PIXELS = 1.5;

/** The blouse's overhang throws a band of shade this deep onto the garter's top. */
const BLOUSE_SHADOW_DEPTH = 0.7;
/** Pinch folds converging on the garter: length and root width as shares of the arm. */
const GARTER_FOLD_LENGTH = 1.5;
const GARTER_FOLD_WIDTH = 0.14;
const GARTER_FOLD_SPREAD: readonly number[] = [-0.35, 0.4];

/** Crook folds fan out of the inside of the bend: angle off the forearm, length, width. */
const CROOK_FOLDS: ReadonlyArray<{ angle: number; length: number; width: number }> = [
  { angle: -0.15, length: 2.4, width: 0.32 },
  { angle: 0.35, length: 1.8, width: 0.26 },
  { angle: 0.85, length: 1.3, width: 0.22 },
];
/** The crook sits on the inside of the bend, this share of the elbow's width in. */
const CROOK_INSET = 0.55;
/** Lines of cloth stretched over the elbow point. */
const ELBOW_STRAIN_ANGLES: readonly number[] = [-0.35, 0.3];
const ELBOW_STRAIN_LENGTH = 1.1;
const STRAIN_PIXELS = 1;

/** Ring folds where the sleeve bunches above the cuff. */
const CUFF_BREAK_RINGS: readonly number[] = [0.7, 0.86];
const CUFF_BREAK_BOW = 0.35;
const CUFF_BREAK_PIXELS = 1.3;
/** A long drape crease down the forearm. */
const DRAPE = { from: 0.18, to: 0.6, offset: -0.45 } as const;
const DRAPE_PIXELS = 1.1;

const CUFF_SHADING = { shadow: 0.35, highlight: 0.14 } as const;
const CUFF_LINK_ALONG = 0.5;
const CUFF_LINK_ACROSS = 0.45;
const CUFF_LINK_RADIUS = 0.26;
const CUFF_LINK_SHADING = { shadow: 0.2, highlight: 0.12 } as const;
const CUFF_LINK_OUTLINE_PIXELS = 1;
/** The cuff stops just short of the wrist so the hand's root shows under it. */
const CUFF_WRIST_GAP = 0.08;
const GARTER_SHADING = { shadow: 0.5, highlight: 0.3 } as const;
/** The garter's band bows down its middle, showing the arm is round. */
const GARTER_BOW = 0.3;

interface Station {
  p: Pt;
  r: number;
}

function unit(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? pt(dx / length, dy / length) : pt(0, 1);
}

/** Outward direction of the elbow's point: along the upper arm, away from the forearm. */
function elbowPointDirection(shoulder: Pt, elbow: Pt, wrist: Pt): Pt {
  const upper = unit(shoulder, elbow);
  const fore = unit(elbow, wrist);
  const dx = upper.x - fore.x;
  const dy = upper.y - fore.y;
  const length = Math.hypot(dx, dy);
  return length > STRAIGHT_ARM_EPSILON ? pt(dx / length, dy / length) : upper;
}

/** A rounded cap swept from the limb's left edge, round the end facing `axis`, to its right edge. */
function roundCap(centre: Pt, axis: Pt, radius: number): Pt[] {
  const facing = Math.atan2(axis.y, axis.x);
  return CAP_ANGLES.map((angle) =>
    pt(centre.x + Math.cos(facing + angle) * radius, centre.y + Math.sin(facing + angle) * radius),
  );
}

/**
 * The outline of a limb through `stations`: down one side, round the far
 * cap, back up the other. A cap is a point to come to, or null for a round one.
 */
function limbOutline(stations: readonly Station[], startTip: Pt | null, endTip: Pt | null): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  stations.forEach((station, i) => {
    const before = stations[Math.max(0, i - 1)].p;
    const after = stations[Math.min(stations.length - 1, i + 1)].p;
    const along = unit(before, after);
    const normal = pt(-along.y, along.x);
    left.push(pt(station.p.x + normal.x * station.r, station.p.y + normal.y * station.r));
    right.push(pt(station.p.x - normal.x * station.r, station.p.y - normal.y * station.r));
  });
  const first = stations[0];
  const last = stations[stations.length - 1];
  const axis = unit(first.p, last.p);
  const endCap = endTip === null ? roundCap(last.p, axis, last.r) : [endTip];
  const startCap =
    startTip === null ? roundCap(first.p, pt(-axis.x, -axis.y), first.r) : [startTip];
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}

function along(from: Pt, to: Pt, t: number): Pt {
  return lerpPt(from, to, t);
}

function upperStations(build: ArmBuild, shoulder: Pt, elbow: Pt): Station[] {
  return [
    { p: shoulder, r: build.shoulderRadius },
    { p: along(shoulder, elbow, UPPER_STATIONS.deltoid), r: build.shoulderRadius * DELTOID_SWELL },
    { p: along(shoulder, elbow, UPPER_STATIONS.blouse), r: build.blouseRadius },
    { p: along(shoulder, elbow, UPPER_STATIONS.garter), r: build.garterRadius },
    {
      p: along(shoulder, elbow, UPPER_STATIONS.belowGarter),
      r: build.blouseRadius * BELOW_GARTER_SWELL,
    },
    {
      p: along(shoulder, elbow, UPPER_STATIONS.aboveElbow),
      r: build.elbowRadius * ABOVE_ELBOW_SWELL,
    },
    { p: elbow, r: build.elbowRadius },
  ];
}

function forearmStations(build: ArmBuild, elbow: Pt, wrist: Pt): Station[] {
  return [
    { p: elbow, r: build.elbowRadius },
    { p: along(elbow, wrist, FOREARM_STATIONS.belly), r: build.forearmRadius },
    { p: along(elbow, wrist, FOREARM_STATIONS.overhang), r: build.overhangRadius },
    { p: along(elbow, wrist, FOREARM_STATIONS.bunch), r: build.overhangRadius * BUNCH_SWELL },
    { p: wrist, r: build.wristRadius },
  ];
}

function elbowTip(build: ArmBuild, shoulder: Pt, elbow: Pt, wrist: Pt): Pt {
  const out = elbowPointDirection(shoulder, elbow, wrist);
  const reach = build.elbowRadius * ELBOW_POINT_REACH;
  return pt(elbow.x + out.x * reach, elbow.y + out.y * reach);
}

export function upperSleeveTrace(build: ArmBuild, shoulder: Pt, elbow: Pt, wrist: Pt): Trace {
  const outline = limbOutline(
    upperStations(build, shoulder, elbow),
    null,
    elbowTip(build, shoulder, elbow, wrist),
  );
  return (c) => traceSmoothLoop(c, outline);
}

export function forearmTrace(build: ArmBuild, shoulder: Pt, elbow: Pt, wrist: Pt): Trace {
  const outline = limbOutline(
    forearmStations(build, elbow, wrist),
    elbowTip(build, shoulder, elbow, wrist),
    null,
  );
  return (c) => traceSmoothLoop(c, outline);
}

/** A tapered wedge from `root` along `dir`: a fold band, wide at its root. */
function wedge(root: Pt, dir: Pt, length: number, width: number): Pt[] {
  const normal = pt(-dir.y, dir.x);
  return [
    pt(root.x + normal.x * width, root.y + normal.y * width),
    pt(root.x + dir.x * length, root.y + dir.y * length),
    pt(root.x - normal.x * width, root.y - normal.y * width),
  ];
}

function rotateDir(dir: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pt(dir.x * c - dir.y * s, dir.x * s + dir.y * c);
}

function paintGarter(
  ctx: Ctx,
  build: ArmBuild,
  shoulder: Pt,
  elbow: Pt,
  wrist: Pt,
  detail: SleeveDetail,
): void {
  const centre = along(shoulder, elbow, UPPER_STATIONS.garter);
  const axis = unit(shoulder, elbow);
  const normal = pt(-axis.y, axis.x);
  const half = build.garterRadius * (1 + GARTER_BOW / 2);
  const thick = build.garterThickness / 2;
  const bow = build.garterRadius * GARTER_BOW;
  const edge = (offset: number): Pt[] => [
    pt(centre.x - normal.x * half + axis.x * offset, centre.y - normal.y * half + axis.y * offset),
    pt(centre.x + axis.x * (offset + bow), centre.y + axis.y * (offset + bow)),
    pt(centre.x + normal.x * half + axis.x * offset, centre.y + normal.y * half + axis.y * offset),
  ];
  const top = edge(-thick);
  const bottom = edge(thick);
  if (detail === 'full') {
    // The bloused cloth overhangs the garter and shades the sleeve just above it.
    const shadowTop = edge(-thick - build.garterRadius * BLOUSE_SHADOW_DEPTH);
    withinTrace(ctx, upperSleeveTrace(build, shoulder, elbow, wrist), () => {
      fillTrace(
        ctx,
        (c) => {
          c.moveTo(shadowTop[0].x, shadowTop[0].y);
          c.quadraticCurveTo(shadowTop[1].x, shadowTop[1].y, shadowTop[2].x, shadowTop[2].y);
          c.lineTo(top[2].x, top[2].y);
          c.quadraticCurveTo(top[1].x, top[1].y, top[0].x, top[0].y);
          c.closePath();
        },
        SHIRT.shade,
      );
      // Pinch folds pulled into the band from above and below.
      for (const spread of GARTER_FOLD_SPREAD) {
        const root = pt(
          centre.x + normal.x * build.garterRadius * spread,
          centre.y + normal.y * build.garterRadius * spread,
        );
        const length = build.garterRadius * GARTER_FOLD_LENGTH;
        const width = build.garterRadius * GARTER_FOLD_WIDTH;
        fillTrace(
          ctx,
          (c) => tracePolygon(c, wedge(root, pt(-axis.x, -axis.y), length, width)),
          SHIRT.shade,
        );
      }
    });
  }
  const band: Trace = (c) => {
    c.moveTo(top[0].x, top[0].y);
    c.quadraticCurveTo(top[1].x, top[1].y, top[2].x, top[2].y);
    c.lineTo(bottom[2].x, bottom[2].y);
    c.quadraticCurveTo(bottom[1].x, bottom[1].y, bottom[0].x, bottom[0].y);
    c.closePath();
  };
  outlineTrace(ctx, band, detail === 'full' ? OUTLINE_PIXELS : SIMPLE_OUTLINE_PIXELS);
  paintForm(ctx, band, GOLD, {
    shadow: build.garterThickness * GARTER_SHADING.shadow,
    highlight: build.garterThickness * GARTER_SHADING.highlight,
  });
}

/**
 * The whole sleeve, shoulder to wrist, as one silhouette: the upper arm and
 * the forearm are traced into a single path, so the outline runs unbroken
 * round the elbow and one terminator shades the whole limb, with no seam
 * where the two pieces meet.
 */
export function armTrace(build: ArmBuild, shoulder: Pt, elbow: Pt, wrist: Pt): Trace {
  const upper = upperSleeveTrace(build, shoulder, elbow, wrist);
  const fore = forearmTrace(build, shoulder, elbow, wrist);
  return (c) => {
    upper(c);
    fore(c);
  };
}

/**
 * Shoulder to wrist: the sleeve as one limb, its blouse and garter, the crook's
 * folds, the cloth over the elbow and the bunch above the cuff.
 */
export function paintArmSleeve(
  ctx: Ctx,
  build: ArmBuild,
  shoulder: Pt,
  elbow: Pt,
  wrist: Pt,
  detail: SleeveDetail,
): void {
  const limb = armTrace(build, shoulder, elbow, wrist);
  outlineTrace(ctx, limb, detail === 'full' ? OUTLINE_PIXELS : SIMPLE_OUTLINE_PIXELS);
  paintForm(ctx, limb, SHIRT, {
    shadow: build.forearmRadius * SLEEVE_SHADING.shadow,
    highlight: build.forearmRadius * SLEEVE_SHADING.highlight,
  });
  paintGarter(ctx, build, shoulder, elbow, wrist, detail);
  const trace = forearmTrace(build, shoulder, elbow, wrist);
  const axis = unit(elbow, wrist);
  const out = elbowPointDirection(shoulder, elbow, wrist);
  const crook = pt(
    elbow.x - out.x * build.elbowRadius * CROOK_INSET,
    elbow.y - out.y * build.elbowRadius * CROOK_INSET,
  );
  // The fan's side is the inside of the bend, wherever the arm is turned.
  const inward = Math.sign(axis.x * -out.y + axis.y * out.x) || 1;
  withinTrace(ctx, trace, () => {
    const folds = detail === 'full' ? CROOK_FOLDS : CROOK_FOLDS.slice(0, 1);
    for (const fold of folds) {
      const dir = rotateDir(axis, fold.angle * inward);
      fillTrace(
        ctx,
        (c) =>
          tracePolygon(
            c,
            wedge(crook, dir, build.elbowRadius * fold.length, build.elbowRadius * fold.width),
          ),
        SHIRT.shade,
      );
    }
    if (detail === 'simple') return;
    const tip = elbowTip(build, shoulder, elbow, wrist);
    for (const angle of ELBOW_STRAIN_ANGLES) {
      const dir = rotateDir(pt(-out.x, -out.y), angle);
      const length = build.elbowRadius * ELBOW_STRAIN_LENGTH;
      strokeLine(
        ctx,
        [tip, pt(tip.x + dir.x * length, tip.y + dir.y * length)],
        SHIRT.shade,
        STRAIN_PIXELS,
      );
    }
    const normal = pt(-axis.y, axis.x);
    const drapeOffset = build.forearmRadius * DRAPE.offset;
    strokeLine(
      ctx,
      [DRAPE.from, DRAPE.to].map((t) => {
        const p = along(elbow, wrist, t);
        return pt(p.x + normal.x * drapeOffset, p.y + normal.y * drapeOffset);
      }),
      SHIRT.shade,
      DRAPE_PIXELS,
    );
    // The cuff break: fabric bunched into rings above the cuff.
    for (const t of CUFF_BREAK_RINGS) {
      const centre = along(elbow, wrist, t);
      const r = build.overhangRadius;
      const bow = r * CUFF_BREAK_BOW;
      strokeLine(
        ctx,
        [
          pt(centre.x + normal.x * r, centre.y + normal.y * r),
          pt(centre.x + axis.x * bow, centre.y + axis.y * bow),
          pt(centre.x - normal.x * r, centre.y - normal.y * r),
        ],
        SHIRT.shade,
        CUFF_BREAK_PIXELS,
        true,
      );
    }
  });
}

/** The buttoned cuff, narrower than the bunched sleeve above it, with its gold link. */
export function paintCuff(
  ctx: Ctx,
  build: ArmBuild,
  elbow: Pt,
  wrist: Pt,
  detail: SleeveDetail,
): void {
  const axis = unit(elbow, wrist);
  const normal = pt(-axis.y, axis.x);
  const gap = build.cuffLength * CUFF_WRIST_GAP;
  const near = pt(wrist.x - axis.x * gap, wrist.y - axis.y * gap);
  const far = pt(near.x - axis.x * build.cuffLength, near.y - axis.y * build.cuffLength);
  const r = build.cuffRadius;
  const corners = [
    pt(far.x + normal.x * r, far.y + normal.y * r),
    pt(near.x + normal.x * r, near.y + normal.y * r),
    pt(near.x - normal.x * r, near.y - normal.y * r),
    pt(far.x - normal.x * r, far.y - normal.y * r),
  ];
  const cuff: Trace = (c) => traceSmoothLoop(c, corners);
  outlineTrace(ctx, cuff, detail === 'full' ? OUTLINE_PIXELS : SIMPLE_OUTLINE_PIXELS);
  paintForm(ctx, cuff, SHIRT, {
    shadow: r * CUFF_SHADING.shadow,
    highlight: r * CUFF_SHADING.highlight,
  });
  if (detail === 'simple') return;
  // The bunched sleeve overhangs the cuff's far edge and shades it.
  strokeLine(ctx, [corners[0], corners[3]], SHIRT.deep, CUFF_BREAK_PIXELS);
  const link = pt(
    far.x + axis.x * build.cuffLength * CUFF_LINK_ALONG + normal.x * r * CUFF_LINK_ACROSS,
    far.y + axis.y * build.cuffLength * CUFF_LINK_ALONG + normal.y * r * CUFF_LINK_ACROSS,
  );
  const linkRadius = r * CUFF_LINK_RADIUS;
  const linkTrace: Trace = (c) => traceEllipse(c, link.x, link.y, linkRadius, linkRadius);
  outlineTrace(ctx, linkTrace, CUFF_LINK_OUTLINE_PIXELS);
  paintForm(ctx, linkTrace, GOLD, {
    shadow: linkRadius * CUFF_LINK_SHADING.shadow,
    highlight: linkRadius * CUFF_LINK_SHADING.highlight,
  });
}
