/**
 * The spider lab's field station: what a research team carried in when they
 * fell back from the lab and dug in halfway down the hallway.
 *
 * Everything here reads as *emergency kit* rather than as a safe room's warm
 * provisioning: painted steel, canvas, safety colours and paper, and nothing
 * made of wood but the crate the lantern stands on. Drawn to the game's
 * oblique projection like the safe room's furnishings
 * (`src/sprites/safeRoomDecor.ts`): a fixed viewpoint south of and above the
 * tile, light from the up-left, shadow down-right, and the two wall-hung props
 * only ever on the room's north row.
 *
 * Every offset is a fraction of the tile size, kept inside the tile, so a prop
 * is correct at the 32 px the game draws at and at the review sizes.
 */

// ── Palette ───────────────────────────────────────────────────────────────────
const STEEL = '#7d8890';
const STEEL_LIGHT = '#a7b2b9';
const STEEL_DARK = '#4f5a62';
const STEEL_EDGE = '#2f363b';
const CANVAS_OLIVE = '#6b7048';
const CANVAS_OLIVE_LIGHT = '#868b5c';
const CANVAS_OLIVE_DARK = '#4c5034';
const BLANKET = '#5a6670';
const BLANKET_LIGHT = '#74818b';
const SANDBAG = '#b4a47a';
const SANDBAG_SHADE = '#8e8060';
const SANDBAG_TIE = '#6c6048';
const CABINET_WHITE = '#e4e6e2';
const CABINET_SHADE = '#b9bcb8';
const CROSS_RED = '#c0352b';
const HAZMAT_YELLOW = '#d9b23a';
const HAZMAT_YELLOW_DARK = '#a7852a';
const VISOR = '#2c4652';
const JERRY_RED = '#a8342a';
const JERRY_RED_LIGHT = '#c9533f';
const JERRY_RED_DARK = '#74221c';
const BOARD_WHITE = '#eef0ec';
const BOARD_FRAME = '#8d969c';
const MARKER_BLUE = '#2f4f8a';
const MARKER_RED = '#b8332a';
const MARKER_BLACK = '#2a2a2e';
const CRATE_WOOD = '#7a5a36';
const CRATE_WOOD_DARK = '#57402a';
const LANTERN_BODY = '#3d6b4a';
const LANTERN_BODY_DARK = '#2a4a34';
const LANTERN_GLOBE = 'rgba(255,236,190,0.95)';
const LANTERN_GLOW = 'rgba(255,214,140,0.35)';
const CONTACT_SHADOW = 'rgba(0,0,0,0.28)';
const WALL_SHADOW = 'rgba(0,0,0,0.22)';

const TILE_CENTRE_FRACTION = 0.5;

/** The ellipse every prop standing on the floor casts at its base. */
const CONTACT_SHADOW_BASE_FRACTION = 0.92;
const CONTACT_SHADOW_HEIGHT_FRACTION = 0.1;

function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  widthFraction: number,
): void {
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    sx + ts / 2,
    sy + ts * CONTACT_SHADOW_BASE_FRACTION,
    (ts * widthFraction) / 2,
    (ts * CONTACT_SHADOW_HEIGHT_FRACTION) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** A filled rectangle given as fractions of the tile. */
function fillFraction(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  color: string,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(sx + ts * left, sy + ts * top, Math.max(1, ts * width), Math.max(1, ts * height));
}

// ── Cot ───────────────────────────────────────────────────────────────────────

const COT = {
  left: 0.06,
  width: 0.88,
  top: 0.34,
  bedDepth: 0.36,
  frameThickness: 0.05,
  legWidth: 0.05,
  legHeight: 0.14,
  legInset: 0.08,
  sagLineTop: 0.5,
  blanketLeft: 0.52,
  blanketWidth: 0.36,
  blanketTop: 0.38,
  blanketDepth: 0.28,
  blanketFold: 0.06,
  pillowLeft: 0.1,
  pillowWidth: 0.18,
  pillowTop: 0.38,
  pillowDepth: 0.18,
  shadowWidth: 0.9,
} as const;

/** A folding camp cot in olive canvas, a grey blanket rolled at its foot: where Dave rests. */
export function drawStationCotTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, COT.shadowWidth);
  const legTop = COT.top + COT.bedDepth;
  for (const legLeft of [COT.left + COT.legInset, COT.left + COT.width - COT.legInset]) {
    fillFraction(ctx, sx, sy, ts, STEEL_EDGE, legLeft, legTop, COT.legWidth, COT.legHeight);
  }
  fillFraction(ctx, sx, sy, ts, CANVAS_OLIVE, COT.left, COT.top, COT.width, COT.bedDepth);
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CANVAS_OLIVE_LIGHT,
    COT.left,
    COT.top,
    COT.width,
    COT.frameThickness,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CANVAS_OLIVE_DARK,
    COT.left,
    legTop - COT.frameThickness,
    COT.width,
    COT.frameThickness,
  );
  // The canvas sags between the rails, which is what makes it a cot rather than a bench.
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CANVAS_OLIVE_DARK,
    COT.left + COT.legInset,
    COT.sagLineTop,
    COT.width - COT.legInset * 2,
    COT.frameThickness / 2,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CABINET_SHADE,
    COT.pillowLeft,
    COT.pillowTop,
    COT.pillowWidth,
    COT.pillowDepth,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    BLANKET,
    COT.blanketLeft,
    COT.blanketTop,
    COT.blanketWidth,
    COT.blanketDepth,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    BLANKET_LIGHT,
    COT.blanketLeft,
    COT.blanketTop,
    COT.blanketWidth,
    COT.blanketFold,
  );
}

// ── Barricade ─────────────────────────────────────────────────────────────────

const BARRICADE = {
  benchLeft: 0.1,
  benchWidth: 0.8,
  benchTop: 0.12,
  benchHeight: 0.4,
  benchEdge: 0.05,
  legWidth: 0.05,
  legReach: 0.1,
  legInset: 0.12,
  bagRow: 0.56,
  bagWidth: 0.3,
  bagHeight: 0.2,
  bagGap: 0.02,
  bagTie: 0.04,
  /** The share of a bag's height that is its shaded underside, and where its tie sits. */
  bagShadeShare: 1 / 3,
  shadowWidth: 0.92,
} as const;

/** Bag columns in the row along the barricade's foot. */
const BARRICADE_BAG_COUNT = 3;

/**
 * A steel lab bench tipped on its side with its legs sticking out, and a row of
 * sandbags in front of it: the barricade the team built across the door and
 * then dragged against the wall once the station was held.
 */
export function drawStationBarricadeTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, BARRICADE.shadowWidth);
  // The bench's legs point up-and-out at the viewer, so they sit above its top.
  for (const legLeft of [
    BARRICADE.benchLeft + BARRICADE.legInset,
    BARRICADE.benchLeft + BARRICADE.benchWidth - BARRICADE.legInset - BARRICADE.legWidth,
  ]) {
    fillFraction(
      ctx,
      sx,
      sy,
      ts,
      STEEL_DARK,
      legLeft,
      BARRICADE.benchTop - BARRICADE.legReach,
      BARRICADE.legWidth,
      BARRICADE.legReach,
    );
  }
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL,
    BARRICADE.benchLeft,
    BARRICADE.benchTop,
    BARRICADE.benchWidth,
    BARRICADE.benchHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_LIGHT,
    BARRICADE.benchLeft,
    BARRICADE.benchTop,
    BARRICADE.benchWidth,
    BARRICADE.benchEdge,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_EDGE,
    BARRICADE.benchLeft,
    BARRICADE.benchTop + BARRICADE.benchHeight - BARRICADE.benchEdge,
    BARRICADE.benchWidth,
    BARRICADE.benchEdge,
  );

  const rowWidth = BARRICADE_BAG_COUNT * BARRICADE.bagWidth;
  const rowLeft = (1 - rowWidth) / 2;
  for (let bag = 0; bag < BARRICADE_BAG_COUNT; bag++) {
    const left = rowLeft + bag * BARRICADE.bagWidth;
    const width = BARRICADE.bagWidth - BARRICADE.bagGap;
    ctx.fillStyle = SANDBAG;
    ctx.beginPath();
    ctx.ellipse(
      sx + ts * (left + width / 2),
      sy + ts * (BARRICADE.bagRow + BARRICADE.bagHeight / 2),
      (ts * width) / 2,
      (ts * BARRICADE.bagHeight) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    fillFraction(
      ctx,
      sx,
      sy,
      ts,
      SANDBAG_SHADE,
      left,
      BARRICADE.bagRow + BARRICADE.bagHeight * (1 - BARRICADE.bagShadeShare),
      width,
      BARRICADE.bagHeight * BARRICADE.bagShadeShare,
    );
    fillFraction(
      ctx,
      sx,
      sy,
      ts,
      SANDBAG_TIE,
      left + width - BARRICADE.bagTie,
      BARRICADE.bagRow + BARRICADE.bagHeight * BARRICADE.bagShadeShare,
      BARRICADE.bagTie / 2,
      BARRICADE.bagHeight * BARRICADE.bagShadeShare,
    );
  }
}

// ── First-aid cabinet ─────────────────────────────────────────────────────────

const FIRST_AID = {
  left: 0.22,
  width: 0.56,
  top: 0.08,
  height: 0.5,
  doorSeam: 0.03,
  shade: 0.1,
  crossArm: 0.28,
  crossThickness: 0.09,
  crossCentreY: 0.32,
} as const;

/** A white first-aid cabinet with a red cross, hung on the north wall. */
export function drawStationFirstAidTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    WALL_SHADOW,
    FIRST_AID.left + FIRST_AID.shade / 2,
    FIRST_AID.top + FIRST_AID.height,
    FIRST_AID.width,
    FIRST_AID.shade / 2,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CABINET_WHITE,
    FIRST_AID.left,
    FIRST_AID.top,
    FIRST_AID.width,
    FIRST_AID.height,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CABINET_SHADE,
    FIRST_AID.left + FIRST_AID.width - FIRST_AID.shade,
    FIRST_AID.top,
    FIRST_AID.shade,
    FIRST_AID.height,
  );
  const crossLeft = TILE_CENTRE_FRACTION - FIRST_AID.crossArm / 2;
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CROSS_RED,
    crossLeft,
    FIRST_AID.crossCentreY - FIRST_AID.crossThickness / 2,
    FIRST_AID.crossArm,
    FIRST_AID.crossThickness,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CROSS_RED,
    TILE_CENTRE_FRACTION - FIRST_AID.crossThickness / 2,
    FIRST_AID.crossCentreY - FIRST_AID.crossArm / 2,
    FIRST_AID.crossThickness,
    FIRST_AID.crossArm,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CABINET_SHADE,
    FIRST_AID.left,
    FIRST_AID.top + FIRST_AID.height - FIRST_AID.doorSeam,
    FIRST_AID.width,
    FIRST_AID.doorSeam,
  );
}

// ── Hazmat locker ─────────────────────────────────────────────────────────────

const LOCKER = {
  left: 0.12,
  width: 0.46,
  top: 0.0,
  height: 0.88,
  edge: 0.05,
  ventTop: 0.1,
  ventGap: 0.07,
  ventWidth: 0.26,
  doorLeft: 0.56,
  doorWidth: 0.08,
  doorTop: 0.04,
  doorHeight: 0.8,
  suitLeft: 0.6,
  suitWidth: 0.32,
  hoodTop: 0.08,
  hoodHeight: 0.22,
  visorInset: 0.05,
  visorHeight: 0.09,
  sleeveTop: 0.3,
  sleeveHeight: 0.46,
  cuffHeight: 0.06,
  shadowWidth: 0.86,
} as const;

/** Vent slots stamped into the locker's door. */
const LOCKER_VENT_COUNT = 3;

/**
 * A steel locker with its door swung open and a yellow hazmat suit hanging out
 * of it — somebody suited up in a hurry, or decided not to.
 */
export function drawStationHazmatLockerTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, LOCKER.shadowWidth);
  fillFraction(ctx, sx, sy, ts, STEEL, LOCKER.left, LOCKER.top, LOCKER.width, LOCKER.height);
  fillFraction(ctx, sx, sy, ts, STEEL_LIGHT, LOCKER.left, LOCKER.top, LOCKER.edge, LOCKER.height);
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_EDGE,
    LOCKER.left,
    LOCKER.top + LOCKER.height - LOCKER.edge,
    LOCKER.width,
    LOCKER.edge,
  );
  for (let vent = 0; vent < LOCKER_VENT_COUNT; vent++) {
    fillFraction(
      ctx,
      sx,
      sy,
      ts,
      STEEL_DARK,
      LOCKER.left + LOCKER.edge * 2,
      LOCKER.ventTop + vent * LOCKER.ventGap,
      LOCKER.ventWidth,
      LOCKER.edge / 2,
    );
  }
  // The suit first, then the open door edge-on over its shoulder.
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    HAZMAT_YELLOW,
    LOCKER.suitLeft,
    LOCKER.hoodTop,
    LOCKER.suitWidth,
    LOCKER.hoodHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    VISOR,
    LOCKER.suitLeft + LOCKER.visorInset,
    LOCKER.hoodTop + LOCKER.visorInset,
    LOCKER.suitWidth - LOCKER.visorInset * 2,
    LOCKER.visorHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    HAZMAT_YELLOW_DARK,
    LOCKER.suitLeft,
    LOCKER.sleeveTop,
    LOCKER.suitWidth / 2,
    LOCKER.sleeveHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    HAZMAT_YELLOW,
    LOCKER.suitLeft + LOCKER.suitWidth / 2,
    LOCKER.sleeveTop,
    LOCKER.suitWidth / 2,
    LOCKER.sleeveHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_EDGE,
    LOCKER.suitLeft,
    LOCKER.sleeveTop + LOCKER.sleeveHeight - LOCKER.cuffHeight,
    LOCKER.suitWidth,
    LOCKER.cuffHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_DARK,
    LOCKER.doorLeft + LOCKER.doorWidth / 2,
    LOCKER.doorTop,
    LOCKER.doorWidth / 2,
    LOCKER.doorHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_LIGHT,
    LOCKER.doorLeft + LOCKER.doorWidth / 2,
    LOCKER.doorTop,
    LOCKER.edge / 2,
    LOCKER.doorHeight,
  );
}

// ── Jerry can ─────────────────────────────────────────────────────────────────

const JERRY = {
  left: 0.32,
  width: 0.36,
  top: 0.42,
  height: 0.44,
  edge: 0.05,
  handleLeft: 0.38,
  handleWidth: 0.16,
  handleTop: 0.34,
  handleHeight: 0.08,
  spoutLeft: 0.58,
  spoutWidth: 0.08,
  spoutTop: 0.36,
  spoutHeight: 0.08,
  crossInset: 0.07,
  shadowWidth: 0.5,
} as const;

/** A red jerry can of fuel for the generator nobody got working. */
export function drawStationJerryCanTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, JERRY.shadowWidth);
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    JERRY_RED_DARK,
    JERRY.handleLeft,
    JERRY.handleTop,
    JERRY.handleWidth,
    JERRY.handleHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    STEEL_DARK,
    JERRY.spoutLeft,
    JERRY.spoutTop,
    JERRY.spoutWidth,
    JERRY.spoutHeight,
  );
  fillFraction(ctx, sx, sy, ts, JERRY_RED, JERRY.left, JERRY.top, JERRY.width, JERRY.height);
  fillFraction(ctx, sx, sy, ts, JERRY_RED_LIGHT, JERRY.left, JERRY.top, JERRY.edge, JERRY.height);
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    JERRY_RED_DARK,
    JERRY.left,
    JERRY.top + JERRY.height - JERRY.edge,
    JERRY.width,
    JERRY.edge,
  );
  // The pressed X on its flank, the one detail that makes it a jerry can at this size.
  ctx.strokeStyle = JERRY_RED_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx + ts * (JERRY.left + JERRY.crossInset), sy + ts * (JERRY.top + JERRY.crossInset));
  ctx.lineTo(
    sx + ts * (JERRY.left + JERRY.width - JERRY.crossInset),
    sy + ts * (JERRY.top + JERRY.height - JERRY.crossInset),
  );
  ctx.moveTo(
    sx + ts * (JERRY.left + JERRY.width - JERRY.crossInset),
    sy + ts * (JERRY.top + JERRY.crossInset),
  );
  ctx.lineTo(
    sx + ts * (JERRY.left + JERRY.crossInset),
    sy + ts * (JERRY.top + JERRY.height - JERRY.crossInset),
  );
  ctx.stroke();
}

// ── Whiteboard ────────────────────────────────────────────────────────────────

const WHITEBOARD = {
  left: 0.04,
  width: 0.92,
  top: 0.08,
  height: 0.56,
  frame: 0.04,
  lineLeft: 0.12,
  lineTop: 0.2,
  lineGap: 0.09,
  lineHeight: 0.025,
  circleX: 0.72,
  circleY: 0.34,
  circleRadius: 0.13,
  sevenLeft: 0.67,
  sevenRight: 0.77,
  sevenTop: 0.27,
  sevenBottom: 0.42,
  /** How far along the seven's top bar its downstroke lands. */
  sevenFootShare: 1 / 3,
  arrowFromX: 0.5,
  arrowFromY: 0.48,
  arrowToX: 0.6,
  arrowToY: 0.4,
  shade: 0.04,
} as const;

/** Scrawled lines of notes, each a share of the board's writing width. */
const WHITEBOARD_NOTE_WIDTHS: ReadonlyArray<number> = [0.42, 0.36, 0.46, 0.28];

/**
 * A whiteboard of frantic notes about Specimen 7: ruled scrawl in blue, the
 * specimen's number circled hard in red, an arrow at it. Strokes rather than
 * glyphs, because a letter is a pixel of noise at 32 px — the red circle is
 * what reads from across the room.
 */
export function drawStationWhiteboardTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    WALL_SHADOW,
    WHITEBOARD.left + WHITEBOARD.shade,
    WHITEBOARD.top + WHITEBOARD.height,
    WHITEBOARD.width,
    WHITEBOARD.shade,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    BOARD_FRAME,
    WHITEBOARD.left,
    WHITEBOARD.top,
    WHITEBOARD.width,
    WHITEBOARD.height,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    BOARD_WHITE,
    WHITEBOARD.left + WHITEBOARD.frame,
    WHITEBOARD.top + WHITEBOARD.frame,
    WHITEBOARD.width - WHITEBOARD.frame * 2,
    WHITEBOARD.height - WHITEBOARD.frame * 2,
  );
  WHITEBOARD_NOTE_WIDTHS.forEach((width, line) => {
    fillFraction(
      ctx,
      sx,
      sy,
      ts,
      line === 0 ? MARKER_BLACK : MARKER_BLUE,
      WHITEBOARD.lineLeft,
      WHITEBOARD.lineTop + line * WHITEBOARD.lineGap,
      width,
      WHITEBOARD.lineHeight,
    );
  });

  ctx.strokeStyle = MARKER_RED;
  ctx.lineWidth = Math.max(1, ts * WHITEBOARD.lineHeight);
  ctx.beginPath();
  ctx.arc(
    sx + ts * WHITEBOARD.circleX,
    sy + ts * WHITEBOARD.circleY,
    ts * WHITEBOARD.circleRadius,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + ts * WHITEBOARD.sevenLeft, sy + ts * WHITEBOARD.sevenTop);
  ctx.lineTo(sx + ts * WHITEBOARD.sevenRight, sy + ts * WHITEBOARD.sevenTop);
  const sevenFootX =
    WHITEBOARD.sevenLeft +
    (WHITEBOARD.sevenRight - WHITEBOARD.sevenLeft) * WHITEBOARD.sevenFootShare;
  ctx.lineTo(sx + ts * sevenFootX, sy + ts * WHITEBOARD.sevenBottom);
  ctx.moveTo(sx + ts * WHITEBOARD.arrowFromX, sy + ts * WHITEBOARD.arrowFromY);
  ctx.lineTo(sx + ts * WHITEBOARD.arrowToX, sy + ts * WHITEBOARD.arrowToY);
  ctx.stroke();
}

// ── Camping lantern ───────────────────────────────────────────────────────────

const CAMP_LANTERN = {
  crateLeft: 0.18,
  crateWidth: 0.64,
  crateTop: 0.5,
  crateHeight: 0.38,
  slat: 0.05,
  bodyLeft: 0.38,
  bodyWidth: 0.24,
  baseTop: 0.42,
  baseHeight: 0.1,
  globeTop: 0.22,
  globeHeight: 0.2,
  capTop: 0.16,
  capHeight: 0.07,
  bailTop: 0.08,
  glowRadius: 0.34,
  shadowWidth: 0.78,
} as const;

/**
 * A battery camping lantern on a supply crate, lit. The pool of light it throws
 * on the room is the lighting pass's (`camp_lantern`); the soft halo here is
 * only the globe's own bloom, so it reads as on even in the brightest room.
 */
export function drawStationLanternTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawContactShadow(ctx, sx, sy, ts, CAMP_LANTERN.shadowWidth);
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CRATE_WOOD,
    CAMP_LANTERN.crateLeft,
    CAMP_LANTERN.crateTop,
    CAMP_LANTERN.crateWidth,
    CAMP_LANTERN.crateHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CRATE_WOOD_DARK,
    CAMP_LANTERN.crateLeft,
    CAMP_LANTERN.crateTop + CAMP_LANTERN.crateHeight / 2,
    CAMP_LANTERN.crateWidth,
    CAMP_LANTERN.slat,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    CRATE_WOOD_DARK,
    CAMP_LANTERN.crateLeft,
    CAMP_LANTERN.crateTop + CAMP_LANTERN.crateHeight - CAMP_LANTERN.slat,
    CAMP_LANTERN.crateWidth,
    CAMP_LANTERN.slat,
  );

  const globeCentreX = sx + ts / 2;
  const globeCentreY = sy + ts * (CAMP_LANTERN.globeTop + CAMP_LANTERN.globeHeight / 2);
  ctx.fillStyle = LANTERN_GLOW;
  ctx.beginPath();
  ctx.arc(globeCentreX, globeCentreY, ts * CAMP_LANTERN.glowRadius, 0, Math.PI * 2);
  ctx.fill();

  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    LANTERN_BODY,
    CAMP_LANTERN.bodyLeft,
    CAMP_LANTERN.baseTop,
    CAMP_LANTERN.bodyWidth,
    CAMP_LANTERN.baseHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    LANTERN_GLOBE,
    CAMP_LANTERN.bodyLeft,
    CAMP_LANTERN.globeTop,
    CAMP_LANTERN.bodyWidth,
    CAMP_LANTERN.globeHeight,
  );
  fillFraction(
    ctx,
    sx,
    sy,
    ts,
    LANTERN_BODY_DARK,
    CAMP_LANTERN.bodyLeft,
    CAMP_LANTERN.capTop,
    CAMP_LANTERN.bodyWidth,
    CAMP_LANTERN.capHeight,
  );
  ctx.strokeStyle = LANTERN_BODY_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(
    globeCentreX,
    sy + ts * CAMP_LANTERN.capTop,
    ts * (CAMP_LANTERN.capTop - CAMP_LANTERN.bailTop),
    Math.PI,
    0,
  );
  ctx.stroke();
}
