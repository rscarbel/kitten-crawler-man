/**
 * What a ratkin can carry in his right paw.
 *
 * Every prop is painted about its **grip** — the point inside the paw — along an
 * **axis**: the direction from the grip toward the prop's working end. A spear's
 * axis points at its blade, a lantern's at the lamp hanging under the paw. The
 * body painter supplies the grip from the solved arm and draws the paw over the
 * prop afterwards, so the fingers close round the shaft rather than the shaft
 * lying across the fist.
 *
 * Silhouette beats detail. At 40 pixels tall the only thing a prop can say is
 * its outline — a spear is a long line with a leaf on the end, a lantern is a
 * box with a glow — so each is a few bold outlined shapes and nothing finer.
 */

import { type Pt, rgba } from '../carlArt';
import type { HeldPropKind } from './outfit';
import {
  DETAIL_OUTLINE_WIDTH,
  HALF_PI,
  OUTLINE,
  type Ramp,
  TWO_PI,
  fillCapsule,
  fillOutlined,
  offset,
  outlineCapsule,
  traceRoundRect,
} from './paint';

type Ctx = CanvasRenderingContext2D;

/** Dark, warm handle wood: well away from the dusky pink of a ratkin's tail. */
const WOOD: Ramp = { dark: '#2e1d10', mid: '#5a3a1e', light: '#8a5f36' };
/** A shaft cut and shaved by hand, paler than the smith's seasoned ash. */
const RAW_WOOD: Ramp = { dark: '#7c6443', mid: '#b59868', light: '#d8bf8e' };
const IRON: Ramp = { dark: '#3d4148', mid: '#6f7680', light: '#aeb6bf' };
const BRASS: Ramp = { dark: '#6b4f1c', mid: '#b28a36', light: '#e3c46d' };
const LEATHER: Ramp = { dark: '#3b2717', mid: '#6d4a2c', light: '#94693f' };
const SACKCLOTH: Ramp = { dark: '#6b5a3c', mid: '#a18b5f', light: '#c7b184' };
const WICKER: Ramp = { dark: '#6a4a22', mid: '#a67c3f', light: '#cfa665' };
const LEDGER_COVER: Ramp = { dark: '#3a1d14', mid: '#7a2e20', light: '#a34a33' };
const PAGE = '#efe4c8';
const LAMP_GLOW = '#ffd27a';
const LAMP_FLAME = '#fff1b8';
const WATER = '#6f9fb8';

/** A pole prop: shaft either side of the grip, and what sits on its end. */
const SPEAR_ABOVE = 1.02;
const SPEAR_BELOW = 0.42;
const SPEAR_SHAFT_WIDTH = 0.02;
const SPEAR_BLADE_LENGTH = 0.17;
const SPEAR_BLADE_HALF = 0.045;
/** The socket where the blade meets the shaft; a lashed binding on the rough spear. */
const SPEAR_SOCKET_LENGTH = 0.05;
const SPEAR_SOCKET_WIDTH = 0.027;

/** The blade rides at shoulder height, below a hat brim rather than through it. */
const HOE_ABOVE = 0.6;
const HOE_BELOW = 0.5;
const HOE_BLADE_REACH = 0.15;
const HOE_BLADE_DROP = 0.09;
const HOE_BLADE_WIDTH = 0.035;

/**
 * A felling axe and a pick, on the hoe's handle: a wedge standing forward off
 * the top, and a curved head crossing it. The head's outline, not its colour,
 * is what tells the two apart at tile size.
 */
const AXE_BLADE_REACH = 0.24;
const AXE_BLADE_TOP = 0.04;
const AXE_BLADE_HEEL = 0.14;
const AXE_BLADE_TOE = 0.12;
const PICK_HEAD_HALF = 0.15;
const PICK_HEAD_DROOP = 0.06;
const PICK_HEAD_WIDTH = 0.025;

const CANE_LENGTH = 0.6;
const CANE_WIDTH = 0.018;
const CANE_HOOK_R = 0.045;

const LADLE_HANDLE = 0.34;
const LADLE_TAIL = 0.06;
const LADLE_HANDLE_WIDTH = 0.014;
const LADLE_BOWL_R = 0.05;

const HAMMER_HANDLE = 0.34;
const HAMMER_TAIL = 0.04;
const HAMMER_HANDLE_WIDTH = 0.018;
const SMITH_HEAD_HALF = 0.09;
const SMITH_HEAD_DEPTH = 0.07;
const CLAW_HEAD_HALF = 0.05;
const CLAW_HEAD_DEPTH = 0.035;
const CLAW_CURL = 0.05;

const LANTERN_BAIL = 0.07;
const LANTERN_HALF = 0.05;
const LANTERN_HEIGHT = 0.12;
const LANTERN_GLOW_R = 0.3;
const LANTERN_GLOW_ALPHA = 0.42;
const LANTERN_FLAME_R = 0.028;

const BAG_NECK = 0.04;
const BAG_HALF = 0.085;
const BAG_HEIGHT = 0.15;

const BUCKET_BAIL = 0.07;
const BUCKET_TOP_HALF = 0.075;
const BUCKET_BOTTOM_HALF = 0.06;
const BUCKET_HEIGHT = 0.12;
const BUCKET_HOOP_AT = 0.3;

const BASKET_HANDLE_R = 0.07;
const BASKET_HALF = 0.1;
const BASKET_HEIGHT = 0.09;

const LEDGER_HALF_WIDTH = 0.07;
const LEDGER_HEIGHT = 0.2;
const LEDGER_PAGE_INSET = 0.014;

const TOY_STICK = 0.24;
const TOY_STICK_WIDTH = 0.013;
const TOY_HEAD_R = 0.05;
const TOY_SNOUT = 0.05;

const ROUND_CORNER = 0.3;
/** Half, for shapes centred on their own axis. */
const HALF = 0.5;

/** A point `distance` along `angle` from `from`. */
function along(from: Pt, angle: number, distance: number): Pt {
  return offset(from, Math.cos(angle) * distance, Math.sin(angle) * distance);
}

/** An outlined, tapering stick — every shaft and handle. */
function stick(ctx: Ctx, a: Pt, b: Pt, widthA: number, widthB: number, ramp: Ramp): void {
  outlineCapsule(ctx, a, b, widthA, widthB);
  fillCapsule(ctx, a, b, widthA, widthB, ramp.mid);
}

/**
 * Paints a shape in a frame rotated so its local +Y runs down the prop's axis
 * from `origin` — the frame every hanging item and every blade is drawn in.
 */
function withAxisFrame(ctx: Ctx, origin: Pt, axis: number, paint: () => void): void {
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(axis - HALF_PI);
  paint();
  ctx.restore();
}

function drawSpear(ctx: Ctx, grip: Pt, axis: number, shaft: Ramp, lashed: boolean): void {
  const butt = along(grip, axis, -SPEAR_BELOW);
  const socket = along(grip, axis, SPEAR_ABOVE);
  stick(ctx, butt, socket, SPEAR_SHAFT_WIDTH, SPEAR_SHAFT_WIDTH, shaft);
  withAxisFrame(ctx, socket, axis, () => {
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(SPEAR_BLADE_HALF, SPEAR_BLADE_LENGTH * HALF, 0, SPEAR_BLADE_LENGTH);
        ctx.quadraticCurveTo(-SPEAR_BLADE_HALF, SPEAR_BLADE_LENGTH * HALF, 0, 0);
        ctx.closePath();
      },
      IRON.light,
      DETAIL_OUTLINE_WIDTH,
    );
    const binding = lashed ? LEATHER : IRON;
    fillCapsule(
      ctx,
      { x: 0, y: -SPEAR_SOCKET_LENGTH },
      { x: 0, y: 0 },
      SPEAR_SOCKET_WIDTH,
      SPEAR_SOCKET_WIDTH,
      binding.mid,
    );
  });
}

function drawHoe(ctx: Ctx, grip: Pt, axis: number): void {
  const butt = along(grip, axis, -HOE_BELOW);
  const top = along(grip, axis, HOE_ABOVE);
  stick(ctx, butt, top, SPEAR_SHAFT_WIDTH, SPEAR_SHAFT_WIDTH, WOOD);
  withAxisFrame(ctx, top, axis, () => {
    // The blade hangs forward off the top of the handle at a right angle: the
    // L is what separates a hoe from a spear or a staff at tile size.
    const heel = { x: 0, y: 0 };
    const edge = { x: HOE_BLADE_REACH, y: -HOE_BLADE_DROP };
    outlineCapsule(ctx, heel, edge, HOE_BLADE_WIDTH, HOE_BLADE_WIDTH);
    fillCapsule(ctx, heel, edge, HOE_BLADE_WIDTH, HOE_BLADE_WIDTH, IRON.mid);
  });
}

function drawWoodAxe(ctx: Ctx, grip: Pt, axis: number): void {
  const butt = along(grip, axis, -HOE_BELOW);
  const top = along(grip, axis, HOE_ABOVE);
  stick(ctx, butt, top, SPEAR_SHAFT_WIDTH, SPEAR_SHAFT_WIDTH, WOOD);
  withAxisFrame(ctx, top, axis, () => {
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(0, AXE_BLADE_TOP);
        ctx.lineTo(AXE_BLADE_REACH, AXE_BLADE_TOE);
        ctx.lineTo(AXE_BLADE_REACH, -AXE_BLADE_HEEL);
        ctx.lineTo(0, -AXE_BLADE_TOP);
        ctx.closePath();
      },
      IRON.mid,
      DETAIL_OUTLINE_WIDTH,
    );
  });
}

function drawPickaxe(ctx: Ctx, grip: Pt, axis: number): void {
  const butt = along(grip, axis, -HOE_BELOW);
  const top = along(grip, axis, HOE_ABOVE);
  stick(ctx, butt, top, SPEAR_SHAFT_WIDTH, SPEAR_SHAFT_WIDTH, WOOD);
  withAxisFrame(ctx, top, axis, () => {
    const trace = (): void => {
      ctx.beginPath();
      ctx.moveTo(-PICK_HEAD_HALF, -PICK_HEAD_DROOP);
      ctx.quadraticCurveTo(0, PICK_HEAD_DROOP, PICK_HEAD_HALF, -PICK_HEAD_DROOP);
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = PICK_HEAD_WIDTH * 2 + DETAIL_OUTLINE_WIDTH;
    trace();
    ctx.stroke();
    ctx.strokeStyle = IRON.mid;
    ctx.lineWidth = PICK_HEAD_WIDTH * 2;
    trace();
    ctx.stroke();
    ctx.restore();
  });
}

function drawCane(ctx: Ctx, grip: Pt, axis: number): void {
  const tip = along(grip, axis, CANE_LENGTH);
  stick(ctx, grip, tip, CANE_WIDTH, CANE_WIDTH, WOOD);
  withAxisFrame(ctx, grip, axis, () => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = CANE_WIDTH * 2 + DETAIL_OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.arc(CANE_HOOK_R, 0, CANE_HOOK_R, Math.PI, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = WOOD.mid;
    ctx.lineWidth = CANE_WIDTH * 2;
    ctx.stroke();
    ctx.restore();
  });
}

function drawLadle(ctx: Ctx, grip: Pt, axis: number): void {
  const tail = along(grip, axis, -LADLE_TAIL);
  const neck = along(grip, axis, LADLE_HANDLE);
  stick(ctx, tail, neck, LADLE_HANDLE_WIDTH, LADLE_HANDLE_WIDTH, IRON);
  const bowl = along(neck, axis, LADLE_BOWL_R);
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(bowl.x, bowl.y, LADLE_BOWL_R, 0, TWO_PI);
    },
    IRON.light,
    DETAIL_OUTLINE_WIDTH,
  );
}

function drawHammer(ctx: Ctx, grip: Pt, axis: number, smith: boolean): void {
  const tail = along(grip, axis, -HAMMER_TAIL);
  const neck = along(grip, axis, HAMMER_HANDLE);
  // The smith's handle is pale ash so it reads against his black fur.
  stick(ctx, tail, neck, HAMMER_HANDLE_WIDTH, HAMMER_HANDLE_WIDTH, smith ? RAW_WOOD : WOOD);
  withAxisFrame(ctx, neck, axis, () => {
    const half = smith ? SMITH_HEAD_HALF : CLAW_HEAD_HALF;
    const depth = smith ? SMITH_HEAD_DEPTH : CLAW_HEAD_DEPTH;
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.rect(-half, 0, half * 2, depth);
      },
      IRON.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    if (smith) return;
    // The claw: a curl back off one end, which is the carpenter's hammer.
    ctx.save();
    ctx.strokeStyle = IRON.mid;
    ctx.lineWidth = CLAW_HEAD_DEPTH * HALF;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half, depth * HALF);
    ctx.quadraticCurveTo(-half - CLAW_CURL, depth, -half - CLAW_CURL, depth + CLAW_CURL);
    ctx.stroke();
    ctx.restore();
  });
}

function drawLantern(ctx: Ctx, grip: Pt, axis: number): void {
  const lampTop = along(grip, axis, LANTERN_BAIL);
  const lampCentre = along(lampTop, axis, LANTERN_HEIGHT * HALF);
  // The glow first, under everything: it is the one warm light in the figure
  // and the reason she is picked out of a crowd at dusk.
  ctx.save();
  ctx.translate(lampCentre.x, lampCentre.y);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, LANTERN_GLOW_R);
  glow.addColorStop(0, rgba(LAMP_GLOW, LANTERN_GLOW_ALPHA));
  glow.addColorStop(1, rgba(LAMP_GLOW, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, LANTERN_GLOW_R, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  stick(ctx, grip, lampTop, CANE_WIDTH * HALF, CANE_WIDTH * HALF, IRON);
  withAxisFrame(ctx, lampTop, axis, () => {
    fillOutlined(
      ctx,
      () =>
        traceRoundRect(
          ctx,
          -LANTERN_HALF,
          0,
          LANTERN_HALF * 2,
          LANTERN_HEIGHT,
          LANTERN_HALF * ROUND_CORNER,
        ),
      BRASS.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.fillStyle = LAMP_GLOW;
    ctx.fillRect(
      -LANTERN_HALF * HALF,
      LANTERN_HEIGHT * BUCKET_HOOP_AT,
      LANTERN_HALF,
      LANTERN_HEIGHT * HALF,
    );
    ctx.beginPath();
    ctx.arc(0, LANTERN_HEIGHT * HALF, LANTERN_FLAME_R, 0, TWO_PI);
    ctx.fillStyle = LAMP_FLAME;
    ctx.fill();
  });
}

function drawBag(ctx: Ctx, grip: Pt, axis: number): void {
  withAxisFrame(ctx, grip, axis, () => {
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-BAG_NECK * HALF, 0);
        ctx.quadraticCurveTo(-BAG_HALF, BAG_NECK, -BAG_HALF, BAG_HEIGHT * HALF + BAG_NECK);
        ctx.quadraticCurveTo(-BAG_HALF, BAG_HEIGHT + BAG_NECK, 0, BAG_HEIGHT + BAG_NECK);
        ctx.quadraticCurveTo(
          BAG_HALF,
          BAG_HEIGHT + BAG_NECK,
          BAG_HALF,
          BAG_HEIGHT * HALF + BAG_NECK,
        );
        ctx.quadraticCurveTo(BAG_HALF, BAG_NECK, BAG_NECK * HALF, 0);
        ctx.closePath();
      },
      SACKCLOTH.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.fillStyle = SACKCLOTH.dark;
    ctx.fillRect(-BAG_NECK, BAG_NECK * HALF, BAG_NECK * 2, BAG_NECK * HALF);
  });
}

function drawBucket(ctx: Ctx, grip: Pt, axis: number): void {
  withAxisFrame(ctx, grip, axis, () => {
    ctx.save();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(-BUCKET_TOP_HALF, BUCKET_BAIL);
    ctx.quadraticCurveTo(0, -BUCKET_BAIL * HALF, BUCKET_TOP_HALF, BUCKET_BAIL);
    ctx.stroke();
    ctx.restore();
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-BUCKET_TOP_HALF, BUCKET_BAIL);
        ctx.lineTo(BUCKET_TOP_HALF, BUCKET_BAIL);
        ctx.lineTo(BUCKET_BOTTOM_HALF, BUCKET_BAIL + BUCKET_HEIGHT);
        ctx.lineTo(-BUCKET_BOTTOM_HALF, BUCKET_BAIL + BUCKET_HEIGHT);
        ctx.closePath();
      },
      WOOD.light,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.fillStyle = WATER;
    ctx.fillRect(-BUCKET_TOP_HALF, BUCKET_BAIL, BUCKET_TOP_HALF * 2, BUCKET_HEIGHT * HALF * HALF);
    ctx.fillStyle = IRON.dark;
    const hoopY = BUCKET_BAIL + BUCKET_HEIGHT * (1 - BUCKET_HOOP_AT);
    ctx.fillRect(-BUCKET_BOTTOM_HALF, hoopY, BUCKET_BOTTOM_HALF * 2, DETAIL_OUTLINE_WIDTH);
  });
}

function drawBasket(ctx: Ctx, grip: Pt, axis: number): void {
  withAxisFrame(ctx, grip, axis, () => {
    ctx.save();
    ctx.strokeStyle = WICKER.dark;
    ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 2;
    ctx.beginPath();
    ctx.arc(0, BASKET_HANDLE_R, BASKET_HANDLE_R, Math.PI, TWO_PI);
    ctx.stroke();
    ctx.restore();
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-BASKET_HALF, BASKET_HANDLE_R);
        ctx.lineTo(BASKET_HALF, BASKET_HANDLE_R);
        ctx.quadraticCurveTo(
          BASKET_HALF,
          BASKET_HANDLE_R + BASKET_HEIGHT,
          0,
          BASKET_HANDLE_R + BASKET_HEIGHT,
        );
        ctx.quadraticCurveTo(
          -BASKET_HALF,
          BASKET_HANDLE_R + BASKET_HEIGHT,
          -BASKET_HALF,
          BASKET_HANDLE_R,
        );
        ctx.closePath();
      },
      WICKER.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.fillStyle = WICKER.light;
    ctx.fillRect(-BASKET_HALF, BASKET_HANDLE_R, BASKET_HALF * 2, DETAIL_OUTLINE_WIDTH);
  });
}

function drawLedger(ctx: Ctx, grip: Pt, axis: number): void {
  withAxisFrame(ctx, grip, axis, () => {
    fillOutlined(
      ctx,
      () =>
        traceRoundRect(
          ctx,
          -LEDGER_HALF_WIDTH,
          -LEDGER_HEIGHT * HALF,
          LEDGER_HALF_WIDTH * 2,
          LEDGER_HEIGHT,
          LEDGER_PAGE_INSET,
        ),
      LEDGER_COVER.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    // The page edge down one side is what makes a slab read as a book.
    ctx.fillStyle = PAGE;
    ctx.fillRect(
      LEDGER_HALF_WIDTH - LEDGER_PAGE_INSET * 2,
      -LEDGER_HEIGHT * HALF + LEDGER_PAGE_INSET,
      LEDGER_PAGE_INSET,
      LEDGER_HEIGHT - LEDGER_PAGE_INSET * 2,
    );
    ctx.fillStyle = BRASS.light;
    ctx.fillRect(-LEDGER_HALF_WIDTH, -LEDGER_PAGE_INSET, LEDGER_PAGE_INSET, LEDGER_PAGE_INSET * 2);
  });
}

function drawToy(ctx: Ctx, grip: Pt, axis: number): void {
  const top = along(grip, axis, TOY_STICK);
  const bottom = along(grip, axis, -TOY_STICK * HALF * HALF);
  stick(ctx, bottom, top, TOY_STICK_WIDTH, TOY_STICK_WIDTH, RAW_WOOD);
  // A hobby-horse head: a knob with a snout, the toy every child's hand reads as.
  withAxisFrame(ctx, top, axis, () => {
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, TOY_HEAD_R * HALF, TOY_HEAD_R, TOY_HEAD_R * HALF * 3, 0, 0, TWO_PI);
        ctx.moveTo(TOY_HEAD_R, TOY_HEAD_R);
        ctx.ellipse(TOY_SNOUT, TOY_HEAD_R, TOY_SNOUT, TOY_HEAD_R * HALF, 0, 0, TWO_PI);
      },
      RAW_WOOD.mid,
      DETAIL_OUTLINE_WIDTH,
    );
  });
}

const PLANE_HALF_LENGTH = 0.09;
const PLANE_HEIGHT = 0.05;
const PLANE_KNOB_R = 0.022;

/** A carpenter's plane: a wooden block with a knob, gripped from above. */
function drawPlane(ctx: Ctx, grip: Pt, axis: number): void {
  withAxisFrame(ctx, grip, axis, () => {
    fillOutlined(
      ctx,
      () =>
        traceRoundRect(
          ctx,
          -PLANE_HEIGHT * HALF,
          -PLANE_HALF_LENGTH,
          PLANE_HEIGHT,
          PLANE_HALF_LENGTH * 2,
          PLANE_HEIGHT * ROUND_CORNER,
        ),
      WOOD.light,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.beginPath();
    ctx.arc(0, -PLANE_HALF_LENGTH, PLANE_KNOB_R, 0, TWO_PI);
    ctx.fillStyle = WOOD.dark;
    ctx.fill();
  });
}

/**
 * Paints `kind` held at `grip`, its working end along `axis` (radians, screen
 * space, +Y down). Draw it before the paw that holds it.
 */
export function drawHeldProp(ctx: Ctx, kind: HeldPropKind, grip: Pt, axis: number): void {
  const scale = PROP_CARRY[kind].carry === 'pole' ? 1 : HAND_PROP_SCALE;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.scale(scale, scale);
  try {
    drawHeldPropAtOrigin(ctx, kind, axis);
  } finally {
    ctx.restore();
  }
}

/**
 * Hand tools and carried goods drawn larger than life. At a 32px tile a
 * true-to-scale hammer or sack is a speck; the prop is what names the trade,
 * so it has to read before anything else in the hand does.
 */
const HAND_PROP_SCALE = 1.5;

function drawHeldPropAtOrigin(ctx: Ctx, kind: HeldPropKind, axis: number): void {
  const grip = { x: 0, y: 0 };
  switch (kind) {
    case 'none':
      return;
    case 'spear':
      drawSpear(ctx, grip, axis, WOOD, false);
      return;
    case 'rough_spear':
      drawSpear(ctx, grip, axis, RAW_WOOD, true);
      return;
    case 'hoe':
      drawHoe(ctx, grip, axis);
      return;
    case 'woodaxe':
      drawWoodAxe(ctx, grip, axis);
      return;
    case 'pickaxe':
      drawPickaxe(ctx, grip, axis);
      return;
    case 'cane':
      drawCane(ctx, grip, axis);
      return;
    case 'ladle':
      drawLadle(ctx, grip, axis);
      return;
    case 'smith_hammer':
      drawHammer(ctx, grip, axis, true);
      return;
    case 'claw_hammer':
      drawHammer(ctx, grip, axis, false);
      return;
    case 'lantern':
      drawLantern(ctx, grip, axis);
      return;
    case 'bag':
      drawBag(ctx, grip, axis);
      return;
    case 'bucket':
      drawBucket(ctx, grip, axis);
      return;
    case 'basket':
      drawBasket(ctx, grip, axis);
      return;
    case 'ledger':
      drawLedger(ctx, grip, axis);
      return;
    case 'toy':
      drawToy(ctx, grip, axis);
      return;
    case 'plane':
      drawPlane(ctx, grip, axis);
      return;
  }
}

/** How a prop is carried when nothing is animating it. */
export type PropCarry = 'pole' | 'hang' | 'hold';

/** Straight up the screen. */
export const AXIS_UP = -HALF_PI;
/** Straight down the screen. */
export const AXIS_DOWN = HALF_PI;

/**
 * How each prop rides in the paw while he walks or stands.
 *
 * `pole` props stand upright beside him with the butt near the ground, `hang`
 * props dangle under the paw, and `hold` props are held up in front of him.
 * The axis is fixed in the world rather than following the forearm: a carried
 * weight hangs plumb, and a staff held upright stays upright however the arm
 * swings.
 */
export const PROP_CARRY: Readonly<Record<HeldPropKind, { carry: PropCarry; axis: number }>> = {
  none: { carry: 'hang', axis: AXIS_DOWN },
  spear: { carry: 'pole', axis: AXIS_UP },
  rough_spear: { carry: 'pole', axis: AXIS_UP },
  hoe: { carry: 'pole', axis: AXIS_UP },
  woodaxe: { carry: 'pole', axis: AXIS_UP },
  pickaxe: { carry: 'pole', axis: AXIS_UP },
  cane: { carry: 'pole', axis: AXIS_DOWN },
  ladle: { carry: 'hold', axis: AXIS_UP },
  smith_hammer: { carry: 'hold', axis: AXIS_UP },
  claw_hammer: { carry: 'hang', axis: AXIS_DOWN },
  lantern: { carry: 'hang', axis: AXIS_DOWN },
  bag: { carry: 'hang', axis: AXIS_DOWN },
  bucket: { carry: 'hang', axis: AXIS_DOWN },
  basket: { carry: 'hang', axis: AXIS_DOWN },
  ledger: { carry: 'hold', axis: AXIS_DOWN },
  toy: { carry: 'hold', axis: AXIS_UP },
  plane: { carry: 'hold', axis: AXIS_DOWN },
};
