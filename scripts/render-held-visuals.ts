/**
 * Review sheet for every held visual, beside the art it reproduces.
 *
 *   npm run render:held-visuals
 *   npx tsx scripts/render-held-visuals.ts --item=fury_of_taranis --out=preview/held.png
 *   npx tsx scripts/render-held-visuals.ts --measure
 *
 * One band per held visual. The large row starts with the item's own painter
 * (the sword's, a tool's, or the prop painter a row calls) at two angles, in
 * its own frame, then the held visual painted directly through the
 * shared painter: a sweep of eight on-screen angles flat to the camera, two
 * foreshortenings, edge-on, mirrored (palm away) and shaded (in the far
 * hand). The second row is the same set at the 32 px tile on a dungeon floor,
 * drawn through the item-art cache, blown up nearest-neighbour.
 *
 * `--measure` also bakes every look of the Fury of Taranis and prints what the
 * whole set would hold.
 */

import { createCanvas } from 'canvas';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext, type NodeContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { BYTES_PER_MEGABYTE } from '../src/sprites/figure/figureCacheStats.js';
import { HUMAN_SCALE } from '../src/sprites/art/human/figureScale.js';
import { VIEWS } from '../src/sprites/art/carl/rig.js';
import { PROP_ART } from '../src/sprites/art/carl/props.js';
import { burningDynamite } from '../src/sprites/art/carl/props/dynamite.js';
import { drawTaranisSword } from '../src/sprites/art/carl/props/sword.js';
import { paintWorkingTool } from '../src/sprites/art/toolArt.js';
import { TOOL_TIERS, type ToolKind, type ToolTier, isToolTier } from '../src/core/toolTiers.js';
import { HELD_VISUALS } from '../src/sprites/held/heldVisuals.js';
import { HELD_VISUAL_IDS, type HeldVisualId } from '../src/sprites/held/heldVisualIds.js';
import type { HeldVisualDef } from '../src/sprites/held/heldVisualDef.js';
import {
  heldHandleGeometry,
  paintHeldVisual,
  type HeldVisualTransform,
  type Vec3,
} from '../src/sprites/held/heldPaint.js';
import {
  drawHeldVisual,
  heldVisualCacheBytes,
  heldVisualCacheCount,
  measureHeldVisualSet,
} from '../src/sprites/held/heldVisualCache.js';

installCanvasGlobals();

const DEFAULT_OUT = `${PREVIEW_DIR}/held-visuals.png`;
const LABEL_FONT = '13px sans-serif';
const LABEL_HEIGHT = 18;
const LABEL_COLOR = '#e8e8e8';
const SOURCE_LABEL_COLOR = '#f0c070';
const SHEET_BACKGROUND = '#34363c';
const SOURCE_BACKGROUND = '#3f3a33';
const FLOOR = '#4a4640';
const GAP = 6;
/** Pixels per rig unit in the large row: twice the cell's own density. */
const LARGE_PX_PER_UNIT = 92;
/** Wide enough for a column's caption, however small the item. */
const MIN_LARGE_CELL = 84;
const IN_GAME_TILE = 32;
const IN_GAME_PX_PER_UNIT = IN_GAME_TILE * HUMAN_SCALE;
const BLOW_UP = 3;
const SWEEP_ANGLES_DEG: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];
/** The angle the foreshortened, edge-on, mirrored and shaded entries are shown at. */
const FEATURE_ANGLE_DEG = -45;
/** How far toward the camera the two foreshortened entries tip the haft. */
const FORESHORTEN_TOWARD_CAMERA: readonly number[] = [0.6, 0.9];
const SOURCE_ANGLES_DEG: readonly number[] = [0, -45];
/** How many columns of the item's own painter lead each band: one per source angle. */
const SOURCE_ENTRY_COUNT = SOURCE_ANGLES_DEG.length;
const BYTES_PER_KIBIBYTE = 1024;
const MS_PER_SECOND = 1000;
const HALF_TURN_DEG = 180;
/** The carried slingshot's fork angles in profile and head-on, as its overlay draws it. */
const SLINGSHOT_CARRY_DEG = { side: 40, front: 55 } as const;

const TOOL_TIER_BY_ID = new Map<HeldVisualId, { kind: ToolKind; tier: ToolTier }>();
for (const kind of ['axe', 'pickaxe'] as const) {
  TOOL_TIERS[kind].forEach((def, index) => {
    const id = HELD_VISUAL_IDS.find((visual) => visual === def.id);
    if (id !== undefined && isToolTier(index)) TOOL_TIER_BY_ID.set(id, { kind, tier: index });
  });
}

const PROP_KIND_BY_ID: Partial<Record<HeldVisualId, keyof typeof PROP_ART>> = {
  prop_hammer: 'hammer',
  prop_board: 'board',
  prop_crate: 'crate',
  prop_wrench: 'wrench',
  prop_dynamite: 'dynamite',
  prop_black_powder_bomb: 'blackPowderBomb',
  prop_zippo: 'zippo',
  prop_bottle: 'bottle',
};
const PROP_SOURCE_VARIANT: Partial<Record<HeldVisualId, string>> = {
  prop_dynamite: burningDynamite(0),
  prop_black_powder_bomb: burningDynamite(0),
  prop_zippo: 'lit',
};
/** The phase of each held visual that matches its own painter's variant. */
const PROP_NEW_PHASE: Partial<Record<HeldVisualId, number>> = {
  prop_dynamite: 2,
  prop_black_powder_bomb: 2,
  prop_zippo: 2,
};

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / HALF_TURN_DEG;
}

function label(ctx: NodeContext, text: string, x: number, y: number, colour = LABEL_COLOR): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = colour;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

interface Entry {
  readonly caption: string;
  readonly axis: Vec3;
  readonly palmNormal: Vec3;
  readonly shaded: boolean;
}

function inScreen(degrees: number, towardCamera = 0): Vec3 {
  const inPlane = Math.sqrt(1 - towardCamera * towardCamera);
  const angle = radians(degrees);
  return { x: Math.cos(angle) * inPlane, y: Math.sin(angle) * inPlane, z: towardCamera };
}

const TOWARD_CAMERA: Vec3 = { x: 0, y: 0, z: 1 };
const AWAY_FROM_CAMERA: Vec3 = { x: 0, y: 0, z: -1 };

function entries(): Entry[] {
  const list: Entry[] = SWEEP_ANGLES_DEG.map((deg) => ({
    caption: `${deg}°`,
    axis: inScreen(deg),
    palmNormal: TOWARD_CAMERA,
    shaded: false,
  }));
  for (const z of FORESHORTEN_TOWARD_CAMERA) {
    list.push({
      caption: `z ${z}`,
      axis: inScreen(FEATURE_ANGLE_DEG, z),
      palmNormal: TOWARD_CAMERA,
      shaded: false,
    });
  }
  const edgeOn = radians(FEATURE_ANGLE_DEG);
  list.push({
    caption: 'edge',
    axis: inScreen(FEATURE_ANGLE_DEG),
    palmNormal: { x: -Math.sin(edgeOn), y: Math.cos(edgeOn), z: 0 },
    shaded: false,
  });
  list.push({
    caption: 'mirror',
    axis: inScreen(FEATURE_ANGLE_DEG),
    palmNormal: AWAY_FROM_CAMERA,
    shaded: false,
  });
  list.push({
    caption: 'shaded',
    axis: inScreen(FEATURE_ANGLE_DEG),
    palmNormal: TOWARD_CAMERA,
    shaded: true,
  });
  return list;
}

/** The half-side of the square one entry is drawn in, rig units. */
function reachOf(def: HeldVisualDef): number {
  const handle = heldHandleGeometry(def);
  return Math.max(-handle.buttX, handle.headBase + def.head.length, def.head.width);
}

/** Paints the art `def` replaces, about a grip at (`cx`, `cy`), or returns false if it has none. */
function paintOld(
  ctx: CanvasRenderingContext2D,
  def: HeldVisualDef,
  index: number,
  cx: number,
  cy: number,
  pxPerUnit: number,
): boolean {
  const angle = radians(SOURCE_ANGLES_DEG[index] ?? 0);
  const inOwnFrame = (paint: () => void, turn = angle): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn);
    ctx.scale(pxPerUnit, pxPerUnit);
    paint();
    ctx.restore();
  };
  if (def.id === 'fury_of_taranis') {
    inOwnFrame(() => drawTaranisSword(ctx, false, 0));
    return true;
  }
  const tool = TOOL_TIER_BY_ID.get(def.id);
  if (tool !== undefined) {
    inOwnFrame(() => paintWorkingTool(ctx, tool.kind, tool.tier));
    return true;
  }
  if (def.id === 'quest_scythe') {
    inOwnFrame(() => paintWorkingTool(ctx, 'scythe', 0));
    return true;
  }
  if (def.id === 'slingshot') {
    const view = index === 0 ? VIEWS.front : VIEWS.side;
    const carryDeg = index === 0 ? SLINGSHOT_CARRY_DEG.front : SLINGSHOT_CARRY_DEG.side;
    // The painter's haft runs from the fork to the butt, so a fork pointing
    // along the carry is a haft turned a half turn from it.
    const haftAngle = radians(carryDeg) + Math.PI;
    inOwnFrame(
      () =>
        PROP_ART.slingshot.paint(
          ctx,
          { centre: { x: 0, y: 0 }, haftAngle },
          { kind: 'slingshot', hand: 'left' },
          view,
          false,
        ),
      0,
    );
    return true;
  }
  const kind = PROP_KIND_BY_ID[def.id];
  if (kind === undefined) return false;
  const view = index === 0 ? VIEWS.front : VIEWS.side;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pxPerUnit, pxPerUnit);
  PROP_ART[kind].paint(
    ctx,
    { centre: { x: 0, y: 0 }, haftAngle: angle },
    { kind, hand: 'left', variant: PROP_SOURCE_VARIANT[def.id] },
    kind === 'board' ? VIEWS.back : view,
    false,
  );
  ctx.restore();
  return true;
}

/** The angle the held visual is drawn at to match source entry `index`, in degrees. */
function matchingHeldAngle(def: HeldVisualDef, index: number): number {
  if (def.id === 'slingshot')
    return index === 0 ? SLINGSHOT_CARRY_DEG.front : SLINGSHOT_CARRY_DEG.side;
  return SOURCE_ANGLES_DEG[index] ?? 0;
}

function transformAt(
  def: HeldVisualDef,
  entry: Entry,
  cx: number,
  cy: number,
  scale: number,
): HeldVisualTransform {
  return {
    centre: { x: cx, y: cy },
    axis: entry.axis,
    palmNormal: entry.palmNormal,
    scale,
    shaded: entry.shaded,
    phase: PROP_NEW_PHASE[def.id] ?? 0,
  };
}

function bandFor(def: HeldVisualDef, sheetWidth: number): ReturnType<typeof createCanvas> {
  const list = entries();
  const sourceMatches: Entry[] = Array.from(
    { length: SOURCE_ENTRY_COUNT },
    (_, index) => index,
  ).map((index) => ({
    caption: `held ${matchingHeldAngle(def, index)}°${def.id === 'slingshot' && index === 1 ? ' edge' : ''}`,
    axis: inScreen(matchingHeldAngle(def, index)),
    palmNormal:
      def.id === 'slingshot' && index === 1
        ? {
            x: -Math.sin(radians(SLINGSHOT_CARRY_DEG.side)),
            y: Math.cos(radians(SLINGSHOT_CARRY_DEG.side)),
            z: 0,
          }
        : TOWARD_CAMERA,
    shaded: false,
  }));
  const all = [...sourceMatches, ...list];
  const reach = reachOf(def);
  const largeCell = Math.max(MIN_LARGE_CELL, Math.ceil(reach * 2 * LARGE_PX_PER_UNIT));
  const smallCell = Math.ceil(reach * 2 * IN_GAME_PX_PER_UNIT);
  const columns = SOURCE_ENTRY_COUNT + all.length;
  const width = Math.max(sheetWidth, columns * (largeCell + GAP) + GAP);
  const height = LABEL_HEIGHT * 2 + largeCell + LABEL_HEIGHT + smallCell * BLOW_UP + GAP * 2;
  const band = createCanvas(width, height);
  const ctx = band.getContext('2d');
  const game = asGameContext(ctx);
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  label(
    ctx,
    `${def.id} — ${def.name} (${def.archetype}, ${def.weight}, ${def.phases} phase)`,
    GAP,
    0,
  );
  const largeTop = LABEL_HEIGHT * 2;

  for (let index = 0; index < SOURCE_ENTRY_COUNT; index++) {
    const x = GAP + index * (largeCell + GAP);
    ctx.fillStyle = SOURCE_BACKGROUND;
    ctx.fillRect(x, largeTop, largeCell, largeCell);
    const drew = paintOld(
      game,
      def,
      index,
      x + largeCell / 2,
      largeTop + largeCell / 2,
      LARGE_PX_PER_UNIT,
    );
    label(
      ctx,
      drew ? `own ${SOURCE_ANGLES_DEG[index] ?? 0}°` : 'no own painter',
      x,
      LABEL_HEIGHT,
      SOURCE_LABEL_COLOR,
    );
  }
  all.forEach((entry, index) => {
    const x = GAP + (SOURCE_ENTRY_COUNT + index) * (largeCell + GAP);
    label(ctx, entry.caption, x, LABEL_HEIGHT);
    paintHeldVisual(
      game,
      def,
      transformAt(def, entry, x + largeCell / 2, largeTop + largeCell / 2, LARGE_PX_PER_UNIT),
    );
  });

  const smallTop = largeTop + largeCell + LABEL_HEIGHT;
  label(
    ctx,
    'at the 32 px tile, through the item-art cache, blown up 3×',
    GAP,
    largeTop + largeCell,
  );
  const strip = createCanvas(columns * smallCell, smallCell);
  const stripCtx = strip.getContext('2d');
  const stripGame = asGameContext(stripCtx);
  stripCtx.fillStyle = FLOOR;
  stripCtx.fillRect(0, 0, strip.width, strip.height);
  for (let index = 0; index < SOURCE_ENTRY_COUNT; index++) {
    paintOld(
      stripGame,
      def,
      index,
      index * smallCell + smallCell / 2,
      smallCell / 2,
      IN_GAME_PX_PER_UNIT,
    );
  }
  all.forEach((entry, index) => {
    const cx = (SOURCE_ENTRY_COUNT + index) * smallCell + smallCell / 2;
    drawHeldVisual(stripGame, def, transformAt(def, entry, cx, smallCell / 2, IN_GAME_PX_PER_UNIT));
  });
  ctx.imageSmoothingEnabled = false;
  for (let index = 0; index < columns; index++) {
    const x = GAP + index * (largeCell + GAP);
    ctx.drawImage(
      strip,
      index * smallCell,
      0,
      smallCell,
      smallCell,
      x,
      smallTop,
      smallCell * BLOW_UP,
      smallCell * BLOW_UP,
    );
  }
  return band;
}

function render(ids: readonly HeldVisualId[]): ReturnType<typeof createCanvas> {
  const bands = ids.map((id) => bandFor(HELD_VISUALS[id], 0));
  const width = Math.max(...bands.map((band) => band.width));
  const height = bands.reduce((sum, band) => sum + band.height, 0);
  const sheet = createCanvas(width, height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const band of bands) {
    ctx.drawImage(band, 0, y);
    y += band.height;
  }
  return sheet;
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(2);
}

const itemFlag = flag('item');
const chosen =
  itemFlag === null ? HELD_VISUAL_IDS : HELD_VISUAL_IDS.filter((id) => id === itemFlag);
if (chosen.length === 0) throw new Error(`No held visual "${itemFlag ?? ''}"`);
const out = flag('out') ?? DEFAULT_OUT;
const written = writePreviewPng(out, render(chosen).toBuffer('image/png'));
console.log(`Wrote ${written}`);
console.log(
  `item-art cache after the sheet: ${heldVisualCacheCount()} pictures, ${megabytes(heldVisualCacheBytes())} MB`,
);

if (process.argv.includes('--measure')) {
  const started = performance.now();
  const set = measureHeldVisualSet(HELD_VISUALS.fury_of_taranis);
  const elapsed = performance.now() - started;
  const perPicture = set.bytes / set.pictures;
  console.log(
    `fury_of_taranis, every look: ${set.pictures} pictures, ${megabytes(set.bytes)} MB ` +
      `(${(perPicture / BYTES_PER_KIBIBYTE).toFixed(1)} KiB each), baked in ${(elapsed / MS_PER_SECOND).toFixed(1)} s`,
  );
}
