/**
 * The equipment gates: every held thing in Carl's hands, checked by painting
 * it where the game paints it — his two-layer cells, baked at the 32 px tile,
 * with the item composited between the layers at its socket.
 *
 * - E1 grip registration: each socket sits in its fist (on the line from the
 *   wrist to the knuckles the probe solves), the item's handle runs through
 *   the socket's centre, and the fingers of the hand that holds it are on it; on a
 *   two-handed haft the handle also runs through the upper fist. Also every
 *   row's own prop held in a closed hand has its hand turned in depth.
 * - E2 inside the cell: no item ink on the cell's border, and none below the
 *   ground line — except a tool's head on the frame it bites.
 * - E3 not across the face: no item ink shows over his face on a frame his
 *   face is drawn, unless a fist is already there.
 * - E4 wrap: the fingers in front of a handle overlap the handle's ink, and
 *   where the palm of a hand in front of his body faces the camera the
 *   handle still shows past them.
 * - E5 garment envelope: every garment's ink stays inside the envelope of the
 *   part it is worn on (`gates-equipment-garments.ts`).
 * - E6 bake/runtime parity: a row's prop baked into its cell and the same
 *   prop composited between the cell's layers by the runtime path give the
 *   same pixels.
 * - E7 mirror: a mirrored draw is the reflection of the unmirrored one, its
 *   sockets reflected, and the main hand is his right hand in every view.
 * - E8 stowed under the back: seen from behind in a garment that hangs over
 *   his back, a stowed weapon changes none of the pixels he covers.
 * - E1–E4 and E7 for what Donut holds: `gates-equipment-donut.ts`.
 *
 *   npm run gates:equipment
 *   npm run gates:equipment -- --item=fury_of_taranis
 */

import { createCanvas, type Canvas } from 'canvas';
import { pathToFileURL } from 'node:url';
import { BARE_CARL_OUTFIT } from '../src/sprites/garments/human/carlDressing.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import { garmentEnvelopeFailures, gatesGarment } from './gates-equipment-garments.js';
import { donutHeldFailures, gatesDonutHeld } from './gates-equipment-donut.js';
import { type HumanFigure, humanFigureFor } from '../src/sprites/art/human/appearance.js';
import {
  CHOP_ROWS,
  eventFrame,
  FRAME_H,
  FRAME_W,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  type HumanRowName,
  MINE_ROWS,
  ORIGIN_Y,
  paintDressedHumanLayers,
  paintRowProps,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import {
  carlSocketsAt,
  mirroredSocket,
  type SocketFrame,
  type SocketSource,
} from '../src/sprites/art/human/sockets.js';
import { HUMAN_CELL_PX_PER_UNIT, TILE_SCALE } from '../src/sprites/art/human/figureScale.js';
import { carriedGripOf } from '../src/sprites/art/human/carry.js';
import { probeHumanJoints } from '../src/sprites/art/human/probe.js';
import { HEAD_RX } from '../src/sprites/art/carl/proportions.js';
import { HEAD_ON_FLOOR_FORESHORTENING, VIEWS } from '../src/sprites/art/carl/rig.js';
import type { CardinalView } from '../src/sprites/facingView.js';
import {
  type CarlStowedDraw,
  drawHumanFigureSelection,
  motionSetOfRow,
  residentViewSpans,
  heldSocketOf,
} from '../src/sprites/humanSprite.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import { HELD_VISUALS, stowedPlacementOfHeld } from '../src/sprites/held/heldVisuals.js';
import { garmentsOf } from '../src/sprites/garments/garments.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import {
  type HeldVisualId,
  SCRIPTED_PROP_VISUAL_IDS,
  FIXTURE_TOOL_VISUAL_IDS,
  TOOL_HELD_VISUAL_IDS,
  WEAPON_HELD_VISUAL_IDS,
} from '../src/sprites/held/heldVisualIds.js';
import type { HeldVisualDef, WeaponHeldVisualDef } from '../src/sprites/held/heldVisualDef.js';
import { motionSetOf } from '../src/sprites/art/human/motionSets.js';
import { compositeHeldItem, heldTransformAt } from '../src/sprites/held/heldComposite.js';
import { scriptedPropVisual } from '../src/sprites/held/art/scriptedPropHeld.js';
import type { Pt } from '../src/sprites/art/carlArt.js';

installCanvasGlobals();

/** The in-game tile the gates sample at. */
const TILE = 32;
/** Cell pixels to 32 px tile pixels. */
const DENSITY = TILE / TILE_SCALE;
const CELL_W = Math.ceil(FRAME_W * DENSITY);
const CELL_H = Math.ceil(FRAME_H * DENSITY);
const RGBA = 4;
const ALPHA = 3;
/** An alpha above this is ink. */
const INK = 8;
/** A pixel this opaque hides whatever is drawn behind it. */
const OPAQUE = 255;
/** How far, in 32 px tile pixels, the handle's ink may lie from a socket's centre. */
const HANDLE_ON_SOCKET_PX = 1.5;
/**
 * How far a socket's centre may lie off the line from its hand's wrist to its
 * knuckles, read off the probe's own solve of the arm, in tile pixels.
 */
const SOCKET_ON_FIST_PX = 0.75;
/** How far the holding hand's front ink may lie from the socket's centre: the fingers sit round it. */
const FINGERS_ON_SOCKET_PX = 2.5;
/** The disc round a socket the wrap is judged in: about a fist's half-width at the tile. */
const WRAP_DISC_PX = 3;
/**
 * The handle has to show within this many wrap discs of a palm-out hand: past
 * the fist's own width, since two fists stacked on one haft cover each
 * other's.
 */
const SHOWING_DISC_SCALE = 2;
/**
 * A fist this close to the face's disc, in tile pixels — its own width and
 * the pommel past it — is at his face (a guard, a blow's wind-up), and what
 * it holds passes his cheek there by rights.
 */
const FIST_AT_FACE_PX = 4;
/** Ink this far below the ground line is in the floor. */
const BELOW_GROUND_PX = 1;
/** The face's disc as a share of the head's half-width: features, not ears and hair. */
const FACE_SHARE = 0.8;
/** A parity pixel differing by more than this in any channel counts. */
const PARITY_CHANNEL_SLACK = 16;
/** How many such pixels a parity frame may hold: none. */
const PARITY_MAX_DIFFERING = 0;
/** Where the cell sits on the canvases the runtime path is drawn into. */
const DRAW_ORIGIN = { x: TILE_X * DENSITY, y: TILE_Y * DENSITY };
const DIGITS = 2;

interface Subject {
  readonly id: HeldVisualId;
  readonly look: HeldVisualDef;
  readonly figure: HumanFigure;
  readonly rows: readonly HumanRowName[];
  /** A tool's head bites below the ground line on its impact frame. */
  readonly bitesGround: boolean;
}

function viewRows(rows: Readonly<Record<string, HumanRowName>>): HumanRowName[] {
  return Object.values(rows);
}

/**
 * Rows a weapon is checked on: every row its grip and weight play — stance,
 * stride, every blow standing and on the move, the draw and the stow — and
 * the bare-handed rows he is drawn in on almost every frame, which carry it
 * where its set has none of its own (all of them, for a slingshot).
 */
function weaponRows(look: WeaponHeldVisualDef): readonly HumanRowName[] {
  const set = motionSetOf(look);
  const own = HUMAN_ROWS.filter((row) => motionSetOfRow(row) === set).map((row) => row.name);
  const carried = residentViewSpans('unarmed').map((span) => span.row);
  return [...new Set(set === 'unarmed' ? carried : [...own, ...carried])];
}

function subjects(only: string | null): Subject[] {
  const base = humanFigureFor(BARE_CARL_OUTFIT, null);
  const list: Subject[] = [];
  for (const id of TOOL_HELD_VISUAL_IDS) {
    const rows = id.includes('pick') ? viewRows(MINE_ROWS) : viewRows(CHOP_ROWS);
    list.push({ id, look: HELD_VISUALS[id], figure: base, rows, bitesGround: true });
  }
  list.push({
    id: 'quest_scythe',
    look: HELD_VISUALS.quest_scythe,
    figure: base,
    rows: viewRows(CHOP_ROWS),
    bitesGround: true,
  });
  for (const id of FIXTURE_TOOL_VISUAL_IDS) {
    list.push({
      id,
      look: HELD_VISUALS[id],
      figure: base,
      rows: viewRows(MINE_ROWS),
      bitesGround: true,
    });
  }
  for (const id of WEAPON_HELD_VISUAL_IDS) {
    const look = HELD_VISUALS[id];
    const figure = humanFigureFor(BARE_CARL_OUTFIT, carriedGripOf(look));
    list.push({ id, look, figure, rows: weaponRows(look), bitesGround: false });
  }
  return only === null ? list : list.filter((subject) => subject.id === only);
}

function sourceOf(figure: HumanFigure): SocketSource {
  return { id: figure.def.id, painting: figure.painting };
}

interface Layers {
  readonly back: Canvas;
  readonly front: Canvas;
  readonly frontAlpha: Uint8ClampedArray;
}

const layersByCell = new Map<string, Layers>();

/** A layered cell's two layers at the tile's density, baked once and shared by every item checked on it. */
function layersOf(figure: HumanFigure, row: HumanRowName, frame: number): Layers {
  const key = `${figure.def.id}:${row}:${frame}`;
  const known = layersByCell.get(key);
  if (known !== undefined) return known;
  const back = createCanvas(CELL_W, CELL_H);
  const front = createCanvas(CELL_W, CELL_H);
  const backCtx = asGameContext(back.getContext('2d'));
  const frontCtx = asGameContext(front.getContext('2d'));
  backCtx.scale(DENSITY, DENSITY);
  frontCtx.scale(DENSITY, DENSITY);
  paintDressedHumanLayers(backCtx, frontCtx, row, frame, figure.painting);
  const frontAlpha = front.getContext('2d').getImageData(0, 0, CELL_W, CELL_H).data;
  const found = { back, front, frontAlpha };
  layersByCell.set(key, found);
  return found;
}

/** The item alone, drawn at its socket the way the runtime composites it. */
function itemAlone(look: HeldVisualDef, socket: SocketFrame): Uint8ClampedArray {
  const canvas = createCanvas(CELL_W, CELL_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  const centre = { x: socket.centre.x * DENSITY, y: socket.centre.y * DENSITY };
  compositeHeldItem(
    ctx,
    look,
    heldTransformAt({ ...socket, centre }, DENSITY * HUMAN_CELL_PX_PER_UNIT),
    'cached',
  );
  return canvas.getContext('2d').getImageData(0, 0, CELL_W, CELL_H).data;
}

function alphaAt(data: Uint8ClampedArray, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= CELL_W || y >= CELL_H) return 0;
  return data[(y * CELL_W + x) * RGBA + ALPHA];
}

/** The nearest ink pixel's centre to `point`, in tile pixels, or infinity for none. */
function nearestInk(data: Uint8ClampedArray, point: Pt): number {
  let best = Number.POSITIVE_INFINITY;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      if (alphaAt(data, x, y) <= INK) continue;
      best = Math.min(best, Math.hypot(x + PIXEL_CENTRE - point.x, y + PIXEL_CENTRE - point.y));
    }
  }
  return best;
}

/** A pixel's centre, from its integer corner. */
const PIXEL_CENTRE = 0.5;

function inTile(point: Pt): Pt {
  return { x: point.x * DENSITY, y: point.y * DENSITY };
}

/** Every pixel in a disc, by its integer coordinates. */
function discPixels(centre: Pt, radius: number): Pt[] {
  const pixels: Pt[] = [];
  for (let y = Math.floor(centre.y - radius); y <= Math.ceil(centre.y + radius); y++) {
    for (let x = Math.floor(centre.x - radius); x <= Math.ceil(centre.x + radius); x++) {
      if (Math.hypot(x + PIXEL_CENTRE - centre.x, y + PIXEL_CENTRE - centre.y) <= radius)
        pixels.push({ x, y });
    }
  }
  return pixels;
}

function frameName(subject: Subject, row: HumanRowName, frame: number): string {
  return `${subject.id} on ${row}[${frame}]`;
}

interface Counts {
  e1: number;
  e2: number;
  e3: number;
  e4: number;
  e7: number;
}

function checkSubject(subject: Subject, failures: string[], counts: Counts): void {
  const source = sourceOf(subject.figure);
  for (const row of subject.rows) {
    const meta = HUMAN_ROW_TABLE[row];
    for (let frame = 0; frame < meta.frameCount; frame++) {
      const frames = carlSocketsAt(source, row, frame);
      const socket = heldSocketOf(subject.look, frames);
      if (socket === null) continue;
      const name = frameName(subject, row, frame);
      const layers = layersOf(subject.figure, row, frame);
      const item = itemAlone(subject.look, socket);
      const centre = inTile(socket.centre);

      counts.e1++;
      const probe = probeHumanJoints(row, frame);
      const holding =
        frames.butt === undefined
          ? [{ socket, arm: probe.rightArm }]
          : [
              { socket: frames.sockets.mainHand, arm: probe.rightArm },
              { socket: frames.sockets.offHand, arm: probe.leftArm },
            ];
      for (const { socket: hand, arm } of holding) {
        const offFist = toSegment(hand.centre, arm.wrist, arm.handTip) * DENSITY;
        if (offFist > SOCKET_ON_FIST_PX) {
          failures.push(
            `E1: ${name} puts a socket ${offFist.toFixed(DIGITS)} px off the fist that holds it ` +
              `(limit ${SOCKET_ON_FIST_PX})`,
          );
        }
      }
      const handleOff = nearestInk(item, centre);
      if (handleOff > HANDLE_ON_SOCKET_PX) {
        failures.push(
          `E1: ${name} puts the handle ${handleOff.toFixed(DIGITS)} px from its socket ` +
            `(limit ${HANDLE_ON_SOCKET_PX})`,
        );
      }
      const fingersOff = nearestInk(layers.frontAlpha, centre);
      if (fingersOff > FINGERS_ON_SOCKET_PX) {
        failures.push(
          `E1: ${name} has no fingers over its socket — the nearest front ink is ` +
            `${fingersOff.toFixed(DIGITS)} px off (limit ${FINGERS_ON_SOCKET_PX})`,
        );
      }
      if (frames.butt !== undefined) {
        const upper = frames.butt === 'mainHand' ? frames.sockets.offHand : frames.sockets.mainHand;
        const upperOff = nearestInk(item, inTile(upper.centre));
        if (upperOff > HANDLE_ON_SOCKET_PX) {
          failures.push(
            `E1: ${name} runs the haft ${upperOff.toFixed(DIGITS)} px wide of the upper fist ` +
              `(limit ${HANDLE_ON_SOCKET_PX})`,
          );
        }
      }

      counts.e2++;
      let onBorder = 0;
      let deepest = 0;
      const groundY = ORIGIN_Y * DENSITY + floorReachPx(meta.view);
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          if (alphaAt(item, x, y) <= INK) continue;
          if (x === 0 || y === 0 || x === CELL_W - 1 || y === CELL_H - 1) onBorder++;
          deepest = Math.max(deepest, y + 1 - groundY);
        }
      }
      if (onBorder > 0) failures.push(`E2: ${name} paints ${onBorder} px on the cell's border`);
      if (deepest > BELOW_GROUND_PX && !bitesGround(subject, row, frame)) {
        failures.push(
          `E2: ${name} paints ${deepest.toFixed(DIGITS)} px into the floor ` +
            `(limit ${BELOW_GROUND_PX})`,
        );
      }

      if (VIEWS[meta.view].showsBack) continue;
      const face = inTile(probe.headCentre);
      const faceRadius = HEAD_RX * HUMAN_CELL_PX_PER_UNIT * FACE_SHARE * DENSITY;
      const fistAtFace = [frames.sockets.mainHand, frames.sockets.offHand].some(
        (hand) =>
          hand.occupied &&
          Math.hypot(...delta(inTile(hand.centre), face)) <= faceRadius + FIST_AT_FACE_PX,
      );
      if (!fistAtFace) {
        counts.e3++;
        const overFace = discPixels(face, faceRadius).filter(
          (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) <= INK,
        ).length;
        if (overFace > 0)
          failures.push(`E3: ${name} lays ${overFace} px of the item over his face`);
      }
    }
  }
}

/**
 * How far below his ground line the floor itself runs, in tile pixels.
 * Edge-on the floor is the ground line. Head-on the floor ahead of and behind
 * him is drawn down and up the screen, foreshortened, so a thing a long haft
 * ahead of him stands below the line his soles are on.
 */
function floorReachPx(view: CardinalView): number {
  if (VIEWS[view].profile) return 0;
  return HEAD_ON_FLOOR_FORESHORTENING * LONGEST_REACH_UNITS * HUMAN_CELL_PX_PER_UNIT * DENSITY;
}

/** The farthest any held item reaches ahead of him, rig units: the longest haft and its head. */
const LONGEST_REACH_UNITS = 2;

/**
 * A tool's head bites what it works on the frame it lands, and is still in it
 * the frame after, as the swing works it loose.
 */
const BITE_HOLD_FRAMES = 1;

/**
 * Merrit's scythe has no swing of its own: it is swung on the axe's profile
 * chop, whose backswing carries the head down past his shins. The scythe's
 * long blade skims below the floor's line on those two frames, by three
 * pixels at the tile; a swing authored for the scythe is what removes it.
 */
const SCYTHE_SKIM_OPENING_FRAME = 0;
const SCYTHE_SKIM_CLOSING_FRAME = 11;
const SCYTHE_SKIM_FRAMES = [SCYTHE_SKIM_OPENING_FRAME, SCYTHE_SKIM_CLOSING_FRAME];
const SCYTHE_SKIMS: ReadonlyMap<HumanRowName, readonly number[]> = new Map([
  [CHOP_ROWS.side, SCYTHE_SKIM_FRAMES],
]);

function bitesGround(subject: Subject, row: HumanRowName, frame: number): boolean {
  if (subject.id === 'quest_scythe' && (SCYTHE_SKIMS.get(row)?.includes(frame) ?? false)) {
    return true;
  }
  const impact = eventFrame(row, 'impact');
  if (!subject.bitesGround || impact === undefined) return false;
  return frame >= impact && frame <= impact + BITE_HOLD_FRAMES;
}

function delta(a: Pt, b: Pt): [number, number] {
  return [a.x - b.x, a.y - b.y];
}

/** E4 runs per hand: each occupied hand on the item, judged in its own disc. */
function checkWrap(subject: Subject, failures: string[], counts: Counts): void {
  const source = sourceOf(subject.figure);
  for (const row of subject.rows) {
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const frames = carlSocketsAt(source, row, frame);
      const socket = heldSocketOf(subject.look, frames);
      if (socket === null) continue;
      const hands =
        frames.butt === undefined ? [socket] : [frames.sockets.mainHand, frames.sockets.offHand];
      const layers = layersOf(subject.figure, row, frame);
      const item = itemAlone(subject.look, socket);
      for (const hand of hands) {
        counts.e4++;
        const disc = discPixels(inTile(hand.centre), WRAP_DISC_PX);
        const wrapped = disc.filter(
          (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) > INK,
        ).length;
        const name = frameName(subject, row, frame);
        if (wrapped === 0) {
          failures.push(`E4: ${name} has no finger over the handle it holds`);
          continue;
        }
        // A hand behind his body shows nothing of the handle past it either way.
        if (hand.palmNormal.z <= 0 || hand.behind) continue;
        const showing = discPixels(inTile(hand.centre), WRAP_DISC_PX * SHOWING_DISC_SCALE).filter(
          (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) <= INK,
        ).length;
        if (showing === 0) {
          failures.push(
            `E4: ${name} turns the palm to the camera yet hides the whole handle in the fist`,
          );
        }
      }
    }
  }
}

/** Rows that hold one of the row's own props. */
function propRows(only: string | null): HumanRowName[] {
  const base = humanFigureFor(BARE_CARL_OUTFIT, null);
  return HUMAN_ROWS.filter((row) =>
    Array.from({ length: row.frameCount }, (_unused, frame) => frame).some((frame) => {
      const props = base.painting.dress(row.pose(frame), row, frame).heldProps ?? [];
      return props.some((prop) => only === null || scriptedPropVisual(prop).def.id === only);
    }),
  ).map((row) => row.name);
}

function pixelsOf(canvas: Canvas): Uint8ClampedArray {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < a.length; i += RGBA) {
    for (let channel = 0; channel < RGBA; channel++) {
      if (Math.abs(a[i + channel] - b[i + channel]) > PARITY_CHANNEL_SLACK) {
        count++;
        break;
      }
    }
  }
  return count;
}

function checkParity(only: string | null, failures: string[]): void {
  const base = humanFigureFor(BARE_CARL_OUTFIT, null);
  let measured = 0;
  for (const row of propRows(only)) {
    for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
      const props = base.painting.dress(
        HUMAN_ROW_TABLE[row].pose(frame),
        {
          name: row,
          ...HUMAN_ROW_TABLE[row],
        },
        frame,
      ).heldProps;
      // Two props in his hands are baked one over the other, each with what of
      // him lies in front of it; the runtime composites one item.
      if (props?.length !== 1) continue;
      measured++;
      const baked = createCanvas(CELL_W, CELL_H);
      const bakedCtx = asGameContext(baked.getContext('2d'));
      bakedCtx.scale(DENSITY, DENSITY);
      base.def.paintFrame(bakedCtx, row, frame);

      const back = createCanvas(CELL_W, CELL_H);
      const front = createCanvas(CELL_W, CELL_H);
      const backCtx = asGameContext(back.getContext('2d'));
      const frontCtx = asGameContext(front.getContext('2d'));
      backCtx.scale(DENSITY, DENSITY);
      frontCtx.scale(DENSITY, DENSITY);
      paintDressedHumanLayers(backCtx, frontCtx, row, frame, base.painting, { deferProps: true });
      paintRowProps(backCtx, row, frame, base.painting);
      const backNode = back.getContext('2d');
      backNode.setTransform(1, 0, 0, 1, 0, 0);
      backNode.drawImage(front, 0, 0);
      const count = differing(pixelsOf(baked), pixelsOf(back));
      if (count > PARITY_MAX_DIFFERING) {
        failures.push(
          `E6: ${row}[${frame}] composited at runtime differs from its bake in ${count} px`,
        );
      }
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'prop frames').map((f) => `E6: ${f}`));
}

/** The runtime draw of one cell at the tile, onto a canvas the cell fits. */
function drawnAtTile(
  subject: Subject,
  row: HumanRowName,
  frame: number,
  flipX: boolean,
): Uint8ClampedArray {
  const canvas = createCanvas(CELL_W, CELL_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  beginFigureFrame();
  drawHumanFigureSelection(
    ctx,
    subject.figure,
    DRAW_ORIGIN.x,
    DRAW_ORIGIN.y,
    TILE,
    { row, frame, flipX },
    { look: subject.look, phase: 0 },
  );
  return pixelsOf(canvas);
}

/** `data` reflected left for right about the tile's centre column. */
function reflected(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const axis = DRAW_ORIGIN.x + TILE / 2;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const from = 2 * axis - 1 - x;
      if (from < 0 || from >= CELL_W) continue;
      for (let channel = 0; channel < RGBA; channel++) {
        out[(y * CELL_W + x) * RGBA + channel] = data[(y * CELL_W + from) * RGBA + channel];
      }
    }
  }
  return out;
}

/**
 * Pixels a reflected draw may differ from the reflection by: a turned blit
 * rounds its edge pixels toward one side, so a mirrored one lands a stray
 * pixel or two on the other.
 */
const MIRROR_STRAY_PX = 2;

/** How far `p` lies from the segment `a`–`b`. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Tolerance on a reflected socket against its reflection, cell pixels. */
const MIRROR_EPSILON = 1e-9;

function checkMirror(subject: Subject, failures: string[], counts: Counts): void {
  const source = sourceOf(subject.figure);
  for (const row of subject.rows) {
    const meta = HUMAN_ROW_TABLE[row];
    for (let frame = 0; frame < meta.frameCount; frame++) {
      const frames = carlSocketsAt(source, row, frame);
      const socket = heldSocketOf(subject.look, frames);
      if (socket === null) continue;
      const name = frameName(subject, row, frame);
      counts.e7++;
      const probe = probeHumanJoints(row, frame);
      const main = frames.sockets.mainHand.centre;
      const toRight = toSegment(main, probe.rightArm.wrist, probe.rightArm.handTip);
      const toLeft = toSegment(main, probe.leftArm.wrist, probe.leftArm.handTip);
      if (toRight > toLeft) {
        failures.push(`E7: ${name} puts the main hand's socket on his left hand`);
      }
      if (!meta.mirrorable) continue;
      const flipped = mirroredSocket(socket, true);
      const axisX = TILE_X + TILE_SCALE / 2;
      const off =
        Math.abs(flipped.centre.x - (2 * axisX - socket.centre.x)) +
        Math.abs(flipped.axis.x + socket.axis.x) +
        Math.abs(flipped.palmNormal.x + socket.palmNormal.x);
      if (off > MIRROR_EPSILON) failures.push(`E7: ${name} mirrors its socket wrongly (${off})`);
      const count = differing(
        drawnAtTile(subject, row, frame, true),
        reflected(drawnAtTile(subject, row, frame, false)),
      );
      if (count > MIRROR_STRAY_PX) {
        failures.push(`E7: ${name} drawn facing −X is not its reflection (${count} px differ)`);
      }
    }
  }
}

/** Every row's own prop held in a closed hand is turned in depth. */
function checkPropsTurned(failures: string[]): number {
  const base = humanFigureFor(BARE_CARL_OUTFIT, null);
  let measured = 0;
  for (const row of HUMAN_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = base.painting.dress(row.pose(frame), row, frame);
      for (const prop of pose.heldProps ?? []) {
        const shape = prop.hand === 'left' ? pose.leftHandShape : pose.rightHandShape;
        if (shape !== 'grip') continue;
        const orientation =
          prop.hand === 'left' ? pose.leftHandOrientation : pose.rightHandOrientation;
        measured++;
        if (orientation !== undefined) continue;
        // A prop its painter lays away from the hand — a board on the floor
        // ahead of him — is not held, and the hand only braces near it.
        if (row.view !== 'back' && prop.kind === 'board') continue;
        failures.push(
          `E1: ${row.name}[${frame}] closes his ${prop.hand} hand on a ${prop.kind} without turning it in depth`,
        );
      }
    }
  }
  return measured;
}

/** Rows a stowed weapon is seen on from behind: standing, walking and running. */
const STOWED_AWAY_ROWS: readonly HumanRowName[] = ['idle_away', 'walk_away', 'run_away'];

/** One cell drawn at the tile through the runtime path, with `stowed` at its rest or nothing. */
function stowedCellAtTile(
  figure: HumanFigure,
  row: HumanRowName,
  frame: number,
  stowed: CarlStowedDraw | null,
): Uint8ClampedArray {
  const canvas = createCanvas(CELL_W, CELL_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  beginFigureFrame();
  drawHumanFigureSelection(
    ctx,
    figure,
    DRAW_ORIGIN.x,
    DRAW_ORIGIN.y,
    TILE,
    { row, frame, flipX: false },
    null,
    stowed,
  );
  return pixelsOf(canvas);
}

/** Pixels `bare` paints fully opaque that `dressed` paints differently. */
function opaqueCovered(bare: Uint8ClampedArray, dressed: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < bare.length; i += RGBA) {
    if (bare[i + ALPHA] < OPAQUE) continue;
    for (let channel = 0; channel < RGBA; channel++) {
      if (Math.abs(bare[i + channel] - dressed[i + channel]) > PARITY_CHANNEL_SLACK) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** E8: every stowed weapon under every garment that hangs over his back, seen from behind. */
function checkStowedUnderBack(only: string | null, failures: string[]): void {
  const backGarments = garmentsOf('human').filter((garment) => garment.paint.back !== undefined);
  const stowedWeapons = WEAPON_HELD_VISUAL_IDS.filter(
    (id) => stowedPlacementOfHeld(HELD_VISUALS[id]) !== 'none',
  );
  const onlyGarment = backGarments.filter((garment) => garment.id === only);
  const onlyWeapon = stowedWeapons.filter((id) => id === only);
  if (only !== null && onlyGarment.length === 0 && onlyWeapon.length === 0) return;
  const garments = onlyGarment.length > 0 ? onlyGarment : backGarments;
  const looks = onlyWeapon.length > 0 ? onlyWeapon : stowedWeapons;
  let measured = 0;
  for (const garment of garments) {
    const figure = humanFigureFor(outfitOf('human', [garment]), null);
    for (const row of STOWED_AWAY_ROWS) {
      for (let frame = 0; frame < HUMAN_ROW_TABLE[row].frameCount; frame++) {
        const bare = stowedCellAtTile(figure, row, frame, null);
        for (const id of looks) {
          const look = HELD_VISUALS[id];
          const placement = stowedPlacementOfHeld(look);
          if (placement === 'none') continue;
          const dressed = stowedCellAtTile(figure, row, frame, { look, placement });
          measured++;
          const over = opaqueCovered(bare, dressed);
          if (over > 0) {
            failures.push(
              `E8: ${id} stowed at the ${placement} paints over ${over} px of him in ${garment.id} — ${row}[${frame}]`,
            );
          }
        }
      }
    }
  }
  failures.push(...nothingMeasuredFailures(measured, 'stowed frames').map((f) => `E8: ${f}`));
}

export function equipmentGateFailures(only: string | null = null): string[] {
  const failures: string[] = [];
  const counts: Counts = { e1: 0, e2: 0, e3: 0, e4: 0, e7: 0 };
  const chosen = subjects(only);
  for (const subject of chosen) {
    checkSubject(subject, failures, counts);
    checkWrap(subject, failures, counts);
    checkMirror(subject, failures, counts);
  }
  const isProp = only === null || SCRIPTED_PROP_VISUAL_IDS.some((id) => id === only);
  if (only === null) {
    const turned = checkPropsTurned(failures);
    failures.push(...nothingMeasuredFailures(turned, 'held props').map((f) => `E1: ${f}`));
  }
  if (chosen.length > 0) {
    failures.push(...nothingMeasuredFailures(counts.e1, 'held frames').map((f) => `E1: ${f}`));
    failures.push(...nothingMeasuredFailures(counts.e2, 'held frames').map((f) => `E2: ${f}`));
    failures.push(...nothingMeasuredFailures(counts.e3, 'face frames').map((f) => `E3: ${f}`));
    failures.push(...nothingMeasuredFailures(counts.e4, 'gripping hands').map((f) => `E4: ${f}`));
    failures.push(...nothingMeasuredFailures(counts.e7, 'held frames').map((f) => `E7: ${f}`));
  }
  if (isProp) checkParity(only, failures);
  checkStowedUnderBack(only, failures);
  failures.push(...garmentEnvelopeFailures(only));
  failures.push(...donutHeldFailures(only));
  const gatedElsewhere = gatesGarment(only ?? '') || gatesDonutHeld(only ?? '');
  if (only !== null && chosen.length === 0 && !isProp && !gatedElsewhere) {
    failures.push(`no held visual "${only}" to gate`);
  }
  return failures;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const itemArg = process.argv.find((arg) => arg.startsWith('--item='));
  const only = itemArg === undefined ? null : itemArg.slice('--item='.length);
  console.log(`Gating Carl's equipment${only === null ? '' : ` (${only})`}…`);
  reportFigureGates('equipment', equipmentGateFailures(only));
}
