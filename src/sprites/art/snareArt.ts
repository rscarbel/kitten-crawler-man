/**
 * The village snare, painted live in one tile: a rope noose laid on the
 * ground, a sapling bent down over it and held by a trigger stick, and a few
 * leaves thrown over the loop to hide it.
 *
 * Four looks: `set` (bent sapling, open loop), `sprung` (sapling whipped
 * upright, rope taut, the loop cinched tight round whatever stands in the
 * middle of the tile), `broken` (the sapling snapped, the loop frayed), and
 * spikes, a ring of short stakes round the tile's edge, on any of them.
 *
 * A snare is camouflaged but must never vanish for its owner, so the rope
 * always carries a small glint that pulses slowly — enough to find your own
 * traps, not enough to read as an alarm.
 */

import { INK, LOG, MOSS, drawContactShadow } from './villageArt';

export type SnareLook = 'set' | 'sprung' | 'broken';

export interface SnareDrawState {
  readonly look: SnareLook;
  readonly spikes: boolean;
  /** Seconds, for the rope's glint. */
  readonly timeSeconds: number;
}

/** A sprung sapling stands well above its tile. */
export const SNARE_REACH_UP_TILES = 1.1;

const ROPE = '#c8a878';
const ROPE_DARK = '#8a6a44';
const GLINT = 'rgba(255,244,210,';
const GLINT_PERIOD_SECONDS = 2.4;
const GLINT_MIN_ALPHA = 0.25;
const GLINT_SWING_ALPHA = 0.45;
const LOOP_RX = 0.22;
const LOOP_RY = 0.13;
const LOOP_Y = 0.62;
const SAPLING_ROOT_X = 0.12;
const SAPLING_ROOT_Y = 0.42;
const SPRUNG_HEIGHT = 1.05;
/** The sprung sapling leans this far east of its root at its top, where the line runs from. */
const SPRUNG_TOP_LEAN = 0.18;
const SPIKE_COUNT = 8;
const SPIKE_RING_RX = 0.4;
const SPIKE_RING_RY = 0.3;
const SPIKE_LENGTH = 0.14;
const LEAF_COUNT = 6;
const INK_WIDTH = 0.02;

export function drawSnare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  state: SnareDrawState,
): void {
  const p = (tx: number, ty: number) => ({ x: x + tx * ts, y: y + ty * ts });
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y - SNARE_REACH_UP_TILES * ts, ts, ts * (1 + SNARE_REACH_UP_TILES));
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (state.spikes) drawSpikeRing(ctx, p, ts, 'back');
    const centre = p(0.5, LOOP_Y);
    switch (state.look) {
      case 'set':
        drawSetSnare(ctx, p, ts);
        break;
      case 'sprung':
        drawSprungSnare(ctx, p, ts);
        break;
      case 'broken':
        drawBrokenSnare(ctx, p, ts);
        break;
    }
    // The owner's reminder: a slow glint on the rope.
    const pulse = (Math.sin((state.timeSeconds / GLINT_PERIOD_SECONDS) * Math.PI * 2) + 1) / 2;
    ctx.fillStyle = `${GLINT}${(GLINT_MIN_ALPHA + GLINT_SWING_ALPHA * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(
      centre.x + LOOP_RX * ts * 0.7,
      centre.y - LOOP_RY * ts * 0.6,
      ts * 0.035,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (state.spikes) drawSpikeRing(ctx, p, ts, 'front');
  } finally {
    ctx.restore();
  }
}

type At = (tx: number, ty: number) => { x: number; y: number };

function rope(ctx: CanvasRenderingContext2D, ts: number, draw: () => void): void {
  ctx.strokeStyle = ROPE_DARK;
  ctx.lineWidth = Math.max(1.5, ts * 0.045);
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = Math.max(1, ts * 0.025);
  ctx.beginPath();
  draw();
  ctx.stroke();
}

function sapling(ctx: CanvasRenderingContext2D, ts: number, draw: () => void, width: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + ts * INK_WIDTH * 2;
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.strokeStyle = LOG.barkLight;
  ctx.lineWidth = width;
  ctx.beginPath();
  draw();
  ctx.stroke();
}

function leaves(ctx: CanvasRenderingContext2D, ts: number, around: { x: number; y: number }): void {
  for (let leaf = 0; leaf < LEAF_COUNT; leaf++) {
    const angle = leaf * 2.2;
    const lx = around.x + Math.cos(angle) * LOOP_RX * ts * 0.9;
    const ly = around.y + Math.sin(angle) * LOOP_RY * ts * 0.9;
    ctx.fillStyle = leaf % 2 === 0 ? MOSS.body : MOSS.light;
    ctx.beginPath();
    ctx.ellipse(lx, ly, ts * 0.06, ts * 0.03, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSetSnare(ctx: CanvasRenderingContext2D, p: At, ts: number): void {
  const centre = p(0.5, LOOP_Y);
  drawContactShadow(ctx, centre.x, centre.y, LOOP_RX * ts * 1.2, LOOP_RY * ts * 1.2, 0.25);
  // The open loop on the ground.
  rope(ctx, ts, () =>
    ctx.ellipse(centre.x, centre.y, LOOP_RX * ts, LOOP_RY * ts, 0, 0, Math.PI * 2),
  );
  // The trigger stick pegged beside the loop.
  const peg = p(0.78, 0.42);
  sapling(
    ctx,
    ts,
    () => {
      ctx.moveTo(peg.x, peg.y + ts * 0.1);
      ctx.lineTo(peg.x + ts * 0.04, peg.y - ts * 0.12);
    },
    ts * 0.035,
  );
  // The sapling, rooted at the tile's edge and bent down to the trigger in an arch.
  const root = p(SAPLING_ROOT_X, SAPLING_ROOT_Y);
  sapling(
    ctx,
    ts,
    () => {
      ctx.moveTo(root.x, root.y + ts * 0.08);
      ctx.quadraticCurveTo(p(0.3, -0.25).x, p(0.3, -0.25).y, peg.x, peg.y - ts * 0.1);
    },
    ts * 0.05,
  );
  // The line from the bent tip down to the loop.
  rope(ctx, ts, () => {
    ctx.moveTo(peg.x, peg.y - ts * 0.08);
    ctx.lineTo(centre.x + LOOP_RX * ts * 0.6, centre.y - LOOP_RY * ts * 0.5);
  });
  leaves(ctx, ts, centre);
}

function drawSprungSnare(ctx: CanvasRenderingContext2D, p: At, ts: number): void {
  const centre = p(0.5, LOOP_Y);
  const root = p(SAPLING_ROOT_X, SAPLING_ROOT_Y);
  const top = p(SAPLING_ROOT_X + SPRUNG_TOP_LEAN, SAPLING_ROOT_Y - SPRUNG_HEIGHT);
  sapling(
    ctx,
    ts,
    () => {
      ctx.moveTo(root.x, root.y + ts * 0.08);
      ctx.quadraticCurveTo(root.x - ts * 0.04, root.y - ts * 0.5, top.x, top.y);
    },
    ts * 0.055,
  );
  // The rope, taut from the sapling's top down to the cinched loop.
  rope(ctx, ts, () => {
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(centre.x, centre.y - LOOP_RY * ts * 0.3);
  });
  rope(ctx, ts, () =>
    ctx.ellipse(centre.x, centre.y, LOOP_RX * ts * 0.45, LOOP_RY * ts * 0.45, 0, 0, Math.PI * 2),
  );
  // Leaves scattered where the loop leapt.
  leaves(ctx, ts, p(0.5, LOOP_Y + 0.12));
}

function drawBrokenSnare(ctx: CanvasRenderingContext2D, p: At, ts: number): void {
  const centre = p(0.5, LOOP_Y);
  const root = p(SAPLING_ROOT_X, SAPLING_ROOT_Y);
  // A snapped stub, and the rest of the sapling lying across the tile.
  sapling(
    ctx,
    ts,
    () => {
      ctx.moveTo(root.x, root.y + ts * 0.08);
      ctx.lineTo(root.x + ts * 0.03, root.y - ts * 0.22);
    },
    ts * 0.055,
  );
  sapling(
    ctx,
    ts,
    () => {
      ctx.moveTo(p(0.2, 0.86).x, p(0.2, 0.86).y);
      ctx.quadraticCurveTo(p(0.55, 0.76).x, p(0.55, 0.76).y, p(0.9, 0.84).x, p(0.9, 0.84).y);
    },
    ts * 0.045,
  );
  // The loop pulled open and frayed at one end.
  rope(ctx, ts, () =>
    ctx.ellipse(centre.x, centre.y, LOOP_RX * ts, LOOP_RY * ts, 0, Math.PI * 0.2, Math.PI * 1.7),
  );
  const fray = { x: centre.x + LOOP_RX * ts * 0.8, y: centre.y - LOOP_RY * ts * 0.6 };
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = Math.max(1, ts * 0.015);
  for (const [dx, dy] of [
    [0.06, -0.04],
    [0.08, 0.01],
    [0.05, 0.05],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(fray.x, fray.y);
    ctx.lineTo(fray.x + dx * ts, fray.y + dy * ts);
    ctx.stroke();
  }
}

function drawSpikeRing(
  ctx: CanvasRenderingContext2D,
  p: At,
  ts: number,
  pass: 'back' | 'front',
): void {
  const centre = p(0.5, LOOP_Y - 0.02);
  for (let spike = 0; spike < SPIKE_COUNT; spike++) {
    const angle = (spike / SPIKE_COUNT) * Math.PI * 2;
    const isFront = Math.sin(angle) > 0;
    if (isFront !== (pass === 'front')) continue;
    const rootX = centre.x + Math.cos(angle) * SPIKE_RING_RX * ts;
    const rootY = centre.y + Math.sin(angle) * SPIKE_RING_RY * ts;
    const tipX = rootX + Math.cos(angle) * SPIKE_LENGTH * ts * 0.4;
    const tipY = rootY - SPIKE_LENGTH * ts;
    ctx.fillStyle = LOG.barkLight;
    ctx.beginPath();
    ctx.moveTo(rootX - ts * 0.03, rootY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rootX + ts * 0.03, rootY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.stroke();
  }
}

/** How hard a caught body is struggling, as a fraction of a tile the loop is tugged sideways. */
const STRUGGLE_TUG_TILES = 0.04;
const STRUGGLE_HZ = 2.6;
/** The cinched loop round a caught body's ankles is a little wider than the empty sprung loop. */
const BINDING_RX = 0.26;
const BINDING_RY = 0.1;
/** Turns of rope round the ankles, each a little higher up the leg than the last. */
const BINDING_TURNS = 2;
const BINDING_TURN_RISE = 0.07;

/**
 * The noose drawn over a caught body's feet: two turns of rope cinched round
 * its ankles and the taut line back up to the sapling, tugged side to side as
 * it struggles. Drawn over the body, so the rope reads as round its legs
 * rather than lost under it.
 *
 * `feetX`/`feetY` is the point between the body's feet; `snareX`/`snareY` is
 * the snare tile's top-left, so the line runs to the sapling that sprang.
 */
export function drawSnareBinding(
  ctx: CanvasRenderingContext2D,
  feetX: number,
  feetY: number,
  snareX: number,
  snareY: number,
  ts: number,
  timeSeconds: number,
): void {
  const tug = Math.sin(timeSeconds * Math.PI * 2 * STRUGGLE_HZ) * STRUGGLE_TUG_TILES * ts;
  const top = {
    x: snareX + (SAPLING_ROOT_X + SPRUNG_TOP_LEAN) * ts,
    y: snareY + (SAPLING_ROOT_Y - SPRUNG_HEIGHT) * ts,
  };
  const loopX = feetX + tug;
  ctx.save();
  try {
    ctx.lineCap = 'round';
    rope(ctx, ts, () => {
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(loopX, feetY - BINDING_RY * ts);
    });
    for (let turn = 0; turn < BINDING_TURNS; turn++) {
      const y = feetY - turn * BINDING_TURN_RISE * ts;
      rope(ctx, ts, () =>
        ctx.ellipse(loopX, y, BINDING_RX * ts, BINDING_RY * ts, 0, 0, Math.PI * 2),
      );
    }
  } finally {
    ctx.restore();
  }
}
