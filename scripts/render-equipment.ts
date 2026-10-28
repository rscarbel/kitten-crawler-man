/**
 * Review harness for what the human holds: every held item drawn between his
 * cells' two layers at its socket, exactly as the game composites it.
 *
 *   npm run render:equipment
 *   npx tsx scripts/render-equipment.ts --item=stormcaller
 *   npx tsx scripts/render-equipment.ts --part=hands
 *   npx tsx scripts/render-equipment.ts --item=spiked_club --rows=heavy_smash_run_1,heavy_run
 *
 * The sheet: for each item, the rows it is held on, large (a profile row
 * again facing −X, the way he faces west), then the same rows at the 32 px
 * tile on a dungeon floor, and the strip again blown up nearest-neighbour so
 * the in-game pixels can be judged. A sheet too tall for one canvas is
 * written as pages, `-p1.png`, `-p2.png`, …. Tools are shown on their swings, every
 * tier at the tile; weapons on every row their grip and weight play — stance,
 * stride, each blow standing and one version on the move, the draw and the
 * stow, the weapon at rest until the fist closes on it; a thrown explosive
 * on the light, hold and throw rows, its fuse as each frame has it.
 *
 * `--part=hands` paints the grip alone at six times the cell's density, in
 * all three views, through a roll of the hand round the handle from knuckles
 * to the camera, through edge-on, to palm to the camera: the fingers should
 * move from over the handle to round its back by themselves.
 *
 * Runs the equipment gates first and exits non-zero if any fails.
 */

import { createCanvas, type Canvas } from 'canvas';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { reportFigureGates } from './figureGates.js';
import { equipmentGateFailures } from './gates-equipment.js';
import { type HumanFigure, humanFigureFor } from '../src/sprites/art/human/appearance.js';
import { carriedGripOf } from '../src/sprites/art/human/carry.js';
import { offHandGripOf } from '../src/sprites/art/human/offHand.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import { playerLookAxes, playerStatureScale } from '../src/sprites/looks/humanLook.js';
import { humanLookFlag } from './humanLooks.js';
import {
  CHOP_ROWS,
  explosiveRowNames,
  FRAME_H,
  FRAME_W,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  type HumanRowName,
  MINE_ROWS,
  ORIGIN_X,
  ORIGIN_Y,
  TILE_X,
  TILE_Y,
} from '../src/sprites/art/humanFigure.js';
import {
  HUMAN_CELL_PX_PER_UNIT,
  HUMAN_SCALE,
  TILE_SCALE,
} from '../src/sprites/art/human/figureScale.js';
import {
  drawHumanFigureSelection,
  explosiveHeldDraw,
  motionSetOfRow,
} from '../src/sprites/humanSprite.js';
import { motionSetOf } from '../src/sprites/art/human/motionSets.js';
import { humanSocketsAt } from '../src/sprites/art/human/sockets.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import { HELD_VISUALS, stowedPlacementOfHeld } from '../src/sprites/held/heldVisuals.js';
import {
  HELD_VISUAL_IDS,
  type HeldVisualId,
  OFF_HAND_HELD_VISUAL_IDS,
  THROWN_PROP_VISUAL_IDS,
  TOOL_HELD_VISUAL_IDS,
  WEAPON_HELD_VISUAL_IDS,
} from '../src/sprites/held/heldVisualIds.js';
import type { HeldVisualDef, WeaponHeldVisualDef } from '../src/sprites/held/heldVisualDef.js';
import { compositeHeldItem, heldTransformAt } from '../src/sprites/held/heldComposite.js';
import type { Vec3 } from '../src/sprites/held/heldPaint.js';
import {
  type BipedPose,
  type HandOrientation,
  HAFT_IN_PLANE,
  VIEWS,
} from '../src/sprites/art/biped/rig.js';
import {
  bipedHandSockets,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
} from '../src/sprites/art/biped/figure.js';
import { idleBack, idleFront, idleSide } from '../src/sprites/art/human/idles.js';
import type { CardinalView } from '../src/sprites/facingView.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';

useDevPlayerIdentity();

installCanvasGlobals();

/** The look every item is shown on: `--look=<id>`, or the harnesses' default look. */
const LOOK = humanLookFlag();
const BARE_OUTFIT = outfitOf(LOOK, []);
const LARGE_TILE = 96;
const SMALL_TILE = 32;
const PIXEL_ZOOM = 3;
const LABEL_HEIGHT = 18;
const LABEL_FONT = '13px sans-serif';
const LABEL_COLOR = '#e8e2d8';
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GAP = 8;
/** A cell is three tiles wide; a strip lays its frames this many tiles apart. */
const CELL_TILES = FRAME_W / TILE_SCALE;
/** Where the tile sits inside a cell, as a share of a tile. */
const TILE_LEFT_SHARE = TILE_X / TILE_SCALE;
const TILE_TOP_SHARE = TILE_Y / TILE_SCALE;

/** The density the grip review paints at, over the cell's own. */
const HAND_DENSITY = 6;
/** Half the side of a grip crop, in cell pixels. */
const HAND_CROP_HALF = 16;
/** Steps of the roll round the handle, from knuckles out to palm out. */
const ROLL_STEPS = 9;

interface Showing {
  readonly id: HeldVisualId;
  readonly look: HeldVisualDef;
  readonly figure: HumanFigure;
  readonly rows: readonly HumanRowName[];
}

/** Rows a weapon its set has no rows of its own for is shown carried on: standing, running and blows. */
const CARRIED_ROWS: readonly HumanRowName[] = [
  'idle',
  'idle_side',
  'idle_away',
  'run',
  'run_side',
  'run_away',
  'guard',
  'guard_side',
  'guard_away',
  'jab_side',
  'cross_side',
  'uppercut_up',
  'overhand_up',
  'hammer_down',
];

/**
 * Rows a shield is shown on: standing, walking and running, bare-handed blows
 * in each view, the block, the guard, and the drink, whose hands are busy so
 * the shield rides stowed.
 */
const SHIELD_ROWS: readonly HumanRowName[] = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
  'run',
  'run_side',
  'run_away',
  'jab_side',
  'cross_side',
  'uppercut_up',
  'hammer_down',
  'guard',
  'guard_side',
  'guard_away',
  'block',
  'block_side',
  'block_away',
  'drink',
  'drink_side',
  'drink_away',
];

function isShield(look: HeldVisualDef): boolean {
  return OFF_HAND_HELD_VISUAL_IDS.some((id) => id === look.id);
}

/**
 * Rows a weapon is shown on: every row its grip and weight play, with one
 * version of each blow thrown on the move — the rest differ only in the
 * stride they begin at — or, for a weapon with no rows of its own, the
 * bare-handed rows it is carried on.
 */
function weaponRows(look: WeaponHeldVisualDef): readonly HumanRowName[] {
  const set = motionSetOf(look);
  if (set === 'unarmed') return CARRIED_ROWS;
  const firstVersions = new Set<string>();
  return HUMAN_ROWS.filter((row) => {
    if (motionSetOfRow(row) !== set) return false;
    const standing = row.strike?.standing;
    if (standing === undefined) return true;
    if (firstVersions.has(standing)) return false;
    firstVersions.add(standing);
    return true;
  }).map((row) => row.name);
}

function showings(only: string | null): Showing[] {
  const base = humanFigureFor(LOOK, BARE_OUTFIT, null);
  const list: Showing[] = [
    {
      id: 'basic_axe',
      look: HELD_VISUALS.basic_axe,
      figure: base,
      rows: Object.values(CHOP_ROWS),
    },
    {
      id: 'basic_pickaxe',
      look: HELD_VISUALS.basic_pickaxe,
      figure: base,
      rows: Object.values(MINE_ROWS),
    },
    {
      id: 'quest_scythe',
      look: HELD_VISUALS.quest_scythe,
      figure: base,
      rows: Object.values(CHOP_ROWS),
    },
    ...WEAPON_HELD_VISUAL_IDS.map((id) => {
      const look = HELD_VISUALS[id];
      return {
        id,
        look,
        figure: humanFigureFor(LOOK, BARE_OUTFIT, carriedGripOf(look)),
        rows: weaponRows(look),
      };
    }),
    ...THROWN_PROP_VISUAL_IDS.map((id) => ({
      id,
      look: HELD_VISUALS[id],
      figure: base,
      rows: explosiveRowNames(),
    })),
    ...OFF_HAND_HELD_VISUAL_IDS.map((id) => {
      const look = HELD_VISUALS[id];
      return {
        id,
        look,
        figure: humanFigureFor(LOOK, BARE_OUTFIT, null, offHandGripOf(look)),
        rows: SHIELD_ROWS,
      };
    }),
  ];
  if (only === null) return list;
  const tool = TOOL_HELD_VISUAL_IDS.find((id) => id === only);
  if (tool !== undefined) {
    const rows = tool.includes('pick') ? Object.values(MINE_ROWS) : Object.values(CHOP_ROWS);
    return [{ id: tool, look: HELD_VISUALS[tool], figure: base, rows }];
  }
  return list.filter((showing) => showing.id === only);
}

/** One row's frames side by side at `tile`, on `floor`, through the runtime path. */
function strip(
  showing: Showing,
  look: HeldVisualDef,
  row: HumanRowName,
  tile: number,
  flipX: boolean,
  floor: string,
): Canvas {
  const frames = HUMAN_ROW_TABLE[row].frameCount;
  const cellWidth = CELL_TILES * tile;
  const canvas = createCanvas(Math.ceil(cellWidth * frames), Math.ceil(CELL_TILES * tile));
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const source = { id: showing.figure.def.id, painting: showing.figure.painting };
  const placement = stowedPlacementOfHeld(look);
  const holster = HUMAN_ROW_TABLE[row].holster !== undefined;
  for (let frame = 0; frame < frames; frame++) {
    beginFigureFrame();
    const x = frame * cellWidth + TILE_LEFT_SHARE * tile;
    const y = TILE_TOP_SHARE * tile;
    if (isShield(look)) {
      // A shield is in his off hand where the row leaves it free, and at its rest where it does not.
      const offHand = placement === 'none' ? null : { look, stowedAt: placement };
      drawHumanFigureSelection(
        ctx,
        showing.figure,
        x,
        y,
        tile,
        { row, frame, flipX },
        null,
        null,
        offHand,
      );
      continue;
    }
    // A draw or stow shows the weapon where it rests until the fist closes on it.
    const reaching = holster && humanSocketsAt(source, row, frame).sockets.mainHand.grips !== true;
    const stowed = reaching && placement !== 'none' ? { look, placement } : null;
    drawHumanFigureSelection(
      ctx,
      showing.figure,
      x,
      y,
      tile,
      { row, frame, flipX },
      explosiveHeldDraw(look, { row, frame, flipX }) ?? { look, phase: 0 },
      stowed,
    );
  }
  return canvas;
}

function zoomed(source: Canvas, zoom: number): Canvas {
  const canvas = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

interface Band {
  readonly label: string;
  readonly image: Canvas;
}

function bandsFor(showing: Showing): Band[] {
  const bands: Band[] = [];
  for (const row of showing.rows) {
    bands.push({
      label: `${showing.look.name} — ${row}`,
      image: strip(showing, showing.look, row, LARGE_TILE, false, BACKDROP),
    });
    if (HUMAN_ROW_TABLE[row].mirrorable) {
      bands.push({
        label: `${showing.look.name} — ${row} facing −X`,
        image: strip(showing, showing.look, row, LARGE_TILE, true, BACKDROP),
      });
    }
  }
  const thrown = THROWN_PROP_VISUAL_IDS.some((id) => id === showing.id);
  const tiers =
    showing.figure.def.id === humanFigureFor(LOOK, BARE_OUTFIT, null).def.id &&
    showing.id !== 'quest_scythe' &&
    !thrown
      ? TOOL_HELD_VISUAL_IDS.filter((id) => id.includes('pick') === showing.id.includes('pick'))
      : [showing.id];
  for (const row of showing.rows) {
    for (const tier of tiers) {
      const small = strip(showing, HELD_VISUALS[tier], row, SMALL_TILE, false, DUNGEON_FLOOR);
      bands.push({ label: `${row} at the 32 px tile — ${HELD_VISUALS[tier].name}`, image: small });
      bands.push({ label: `  (×${PIXEL_ZOOM})`, image: zoomed(small, PIXEL_ZOOM) });
    }
  }
  return bands;
}

function stack(bands: readonly Band[]): Canvas {
  const width = Math.max(...bands.map((band) => band.image.width));
  const height = bands.reduce((sum, band) => sum + LABEL_HEIGHT + band.image.height + GAP, 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const band of bands) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(band.label, GAP, y + LABEL_HEIGHT - GAP / 2);
    y += LABEL_HEIGHT;
    ctx.drawImage(band.image, 0, y);
    y += band.image.height + GAP;
  }
  return canvas;
}

/** The tallest canvas node-canvas will allocate, less a margin. */
const MAX_PAGE_HEIGHT = 32000;

/** Bands split into pages no taller than a canvas can be: a whole weapon set does not fit on one. */
function paged(bands: readonly Band[]): Band[][] {
  const pages: Band[][] = [[]];
  let height = 0;
  for (const band of bands) {
    const bandHeight = LABEL_HEIGHT + band.image.height + GAP;
    const page = pages[pages.length - 1];
    if (height + bandHeight > MAX_PAGE_HEIGHT && page.length > 0) {
      pages.push([band]);
      height = bandHeight;
      continue;
    }
    page.push(band);
    height += bandHeight;
  }
  return pages;
}

// ── The grip through a roll ─────────────────────────────────────────────────

const STANDING: Readonly<Record<CardinalView, () => BipedPose>> = {
  front: () => idleFront(0),
  side: () => idleSide(0),
  back: () => idleBack(0),
};

function paintView(
  ctx: CanvasRenderingContext2D,
  view: CardinalView,
  pose: BipedPose,
  front: CanvasRenderingContext2D,
  look: HeldVisualDef,
): void {
  const options = { look: LOOK, itemHandle: look.handle.radius, front };
  if (view === 'front') drawBipedFront(ctx, pose, options);
  else if (view === 'back') drawBipedBack(ctx, pose, options);
  else drawBipedSide(ctx, pose, options);
}

/** The palm turned `roll` radians round a level haft, from knuckles to the camera to palm to it. */
function rolledPalm(roll: number): Vec3 {
  return { x: 0, y: Math.sin(roll), z: -Math.cos(roll) };
}

/** His right fist held out level in front of him, closed on a level haft, the palm `roll` round it. */
function holdingOut(view: CardinalView, roll: number): BipedPose {
  const pose = STANDING[view]();
  const orientation: HandOrientation = {
    palmNormal: rolledPalm(roll),
    haftDepth: HAFT_IN_PLANE,
    haftAngle: 0,
  };
  return { ...pose, rightHandShape: 'grip', rightHandOrientation: orientation };
}

function gripCrop(view: CardinalView, roll: number, look: HeldVisualDef): Canvas {
  const width = FRAME_W * HAND_DENSITY;
  const height = FRAME_H * HAND_DENSITY;
  const back = createCanvas(width, height);
  const front = createCanvas(width, height);
  const backCtx = asGameContext(back.getContext('2d'));
  const frontCtx = asGameContext(front.getContext('2d'));
  const pose = holdingOut(view, roll);
  const axes = playerLookAxes(LOOK, VIEWS[view].profile);
  for (const ctx of [backCtx, frontCtx]) {
    ctx.scale(HAND_DENSITY, HAND_DENSITY);
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(TILE_SCALE * HUMAN_SCALE * axes.x, TILE_SCALE * HUMAN_SCALE * axes.y);
  }
  paintView(backCtx, view, pose, frontCtx, look);
  const sockets = bipedHandSockets(pose, VIEWS[view], {
    look: LOOK,
    itemHandle: look.handle.radius,
  });
  const hand = VIEWS[view].mirrored ? sockets.left : sockets.right;
  const centre = {
    x: (ORIGIN_X + hand.centre.x * HUMAN_CELL_PX_PER_UNIT * axes.x) * HAND_DENSITY,
    y: (ORIGIN_Y + hand.centre.y * HUMAN_CELL_PX_PER_UNIT * axes.y) * HAND_DENSITY,
  };
  const composite = createCanvas(width, height);
  const ctx = asGameContext(composite.getContext('2d'));
  ctx.drawImage(back, 0, 0);
  compositeHeldItem(
    ctx,
    look,
    heldTransformAt(
      { ...hand, centre },
      HUMAN_CELL_PX_PER_UNIT * playerStatureScale(LOOK) * HAND_DENSITY,
    ),
    'painted',
  );
  ctx.drawImage(front, 0, 0);
  const side = HAND_CROP_HALF * 2 * HAND_DENSITY;
  const crop = createCanvas(side, side);
  const cropCtx = crop.getContext('2d');
  cropCtx.fillStyle = BACKDROP;
  cropCtx.fillRect(0, 0, side, side);
  cropCtx.drawImage(
    composite,
    centre.x - side / 2,
    centre.y - side / 2,
    side,
    side,
    0,
    0,
    side,
    side,
  );
  return crop;
}

function rollSheet(look: HeldVisualDef): Canvas {
  const bands: Band[] = (['front', 'side', 'back'] as const).map((view) => {
    const crops = Array.from({ length: ROLL_STEPS }, (_unused, step) =>
      gripCrop(view, (Math.PI * step) / (ROLL_STEPS - 1), look),
    );
    const row = createCanvas(
      crops.reduce((sum, crop) => sum + crop.width + GAP, 0),
      crops[0].height,
    );
    const ctx = row.getContext('2d');
    crops.forEach((crop, index) => ctx.drawImage(crop, index * (crop.width + GAP), 0));
    return { label: `${view}: knuckles to the camera → edge-on → palm to the camera`, image: row };
  });
  return stack(bands);
}

const args = process.argv.slice(2);
const flag = (name: string): string | null =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const only = flag('item');
const part = flag('part');
/** `--rows=a,b` narrows every item's band to those rows. */
const rowFilter = flag('rows')?.split(',') ?? null;

function narrowed(showing: Showing): Showing {
  if (rowFilter === null) return showing;
  return { ...showing, rows: showing.rows.filter((row) => rowFilter.includes(row)) };
}

console.log('Gating the human’s equipment…');
const clean = reportFigureGates('equipment', equipmentGateFailures(only));
if (part === 'hands') {
  const chosen = HELD_VISUAL_IDS.find((id) => id === only);
  const look = HELD_VISUALS[chosen ?? 'stormcaller'];
  writePreviewPng(
    flag('out') ?? `${PREVIEW_DIR}/equipment-grip.png`,
    rollSheet(look).toBuffer('image/png'),
  );
} else {
  const out = flag('out') ?? `${PREVIEW_DIR}/equipment.png`;
  const pages = paged(showings(only).map(narrowed).flatMap(bandsFor));
  pages.forEach((bands, index) => {
    const path = pages.length === 1 ? out : out.replace(/\.png$/, `-p${index + 1}.png`);
    writePreviewPng(path, stack(bands).toBuffer('image/png'));
  });
}
if (!clean) process.exitCode = 1;
