/**
 * The Grotesque Spider's egg: a leathery, veined, slightly elongated sac lying
 * in a dark wet smear, seen from above. Mid-toned and lumpy, with torn
 * membrane tags breaking its outline: a round, pale, smooth egg reads at game
 * size as a pearl or a fried egg, and a sac a player has to smash should look
 * like flesh.
 *
 * Its whole job is to be a countdown a player can read without any UI. As it
 * incubates the pulse quickens, a shadow wriggles inside and darkens, it cracks
 * once at half-time and again at three-quarters, and over the last quarter it
 * shakes violently with a green light behind the membrane. The rows are:
 *
 * - `land` — the drop and splat.
 * - `incubate` — keyed by hatch progress 0→1, one frame per slice of it.
 * - `hatch` — the sac tearing open.
 * - `destroyed` — squashed flat into goo; its last frame is the decal left behind.
 *
 * {@link paintEggSac} draws one egg at any size in whatever units the caller is
 * working in, so the spider's own lay pose paints the same egg she drops.
 */

import { clamp01, easeOut, lerp, ramp, rgba } from './carlArt';
import { fillSoftEllipse, withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

const EGG_PALETTE = {
  shellLight: '#c4a0a4',
  shellMid: '#8e6874',
  shellEdge: '#402630',
  tag: '#6a4252',
  outline: '#1a120c',
  vein: '#2e3a16',
  veinCore: '#8aa04a',
  mottle: '#3e3226',
  crease: '#2a2018',
  smear: '#141c06',
  smearGloss: '#c4cc98',
  goo: '#6a7e1c',
  gooDark: '#26300a',
  gooLight: '#9cb238',
  wriggle: '#140e0c',
  glow: '#62e012',
  crack: '#140c08',
  shadow: '#000000',
  gloss: '#fbf6e4',
} as const;

/**
 * The ramp the shell is shaded along, lit crown then mid tone, so a gate
 * looking for the egg in another figure's pixels can tell its leathery hide
 * from everything round it.
 */
export const SPIDER_EGG_SHELL_COLOURS: readonly [string, string] = [
  EGG_PALETTE.shellLight,
  EGG_PALETTE.shellMid,
];

/** Everything about one egg that varies between frames. */
export interface EggLook {
  /** How wet and fresh the smear under it is, 0–1. */
  readonly wet: number;
  /** Landing splash, 0 none to 1 spread out and fading. */
  readonly splat: number;
  /** The throb, -1 contracted to +1 swollen. */
  readonly pulse: number;
  /** How many cracks have opened: 0, 1 or 2. */
  readonly crack?: number;
  /** Green light behind the membrane, 0–1. */
  readonly glow?: number;
  /** The wriggling shadow inside: its darkness, 0–1, and where it has squirmed to. */
  readonly wriggle?: {
    readonly dark: number;
    readonly x: number;
    readonly y: number;
    readonly angle: number;
  };
  /** Sideways jolt, in egg radii. */
  readonly shake?: number;
  /** Vertical squash-and-stretch; 1 is round. */
  readonly squash?: number;
}

const OUTLINE_SHARE = 0.09;
/** Narrower than long, along the egg's long axis: an ovoid sac rather than a ball. */
const SAC_WIDTH = 0.84;
const SAC_LENGTH = 1.1;
const PULSE_SWELL = 0.16;
/**
 * The outline is lumpy: [frequency, amplitude, phase] of the bumps round it.
 * A clean ellipse is a pearl; a sac is stretched unevenly over what is inside.
 */
const SAC_LUMPS: readonly (readonly [number, number, number])[] = [
  [3, 0.05, 0.7],
  [5, 0.035, 2.0],
  [7, 0.02, 4.1],
];
const SAC_POINTS = 36;
/**
 * Torn membrane tags standing off the outline: [angle, length, base width],
 * in radians and egg radii. They break its silhouette, which is what stops it
 * reading as a smooth round object at game size.
 */
const MEMBRANE_TAGS: readonly (readonly [number, number, number])[] = [
  [0.6, 0.34, 0.42],
  [2.4, 0.26, 0.34],
  [3.7, 0.38, 0.44],
  [5.3, 0.24, 0.32],
];
/** Tags are rooted a little inside the outline, so they grow out of it. */
const TAG_ROOT_INSET = 0.9;
/** Each tag curls a little off the outward normal, like a flap of skin. */
const TAG_CURL = 0.5;
const SMEAR_SCALE = 1.35;
const SMEAR_ALPHA = 0.8;
const SMEAR_CORE = 0.6;
const SMEAR_LOBES: readonly (readonly [number, number, number])[] = [
  [0.75, -0.35, 0.6],
  [-0.8, 0.3, 0.5],
  [0.2, 0.95, 0.45],
  [-0.4, -0.85, 0.4],
];
/** Wet streaks on the smear, where the light catches it. */
const SMEAR_GLOSSES: readonly {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
  readonly alpha: number;
}[] = [
  { x: -0.95, y: -0.55, length: 0.45, width: 0.07, alpha: 0.6 },
  { x: 0.75, y: 0.7, length: 0.3, width: 0.06, alpha: 0.5 },
];
const SHADOW_ALPHA = 0.45;
const SHADOW_DROP = 0.12;
const SHADOW_SPREAD_X = 1.1;
const SHADOW_SPREAD_Y = 1.05;
/**
 * Landing splatter, [angle, reach, size] in radians and egg radii: uneven and
 * lopsided. Drops evenly spaced round the egg read as a pickup's sparkle.
 */
const SPLAT_DROPS: readonly (readonly [number, number, number])[] = [
  [0.3, 1.5, 0.24],
  [0.9, 1.9, 0.14],
  [2.1, 1.3, 0.2],
  [3.4, 1.7, 0.16],
  [4.1, 1.35, 0.26],
  [5.6, 2.1, 0.12],
];
const SPLAT_START_REACH = 0.7;
const VEINS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-0.8, -0.3, -0.3, -0.6, 0.2, -0.85],
  [-0.6, 0.6, -0.1, 0.1, 0.5, 0.2],
  [0.85, -0.1, 0.5, 0.35, 0.3, 0.85],
  [-0.2, -0.95, 0.1, -0.4, 0.7, -0.5],
  [-0.95, 0.2, -0.55, 0.4, -0.35, 0.9],
];
const VEIN_SHARE = 0.1;
const VEIN_ALPHA = 0.85;
const VEIN_CORE_SHARE = 0.35;
const VEIN_CORE_ALPHA = 0.45;
/** Dark blotches in the hide: [x, y, size], in egg radii. */
const MOTTLES: readonly (readonly [number, number, number])[] = [
  [0.35, 0.4, 0.3],
  [-0.45, -0.1, 0.25],
  [0.1, -0.6, 0.2],
];
const MOTTLE_ALPHA = 0.45;
/** Short creases where the leathery hide folds: [x, y, angle], in egg radii and radians. */
const CREASES: readonly (readonly [number, number, number])[] = [
  [-0.35, 0.45, 0.5],
  [0.45, -0.35, 2.2],
];
const CREASE_LENGTH = 0.35;
const CREASE_SHARE = 0.05;
const CREASE_ALPHA = 0.6;
const WRIGGLE_BODY = 0.36;
const WRIGGLE_LEGS = 8;
const WRIGGLE_LEG_LENGTH = 0.24;
const WRIGGLE_LEG_WIDTH = 0.07;
const WRIGGLE_BODY_ASPECT = 0.8;
/** How far the four legs on each flank fan from front to back, radians either side. */
const WRIGGLE_LEG_FAN = 0.7;
const WRIGGLE_KNEE_BEND = 0.9;
const WRIGGLE_ALPHA = 0.85;
const GLOW_ALPHA = 0.95;
const GLOW_EXTENT = 0.9;
const GLOW_CORE = 0.55;
const WRIGGLE_CORE = 0.5;
/**
 * The cracks: how many cracks the egg must have for each stroke to show, and
 * its path in egg radii. Each opening is a short web — a zigzag with spurs
 * forking off it — rather than one line: a single bolt reads as a lightning
 * sign, and two lines meeting read as a bird or, lit green, a running figure.
 */
const CRACKS: readonly {
  readonly opensAt: number;
  readonly points: readonly (readonly [number, number])[];
}[] = [
  {
    opensAt: 1,
    points: [
      [-0.05, -0.75],
      [0.08, -0.45],
      [-0.06, -0.2],
      [0.1, 0.05],
      [-0.02, 0.3],
    ],
  },
  {
    opensAt: 1,
    points: [
      [0.08, -0.45],
      [0.3, -0.52],
      [0.42, -0.4],
    ],
  },
  {
    opensAt: 1,
    points: [
      [0.1, 0.05],
      [0.26, 0.14],
    ],
  },
  {
    opensAt: 2,
    points: [
      [-0.06, -0.2],
      [-0.3, -0.05],
      [-0.42, 0.2],
      [-0.65, 0.3],
    ],
  },
  {
    opensAt: 2,
    points: [
      [-0.3, -0.05],
      [-0.44, -0.3],
    ],
  },
  {
    opensAt: 2,
    points: [
      [-0.02, 0.3],
      [0.14, 0.5],
      [0.05, 0.66],
    ],
  },
];
const CRACK_SHARE = 0.13;
/**
 * The glow leaking through the cracks is a thin, dim seam inside each dark
 * crack: lit bright and wide, the web of cracks becomes a green glyph drawn
 * on the egg instead of light from inside it.
 */
const CRACK_GLOW_SHARE = 0.3;
const CRACK_GLOW_ALPHA = 0.7;
/**
 * Two small hard glints, one large and one small: wet leather. A broad soft
 * gloss over a round egg is a pearl's.
 */
const GLINTS: readonly (readonly [number, number, number, number])[] = [
  [-0.38, -0.42, 0.13, 0.07],
  [0.32, -0.18, 0.06, 0.04],
];
const GLINT_ANGLE = -0.6;
const GLINT_ALPHA = 0.9;
/** The shell's light falls off from a point up and to the left of its centre. */
const SHELL_LIGHT_X = -0.2;
const SHELL_LIGHT_Y = -0.3;
const SHELL_MID_STOP = 0.55;

/** The lumpy outline of a sac of half-extents (rx, ry) round (x, y), grown by `grow`. */
function sacPath(ctx: Ctx, x: number, y: number, rx: number, ry: number, grow: number): void {
  ctx.beginPath();
  for (let i = 0; i <= SAC_POINTS; i++) {
    const a = (i / SAC_POINTS) * TWO_PI;
    let k = 1;
    for (const [frequency, amplitude, phase] of SAC_LUMPS) {
      k += Math.sin(a * frequency + phase) * amplitude;
    }
    const px = x + Math.cos(a) * (rx * k + grow);
    const py = y + Math.sin(a) * (ry * k + grow);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** One membrane tag, a curled triangle of skin rooted just inside the outline. */
function tagPath(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  r: number,
  tag: readonly [number, number, number],
  grow: number,
): void {
  const [angle, length, width] = tag;
  const root = {
    x: x + Math.cos(angle) * rx * TAG_ROOT_INSET,
    y: y + Math.sin(angle) * ry * TAG_ROOT_INSET,
  };
  const across = angle + Math.PI * HALF;
  const out = angle + TAG_CURL;
  const half = r * width * HALF + grow;
  const reach = r * length + grow;
  const tip = { x: root.x + Math.cos(out) * reach, y: root.y + Math.sin(out) * reach };
  // A blunt, lopsided flap: a pointed tag reads as a thorn.
  ctx.beginPath();
  ctx.moveTo(root.x + Math.cos(across) * half, root.y + Math.sin(across) * half);
  ctx.quadraticCurveTo(
    tip.x + Math.cos(across) * half,
    tip.y + Math.sin(across) * half,
    tip.x,
    tip.y,
  );
  ctx.quadraticCurveTo(
    lerp(root.x, tip.x, HALF) - Math.cos(across) * half,
    lerp(root.y, tip.y, HALF) - Math.sin(across) * half,
    root.x - Math.cos(across) * half,
    root.y - Math.sin(across) * half,
  );
  ctx.closePath();
}

function strokeCurve(
  ctx: Ctx,
  points: readonly [number, number, number, number, number, number],
  ex: number,
  y: number,
  rx: number,
  ry: number,
): void {
  const [x1, y1, cx, cy, x2, y2] = points;
  ctx.beginPath();
  ctx.moveTo(ex + x1 * rx, y + y1 * ry);
  ctx.quadraticCurveTo(ex + cx * rx, y + cy * ry, ex + x2 * rx, y + y2 * ry);
  ctx.stroke();
}

/** The dark wet smear an egg lies in, with one wet streak on it. */
function paintSmear(ctx: Ctx, x: number, y: number, r: number, wet: number): void {
  fillSoftEllipse(
    ctx,
    x,
    y,
    r * SMEAR_SCALE,
    r * SMEAR_SCALE * SAC_LENGTH,
    EGG_PALETTE.smear,
    SMEAR_ALPHA * wet,
    0,
    SMEAR_CORE,
  );
  for (const [lx, ly, size] of SMEAR_LOBES) {
    fillSoftEllipse(
      ctx,
      x + lx * r * SMEAR_SCALE,
      y + ly * r * SMEAR_SCALE,
      r * size,
      r * size,
      EGG_PALETTE.smear,
      SMEAR_ALPHA * wet,
      0,
      SMEAR_CORE,
    );
  }
  ctx.lineCap = 'round';
  for (const gloss of SMEAR_GLOSSES) {
    const gx = x + gloss.x * r;
    const gy = y + gloss.y * r;
    ctx.strokeStyle = rgba(EGG_PALETTE.smearGloss, gloss.alpha * wet);
    ctx.lineWidth = r * gloss.width;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + r * gloss.length * HALF, gy + r * gloss.length);
    ctx.stroke();
  }
}

/** Lopsided drops of goo thrown out round an egg as it lands. */
function paintSplat(ctx: Ctx, x: number, y: number, r: number, splat: number): void {
  const reach = lerp(SPLAT_START_REACH, 1, easeOut(splat));
  const fade = 1 - splat * HALF;
  for (const [angle, distance, size] of SPLAT_DROPS) {
    const d = r * distance * reach;
    fillSoftEllipse(
      ctx,
      x + Math.cos(angle) * d,
      y + Math.sin(angle) * d,
      r * size,
      r * size * SAC_WIDTH,
      EGG_PALETTE.gooDark,
      fade,
      angle,
      SMEAR_CORE,
    );
  }
}

/**
 * Paints one egg centred on (x, y) with radius `r`, in the caller's units.
 *
 * Line weights scale with `r`, so the same call reads the same at any size.
 */
export function paintEggSac(ctx: Ctx, x: number, y: number, r: number, look: EggLook): void {
  const swell = 1 + look.pulse * PULSE_SWELL;
  const squash = look.squash ?? 1;
  const ex = x + (look.shake ?? 0) * r;
  const rx = (r * SAC_WIDTH * swell) / Math.sqrt(squash);
  const ry = r * SAC_LENGTH * swell * squash;
  const line = r * OUTLINE_SHARE;

  if (look.wet > 0) paintSmear(ctx, x, y, r, look.wet);
  if (look.splat > 0) paintSplat(ctx, x, y, r, look.splat);
  fillSoftEllipse(
    ctx,
    ex,
    y + ry * SHADOW_DROP,
    rx * SHADOW_SPREAD_X,
    ry * SHADOW_SPREAD_Y,
    EGG_PALETTE.shadow,
    SHADOW_ALPHA,
  );

  ctx.fillStyle = EGG_PALETTE.outline;
  for (const tag of MEMBRANE_TAGS) {
    tagPath(ctx, ex, y, rx, ry, r, tag, line);
    ctx.fill();
  }
  sacPath(ctx, ex, y, rx, ry, line);
  ctx.fill();
  const shell = ctx.createRadialGradient(
    ex + rx * SHELL_LIGHT_X,
    y + ry * SHELL_LIGHT_Y,
    0,
    ex,
    y,
    Math.max(rx, ry),
  );
  shell.addColorStop(0, EGG_PALETTE.shellLight);
  shell.addColorStop(SHELL_MID_STOP, EGG_PALETTE.shellMid);
  shell.addColorStop(1, EGG_PALETTE.shellEdge);
  ctx.fillStyle = EGG_PALETTE.tag;
  // The tags are filled after the outline, so each one breaks it where it joins.
  for (const tag of MEMBRANE_TAGS) {
    tagPath(ctx, ex, y, rx, ry, r, tag, 0);
    ctx.fill();
  }
  ctx.fillStyle = shell;
  sacPath(ctx, ex, y, rx, ry, 0);
  ctx.fill();

  withClip(
    ctx,
    () => sacPath(ctx, ex, y, rx, ry, 0),
    () => {
      for (const [mx, my, size] of MOTTLES) {
        fillSoftEllipse(
          ctx,
          ex + mx * rx,
          y + my * ry,
          size * rx,
          size * ry,
          EGG_PALETTE.mottle,
          MOTTLE_ALPHA,
        );
      }
      const glow = look.glow ?? 0;
      if (glow > 0) {
        fillSoftEllipse(
          ctx,
          ex,
          y,
          rx * GLOW_EXTENT,
          ry * GLOW_EXTENT,
          EGG_PALETTE.glow,
          GLOW_ALPHA * glow,
          0,
          GLOW_CORE,
        );
      }
      const wriggle = look.wriggle;
      if (wriggle !== undefined && wriggle.dark > 0) {
        const wx = ex + wriggle.x * rx;
        const wy = y + wriggle.y * ry;
        const alpha = WRIGGLE_ALPHA * wriggle.dark;
        fillSoftEllipse(
          ctx,
          wx,
          wy,
          r * WRIGGLE_BODY,
          r * WRIGGLE_BODY * WRIGGLE_BODY_ASPECT,
          EGG_PALETTE.wriggle,
          alpha,
          wriggle.angle,
          WRIGGLE_CORE,
        );
        ctx.strokeStyle = rgba(EGG_PALETTE.wriggle, alpha * HALF);
        ctx.lineWidth = r * WRIGGLE_LEG_WIDTH;
        ctx.lineCap = 'round';
        // Legs folded along both flanks of a curled body, bent back at the
        // knee: legs radiating evenly round a blob read as a sun or a star.
        const perSide = WRIGGLE_LEGS / 2;
        for (let i = 0; i < WRIGGLE_LEGS; i++) {
          const side = i < perSide ? 1 : -1;
          const spread = lerp(-WRIGGLE_LEG_FAN, WRIGGLE_LEG_FAN, (i % perSide) / (perSide - 1));
          const a = wriggle.angle + side * (Math.PI * HALF + spread);
          const root = {
            x: wx + Math.cos(a) * r * WRIGGLE_BODY,
            y: wy + Math.sin(a) * r * WRIGGLE_BODY * WRIGGLE_BODY_ASPECT,
          };
          const reach = r * WRIGGLE_LEG_LENGTH;
          const knee = a + side * WRIGGLE_KNEE_BEND;
          ctx.beginPath();
          ctx.moveTo(root.x, root.y);
          ctx.quadraticCurveTo(
            root.x + Math.cos(a) * reach,
            root.y + Math.sin(a) * reach,
            root.x + Math.cos(knee) * reach,
            root.y + Math.sin(knee) * reach,
          );
          ctx.stroke();
        }
      }
      ctx.lineCap = 'round';
      // Dark bile-green veins with a paler core standing proud of the
      // leather, like vessels under skin. Red veins on an egg are an eyeball's.
      for (const vein of VEINS) {
        ctx.strokeStyle = rgba(EGG_PALETTE.vein, VEIN_ALPHA);
        ctx.lineWidth = r * VEIN_SHARE;
        strokeCurve(ctx, vein, ex, y, rx, ry);
        ctx.strokeStyle = rgba(EGG_PALETTE.veinCore, VEIN_CORE_ALPHA);
        ctx.lineWidth = r * VEIN_SHARE * VEIN_CORE_SHARE;
        strokeCurve(ctx, vein, ex, y, rx, ry);
      }
      ctx.strokeStyle = rgba(EGG_PALETTE.crease, CREASE_ALPHA);
      ctx.lineWidth = r * CREASE_SHARE;
      for (const [cx, cy, angle] of CREASES) {
        const dx = Math.cos(angle) * r * CREASE_LENGTH * HALF;
        const dy = Math.sin(angle) * r * CREASE_LENGTH * HALF;
        ctx.beginPath();
        ctx.moveTo(ex + cx * rx - dx, y + cy * ry - dy);
        ctx.quadraticCurveTo(
          ex + cx * rx + dy,
          y + cy * ry - dx,
          ex + cx * rx + dx,
          y + cy * ry + dy,
        );
        ctx.stroke();
      }
      for (const [gx, gy, grx, gry] of GLINTS) {
        fillSoftEllipse(
          ctx,
          ex + gx * rx,
          y + gy * ry,
          grx * rx,
          gry * ry,
          EGG_PALETTE.gloss,
          GLINT_ALPHA,
          GLINT_ANGLE,
          HALF,
        );
      }
      const crack = look.crack ?? 0;
      for (const { opensAt, points } of CRACKS) {
        if (crack < opensAt) continue;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        points.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(ex + px * rx, y + py * ry);
          else ctx.lineTo(ex + px * rx, y + py * ry);
        });
        ctx.strokeStyle = EGG_PALETTE.crack;
        ctx.lineWidth = r * CRACK_SHARE;
        ctx.stroke();
        if (glow > 0) {
          ctx.strokeStyle = rgba(EGG_PALETTE.glow, glow * CRACK_GLOW_ALPHA);
          ctx.lineWidth = r * CRACK_SHARE * CRACK_GLOW_SHARE;
          ctx.stroke();
        }
      }
    },
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** The egg's rows. */
export type SpiderEggState = 'land' | 'incubate' | 'hatch' | 'destroyed';

/** Frames per row, shared by the figure and the runtime wrapper. */
export const SPIDER_EGG_FRAMES: Readonly<Record<SpiderEggState, number>> = {
  land: 6,
  incubate: 24,
  hatch: 8,
  destroyed: 6,
};

/** About six-tenths of a tile across. */
export const SPIDER_EGG_RADIUS_TILES = 0.3;

/** Progress at which each crack opens. */
export const EGG_FIRST_CRACK_AT = 0.5;
export const EGG_SECOND_CRACK_AT = 0.75;
/** The last stretch before hatching, when it shakes and glows. */
export const EGG_FRENZY_AT = 0.75;

/**
 * Pulse cycles per incubate frame at the start and the end of incubation.
 *
 * Frames are picked by hatch progress, so each is held for an equal slice of the
 * hatch timer and the pulse speeds up only by stepping further round its cycle
 * per frame. The end rate stays under half a cycle per frame: past that the
 * throb aliases into a slower one, or a strobe.
 */
const PULSE_RATE_START = 0.1;
const PULSE_RATE_END = 0.42;
const FRENZY_GLOW_FLOOR = 0.5;
const SHAKE_START = 0.05;
const SHAKE_END = 0.16;
/** The shadow inside is faintly there from the start, and darkens from here on. */
const WRIGGLE_FROM = 0;
const WRIGGLE_FAINTEST = 0.65;
const WRIGGLE_RANGE = 0.35;

/** The throb's phase at each incubate frame, accumulated so it only ever quickens. */
function pulsePhases(frames: number): readonly number[] {
  const phases: number[] = [];
  let phase = 0;
  for (let f = 0; f < frames; f++) {
    phases.push(phase);
    const progress = f / Math.max(frames - 1, 1);
    phase += lerp(PULSE_RATE_START, PULSE_RATE_END, progress * progress);
  }
  return phases;
}

/** The throb's phase, in cycles, at each incubate frame. */
export const INCUBATE_PULSE_PHASES = pulsePhases(SPIDER_EGG_FRAMES.incubate);

function hashFrame(n: number): number {
  const raw = Math.sin(n * 78.233 + 1.7) * 24634.6345;
  return raw - Math.floor(raw);
}

/** How the egg looks at a hatch progress, with the pulse phase for that frame. */
export function incubatingLook(progress: number, phase: number, frame: number): EggLook {
  const frenzy = ramp(progress, EGG_FRENZY_AT, 1);
  const crack = progress >= EGG_SECOND_CRACK_AT ? 2 : progress >= EGG_FIRST_CRACK_AT ? 1 : 0;
  const shakeSign = frame % 2 === 0 ? 1 : -1;
  return {
    wet: 1 - progress * HALF,
    splat: 0,
    pulse: Math.sin(phase * TWO_PI),
    crack,
    // The glow switches on at the frenzy rather than fading in, so the last
    // quarter is unmistakable from its first frame.
    glow: progress >= EGG_FRENZY_AT ? FRENZY_GLOW_FLOOR + (1 - FRENZY_GLOW_FLOOR) * frenzy : 0,
    shake: progress >= EGG_FRENZY_AT ? shakeSign * lerp(SHAKE_START, SHAKE_END, frenzy) : 0,
    wriggle: {
      dark: lerp(WRIGGLE_FAINTEST, 1, clamp01((progress - WRIGGLE_FROM) / (1 - WRIGGLE_FROM))),
      x: (hashFrame(frame) - HALF) * WRIGGLE_RANGE * 2,
      y: (hashFrame(frame + 31) - HALF) * WRIGGLE_RANGE * 2,
      angle: hashFrame(frame + 7) * TWO_PI,
    },
  };
}

const LAND_SQUASH_START = 0.55;
const LAND_SQUASH_OVERSHOOT = 1.12;
const LAND_SPLAT_START = 0.15;

function paintLand(ctx: Ctx, r: number, progress: number): void {
  const squash =
    progress < HALF
      ? lerp(LAND_SQUASH_START, LAND_SQUASH_OVERSHOOT, progress / HALF)
      : lerp(LAND_SQUASH_OVERSHOOT, 1, (progress - HALF) / HALF);
  paintEggSac(ctx, 0, 0, r, {
    wet: 1,
    splat: lerp(LAND_SPLAT_START, 1, progress),
    pulse: 0,
    squash,
  });
}

function paintIncubate(ctx: Ctx, r: number, frame: number): void {
  const frames = SPIDER_EGG_FRAMES.incubate;
  const progress = frame / (frames - 1);
  paintEggSac(ctx, 0, 0, r, incubatingLook(progress, INCUBATE_PULSE_PHASES[frame], frame));
}

/**
 * Membrane shreds flung off a burst sac: [angle, reach, length, curl], in
 * radians and egg radii. Few, uneven, and thrown mostly one way: an even ring
 * of flying bits round a centre reads as a pickup's sparkle, not a burst.
 */
const SHREDS: readonly (readonly [number, number, number, number])[] = [
  [0.2, 1.6, 0.8, 0.6],
  [0.9, 1.2, 0.6, -0.8],
  [1.6, 1.9, 0.5, 0.9],
  [4.5, 1.35, 0.7, -0.5],
  [5.4, 1.8, 0.45, 0.7],
];
const SHRED_WIDTH = 0.26;
const SHRED_START_REACH = 0.8;
/**
 * The spilled goo, [x, y, size] in egg radii: a lopsided pool run out to one
 * side of the sac, not a halo round it.
 */
const GOO_BLOBS: readonly (readonly [number, number, number])[] = [
  [0.2, 0.2, 1.05],
  [0.95, 0.55, 0.7],
  [1.5, 0.2, 0.42],
  [-0.6, 0.75, 0.45],
  [0.6, -0.8, 0.36],
];
const GOO_START_SIZE = 0.4;
const GOO_ALPHA = 0.9;
const GOO_CORE = 0.7;
/** The lighter wet sheet on the goo, toward the light. */
const GOO_LIGHT_SHARE = 0.5;
const GOO_LIGHT_SHIFT = -0.25;
const GOO_LIGHT_ALPHA = 0.7;
/**
 * The burst sac: split down its long axis, the two halves peeled out and
 * sagging open round a wet dark hollow. How wide the split opens, against the
 * sac's width, and how ragged its lips are.
 */
const SPLIT_OPEN_FROM = 0.2;
const SPLIT_OPEN_TO = 0.85;
const SPLIT_POINTS = 14;
const SPLIT_RAGGED = 0.35;
const SPLIT_SEED = 23;
/** The burst sac slumps: flatter and wider than the whole one. */
const BURST_SLUMP = 0.82;
const BURST_BULGE_SHARE = 0.3;
const HATCH_GLOW_SHARE = 0.6;
/** Squashed flat, the sac is this much wider and this much shorter. */
const CRUSH_WIDEN = 1.45;
const CRUSH_FLATTEN = 0.55;
const CRUSH_GOO_GROW = 1.3;

/** A tapering strip of torn membrane from (x, y) along `angle`, curling as it goes. */
function drawShred(
  ctx: Ctx,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
  curl: number,
): void {
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const tip = { x: x + along.x * length, y: y + along.y * length };
  const bend = {
    x: x + along.x * length * HALF + across.x * curl * length * HALF,
    y: y + along.y * length * HALF + across.y * curl * length * HALF,
  };
  const half = width * HALF;
  const path = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(x + across.x * (half + grow), y + across.y * (half + grow));
    ctx.quadraticCurveTo(bend.x, bend.y, tip.x, tip.y);
    ctx.quadraticCurveTo(
      bend.x,
      bend.y,
      x - across.x * (half + grow),
      y - across.y * (half + grow),
    );
    ctx.closePath();
  };
  ctx.fillStyle = EGG_PALETTE.outline;
  path(width * OUTLINE_SHARE * 2);
  ctx.fill();
  ctx.fillStyle = EGG_PALETTE.tag;
  path(0);
  ctx.fill();
}

/** The goo pool a burst or crushed sac leaves, grown by `spread` 0→1. */
function paintGoo(ctx: Ctx, r: number, spread: number, grow: number): void {
  const size = lerp(GOO_START_SIZE, 1, spread) * grow;
  for (const [gx, gy, blob] of GOO_BLOBS) {
    fillSoftEllipse(
      ctx,
      gx * r * size,
      gy * r * size,
      r * blob * size,
      r * blob * size * SAC_WIDTH,
      EGG_PALETTE.gooDark,
      GOO_ALPHA,
      0,
      GOO_CORE,
    );
  }
  for (const [gx, gy, blob] of GOO_BLOBS) {
    fillSoftEllipse(
      ctx,
      (gx + GOO_LIGHT_SHIFT) * r * size,
      (gy + GOO_LIGHT_SHIFT) * r * size,
      r * blob * size * GOO_LIGHT_SHARE,
      r * blob * size * GOO_LIGHT_SHARE * SAC_WIDTH,
      EGG_PALETTE.goo,
      GOO_LIGHT_ALPHA,
    );
  }
}

/** The ragged split down the sac's long axis, `open` 0 shut to 1 gaping. */
function splitPath(ctx: Ctx, rx: number, ry: number, open: number): void {
  const halfWidth = rx * lerp(SPLIT_OPEN_FROM, SPLIT_OPEN_TO, open);
  ctx.beginPath();
  for (const side of [1, -1]) {
    for (let k = 0; k <= SPLIT_POINTS; k++) {
      const i = side > 0 ? k : SPLIT_POINTS - k;
      const t = i / SPLIT_POINTS;
      const ragged = 1 - SPLIT_RAGGED * hashFrame(i * 2 + (side > 0 ? 0 : 1) + SPLIT_SEED);
      const x = side * halfWidth * Math.sin(t * Math.PI) * ragged;
      const y = lerp(-ry, ry, t) * (1 - OUTLINE_SHARE);
      if (k === 0 && side > 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

/** The emptied sac, split and slumped open, its hollow dark and wet. */
function paintBurstSac(ctx: Ctx, r: number, open: number, slump: number): void {
  const rx = r * SAC_WIDTH * lerp(1, CRUSH_WIDEN, slump);
  const ry = r * SAC_LENGTH * lerp(BURST_SLUMP, CRUSH_FLATTEN, slump);
  const line = r * OUTLINE_SHARE;
  ctx.fillStyle = EGG_PALETTE.outline;
  for (const tag of MEMBRANE_TAGS) {
    tagPath(ctx, 0, 0, rx, ry, r, tag, line);
    ctx.fill();
  }
  sacPath(ctx, 0, 0, rx, ry, line);
  ctx.fill();
  ctx.fillStyle = EGG_PALETTE.tag;
  for (const tag of MEMBRANE_TAGS) {
    tagPath(ctx, 0, 0, rx, ry, r, tag, 0);
    ctx.fill();
  }
  const shell = ctx.createRadialGradient(rx * SHELL_LIGHT_X, ry * SHELL_LIGHT_Y, 0, 0, 0, rx);
  shell.addColorStop(0, EGG_PALETTE.shellMid);
  shell.addColorStop(1, EGG_PALETTE.shellEdge);
  ctx.fillStyle = shell;
  sacPath(ctx, 0, 0, rx, ry, 0);
  ctx.fill();
  ctx.fillStyle = EGG_PALETTE.outline;
  splitPath(ctx, rx, ry, open);
  ctx.fill();
  ctx.fillStyle = EGG_PALETTE.gooDark;
  ctx.save();
  try {
    ctx.scale(1 - OUTLINE_SHARE * 2, 1 - OUTLINE_SHARE * 2);
    splitPath(ctx, rx, ry, open);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

function paintHatch(ctx: Ctx, r: number, progress: number): void {
  if (progress < BURST_BULGE_SHARE) {
    const bulge = progress / BURST_BULGE_SHARE;
    paintEggSac(ctx, 0, 0, r, {
      wet: HALF,
      splat: 0,
      pulse: 1 + bulge,
      crack: 2,
      glow: 1,
      shake: bulge * SHAKE_END,
    });
    return;
  }
  const open = easeOut((progress - BURST_BULGE_SHARE) / (1 - BURST_BULGE_SHARE));
  paintSmear(ctx, 0, 0, r, 1);
  paintGoo(ctx, r, open, 1);
  paintBurstSac(ctx, r, open, 0);
  fillSoftEllipse(
    ctx,
    0,
    0,
    r * SAC_WIDTH * HATCH_GLOW_SHARE,
    r * SAC_LENGTH * HATCH_GLOW_SHARE,
    EGG_PALETTE.glow,
    (1 - open) * GLOW_ALPHA,
  );
  for (const [angle, reach, length, curl] of SHREDS) {
    const d = r * lerp(SHRED_START_REACH, reach, open);
    drawShred(
      ctx,
      Math.cos(angle) * d,
      Math.sin(angle) * d,
      r * length,
      r * SHRED_WIDTH,
      angle + curl * open,
      curl,
    );
  }
}

/** A squashed sac: flattened and split in a pool of goo, shreds pressed into it. */
function paintDestroyed(ctx: Ctx, r: number, progress: number): void {
  const spread = easeOut(progress);
  paintGoo(ctx, r, spread, CRUSH_GOO_GROW);
  paintBurstSac(ctx, r, 1, spread);
  for (const [angle, reach, length, curl] of SHREDS) {
    const d = r * lerp(HALF, reach, spread);
    drawShred(
      ctx,
      Math.cos(angle) * d,
      Math.sin(angle) * d,
      r * length,
      r * SHRED_WIDTH,
      angle,
      curl,
    );
  }
}

/**
 * Paints one frame of one egg row centred on (cx, cy), with `ts` the tile size.
 */
export function drawSpiderEgg(
  ctx: Ctx,
  cx: number,
  cy: number,
  ts: number,
  state: SpiderEggState,
  frame: number,
): void {
  const frames = SPIDER_EGG_FRAMES[state];
  const progress = frames > 1 ? frame / (frames - 1) : 1;
  const r = SPIDER_EGG_RADIUS_TILES;
  ctx.save();
  try {
    ctx.translate(cx, cy);
    ctx.scale(ts, ts);
    if (state === 'land') paintLand(ctx, r, progress);
    else if (state === 'incubate') paintIncubate(ctx, r, frame);
    else if (state === 'hatch') paintHatch(ctx, r, progress);
    else paintDestroyed(ctx, r, progress);
  } finally {
    ctx.restore();
  }
}
