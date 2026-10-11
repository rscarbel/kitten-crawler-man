/**
 * The Goblin High Security Prison's props, painted at runtime: iron cell bars,
 * the holding cells' flimsy doors, the yard's tall cover (crate stacks, the
 * guard hut, the wagon) and the wall lamps.
 *
 * Every painter is deterministic in its arguments, paints in tile-relative
 * pixels at the caller's origin and reads no caller context state beyond the
 * transform, so the prison can bake each prop into a cached canvas once and
 * blit it every frame. Colours are muted iron, old wood and soot: the cones
 * and spotlights have to be the brightest thing in the room.
 */

const IRON_DARK = '#25282d';
const IRON_MID = '#3d4249';
const IRON_LIGHT = '#6f767f';
const IRON_RUST = 'rgba(110,62,34,0.35)';
const WOOD_DARK = '#3a2a1c';
const WOOD_MID = '#5b4430';
const WOOD_LIGHT = '#7a5d41';
const WOOD_TOP = '#8a6c4c';
const WOOD_GRAIN = 'rgba(30,20,12,0.45)';
const WOOD_SPLINTER = '#a3825c';
const STRAW = 'rgba(160,130,70,0.55)';
const SHADOW = 'rgba(0,0,0,0.35)';
const CANVAS_DARK = '#4a4738';
const CANVAS_LIGHT = '#6a6650';
const ROOF_DARK = '#2c2724';
const ROOF_MID = '#433a33';
const HUT_STONE = '#4c4a47';
const HUT_STONE_LIGHT = '#5f5c58';
const WINDOW_GLOW = '#d9a24a';
const WINDOW_FRAME = '#2a1e14';
const FLAME_CORE = '#ffe7a8';
const FLAME_OUTER = '#f39a2b';
const STRUCK_FLASH = 'rgba(255,255,255,0.45)';

// ── Iron bars ───────────────────────────────────────────────────────────────

/** Which way a run of bars or a wall with a door in it runs across the screen. */
export type CellDoorRun = 'across' | 'along';

/** How far a run of bars rises above its own tile, as a share of a tile. */
export const BARS_RISE_SHARE = 0.9;
/** Rods per tile in a run of bars seen face on. */
const RODS_PER_TILE = 5;
const ROD_WIDTH_SHARE = 0.075;
const RAIL_HEIGHT_SHARE = 0.09;
const BASE_RAIL_TOP_SHARE = 0.78;
/** Posts per tile in a run seen end on. */
const POSTS_PER_TILE = 4;
const POST_RISE_SHARE = 0.7;
const POST_WIDTH_SHARE = 0.11;
const RIVET_SHARE = 0.045;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

/** One tile of iron bars, its feet at the tile's bottom and its top rail `BARS_RISE_SHARE` of a tile above. */
export function paintIronBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  run: CellDoorRun,
): void {
  if (run === 'along') {
    paintBarsEndOn(ctx, x, y, ts);
    return;
  }
  const rail = ts * RAIL_HEIGHT_SHARE;
  const top = y - ts * BARS_RISE_SHARE;
  const baseTop = y + ts * BASE_RAIL_TOP_SHARE;
  const rodWidth = ts * ROD_WIDTH_SHARE;
  ctx.fillStyle = SHADOW;
  ctx.fillRect(x, baseTop + rail, ts, rail);
  for (let rod = 0; rod < RODS_PER_TILE; rod++) {
    const rodX = x + ((rod + HALF) / RODS_PER_TILE) * ts - rodWidth * HALF;
    ctx.fillStyle = IRON_DARK;
    ctx.fillRect(rodX, top, rodWidth, baseTop - top);
    ctx.fillStyle = IRON_LIGHT;
    ctx.fillRect(rodX, top, rodWidth * HALF, baseTop - top);
  }
  paintRail(ctx, x, top, ts, rail);
  paintRail(ctx, x, baseTop, ts, rail);
  ctx.fillStyle = IRON_RUST;
  ctx.fillRect(x, baseTop + rail * HALF, ts, rail * HALF);
}

function paintRail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  height: number,
): void {
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, ts, height);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y, ts, height * HALF * HALF);
  ctx.fillStyle = IRON_DARK;
  const rivet = ts * RIVET_SHARE;
  for (const share of [HALF / 2, HALF + HALF / 2]) {
    ctx.beginPath();
    ctx.arc(x + ts * share, y + height * HALF, rivet, 0, FULL_TURN);
    ctx.fill();
  }
}

function paintBarsEndOn(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  const centreX = x + ts * HALF;
  const postWidth = ts * POST_WIDTH_SHARE;
  const rise = ts * POST_RISE_SHARE;
  ctx.fillStyle = SHADOW;
  ctx.fillRect(centreX - postWidth, y, postWidth * 2, ts);
  for (let post = 0; post < POSTS_PER_TILE; post++) {
    const footY = y + ((post + 1) / POSTS_PER_TILE) * ts;
    ctx.fillStyle = IRON_DARK;
    ctx.fillRect(centreX - postWidth * HALF, footY - rise, postWidth, rise);
    ctx.fillStyle = IRON_LIGHT;
    ctx.fillRect(centreX - postWidth * HALF, footY - rise, postWidth * HALF, rise);
  }
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(centreX - postWidth, y - rise, postWidth * 2, ts * RAIL_HEIGHT_SHARE);
}

// ── Holding-cell doors ──────────────────────────────────────────────────────

export interface CellDoorArt {
  readonly run: CellDoorRun;
  readonly broken: boolean;
  /** The frames right after the blow, flashed white. */
  readonly struck: boolean;
}

/** How far an intact door rises above its tile, as a share of a tile. */
const DOOR_RISE_SHARE = 0.55;
const DOOR_PLANKS = 3;
const PLANK_GAP_SHARE = 0.05;
const DOOR_INSET_SHARE = 0.06;
const BAND_HEIGHT_SHARE = 0.08;
const BAND_TOP_SHARE = 0.12;
const BAND_LOW_SHARE = 0.72;
const LOCK_SIZE_SHARE = 0.14;
const LOCK_X_SHARE = 0.72;
const LOCK_Y_SHARE = 0.42;
const STUB_HEIGHT_SHARE = 0.38;
const STUB_WIDTH_SHARE = 0.16;
const FALLEN_PLANK_LENGTH_SHARE = 0.7;
const FALLEN_PLANK_WIDTH_SHARE = 0.16;
const FALLEN_TILTS = [0.35, -0.5] as const;
const FALLEN_OFFSETS = [
  { x: 0.42, y: 0.78 },
  { x: 0.6, y: 0.9 },
] as const;
const SIDE_DOOR_WIDTH_SHARE = 0.22;

/** A holding cell's door, whole or smashed, drawn with its tile's top-left at (`x`, `y`). */
export function drawPrisonCellDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  art: CellDoorArt,
): void {
  ctx.save();
  if (art.broken) paintBrokenDoor(ctx, x, y, ts, art.run);
  else if (art.run === 'across') paintDoorFaceOn(ctx, x, y, ts);
  else paintDoorEndOn(ctx, x, y, ts);
  if (art.struck) {
    ctx.fillStyle = STRUCK_FLASH;
    ctx.fillRect(x, y - ts * DOOR_RISE_SHARE, ts, ts * (1 + DOOR_RISE_SHARE));
  }
  ctx.restore();
}

function paintPlank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shade: string,
): void {
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = WOOD_GRAIN;
  ctx.fillRect(x + w * HALF, y, Math.max(1, w * PLANK_GAP_SHARE * 2), h);
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(x, y, Math.max(1, w * PLANK_GAP_SHARE * 2), h);
}

function paintDoorFaceOn(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  const inset = ts * DOOR_INSET_SHARE;
  const top = y - ts * DOOR_RISE_SHARE;
  const height = y + ts - top;
  const gap = ts * PLANK_GAP_SHARE;
  const plankWidth = (ts - inset * 2 - gap * (DOOR_PLANKS - 1)) / DOOR_PLANKS;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x + inset, top, ts - inset * 2, height);
  for (let plank = 0; plank < DOOR_PLANKS; plank++) {
    const plankX = x + inset + plank * (plankWidth + gap);
    paintPlank(ctx, plankX, top, plankWidth, height, plank % 2 === 0 ? WOOD_MID : WOOD_LIGHT);
  }
  const band = ts * BAND_HEIGHT_SHARE;
  for (const share of [BAND_TOP_SHARE, BAND_LOW_SHARE]) {
    paintRail(ctx, x + inset, top + height * share, ts - inset * 2, band);
  }
  const lock = ts * LOCK_SIZE_SHARE;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x + ts * LOCK_X_SHARE - lock * HALF, top + height * LOCK_Y_SHARE, lock, lock);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x + ts * LOCK_X_SHARE - lock * HALF, top + height * LOCK_Y_SHARE, lock, lock * HALF);
}

function paintDoorEndOn(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  const width = ts * SIDE_DOOR_WIDTH_SHARE;
  const left = x + ts * HALF - width * HALF;
  const top = y - ts * DOOR_RISE_SHARE;
  paintPlank(ctx, left, top, width, y + ts - top, WOOD_MID);
  const band = ts * BAND_HEIGHT_SHARE;
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(left, top + ts * BAND_TOP_SHARE, width, band);
  ctx.fillRect(left, y + ts * BAND_LOW_SHARE, width, band);
}

function paintBrokenDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  run: CellDoorRun,
): void {
  const stubHeight = ts * STUB_HEIGHT_SHARE;
  const stubWidth = ts * STUB_WIDTH_SHARE;
  const footY = y + ts * BAND_LOW_SHARE;
  const stubs =
    run === 'across'
      ? [x + ts * DOOR_INSET_SHARE, x + ts - ts * DOOR_INSET_SHARE - stubWidth]
      : [x + ts * HALF - stubWidth * HALF];
  for (const stubX of stubs) {
    ctx.fillStyle = WOOD_DARK;
    ctx.beginPath();
    ctx.moveTo(stubX, footY);
    ctx.lineTo(stubX, footY - stubHeight);
    ctx.lineTo(stubX + stubWidth * HALF, footY - stubHeight * HALF);
    ctx.lineTo(stubX + stubWidth, footY - stubHeight * BAND_LOW_SHARE);
    ctx.lineTo(stubX + stubWidth, footY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = WOOD_SPLINTER;
    ctx.fillRect(stubX, footY - stubHeight, Math.max(1, stubWidth * HALF * HALF), stubHeight);
  }
  FALLEN_OFFSETS.forEach((offset, index) => {
    ctx.save();
    ctx.translate(x + ts * offset.x, y + ts * offset.y);
    ctx.rotate(FALLEN_TILTS[index]);
    const length = ts * FALLEN_PLANK_LENGTH_SHARE;
    const width = ts * FALLEN_PLANK_WIDTH_SHARE;
    ctx.fillStyle = SHADOW;
    ctx.fillRect(-length * HALF, width * HALF, length, width * HALF);
    paintPlank(ctx, -length * HALF, -width * HALF, length, width, WOOD_MID);
    ctx.restore();
  });
}

// ── Tall cover ──────────────────────────────────────────────────────────────

/** What a blob of cover tiles is drawn as, picked from its footprint. */
export type CoverKind = 'crates' | 'hut' | 'wagon';

/** How far cover rises above its footprint's top edge, as a share of a tile. */
export const COVER_RISE_SHARE = 0.75;

/** The kind of cover a footprint of `w` by `h` tiles, holding `tiles` cover tiles, is drawn as. */
export function coverKindFor(w: number, h: number, tiles: number): CoverKind {
  const HUT_MIN_TILES = 9;
  const WAGON_MIN_WIDTH = 3;
  if (tiles >= HUT_MIN_TILES && w >= WAGON_MIN_WIDTH && h >= WAGON_MIN_WIDTH) return 'hut';
  if (w >= WAGON_MIN_WIDTH && h < w) return 'wagon';
  return 'crates';
}

/**
 * One blob of cover, `w` by `h` tiles, its footprint's top-left at (`x`, `y`).
 * The art rises {@link COVER_RISE_SHARE} of a tile above the footprint, so a
 * crawler standing north of it is drawn behind it.
 */
export function paintCover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  kind: CoverKind,
): void {
  ctx.save();
  ctx.fillStyle = SHADOW;
  ctx.fillRect(
    x + ts * DOOR_INSET_SHARE,
    y + h * ts - ts * BAND_HEIGHT_SHARE,
    w * ts,
    ts * BAND_HEIGHT_SHARE * 2,
  );
  switch (kind) {
    case 'crates':
      paintCrateStack(ctx, x, y, w, h, ts);
      break;
    case 'hut':
      paintGuardHut(ctx, x, y, w, h, ts);
      break;
    case 'wagon':
      paintWagon(ctx, x, y, w, h, ts);
      break;
  }
  ctx.restore();
}

/** The share of a crate's drawn height that is its lid, seen from above. */
const CRATE_LID_SHARE = 0.42;
const CRATE_EDGE_SHARE = 0.07;
const CRATE_PLANK_LINES = 3;

function paintCrate(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  ts: number,
): void {
  const lid = height * CRATE_LID_SHARE;
  const edge = ts * CRATE_EDGE_SHARE;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = WOOD_TOP;
  ctx.fillRect(left + edge, top + edge, width - edge * 2, lid - edge * 2);
  ctx.fillStyle = WOOD_GRAIN;
  for (let line = 1; line < CRATE_PLANK_LINES; line++) {
    const lineX = left + (width * line) / CRATE_PLANK_LINES;
    ctx.fillRect(lineX, top + edge, 1, lid - edge * 2);
  }
  ctx.fillStyle = WOOD_MID;
  ctx.fillRect(left + edge, top + lid, width - edge * 2, height - lid - edge);
  ctx.fillStyle = WOOD_GRAIN;
  for (let line = 1; line < CRATE_PLANK_LINES; line++) {
    const lineY = top + lid + ((height - lid - edge) * line) / CRATE_PLANK_LINES;
    ctx.fillRect(left + edge, lineY, width - edge * 2, 1);
  }
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1, edge);
  ctx.beginPath();
  ctx.moveTo(left + edge, top + lid);
  ctx.lineTo(left + width - edge, top + height - edge);
  ctx.moveTo(left + width - edge, top + lid);
  ctx.lineTo(left + edge, top + height - edge);
  ctx.stroke();
}

/** A top crate is this share of a footprint tile, set back from the front row. */
const UPPER_CRATE_SHARE = 0.78;
const UPPER_CRATE_LIFT_SHARE = 0.45;
/** A stack this many tiles across or more gets a crate on top. */
const UPPER_CRATE_MIN_FOOTPRINT_TILES = 2;

function paintCrateStack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  const rise = ts * COVER_RISE_SHARE;
  const rowHeight = (h * ts + rise) / h;
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      paintCrate(ctx, x + column * ts, y - rise + row * rowHeight, ts, rowHeight, ts);
    }
  }
  const upper = ts * UPPER_CRATE_SHARE;
  if (w * h >= UPPER_CRATE_MIN_FOOTPRINT_TILES) {
    paintCrate(
      ctx,
      x + (w * ts - upper) * HALF,
      y - rise - upper * UPPER_CRATE_LIFT_SHARE,
      upper,
      upper,
      ts,
    );
  }
}

const ROOF_SHARE = 0.55;
const ROOF_EAVE_SHARE = 0.12;
const SHINGLE_ROWS = 5;
const STONE_COURSES = 4;
const WINDOW_WIDTH_SHARE = 0.22;
const WINDOW_HEIGHT_SHARE = 0.28;
const WINDOW_LEFT_SHARE = 0.18;
const HUT_DOOR_WIDTH_SHARE = 0.2;
const HUT_DOOR_LEFT_SHARE = 0.6;
const HUT_DOOR_HEIGHT_SHARE = 0.62;
const BAR_SLOTS = 3;
const WINDOW_FRAME_PX = 2;

function paintGuardHut(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  const width = w * ts;
  const top = y - ts * COVER_RISE_SHARE;
  const bottom = y + h * ts;
  const roofBottom = top + (bottom - top) * ROOF_SHARE;
  const eave = ts * ROOF_EAVE_SHARE;
  ctx.fillStyle = HUT_STONE;
  ctx.fillRect(x, roofBottom, width, bottom - roofBottom);
  const course = (bottom - roofBottom) / STONE_COURSES;
  for (let row = 0; row < STONE_COURSES; row++) {
    ctx.fillStyle = row % 2 === 0 ? HUT_STONE_LIGHT : HUT_STONE;
    ctx.fillRect(x, roofBottom + row * course, width, course - 1);
    ctx.fillStyle = SHADOW;
    const offset = row % 2 === 0 ? 0 : ts * HALF;
    for (let joint = x + offset; joint < x + width; joint += ts) {
      ctx.fillRect(joint, roofBottom + row * course, 1, course);
    }
  }
  const wall = bottom - roofBottom;
  const windowLeft = x + width * WINDOW_LEFT_SHARE;
  const windowTop = roofBottom + wall * (HALF - WINDOW_HEIGHT_SHARE * HALF);
  const windowWidth = width * WINDOW_WIDTH_SHARE;
  const windowHeight = wall * WINDOW_HEIGHT_SHARE;
  ctx.fillStyle = WINDOW_FRAME;
  ctx.fillRect(
    windowLeft - WINDOW_FRAME_PX,
    windowTop - WINDOW_FRAME_PX,
    windowWidth + WINDOW_FRAME_PX * 2,
    windowHeight + WINDOW_FRAME_PX * 2,
  );
  ctx.fillStyle = WINDOW_GLOW;
  ctx.fillRect(windowLeft, windowTop, windowWidth, windowHeight);
  ctx.fillStyle = IRON_DARK;
  for (let slot = 1; slot < BAR_SLOTS; slot++) {
    ctx.fillRect(windowLeft + (windowWidth * slot) / BAR_SLOTS, windowTop, 2, windowHeight);
  }
  const doorWidth = width * HUT_DOOR_WIDTH_SHARE;
  const doorHeight = wall * HUT_DOOR_HEIGHT_SHARE;
  paintPlank(
    ctx,
    x + width * HUT_DOOR_LEFT_SHARE,
    bottom - doorHeight,
    doorWidth,
    doorHeight,
    WOOD_MID,
  );
  ctx.fillStyle = ROOF_DARK;
  ctx.beginPath();
  ctx.moveTo(x - eave, roofBottom + eave);
  ctx.lineTo(x + width + eave, roofBottom + eave);
  ctx.lineTo(x + width, top);
  ctx.lineTo(x, top);
  ctx.closePath();
  ctx.fill();
  const shingle = (roofBottom + eave - top) / SHINGLE_ROWS;
  for (let row = 0; row < SHINGLE_ROWS; row++) {
    ctx.fillStyle = row % 2 === 0 ? ROOF_MID : ROOF_DARK;
    const rowTop = top + row * shingle;
    const spread = (eave * row) / SHINGLE_ROWS;
    ctx.fillRect(x - spread, rowTop, width + spread * 2, shingle - 1);
  }
}

const WAGON_BED_TOP_SHARE = 0.25;
const WAGON_BED_HEIGHT_SHARE = 0.45;
const WHEEL_RADIUS_SHARE = 0.32;
const WHEEL_HUB_SHARE = 0.08;
const WHEEL_SPOKES = 6;
const SACK_WIDTH_SHARE = 0.7;
const SACK_HEIGHT_SHARE = 0.55;
const SACK_SPACING_SHARE = 0.85;
const TONGUE_LENGTH_SHARE = 0.5;
const TONGUE_WIDTH_SHARE = 0.08;
/** The line of straw poking over the wagon bed's rim. */
const WAGON_STRAW_PX = 2;

function paintWagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  const width = w * ts;
  const top = y - ts * COVER_RISE_SHARE;
  const bottom = y + h * ts;
  const height = bottom - top;
  const bedTop = top + height * WAGON_BED_TOP_SHARE;
  const bedHeight = height * WAGON_BED_HEIGHT_SHARE;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    x - ts * TONGUE_LENGTH_SHARE,
    bedTop + bedHeight * HALF,
    ts * TONGUE_LENGTH_SHARE,
    ts * TONGUE_WIDTH_SHARE,
  );
  const sackWidth = ts * SACK_WIDTH_SHARE;
  const sackHeight = ts * SACK_HEIGHT_SHARE;
  for (
    let sackX = x + ts * DOOR_INSET_SHARE;
    sackX + sackWidth <= x + width;
    sackX += ts * SACK_SPACING_SHARE
  ) {
    ctx.fillStyle = CANVAS_DARK;
    ctx.beginPath();
    ctx.ellipse(
      sackX + sackWidth * HALF,
      bedTop,
      sackWidth * HALF,
      sackHeight * HALF,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
    ctx.fillStyle = CANVAS_LIGHT;
    ctx.beginPath();
    ctx.ellipse(
      sackX + sackWidth * HALF,
      bedTop - sackHeight * HALF * HALF,
      sackWidth * HALF * HALF,
      sackHeight * HALF * HALF,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  for (let plank = 0; plank < 2; plank++) {
    paintPlank(
      ctx,
      x,
      bedTop + (bedHeight * plank) / 2,
      width,
      bedHeight / 2,
      plank === 0 ? WOOD_LIGHT : WOOD_MID,
    );
  }
  ctx.fillStyle = STRAW;
  ctx.fillRect(x, bedTop - WAGON_STRAW_PX / 2, width, WAGON_STRAW_PX);
  const wheelRadius = ts * WHEEL_RADIUS_SHARE;
  const wheelY = bottom - wheelRadius;
  for (const wheelX of [x + wheelRadius * 2, x + width - wheelRadius * 2]) {
    ctx.fillStyle = WOOD_DARK;
    ctx.beginPath();
    ctx.arc(wheelX, wheelY, wheelRadius, 0, FULL_TURN);
    ctx.fill();
    ctx.strokeStyle = WOOD_LIGHT;
    ctx.lineWidth = 1;
    for (let spoke = 0; spoke < WHEEL_SPOKES; spoke++) {
      const angle = (spoke / WHEEL_SPOKES) * FULL_TURN;
      ctx.beginPath();
      ctx.moveTo(wheelX, wheelY);
      ctx.lineTo(wheelX + Math.cos(angle) * wheelRadius, wheelY + Math.sin(angle) * wheelRadius);
      ctx.stroke();
    }
    ctx.strokeStyle = IRON_MID;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wheelX, wheelY, wheelRadius - 1, 0, FULL_TURN);
    ctx.stroke();
    ctx.fillStyle = IRON_LIGHT;
    ctx.beginPath();
    ctx.arc(wheelX, wheelY, ts * WHEEL_HUB_SHARE, 0, FULL_TURN);
    ctx.fill();
  }
}

// ── Wall lamps ──────────────────────────────────────────────────────────────

const BRACKET_WIDTH_SHARE = 0.08;
const BRACKET_TOP_SHARE = 0.3;
const BRACKET_REACH_SHARE = 0.18;
const CAGE_WIDTH_SHARE = 0.2;
const CAGE_HEIGHT_SHARE = 0.26;
const CAGE_TOP_SHARE = 0.18;
const FLAME_RADIUS_SHARE = 0.07;

/**
 * An iron sconce with a caged flame, hung on the wall face whose tile's
 * top-left is (`x`, `y`). Returns nothing; the flame's glow is the lighting's.
 */
export function paintWallLamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const centreX = x + ts * HALF;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(
    centreX - ts * BRACKET_WIDTH_SHARE * HALF,
    y + ts * BRACKET_TOP_SHARE,
    ts * BRACKET_WIDTH_SHARE,
    ts * BRACKET_REACH_SHARE,
  );
  const cageWidth = ts * CAGE_WIDTH_SHARE;
  const cageHeight = ts * CAGE_HEIGHT_SHARE;
  const cageTop = y + ts * CAGE_TOP_SHARE;
  ctx.fillStyle = FLAME_OUTER;
  ctx.beginPath();
  ctx.arc(centreX, cageTop + cageHeight * HALF, ts * FLAME_RADIUS_SHARE * 2, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = FLAME_CORE;
  ctx.beginPath();
  ctx.arc(centreX, cageTop + cageHeight * HALF, ts * FLAME_RADIUS_SHARE, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = IRON_DARK;
  ctx.lineWidth = Math.max(1, ts * BRACKET_WIDTH_SHARE * HALF);
  ctx.strokeRect(centreX - cageWidth * HALF, cageTop, cageWidth, cageHeight);
  ctx.beginPath();
  ctx.moveTo(centreX, cageTop);
  ctx.lineTo(centreX, cageTop + cageHeight);
  ctx.stroke();
}
