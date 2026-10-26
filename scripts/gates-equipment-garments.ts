/**
 * E5, the garment envelope: no garment paints outside the part it is worn on.
 *
 * Each garment is painted where the game paints it — inside the wearer's own
 * figure, at the moment the anatomy reaches each piece of the part — but onto
 * a surface of its own, with the context's transform at that moment, so its
 * ink is measured whole, before anything painted later covers it. The part's
 * envelope is painted alongside from the silhouettes its pieces publish, grown
 * by the part's allowance (`src/sprites/garments/envelopes.ts`). Ink outside
 * the envelope fails, naming the garment, part, row and frame; so does a
 * garment that inks nothing anywhere.
 *
 * Every row and frame of every garment of both crawlers, at the 32 px tile.
 * Garments that cover no skin are painted together; one that covers skin, and
 * so hides whatever covers it from further in, is painted on its own, so the
 * envelope it is measured against is the one it is worn with.
 *
 *   npx tsx scripts/gates-equipment-garments.ts
 *   npx tsx scripts/gates-equipment-garments.ts --item=townsfolk_shoes
 */

import { createCanvas } from 'canvas';
import { pathToFileURL } from 'node:url';
import { nothingMeasuredFailures, reportFigureGates } from './figureGates.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext, type NodeContext } from './nodeGameContext.js';
import { catLookOf, humanLookOf, isItemId, ITEM_DEF } from '../src/core/items/defs/ItemDefs.js';
import type { CatDressing, CatPartFrames, CatPartName } from '../src/sprites/art/catParts.js';
import type {
  BipedDressing,
  BipedPartFrames,
  BipedPartName,
} from '../src/sprites/art/biped/bipedParts.js';
import {
  CAT_ROWS,
  FRAME_H as CAT_FRAME_H,
  FRAME_W as CAT_FRAME_W,
  TILE_SCALE as CAT_TILE_SCALE,
  paintCatCell,
} from '../src/sprites/art/catFigure.js';
import { drawBipedBack, drawBipedFront, drawBipedSide } from '../src/sprites/art/biped/figure.js';
import { type BipedPose, type ViewSpec, VIEWS } from '../src/sprites/art/biped/rig.js';
import { dressedPose } from '../src/sprites/art/human/appearance.js';
import {
  HUMAN_SCALE,
  PLAYER_HUMAN_CELL_PX_PER_UNIT,
  TILE_SCALE as HUMAN_TILE_SCALE,
} from '../src/sprites/art/human/figureScale.js';
import { HUMAN_ROWS, ORIGIN_X, ORIGIN_Y } from '../src/sprites/art/humanFigure.js';
import type { CardinalView } from '../src/sprites/facingView.js';
import { GARMENT_ENVELOPES, type EnvelopeAllowance } from '../src/sprites/garments/envelopes.js';
import type {
  FrameEnvelope,
  GarmentDef,
  GarmentFrameContext,
  GarmentWearer,
  WornGarmentDef,
} from '../src/sprites/garments/garmentDef.js';
import { humanWornOn } from '../src/sprites/garments/human/humanDressing.js';
import { garmentsOf, wornGarmentOf } from '../src/sprites/garments/garments.js';
import {
  gloveOf,
  outfitOf,
  sleevesOf,
  type Outfit,
  type OutfitBase,
} from '../src/sprites/garments/outfit.js';
import type { CatLook } from '../src/sprites/looks/catLook.js';
import { type HumanLook, playerLookAxes, withLookBuild } from '../src/sprites/looks/humanLook.js';
import { HUMAN_LOOKS } from './humanLooks.js';
import { CAT_LOOKS } from './catLooks.js';

const TILE = 32;
const CAT_DENSITY = TILE / CAT_TILE_SCALE;
const HUMAN_DENSITY = TILE / HUMAN_TILE_SCALE;
/**
 * The cat's ink lands in her cell. The human's lands on the surfaces his compositor
 * builds round his whole reach, so his are measured on a surface sized for the
 * widest of them at the tile.
 */
const CAT_SURFACE_PX = Math.ceil(Math.max(CAT_FRAME_W, CAT_FRAME_H) * CAT_DENSITY);
const HUMAN_SURFACE_PX = 256;
const RGBA = 4;
const ALPHA = 3;
/** Ink at least this opaque counts: the faint edge of an antialiased stroke does not. */
const INK = 64;
/** How finely a rise or drop is swept, as a share of the part's margin. */
const SWEEP_STEP_SHARE = 0.5;
const WHITE = '#ffffff';

const CAT_PARTS: readonly CatPartName[] = ['head', 'neck', 'body', 'foreleg', 'hindleg', 'tail'];
const HUMAN_PARTS: readonly BipedPartName[] = [
  'head',
  'torso',
  'neck',
  'hips',
  'forearm',
  'back',
  'foot',
  'leg',
];

interface Surface {
  readonly ctx: NodeContext;
  readonly size: number;
}

function surface(size: number): Surface {
  return { ctx: createCanvas(size, size).getContext('2d'), size };
}

function clear(target: Surface): void {
  target.ctx.setTransform(1, 0, 0, 1, 0, 0);
  target.ctx.clearRect(0, 0, target.size, target.size);
}

/** The 2D affine part of a transform read off the game's context. */
interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

function applyTransform(ctx: NodeContext, m: Affine): void {
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}

function traceEnvelope(ctx: NodeContext, envelope: NonNullable<FrameEnvelope>): void {
  if (typeof envelope === 'function') {
    envelope(asGameContext(ctx));
    return;
  }
  ctx.beginPath();
  envelope.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

/** One piece's silhouette grown by the allowance, swept from its rise above to its drop below. */
function paintEnvelope(
  target: Surface,
  transform: Affine,
  envelope: NonNullable<FrameEnvelope>,
  allowance: EnvelopeAllowance,
): void {
  const { ctx } = target;
  const step = allowance.margin * SWEEP_STEP_SHARE;
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = WHITE;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = allowance.margin * 2;
  for (let offset = -allowance.rise; offset <= allowance.drop + step / 2; offset += step) {
    applyTransform(ctx, transform);
    ctx.translate(0, Math.min(offset, allowance.drop));
    traceEnvelope(ctx, envelope);
    ctx.fill();
    ctx.stroke();
  }
}

/** Where each garment's ink and each part's envelope are painted while one cell is drawn. */
interface Measure {
  readonly envelopes: ReadonlyMap<string, Surface>;
  readonly ink: ReadonlyMap<string, Surface>;
  readonly painted: Set<string>;
}

function inkKey(garmentId: string, part: string): string {
  return `${garmentId}/${part}`;
}

/**
 * Routes one piece's envelope, and every garment's ink on it, to their
 * surfaces. `paint` paints one garment's painter for the piece, if it has one.
 */
function measurePiece<W extends GarmentWearer>(
  outfit: Outfit<W>,
  measure: Measure,
  allowances: Readonly<Partial<Record<string, EnvelopeAllowance>>>,
  ctx: CanvasRenderingContext2D,
  part: string,
  envelope: FrameEnvelope,
  paint: (garment: GarmentDef<W>, target: CanvasRenderingContext2D) => boolean,
): void {
  const transform = ctx.getTransform();
  const envelopeSurface = measure.envelopes.get(part);
  const allowance = allowances[part];
  if (envelope !== null && envelopeSurface !== undefined && allowance !== undefined) {
    paintEnvelope(envelopeSurface, transform, envelope, allowance);
  }
  for (const garment of outfit.garments) {
    const ink = measure.ink.get(inkKey(garment.id, part));
    if (ink === undefined) continue;
    applyTransform(ink.ctx, transform);
    ink.ctx.save();
    const painted = paint(garment, asGameContext(ink.ctx));
    ink.ctx.restore();
    if (painted) measure.painted.add(inkKey(garment.id, part));
  }
}

function catMeasuringDressing(
  outfit: Outfit<'cat'>,
  measure: Measure,
  context: GarmentFrameContext<'cat'>,
): CatDressing {
  return {
    part: <P extends CatPartName>(
      ctx: CanvasRenderingContext2D,
      part: P,
      frame: CatPartFrames[P],
    ) =>
      measurePiece(
        outfit,
        measure,
        GARMENT_ENVELOPES.cat,
        ctx,
        part,
        frame.envelope,
        (garment, target) => {
          const painters = garment.paint[part];
          if (painters === undefined) return false;
          painters[context.view](target, frame, context);
          return true;
        },
      ),
  };
}

function humanMeasuringDressing(
  outfit: Outfit<'human'>,
  measure: Measure,
  context: GarmentFrameContext<'human'>,
): BipedDressing {
  return {
    paints: (part) => outfit.garments.some((garment) => garment.paint[part] !== undefined),
    sleeves: sleevesOf(outfit),
    glove: (side) => gloveOf(outfit, side),
    part: <P extends BipedPartName>(
      ctx: CanvasRenderingContext2D,
      part: P,
      frame: BipedPartFrames[P],
    ) =>
      measurePiece(
        outfit,
        measure,
        GARMENT_ENVELOPES.human,
        ctx,
        part,
        frame.envelope,
        (garment, target) => {
          const painters = garment.paint[part];
          if (painters === undefined) return false;
          painters[context.view](target, frame, context);
          return true;
        },
      ),
  };
}

function alphaOf(target: Surface): Uint8ClampedArray {
  const { data } = target.ctx.getImageData(0, 0, target.size, target.size);
  const alpha = new Uint8ClampedArray(target.size * target.size);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * RGBA + ALPHA];
  return alpha;
}

/** Ink pixels with no envelope under them. */
function spill(ink: Uint8ClampedArray, envelope: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] >= INK && envelope[i] === 0) count++;
  }
  return count;
}

/** How one wearer's cells are painted with a measuring dressing. */
interface Wearer<W extends GarmentWearer> {
  readonly label: string;
  readonly possessive: string;
  /** The look whose figure is painted, which every outfit of the pass starts from. */
  readonly base: OutfitBase<W>;
  readonly parts: readonly string[];
  readonly surfacePx: number;
  readonly rows: readonly { readonly name: string; readonly frameCount: number }[];
  readonly paintCell: (
    ctx: CanvasRenderingContext2D,
    row: string,
    frame: number,
    outfit: Outfit<W>,
    measure: Measure,
  ) => void;
}

/** The cat painted as `look`: every cat garment is fitted on each of her looks' bodies. */
function catWearer(look: CatLook): Wearer<'cat'> {
  return {
    label: `The cat (${look.id})`,
    possessive: `${look.id}'s`,
    base: look,
    parts: CAT_PARTS,
    surfacePx: CAT_SURFACE_PX,
    rows: CAT_ROWS,
    paintCell: (ctx, row, frame, outfit, measure) => {
      ctx.scale(CAT_DENSITY, CAT_DENSITY);
      paintCatCell(ctx, look, row, frame, (context) =>
        catMeasuringDressing(outfit, measure, context),
      );
    },
  };
}

const DRAW_HUMAN: Readonly<Record<CardinalView, typeof drawBipedFront>> = {
  front: drawBipedFront,
  side: drawBipedSide,
  back: drawBipedBack,
};

/** The human painted as `look`: every human garment is fitted on each of his looks' builds. */
function humanWearer(look: HumanLook): Wearer<'human'> {
  return {
    label: `The human (${look.id})`,
    possessive: `${look.id}'s`,
    base: look,
    parts: HUMAN_PARTS,
    surfacePx: HUMAN_SURFACE_PX,
    rows: HUMAN_ROWS,
    paintCell: (ctx, rowName, frame, outfit, measure) => {
      const row = HUMAN_ROWS.find((candidate) => candidate.name === rowName);
      if (row === undefined) return;
      const pose = withLookBuild(dressedPose(outfit, row.pose(frame), row, frame), look);
      const axes = playerLookAxes(look, VIEWS[row.view].profile);
      ctx.scale(HUMAN_DENSITY, HUMAN_DENSITY);
      ctx.translate(ORIGIN_X, ORIGIN_Y);
      ctx.scale(HUMAN_TILE_SCALE, HUMAN_TILE_SCALE);
      ctx.scale(HUMAN_SCALE * axes.x, HUMAN_SCALE * axes.y);
      DRAW_HUMAN[row.view](ctx, pose, {
        look,
        cellPxPerUnit: PLAYER_HUMAN_CELL_PX_PER_UNIT,
        dressing: (drawn: BipedPose, view: ViewSpec) =>
          humanMeasuringDressing(outfit, measure, humanWornOn(drawn, view, look).context),
      });
    },
  };
}

/**
 * Every garment a look can show: whatever it can put on, and its own base
 * garments, not another look's.
 */
function wornBy(look: HumanLook, garments: readonly GarmentDef<'human'>[]): GarmentDef<'human'>[] {
  return garments.filter((garment) => !garment.base || look.baseGarments.includes(garment));
}

/**
 * E5 for a garment no human look can show: a base garment of none of them.
 * Its envelope is never measured, so it would pass E5 unseen.
 */
function unwornFailures(garments: readonly GarmentDef<'human'>[]): string[] {
  return garments
    .filter((garment) => HUMAN_LOOKS.every((look) => !wornBy(look, [garment]).includes(garment)))
    .map(
      (garment) =>
        `E5: ${garment.id} is worn by no human look (${HUMAN_LOOKS.map((l) => l.id).join(', ')}), ` +
        'so its envelope is never measured',
    );
}

/**
 * The outfits to paint: garments that cover no skin share one, and each one
 * that covers skin, hiding whatever else covers it from further in, gets its
 * own. Base garments ride along in every outfit.
 */
function passes<W extends GarmentWearer>(
  base: OutfitBase<W>,
  worn: readonly WornGarmentDef<W>[],
): Outfit<W>[] {
  const hidesAny = (garment: WornGarmentDef<W>): boolean => garment.covers.length > 0;
  const quiet = worn.filter((garment) => !hidesAny(garment));
  const hiding = worn.filter(hidesAny);
  return [outfitOf(base, quiet), ...hiding.map((garment) => outfitOf(base, [garment]))];
}

function checkPass<W extends GarmentWearer>(
  harness: Wearer<W>,
  outfit: Outfit<W>,
  wanted: ReadonlySet<string>,
  failures: string[],
  measured: Map<string, number>,
): void {
  const envelopes = new Map(
    harness.parts.map((part) => [part, surface(harness.surfacePx)] as const),
  );
  const ink = new Map<string, Surface>();
  for (const garment of outfit.garments) {
    if (!wanted.has(garment.id)) continue;
    for (const part of garment.region) {
      ink.set(inkKey(garment.id, part), surface(harness.surfacePx));
    }
  }
  const scratch = surface(harness.surfacePx);
  for (const row of harness.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      clear(scratch);
      for (const target of [...envelopes.values(), ...ink.values()]) clear(target);
      const measure: Measure = { envelopes, ink, painted: new Set() };
      harness.paintCell(asGameContext(scratch.ctx), row.name, frame, outfit, measure);
      for (const garment of outfit.garments) {
        for (const part of garment.region) {
          const key = inkKey(garment.id, part);
          const target = ink.get(key);
          const envelope = envelopes.get(part);
          if (target === undefined || envelope === undefined || !measure.painted.has(key)) continue;
          const inkAlpha = alphaOf(target);
          if (!inkAlpha.some((alpha) => alpha >= INK)) continue;
          measured.set(garment.id, (measured.get(garment.id) ?? 0) + 1);
          const outside = spill(inkAlpha, alphaOf(envelope));
          if (outside > 0) {
            failures.push(
              `E5: ${garment.name} (${garment.id}) paints ${outside} px outside ${harness.possessive} ${part}'s envelope in ${row.name}[${frame}]`,
            );
          }
        }
      }
    }
  }
}

/** The garments of `wearer` that `only` names: a garment id, or an item's look on them. */
function garmentsNamed<W extends GarmentWearer>(
  wearer: W,
  only: string | null,
  lookOf: (id: string) => GarmentDef<W> | null,
): GarmentDef<W>[] {
  const all = garmentsOf(wearer);
  if (only === null) return [...all];
  const byId = all.find((garment) => garment.id === only);
  if (byId !== undefined) return [byId];
  const looked = lookOf(only);
  return looked === null ? [] : [looked];
}

function catGarmentOfItem(id: string): GarmentDef<'cat'> | null {
  if (!isItemId(id)) return null;
  const look = catLookOf(ITEM_DEF[id]);
  return look?.kind === 'garment' ? wornGarmentOf('cat', look.garment) : null;
}

function humanGarmentOfItem(id: string): GarmentDef<'human'> | null {
  if (!isItemId(id)) return null;
  const look = humanLookOf(ITEM_DEF[id]);
  return look?.kind === 'garment' ? wornGarmentOf('human', look.garment) : null;
}

function wearerFailures<W extends GarmentWearer>(
  harness: Wearer<W>,
  garments: readonly GarmentDef<W>[],
): string[] {
  const failures: string[] = [];
  if (garments.length === 0) return failures;
  const wanted = new Set<string>(garments.map((garment) => garment.id));
  const measured = new Map<string, number>();
  const toMeasure = new Set(wanted);
  for (const outfit of passes(
    harness.base,
    garments.flatMap((garment) => (garment.base ? [] : [garment])),
  )) {
    checkPass(harness, outfit, toMeasure, failures, measured);
    for (const garment of outfit.garments) if (garment.base) toMeasure.delete(garment.id);
  }
  for (const garment of garments) {
    const pieces = measured.get(garment.id) ?? 0;
    const what = `inked pieces of ${harness.label}'s ${garment.name} (${garment.id})`;
    failures.push(...nothingMeasuredFailures(pieces, what).map((f) => `E5: ${f}`));
  }
  return failures;
}

/** Whether `only` names something E5 gates: a garment, or an item worn as one. */
export function gatesGarment(only: string): boolean {
  return (
    garmentsNamed('cat', only, catGarmentOfItem).length > 0 ||
    garmentsNamed('human', only, humanGarmentOfItem).length > 0
  );
}

/** E5 for every garment of both crawlers, or for the garment or item `only` names. */
export function garmentEnvelopeFailures(only: string | null = null): string[] {
  if (typeof document === 'undefined') installCanvasGlobals();
  return [
    ...CAT_LOOKS.flatMap((look) =>
      wearerFailures(catWearer(look), garmentsNamed('cat', only, catGarmentOfItem)),
    ),
    ...HUMAN_LOOKS.flatMap((look) =>
      wearerFailures(
        humanWearer(look),
        wornBy(look, garmentsNamed('human', only, humanGarmentOfItem)),
      ),
    ),
    ...unwornFailures(garmentsNamed('human', only, humanGarmentOfItem)),
  ];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const itemArg = process.argv.find((arg) => arg.startsWith('--item='));
  const only = itemArg === undefined ? null : itemArg.slice('--item='.length);
  if (only !== null && !gatesGarment(only)) {
    reportFigureGates('garments', [`E5: "${only}" is no garment and no item worn as one`]);
  } else {
    console.log(`Gating garment envelopes${only === null ? '' : ` (${only})`}…`);
    reportFigureGates('garments', garmentEnvelopeFailures(only));
  }
}
