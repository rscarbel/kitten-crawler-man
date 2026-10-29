/**
 * The seven pieces an adult Gravedigger Beetle comes apart into.
 *
 * An insect bleeds pale hemolymph, not red, so every cut face is washed in it.
 * The set is chosen for silhouette variety at 16 px: the head with its shear
 * mandibles, the domed pronotum, a banded wing case (the piece that names the
 * creature), a ragged hind wing, a thin bent leg, an antenna with its orange
 * club, and the segmented abdomen.
 *
 * Each piece is painted about its own centre, so `BodyPartGoreSystem` can spin
 * it about its ink without a frozen recentring table.
 */

import {
  TWO_PI,
  deg,
  ovalOutline,
  paintChitin,
  rgba,
  segmentOutline,
  traceOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt';
import { GRAVEDIGGER_PALETTE } from './gravediggerAdultArt';

type Ctx = CanvasRenderingContext2D;

const HEMOLYMPH = '#cfd27a';
const HEMOLYMPH_DARK = '#666b2c';
const WASH_ALPHA = 0.7;
const SEED = 33.1;

const SHELL: MantidBuild = {
  palette: {
    base: GRAVEDIGGER_PALETTE.shell,
    dark: GRAVEDIGGER_PALETTE.shellDark,
    light: GRAVEDIGGER_PALETTE.shellLight,
    rim: GRAVEDIGGER_PALETTE.shellRim,
    ink: GRAVEDIGGER_PALETTE.ink,
    sheen: GRAVEDIGGER_PALETTE.shellRim,
    eye: GRAVEDIGGER_PALETTE.eye,
    eyeDark: GRAVEDIGGER_PALETTE.ink,
    membrane: GRAVEDIGGER_PALETTE.wing,
    spine: GRAVEDIGGER_PALETTE.shellLight,
  },
  wingWear: 0,
  scarring: 0,
  heft: 0,
  iridescence: 0.35,
  seed: SEED,
};

/** The pale wash of hemolymph over a cut face. */
function washCut(ctx: Ctx, at: Pt, radius: number): void {
  const wash = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  wash.addColorStop(0, rgba(HEMOLYMPH, WASH_ALPHA));
  wash.addColorStop(0.7, rgba(HEMOLYMPH_DARK, WASH_ALPHA * 0.8));
  wash.addColorStop(1, rgba(HEMOLYMPH_DARK, 0));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
}

function stripe(ctx: Ctx, outline: readonly Pt[], from: Pt, to: Pt, width: number): void {
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = GRAVEDIGGER_PALETTE.band;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export interface BeetleGorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const HEAD_RADIUS = 0.07;
const MANDIBLE_LENGTH = 0.11;
const PRONOTUM_RX = 0.11;
const PRONOTUM_RY = 0.08;
const ELYTRON_LENGTH = 0.26;
const ELYTRON_HALF = 0.07;
const WING_LENGTH = 0.28;
const WING_HALF = 0.08;
const LEG_SEGMENT = 0.09;
const LEG_HALF = 0.012;
const ANTENNA_LENGTH = 0.12;
const CLUB_RADIUS = 0.024;
const ABDOMEN_LENGTH = 0.2;
const ABDOMEN_HALF = 0.07;

/** The pieces, in the order `BodyPartGoreSystem` spawns them. */
export const GRAVEDIGGER_BEETLE_GORE_PIECES: readonly BeetleGorePiece[] = [
  {
    state: 'gore_head',
    paint: (ctx) => {
      for (const sign of [-1, 1]) {
        const root: Pt = { x: HEAD_RADIUS * 0.6, y: sign * HEAD_RADIUS * 0.4 };
        const tip: Pt = { x: root.x + MANDIBLE_LENGTH, y: root.y - sign * 0.02 };
        paintChitin(ctx, {
          outline: segmentOutline(root, tip, 0.016, 0.003, -sign * 0.03),
          build: SHELL,
        });
      }
      const outline = ovalOutline(0, 0, HEAD_RADIUS, HEAD_RADIUS * 0.85, 0, SEED);
      paintChitin(ctx, { outline, build: SHELL });
      washCut(ctx, { x: -HEAD_RADIUS * 0.7, y: 0 }, HEAD_RADIUS * 0.6);
    },
  },
  {
    state: 'gore_pronotum',
    paint: (ctx) => {
      const outline = ovalOutline(0, 0, PRONOTUM_RX, PRONOTUM_RY, deg(8), SEED + 1);
      paintChitin(ctx, { outline, build: SHELL });
      washCut(ctx, { x: 0, y: PRONOTUM_RY * 0.5 }, PRONOTUM_RX * 0.55);
    },
  },
  {
    state: 'gore_elytron',
    paint: (ctx) => {
      const from: Pt = { x: -ELYTRON_LENGTH / 2, y: 0 };
      const to: Pt = { x: ELYTRON_LENGTH / 2, y: 0 };
      const outline = segmentOutline(from, to, ELYTRON_HALF * 0.8, ELYTRON_HALF * 0.5, 0.03);
      paintChitin(ctx, { outline, build: SHELL });
      for (const at of [-0.04, 0.06]) {
        stripe(
          ctx,
          outline,
          { x: at - 0.015, y: -ELYTRON_HALF * 1.5 },
          { x: at + 0.015, y: ELYTRON_HALF * 1.5 },
          0.04,
        );
      }
      traceOutline(ctx, outline);
      ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.ink, 0.9);
      ctx.lineWidth = 0.009;
      ctx.stroke();
    },
  },
  {
    state: 'gore_wing',
    paint: (ctx) => {
      const outline = segmentOutline(
        { x: -WING_LENGTH / 2, y: 0 },
        { x: WING_LENGTH / 2, y: 0 },
        WING_HALF * 0.3,
        WING_HALF,
        0.03,
      );
      traceOutline(ctx, outline);
      ctx.fillStyle = rgba(GRAVEDIGGER_PALETTE.wing, 0.7);
      ctx.fill();
      ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.ink, 0.6);
      ctx.lineWidth = 0.006;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-WING_LENGTH / 2, 0);
      ctx.lineTo(WING_LENGTH / 2, -0.02);
      ctx.moveTo(-0.02, 0);
      ctx.lineTo(0.08, WING_HALF * 0.6);
      ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.bandDark, 0.6);
      ctx.lineWidth = 0.005;
      ctx.stroke();
    },
  },
  {
    state: 'gore_leg',
    paint: (ctx) => {
      const hip: Pt = { x: -LEG_SEGMENT * 0.8, y: -0.03 };
      const knee: Pt = { x: 0.01, y: 0.03 };
      const foot: Pt = { x: LEG_SEGMENT * 0.9, y: -0.02 };
      paintChitin(ctx, {
        outline: segmentOutline(hip, knee, LEG_HALF, LEG_HALF * 0.7),
        build: SHELL,
        gloss: 0.4,
      });
      paintChitin(ctx, {
        outline: segmentOutline(knee, foot, LEG_HALF * 0.7, LEG_HALF * 0.4),
        build: SHELL,
        gloss: 0.4,
      });
      washCut(ctx, hip, LEG_HALF * 2.2);
    },
  },
  {
    state: 'gore_antenna',
    paint: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(-ANTENNA_LENGTH / 2, 0.02);
      ctx.lineTo(0, -0.01);
      ctx.lineTo(ANTENNA_LENGTH / 2 - CLUB_RADIUS, 0.01);
      ctx.strokeStyle = GRAVEDIGGER_PALETTE.ink;
      ctx.lineWidth = 0.01;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(
        ANTENNA_LENGTH / 2 - CLUB_RADIUS,
        0.01,
        CLUB_RADIUS,
        CLUB_RADIUS * 0.75,
        0,
        0,
        TWO_PI,
      );
      ctx.fillStyle = GRAVEDIGGER_PALETTE.club;
      ctx.fill();
      ctx.strokeStyle = GRAVEDIGGER_PALETTE.bandDark;
      ctx.lineWidth = 0.006;
      ctx.stroke();
    },
  },
  {
    state: 'gore_abdomen',
    paint: (ctx) => {
      const outline = segmentOutline(
        { x: -ABDOMEN_LENGTH / 2, y: 0 },
        { x: ABDOMEN_LENGTH / 2, y: 0 },
        ABDOMEN_HALF,
        ABDOMEN_HALF * 0.5,
        0.01,
      );
      paintChitin(ctx, { outline, build: SHELL, gloss: 0.5 });
      ctx.save();
      traceOutline(ctx, outline);
      ctx.clip();
      ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.shellLight, 0.4);
      ctx.lineWidth = 0.006;
      for (const x of [-0.04, 0.0, 0.04]) {
        ctx.beginPath();
        ctx.moveTo(x, -ABDOMEN_HALF);
        ctx.quadraticCurveTo(x - 0.015, 0, x, ABDOMEN_HALF);
        ctx.stroke();
      }
      ctx.restore();
      washCut(ctx, { x: -ABDOMEN_LENGTH / 2, y: 0 }, ABDOMEN_HALF * 0.9);
    },
  },
];
