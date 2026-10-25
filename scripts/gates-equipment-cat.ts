/**
 * The equipment gates for what the cat holds, checked by painting her where the
 * game paints her: her two-layer cells at the 32 px tile, with the held thing
 * composited between the layers at its socket.
 *
 * - E1 registration: the handle runs through its socket; a tool's socket is
 *   under the front ink of her butt paw, and the haft runs on through her
 *   second paw; a carried thing's socket is in the lower half of her face.
 * - E2 inside the cell: no held ink on the cell's border, none below the
 *   ground line except a tool's head on the frame it bites and the one after.
 * - E3 not across the face: no tool ink over her face where it is drawn,
 *   unless a paw on the haft is at her face. A thing carried in her jaws is
 *   held at her face by design and is not checked.
 * - E4 pad over handle: the pad of each paw drawn in front of the haft
 *   covers some of the haft's ink, and where the pads face the camera the
 *   haft shows past them.
 * - E7 mirror: a west-facing row's sockets are the reflection of its
 *   east-facing twin's, its held thing drawn as the reflection of the east
 *   one, while her coat is painted, not reflected — the west cell differs
 *   from the reflected east cell.
 *
 * `npm run gates:equipment` runs these with the human's. Run on their own,
 * `npx tsx scripts/gates-equipment-cat.ts [--item=<id>]` gates only the cat.
 */

import { pathToFileURL } from 'node:url';
import { createCanvas, type Canvas } from 'canvas';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import {
  CAT_ROWS,
  FRAME_H,
  FRAME_W,
  TILE_SCALE,
  TILE_X,
  WORK_IMPACT_FRAME,
  catPoseToCell,
  paintCatCell,
  type RowSpec,
} from '../src/sprites/art/catFigure.js';
import { GROUND_Y, type Pt } from '../src/sprites/art/catArt.js';
import {
  type CatSocketFrame,
  catGripOf,
  catHeldPxPerUnit,
  catHeldSocketOf,
  catSocketsAt,
} from '../src/sprites/art/catSockets.js';
import { bareCatOutfit, dressCat } from '../src/sprites/garments/cat/catDressing.js';
import type { CatLook } from '../src/sprites/looks/catLook.js';
import { CAT_LOOKS } from './catLooks.js';
import { HELD_VISUALS } from '../src/sprites/held/heldVisuals.js';
import {
  type HeldVisualId,
  MOUTH_CARRY_VISUAL_IDS,
  FIXTURE_TOOL_VISUAL_IDS,
  TOOL_HELD_VISUAL_IDS,
} from '../src/sprites/held/heldVisualIds.js';
import type { HeldVisualDef } from '../src/sprites/held/heldVisualDef.js';
import { compositeHeldItem, heldTransformAt } from '../src/sprites/held/heldComposite.js';
import { TOOL_TIERS } from '../src/core/toolTiers.js';

/** The in-game tile the gates sample at. */
const TILE = 32;
const DENSITY = TILE / TILE_SCALE;
const CELL_W = Math.ceil(FRAME_W * DENSITY);
const CELL_H = Math.ceil(FRAME_H * DENSITY);
const RGBA = 4;
const ALPHA = 3;
/** An alpha above this is ink. */
const INK = 8;
const PIXEL_CENTRE = 0.5;
/** How far, in tile pixels, the handle's ink may lie from a socket or a paw on it. */
const HANDLE_ON_SOCKET_PX = 1.5;
/** How far the holding paw's front ink may lie from the socket: the socket is under the pad itself. */
const PAD_ON_SOCKET_PX = 0.75;
/** The disc round a paw the pad-over-handle rule is judged in: about a paw's half-width at the tile. */
const PAD_DISC_PX = 2;
/**
 * The haft has to show within this many pad discs past the farther of her
 * two paws on it: they sit one after the other along it and cover each
 * other's stretch of it.
 */
const SHOWING_DISC_SCALE = 2;
/** A paw this close to her face's disc, tile pixels, is at her face, and its haft passes her cheek by rights. */
const PAW_AT_FACE_PX = 3;
/** Ink this far below the ground line is in the floor. */
const BELOW_GROUND_PX = 1;
/**
 * Head-on the floor ahead of her runs down the screen, so a tool's head a
 * haft's length toward the camera stands below the line her paws are on: up
 * to this many tile pixels.
 */
const HEAD_ON_FLOOR_PX = 3;
/** A tool's head bites the floor on its impact frame and is still in it the frame after. */
const BITE_HOLD_FRAMES = 1;
/** The face's disc as a share of her head's half-width: eyes and muzzle, not cheek ruffs. */
const FACE_SHARE = 0.75;
/** Pixels a reflected held thing may differ from the reflection by: a turned blit rounds its edges. */
const MIRROR_STRAY_PX = 3;
/**
 * Fewer differing pixels than this between a west cell and the reflected east
 * cell means her coat was flipped. Measured at the tile on her held rows: a
 * coat whose left flank is its right differs from the reflection by 0–6 px
 * (the west twins' light and edge rounding); Pumpkin's painted coat by 93–106
 * and Belle's fine brindle, whose sides differ only in a shoulder streak and
 * her blaze, by 17–29.
 */
const COAT_MIN_DIFFERING_PX = 10;
/** A reflected socket against its reflection, cell pixels. */
const MIRROR_EPSILON = 1e-9;
/** A parity pixel differing by more than this in any channel counts. */
const CHANNEL_SLACK = 16;
const DIGITS = 2;

interface Subject {
  readonly id: HeldVisualId;
  readonly look: HeldVisualDef;
  readonly rows: readonly RowSpec[];
  readonly bitesGround: boolean;
}

function rowsHolding(hold: 'chop' | 'mine' | 'carry'): RowSpec[] {
  return CAT_ROWS.filter((row) => row.hold === hold);
}

function subjects(only: string | null): Subject[] {
  const list: Subject[] = [];
  const picks: readonly string[] = TOOL_TIERS.pickaxe.map((tier) => tier.id);
  for (const id of TOOL_HELD_VISUAL_IDS) {
    const rows = rowsHolding(picks.includes(id) ? 'mine' : 'chop');
    list.push({ id, look: HELD_VISUALS[id], rows, bitesGround: true });
  }
  list.push({
    id: 'quest_scythe',
    look: HELD_VISUALS.quest_scythe,
    rows: rowsHolding('chop'),
    bitesGround: true,
  });
  for (const id of FIXTURE_TOOL_VISUAL_IDS) {
    list.push({ id, look: HELD_VISUALS[id], rows: rowsHolding('mine'), bitesGround: true });
  }
  for (const id of MOUTH_CARRY_VISUAL_IDS) {
    list.push({ id, look: HELD_VISUALS[id], rows: rowsHolding('carry'), bitesGround: false });
  }
  return only === null ? list : list.filter((subject) => subject.id === only);
}

/** Whether `only` names something she holds that these gates check. */
export function gatesCatHeld(only: string): boolean {
  return subjects(only).length > 0;
}

interface Layers {
  readonly back: Canvas;
  readonly frontAlpha: Uint8ClampedArray;
}

const layersByCell = new Map<string, Layers>();

function layersOf(look: CatLook, row: RowSpec, frame: number): Layers {
  const key = `${look.id}:${row.name}:${frame}`;
  const known = layersByCell.get(key);
  if (known !== undefined) return known;
  const back = createCanvas(CELL_W, CELL_H);
  const front = createCanvas(CELL_W, CELL_H);
  const backCtx = asGameContext(back.getContext('2d'));
  const frontCtx = asGameContext(front.getContext('2d'));
  backCtx.scale(DENSITY, DENSITY);
  frontCtx.scale(DENSITY, DENSITY);
  paintCatCell(
    backCtx,
    look,
    row.name,
    frame,
    (context) => dressCat(bareCatOutfit(look), context),
    frontCtx,
  );
  const found = { back, frontAlpha: pixelsOf(front) };
  layersByCell.set(key, found);
  return found;
}

function pixelsOf(canvas: Canvas): Uint8ClampedArray {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

/** The held thing alone, drawn at its socket the way the runtime composites it. */
function itemAlone(look: HeldVisualDef, socket: CatSocketFrame): Uint8ClampedArray {
  const canvas = createCanvas(CELL_W, CELL_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  compositeHeldItem(
    ctx,
    look,
    heldTransformAt({ ...socket, centre: inTile(socket.centre) }, DENSITY * catHeldPxPerUnit(look)),
    'cached',
  );
  return pixelsOf(canvas);
}

function inTile(point: Pt): Pt {
  return { x: point.x * DENSITY, y: point.y * DENSITY };
}

function alphaAt(data: Uint8ClampedArray, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= CELL_W || y >= CELL_H) return 0;
  return data[(y * CELL_W + x) * RGBA + ALPHA];
}

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

function discPixels(centre: Pt, radius: number): Pt[] {
  const pixels: Pt[] = [];
  for (let y = Math.floor(centre.y - radius); y <= Math.ceil(centre.y + radius); y++) {
    for (let x = Math.floor(centre.x - radius); x <= Math.ceil(centre.x + radius); x++) {
      if (Math.hypot(x + PIXEL_CENTRE - centre.x, y + PIXEL_CENTRE - centre.y) <= radius) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

interface Counts {
  e1: number;
  e2: number;
  e3: number;
  e4: number;
  e7: number;
}

function frameName(look: CatLook, subject: Subject, row: RowSpec, frame: number): string {
  return `${look.id}'s ${subject.id} on ${row.name}[${frame}]`;
}

function bites(subject: Subject, frame: number): boolean {
  return (
    subject.bitesGround &&
    frame >= WORK_IMPACT_FRAME &&
    frame <= WORK_IMPACT_FRAME + BITE_HOLD_FRAMES
  );
}

function checkFrame(
  look: CatLook,
  subject: Subject,
  row: RowSpec,
  frame: number,
  failures: string[],
  counts: Counts,
): void {
  const frames = catSocketsAt(look, row.name, frame);
  if (frames === null) {
    failures.push(`E1: ${row.name} is no row of hers to solve sockets on`);
    return;
  }
  const socket = catHeldSocketOf(subject.look, frames);
  const name = frameName(look, subject, row, frame);
  if (socket === null) {
    failures.push(`E1: ${name} holds nothing at its socket on a row played holding it`);
    return;
  }
  const item = itemAlone(subject.look, socket);
  const layers = layersOf(look, row, frame);
  const centre = inTile(socket.centre);
  const isTool = catGripOf(subject.look) === 'pawTool';

  counts.e1++;
  const handleOff = nearestInk(item, centre);
  if (handleOff > HANDLE_ON_SOCKET_PX) {
    failures.push(
      `E1: ${name} puts the handle ${handleOff.toFixed(DIGITS)} px from its socket ` +
        `(limit ${HANDLE_ON_SOCKET_PX})`,
    );
  }
  const face = frames.face;
  if (!isTool && face !== null) {
    const faceCentre = inTile(face.centre);
    const fromFace = Math.hypot(centre.x - faceCentre.x, centre.y - faceCentre.y);
    const belowEyes = centre.y > faceCentre.y;
    if (!belowEyes || fromFace > face.radius * DENSITY) {
      failures.push(`E1: ${name} carries it off her mouth, outside the lower half of her face`);
    }
  }
  if (isTool) {
    const padOff = nearestInk(layers.frontAlpha, centre);
    if (padOff > PAD_ON_SOCKET_PX) {
      failures.push(
        `E1: ${name} has no paw over its socket — the nearest front ink is ` +
          `${padOff.toFixed(DIGITS)} px off (limit ${PAD_ON_SOCKET_PX})`,
      );
    }
    const upper = frames.upperPaw;
    const upperOff = upper === null ? Number.POSITIVE_INFINITY : nearestInk(item, inTile(upper));
    if (upperOff > HANDLE_ON_SOCKET_PX) {
      failures.push(
        `E1: ${name} runs the haft ${upperOff.toFixed(DIGITS)} px wide of her second paw ` +
          `(limit ${HANDLE_ON_SOCKET_PX})`,
      );
    }
  }

  counts.e2++;
  const groundY = catPoseToCell({ x: 0, y: GROUND_Y }).y * DENSITY;
  const floorReach = row.view === 'side' ? 0 : HEAD_ON_FLOOR_PX;
  let onBorder = 0;
  let deepest = 0;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      if (alphaAt(item, x, y) <= INK) continue;
      if (x === 0 || y === 0 || x === CELL_W - 1 || y === CELL_H - 1) onBorder++;
      deepest = Math.max(deepest, y + 1 - groundY - floorReach);
    }
  }
  if (onBorder > 0) failures.push(`E2: ${name} paints ${onBorder} px on the cell's border`);
  if (deepest > BELOW_GROUND_PX && !bites(subject, frame)) {
    failures.push(
      `E2: ${name} paints ${deepest.toFixed(DIGITS)} px into the floor (limit ${BELOW_GROUND_PX})`,
    );
  }

  if (!isTool || face === null) return;
  const faceCentre = inTile(face.centre);
  const faceRadius = face.radius * FACE_SHARE * DENSITY;
  const paws = [socket.centre, frames.upperPaw].flatMap((paw) => (paw === null ? [] : [paw]));
  const pawAtFace = paws.some(
    (paw) =>
      Math.hypot(inTile(paw).x - faceCentre.x, inTile(paw).y - faceCentre.y) <=
      faceRadius + PAW_AT_FACE_PX,
  );
  if (pawAtFace) return;
  counts.e3++;
  const overFace = discPixels(faceCentre, faceRadius).filter(
    (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) <= INK,
  ).length;
  if (overFace > 0) failures.push(`E3: ${name} lays ${overFace} px of the tool over her face`);
}

function checkPads(
  look: CatLook,
  subject: Subject,
  row: RowSpec,
  frame: number,
  failures: string[],
  counts: Counts,
): void {
  if (catGripOf(subject.look) !== 'pawTool') return;
  const frames = catSocketsAt(look, row.name, frame);
  const socket = frames === null ? null : catHeldSocketOf(subject.look, frames);
  if (frames === null || socket === null) return;
  const item = itemAlone(subject.look, socket);
  const layers = layersOf(look, row, frame);
  const name = frameName(look, subject, row, frame);
  counts.e4++;
  const pad = discPixels(inTile(socket.centre), PAD_DISC_PX);
  const covered = pad.filter(
    (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) > INK,
  ).length;
  if (covered === 0) {
    failures.push(`E4: ${name} has no pad over the haft it holds`);
    return;
  }
  // Behind her body the haft shows nowhere past the paw anyway.
  if (socket.palmNormal.z <= 0 || socket.behind) return;
  const upper = frames.upperPaw;
  const pawSpread =
    upper === null
      ? 0
      : Math.hypot(
          inTile(upper).x - inTile(socket.centre).x,
          inTile(upper).y - inTile(socket.centre).y,
        );
  const reach = pawSpread + PAD_DISC_PX * SHOWING_DISC_SCALE;
  const showing = discPixels(inTile(socket.centre), reach).filter(
    (p) => alphaAt(item, p.x, p.y) > INK && alphaAt(layers.frontAlpha, p.x, p.y) <= INK,
  ).length;
  if (showing === 0) failures.push(`E4: ${name} hides the whole haft under her paw`);
}

/** `data` reflected left for right about her tile's centre column. */
function reflected(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const axis = (TILE_X + TILE_SCALE / 2) * DENSITY;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const from = Math.round(2 * axis - 1 - x);
      if (from < 0 || from >= CELL_W) continue;
      for (let channel = 0; channel < RGBA; channel++) {
        out[(y * CELL_W + x) * RGBA + channel] = data[(y * CELL_W + from) * RGBA + channel];
      }
    }
  }
  return out;
}

/** Pixels whose ink differs: by alpha alone, or by any channel. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray, alphaOnly = false): number {
  let count = 0;
  for (let i = 0; i < a.length; i += RGBA) {
    for (let channel = alphaOnly ? ALPHA : 0; channel < RGBA; channel++) {
      if (Math.abs(a[i + channel] - b[i + channel]) > CHANNEL_SLACK) {
        count++;
        break;
      }
    }
  }
  return count;
}

function checkMirror(
  look: CatLook,
  subject: Subject,
  row: RowSpec,
  failures: string[],
  counts: Counts,
): void {
  if (!row.facesWest) return;
  const eastName = row.name.replace(/_west$/, '');
  const east = CAT_ROWS.find((candidate) => candidate.name === eastName);
  if (east === undefined) {
    failures.push(`E7: ${row.name} has no east-facing twin`);
    return;
  }
  const axisX = TILE_X + TILE_SCALE / 2;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const westFrames = catSocketsAt(look, row.name, frame);
    const eastFrames = catSocketsAt(look, east.name, frame);
    const west = westFrames === null ? null : catHeldSocketOf(subject.look, westFrames);
    const eastSocket = eastFrames === null ? null : catHeldSocketOf(subject.look, eastFrames);
    if (west === null || eastSocket === null) continue;
    counts.e7++;
    const name = frameName(look, subject, row, frame);
    const off =
      Math.abs(west.centre.x - (2 * axisX - eastSocket.centre.x)) +
      Math.abs(west.centre.y - eastSocket.centre.y) +
      Math.abs(west.axis.x + eastSocket.axis.x) +
      Math.abs(west.axis.y - eastSocket.axis.y) +
      Math.abs(west.axis.z - eastSocket.axis.z) +
      Math.abs(west.palmNormal.x + eastSocket.palmNormal.x) +
      Math.abs(west.palmNormal.z + eastSocket.palmNormal.z);
    if (off > MIRROR_EPSILON) {
      failures.push(`E7: ${name} does not mirror its east twin's socket (${off.toFixed(DIGITS)})`);
    }
    // By silhouette: the light falls from the same side facing either way.
    const itemsDiffer = differing(
      itemAlone(subject.look, west),
      reflected(itemAlone(subject.look, eastSocket)),
      true,
    );
    if (itemsDiffer > MIRROR_STRAY_PX) {
      failures.push(
        `E7: ${name} draws the held thing other than as its east twin's reflection ` +
          `(${itemsDiffer} px differ)`,
      );
    }
    const coatDiffers = differing(
      pixelsOf(layersOf(look, row, frame).back),
      reflected(pixelsOf(layersOf(look, east, frame).back)),
    );
    if (coatDiffers < COAT_MIN_DIFFERING_PX) {
      failures.push(
        `E7: ${name} is her east twin reflected (${coatDiffers} px differ): her coat would swap sides`,
      );
    }
  }
}

/**
 * Every failure of the gates on what the cat holds, for `only` or for
 * everything. Each look's measurements are counted on their own: pooled, one
 * look's frames could pass another's nothing-measured checks.
 */
export function catHeldFailures(only: string | null = null): string[] {
  const failures: string[] = [];
  const chosen = subjects(only);
  if (chosen.length === 0) return failures;
  const hasTool = chosen.some((subject) => catGripOf(subject.look) === 'pawTool');
  for (const look of CAT_LOOKS) {
    const counts: Counts = { e1: 0, e2: 0, e3: 0, e4: 0, e7: 0 };
    for (const subject of chosen) {
      for (const row of subject.rows) {
        for (let frame = 0; frame < row.frameCount; frame++) {
          checkFrame(look, subject, row, frame, failures, counts);
          checkPads(look, subject, row, frame, failures, counts);
        }
        checkMirror(look, subject, row, failures, counts);
      }
    }
    const unmeasured = (gate: string, count: number, what: string): void => {
      failures.push(
        ...nothingMeasuredFailures(count, `${look.id}'s ${what}`).map((f) => `${gate}: ${f}`),
      );
    };
    unmeasured('E1', counts.e1, 'held frames');
    unmeasured('E2', counts.e2, 'held frames');
    unmeasured('E7', counts.e7, 'west frames');
    if (hasTool) {
      unmeasured('E3', counts.e3, 'face frames');
      unmeasured('E4', counts.e4, 'pads');
    }
  }
  return failures;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  installCanvasGlobals();
  const itemArg = process.argv.find((arg) => arg.startsWith('--item='));
  const only = itemArg === undefined ? null : itemArg.slice('--item='.length);
  console.log(`Gating what the cat holds${only === null ? '' : ` (${only})`}…`);
  reportFigureGates('cat equipment', catHeldFailures(only));
}
