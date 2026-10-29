/**
 * The doctor's corner of a safe room: a tall glass-fronted medicine cabinet
 * against the north wall and a leather doctor's bag on the floor beside it.
 *
 * Drawn to the game's oblique projection like the room's other furnishings
 * (`src/sprites/safeRoomDecor.ts`): a fixed viewpoint south of and above, so
 * the cabinet shows its top and its front and never a side; light from the
 * up-left, shade and floor shadow down-right.
 *
 * The cabinet is two tiles wide and taller than a tile, so it stands on its
 * floor tiles and rises into the wall row above them. It is painted as one
 * object in cabinet space (tile units from the west tile's top-left, `x` across
 * both tiles, negative `y` into the wall row) and clipped to whichever half the
 * caller is drawing, so the two halves meet without a seam.
 *
 * Its emblem is a green cross: a red cross on white is a protected emblem.
 */

// ── Palette ───────────────────────────────────────────────────────────────────
// Warm off-white paint over oak, so the cabinet sits with the room's oiled wood
// and cream tile rather than reading as the lab's cold enamel.
const PAINT = '#e6dec9';
const PAINT_LIGHT = '#f5f0e2';
const PAINT_SHADE = '#c3b89e';
const PAINT_DEEP = '#978c74';
const PAINT_GRIME = 'rgba(92,72,48,0.22)';
const OUTLINE = '#3b3027';
const WOOD = '#87593a';
const WOOD_DARK = '#5a3a24';
const SHELF = '#6b452a';
const SHELF_LIGHT = '#87593a';
const CABINET_INTERIOR = '#2c231d';
const CABINET_INTERIOR_DEEP = '#1f1814';
const GLASS_TINT = 'rgba(190,225,230,0.12)';
const GLASS_GLINT = 'rgba(255,255,255,0.32)';
const GLASS_GLINT_FAINT = 'rgba(255,255,255,0.14)';
const BRASS = '#b08d3f';
const BRASS_LIGHT = '#e0bf72';
const BRASS_DARK = '#7a5f28';
const CROSS_GREEN = '#3e8a4c';
const CROSS_GREEN_DARK = '#28603a';
const BANDAGE = '#efe9da';
const BANDAGE_SHADE = '#c9c0aa';
const BANDAGE_CORE = '#a99f88';
const FLAME_OUTER = 'rgba(255,170,70,0.95)';
const FLAME_CORE = 'rgba(255,240,190,1)';
const CHIMNEY_GLASS = 'rgba(255,236,190,0.45)';
const CHIMNEY_EDGE = 'rgba(255,250,235,0.7)';
const LAMP_GLOW_INNER = 'rgba(255,214,140,0.45)';
const LAMP_GLOW_OUTER = 'rgba(255,214,140,0)';
const CONTACT_SHADOW = 'rgba(0,0,0,0.3)';
const SOFT_SHADOW = 'rgba(0,0,0,0.18)';

/** Glass colours for the bottles on the shelves, each as body, shadow side and highlight. */
const BOTTLE_GLASS = [
  { body: '#6b3a1c', shade: '#4a2712', light: '#9a5a2e' },
  { body: '#2f6a3a', shade: '#1f4a28', light: '#4f9a5a' },
  { body: '#b9cfd0', shade: '#8aa3a6', light: '#eef8f8' },
  { body: '#2c4f8e', shade: '#1d3664', light: '#4f78bd' },
  { body: '#7a4a22', shade: '#553216', light: '#a8703c' },
] as const;
const BOTTLE_LABEL = '#ece4cc';
const BOTTLE_CORK = '#a07a4e';

// ── Cabinet geometry, in tile units of cabinet space ──────────────────────────

const CABINET = {
  /** The painted carcass, inset so a gap of floor shows past each outer side. */
  left: 0.06,
  right: 1.94,
  /** The crown moulding oversails the carcass on both sides. */
  crownLeft: 0.02,
  crownRight: 1.98,
  /** Back edge of the top surface, where it meets the wall: the highest the carcass paints. */
  topBack: -0.7,
  crownTop: -0.52,
  crownBottom: -0.44,
  glassTop: -0.36,
  glassBottom: 0.4,
  ledgeTop: 0.4,
  ledgeBottom: 0.47,
  cupboardBottom: 0.86,
  plinthBottom: 0.92,
  /** Half-width of the paired stiles where the two glass doors meet in the middle. */
  meetingStile: 0.06,
  outerStile: 0.07,
  /** The right-hand strip of the front that turns away from the up-left light. */
  shadeWidth: 0.07,
  cupboardDoorInset: 0.07,
  cupboardPanelInset: 0.06,
  grimeHeight: 0.1,
  outline: 0.03,
} as const;

const CABINET_SPAN_TILES = 2;
const CABINET_CENTRE_X = CABINET_SPAN_TILES / 2;
/** The east tile starts one tile into cabinet space. */
const EAST_TILE_X = 1;

/** Bottles stand in three rows on shelf boards behind the glass. */
const SHELF_ROWS = 3;
const SHELF_BOARD_HEIGHT = 0.035;
const BOTTLE = {
  slotWidth: 0.11,
  minHeight: 0.13,
  heightRange: 0.08,
  minWidthShare: 0.55,
  widthShareRange: 0.3,
  neckWidthShare: 0.4,
  neckHeight: 0.04,
  corkHeight: 0.02,
  labelTopShare: 0.35,
  labelHeightShare: 0.35,
  /** Some slots stand empty, so the rows read as a working store rather than a print. */
  emptyChance: 0.12,
  labelChance: 0.45,
  sideInset: 0.03,
  /** The lit and shadowed sides of each bottle, as shares of its width. */
  sideShare: 0.25,
} as const;
/** Fixed seed for the bottle hash: the cabinet is baked into the chunk cache and must repaint identically. */
const BOTTLE_SEED = 7919;
const HASH_MULTIPLIER = 2654435761;
const HASH_SHIFT = 15;
const HASH_SPAN = 4294967296;

const GLINT = {
  /** Each door's reflection streak, as a parallelogram leaning up-right. */
  startShare: 0.18,
  widthShare: 0.16,
  lean: 0.14,
  secondGapShare: 0.08,
  secondWidthShare: 0.05,
} as const;

const KNOB = {
  radius: 0.025,
  /** Knobs sit a little below the middle of the glass, on the meeting stiles. */
  glassShare: 0.62,
  cupboardShare: 0.35,
  stileOffset: 0.035,
} as const;

/** Green cross on the west cupboard door: the half the doctor never stands in front of. */
const CROSS = {
  centreX: 0.5,
  centreYShare: 0.5,
  arm: 0.22,
  thickness: 0.075,
  edge: 0.02,
} as const;

/** Where the paint has chipped back to the oak, as `[x, y, width, height]` in cabinet space. */
const PAINT_CHIPS: readonly (readonly [number, number, number, number])[] = [
  [0.07, 0.62, 0.03, 0.05],
  [0.3, 0.885, 0.07, 0.025],
  [1.22, 0.885, 0.05, 0.025],
  [1.9, 0.18, 0.03, 0.06],
  [1.9, 0.7, 0.03, 0.04],
  [0.62, -0.51, 0.06, 0.025],
  [1.55, 0.415, 0.06, 0.02],
  [0.95, 0.75, 0.03, 0.04],
];

// ── On top ────────────────────────────────────────────────────────────────────

/** Where objects stand on the cabinet's top: partway back from its front edge. */
const TOP_SURFACE_STANDING_Y = -0.58;

/** The outer turn of the spiral, one pixel of shade around the lit face. */
const SPIRAL_TURN_PX = 1;

const BANDAGE_ROLL = {
  centreX: 0.42,
  width: 0.24,
  height: 0.14,
  endWidth: 0.08,
  coreShare: 0.22,
  wrapCount: 3,
  undersideShare: 1 / 3,
} as const;

const LAMP = {
  centreX: 1.5,
  baseWidth: 0.22,
  baseHeight: 0.04,
  stemWidth: 0.05,
  stemHeight: 0.03,
  fontWidth: 0.2,
  fontHeight: 0.1,
  collarWidth: 0.1,
  collarHeight: 0.03,
  chimneyWidth: 0.1,
  chimneyHeight: 0.16,
  chimneyBulge: 0.025,
  flameWidth: 0.045,
  flameHeight: 0.09,
  coreShare: 0.5,
  /** Only a halo round the chimney: the room's lighting throws the lamp's real pool of light. */
  glowRadius: 0.1,
  /** The font's shadowed belly, offset down-right of its centre, as shares of the font. */
  bellyOffsetXShare: 1 / 6,
  bellyCentreYShare: 0.6,
  bellySizeShare: 2 / 3,
  /** A glint on the font's lit upper-left, as shares of the font. */
  glintLeftShare: 1 / 4,
  glintRightShare: 1 / 8,
  glintTopShare: 1 / 4,
  glintBottomShare: 1 / 2,
} as const;

/** A quadratic curve swells to half its control point's offset, so the control sits twice as far out. */
const QUAD_CONTROL_REACH = 2;
/** The lamp's shadow on the cabinet top spills past its base down-right, in outline widths. */
const LAMP_SHADOW_SPILL = 2;

const LAMP_BASE_TOP = TOP_SURFACE_STANDING_Y - LAMP.baseHeight;
const LAMP_STEM_TOP = LAMP_BASE_TOP - LAMP.stemHeight;
const LAMP_FONT_TOP = LAMP_STEM_TOP - LAMP.fontHeight;
const LAMP_COLLAR_TOP = LAMP_FONT_TOP - LAMP.collarHeight;
const LAMP_CHIMNEY_TOP = LAMP_COLLAR_TOP - LAMP.chimneyHeight;
const LAMP_FLAME_BOTTOM = LAMP_COLLAR_TOP - LAMP.collarHeight;
const LAMP_FLAME_CENTRE_Y = LAMP_FLAME_BOTTOM - LAMP.flameHeight / 2;

const CONTACT_SHADOW_Y = 0.93;
const CONTACT_SHADOW_HEIGHT = 0.12;
/** The floor shadow leans down-right, away from the light. */
const CONTACT_SHADOW_SHIFT_X = 0.05;

/** Which of the cabinet's two tiles is being drawn; the plumbing picks it from the west neighbour. */
export type CabinetHalf = 'west' | 'east';

/** How far above its own tile the cabinet paints, lamp included, in tiles. */
const CABINET_RISE_TILES = -Math.min(
  LAMP_CHIMNEY_TOP - LAMP.chimneyBulge,
  LAMP_FLAME_CENTRE_Y - LAMP.glowRadius,
);

/** Converts cabinet space to screen pixels for one draw. */
interface CabinetSpace {
  readonly ctx: CanvasRenderingContext2D;
  readonly ox: number;
  readonly oy: number;
  readonly ts: number;
}

function px(space: CabinetSpace, x: number): number {
  return space.ox + x * space.ts;
}

function py(space: CabinetSpace, y: number): number {
  return space.oy + y * space.ts;
}

/** A rectangle given by its edges in cabinet space, at least one pixel in each direction. */
function fillEdges(
  space: CabinetSpace,
  colour: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const { ctx, ts } = space;
  ctx.fillStyle = colour;
  ctx.fillRect(
    px(space, left),
    py(space, top),
    Math.max(1, (right - left) * ts),
    Math.max(1, (bottom - top) * ts),
  );
}

/** A deterministic value in [0, 1) for a bottle slot, so every repaint stocks the same shelves. */
function slotHash(row: number, slot: number, salt: number): number {
  let h = (row * HASH_SHIFT + slot + salt * BOTTLE_SEED) >>> 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_MULTIPLIER) >>> 0;
  h = (h ^ (h >>> HASH_SHIFT)) >>> 0;
  return h / HASH_SPAN;
}

function drawContactShadow(space: CabinetSpace): void {
  const { ctx, ts } = space;
  const halfWidth = ((CABINET.right - CABINET.left) * ts) / 2;
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    px(space, CABINET_CENTRE_X + CONTACT_SHADOW_SHIFT_X),
    py(space, CONTACT_SHADOW_Y),
    halfWidth,
    (CONTACT_SHADOW_HEIGHT * ts) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawCarcass(space: CabinetSpace): void {
  const { left, right, crownLeft, crownRight, outline } = CABINET;
  // A dark rim around the whole silhouette so the pale cabinet holds its edge
  // against the cream floor tile as well as against the dark wall.
  fillEdges(
    space,
    OUTLINE,
    crownLeft - outline,
    CABINET.topBack - outline,
    crownRight + outline,
    CABINET.crownBottom + outline,
  );
  fillEdges(
    space,
    OUTLINE,
    left - outline,
    CABINET.crownBottom,
    right + outline,
    CABINET.plinthBottom + outline,
  );

  fillEdges(space, PAINT_LIGHT, crownLeft, CABINET.topBack, crownRight, CABINET.crownTop);
  fillEdges(space, PAINT, crownLeft, CABINET.crownTop, crownRight, CABINET.crownBottom);
  fillEdges(
    space,
    PAINT_SHADE,
    crownLeft,
    CABINET.crownBottom - outline,
    crownRight,
    CABINET.crownBottom,
  );
  fillEdges(space, PAINT, left, CABINET.crownBottom, right, CABINET.plinthBottom);
  fillEdges(
    space,
    PAINT_SHADE,
    right - CABINET.shadeWidth,
    CABINET.crownBottom,
    right,
    CABINET.plinthBottom,
  );
  fillEdges(space, PAINT_LIGHT, left, CABINET.crownBottom, left + outline, CABINET.plinthBottom);
  fillEdges(space, PAINT_DEEP, left, CABINET.cupboardBottom, right, CABINET.plinthBottom);
  fillEdges(space, PAINT_LIGHT, crownLeft, CABINET.topBack, crownRight, CABINET.topBack + outline);
}

function drawBottleRow(
  space: CabinetSpace,
  row: number,
  left: number,
  right: number,
  floorY: number,
): void {
  const slotCount = Math.floor((right - left) / BOTTLE.slotWidth);
  const spare = right - left - slotCount * BOTTLE.slotWidth;
  for (let slot = 0; slot < slotCount; slot++) {
    if (slotHash(row, slot, 0) < BOTTLE.emptyChance) continue;
    const glass = BOTTLE_GLASS[Math.floor(slotHash(row, slot, 1) * BOTTLE_GLASS.length)];
    const height = BOTTLE.minHeight + slotHash(row, slot, 2) * BOTTLE.heightRange;
    const width =
      BOTTLE.slotWidth * (BOTTLE.minWidthShare + slotHash(row, slot, 3) * BOTTLE.widthShareRange);
    const centreX = left + spare / 2 + slot * BOTTLE.slotWidth + BOTTLE.slotWidth / 2;
    const bodyLeft = centreX - width / 2;
    const bodyRight = centreX + width / 2;
    const shoulderY = floorY - height + BOTTLE.neckHeight + BOTTLE.corkHeight;
    fillEdges(space, glass.body, bodyLeft, shoulderY, bodyRight, floorY);
    fillEdges(space, glass.shade, centreX + width * BOTTLE.sideShare, shoulderY, bodyRight, floorY);
    fillEdges(space, glass.light, bodyLeft, shoulderY, bodyLeft + width * BOTTLE.sideShare, floorY);
    const neckHalf = (width * BOTTLE.neckWidthShare) / 2;
    const neckTop = shoulderY - BOTTLE.neckHeight;
    fillEdges(space, glass.body, centreX - neckHalf, neckTop, centreX + neckHalf, shoulderY);
    fillEdges(
      space,
      BOTTLE_CORK,
      centreX - neckHalf,
      neckTop - BOTTLE.corkHeight,
      centreX + neckHalf,
      neckTop,
    );
    if (slotHash(row, slot, 4) < BOTTLE.labelChance) {
      const bodyHeight = floorY - shoulderY;
      const labelTop = shoulderY + bodyHeight * BOTTLE.labelTopShare;
      fillEdges(
        space,
        BOTTLE_LABEL,
        bodyLeft,
        labelTop,
        bodyRight,
        labelTop + bodyHeight * BOTTLE.labelHeightShare,
      );
    }
  }
}

function drawGlassDoor(space: CabinetSpace, row: number, left: number, right: number): void {
  const top = CABINET.glassTop;
  const bottom = CABINET.glassBottom;
  fillEdges(space, OUTLINE, left, top, right, bottom);
  const inLeft = left + CABINET.outline;
  const inRight = right - CABINET.outline;
  const inTop = top + CABINET.outline;
  fillEdges(space, CABINET_INTERIOR, inLeft, inTop, inRight, bottom);
  fillEdges(space, CABINET_INTERIOR_DEEP, inLeft, inTop, inRight, inTop + CABINET.outline);

  const rowHeight = (bottom - inTop) / SHELF_ROWS;
  for (let shelf = 0; shelf < SHELF_ROWS; shelf++) {
    const boardBottom = inTop + rowHeight * (shelf + 1);
    const boardTop = boardBottom - SHELF_BOARD_HEIGHT;
    drawBottleRow(
      space,
      row * SHELF_ROWS + shelf,
      inLeft + BOTTLE.sideInset,
      inRight - BOTTLE.sideInset,
      boardTop,
    );
    fillEdges(space, SHELF, inLeft, boardTop, inRight, boardBottom);
    fillEdges(space, SHELF_LIGHT, inLeft, boardTop, inRight, boardTop + SHELF_BOARD_HEIGHT / 2);
  }

  fillEdges(space, GLASS_TINT, inLeft, inTop, inRight, bottom);
  drawGlint(space, inLeft, inTop, inRight, bottom);
}

/** Two reflection streaks across a pane, leaning with the light. */
function drawGlint(
  space: CabinetSpace,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const { ctx } = space;
  const width = right - left;
  const streaks: readonly (readonly [number, number, string])[] = [
    [GLINT.startShare, GLINT.widthShare, GLASS_GLINT],
    [
      GLINT.startShare + GLINT.widthShare + GLINT.secondGapShare,
      GLINT.secondWidthShare,
      GLASS_GLINT_FAINT,
    ],
  ];
  ctx.save();
  ctx.beginPath();
  ctx.rect(px(space, left), py(space, top), width * space.ts, (bottom - top) * space.ts);
  ctx.clip();
  for (const [startShare, widthShare, colour] of streaks) {
    const x0 = left + width * startShare;
    const x1 = x0 + width * widthShare;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(px(space, x0), py(space, bottom));
    ctx.lineTo(px(space, x1), py(space, bottom));
    ctx.lineTo(px(space, x1 + GLINT.lean + width * widthShare), py(space, top));
    ctx.lineTo(px(space, x0 + GLINT.lean + width * widthShare), py(space, top));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawKnob(space: CabinetSpace, x: number, y: number): void {
  const { ctx, ts } = space;
  const radius = Math.max(1, KNOB.radius * ts);
  ctx.fillStyle = BRASS_DARK;
  ctx.beginPath();
  ctx.arc(px(space, x), py(space, y), radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(
    px(space, x) - radius / 2,
    py(space, y) - radius / 2,
    Math.max(1, radius / 2),
    Math.max(1, radius / 2),
  );
}

function drawGlassSection(space: CabinetSpace): void {
  const westLeft = CABINET.left + CABINET.outerStile;
  const westRight = CABINET_CENTRE_X - CABINET.meetingStile;
  const eastLeft = CABINET_CENTRE_X + CABINET.meetingStile;
  const eastRight = CABINET.right - CABINET.outerStile;
  drawGlassDoor(space, 0, westLeft, westRight);
  drawGlassDoor(space, 1, eastLeft, eastRight);
  fillEdges(
    space,
    PAINT_SHADE,
    CABINET_CENTRE_X - CABINET.outline / 2,
    CABINET.glassTop,
    CABINET_CENTRE_X + CABINET.outline / 2,
    CABINET.glassBottom,
  );
  const knobY = CABINET.glassTop + (CABINET.glassBottom - CABINET.glassTop) * KNOB.glassShare;
  drawKnob(space, CABINET_CENTRE_X - KNOB.stileOffset, knobY);
  drawKnob(space, CABINET_CENTRE_X + KNOB.stileOffset, knobY);
}

function drawLedge(space: CabinetSpace): void {
  fillEdges(
    space,
    OUTLINE,
    CABINET.crownLeft,
    CABINET.ledgeTop,
    CABINET.crownRight,
    CABINET.ledgeBottom,
  );
  fillEdges(
    space,
    PAINT_LIGHT,
    CABINET.crownLeft,
    CABINET.ledgeTop,
    CABINET.crownRight,
    CABINET.ledgeBottom - CABINET.outline,
  );
  fillEdges(
    space,
    PAINT_SHADE,
    CABINET.crownRight - CABINET.shadeWidth,
    CABINET.ledgeTop,
    CABINET.crownRight,
    CABINET.ledgeBottom - CABINET.outline,
  );
}

function drawCupboardDoor(space: CabinetSpace, left: number, right: number): void {
  const top = CABINET.ledgeBottom + CABINET.cupboardDoorInset / 2;
  const bottom = CABINET.cupboardBottom - CABINET.cupboardDoorInset / 2;
  const inset = CABINET.cupboardPanelInset;
  // A raised panel: lit on its top and left bevels, shaded on its bottom and right.
  fillEdges(space, PAINT_SHADE, left + inset, top + inset, right - inset, bottom - inset);
  fillEdges(
    space,
    PAINT_LIGHT,
    left + inset + CABINET.outline,
    top + inset + CABINET.outline,
    right - inset,
    bottom - inset,
  );
  fillEdges(
    space,
    PAINT,
    left + inset + CABINET.outline,
    top + inset + CABINET.outline,
    right - inset - CABINET.outline,
    bottom - inset - CABINET.outline,
  );
  fillEdges(space, PAINT_DEEP, left, bottom, right, bottom + CABINET.outline);
}

function drawCupboard(space: CabinetSpace): void {
  const westLeft = CABINET.left + CABINET.outline;
  const eastRight = CABINET.right - CABINET.outline;
  drawCupboardDoor(space, westLeft, CABINET_CENTRE_X);
  drawCupboardDoor(space, CABINET_CENTRE_X, eastRight);
  fillEdges(
    space,
    PAINT_DEEP,
    CABINET_CENTRE_X - CABINET.outline / 2,
    CABINET.ledgeBottom,
    CABINET_CENTRE_X + CABINET.outline / 2,
    CABINET.cupboardBottom,
  );
  const knobY =
    CABINET.ledgeBottom + (CABINET.cupboardBottom - CABINET.ledgeBottom) * KNOB.cupboardShare;
  drawKnob(space, CABINET_CENTRE_X - KNOB.stileOffset, knobY);
  drawKnob(space, CABINET_CENTRE_X + KNOB.stileOffset, knobY);
  drawCross(space);
}

function drawCross(space: CabinetSpace): void {
  const centreY =
    CABINET.ledgeBottom + (CABINET.cupboardBottom - CABINET.ledgeBottom) * CROSS.centreYShare;
  const halfArm = CROSS.arm / 2;
  const halfThick = CROSS.thickness / 2;
  const { centreX, edge } = CROSS;
  for (const [colour, grow] of [
    [CROSS_GREEN_DARK, edge],
    [CROSS_GREEN, 0],
  ] as const) {
    fillEdges(
      space,
      colour,
      centreX - halfArm - grow,
      centreY - halfThick - grow,
      centreX + halfArm + grow,
      centreY + halfThick + grow,
    );
    fillEdges(
      space,
      colour,
      centreX - halfThick - grow,
      centreY - halfArm - grow,
      centreX + halfThick + grow,
      centreY + halfArm + grow,
    );
  }
}

function drawWear(space: CabinetSpace): void {
  fillEdges(
    space,
    PAINT_GRIME,
    CABINET.left,
    CABINET.cupboardBottom - CABINET.grimeHeight,
    CABINET.right,
    CABINET.cupboardBottom,
  );
  for (const [x, y, width, height] of PAINT_CHIPS) {
    fillEdges(space, WOOD, x, y, x + width, y + height);
    fillEdges(space, WOOD_DARK, x, y + height / 2, x + width, y + height);
  }
}

/** The roll's silhouette, a cylinder lying east–west, grown by `grow` on every side. */
function fillRollShape(space: CabinetSpace, colour: string, grow: number): void {
  const { ctx, ts } = space;
  const { centreX, width, height, endWidth } = BANDAGE_ROLL;
  const leftEndX = centreX - width / 2 + endWidth / 2;
  const rightEndX = centreX + width / 2;
  const middleY = TOP_SURFACE_STANDING_Y - height / 2;
  const radiusX = (endWidth / 2 + grow) * ts;
  const radiusY = (height / 2 + grow) * ts;
  ctx.fillStyle = colour;
  for (const endX of [leftEndX, rightEndX]) {
    ctx.beginPath();
    ctx.ellipse(px(space, endX), py(space, middleY), radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  fillEdges(
    space,
    colour,
    leftEndX,
    middleY - height / 2 - grow,
    rightEndX,
    middleY + height / 2 + grow,
  );
}

function drawBandageRoll(space: CabinetSpace): void {
  const { ctx, ts } = space;
  const { centreX, width, height, endWidth } = BANDAGE_ROLL;
  const left = centreX - width / 2;
  const right = centreX + width / 2;
  const bottom = TOP_SURFACE_STANDING_Y;
  const top = bottom - height;
  const leftEndX = left + endWidth / 2;
  const middleY = top + height / 2;

  fillEdges(
    space,
    SOFT_SHADOW,
    left,
    bottom - CABINET.outline,
    right + endWidth,
    bottom + CABINET.outline,
  );
  // White gauze on a pale top needs its own rim, or it vanishes at the tile size.
  fillRollShape(space, PAINT_DEEP, CABINET.outline);
  fillRollShape(space, BANDAGE, 0);
  fillEdges(
    space,
    BANDAGE_SHADE,
    leftEndX,
    bottom - height * BANDAGE_ROLL.undersideShare,
    right,
    bottom,
  );
  for (let wrap = 1; wrap < BANDAGE_ROLL.wrapCount; wrap++) {
    const wrapX = leftEndX + ((right - leftEndX) * wrap) / BANDAGE_ROLL.wrapCount;
    fillEdges(space, BANDAGE_SHADE, wrapX, top, wrapX + CABINET.outline / 2, bottom);
  }
  // The rolled end faces the light, so its spiral shows.
  ctx.fillStyle = BANDAGE_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    px(space, leftEndX),
    py(space, middleY),
    (endWidth * ts) / 2,
    (height * ts) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = BANDAGE;
  ctx.beginPath();
  ctx.ellipse(
    px(space, leftEndX - CABINET.outline / 2),
    py(space, middleY),
    (endWidth * ts) / 2 - SPIRAL_TURN_PX,
    (height * ts) / 2 - SPIRAL_TURN_PX,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = BANDAGE_CORE;
  ctx.beginPath();
  ctx.ellipse(
    px(space, leftEndX),
    py(space, middleY),
    (endWidth * ts * BANDAGE_ROLL.coreShare) / 2,
    (height * ts * BANDAGE_ROLL.coreShare) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawLamp(space: CabinetSpace): void {
  const { ctx, ts } = space;
  const { centreX } = LAMP;

  const glow = ctx.createRadialGradient(
    px(space, centreX),
    py(space, LAMP_FLAME_CENTRE_Y),
    0,
    px(space, centreX),
    py(space, LAMP_FLAME_CENTRE_Y),
    LAMP.glowRadius * ts,
  );
  glow.addColorStop(0, LAMP_GLOW_INNER);
  glow.addColorStop(1, LAMP_GLOW_OUTER);
  ctx.fillStyle = glow;
  ctx.fillRect(
    px(space, centreX - LAMP.glowRadius),
    py(space, LAMP_FLAME_CENTRE_Y - LAMP.glowRadius),
    LAMP.glowRadius * 2 * ts,
    LAMP.glowRadius * 2 * ts,
  );

  fillEdges(
    space,
    SOFT_SHADOW,
    centreX - LAMP.baseWidth / 2,
    TOP_SURFACE_STANDING_Y - CABINET.outline,
    centreX + LAMP.baseWidth / 2 + CABINET.outline * LAMP_SHADOW_SPILL,
    TOP_SURFACE_STANDING_Y + CABINET.outline,
  );
  fillEdges(
    space,
    BRASS_DARK,
    centreX - LAMP.baseWidth / 2,
    LAMP_BASE_TOP,
    centreX + LAMP.baseWidth / 2,
    TOP_SURFACE_STANDING_Y,
  );
  fillEdges(
    space,
    BRASS,
    centreX - LAMP.baseWidth / 2,
    LAMP_BASE_TOP,
    centreX + LAMP.baseWidth / 2,
    LAMP_BASE_TOP + LAMP.baseHeight / 2,
  );
  fillEdges(
    space,
    BRASS_DARK,
    centreX - LAMP.stemWidth / 2,
    LAMP_STEM_TOP,
    centreX + LAMP.stemWidth / 2,
    LAMP_BASE_TOP,
  );

  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.ellipse(
    px(space, centreX),
    py(space, LAMP_FONT_TOP + LAMP.fontHeight / 2),
    (LAMP.fontWidth * ts) / 2,
    (LAMP.fontHeight * ts) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = BRASS_DARK;
  ctx.beginPath();
  ctx.ellipse(
    px(space, centreX + LAMP.fontWidth * LAMP.bellyOffsetXShare),
    py(space, LAMP_FONT_TOP + LAMP.fontHeight * LAMP.bellyCentreYShare),
    (LAMP.fontWidth * ts * LAMP.bellySizeShare) / 2,
    (LAMP.fontHeight * ts * LAMP.bellySizeShare) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  fillEdges(
    space,
    BRASS_LIGHT,
    centreX - LAMP.fontWidth * LAMP.glintLeftShare,
    LAMP_FONT_TOP + LAMP.fontHeight * LAMP.glintTopShare,
    centreX - LAMP.fontWidth * LAMP.glintRightShare,
    LAMP_FONT_TOP + LAMP.fontHeight * LAMP.glintBottomShare,
  );
  fillEdges(
    space,
    BRASS_DARK,
    centreX - LAMP.collarWidth / 2,
    LAMP_COLLAR_TOP,
    centreX + LAMP.collarWidth / 2,
    LAMP_FONT_TOP,
  );

  const chimneyLeft = px(space, centreX - LAMP.chimneyWidth / 2);
  const chimneyRight = px(space, centreX + LAMP.chimneyWidth / 2);
  const chimneyTop = py(space, LAMP_CHIMNEY_TOP);
  const chimneyBottom = py(space, LAMP_COLLAR_TOP);
  const bulge = LAMP.chimneyBulge * ts;
  const chimneyMidY = py(space, LAMP_FLAME_CENTRE_Y);
  ctx.fillStyle = CHIMNEY_GLASS;
  ctx.beginPath();
  ctx.moveTo(chimneyLeft, chimneyBottom);
  ctx.quadraticCurveTo(
    chimneyLeft - bulge * QUAD_CONTROL_REACH,
    chimneyMidY,
    chimneyLeft,
    chimneyTop,
  );
  ctx.lineTo(chimneyRight, chimneyTop);
  ctx.quadraticCurveTo(
    chimneyRight + bulge * QUAD_CONTROL_REACH,
    chimneyMidY,
    chimneyRight,
    chimneyBottom,
  );
  ctx.closePath();
  ctx.fill();

  const flameBottom = py(space, LAMP_FLAME_BOTTOM);
  const flameTop = py(space, LAMP_FLAME_BOTTOM - LAMP.flameHeight);
  const flameHalf = (LAMP.flameWidth * ts) / 2;
  const flameX = px(space, centreX);
  ctx.fillStyle = FLAME_OUTER;
  ctx.beginPath();
  ctx.moveTo(flameX, flameTop);
  ctx.quadraticCurveTo(flameX + flameHalf * QUAD_CONTROL_REACH, flameBottom, flameX, flameBottom);
  ctx.quadraticCurveTo(flameX - flameHalf * QUAD_CONTROL_REACH, flameBottom, flameX, flameTop);
  ctx.fill();
  const coreTop = flameBottom - (flameBottom - flameTop) * LAMP.coreShare;
  ctx.fillStyle = FLAME_CORE;
  ctx.beginPath();
  ctx.moveTo(flameX, coreTop);
  ctx.quadraticCurveTo(flameX + flameHalf, flameBottom, flameX, flameBottom);
  ctx.quadraticCurveTo(flameX - flameHalf, flameBottom, flameX, coreTop);
  ctx.fill();

  ctx.fillStyle = CHIMNEY_EDGE;
  ctx.fillRect(
    chimneyLeft,
    chimneyTop,
    chimneyRight - chimneyLeft,
    Math.max(1, CABINET.outline * ts),
  );
  ctx.fillRect(
    chimneyLeft - bulge / 2,
    chimneyMidY - (chimneyMidY - chimneyTop) / 2,
    Math.max(1, CABINET.outline * ts),
    chimneyMidY - chimneyTop,
  );
}

function paintCabinet(space: CabinetSpace): void {
  drawContactShadow(space);
  drawCarcass(space);
  drawGlassSection(space);
  drawLedge(space);
  drawCupboard(space);
  drawWear(space);
  drawBandageRoll(space);
  drawLamp(space);
}

/**
 * One tile of the medicine cabinet. `(sx, sy)` is the screen top-left of the tile, `ts` the tile size.
 * The floor under it is already painted by the caller. May paint up into the tile row above (the wall),
 * as the other tall props do.
 */
export function drawMedicineCabinetTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  half: CabinetHalf,
): void {
  const westTileX = half === 'west' ? sx : sx - EAST_TILE_X * ts;
  const clipTop = sy - Math.ceil(CABINET_RISE_TILES) * ts;
  const clipHeight = sy + ts - clipTop;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, clipTop, ts, clipHeight);
  ctx.clip();
  paintCabinet({ ctx, ox: westTileX, oy: sy, ts });
  ctx.restore();
}

// ── Doctor's bag ──────────────────────────────────────────────────────────────

const LEATHER = '#6e4426';
const LEATHER_LIGHT = '#8f5c34';
const LEATHER_DARK = '#4a2c18';
const LEATHER_EDGE = '#2c1a0e';

/** The bag's proportions, in tiles. */
const BAG = {
  baseWidth: 0.34,
  topWidth: 0.26,
  height: 0.2,
  /** The hinged frame along the top bows up into a shallow ridge. */
  ridge: 0.04,
  baseBand: 0.035,
  frameBand: 0.025,
  handleWidth: 0.13,
  handleRise: 0.08,
  handleThickness: 0.03,
  claspWidth: 0.07,
  claspHeight: 0.05,
  shadowWidth: 0.42,
  shadowHeight: 0.08,
  highlightShare: 0.28,
  outline: 0.025,
} as const;

/** The doctor's bag, standing on the floor: `(centreX, groundY)` is the screen point where its base meets the floor. */
export function drawDoctorsBag(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  groundY: number,
  ts: number,
): void {
  const baseHalf = (BAG.baseWidth * ts) / 2;
  const topHalf = (BAG.topWidth * ts) / 2;
  const topY = groundY - BAG.height * ts;
  const ridgeY = topY - BAG.ridge * ts;
  const outline = Math.max(1, BAG.outline * ts);

  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    centreX + CONTACT_SHADOW_SHIFT_X * ts,
    groundY,
    (BAG.shadowWidth * ts) / 2,
    (BAG.shadowHeight * ts) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const handleY = ridgeY;
  const handleHalf = (BAG.handleWidth * ts) / 2;
  const handleTop = handleY - BAG.handleRise * ts;
  ctx.strokeStyle = LEATHER_EDGE;
  ctx.lineWidth = Math.max(1, BAG.handleThickness * ts) + outline;
  ctx.beginPath();
  ctx.moveTo(centreX - handleHalf, handleY);
  ctx.bezierCurveTo(
    centreX - handleHalf,
    handleTop,
    centreX + handleHalf,
    handleTop,
    centreX + handleHalf,
    handleY,
  );
  ctx.stroke();
  ctx.strokeStyle = LEATHER_DARK;
  ctx.lineWidth = Math.max(1, BAG.handleThickness * ts);
  ctx.stroke();

  const bodyPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(centreX - baseHalf, groundY);
    ctx.lineTo(centreX - topHalf, topY);
    ctx.quadraticCurveTo(centreX, ridgeY - BAG.ridge * ts, centreX + topHalf, topY);
    ctx.lineTo(centreX + baseHalf, groundY);
    ctx.closePath();
  };

  bodyPath();
  ctx.lineWidth = outline * 2;
  ctx.strokeStyle = LEATHER_EDGE;
  ctx.stroke();
  ctx.fillStyle = LEATHER;
  ctx.fill();

  ctx.save();
  bodyPath();
  ctx.clip();
  const bodyWidth = baseHalf * 2;
  ctx.fillStyle = LEATHER_LIGHT;
  ctx.fillRect(centreX - baseHalf, ridgeY, bodyWidth * BAG.highlightShare, groundY - ridgeY);
  ctx.fillStyle = LEATHER_DARK;
  ctx.fillRect(
    centreX + baseHalf - bodyWidth * BAG.highlightShare,
    ridgeY,
    bodyWidth * BAG.highlightShare,
    groundY - ridgeY,
  );
  ctx.fillRect(centreX - baseHalf, groundY - BAG.baseBand * ts, bodyWidth, BAG.baseBand * ts);
  // The hinged frame's seam, a little below the ridge.
  ctx.fillStyle = LEATHER_EDGE;
  ctx.fillRect(
    centreX - baseHalf,
    topY + BAG.frameBand * ts,
    bodyWidth,
    Math.max(1, (BAG.frameBand * ts) / 2),
  );
  ctx.restore();

  const claspHalf = (BAG.claspWidth * ts) / 2;
  const claspTop = topY - (BAG.claspHeight * ts) / 2;
  ctx.fillStyle = BRASS_DARK;
  ctx.fillRect(centreX - claspHalf, claspTop, claspHalf * 2, BAG.claspHeight * ts);
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(centreX - claspHalf, claspTop, claspHalf, Math.max(1, (BAG.claspHeight * ts) / 2));
}
