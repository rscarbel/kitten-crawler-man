/**
 * The safe-room service counter and the dishes served across it.
 *
 * Two pieces make up the galley the Bopca works in: the front bar the player
 * orders across and the back bench it cooks at. Both are drawn edge-aware — a
 * tile checks whether its neighbours belong to the same run and drops the cap
 * detail where they do — so a five-tile counter reads as one object rather than
 * five copies of a prop. The scrubbed strip between them is not drawn here at
 * all: it is `bopca_hearth` from the generated dungeon ground sheet, resolved
 * through `DUNGEON_GROUND` like every other floor in the room.
 *
 * `drawCounterFrontFace` is deliberately separable from the rest of the front
 * bar: the Bopca is drawn *between* the two, so the bar's own top slab and
 * cabinet occlude its lower body and it reads as standing behind the counter
 * rather than on top of it.
 */

/** Which sides of a counter tile continue into another tile of the same run. */
export interface CounterEdges {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

// ── Front bar geometry, as fractions of the tile size ─────────────────────────
/** Top of the stone work surface. Also the line the Bopca's apron sits behind. */
const COUNTER_SURFACE_TOP_FRACTION = 0.3;
const COUNTER_SURFACE_HEIGHT_FRACTION = 0.14;
const COUNTER_SURFACE_LIP_HEIGHT_FRACTION = 0.04;
const COUNTER_CABINET_TOP_FRACTION = COUNTER_SURFACE_TOP_FRACTION + COUNTER_SURFACE_HEIGHT_FRACTION;
const COUNTER_CABINET_BOTTOM_FRACTION = 0.93;
/** How far the slab oversails the cabinet at an open end of the run. */
const COUNTER_END_OVERSAIL_FRACTION = 0.06;
const COUNTER_PANEL_INSET_FRACTION = 0.16;
const COUNTER_PANEL_TOP_INSET_FRACTION = 0.08;
const COUNTER_PANEL_BOTTOM_INSET_FRACTION = 0.1;
const COUNTER_STILE_WIDTH_FRACTION = 0.07;
const COUNTER_TOE_SHADOW_HEIGHT_FRACTION = 0.07;
/**
 * Where the Bopca's feet land, measured down from the top of the *front bar's*
 * tile — deliberately below the work surface, which is what lets the bar's front
 * face cut the body off at the waist.
 *
 * Lives here rather than with the sprite because it is a fact about the counter:
 * change the slab height and this is the number that has to follow.
 *
 * The Bopca is a dwarf and works from a step behind the bar, which is why the
 * feet land well above the cabinet's own base: standing a `0.8`-tile figure flat
 * on the galley floor leaves nothing but the toque showing over the slab.
 */
export const BOPCA_FEET_COUNTER_FRACTION = 0.6;
const COUNTER_GRAIN_STEP_FRACTION = 0.18;
/** Width of the wood edge showing on the outward face of a side return. */
const RETURN_WOOD_EDGE_FRACTION = 0.18;

// ── Back bench geometry ───────────────────────────────────────────────────────
/** Tiled backsplash above the bench, so the top of the tile is not a black band. */
const BENCH_SPLASH_TOP_FRACTION = 0.02;
const BENCH_SPLASH_BOTTOM_FRACTION = 0.36;
const BENCH_SPLASH_TILE_ROWS = 3;
const BENCH_SHELF_TOP_FRACTION = 0.3;
const BENCH_SHELF_HEIGHT_FRACTION = 0.05;
const BENCH_SHELF_INSET_FRACTION = 0.06;
const BENCH_TOP_FRACTION = 0.55;
const BENCH_SURFACE_HEIGHT_FRACTION = 0.14;
const BENCH_BODY_BOTTOM_FRACTION = 0.98;
const BENCH_CROCK_WIDTH_FRACTION = 0.16;
const BENCH_CROCK_HEIGHT_FRACTION = 0.13;
const BENCH_HOB_RADIUS_FRACTION = 0.11;
const BENCH_HOB_INNER_RADIUS_FRACTION = 0.07;
const BENCH_HOB_CENTRE_Y_FRACTION = 0.79;
/** Every third tile of a bench run carries the range rather than plain worktop. */
const BENCH_HOB_TILE_STRIDE = 3;

// ── Dish geometry ─────────────────────────────────────────────────────────────
const DISH_CENTRE_Y_FRACTION = 0.24;
const DISH_BOWL_WIDTH_FRACTION = 0.52;
const DISH_BOWL_HEIGHT_FRACTION = 0.2;
const DISH_PLATE_WIDTH_FRACTION = 0.62;
const DISH_PLATE_HEIGHT_FRACTION = 0.1;
const DISH_CONTENT_INSET_FRACTION = 0.78;
const DISH_RIM_LINE_WIDTH = 1;
const DISH_GARNISH_RADIUS_FRACTION = 0.04;
const DISH_SKEWER_STICK_WIDTH = 1;
const DISH_SKEWER_COUNT = 3;
const DISH_SKEWER_CHUNK_RADIUS_FRACTION = 0.045;
const DISH_SKEWER_CHUNKS_PER_STICK = 3;
const DISH_SKEWER_HEIGHT_FRACTION = 0.3;
const DISH_WEDGE_WIDTH_FRACTION = 0.4;
const DISH_WEDGE_HEIGHT_FRACTION = 0.26;
const DISH_MUG_WIDTH_FRACTION = 0.3;
const DISH_MUG_HEIGHT_FRACTION = 0.28;
const DISH_MUG_HANDLE_RADIUS_FRACTION = 0.08;
const DISH_SHADOW_WIDTH_FRACTION = 0.6;
const DISH_SHADOW_HEIGHT_FRACTION = 0.06;

// ── Steam ─────────────────────────────────────────────────────────────────────
const STEAM_WISP_COUNT = 3;
const STEAM_RISE_FRACTION = 0.5;
const STEAM_WISP_RADIUS_FRACTION = 0.05;
const STEAM_WISP_SPREAD_FRACTION = 0.11;
const STEAM_SWAY_FRACTION = 0.05;
const STEAM_SWAY_RATE = 2.4;
const STEAM_CYCLE_SECONDS = 1.6;
const STEAM_MAX_ALPHA = 0.42;

// Palette. Warm oiled oak against the safe room's cream floor, with a cold
// grey-green work surface so the food reads as the only saturated thing there.
const COUNTER_SURFACE = '#8d9188';
const COUNTER_SURFACE_LIGHT = '#a8aca1';
const COUNTER_SURFACE_LIP = '#6e7269';
const COUNTER_WOOD = '#6b452a';
const COUNTER_WOOD_DARK = '#4e3220';
const COUNTER_GRAIN = 'rgba(0,0,0,0.14)';
const COUNTER_TOE_SHADOW = 'rgba(0,0,0,0.28)';
const BENCH_IRON = '#464339';
const BENCH_IRON_LIGHT = '#4d4a43';
const BENCH_WORKTOP = '#7d8178';
const BENCH_SHELF_WOOD = '#5a3b24';
const BENCH_SPLASH = '#6d7a70';
const BENCH_SPLASH_GROUT = 'rgba(40,48,44,0.5)';
const HOB_RING = '#2a2724';
const HOB_EMBER = 'rgba(226,122,44,0.75)';
const CROCK_COLORS = ['#9c6b3f', '#7d8b6a', '#8e5c52'] as const;
const DISH_SHADOW = 'rgba(0,0,0,0.22)';
const STEAM_COLOR = '255,250,240';
/** Grey the vessel and contents drift toward once a dish has gone cold. */
const COLD_DISH_GREY = '#8b8b86';
const COLD_DISH_MIX = 0.55;

/**
 * How a served dish is presented. Lives beside the renderer that draws it so
 * the dish table can be pure data and depend only on the art, not the reverse.
 */
export type DishShape = 'bowl' | 'plate' | 'skewer' | 'wedge' | 'mug';

export interface DishVisual {
  shape: DishShape;
  /** Bowl, plate, mug or board the food is served on. */
  vesselColor: string;
  contentColor: string;
  /** A herb, a curl of dripping, a crumb of cheese — omit for plain dishes. */
  garnishColor?: string;
}

/** How a dish is drawn right now: its recipe, plus how long it has been sitting. */
export interface ServedDishRender {
  visual: DishVisual;
  /** 0 at the moment of serving, 1 once the dish has fully gone cold. */
  coldness: number;
  /** Seconds since serving, for the steam and bob cycles. */
  elapsedSeconds: number;
}

/** Edge awareness for a counter tile: which neighbours continue the same run. */
export function counterEdges(
  structure: ReadonlyArray<ReadonlyArray<{ type: number }>>,
  type: number,
  tx: number,
  ty: number,
): CounterEdges {
  return {
    left: structure[ty]?.[tx - 1]?.type === type,
    right: structure[ty]?.[tx + 1]?.type === type,
    up: structure[ty - 1]?.[tx]?.type === type,
    down: structure[ty + 1]?.[tx]?.type === type,
  };
}

/**
 * The occluding part of the front bar: panelled cabinet face and stone slab.
 *
 * Called twice per frame for the tiles a Bopca stands behind — once from the
 * tile renderer, once after the Bopca is drawn — so the bar genuinely covers
 * the body instead of the body floating in front of it.
 */
export function drawCounterFrontFace(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  edges: CounterEdges,
): void {
  // A tile with a counter above or below it and *neither* horizontal neighbour is
  // the run's side return — the leg that seals the galley against the wall. Drawn
  // as the counter seen from above rather than from the front: given the
  // front-bar treatment it read as a spare cabinet standing loose in the kitchen.
  //
  // `!left && !right`, not `!(left && right)`: an end tile of the front bar has
  // the return directly above it *and* one horizontal neighbour, so the looser
  // test claimed it too and every counter in the game lost both of its end caps.
  const isSideReturn = (edges.up || edges.down) && !edges.left && !edges.right;
  if (isSideReturn) {
    drawCounterReturn(ctx, sx, sy, ts);
    return;
  }

  const cabinetTop = sy + ts * COUNTER_CABINET_TOP_FRACTION;
  const cabinetBottom = sy + ts * COUNTER_CABINET_BOTTOM_FRACTION;
  const cabinetHeight = cabinetBottom - cabinetTop;

  ctx.fillStyle = COUNTER_WOOD;
  ctx.fillRect(sx, cabinetTop, ts, cabinetHeight);
  ctx.fillStyle = COUNTER_TOE_SHADOW;
  ctx.fillRect(sx, cabinetBottom, ts, ts * COUNTER_TOE_SHADOW_HEIGHT_FRACTION);

  // Vertical stiles only where the run ends, so the middle reads as continuous.
  const stileWidth = Math.max(1, Math.round(ts * COUNTER_STILE_WIDTH_FRACTION));
  ctx.fillStyle = COUNTER_WOOD_DARK;
  if (!edges.left) ctx.fillRect(sx, cabinetTop, stileWidth, cabinetHeight);
  if (!edges.right) ctx.fillRect(sx + ts - stileWidth, cabinetTop, stileWidth, cabinetHeight);

  const panelLeft = sx + (edges.left ? 0 : ts * COUNTER_PANEL_INSET_FRACTION);
  const panelRight = sx + ts - (edges.right ? 0 : ts * COUNTER_PANEL_INSET_FRACTION);
  const panelTop = cabinetTop + ts * COUNTER_PANEL_TOP_INSET_FRACTION;
  const panelBottom = cabinetBottom - ts * COUNTER_PANEL_BOTTOM_INSET_FRACTION;
  ctx.fillStyle = COUNTER_WOOD_DARK;
  ctx.fillRect(panelLeft, panelTop, panelRight - panelLeft, panelBottom - panelTop);
  ctx.fillStyle = COUNTER_GRAIN;
  for (let y = panelTop; y < panelBottom; y += ts * COUNTER_GRAIN_STEP_FRACTION) {
    ctx.fillRect(panelLeft, y, panelRight - panelLeft, 1);
  }

  // Stone slab. It oversails the cabinet at an open end so the run has a nose.
  const oversail = ts * COUNTER_END_OVERSAIL_FRACTION;
  const slabLeft = sx - (edges.left ? 0 : oversail);
  const slabRight = sx + ts + (edges.right ? 0 : oversail);
  const slabTop = sy + ts * COUNTER_SURFACE_TOP_FRACTION;
  const slabHeight = ts * COUNTER_SURFACE_HEIGHT_FRACTION;
  ctx.fillStyle = COUNTER_SURFACE;
  ctx.fillRect(slabLeft, slabTop, slabRight - slabLeft, slabHeight);
  ctx.fillStyle = COUNTER_SURFACE_LIGHT;
  ctx.fillRect(slabLeft, slabTop, slabRight - slabLeft, 1);
  ctx.fillStyle = COUNTER_SURFACE_LIP;
  ctx.fillRect(
    slabLeft,
    slabTop + slabHeight - ts * COUNTER_SURFACE_LIP_HEIGHT_FRACTION,
    slabRight - slabLeft,
    ts * COUNTER_SURFACE_LIP_HEIGHT_FRACTION,
  );
}

/**
 * The run's side return: the short leg that turns off the front bar and closes
 * the galley against the wall.
 *
 * Wood-dominant panelling rather than the bar's stone slab. An earlier pass drew
 * it as slab-across-the-tile and the two returns read as a pair of grey pillars
 * standing loose in the kitchen; as joinery they read as what they are, the end
 * of the counter.
 */
function drawCounterReturn(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = COUNTER_WOOD;
  ctx.fillRect(sx, sy, ts, ts);

  const edgeWidth = ts * RETURN_WOOD_EDGE_FRACTION;
  ctx.fillStyle = COUNTER_WOOD_DARK;
  ctx.fillRect(sx + edgeWidth, sy, ts - edgeWidth * 2, ts);
  ctx.fillStyle = COUNTER_GRAIN;
  for (let y = sy; y < sy + ts; y += ts * COUNTER_GRAIN_STEP_FRACTION) {
    ctx.fillRect(sx + edgeWidth, y, ts - edgeWidth * 2, 1);
  }

  // Stone caps down both vertical edges, so the bar's work surface visibly turns
  // the corner instead of stopping dead. Both sides rather than only the galley
  // side, because which side the galley is on is not knowable from counter
  // neighbours alone — and a return is symmetrical joinery anyway.
  ctx.fillStyle = COUNTER_SURFACE;
  ctx.fillRect(sx, sy, edgeWidth, ts);
  ctx.fillRect(sx + ts - edgeWidth, sy, edgeWidth, ts);
  ctx.fillStyle = COUNTER_SURFACE_LIGHT;
  ctx.fillRect(sx, sy, 1, ts);
  ctx.fillRect(sx + ts - 1, sy, 1, ts);
}

/** The Bopca's back bench: worktop, open shelf, and a range on every third tile. */
export function drawCounterBackTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  edges: CounterEdges,
  tx: number,
): void {
  const splashTop = sy + ts * BENCH_SPLASH_TOP_FRACTION;
  const splashBottom = sy + ts * BENCH_SPLASH_BOTTOM_FRACTION;
  const benchTop = sy + ts * BENCH_TOP_FRACTION;
  const benchBottom = sy + ts * BENCH_BODY_BOTTOM_FRACTION;

  // Glazed backsplash. Without it the top third of the tile was a flat black
  // band that read as a hole in the wall rather than the back of a kitchen.
  ctx.fillStyle = BENCH_SPLASH;
  ctx.fillRect(sx, splashTop, ts, splashBottom - splashTop);
  ctx.strokeStyle = BENCH_SPLASH_GROUT;
  ctx.lineWidth = 1;
  for (let row = 1; row < BENCH_SPLASH_TILE_ROWS; row++) {
    const rowY = splashTop + ((splashBottom - splashTop) * row) / BENCH_SPLASH_TILE_ROWS;
    ctx.beginPath();
    ctx.moveTo(sx, rowY);
    ctx.lineTo(sx + ts, rowY);
    ctx.stroke();
  }

  ctx.fillStyle = BENCH_IRON;
  ctx.fillRect(sx, benchTop, ts, benchBottom - benchTop);
  ctx.fillStyle = BENCH_WORKTOP;
  ctx.fillRect(sx, benchTop, ts, ts * BENCH_SURFACE_HEIGHT_FRACTION);
  ctx.fillStyle = BENCH_IRON_LIGHT;
  ctx.fillRect(sx, benchTop + ts * BENCH_SURFACE_HEIGHT_FRACTION, ts, 1);

  // Open shelf across the backsplash, with a crock standing on it. Both stay
  // inside the tile: the row above is the room's wall, drawn earlier in the same
  // pass, so anything reaching past the top edge would paint over it.
  const crockHeight = ts * BENCH_CROCK_HEIGHT_FRACTION;
  const shelfTop = sy + ts * BENCH_SHELF_TOP_FRACTION;
  const shelfInset = edges.left || edges.right ? 0 : ts * BENCH_SHELF_INSET_FRACTION;
  const crockWidth = ts * BENCH_CROCK_WIDTH_FRACTION;
  ctx.fillStyle = CROCK_COLORS[Math.abs(tx) % CROCK_COLORS.length];
  ctx.fillRect(sx + ts / 2 - crockWidth / 2, shelfTop - crockHeight, crockWidth, crockHeight);
  ctx.fillStyle = BENCH_SHELF_WOOD;
  ctx.fillRect(sx + shelfInset, shelfTop, ts - shelfInset * 2, ts * BENCH_SHELF_HEIGHT_FRACTION);

  const carriesRange = Math.abs(tx) % BENCH_HOB_TILE_STRIDE === 0;
  if (carriesRange) {
    const hobX = sx + ts / 2;
    const hobY = sy + ts * BENCH_HOB_CENTRE_Y_FRACTION;
    ctx.fillStyle = HOB_RING;
    ctx.beginPath();
    ctx.arc(hobX, hobY, ts * BENCH_HOB_RADIUS_FRACTION, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HOB_EMBER;
    ctx.beginPath();
    ctx.arc(hobX, hobY, ts * BENCH_HOB_INNER_RADIUS_FRACTION, 0, Math.PI * 2);
    ctx.fill();
  }
}

const HEX_RADIX = 16;
const HEX_PAIR_LENGTH = 2;
const HEX_CHANNEL_COUNT = 3;

/** Parse `#rrggbb` into its three channels. */
function hexChannels(hex: string): [number, number, number] {
  const digits = hex.replace('#', '');
  const channels: number[] = [];
  for (let i = 0; i < HEX_CHANNEL_COUNT; i++) {
    channels.push(
      parseInt(digits.slice(i * HEX_PAIR_LENGTH, (i + 1) * HEX_PAIR_LENGTH), HEX_RADIX),
    );
  }
  return [channels[0], channels[1], channels[2]];
}

/**
 * Blend `color` toward the cold-dish grey by `amount` (0 = untouched).
 *
 * Mixed numerically rather than handed to CSS `color-mix()`: the dish colours
 * are ours and always `#rrggbb`, and this runs inside the render loop where a
 * string the canvas has to re-parse every frame is the more expensive option.
 */
function chilled(color: string, amount: number): string {
  if (amount <= 0) return color;
  const [r, g, b] = hexChannels(color);
  const [cr, cg, cb] = hexChannels(COLD_DISH_GREY);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * amount);
  return `rgb(${mix(r, cr)},${mix(g, cg)},${mix(b, cb)})`;
}

/**
 * A dish sitting on the counter: vessel, contents, garnish, shadow and steam.
 *
 * `sx`/`sy` are the top-left of the counter tile it was set down on; the dish
 * is drawn on the slab, not centred in the tile.
 */
export function drawServedDish(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  dish: ServedDishRender,
): void {
  const { visual, coldness, elapsedSeconds } = dish;
  const chill = coldness * COLD_DISH_MIX;
  const vessel = chilled(visual.vesselColor, chill);
  const content = chilled(visual.contentColor, chill);
  const centreX = sx + ts / 2;
  const restY = sy + ts * DISH_CENTRE_Y_FRACTION;

  ctx.fillStyle = DISH_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    restY,
    (ts * DISH_SHADOW_WIDTH_FRACTION) / 2,
    (ts * DISH_SHADOW_HEIGHT_FRACTION) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  switch (visual.shape) {
    case 'bowl':
      drawBowl(ctx, centreX, restY, ts, vessel, content, visual.garnishColor);
      break;
    case 'plate':
      drawPlate(ctx, centreX, restY, ts, vessel, content, visual.garnishColor);
      break;
    case 'skewer':
      drawSkewers(ctx, centreX, restY, ts, vessel, content);
      break;
    case 'wedge':
      drawWedge(ctx, centreX, restY, ts, vessel, content, visual.garnishColor);
      break;
    case 'mug':
      drawMug(ctx, centreX, restY, ts, vessel, content);
      break;
  }

  const steamAlpha = (1 - coldness) * STEAM_MAX_ALPHA;
  if (steamAlpha > 0) {
    drawDishSteam(ctx, centreX, restY, ts, elapsedSeconds, steamAlpha);
  }
}

function drawBowl(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  vessel: string,
  content: string,
  garnish: string | undefined,
): void {
  const width = ts * DISH_BOWL_WIDTH_FRACTION;
  const height = ts * DISH_BOWL_HEIGHT_FRACTION;
  const top = baseY - height;

  ctx.fillStyle = vessel;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, top);
  ctx.quadraticCurveTo(cx, baseY + height / 2, cx + width / 2, top);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = content;
  ctx.beginPath();
  ctx.ellipse(cx, top, (width * DISH_CONTENT_INSET_FRACTION) / 2, height / 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = vessel;
  ctx.lineWidth = DISH_RIM_LINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(cx, top, width / 2, height / 3, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (garnish !== undefined) {
    ctx.fillStyle = garnish;
    ctx.beginPath();
    ctx.arc(cx, top, ts * DISH_GARNISH_RADIUS_FRACTION, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  vessel: string,
  content: string,
  garnish: string | undefined,
): void {
  const width = ts * DISH_PLATE_WIDTH_FRACTION;
  const height = ts * DISH_PLATE_HEIGHT_FRACTION;

  ctx.fillStyle = vessel;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = content;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    baseY - height,
    (width * DISH_CONTENT_INSET_FRACTION) / 2,
    height / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  if (garnish !== undefined) {
    ctx.fillStyle = garnish;
    ctx.beginPath();
    ctx.arc(cx, baseY - height, ts * DISH_GARNISH_RADIUS_FRACTION, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSkewers(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  vessel: string,
  content: string,
): void {
  const height = ts * DISH_SKEWER_HEIGHT_FRACTION;
  const spread = ts * DISH_PLATE_WIDTH_FRACTION;
  for (let i = 0; i < DISH_SKEWER_COUNT; i++) {
    const offset = (i / (DISH_SKEWER_COUNT - 1) - 0.5) * spread;
    const stickX = cx + offset;
    ctx.fillStyle = vessel;
    ctx.fillRect(stickX, baseY - height, DISH_SKEWER_STICK_WIDTH, height);
    ctx.fillStyle = content;
    for (let c = 0; c < DISH_SKEWER_CHUNKS_PER_STICK; c++) {
      const chunkY = baseY - height + (height / DISH_SKEWER_CHUNKS_PER_STICK) * (c + 0.5);
      ctx.beginPath();
      ctx.arc(stickX, chunkY, ts * DISH_SKEWER_CHUNK_RADIUS_FRACTION, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWedge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  vessel: string,
  content: string,
  garnish: string | undefined,
): void {
  const width = ts * DISH_WEDGE_WIDTH_FRACTION;
  const height = ts * DISH_WEDGE_HEIGHT_FRACTION;

  ctx.fillStyle = vessel;
  ctx.fillRect(cx - width / 2, baseY - 1, width, 2);

  ctx.fillStyle = content;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, baseY);
  ctx.lineTo(cx + width / 2, baseY);
  ctx.lineTo(cx - width / 2, baseY - height);
  ctx.closePath();
  ctx.fill();

  if (garnish !== undefined) {
    ctx.fillStyle = garnish;
    ctx.fillRect(cx - width / 2, baseY - height, width / 3, 1);
  }
}

function drawMug(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  vessel: string,
  content: string,
): void {
  const width = ts * DISH_MUG_WIDTH_FRACTION;
  const height = ts * DISH_MUG_HEIGHT_FRACTION;
  const top = baseY - height;

  ctx.strokeStyle = vessel;
  ctx.lineWidth = DISH_RIM_LINE_WIDTH;
  ctx.beginPath();
  ctx.arc(
    cx + width / 2,
    top + height / 2,
    ts * DISH_MUG_HANDLE_RADIUS_FRACTION,
    -Math.PI / 2,
    Math.PI / 2,
  );
  ctx.stroke();

  ctx.fillStyle = vessel;
  ctx.fillRect(cx - width / 2, top, width, height);
  ctx.fillStyle = content;
  ctx.beginPath();
  ctx.ellipse(cx, top, (width * DISH_CONTENT_INSET_FRACTION) / 2, height / 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Wisps rising off a hot dish. Shared with the cook animation's stove steam,
 * which is the same effect anchored on the back bench instead.
 */
export function drawDishSteam(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  elapsedSeconds: number,
  alpha: number,
): void {
  ctx.save();
  for (let i = 0; i < STEAM_WISP_COUNT; i++) {
    const phase = (elapsedSeconds / STEAM_CYCLE_SECONDS + i / STEAM_WISP_COUNT) % 1;
    const rise = phase * ts * STEAM_RISE_FRACTION;
    const sway = Math.sin((elapsedSeconds + i) * STEAM_SWAY_RATE) * ts * STEAM_SWAY_FRACTION;
    const spread = (i / (STEAM_WISP_COUNT - 1) - 0.5) * ts * STEAM_WISP_SPREAD_FRACTION;
    // Each wisp fades in as it leaves the dish and out again near the top, so
    // no wisp ever pops into or out of existence mid-air.
    const fade = Math.sin(phase * Math.PI);
    ctx.fillStyle = `rgba(${STEAM_COLOR},${alpha * fade})`;
    ctx.beginPath();
    ctx.arc(
      cx + spread + sway,
      baseY - rise,
      ts * STEAM_WISP_RADIUS_FRACTION * (1 + phase),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}
