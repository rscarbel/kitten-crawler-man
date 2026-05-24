// src/sprites/environmentSprites.ts
// High-quality sprite drawing functions for environment/building tiles.
// Used by scripts/generateSprites.ts to produce PNG sheets.
// Convention: (ctx, sx, sy, s) — (sx,sy) = tile-origin (top-left of tile cell), s = tile size (64).

type Ctx = CanvasRenderingContext2D;

// ─── Stone coursing ───────────────────────────────────────────────────────────
const STONE_BLOCKS_PER_ROW = 3;
const STONE_STAGGER_RATIO = 0.55;

// ─── Thatch texture ───────────────────────────────────────────────────────────
const THATCH_BAND_HEIGHT = 4;
const THATCH_BRIGHT_R = 210;
const THATCH_DARK_R = 188;
const THATCH_BRIGHT_G = 155;
const THATCH_DARK_G = 132;
const THATCH_FIBER_B = 18;
const THATCH_FIBER_R = 55;
const THATCH_FIBER_G = 28;
const THATCH_FIBER_ALPHA = 0.28;
const THATCH_FIBER_STRIDE = 9;

// ─── Slate texture ────────────────────────────────────────────────────────────
const SLATE_TILE_HEIGHT = 6;
const SLATE_TILE_WIDTH = 16;
const SLATE_BASE_LIGHTNESS = 96;
const SLATE_LIGHTNESS_STRIDE = 3;
const SLATE_LIGHTNESS_MOD = 7;
const SLATE_BLUE_TINT_LOW = 1.04;
const SLATE_BLUE_TINT_HIGH = 1.15;
const SLATE_GROOVE_ALPHA_BASE = 0.28;
const SLATE_GROOVE_ALPHA_MIN = 0.05;

// ─── Terracotta texture ───────────────────────────────────────────────────────
const TERRA_TILE_HEIGHT = 8;
const TERRA_TILE_WIDTH = 12;
const TERRA_BASE_R = 196;
const TERRA_BASE_G = 72;
const TERRA_VARIATION_R = 6;
const TERRA_VARIATION_G = 4;
const TERRA_VARIATION_PERIOD = 3;
const TERRA_HIGHLIGHT_ADD = 18;
const TERRA_LIT_CLAMP = 255;
const TERRA_SHADE_R = 0.78;
const TERRA_SHADE_G = 0.7;
const TERRA_BASE_B = 30;
const TERRA_SHADE_B = 18;

// ─── Arched window layout ─────────────────────────────────────────────────────
const WIN_WIDTH_RATIO = 0.44;
const WIN_HEIGHT_RATIO = 0.32;
const WIN_TOP_RATIO = 0.18;

// Cottage window details
const WIN_SURROUND_INSET = 3;
const WIN_SURROUND_EXTRA_W = 6;
const WIN_KEYSTONE_HALF = 3;
const WIN_MUNTIN_LEFT = 0.33;
const WIN_MUNTIN_RIGHT = 0.67;
const WIN_MUNTIN_MID_V = 0.38;
const WIN_MUNTIN_MID_LOW = 0.72;
const WIN_GLINT_WIDTH = 0.24;
const WIN_SILL_INSET = 5;
const WIN_SILL_EXTRA_W = 10;
const WIN_SILL_HEIGHT = 5;
const WIN_SILL_SHADOW_Y = 6;

// Tower window details
const WIN_TOWER_MULLION_MID = 0.45;
const WIN_TOWER_GLINT_WIDTH = 0.2;

// Merchant window details
const WIN_SHUTTER_INSET = 5;
const WIN_SHUTTER_WIDTH = 4;
const WIN_SHUTTER_SLAT_STRIDE = 4;
const WIN_SHUTTER_SLAT_H = 2;
const WIN_MERCHANT_GLINT = 0.28;
const WIN_MERCHANT_SILL_HEIGHT = 4;
const WIN_FLOWER_BOX_HEIGHT = 4;
const WIN_FLOWER_STRIDE = 6;
const WIN_FLOWER_SIZE = 2;
const WIN_FLOWER_RED_X = 2;
const WIN_FLOWER_RED_W = 3;
const WIN_FLOWER_YELLOW_W = 3;
const WIN_FLOWER_PINK_W = 3;
const WIN_FLOWER_PINK_OFFSET = 5;

// ─── Cottage facade ───────────────────────────────────────────────────────────
const COTTAGE_TEXTURE_Y_STRIDE = 3;
const COTTAGE_TEXTURE_X_STRIDE = 5;
const COTTAGE_TEXTURE_X_MULT = 11;
const COTTAGE_TEXTURE_Y_MULT = 7;
const COTTAGE_TEXTURE_MOD = 9;
const COTTAGE_TEXTURE_SHIFT = 4;
const COTTAGE_TEXTURE_SCALE = 0.009;
const COTTAGE_TEXTURE_PATCH_W = 3;
const COTTAGE_FOUNDATION_Y = 16;
const COTTAGE_FOUNDATION_H = 14;
const COTTAGE_FOUNDATION_BLOCK_H = 6;
const COTTAGE_WALL_TOP = 18;
const COTTAGE_RAIL_RATIO = 0.4;
const COTTAGE_LEFT_POST_RATIO = 0.26;
const COTTAGE_RIGHT_POST_RATIO = 0.68;
const COTTAGE_BEAM_WIDTH = 3;
const COTTAGE_POST_INSET = 16;
const COTTAGE_BRACE_RATIO = 0.08;
const COTTAGE_CORNICE_H = 3;

// ─── Tower facade ─────────────────────────────────────────────────────────────
const TOWER_STONE_BLOCK_H = 8;
const TOWER_TEXTURE_STRIDE = 8;
const TOWER_CORNICE_H = 4;
const TOWER_BRACKET_W = 8;
const TOWER_BRACKET_H = 6;
const TOWER_BRACKET_HIGHLIGHT_H = 2;

// ─── Merchant facade ──────────────────────────────────────────────────────────
const MERCHANT_TEXTURE_Y_STRIDE = 4;
const MERCHANT_TEXTURE_X_STRIDE = 6;
const MERCHANT_TEXTURE_X_MULT = 7;
const MERCHANT_TEXTURE_Y_MULT = 13;
const MERCHANT_TEXTURE_MOD = 7;
const MERCHANT_TEXTURE_SHIFT = 3;
const MERCHANT_TEXTURE_SCALE = 0.011;
const MERCHANT_TEXTURE_PATCH_W = 4;
const MERCHANT_TEXTURE_PATCH_H = 2;
const MERCHANT_MOLDING_TOP_RATIO = 0.15;
const MERCHANT_MOLDING_H = 3;
const MERCHANT_MOLDING_BOTTOM_INSET = 8;
const MERCHANT_FOUNDATION_Y = 14;
const MERCHANT_FOUNDATION_H = 12;
const MERCHANT_FOUNDATION_BLOCK_H = 5;
const MERCHANT_CORNICE_H = 3;

// ─── Stone wall facade ────────────────────────────────────────────────────────
const STONE_WALL_BLOCK_H = 9;
const STONE_WIN_WIDTH_RATIO = 0.4;
const STONE_WIN_HEIGHT_RATIO = 0.28;
const STONE_WIN_TOP_RATIO = 0.2;
const STONE_WIN_INSET = 4;
const STONE_WIN_SILL_H = 4;
const STONE_CORNICE_H = 3;

// ─── Circus wall facade ───────────────────────────────────────────────────────
const CIRCUS_STRIPE_MIN_W = 6;
const CIRCUS_STRIPE_RATIO = 0.26;
const CIRCUS_CANVAS_STRIDE = 3;
const CIRCUS_GOLD_TRIM_H = 3;
const CIRCUS_GOLD_TRIM_BOTTOM_INSET = 4;
const CIRCUS_ROPE_DETAIL_X_RATIO = 0.5;
const CIRCUS_ROPE_DETAIL_INSET = 4;
const CIRCUS_ROPE_DETAIL_INSET_ENDS = 8;

// ─── Metal wall ───────────────────────────────────────────────────────────────
const METAL_PANEL_PAD = 3;
const METAL_RIVET_INSET_NEAR = 5;
const METAL_RIVET_INSET_FAR = 6;
const METAL_RIVET_RADIUS = 2.5;
const METAL_RIVET_HIGHLIGHT_OFFSET = 0.7;
const METAL_RIVET_HIGHLIGHT_RADIUS = 1.0;
const METAL_LIT_EDGE_H = 2;

// ─── Gable roof ───────────────────────────────────────────────────────────────
const GABLE_HEIGHT_TILES = 2.0;
const GABLE_TEXTURE_STRIDE = 4;
const GABLE_TEXTURE_ALT_STRIDE = 8;
const GABLE_RIDGE_CAP_W = 4;
const GABLE_RIDGE_CAP_H = 6;
const GABLE_RIDGE_INSET = 2;
const GABLE_EAVE_H = 3;
const GABLE_SHADOW_H = 2;

// ─── Thatch roof eaves ────────────────────────────────────────────────────────
const THATCH_EAVES_LIGHTNESS = 0.92;
const THATCH_EAVES_SHADOW_H = 7;
const THATCH_EAVES_BAND_RATIO = 0.45;
const THATCH_DRIP_BASE_INSET = 6;
const THATCH_DRIP_BASE_H = 3;
const THATCH_DRIP_CAP_H = 2;
const THATCH_DRIP_CAP_INSET = 4;
const THATCH_STRAW_STRIDE = 5;

// ─── Thatch roof middle ───────────────────────────────────────────────────────
const THATCH_MID_LIGHTNESS = 0.8;
const THATCH_RIDGE_RATIO = 0.44;
const THATCH_RIDGE_DARK_PRE = 4;
const THATCH_RIDGE_DARK_POST = 4;
const THATCH_RIDGE_POST_OFFSET = 3;
const THATCH_RIDGE_BRIGHT_H = 3;
const THATCH_CHIMNEY_X_RATIO = 0.5;
const THATCH_CHIMNEY_Y_RATIO = 0.22;
const THATCH_CHIMNEY_W = 9;
const THATCH_CHIMNEY_H = 12;
const THATCH_CHIMNEY_DARK_SIDE_X = 7;
const THATCH_CHIMNEY_DARK_SIDE_H = 11;
const THATCH_CHIMNEY_CAP_W = 11;
const THATCH_CHIMNEY_CAP_H = 3;
const THATCH_CHIMNEY_OFFSET = 4;
const THATCH_SMOKE_1_RADIUS = 3.5;
const THATCH_SMOKE_2_RADIUS = 2.5;
const THATCH_SMOKE_2_X = 6;
const THATCH_SMOKE_2_Y = 8;

// ─── Thatch roof back ─────────────────────────────────────────────────────────
const THATCH_BACK_LIGHTNESS = 0.45;

// ─── Slate roof eaves ─────────────────────────────────────────────────────────
const SLATE_EAVES_LIGHTNESS = 0.88;
const SLATE_EAVES_SHADOW_H = 6;
const SLATE_EAVES_SHEEN_RATIO = 0.42;
const SLATE_GUTTER_INSET = 5;
const SLATE_GUTTER_H = 4;

// ─── Slate roof middle ────────────────────────────────────────────────────────
const SLATE_MID_LIGHTNESS = 0.78;
const SLATE_RIDGE_RATIO = 0.45;
const SLATE_RIDGE_DARK_H = 4;
const SLATE_RIDGE_POST_OFFSET = 3;
const SLATE_RIDGE_BRIGHT_H = 3;
const SLATE_CHIMNEY_X_RATIO = 0.42;
const SLATE_CHIMNEY_Y_RATIO = 0.18;
const SLATE_CHIMNEY_W = 12;
const SLATE_CHIMNEY_H = 15;
const SLATE_BRICK_COURSE_1 = 4;
const SLATE_BRICK_COURSE_2 = 8;
const SLATE_BRICK_COURSE_3 = 12;
const SLATE_CHIMNEY_DARK_X = 10;
const SLATE_CHIMNEY_DARK_H = 14;
const SLATE_CHIMNEY_CAP_W = 14;
const SLATE_CHIMNEY_CAP_H = 3;

// ─── Slate roof back ──────────────────────────────────────────────────────────
const SLATE_BACK_LIGHTNESS = 0.4;

// ─── Red (terracotta) roof eaves ──────────────────────────────────────────────
const RED_EAVES_LIGHTNESS = 0.9;
const RED_EAVES_SHADOW_H = 6;
const RED_EAVES_GLOW_RATIO = 0.45;
const RED_GUTTER_INSET = 5;
const RED_GUTTER_H = 4;

// ─── Red roof middle ──────────────────────────────────────────────────────────
const RED_MID_LIGHTNESS = 0.8;
const RED_RIDGE_RATIO = 0.44;
const RED_RIDGE_DARK_H = 4;
const RED_RIDGE_POST_OFFSET = 3;
const RED_RIDGE_BRIGHT_H = 3;
const RED_CHIMNEY_X_RATIO = 0.52;
const RED_CHIMNEY_Y_RATIO = 0.2;
const RED_CHIMNEY_W = 10;
const RED_CHIMNEY_H = 12;
const RED_CHIMNEY_DARK_X = 8;
const RED_CHIMNEY_DARK_H = 11;
const RED_CHIMNEY_CAP_W = 12;
const RED_CHIMNEY_CAP_H = 3;
const RED_SMOKE_RADIUS = 3;
const RED_SMOKE_Y = 4;
const RED_SMOKE_X = 5;

// ─── Red roof back ────────────────────────────────────────────────────────────
const RED_BACK_LIGHTNESS = 0.42;

// ─── Green roof eaves ─────────────────────────────────────────────────────────
const GREEN_EAVES_SHADOW_H = 6;
const GREEN_EAVES_BLOB_1_X = 0.35;
const GREEN_EAVES_BLOB_1_Y = 0.55;
const GREEN_EAVES_BLOB_1_R = 0.22;
const GREEN_EAVES_BLOB_2_X = 0.68;
const GREEN_EAVES_BLOB_2_Y = 0.42;
const GREEN_EAVES_BLOB_2_R = 0.18;
const GREEN_FRINGE_STRIDE = 6;
const GREEN_FRINGE_LONG = 8;
const GREEN_FRINGE_SHORT = 5;
const GREEN_EAVES_SHEEN_RATIO = 0.45;

// ─── Green roof middle ────────────────────────────────────────────────────────
const GREEN_MID_BLOB_1_X = 0.3;
const GREEN_MID_BLOB_1_Y = 0.45;
const GREEN_MID_BLOB_1_R = 0.25;
const GREEN_MID_BLOB_2_X = 0.72;
const GREEN_MID_BLOB_2_Y = 0.28;
const GREEN_MID_BLOB_2_R = 0.2;
const GREEN_MID_RIDGE_RATIO = 0.46;
const GREEN_MID_RIDGE_DARK_H = 4;
const GREEN_MID_RIDGE_POST_OFFSET = 3;
const GREEN_MID_RIDGE_BRIGHT_H = 3;

// ─── Circus roof eaves ────────────────────────────────────────────────────────
const CIRCUS_EAVE_MIN_STRIPE = 5;
const CIRCUS_EAVE_SHADOW_H = 5;
const CIRCUS_SCALLOP_STRIDE = 8;
const CIRCUS_SCALLOP_RADIUS = 4;
const CIRCUS_EAVE_SHEEN_RATIO = 0.5;

// ─── Circus roof middle ───────────────────────────────────────────────────────
const CIRCUS_MID_RIDGE_RATIO = 0.45;
const CIRCUS_MID_RIDGE_SHADOW_PRE = 3;
const CIRCUS_MID_RIDGE_BRIGHT_H = 3;
const CIRCUS_MID_RIDGE_POST = 3;
const CIRCUS_POLE_X_RATIO = 0.5;
const CIRCUS_POLE_Y_RATIO = 0.08;
const CIRCUS_POLE_ARM_W = 3;
const CIRCUS_FINIAL_RADIUS = 4;
const CIRCUS_FINIAL_HIGHLIGHT_OFFSET = 1;
const CIRCUS_FINIAL_HIGHLIGHT_R = 1.5;

// ─── Circus roof back ─────────────────────────────────────────────────────────
const CIRCUS_BACK_MIN_STRIPE = 5;

// ─── Tree ─────────────────────────────────────────────────────────────────────
const TREE_TRUNK_W_RATIO = 0.16;
const TREE_TRUNK_H_RATIO = 0.38;
const TREE_CANOPY_Y_RATIO = 0.28;
const TREE_CANOPY_R_RATIO = 0.39;
const TREE_SHADOW_OFFSET = 3;
const TREE_SHADOW_V_SQUEEZE = 0.82;
const TREE_FOLIAGE_GRAD_INNER = 0.2;
const TREE_FOLIAGE_GRAD_INNER_RADIUS = 0.1;
const TREE_FOLIAGE_GRAD_MID = 0.7;
const TREE_FOLIAGE_OUTER_RATIO = 0.95;
const TREE_LOBE_UPPER_X = 0.25;
const TREE_LOBE_UPPER_Y = 0.3;
const TREE_LOBE_UPPER_R = 0.58;
const TREE_LOBE_RIGHT_X = 0.3;
const TREE_LOBE_RIGHT_Y = 0.1;
const TREE_LOBE_RIGHT_R = 0.44;
const TREE_HIGHLIGHT_X = 0.3;
const TREE_HIGHLIGHT_Y = 0.38;
const TREE_HIGHLIGHT_R = 0.32;
const TREE_TIP_Y = 0.44;
const TREE_TIP_R = 0.16;
const TREE_LEAF_BUMPS = 8;
const TREE_LEAF_BUMP_R = 0.12;
const TREE_BARK_STRIDE = 7;
const TREE_TRUNK_INSET = 4; // used for subtracting from start/end of bark texture

// ─── Torch ────────────────────────────────────────────────────────────────────
const TORCH_BRACKET_ABOVE_RATIO = 0.35;
const TORCH_BRACKET_H_RATIO = 0.55;
const TORCH_ANCHOR_W = 10;
const TORCH_ANCHOR_H = 6;
const TORCH_ARM_W = 4;
const TORCH_ARM_INSET_TOP = 3;
const TORCH_ARM_INSET_BOTTOM = 8;
const TORCH_BOWL_RADIUS = 7;
const TORCH_BOWL_HIGHLIGHT_OFFSET = 1;
const TORCH_BOWL_HIGHLIGHT_R = 2.5;
const TORCH_BOWL_INSET = 12;
const TORCH_SOOT_RADIUS = 6;
const TORCH_FLAME_ABOVE = 4;
const TORCH_GLOW_BASE = 18;
const TORCH_GLOW_FLICKER = 4;
const TORCH_GLOW_ALPHA_BASE = 0.22;
const TORCH_GLOW_ALPHA_FLICKER = 0.06;
const TORCH_GLOW_ABOVE = 8;
const TORCH_FLAME_SPREAD = 0.5;
const TORCH_FLAME_H_BASE = 14;
const TORCH_FLAME_H_FLICKER = 3;
const TORCH_FLICKER_X_AMPLITUDE = 2;
const TORCH_MID_FLAME_RATIO = 0.72;
const TORCH_OUTER_BEZIER_W = 7;
const TORCH_MID_BEZIER_W = 4;
const TORCH_INNER_BEZIER_W = 3;
const TORCH_FLICKER_SCALE_MID = 0.6;
const TORCH_CORE_X_RATIO = 0.3;
const TORCH_CORE_ELLIPSE_W = 2.5;
const TORCH_CORE_ELLIPSE_H = 5;
const TORCH_SMOKE_COUNT = 2;
const TORCH_SMOKE_PHASE_OFFSET = 1.5;
const TORCH_SMOKE_AMPLITUDE = 4;
const TORCH_SMOKE_INSET = 4;
const TORCH_SMOKE_STRIDE = 6;
const TORCH_SMOKE_BASE_R = 3;
const TORCH_SMOKE_ALPHA_BASE = 0.18;
const TORCH_SMOKE_ALPHA_DECAY = 0.06;

// ─── Well ─────────────────────────────────────────────────────────────────────
const WELL_CENTER_Y_RATIO = 0.58;
const WELL_SHAFT_R_RATIO = 0.24;
const WELL_COPING_GRAD_MID = 0.6;
const WELL_COPING_GRAD_OUTER = 0.8;
const WELL_SHAFT_COURSE_H = 6;
const WELL_DEPTH_HOLE_W = 0.7;
const WELL_DEPTH_HOLE_H = 0.5;
const WELL_WATER_Y_OFFSET = 3;
const WELL_WATER_ELLIPSE_W = 0.5;
const WELL_WATER_ELLIPSE_H = 0.32;
const WELL_SHIMMER_X_OFFSET = 3;
const WELL_SHIMMER_Y_OFFSET = 4;
const WELL_SHIMMER_W = 0.2;
const WELL_SHIMMER_H = 0.1;
const WELL_BEAM_ABOVE_RATIO = 0.2;
const WELL_POST_1_X_RATIO = 0.22;
const WELL_POST_2_X_RATIO = 0.72;
const WELL_POST_W = 6;
const WELL_POST_EXTRA_H = 8;
const WELL_POST_GRAIN_STRIDE = 5;
const WELL_BEAM_H = 8;
const WELL_PULLEY_ABOVE = 4;
const WELL_PULLEY_R = 5;
const WELL_PULLEY_HIGHLIGHT_OFFSET = 1;
const WELL_PULLEY_HIGHLIGHT_R = 2;
const WELL_ROPE_DASH = 3;
const WELL_ROPE_GAP = 2;
const WELL_ROPE_X_OFFSET = 3;
const WELL_BUCKET_ABOVE_SHAFT = 10;
const WELL_BUCKET_X_OFFSET = 2;
const WELL_BUCKET_W = 10;
const WELL_BUCKET_H = 8;
const WELL_BUCKET_DARK_BOTTOM_Y = 7;
const WELL_BUCKET_DARK_RIGHT_X = 4;
const WELL_BUCKET_DARK_RIGHT_H = 6;
const WELL_BUCKET_BAND_Y1 = 2;
const WELL_BUCKET_BAND_Y2 = 5;
const WELL_BUCKET_HANDLE_R = 4;

// ─── Fountain ────────────────────────────────────────────────────────────────
const FOUNTAIN_BASIN_R_RATIO = 0.4;
const FOUNTAIN_RIM_STONE_STRIDE = 0.42;
const FOUNTAIN_RIM_STONE_ALT_STRIDE = 0.84;
const FOUNTAIN_RIM_STONE_R_FACTOR = 0.85;
const FOUNTAIN_RIM_STONE_SIZE = 3;
const FOUNTAIN_RIM_STONE_W = 6;
const FOUNTAIN_RIM_STONE_H = 5;
const FOUNTAIN_RIM_ARC_START = 0.9;
const FOUNTAIN_RIM_ARC_END = 0.1;
const FOUNTAIN_RIM_LINE_W = 3;
const FOUNTAIN_WATER_INSET = 5;
const FOUNTAIN_SHIMMER_GRAD_INNER = 0.3;
const FOUNTAIN_SHIMMER_GRAD_MID = 0.3;

// ─── Grassy weed ──────────────────────────────────────────────────────────────

// ─── Dirt patch ───────────────────────────────────────────────────────────────

// ─── Green roof texture parameters ───────────────────────────────────────────
const GREEN_TEX_LIGHTNESS_THRESHOLD = 0.5;

// ─── Hip roof corner lightness values ────────────────────────────────────────

// ─── Hip side slope ───────────────────────────────────────────────────────────

// ─── Gable end / ridge end ────────────────────────────────────────────────────

// ─── Roof valley ──────────────────────────────────────────────────────────────

// ─── Flat roof ────────────────────────────────────────────────────────────────

// ─── Circus tent peak ─────────────────────────────────────────────────────────

// ─── Circus tent slope ────────────────────────────────────────────────────────

// ─── Circus tent corner ───────────────────────────────────────────────────────

// ─── Circus tent scallop ─────────────────────────────────────────────────────

function tbGrad(
  ctx: Ctx,
  sx: number,
  sy: number,
  h: number,
  c0: string,
  c1: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(sx, sy, sx, sy + h);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

function lrGrad(
  ctx: Ctx,
  sx: number,
  sy: number,
  w: number,
  c0: string,
  c1: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(sx, sy, sx + w, sy);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

/** Offset stone-block coursing. phase shifts the stagger row parity. */
function stoneCourses(
  ctx: Ctx,
  sx: number,
  sy: number,
  w: number,
  h: number,
  blockH: number,
  colors: [string, string, string],
  mortar: string,
  phase = 0,
): void {
  const bw = Math.floor(w / STONE_BLOCKS_PER_ROW);
  const rows = Math.ceil(h / blockH);
  for (let r = 0; r < rows; r++) {
    const ry = sy + r * blockH;
    const rh = Math.min(blockH - 1, sy + h - ry);
    if (rh <= 0) continue;
    const shift = (r + phase) % 2 === 0 ? 0 : Math.round(bw * STONE_STAGGER_RATIO);
    for (let c = -1; c <= STONE_BLOCKS_PER_ROW; c++) {
      const bx0 = sx + c * bw - shift;
      const bx1 = bx0 + bw;
      const cx0 = Math.max(sx, bx0 + 1);
      const cx1 = Math.min(sx + w, bx1 - 1);
      if (cx1 <= cx0) continue;
      ctx.fillStyle = colors[Math.abs((c + r * 2 + phase) % STONE_BLOCKS_PER_ROW)];
      ctx.fillRect(cx0, ry, cx1 - cx0, rh);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(Math.min(cx1 - 1, sx + w - 1), ry, 1, rh);
    }
    if (ry + rh < sy + h) {
      ctx.fillStyle = mortar;
      ctx.fillRect(sx, ry + rh, w, 1);
    }
  }
}

/** Horizontal straw bands for thatch. lightness 0→1 goes dark→bright. */
function thatchTexture(
  ctx: Ctx,
  sx: number,
  sy: number,
  w: number,
  h: number,
  lightness: number,
): void {
  const bandH = THATCH_BAND_HEIGHT;
  const bands = Math.ceil(h / bandH);
  for (let b = 0; b < bands; b++) {
    const by = sy + b * bandH;
    const bh = Math.min(bandH, sy + h - by);
    if (bh <= 0) continue;
    const bright = b % 2 === 0;
    const R = Math.round((bright ? THATCH_BRIGHT_R : THATCH_DARK_R) * lightness);
    const G = Math.round((bright ? THATCH_BRIGHT_G : THATCH_DARK_G) * lightness);
    const B = Math.round(THATCH_FIBER_B * lightness);
    ctx.fillStyle = `rgb(${R},${G},${B})`;
    ctx.fillRect(sx, by, w, bh);
    // Straw fiber line
    ctx.fillStyle = `rgba(${Math.round(THATCH_FIBER_R * lightness)},${Math.round(THATCH_FIBER_G * lightness)},0,${THATCH_FIBER_ALPHA})`;
    ctx.fillRect(sx + ((b * THATCH_FIBER_STRIDE) % Math.max(1, w)), by, 1, bh);
  }
}

/** Staggered slate tiles. lightness 0→1. */
function slateTexture(
  ctx: Ctx,
  sx: number,
  sy: number,
  w: number,
  h: number,
  lightness: number,
): void {
  const tH = SLATE_TILE_HEIGHT;
  const tW = SLATE_TILE_WIDTH;
  const rows = Math.ceil(h / tH);
  for (let r = 0; r < rows; r++) {
    const ry = sy + r * tH;
    const rh = Math.min(tH - 1, sy + h - ry);
    if (rh <= 0) continue;
    const stagger = r % 2 === 0 ? 0 : Math.floor(tW / 2);
    for (let tx = sx - stagger; tx < sx + w + tW; tx += tW) {
      const cx0 = Math.max(sx, tx + 1);
      const cx1 = Math.min(sx + w, tx + tW - 1);
      if (cx1 <= cx0) continue;
      const L = Math.round(
        (SLATE_BASE_LIGHTNESS + ((tx + r * SLATE_LIGHTNESS_STRIDE) % SLATE_LIGHTNESS_MOD) * 2) *
          lightness,
      );
      ctx.fillStyle = `rgb(${L},${Math.round(L * SLATE_BLUE_TINT_LOW)},${Math.round(L * SLATE_BLUE_TINT_HIGH)})`;
      ctx.fillRect(cx0, ry, cx1 - cx0, rh);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(cx0, ry + Math.max(0, rh - 1), cx1 - cx0, 1);
    }
    ctx.fillStyle = `rgba(0,0,0,${(SLATE_GROOVE_ALPHA_BASE * lightness + SLATE_GROOVE_ALPHA_MIN).toFixed(2)})`;
    ctx.fillRect(sx, ry + rh, w, 1);
  }
}

/** Staggered terracotta curved tiles. lightness 0→1. */
function terracottaTexture(
  ctx: Ctx,
  sx: number,
  sy: number,
  w: number,
  h: number,
  lightness: number,
): void {
  const tH = TERRA_TILE_HEIGHT;
  const tW = TERRA_TILE_WIDTH;
  const rows = Math.ceil(h / tH);
  for (let r = 0; r < rows; r++) {
    const ry = sy + r * tH;
    const rh = Math.min(tH - 1, sy + h - ry);
    if (rh <= 0) continue;
    const stagger = r % 2 === 0 ? 0 : Math.floor(tW / 2);
    const baseR = Math.round(
      (TERRA_BASE_R + (r % TERRA_VARIATION_PERIOD) * TERRA_VARIATION_R) * lightness,
    );
    const baseG = Math.round(
      (TERRA_BASE_G + (r % TERRA_VARIATION_PERIOD) * TERRA_VARIATION_G) * lightness,
    );
    const g = ctx.createLinearGradient(sx, ry, sx, ry + rh);
    g.addColorStop(
      0,
      `rgb(${Math.min(TERRA_LIT_CLAMP, baseR + TERRA_HIGHLIGHT_ADD)},${Math.min(TERRA_LIT_CLAMP, baseG + TERRA_HIGHLIGHT_ADD)},${TERRA_BASE_B})`,
    );
    g.addColorStop(
      1,
      `rgb(${Math.round(baseR * TERRA_SHADE_R)},${Math.round(baseG * TERRA_SHADE_G)},${TERRA_SHADE_B})`,
    );
    ctx.fillStyle = g;
    ctx.fillRect(sx, ry, w, rh);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let tx = sx - stagger; tx < sx + w + tW; tx += tW) {
      if (tx > sx) ctx.fillRect(Math.max(sx, tx), ry, 1, rh);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(sx, ry + rh, w, 1);
  }
}

type WindowStyle = 'cottage' | 'tower' | 'merchant';

function archedWindow(ctx: Ctx, sx: number, sy: number, s: number, style: WindowStyle): void {
  const ww = Math.floor(s * WIN_WIDTH_RATIO);
  const wh = Math.floor(s * WIN_HEIGHT_RATIO);
  const wx = sx + Math.floor((s - ww) / 2);
  const wy = sy + Math.floor(s * WIN_TOP_RATIO);
  const archR = Math.floor(ww / 2);

  if (style === 'cottage') {
    // Stone arch surround
    ctx.fillStyle = '#3e2010';
    ctx.fillRect(wx - WIN_SURROUND_INSET, wy, ww + WIN_SURROUND_EXTRA_W, wh + 2);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR + WIN_SURROUND_INSET, Math.PI, 0);
    ctx.fill();
    // Glass — warm blue-grey
    ctx.fillStyle = '#8bbccc';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR, Math.PI, 0);
    ctx.fill();
    // Warm candle-glow overlay
    ctx.fillStyle = 'rgba(255,190,70,0.28)';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR, Math.PI, 0);
    ctx.fill();
    // Lead muntins
    ctx.fillStyle = '#3a1e08';
    ctx.fillRect(wx + Math.floor(ww * WIN_MUNTIN_LEFT), wy - archR, 1, wh + archR);
    ctx.fillRect(wx + Math.floor(ww * WIN_MUNTIN_RIGHT), wy - archR, 1, wh + archR);
    ctx.fillRect(wx, wy + Math.floor(wh * WIN_MUNTIN_MID_V), ww, 1);
    ctx.fillRect(wx, wy + Math.floor(wh * WIN_MUNTIN_MID_LOW), ww, 1);
    // Highlight glint
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillRect(wx + 2, wy + 2, Math.floor(ww * WIN_GLINT_WIDTH), 1);
    // Stone sill with deep shadow
    ctx.fillStyle = '#c8a870';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + 2, ww + WIN_SILL_EXTRA_W, WIN_SILL_HEIGHT);
    ctx.fillStyle = '#a07848';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + WIN_SILL_SHADOW_Y, ww + WIN_SILL_EXTRA_W, 1);
    ctx.fillStyle = '#e0c898';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + 2, ww + WIN_SILL_EXTRA_W, 1);
  } else if (style === 'tower') {
    // Cut-stone arch
    ctx.fillStyle = '#747068';
    ctx.fillRect(wx - WIN_SURROUND_INSET, wy, ww + WIN_SURROUND_EXTRA_W, wh + 2);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR + WIN_SURROUND_INSET, Math.PI, 0);
    ctx.fill();
    // Keystone
    ctx.fillStyle = '#5c5852';
    ctx.fillRect(wx + archR - WIN_KEYSTONE_HALF, wy - archR, WIN_SURROUND_EXTRA_W, archR + 2);
    // Dark stained glass
    ctx.fillStyle = '#4a6878';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,210,255,0.12)';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.arc(wx + archR, wy, archR, Math.PI, 0);
    ctx.fill();
    // Stone mullion
    ctx.fillStyle = '#888480';
    ctx.fillRect(wx + archR - 1, wy, 2, wh);
    ctx.fillRect(wx, wy + Math.floor(wh * WIN_TOWER_MULLION_MID), ww, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(wx + 2, wy + 2, Math.floor(ww * WIN_TOWER_GLINT_WIDTH), 1);
    // Stone sill
    ctx.fillStyle = '#929088';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + 2, ww + WIN_SILL_EXTRA_W, WIN_SILL_HEIGHT);
    ctx.fillStyle = '#b8b4b0';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + 2, ww + WIN_SILL_EXTRA_W, 1);
    ctx.fillStyle = '#5a5852';
    ctx.fillRect(wx - WIN_SILL_INSET, wy + wh + WIN_SILL_SHADOW_Y, ww + WIN_SILL_EXTRA_W, 1);
  } else {
    // Merchant: shuttered window with flower box
    ctx.fillStyle = '#4a2412';
    ctx.fillRect(wx - WIN_SHUTTER_INSET, wy - 2, WIN_SHUTTER_WIDTH, wh + WIN_SHUTTER_WIDTH);
    ctx.fillRect(wx + ww + 1, wy - 2, WIN_SHUTTER_WIDTH, wh + WIN_SHUTTER_WIDTH);
    // Shutter slats
    ctx.fillStyle = '#6a3820';
    for (let sl = wy; sl < wy + wh; sl += WIN_SHUTTER_SLAT_STRIDE) {
      ctx.fillRect(wx - WIN_SHUTTER_INSET, sl + 1, WIN_SHUTTER_WIDTH, WIN_SHUTTER_SLAT_H);
      ctx.fillRect(wx + ww + 1, sl + 1, WIN_SHUTTER_WIDTH, WIN_SHUTTER_SLAT_H);
    }
    // Frame
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
    // Glass
    ctx.fillStyle = '#b0cce0';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(255,200,80,0.22)';
    ctx.fillRect(wx, wy, ww, wh);
    // Mullion cross
    ctx.fillStyle = '#7898a8';
    ctx.fillRect(wx + Math.floor(ww / 2), wy, 2, wh);
    ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(wx + 2, wy + 2, Math.floor(ww * WIN_MERCHANT_GLINT), 1);
    // Sill
    ctx.fillStyle = '#c49060';
    ctx.fillRect(wx - 2, wy + wh + 2, ww + WIN_SHUTTER_WIDTH, WIN_MERCHANT_SILL_HEIGHT);
    ctx.fillStyle = '#e0b880';
    ctx.fillRect(wx - 2, wy + wh + 2, ww + WIN_SHUTTER_WIDTH, 1);
    // Flower box
    ctx.fillStyle = '#4a2810';
    ctx.fillRect(
      wx - 2,
      wy + wh + WIN_SILL_SHADOW_Y,
      ww + WIN_SHUTTER_WIDTH,
      WIN_FLOWER_BOX_HEIGHT,
    );
    ctx.fillStyle = '#3a6820';
    for (let fi = wx; fi < wx + ww; fi += WIN_FLOWER_STRIDE) {
      ctx.fillRect(fi + 1, wy + wh + 7, WIN_FLOWER_SIZE, WIN_FLOWER_SIZE);
    }
    ctx.fillStyle = '#e04848';
    ctx.fillRect(
      wx + WIN_FLOWER_RED_X,
      wy + wh + WIN_SILL_SHADOW_Y,
      WIN_FLOWER_RED_W,
      WIN_FLOWER_SIZE,
    );
    ctx.fillStyle = '#e8b020';
    ctx.fillRect(
      wx + Math.floor(ww / 2) - 1,
      wy + wh + WIN_SILL_SHADOW_Y,
      WIN_FLOWER_YELLOW_W,
      WIN_FLOWER_SIZE,
    );
    ctx.fillStyle = '#e040a0';
    ctx.fillRect(
      wx + ww - WIN_FLOWER_PINK_OFFSET,
      wy + wh + WIN_SILL_SHADOW_Y,
      WIN_FLOWER_PINK_W,
      WIN_FLOWER_SIZE,
    );
  }
}

export function drawCottageWallFacade(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  hasWindow: boolean,
): void {
  // Plaster — warm ivory with gradient depth
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#f5e8c8', '#dfd0a0');
  ctx.fillRect(sx, sy, s, s);
  // Subtle plaster texture
  for (let y = 0; y < s; y += COTTAGE_TEXTURE_Y_STRIDE) {
    for (let x = 0; x < s; x += COTTAGE_TEXTURE_X_STRIDE) {
      const v =
        (((x * COTTAGE_TEXTURE_X_MULT + y * COTTAGE_TEXTURE_Y_MULT) % COTTAGE_TEXTURE_MOD) -
          COTTAGE_TEXTURE_SHIFT) *
        COTTAGE_TEXTURE_SCALE;
      ctx.fillStyle =
        v > 0 ? `rgba(255,245,200,${v.toFixed(3)})` : `rgba(0,0,0,${(-v).toFixed(3)})`;
      ctx.fillRect(sx + x, sy + y, COTTAGE_TEXTURE_PATCH_W, 1);
    }
  }
  // Stone foundation strip
  stoneCourses(
    ctx,
    sx,
    sy + s - COTTAGE_FOUNDATION_Y,
    s,
    COTTAGE_FOUNDATION_H,
    COTTAGE_FOUNDATION_BLOCK_H,
    ['#9a8c78', '#8a7c68', '#b0a088'],
    '#5e5448',
    0,
  );
  // Cover plaster over foundation overlap cleanly
  ctx.fillStyle = tbGrad(ctx, sx, sy, s - COTTAGE_WALL_TOP, '#f5e8c8', '#dfd0a0');
  ctx.fillRect(sx, sy, s, s - COTTAGE_WALL_TOP);

  // Half-timber frame — dark oak
  const beamColor = '#2c1406';
  ctx.fillStyle = beamColor;
  const midY = sy + Math.floor(s * COTTAGE_RAIL_RATIO);
  const lbx = sx + Math.floor(s * COTTAGE_LEFT_POST_RATIO);
  const rbx = sx + Math.floor(s * COTTAGE_RIGHT_POST_RATIO);
  // Horizontal rail
  ctx.fillRect(sx, midY, s, COTTAGE_BEAM_WIDTH);
  // Vertical posts
  ctx.fillRect(lbx, sy, COTTAGE_BEAM_WIDTH, s - COTTAGE_POST_INSET);
  ctx.fillRect(rbx, sy, COTTAGE_BEAM_WIDTH, s - COTTAGE_POST_INSET);
  // Diagonal brace in right panel (bottom-left to top-right)
  ctx.strokeStyle = beamColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rbx + COTTAGE_BEAM_WIDTH, midY + COTTAGE_BEAM_WIDTH);
  ctx.lineTo(sx + s - 1, sy + Math.floor(s * COTTAGE_BRACE_RATIO));
  ctx.stroke();
  // Diagonal brace in left panel (top-left to bottom-right)
  ctx.beginPath();
  ctx.moveTo(sx, sy + Math.floor(s * COTTAGE_BRACE_RATIO));
  ctx.lineTo(lbx, midY);
  ctx.stroke();
  // Subtle oak grain on posts
  ctx.fillStyle = 'rgba(100,50,10,0.2)';
  ctx.fillRect(lbx + 1, sy, 1, s - COTTAGE_POST_INSET);
  ctx.fillRect(rbx + 1, sy, 1, s - COTTAGE_POST_INSET);

  // Window in center panel
  if (hasWindow) archedWindow(ctx, sx, sy, s, 'cottage');

  // Cornice highlight at top (roof edge meeting wall)
  ctx.fillStyle = '#fff8e0';
  ctx.fillRect(sx, sy, s, COTTAGE_CORNICE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(sx, sy + COTTAGE_CORNICE_H, s, 1);
}

export function drawTowerWallFacade(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  hasWindow: boolean,
): void {
  // Dressed stone — cool grey with variation
  stoneCourses(
    ctx,
    sx,
    sy,
    s,
    s,
    TOWER_STONE_BLOCK_H,
    ['#b8b4b0', '#a8a4a0', '#c0bcb8'],
    '#707068',
    0,
  );
  // Slight cool ambient shade top→bottom
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, 'rgba(180,200,220,0.08)', 'rgba(0,0,0,0.12)');
  ctx.fillRect(sx, sy, s, s);
  // Stone texture: subtle chiseled facets
  for (let y = 0; y < s; y += TOWER_TEXTURE_STRIDE) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(sx, sy + y, s, 1);
  }
  if (hasWindow) archedWindow(ctx, sx, sy, s, 'tower');
  // Lit cornice — stone header beam
  ctx.fillStyle = '#d0ccc8';
  ctx.fillRect(sx, sy, s, TOWER_CORNICE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(sx, sy + TOWER_CORNICE_H, s, 1);
  // Small corbel brackets at top corners
  ctx.fillStyle = '#909088';
  ctx.fillRect(sx, sy, TOWER_BRACKET_W, TOWER_BRACKET_H);
  ctx.fillRect(sx + s - TOWER_BRACKET_W, sy, TOWER_BRACKET_W, TOWER_BRACKET_H);
  ctx.fillStyle = '#b0aca8';
  ctx.fillRect(sx, sy, TOWER_BRACKET_W, TOWER_BRACKET_HIGHLIGHT_H);
  ctx.fillRect(sx + s - TOWER_BRACKET_W, sy, TOWER_BRACKET_W, TOWER_BRACKET_HIGHLIGHT_H);
}

export function drawMerchantWallFacade(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  hasWindow: boolean,
): void {
  // Ochre painted plaster
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#d4945c', '#c07840');
  ctx.fillRect(sx, sy, s, s);
  // Plaster texture
  for (let y = 0; y < s; y += MERCHANT_TEXTURE_Y_STRIDE) {
    for (let x = 0; x < s; x += MERCHANT_TEXTURE_X_STRIDE) {
      const v =
        (((x * MERCHANT_TEXTURE_X_MULT + y * MERCHANT_TEXTURE_Y_MULT) % MERCHANT_TEXTURE_MOD) -
          MERCHANT_TEXTURE_SHIFT) *
        MERCHANT_TEXTURE_SCALE;
      ctx.fillStyle =
        v > 0 ? `rgba(255,220,150,${v.toFixed(3)})` : `rgba(0,0,0,${(-v).toFixed(3)})`;
      ctx.fillRect(sx + x, sy + y, MERCHANT_TEXTURE_PATCH_W, MERCHANT_TEXTURE_PATCH_H);
    }
  }
  // Decorative plaster moldings (horizontal bands)
  ctx.fillStyle = '#b06838';
  ctx.fillRect(sx, sy + Math.floor(s * MERCHANT_MOLDING_TOP_RATIO), s, MERCHANT_MOLDING_H);
  ctx.fillRect(sx, sy + s - MERCHANT_MOLDING_BOTTOM_INSET, s, MERCHANT_MOLDING_H);
  ctx.fillStyle = '#e8aa70';
  ctx.fillRect(sx, sy + Math.floor(s * MERCHANT_MOLDING_TOP_RATIO), s, 1);
  ctx.fillRect(sx, sy + s - MERCHANT_MOLDING_BOTTOM_INSET, s, 1);
  // Foundation: darker stone
  stoneCourses(
    ctx,
    sx,
    sy + s - MERCHANT_FOUNDATION_Y,
    s,
    MERCHANT_FOUNDATION_H,
    MERCHANT_FOUNDATION_BLOCK_H,
    ['#7a5a38', '#8a6848', '#6a4a28'],
    '#3a2818',
    1,
  );
  if (hasWindow) archedWindow(ctx, sx, sy, s, 'merchant');
  // Cornice
  ctx.fillStyle = '#e8b880';
  ctx.fillRect(sx, sy, s, MERCHANT_CORNICE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(sx, sy + MERCHANT_CORNICE_H, s, 1);
}

export function drawStoneWallFacade(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  hasWindow: boolean,
): void {
  // Rough-hewn stone — warm grey
  stoneCourses(
    ctx,
    sx,
    sy,
    s,
    s,
    STONE_WALL_BLOCK_H,
    ['#a09888', '#908878', '#b0a898'],
    '#5a5248',
    1,
  );
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, 'rgba(200,190,170,0.06)', 'rgba(0,0,0,0.1)');
  ctx.fillRect(sx, sy, s, s);
  if (hasWindow) {
    // Simple rectangular window for generic stone
    const ww = Math.floor(s * STONE_WIN_WIDTH_RATIO);
    const wh = Math.floor(s * STONE_WIN_HEIGHT_RATIO);
    const wx = sx + Math.floor((s - ww) / 2);
    const wy = sy + Math.floor(s * STONE_WIN_TOP_RATIO);
    ctx.fillStyle = '#3a4a58';
    ctx.fillRect(wx - 2, wy - 2, ww + STONE_WIN_INSET, wh + STONE_WIN_INSET);
    ctx.fillStyle = '#5a7888';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(255,180,60,0.18)';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = '#607888';
    ctx.fillRect(wx + Math.floor(ww / 2), wy, 2, wh);
    ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 2);
    ctx.fillStyle = '#989490';
    ctx.fillRect(wx - 2, wy + wh + 2, ww + STONE_WIN_INSET, STONE_WIN_SILL_H);
  }
  ctx.fillStyle = '#c8c0b0';
  ctx.fillRect(sx, sy, s, STONE_CORNICE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(sx, sy + STONE_CORNICE_H, s, 1);
}

export function drawCircusWallFacade(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: 'red' | 'blue' | 'purple',
): void {
  const stripe = tint === 'red' ? '#cc2222' : tint === 'blue' ? '#2244aa' : '#7722aa';
  const stripe2 = '#f8f0e0';
  const gold = '#ffcc22';
  // Cream base
  ctx.fillStyle = stripe2;
  ctx.fillRect(sx, sy, s, s);
  // Bold vertical stripes
  const sw = Math.max(CIRCUS_STRIPE_MIN_W, Math.floor(s * CIRCUS_STRIPE_RATIO));
  for (let xi = 0; xi < s; xi += sw * 2) {
    ctx.fillStyle = stripe;
    ctx.fillRect(sx + xi, sy, sw, s);
  }
  // Canvas texture
  for (let y = 2; y < s; y += CIRCUS_CANVAS_STRIDE) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(sx, sy + y, s, 1);
  }
  // Gold trim band at top
  ctx.fillStyle = gold;
  ctx.fillRect(sx, sy, s, CIRCUS_GOLD_TRIM_H);
  ctx.fillStyle = 'rgba(255,255,200,0.6)';
  ctx.fillRect(sx, sy, s, 1);
  // Gold trim band at bottom
  ctx.fillStyle = gold;
  ctx.fillRect(sx, sy + s - CIRCUS_GOLD_TRIM_BOTTOM_INSET, s, CIRCUS_GOLD_TRIM_H);
  // Rope knot details
  ctx.fillStyle = 'rgba(100,60,0,0.35)';
  ctx.fillRect(
    sx + Math.floor(s * CIRCUS_ROPE_DETAIL_X_RATIO),
    sy + CIRCUS_ROPE_DETAIL_INSET,
    2,
    s - CIRCUS_ROPE_DETAIL_INSET_ENDS,
  );
}

export function drawMetalWall(ctx: Ctx, sx: number, sy: number, s: number): void {
  // Deep charcoal base
  ctx.fillStyle = '#1c2228';
  ctx.fillRect(sx, sy, s, s);
  // Panel plate (inset)
  const pad = METAL_PANEL_PAD;
  ctx.fillStyle = '#262e36';
  ctx.fillRect(sx + pad, sy + pad, s - pad * 2, s - pad * 2);
  // Steel gradient sheen
  ctx.fillStyle = lrGrad(ctx, sx, sy, s, 'rgba(80,100,120,0.12)', 'rgba(0,0,0,0.08)');
  ctx.fillRect(sx, sy, s, s);
  // Horizontal weld seam
  ctx.fillStyle = '#131619';
  ctx.fillRect(sx, sy + Math.floor(s / 2), s, 2);
  // Rivets at corners
  const rv: [number, number][] = [
    [sx + METAL_RIVET_INSET_NEAR, sy + METAL_RIVET_INSET_NEAR],
    [sx + s - METAL_RIVET_INSET_FAR, sy + METAL_RIVET_INSET_NEAR],
    [sx + METAL_RIVET_INSET_NEAR, sy + s - METAL_RIVET_INSET_FAR],
    [sx + s - METAL_RIVET_INSET_FAR, sy + s - METAL_RIVET_INSET_FAR],
  ];
  for (const [rx, ry] of rv) {
    ctx.fillStyle = '#3c454e';
    ctx.beginPath();
    ctx.arc(rx, ry, METAL_RIVET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a7880';
    ctx.beginPath();
    ctx.arc(
      rx - METAL_RIVET_HIGHLIGHT_OFFSET,
      ry - METAL_RIVET_HIGHLIGHT_OFFSET,
      METAL_RIVET_HIGHLIGHT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Lit top edge
  ctx.fillStyle = '#3e4c56';
  ctx.fillRect(sx, sy, s, METAL_LIT_EDGE_H);
  // Left-edge sheen
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(sx, sy, METAL_LIT_EDGE_H, s);
}

type GableRoofType =
  | 'thatch'
  | 'slate'
  | 'red'
  | 'green'
  | 'circus_red'
  | 'circus_blue'
  | 'circus_purple';

const GABLE_COLORS: Record<
  GableRoofType,
  { lit: string; shade: string; ridge: string; eave: string }
> = {
  thatch: { lit: '#c89840', shade: '#7a5214', ridge: '#ffe060', eave: '#907018' },
  slate: { lit: '#607888', shade: '#343e4c', ridge: '#d8eeff', eave: '#404e5e' },
  red: { lit: '#9a3c2c', shade: '#4e1412', ridge: '#ff8070', eave: '#5e1810' },
  green: { lit: '#3a6030', shade: '#1c3214', ridge: '#78b068', eave: '#1e4018' },
  circus_red: { lit: '#cc2222', shade: '#661111', ridge: '#ffdd44', eave: '#881818' },
  circus_blue: { lit: '#2244aa', shade: '#112255', ridge: '#ffcc22', eave: '#182878' },
  circus_purple: { lit: '#7722aa', shade: '#3a1155', ridge: '#ffdd44', eave: '#4a1878' },
};

export function drawBackGableWall(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  roofType: GableRoofType,
): void {
  const C = GABLE_COLORS[roofType];
  // Back wall face — shadowed dark stone
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#5c5448', '#4a4238');
  ctx.fillRect(sx, sy, s, s);
  // Rough coursing on back wall
  stoneCourses(
    ctx,
    sx,
    sy,
    s,
    s,
    TOWER_STONE_BLOCK_H,
    ['#5a524a', '#504840', '#6a6258'],
    '#3a3830',
    1,
  );
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(sx, sy, s, 1);

  // Gable triangle above the tile — extends upward
  const peakH = Math.round(s * GABLE_HEIGHT_TILES);
  const peakSX = sx + Math.floor(s / 2);

  // Left slope (lit side)
  ctx.fillStyle = C.lit;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(peakSX, sy - peakH);
  ctx.lineTo(peakSX, sy);
  ctx.closePath();
  ctx.fill();

  // Right slope (shadowed)
  ctx.fillStyle = C.shade;
  ctx.beginPath();
  ctx.moveTo(peakSX, sy);
  ctx.lineTo(peakSX, sy - peakH);
  ctx.lineTo(sx + s, sy);
  ctx.closePath();
  ctx.fill();

  // Roof texture on left slope
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(peakSX, sy - peakH);
  ctx.lineTo(peakSX, sy);
  ctx.closePath();
  ctx.clip();
  if (roofType === 'thatch' || roofType === 'slate' || roofType === 'red' || roofType === 'green') {
    for (let y = 0; y < peakH; y += GABLE_TEXTURE_STRIDE) {
      ctx.fillStyle =
        y % GABLE_TEXTURE_ALT_STRIDE === 0 ? 'rgba(255,220,100,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(sx, sy - y, s, 2);
    }
  }
  ctx.restore();

  // Ridge cap
  ctx.fillStyle = C.ridge;
  ctx.fillRect(
    peakSX - GABLE_RIDGE_INSET,
    sy - peakH - GABLE_RIDGE_INSET,
    GABLE_RIDGE_CAP_W,
    GABLE_RIDGE_CAP_H,
  );
  // Ridge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(peakSX - 1, sy - peakH - 1, 2, 1);

  // Eave shadow line at base of gable
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy - GABLE_EAVE_H, s, GABLE_EAVE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sx, sy - GABLE_SHADOW_H, s, GABLE_SHADOW_H);
}

export function drawThatchRoofEaves(ctx: Ctx, sx: number, sy: number, s: number): void {
  // Eaves row — viewer looks at the bright front face of the thatch
  thatchTexture(ctx, sx, sy, s, s, THATCH_EAVES_LIGHTNESS);
  // Heavy eave overhang shadow at very top
  ctx.fillStyle = 'rgba(30,15,0,0.58)';
  ctx.fillRect(sx, sy, s, THATCH_EAVES_SHADOW_H);
  // Subtle banding reinforcement
  ctx.fillStyle = 'rgba(255,220,80,0.12)';
  ctx.fillRect(sx, sy + THATCH_EAVES_SHADOW_H, s, Math.floor(s * THATCH_EAVES_BAND_RATIO));
  // Drip-fringe at bottom — hanging straw tips
  ctx.fillStyle = '#907018';
  ctx.fillRect(sx, sy + s - THATCH_DRIP_BASE_INSET, s, THATCH_DRIP_BASE_H);
  ctx.fillStyle = '#c09030';
  ctx.fillRect(sx, sy + s - THATCH_DRIP_CAP_INSET, s, THATCH_DRIP_CAP_H);
  // Individual straw tip drips
  ctx.fillStyle = '#a07820';
  for (let xi = sx + 2; xi < sx + s - 2; xi += THATCH_STRAW_STRIDE) {
    ctx.fillRect(xi, sy + s - 2, 1, 2);
    ctx.fillRect(xi + 2, sy + s - 1, 1, 1);
  }
}

export function drawThatchRoofMiddle(ctx: Ctx, sx: number, sy: number, s: number): void {
  thatchTexture(ctx, sx, sy, s, s, THATCH_MID_LIGHTNESS);
  // Ridge cap — thick bright bundle
  const ridgeY = sy + Math.floor(s * THATCH_RIDGE_RATIO);
  ctx.fillStyle = '#7a5210';
  ctx.fillRect(sx, ridgeY - THATCH_RIDGE_DARK_PRE, s, THATCH_RIDGE_DARK_PRE);
  ctx.fillRect(sx, ridgeY + THATCH_RIDGE_POST_OFFSET, s, THATCH_RIDGE_DARK_POST);
  ctx.fillStyle = '#ffe060';
  ctx.fillRect(sx, ridgeY, s, THATCH_RIDGE_BRIGHT_H);
  ctx.fillStyle = '#fff088';
  ctx.fillRect(sx, ridgeY, s, 1);
  // Top lit half
  ctx.fillStyle = 'rgba(255,220,80,0.10)';
  ctx.fillRect(sx, sy, s, ridgeY - sy);
  // Possible chimney (deterministic)
  const chX = sx + Math.floor(s * THATCH_CHIMNEY_X_RATIO) - THATCH_RIDGE_DARK_PRE;
  const chY = sy + Math.floor(s * THATCH_CHIMNEY_Y_RATIO);
  ctx.fillStyle = '#5a3828';
  ctx.fillRect(chX, chY, THATCH_CHIMNEY_W, THATCH_CHIMNEY_H);
  ctx.fillStyle = '#482e1c';
  ctx.fillRect(chX + THATCH_CHIMNEY_DARK_SIDE_X, chY + 1, 2, THATCH_CHIMNEY_DARK_SIDE_H);
  ctx.fillStyle = '#7a5840';
  ctx.fillRect(chX - 1, chY, THATCH_CHIMNEY_CAP_W, THATCH_CHIMNEY_CAP_H);
  ctx.fillStyle = '#9a7050';
  ctx.fillRect(chX - 1, chY, THATCH_CHIMNEY_CAP_W, 1);
  // Smoke puff
  ctx.fillStyle = 'rgba(200,200,200,0.35)';
  ctx.beginPath();
  ctx.arc(
    chX + THATCH_CHIMNEY_OFFSET,
    chY - THATCH_CHIMNEY_OFFSET,
    THATCH_SMOKE_1_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(220,220,220,0.22)';
  ctx.beginPath();
  ctx.arc(chX + THATCH_SMOKE_2_X, chY - THATCH_SMOKE_2_Y, THATCH_SMOKE_2_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

export function drawThatchRoofBack(ctx: Ctx, sx: number, sy: number, s: number): void {
  // Back slope — deep shadow, viewer sees almost the underside
  thatchTexture(ctx, sx, sy, s, s, THATCH_BACK_LIGHTNESS);
  // Dark overlay
  ctx.fillStyle = 'rgba(20,10,0,0.35)';
  ctx.fillRect(sx, sy, s, s);
  // Subtle ridge hint at top
  ctx.fillStyle = '#8a6220';
  ctx.fillRect(sx, sy, s, 2);
}

export function drawSlateRoofEaves(ctx: Ctx, sx: number, sy: number, s: number): void {
  slateTexture(ctx, sx, sy, s, s, SLATE_EAVES_LIGHTNESS);
  // Eave shadow
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(sx, sy, s, SLATE_EAVES_SHADOW_H);
  // Metallic sheen
  ctx.fillStyle = 'rgba(180,220,255,0.10)';
  ctx.fillRect(sx, sy + SLATE_EAVES_SHADOW_H, s, Math.floor(s * SLATE_EAVES_SHEEN_RATIO));
  // Lead gutter strip at bottom
  ctx.fillStyle = '#404e5e';
  ctx.fillRect(sx, sy + s - SLATE_GUTTER_INSET, s, SLATE_GUTTER_H);
  ctx.fillStyle = '#6a7890';
  ctx.fillRect(sx, sy + s - SLATE_GUTTER_INSET, s, 1);
}

export function drawSlateRoofMiddle(ctx: Ctx, sx: number, sy: number, s: number): void {
  slateTexture(ctx, sx, sy, s, s, SLATE_MID_LIGHTNESS);
  const ridgeY = sy + Math.floor(s * SLATE_RIDGE_RATIO);
  ctx.fillStyle = '#485868';
  ctx.fillRect(sx, ridgeY - SLATE_RIDGE_DARK_H, s, SLATE_RIDGE_DARK_H);
  ctx.fillRect(sx, ridgeY + SLATE_RIDGE_POST_OFFSET, s, SLATE_RIDGE_DARK_H);
  ctx.fillStyle = '#d8eeff';
  ctx.fillRect(sx, ridgeY, s, SLATE_RIDGE_BRIGHT_H);
  ctx.fillStyle = '#f0f8ff';
  ctx.fillRect(sx, ridgeY, s, 1);
  ctx.fillStyle = 'rgba(180,220,255,0.08)';
  ctx.fillRect(sx, sy, s, ridgeY - sy);
  // Chimney (brick)
  const chX = sx + Math.floor(s * SLATE_CHIMNEY_X_RATIO) - SLATE_GUTTER_INSET;
  const chY = sy + Math.floor(s * SLATE_CHIMNEY_Y_RATIO);
  ctx.fillStyle = '#886858';
  ctx.fillRect(chX, chY, SLATE_CHIMNEY_W, SLATE_CHIMNEY_H);
  // Brick courses
  ctx.fillStyle = '#706050';
  ctx.fillRect(chX, chY + SLATE_BRICK_COURSE_1, SLATE_CHIMNEY_W, 1);
  ctx.fillRect(chX, chY + SLATE_BRICK_COURSE_2, SLATE_CHIMNEY_W, 1);
  ctx.fillRect(chX, chY + SLATE_BRICK_COURSE_3, SLATE_CHIMNEY_W, 1);
  ctx.fillStyle = '#584840';
  ctx.fillRect(chX + SLATE_CHIMNEY_DARK_X, chY + 1, 2, SLATE_CHIMNEY_DARK_H);
  ctx.fillStyle = '#a09080';
  ctx.fillRect(chX - 1, chY, SLATE_CHIMNEY_CAP_W, SLATE_CHIMNEY_CAP_H);
  ctx.fillStyle = '#c0b0a0';
  ctx.fillRect(chX - 1, chY, SLATE_CHIMNEY_CAP_W, 1);
}

export function drawSlateRoofBack(ctx: Ctx, sx: number, sy: number, s: number): void {
  slateTexture(ctx, sx, sy, s, s, SLATE_BACK_LIGHTNESS);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = '#485868';
  ctx.fillRect(sx, sy, s, 2);
}

export function drawRedRoofEaves(ctx: Ctx, sx: number, sy: number, s: number): void {
  terracottaTexture(ctx, sx, sy, s, s, RED_EAVES_LIGHTNESS);
  ctx.fillStyle = 'rgba(40,0,0,0.52)';
  ctx.fillRect(sx, sy, s, RED_EAVES_SHADOW_H);
  ctx.fillStyle = 'rgba(255,140,60,0.14)';
  ctx.fillRect(sx, sy + RED_EAVES_SHADOW_H, s, Math.floor(s * RED_EAVES_GLOW_RATIO));
  ctx.fillStyle = '#5e1810';
  ctx.fillRect(sx, sy + s - RED_GUTTER_INSET, s, RED_GUTTER_H);
  ctx.fillStyle = '#b83830';
  ctx.fillRect(sx, sy + s - RED_GUTTER_INSET, s, 1);
}

export function drawRedRoofMiddle(ctx: Ctx, sx: number, sy: number, s: number): void {
  terracottaTexture(ctx, sx, sy, s, s, RED_MID_LIGHTNESS);
  const ridgeY = sy + Math.floor(s * RED_RIDGE_RATIO);
  ctx.fillStyle = '#721e18';
  ctx.fillRect(sx, ridgeY - RED_RIDGE_DARK_H, s, RED_RIDGE_DARK_H);
  ctx.fillRect(sx, ridgeY + RED_RIDGE_POST_OFFSET, s, RED_RIDGE_DARK_H);
  ctx.fillStyle = '#ff8878';
  ctx.fillRect(sx, ridgeY, s, RED_RIDGE_BRIGHT_H);
  ctx.fillStyle = '#ffb0a0';
  ctx.fillRect(sx, ridgeY, s, 1);
  ctx.fillStyle = 'rgba(255,160,80,0.14)';
  ctx.fillRect(sx, sy, s, ridgeY - sy);
  // Chimney
  const chX = sx + Math.floor(s * RED_CHIMNEY_X_RATIO) - RED_RIDGE_DARK_H;
  const chY = sy + Math.floor(s * RED_CHIMNEY_Y_RATIO);
  ctx.fillStyle = '#7a5040';
  ctx.fillRect(chX, chY, RED_CHIMNEY_W, RED_CHIMNEY_H);
  ctx.fillStyle = '#5a3020';
  ctx.fillRect(chX + RED_CHIMNEY_DARK_X, chY + 1, 2, RED_CHIMNEY_DARK_H);
  ctx.fillStyle = '#9a6050';
  ctx.fillRect(chX - 1, chY, RED_CHIMNEY_CAP_W, RED_CHIMNEY_CAP_H);
  ctx.fillStyle = '#b07060';
  ctx.fillRect(chX - 1, chY, RED_CHIMNEY_CAP_W, 1);
  ctx.fillStyle = 'rgba(200,200,200,0.30)';
  ctx.beginPath();
  ctx.arc(chX + RED_SMOKE_X, chY - RED_SMOKE_Y, RED_SMOKE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

export function drawRedRoofBack(ctx: Ctx, sx: number, sy: number, s: number): void {
  terracottaTexture(ctx, sx, sy, s, s, RED_BACK_LIGHTNESS);
  ctx.fillStyle = 'rgba(30,0,0,0.32)';
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = '#622018';
  ctx.fillRect(sx, sy, s, 2);
}

export function drawGreenRoofEaves(ctx: Ctx, sx: number, sy: number, s: number): void {
  // Moss base
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#3a6030', '#2a4c22');
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = 'rgba(0,20,0,0.52)';
  ctx.fillRect(sx, sy, s, GREEN_EAVES_SHADOW_H);
  // Moss blob patches
  ctx.fillStyle = '#2a4c22';
  ctx.beginPath();
  ctx.arc(
    sx + Math.floor(s * GREEN_EAVES_BLOB_1_X),
    sy + Math.floor(s * GREEN_EAVES_BLOB_1_Y),
    Math.floor(s * GREEN_EAVES_BLOB_1_R),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#4a7838';
  ctx.beginPath();
  ctx.arc(
    sx + Math.floor(s * GREEN_EAVES_BLOB_2_X),
    sy + Math.floor(s * GREEN_EAVES_BLOB_2_Y),
    Math.floor(s * GREEN_EAVES_BLOB_2_R),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Hanging moss fringe at bottom
  ctx.fillStyle = '#1c3c14';
  for (let xi = sx + 2; xi < sx + s - 2; xi += GREEN_FRINGE_STRIDE) {
    ctx.fillRect(xi, sy + s - GREEN_FRINGE_LONG, 1, GREEN_FRINGE_LONG);
    ctx.fillRect(xi + STONE_BLOCKS_PER_ROW, sy + s - GREEN_FRINGE_SHORT, 1, GREEN_FRINGE_SHORT);
  }
  ctx.fillStyle = 'rgba(80,160,60,0.12)';
  ctx.fillRect(sx, sy + GREEN_EAVES_SHADOW_H, s, Math.floor(s * GREEN_EAVES_SHEEN_RATIO));
}

export function drawGreenRoofMiddle(ctx: Ctx, sx: number, sy: number, s: number): void {
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#4a7040', '#3a5c30');
  ctx.fillRect(sx, sy, s, s);
  // Moss texture
  ctx.fillStyle = '#3a5c30';
  ctx.beginPath();
  ctx.arc(
    sx + Math.floor(s * GREEN_MID_BLOB_1_X),
    sy + Math.floor(s * GREEN_MID_BLOB_1_Y),
    Math.floor(s * GREEN_MID_BLOB_1_R),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#5a8c48';
  ctx.beginPath();
  ctx.arc(
    sx + Math.floor(s * GREEN_MID_BLOB_2_X),
    sy + Math.floor(s * GREEN_MID_BLOB_2_Y),
    Math.floor(s * GREEN_MID_BLOB_2_R),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  const ridgeY = sy + Math.floor(s * GREEN_MID_RIDGE_RATIO);
  ctx.fillStyle = '#1c3c14';
  ctx.fillRect(sx, ridgeY - GREEN_MID_RIDGE_DARK_H, s, GREEN_MID_RIDGE_DARK_H);
  ctx.fillRect(sx, ridgeY + GREEN_MID_RIDGE_POST_OFFSET, s, GREEN_MID_RIDGE_DARK_H);
  ctx.fillStyle = '#90d870';
  ctx.fillRect(sx, ridgeY, s, GREEN_MID_RIDGE_BRIGHT_H);
  ctx.fillStyle = '#b0f090';
  ctx.fillRect(sx, ridgeY, s, 1);
  ctx.fillStyle = 'rgba(120,200,80,0.10)';
  ctx.fillRect(sx, sy, s, ridgeY - sy);
}

export function drawGreenRoofBack(ctx: Ctx, sx: number, sy: number, s: number): void {
  ctx.fillStyle = '#1c3214';
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = '#142810';
  ctx.fillRect(sx, sy + Math.floor(s * GREEN_TEX_LIGHTNESS_THRESHOLD), s, 1);
  ctx.fillStyle = '#284824';
  ctx.fillRect(sx, sy, s, 2);
}

export function drawCircusRoofEaves(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: 'red' | 'blue' | 'purple',
): void {
  const stripe = tint === 'red' ? '#cc2222' : tint === 'blue' ? '#2244aa' : '#7722aa';
  const stripe2 = '#f8f0e0';
  const gold = '#ffcc22';
  ctx.fillStyle = stripe2;
  ctx.fillRect(sx, sy, s, s);
  const sw = Math.max(CIRCUS_EAVE_MIN_STRIPE, Math.floor(s * CIRCUS_STRIPE_RATIO));
  for (let xi = 0; xi < s; xi += sw * 2) {
    ctx.fillStyle = stripe;
    ctx.fillRect(sx + xi, sy, sw, s);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sx, sy, s, CIRCUS_EAVE_SHADOW_H);
  // Scalloped eave fringe
  ctx.fillStyle = gold;
  for (let xi = sx; xi < sx + s; xi += CIRCUS_SCALLOP_STRIDE) {
    ctx.beginPath();
    ctx.arc(xi + CIRCUS_SCALLOP_RADIUS, sy + s - 2, CIRCUS_SCALLOP_RADIUS, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,200,0.14)';
  ctx.fillRect(sx, sy + CIRCUS_EAVE_SHADOW_H, s, Math.floor(s * CIRCUS_EAVE_SHEEN_RATIO));
}

export function drawCircusRoofMiddle(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: 'red' | 'blue' | 'purple',
): void {
  const stripe = tint === 'red' ? '#cc2222' : tint === 'blue' ? '#2244aa' : '#7722aa';
  const stripe2 = '#f8f0e0';
  const gold = '#ffcc22';
  ctx.fillStyle = stripe2;
  ctx.fillRect(sx, sy, s, s);
  const sw = Math.max(CIRCUS_EAVE_MIN_STRIPE, Math.floor(s * CIRCUS_STRIPE_RATIO));
  for (let xi = 0; xi < s; xi += sw * 2) {
    ctx.fillStyle = stripe;
    ctx.fillRect(sx + xi, sy, sw, s);
  }
  const ridgeY = sy + Math.floor(s * CIRCUS_MID_RIDGE_RATIO);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(sx, ridgeY - CIRCUS_MID_RIDGE_SHADOW_PRE, s, CIRCUS_MID_RIDGE_SHADOW_PRE);
  ctx.fillRect(sx, ridgeY + CIRCUS_MID_RIDGE_POST, s, CIRCUS_MID_RIDGE_POST);
  ctx.fillStyle = gold;
  ctx.fillRect(sx, ridgeY, s, CIRCUS_MID_RIDGE_BRIGHT_H);
  ctx.fillStyle = '#fff8cc';
  ctx.fillRect(sx, ridgeY, s, 1);
  // Tent pole finial
  const px = sx + Math.floor(s * CIRCUS_POLE_X_RATIO);
  const py = sy + Math.floor(s * CIRCUS_POLE_Y_RATIO);
  ctx.fillStyle = '#4a2a0a';
  ctx.fillRect(px - 1, py, CIRCUS_POLE_ARM_W, ridgeY - py);
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(px, py, CIRCUS_FINIAL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff8cc';
  ctx.beginPath();
  ctx.arc(
    px - CIRCUS_FINIAL_HIGHLIGHT_OFFSET,
    py - CIRCUS_FINIAL_HIGHLIGHT_OFFSET,
    CIRCUS_FINIAL_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,200,0.08)';
  ctx.fillRect(sx, sy, s, ridgeY - sy);
}

export function drawCircusRoofBack(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: 'red' | 'blue' | 'purple',
): void {
  const shadow = tint === 'red' ? '#881414' : tint === 'blue' ? '#162878' : '#4a1470';
  ctx.fillStyle = shadow;
  ctx.fillRect(sx, sy, s, s);
  const sw = Math.max(CIRCUS_BACK_MIN_STRIPE, Math.floor(s * CIRCUS_STRIPE_RATIO));
  for (let xi = sw; xi < s; xi += sw * 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(sx + xi, sy, sw, s);
  }
}

export function drawTree(ctx: Ctx, sx: number, sy: number, s: number): void {
  // Trunk — brown with bark texture
  const trunkW = Math.max(CIRCUS_EAVE_MIN_STRIPE, Math.floor(s * TREE_TRUNK_W_RATIO));
  const trunkH = Math.floor(s * TREE_TRUNK_H_RATIO);
  const trunkX = sx + Math.floor((s - trunkW) / 2);
  const trunkY = sy + s - trunkH;
  ctx.fillStyle = tbGrad(ctx, trunkX, trunkY, trunkH, '#7a4820', '#4a2c10');
  ctx.fillRect(trunkX, trunkY, trunkW, trunkH);
  // Bark highlights
  ctx.fillStyle = 'rgba(160,100,40,0.45)';
  ctx.fillRect(trunkX + 1, trunkY + 2, 1, trunkH - TREE_TRUNK_INSET);
  // Bark crevices
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(trunkX + trunkW - 2, trunkY + 2, 1, trunkH - TREE_TRUNK_INSET);
  for (
    let by = trunkY + CIRCUS_EAVE_MIN_STRIPE;
    by < trunkY + trunkH - STONE_BLOCKS_PER_ROW;
    by += TREE_BARK_STRIDE
  ) {
    ctx.fillRect(trunkX, by, trunkW, 1);
  }

  // Canopy position
  const ccx = sx + Math.floor(s / 2);
  const ccy = sy + Math.floor(s * TREE_CANOPY_Y_RATIO);
  const cr = Math.floor(s * TREE_CANOPY_R_RATIO);

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(
    ccx + TREE_SHADOW_OFFSET,
    ccy + TREE_SHADOW_OFFSET,
    cr,
    cr * TREE_SHADOW_V_SQUEEZE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Deep shadow layer (bottom/back of canopy)
  ctx.fillStyle = '#1a3c12';
  ctx.beginPath();
  ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
  ctx.fill();

  // Main foliage — mid green
  const g1 = ctx.createRadialGradient(
    ccx - cr * TREE_FOLIAGE_GRAD_INNER,
    ccy - cr * TREE_FOLIAGE_GRAD_INNER,
    cr * TREE_FOLIAGE_GRAD_INNER_RADIUS,
    ccx,
    ccy,
    cr,
  );
  g1.addColorStop(0, '#4a9030');
  g1.addColorStop(TREE_FOLIAGE_GRAD_MID, '#306820');
  g1.addColorStop(1, '#1e4c14');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(ccx, ccy, cr * TREE_FOLIAGE_OUTER_RATIO, 0, Math.PI * 2);
  ctx.fill();

  // Upper canopy lobe (brighter, top-left lit)
  ctx.fillStyle = '#5aaa38';
  ctx.beginPath();
  ctx.arc(
    ccx - cr * TREE_LOBE_UPPER_X,
    ccy - cr * TREE_LOBE_UPPER_Y,
    cr * TREE_LOBE_UPPER_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Side lobe right
  ctx.fillStyle = '#3a7c24';
  ctx.beginPath();
  ctx.arc(
    ccx + cr * TREE_LOBE_RIGHT_X,
    ccy - cr * TREE_LOBE_RIGHT_Y,
    cr * TREE_LOBE_RIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Highlight cluster (sunlit crown)
  ctx.fillStyle = '#72c040';
  ctx.beginPath();
  ctx.arc(
    ccx - cr * TREE_HIGHLIGHT_X,
    ccy - cr * TREE_HIGHLIGHT_Y,
    cr * TREE_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Bright tip
  ctx.fillStyle = '#8ad854';
  ctx.beginPath();
  ctx.arc(ccx - cr * TREE_HIGHLIGHT_X, ccy - cr * TREE_TIP_Y, cr * TREE_TIP_R, 0, Math.PI * 2);
  ctx.fill();

  // Leaf cluster micro-bumps on edge (dark)
  ctx.fillStyle = '#264e18';
  for (let i = 0; i < TREE_LEAF_BUMPS; i++) {
    const angle = (i / TREE_LEAF_BUMPS) * Math.PI * 2;
    const bx = ccx + Math.cos(angle) * cr;
    const by = ccy + Math.sin(angle) * cr;
    ctx.beginPath();
    ctx.arc(bx, by, cr * TREE_LEAF_BUMP_R, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawTorch(ctx: Ctx, sx: number, sy: number, s: number, phase: number): void {
  const cx = sx + Math.floor(s / 2);

  // Iron bracket — extends above tile
  const bracketY = sy - Math.floor(s * TORCH_BRACKET_ABOVE_RATIO);
  const bracketH = Math.floor(s * TORCH_BRACKET_H_RATIO);
  // Wall anchor plate
  ctx.fillStyle = '#3a3830';
  ctx.fillRect(cx - CIRCUS_EAVE_MIN_STRIPE, bracketY, TORCH_ANCHOR_W, TORCH_ANCHOR_H);
  ctx.fillStyle = '#5a5848';
  ctx.fillRect(cx - CIRCUS_EAVE_MIN_STRIPE, bracketY, TORCH_ANCHOR_W, 1);
  // Bracket arm
  ctx.fillStyle = '#2e2c28';
  ctx.fillRect(
    cx - 2,
    bracketY + TORCH_ARM_INSET_TOP,
    TORCH_ARM_W,
    bracketH - TORCH_ARM_INSET_BOTTOM,
  );
  ctx.fillStyle = '#4a4840';
  ctx.fillRect(cx - 2, bracketY + TORCH_ARM_INSET_TOP, 1, bracketH - TORCH_ARM_INSET_BOTTOM);
  // Bowl/cradle
  const bowlY = bracketY + bracketH - TORCH_BOWL_INSET;
  ctx.fillStyle = '#2e2c28';
  ctx.beginPath();
  ctx.arc(cx, bowlY, TORCH_BOWL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a4840';
  ctx.beginPath();
  ctx.arc(
    cx - TORCH_BOWL_HIGHLIGHT_OFFSET,
    bowlY - TORCH_BOWL_HIGHLIGHT_OFFSET,
    TORCH_BOWL_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Oil/soot ring at bowl top
  ctx.fillStyle = '#1a1816';
  ctx.beginPath();
  ctx.arc(cx, bowlY, TORCH_SOOT_RADIUS, Math.PI, 0);
  ctx.fill();

  // Flame base
  const flameX = cx;
  const flameBaseY = bowlY - TORCH_FLAME_ABOVE;

  // Outer glow halo (animated)
  const glowSize = TORCH_GLOW_BASE + Math.sin(phase * Math.PI * 2) * TORCH_GLOW_FLICKER;
  ctx.save();
  ctx.globalAlpha =
    TORCH_GLOW_ALPHA_BASE + Math.sin(phase * Math.PI * 2) * TORCH_GLOW_ALPHA_FLICKER;
  const glow = ctx.createRadialGradient(
    flameX,
    flameBaseY - TORCH_GLOW_ABOVE,
    0,
    flameX,
    flameBaseY - TORCH_GLOW_ABOVE,
    glowSize,
  );
  glow.addColorStop(0, '#ffee88');
  glow.addColorStop(TORCH_FLAME_SPREAD, '#ff8800');
  glow.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(flameX, flameBaseY - TORCH_GLOW_ABOVE, glowSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner flame — teardrop shape, animated flicker
  const flameH = TORCH_FLAME_H_BASE + Math.sin(phase * Math.PI * 2 + 1) * TORCH_FLAME_H_FLICKER;
  const flickerX = Math.sin(phase * Math.PI * 4) * TORCH_FLICKER_X_AMPLITUDE;

  ctx.save();
  // Outer flame (orange)
  ctx.fillStyle = '#ff6600';
  ctx.beginPath();
  ctx.moveTo(flameX + flickerX, flameBaseY - flameH);
  ctx.bezierCurveTo(
    flameX + flickerX + TORCH_OUTER_BEZIER_W,
    flameBaseY - flameH * TORCH_FLAME_SPREAD,
    flameX + TORCH_SOOT_RADIUS,
    flameBaseY,
    flameX,
    flameBaseY,
  );
  ctx.bezierCurveTo(
    flameX - TORCH_SOOT_RADIUS,
    flameBaseY,
    flameX + flickerX - TORCH_OUTER_BEZIER_W,
    flameBaseY - flameH * TORCH_FLAME_SPREAD,
    flameX + flickerX,
    flameBaseY - flameH,
  );
  ctx.fill();

  // Mid flame (yellow)
  const mfH = flameH * TORCH_MID_FLAME_RATIO;
  ctx.fillStyle = '#ffcc00';
  ctx.beginPath();
  ctx.moveTo(flameX + flickerX * TORCH_FLICKER_SCALE_MID, flameBaseY - mfH);
  ctx.bezierCurveTo(
    flameX + flickerX * TORCH_FLICKER_SCALE_MID + TORCH_MID_BEZIER_W,
    flameBaseY - mfH * TORCH_FLAME_SPREAD,
    flameX + TORCH_INNER_BEZIER_W,
    flameBaseY,
    flameX,
    flameBaseY,
  );
  ctx.bezierCurveTo(
    flameX - TORCH_INNER_BEZIER_W,
    flameBaseY,
    flameX + flickerX * TORCH_FLICKER_SCALE_MID - TORCH_MID_BEZIER_W,
    flameBaseY - mfH * TORCH_FLAME_SPREAD,
    flameX + flickerX * TORCH_FLICKER_SCALE_MID,
    flameBaseY - mfH,
  );
  ctx.fill();

  // Core flame (white-hot)
  ctx.fillStyle = 'rgba(255,255,240,0.85)';
  ctx.beginPath();
  ctx.ellipse(
    flameX + flickerX * TORCH_CORE_X_RATIO,
    flameBaseY - flameH * TORCH_CORE_X_RATIO,
    TORCH_CORE_ELLIPSE_W,
    TORCH_CORE_ELLIPSE_H,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Smoke wisps above flame
  for (let wi = 0; wi < TORCH_SMOKE_COUNT; wi++) {
    const wox =
      Math.sin(phase * Math.PI * 2 + wi * TORCH_SMOKE_PHASE_OFFSET) * TORCH_SMOKE_AMPLITUDE;
    const wy = flameBaseY - flameH - TORCH_SMOKE_INSET - wi * TORCH_SMOKE_STRIDE;
    ctx.fillStyle = `rgba(180,180,180,${(TORCH_SMOKE_ALPHA_BASE - wi * TORCH_SMOKE_ALPHA_DECAY).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(flameX + wox, wy, TORCH_SMOKE_BASE_R + wi, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawWell(ctx: Ctx, sx: number, sy: number, s: number): void {
  const wCx = sx + Math.floor(s / 2);
  const wCy = sy + Math.floor(s * WELL_CENTER_Y_RATIO);
  const shaftR = Math.floor(s * WELL_SHAFT_R_RATIO);

  // Well shaft — stone coping ring
  ctx.fillStyle = tbGrad(ctx, wCx - shaftR, wCy - shaftR, shaftR * 2.5, '#a09888', '#787068');
  ctx.beginPath();
  ctx.arc(wCx, wCy, shaftR, 0, Math.PI * 2);
  ctx.fill();
  // Coping top face (lighter)
  const copeG = ctx.createRadialGradient(wCx, wCy, 0, wCx, wCy, shaftR);
  copeG.addColorStop(0, 'rgba(0,0,0,0.8)');
  copeG.addColorStop(WELL_COPING_GRAD_MID, '#524c44');
  copeG.addColorStop(WELL_COPING_GRAD_OUTER, '#a09888');
  copeG.addColorStop(1, '#c8c0b0');
  ctx.fillStyle = copeG;
  ctx.beginPath();
  ctx.arc(wCx, wCy, shaftR, 0, Math.PI * 2);
  ctx.fill();
  // Stone texture on coping
  stoneCourses(
    ctx,
    wCx - shaftR,
    wCy - shaftR,
    shaftR * 2,
    shaftR * 2,
    WELL_SHAFT_COURSE_H,
    ['#a09888', '#909080', '#b0a898'],
    '#6a6458',
    0,
  );
  ctx.save();
  ctx.beginPath();
  ctx.arc(wCx, wCy, shaftR, 0, Math.PI * 2);
  ctx.clip();
  stoneCourses(
    ctx,
    wCx - shaftR,
    wCy - shaftR,
    shaftR * 2,
    shaftR * 2,
    WELL_SHAFT_COURSE_H,
    ['#a09888', '#909080', '#b0a898'],
    '#6a6458',
    0,
  );
  ctx.restore();

  // Dark well depth
  ctx.fillStyle = '#180c08';
  ctx.beginPath();
  ctx.ellipse(wCx, wCy, shaftR * WELL_DEPTH_HOLE_W, shaftR * WELL_DEPTH_HOLE_H, 0, 0, Math.PI * 2);
  ctx.fill();
  // Water shimmer far below
  ctx.fillStyle = 'rgba(40,80,120,0.55)';
  ctx.beginPath();
  ctx.ellipse(
    wCx,
    wCy + WELL_WATER_Y_OFFSET,
    shaftR * WELL_WATER_ELLIPSE_W,
    shaftR * WELL_WATER_ELLIPSE_H,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(100,160,200,0.3)';
  ctx.beginPath();
  ctx.ellipse(
    wCx - WELL_SHIMMER_X_OFFSET,
    wCy + WELL_SHIMMER_Y_OFFSET,
    shaftR * WELL_SHIMMER_W,
    shaftR * WELL_SHIMMER_H,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // ABOVE TILE — wooden crossbeam structure
  const beamY = sy - Math.floor(s * WELL_BEAM_ABOVE_RATIO);
  const postH = sy - beamY;

  // Two wooden posts
  const p1x = sx + Math.floor(s * WELL_POST_1_X_RATIO);
  const p2x = sx + Math.floor(s * WELL_POST_2_X_RATIO);
  ctx.fillStyle = tbGrad(ctx, p1x, beamY, postH + WELL_POST_EXTRA_H, '#8a6030', '#5a3c18');
  ctx.fillRect(p1x, beamY, WELL_POST_W, postH + WELL_POST_EXTRA_H);
  ctx.fillStyle = tbGrad(ctx, p2x, beamY, postH + WELL_POST_EXTRA_H, '#8a6030', '#5a3c18');
  ctx.fillRect(p2x, beamY, WELL_POST_W, postH + WELL_POST_EXTRA_H);
  // Post highlights
  ctx.fillStyle = 'rgba(160,110,50,0.5)';
  ctx.fillRect(p1x + 1, beamY, 1, postH + WELL_POST_EXTRA_H);
  ctx.fillRect(p2x + 1, beamY, 1, postH + WELL_POST_EXTRA_H);
  // Post grain
  ctx.fillStyle = 'rgba(50,25,5,0.22)';
  for (let gy = beamY + STONE_BLOCKS_PER_ROW; gy < beamY + postH; gy += WELL_POST_GRAIN_STRIDE) {
    ctx.fillRect(p1x, gy, WELL_POST_W, 1);
    ctx.fillRect(p2x, gy, WELL_POST_W, 1);
  }

  // Horizontal crossbeam
  const bW = p2x + WELL_POST_W - p1x;
  ctx.fillStyle = tbGrad(ctx, p1x, beamY, WELL_BEAM_H, '#9a7040', '#6a4c20');
  ctx.fillRect(p1x, beamY, bW, WELL_BEAM_H);
  ctx.fillStyle = 'rgba(160,110,50,0.4)';
  ctx.fillRect(p1x, beamY, bW, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(p1x, beamY + WELL_BEAM_H - 1, bW, 1);

  // Pulley wheel at center
  const pulleyCx = wCx;
  const pulleyCy = beamY + WELL_PULLEY_ABOVE;
  ctx.fillStyle = '#3e3028';
  ctx.beginPath();
  ctx.arc(pulleyCx, pulleyCy, WELL_PULLEY_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6a5840';
  ctx.beginPath();
  ctx.arc(pulleyCx, pulleyCy, WELL_PULLEY_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7a6848';
  ctx.beginPath();
  ctx.arc(
    pulleyCx - WELL_PULLEY_HIGHLIGHT_OFFSET,
    pulleyCy - WELL_PULLEY_HIGHLIGHT_OFFSET,
    WELL_PULLEY_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Rope down from pulley
  ctx.strokeStyle = '#7a6428';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([WELL_ROPE_DASH, WELL_ROPE_GAP]);
  ctx.beginPath();
  ctx.moveTo(pulleyCx, pulleyCy + WELL_PULLEY_R);
  ctx.lineTo(pulleyCx + WELL_ROPE_X_OFFSET, wCy - shaftR);
  ctx.stroke();
  ctx.setLineDash([]);

  // Wooden bucket
  const bktY = wCy - shaftR - WELL_BUCKET_ABOVE_SHAFT;
  const bktX = pulleyCx + WELL_BUCKET_X_OFFSET;
  ctx.fillStyle = '#8a6030';
  ctx.fillRect(bktX - CIRCUS_EAVE_MIN_STRIPE, bktY, WELL_BUCKET_W, WELL_BUCKET_H);
  ctx.fillStyle = '#6a4820';
  ctx.fillRect(bktX - CIRCUS_EAVE_MIN_STRIPE, bktY + WELL_BUCKET_DARK_BOTTOM_Y, WELL_BUCKET_W, 1);
  ctx.fillStyle = '#5a3818';
  ctx.fillRect(bktX + WELL_BUCKET_DARK_RIGHT_X, bktY + 1, 1, WELL_BUCKET_DARK_RIGHT_H);
  // Metal bucket bands
  ctx.fillStyle = '#5a5040';
  ctx.fillRect(bktX - CIRCUS_EAVE_MIN_STRIPE, bktY + WELL_BUCKET_BAND_Y1, WELL_BUCKET_W, 1);
  ctx.fillRect(bktX - CIRCUS_EAVE_MIN_STRIPE, bktY + WELL_BUCKET_BAND_Y2, WELL_BUCKET_W, 1);
  // Bucket handle
  ctx.strokeStyle = '#5a5040';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bktX, bktY - 1, WELL_BUCKET_HANDLE_R, Math.PI, 0);
  ctx.stroke();
}

export function drawFountain(ctx: Ctx, sx: number, sy: number, s: number, phase: number): void {
  const fcx = sx + Math.floor(s / 2);
  const fcy = sy + Math.floor(s / 2);
  const basinR = Math.floor(s * FOUNTAIN_BASIN_R_RATIO);

  // Outer basin wall
  ctx.fillStyle = '#9a9688';
  ctx.beginPath();
  ctx.arc(fcx, fcy, basinR, 0, Math.PI * 2);
  ctx.fill();
  // Stone texture on basin rim
  ctx.save();
  ctx.beginPath();
  ctx.arc(fcx, fcy, basinR, 0, Math.PI * 2);
  ctx.clip();
  for (let ang = 0; ang < Math.PI * 2; ang += FOUNTAIN_RIM_STONE_STRIDE) {
    const bx = fcx + Math.cos(ang) * (basinR * FOUNTAIN_RIM_STONE_R_FACTOR);
    const by = fcy + Math.sin(ang) * (basinR * FOUNTAIN_RIM_STONE_R_FACTOR);
    ctx.fillStyle =
      ang % FOUNTAIN_RIM_STONE_ALT_STRIDE < FOUNTAIN_RIM_STONE_STRIDE
        ? 'rgba(160,150,130,0.5)'
        : 'rgba(120,115,100,0.5)';
    ctx.fillRect(
      bx - FOUNTAIN_RIM_STONE_SIZE,
      by - FOUNTAIN_RIM_STONE_SIZE,
      FOUNTAIN_RIM_STONE_W,
      FOUNTAIN_RIM_STONE_H,
    );
  }
  ctx.restore();
  // Rim highlight (top-left lit)
  ctx.save();
  ctx.beginPath();
  ctx.arc(fcx, fcy, basinR, -Math.PI * FOUNTAIN_RIM_ARC_START, -Math.PI * FOUNTAIN_RIM_ARC_END);
  ctx.lineWidth = FOUNTAIN_RIM_LINE_W;
  ctx.strokeStyle = 'rgba(220,215,200,0.7)';
  ctx.stroke();
  ctx.restore();

  // Water inside basin
  const waterR = basinR - FOUNTAIN_WATER_INSET;
  ctx.fillStyle = '#4888c0';
  ctx.beginPath();
  ctx.arc(fcx, fcy, waterR, 0, Math.PI * 2);
  ctx.fill();
  // Water shimmer gradient
  const wg = ctx.createRadialGradient(
    fcx - waterR * FOUNTAIN_SHIMMER_GRAD_INNER,
    fcy - waterR * FOUNTAIN_SHIMMER_GRAD_INNER,
    0,
    fcx,
    fcy,
    waterR,
  );
  wg.addColorStop(0, 'rgba(120,200,255,0.45)');
  wg.addColorStop(FOUNTAIN_SHIMMER_GRAD_MID, 'rgba(60,130,200,0.2)');
  wg.addColorStop(1, 'rgba(20,60,120,0.4)');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.arc(fcx, fcy, waterR, 0, Math.PI * 2);
  ctx.fill();

  // Animated ripple rings
  for (let ring = 0; ring < 3; ring++) {
    const rPhase = (phase + ring / 3) % 1;
    const rR = waterR * 0.15 + waterR * rPhase * 0.75;
    const rAlpha = (1 - rPhase) * 0.45;
    ctx.save();
    ctx.globalAlpha = rAlpha;
    ctx.strokeStyle = 'rgba(180,230,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(fcx, fcy, rR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Surface sparkle
  ctx.fillStyle = 'rgba(220,240,255,0.6)';
  const sparkPhase = phase * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(fcx - waterR * 0.3 + Math.sin(sparkPhase) * 2, fcy - waterR * 0.2, 2, 0, Math.PI * 2);
  ctx.fill();

  // Central pedestal/column
  const pedR = Math.floor(s * 0.08);
  ctx.fillStyle = '#b0a898';
  ctx.beginPath();
  ctx.arc(fcx, fcy, pedR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d0c8b8';
  ctx.beginPath();
  ctx.arc(fcx - 1, fcy - 1, pedR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // Water jet from pedestal (above tile) — animated
  const jetH = Math.floor(s * 0.3) + Math.round(Math.sin(phase * Math.PI * 2) * 3);
  for (let ji = 0; ji < 3; ji++) {
    const jAngle = (ji / 3) * Math.PI * 2;
    const jx = fcx + Math.cos(jAngle) * (s * 0.06);
    const jy = fcy + Math.sin(jAngle) * (s * 0.06);
    const jAlpha = 0.55 - ji * 0.1;
    ctx.save();
    ctx.globalAlpha = jAlpha;
    ctx.strokeStyle = '#88ccee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    const ctrlX = jx + Math.cos(jAngle) * (s * 0.08);
    const ctrlY = jy - jetH * 0.7;
    const endX = jx + Math.cos(jAngle) * (s * 0.14);
    const endY = jy - jetH + Math.sin(phase * Math.PI * 2 + ji) * 3;
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();
    ctx.restore();
  }
  // Spray droplets at top
  ctx.fillStyle = 'rgba(140,200,240,0.7)';
  for (let di = 0; di < 5; di++) {
    const dAngle = di * 1.3 + phase * Math.PI * 2;
    const dR = s * 0.06 + Math.sin(dAngle * 0.7) * s * 0.04;
    ctx.beginPath();
    ctx.arc(
      fcx + Math.cos(dAngle) * dR,
      sy - jetH * 0.8 + Math.sin(dAngle * 1.3) * 4,
      1.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

export function drawGrassyWeed(ctx: Ctx, sx: number, sy: number, s: number, variant: number): void {
  // Grass base
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, '#58c272', '#48a860');
  ctx.fillRect(sx, sy, s, s);
  // Small ground color variation patches
  for (let i = 0; i < 6; i++) {
    const px = (i * 13 + variant * 7) % s;
    const py = (i * 11 + variant * 5) % s;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(60,140,40,0.3)' : 'rgba(80,180,60,0.2)';
    ctx.beginPath();
    ctx.ellipse(sx + px, sy + py, 7 + (i % 3), 5 + (i % 2), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Weed tufts (several groups)
  const groups =
    variant === 0
      ? [
          [12, 44],
          [30, 20],
          [48, 38],
          [20, 10],
          [55, 52],
        ]
      : [
          [8, 32],
          [36, 48],
          [52, 18],
          [24, 54],
          [44, 28],
        ];
  for (const [gx, gy] of groups) {
    const bladeCount = 3 + ((gx + gy) % 3);
    for (let b = 0; b < bladeCount; b++) {
      const bx = sx + gx + (b - 1) * 3;
      const bh = 8 + ((b + (gx % 3)) % 5);
      const lean = (b - 1) * 2;
      // Blade gradient (darker base, lighter tip)
      ctx.strokeStyle = b % 2 === 0 ? '#3a7820' : '#4a9030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, sy + gy);
      ctx.quadraticCurveTo(bx + lean, sy + gy - bh / 2, bx + lean * 1.5, sy + gy - bh);
      ctx.stroke();
    }
  }
  // Occasional tiny flower
  if (variant === 0) {
    ctx.fillStyle = '#e8d020';
    ctx.beginPath();
    ctx.arc(sx + 38, sy + 18, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff5890';
    ctx.beginPath();
    ctx.arc(sx + 14, sy + 46, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#e0c820';
    ctx.beginPath();
    ctx.arc(sx + 50, sy + 30, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a050e8';
    ctx.beginPath();
    ctx.arc(sx + 28, sy + 10, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawDirtPatch(ctx: Ctx, sx: number, sy: number, s: number, variant: number): void {
  // Road base
  ctx.fillStyle = '#a8936e';
  ctx.fillRect(sx, sy, s, s);
  // Subtle dirt color variation
  const dg = ctx.createLinearGradient(sx, sy, sx + s, sy + s);
  dg.addColorStop(0, 'rgba(160,130,90,0.35)');
  dg.addColorStop(0.5, 'rgba(130,100,65,0.2)');
  dg.addColorStop(1, 'rgba(180,150,100,0.3)');
  ctx.fillStyle = dg;
  ctx.fillRect(sx, sy, s, s);
  // Pebbles
  const pebbles =
    variant === 0
      ? [
          [8, 12, 3, 2],
          [22, 6, 4, 3],
          [38, 18, 3, 2],
          [52, 8, 4, 3],
          [16, 36, 3, 2],
          [46, 42, 5, 3],
          [30, 54, 3, 2],
          [58, 28, 4, 3],
          [10, 52, 3, 2],
          [42, 60, 4, 2],
        ]
      : [
          [6, 20, 4, 3],
          [20, 44, 3, 2],
          [36, 10, 5, 3],
          [50, 32, 3, 2],
          [14, 58, 4, 3],
          [44, 54, 3, 2],
          [28, 28, 5, 3],
          [60, 48, 3, 2],
          [18, 10, 3, 2],
          [54, 18, 4, 3],
        ];
  for (const [px, py, rx, ry] of pebbles) {
    const lightness = 140 + ((px + py + variant) % 30);
    ctx.fillStyle = `rgb(${lightness},${lightness - 15},${lightness - 30})`;
    ctx.beginPath();
    ctx.ellipse(sx + px, sy + py, rx, ry, (px * 0.3) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
    // Pebble shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx + px + 1, sy + py + 1, rx, ry, (px * 0.3) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
    // Pebble highlight
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(
      sx + px - 0.5,
      sy + py - 0.5,
      rx * 0.5,
      ry * 0.4,
      (px * 0.3) % Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Faint wagon rut grooves
  ctx.fillStyle = 'rgba(80,60,30,0.14)';
  ctx.fillRect(sx + Math.floor(s * 0.28), sy, 3, s);
  ctx.fillRect(sx + Math.floor(s * 0.65), sy, 3, s);
  ctx.fillStyle = 'rgba(180,155,110,0.18)';
  ctx.fillRect(sx + Math.floor(s * 0.28) + 1, sy, 1, s);
  ctx.fillRect(sx + Math.floor(s * 0.65) + 1, sy, 1, s);
}

export type RoofStyle = 'thatch' | 'slate' | 'red' | 'green';

interface RoofPalette {
  eave: string; // front slope — brightest
  side: string; // left/right hip slopes — medium
  mid: string; // ridge / middle
  back: string; // back slope — darkest
  ridge: string; // ridge cap highlight
  valley: string; // deep shadow for valley grooves
}

const ROOF_PALETTE: Record<RoofStyle, RoofPalette> = {
  thatch: {
    eave: '#c89840',
    side: '#9a7020',
    mid: '#b08828',
    back: '#6a4e14',
    ridge: '#ffe060',
    valley: '#3a2808',
  },
  slate: {
    eave: '#627080',
    side: '#506070',
    mid: '#7a8898',
    back: '#343e4c',
    ridge: '#d8eeff',
    valley: '#181e28',
  },
  red: {
    eave: '#9a3c2c',
    side: '#7a2c20',
    mid: '#b84838',
    back: '#4e1412',
    ridge: '#ff8070',
    valley: '#200808',
  },
  green: {
    eave: '#3a6030',
    side: '#2e5028',
    mid: '#4a7040',
    back: '#1c3214',
    ridge: '#78b068',
    valley: '#0c1808',
  },
};

type TexFn = (ctx: Ctx, sx: number, sy: number, w: number, h: number, lightness: number) => void;

const ROOF_TEX: Record<RoofStyle, TexFn> = {
  thatch: thatchTexture,
  slate: slateTexture,
  red: terracottaTexture,
  green: (ctx, sx, sy, w, h, l) => {
    ctx.fillStyle = tbGrad(
      ctx,
      sx,
      sy,
      h,
      `rgba(${Math.round(74 * l)},${Math.round(130 * l)},${Math.round(54 * l)},1)`,
      `rgba(${Math.round(46 * l)},${Math.round(86 * l)},${Math.round(32 * l)},1)`,
    );
    ctx.fillRect(sx, sy, w, h);
    if (l > 0.5) {
      ctx.fillStyle = `rgba(${Math.round(100 * l)},${Math.round(180 * l)},${Math.round(70 * l)},0.22)`;
      ctx.beginPath();
      ctx.arc(sx + w * 0.35, sy + h * 0.5, w * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** Fill a triangle and apply texture inside it, clipped. */
function roofTri(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  base: string,
  tex: TexFn,
  lightness: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): void {
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.clip();
  tex(ctx, bx, by, bw, bh, lightness);
  ctx.restore();
}

// Hip corners
// All four corners use diagonal splits. The "/" diagonal is (BL→TR) = convex.
// FL: "/" diagonal — eave (SE), side (NW)
// FR: "\" diagonal — eave (SW), side (NE)
// BL: "\" diagonal — back (NE), side-back (SW)
// BR: "/" diagonal — back (NW), side-back (SE)

export function drawRoofHipCornerFL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // SE triangle — eave (front face)
  roofTri(ctx, sx, sy + s, sx + s, sy + s, sx + s, sy, C.eave, T, 0.9, sx, sy, s, s);
  // NW triangle — side slope (medium)
  roofTri(ctx, sx, sy, sx, sy + s, sx + s, sy, C.side, T, 0.65, sx, sy, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + s);
  ctx.lineTo(sx + s, sy);
  ctx.stroke();
}

export function drawRoofHipCornerFR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // SW triangle — eave
  roofTri(ctx, sx, sy, sx, sy + s, sx + s, sy + s, C.eave, T, 0.9, sx, sy, s, s);
  // NE triangle — side slope
  roofTri(ctx, sx, sy, sx + s, sy, sx + s, sy + s, C.side, T, 0.65, sx, sy, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + s, sy + s);
  ctx.stroke();
}

export function drawRoofHipCornerBL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // NE triangle — back slope (dark)
  roofTri(ctx, sx, sy, sx + s, sy, sx + s, sy + s, C.back, T, 0.4, sx, sy, s, s);
  // SW triangle — side-back (medium-dark)
  roofTri(ctx, sx, sy, sx, sy + s, sx + s, sy + s, C.side, T, 0.48, sx, sy, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + s, sy + s);
  ctx.stroke();
}

export function drawRoofHipCornerBR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // NW triangle — back slope
  roofTri(ctx, sx, sy, sx, sy + s, sx + s, sy, C.back, T, 0.4, sx, sy, s, s);
  // SE triangle — side-back
  roofTri(ctx, sx, sy + s, sx + s, sy, sx + s, sy + s, C.side, T, 0.48, sx, sy, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + s);
  ctx.lineTo(sx + s, sy);
  ctx.stroke();
}

// Hip side slopes (left / right face of roof, full tile)

export function drawRoofHipSideL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // Gradient: left edge (slightly darker) → right edge (toward ridge, brighter)
  const g = lrGrad(ctx, sx, sy, s, C.back, C.side);
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.58);
  ctx.restore();
  // Lit right edge (roof approaches ridge)
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(sx + s - 3, sy, 3, s);
}

export function drawRoofHipSideR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  const g = lrGrad(ctx, sx, sy, s, C.side, C.back);
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.58);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(sx, sy, 3, s);
}

// Gable end caps (where a gable roof terminates left or right)
// Shows the end of the eave overhang + a barge board / gable verge.

export function drawRoofGableEndL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // Full eave surface
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.9);
  ctx.restore();
  // Left edge — barge board (the fascia board at the gable end)
  ctx.fillStyle = '#3a2808';
  const bw = Math.max(3, Math.floor(s * 0.08));
  ctx.fillRect(sx, sy, bw, s);
  // Barge board shadow cast rightward
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(sx + bw, sy, 4, s);
  // Overhang edge highlight at top
  ctx.fillStyle = 'rgba(255,255,200,0.18)';
  ctx.fillRect(sx, sy, s, 2);
}

export function drawRoofGableEndR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.9);
  ctx.restore();
  const bw = Math.max(3, Math.floor(s * 0.08));
  ctx.fillStyle = '#3a2808';
  ctx.fillRect(sx + s - bw, sy, bw, s);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(sx + s - bw - 4, sy, 4, s);
  ctx.fillStyle = 'rgba(255,255,200,0.18)';
  ctx.fillRect(sx, sy, s, 2);
}

// Inner valley corners (concave junction for L/T shaped buildings)
// Two eave slopes converge into a dark shadowed groove at the inner corner.

export function drawRoofValleyFL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // Both triangles start as eave
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.88);
  ctx.restore();
  // Shadow deepens toward the NW corner (the valley groove)
  const vg = ctx.createRadialGradient(sx, sy, 0, sx, sy, s * 0.85);
  vg.addColorStop(0, C.valley);
  vg.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(sx, sy, s, s);
  // Hard shadow groove line along diagonal
  ctx.strokeStyle = C.valley;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + s * 0.55, sy + s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx + 2, sy);
  ctx.lineTo(sx + s * 0.55 + 2, sy + s);
  ctx.stroke();
}

export function drawRoofValleyFR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.88);
  ctx.restore();
  // Shadow deepens toward NE corner
  const vg = ctx.createRadialGradient(sx + s, sy, 0, sx + s, sy, s * 0.85);
  vg.addColorStop(0, C.valley);
  vg.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(sx, sy, s, s);
  ctx.strokeStyle = C.valley;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx + s, sy);
  ctx.lineTo(sx + s * 0.45, sy + s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx + s - 2, sy);
  ctx.lineTo(sx + s * 0.45 - 2, sy + s);
  ctx.stroke();
}

// Flat roof section with a raised parapet ledge on all visible edges.

export function drawRoofFlat(ctx: Ctx, sx: number, sy: number, s: number, style: RoofStyle): void {
  const C = ROOF_PALETTE[style];
  // Flat surface — mid-tone of the style
  ctx.fillStyle = C.mid;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  ROOF_TEX[style](ctx, sx, sy, s, s, 0.72);
  ctx.restore();
  // Overall lit gradient (top-left light source)
  ctx.fillStyle = tbGrad(ctx, sx, sy, s, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.10)');
  ctx.fillRect(sx, sy, s, s);
  // Parapet edge — raised stone border with top face + shadow
  const pw = Math.max(4, Math.floor(s * 0.12));
  // Top parapet face (slightly lighter)
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, pw); // north edge
  ctx.fillRect(sx, sy, pw, s); // west edge
  ctx.fillRect(sx + s - pw, sy, pw, s); // east edge
  ctx.fillRect(sx, sy + s - pw, s, pw); // south edge (front, brightest)
  // Parapet inner shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(sx + pw, sy + pw, 2, s - pw * 2); // inner left shadow
  ctx.fillRect(sx + pw, sy + pw, s - pw * 2, 2); // inner top shadow
  // South face of parapet (visible as a "wall" face to player)
  ctx.fillStyle = C.side;
  ctx.fillRect(sx, sy + s - pw, s, pw);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(sx, sy + s - pw, s, 1); // top highlight
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(sx, sy + s - 1, s, 1); // bottom shadow
}

// Ridge end caps (where the ridge terminates at each end)
// Used at the leftmost and rightmost tiles of the middle/ridge row
// when building a gable roof (vs. a hip roof).

export function drawRoofRidgeEndL(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  // Front half (below ridge): eave-colored, slightly darker toward left
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.82);
  ctx.restore();
  // Left triangle: shadowed slope facing left (side gable face)
  roofTri(
    ctx,
    sx,
    sy,
    sx,
    sy + s,
    sx + Math.floor(s * 0.5),
    sy + Math.floor(s * 0.5),
    C.side,
    T,
    0.55,
    sx,
    sy,
    s,
    s,
  );
  // Ridge cap terminator
  ctx.fillStyle = C.ridge;
  ctx.beginPath();
  ctx.arc(sx + Math.floor(s * 0.5), sy + Math.floor(s * 0.5), Math.floor(s * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + Math.floor(s * 0.5));
  ctx.lineTo(sx + Math.floor(s * 0.5), sy + Math.floor(s * 0.5));
  ctx.stroke();
}

export function drawRoofRidgeEndR(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  style: RoofStyle,
): void {
  const C = ROOF_PALETTE[style];
  const T = ROOF_TEX[style];
  ctx.fillStyle = C.eave;
  ctx.fillRect(sx, sy, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, s, s);
  ctx.clip();
  T(ctx, sx, sy, s, s, 0.82);
  ctx.restore();
  roofTri(
    ctx,
    sx + s,
    sy,
    sx + s,
    sy + s,
    sx + Math.floor(s * 0.5),
    sy + Math.floor(s * 0.5),
    C.side,
    T,
    0.55,
    sx,
    sy,
    s,
    s,
  );
  ctx.fillStyle = C.ridge;
  ctx.beginPath();
  ctx.arc(sx + Math.floor(s * 0.5), sy + Math.floor(s * 0.5), Math.floor(s * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx + Math.floor(s * 0.5), sy + Math.floor(s * 0.5));
  ctx.lineTo(sx + s, sy + Math.floor(s * 0.5));
  ctx.stroke();
}

export type CircusTint = 'red' | 'blue' | 'purple';

interface CircusPalette {
  a: string; // primary stripe colour
  b: string; // secondary stripe (usually cream)
  shadow: string; // shadowed variant of primary
  gold: string; // accent / fringe
  pole: string; // tent-pole wood
}

const CIRCUS_PALETTE: Record<CircusTint, CircusPalette> = {
  red: { a: '#cc2222', b: '#f5ead0', shadow: '#881414', gold: '#ffcc22', pole: '#7a5020' },
  blue: { a: '#2244aa', b: '#f5ead0', shadow: '#162878', gold: '#ffcc22', pole: '#3a5080' },
  purple: { a: '#8822cc', b: '#f5ead0', shadow: '#4a1478', gold: '#ffdd44', pole: '#5a3080' },
};

/** Draw radiating stripe sectors on a clipped canvas region. */
function circusRadialStripes(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  numSectors: number,
  colA: string,
  colB: string,
): void {
  for (let i = 0; i < numSectors; i++) {
    const a0 = (i / numSectors) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / numSectors) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = i % 2 === 0 ? colA : colB;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Center peak tile — top-down view of the tent's conical apex.
 * Shows a starburst of radiating stripes with the tent pole emerging from center.
 */
export function drawCircusTentPeak(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: CircusTint,
): void {
  const C = CIRCUS_PALETTE[tint];
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const r = s * 0.5;

  // 12-sector starburst of alternating stripes
  circusRadialStripes(ctx, cx, cy, r, 12, C.a, C.b);

  // Concentric shading rings (tent curvature illusion)
  for (let ri = 1; ri <= 3; ri++) {
    ctx.strokeStyle = `rgba(0,0,0,${(0.08 * ri).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (r * ri) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Tent-pole finial disk
  ctx.fillStyle = C.pole;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,220,0.7)';
  ctx.beginPath();
  ctx.arc(cx - s * 0.02, cy - s * 0.02, s * 0.02, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Main cone body — directional slope tile.
 * dir: which face of the tent this tile represents.
 * 's' = south-facing front (bright), 'n' = north back (dark),
 * 'e' = east side (medium), 'w' = west side (medium), 'c' = centre ring.
 */
export function drawCircusTentSlope(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: CircusTint,
  dir: 's' | 'n' | 'e' | 'w' | 'c',
): void {
  const C = CIRCUS_PALETTE[tint];

  const lightness =
    dir === 's' ? 1.0 : dir === 'c' ? 0.85 : dir === 'e' || dir === 'w' ? 0.72 : 0.5;
  const shadowMix = dir === 'n' ? 0.38 : 0;

  const sw = Math.max(4, Math.floor(s * 0.26));

  // Diagonal stripes (angled 45° for north/south, 135° for east/west, horizontal for centre)
  if (dir === 'c' || dir === 's' || dir === 'n') {
    // Vertical stripes suggesting the cone slope going toward center
    ctx.fillStyle = C.b;
    ctx.fillRect(sx, sy, s, s);
    for (let xi = 0; xi < s; xi += sw * 2) {
      const lFactor = lightness - (xi / s) * 0.08; // subtle perspective darkening
      ctx.fillStyle = `rgba(${parseInt(C.a.slice(1, 3), 16)},${parseInt(C.a.slice(3, 5), 16)},${parseInt(C.a.slice(5, 7), 16)},${(lFactor * 0.9).toFixed(2)})`;
      ctx.fillRect(sx + xi, sy, sw, s);
    }
  } else {
    // Horizontal stripes for side tiles (e/w): stripe direction flips to suggest side slope
    ctx.fillStyle = C.b;
    ctx.fillRect(sx, sy, s, s);
    for (let yi = 0; yi < s; yi += sw * 2) {
      ctx.fillStyle = `rgba(${parseInt(C.a.slice(1, 3), 16)},${parseInt(C.a.slice(3, 5), 16)},${parseInt(C.a.slice(5, 7), 16)},${(lightness * 0.9).toFixed(2)})`;
      ctx.fillRect(sx, sy + yi, s, sw);
    }
  }

  // Shading overlay
  if (shadowMix > 0) {
    ctx.fillStyle = `rgba(0,0,0,${shadowMix.toFixed(2)})`;
    ctx.fillRect(sx, sy, s, s);
  }
  ctx.fillStyle = tbGrad(
    ctx,
    sx,
    sy,
    s,
    `rgba(255,255,200,${(lightness * 0.06).toFixed(2)})`,
    `rgba(0,0,0,${((1 - lightness) * 0.14).toFixed(2)})`,
  );
  ctx.fillRect(sx, sy, s, s);

  // Canvas texture lines
  for (let y = 2; y < s; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    ctx.fillRect(sx, sy + y, s, 1);
  }
}

/**
 * Corner slope tile — diagonal transition between two tent faces.
 * se = south-east (front-right), sw = south-west (front-left),
 * ne = north-east (back-right), nw = north-west (back-left).
 */
export function drawCircusTentCorner(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: CircusTint,
  corner: 'se' | 'sw' | 'ne' | 'nw',
): void {
  const C = CIRCUS_PALETTE[tint];
  const isFront = corner === 'se' || corner === 'sw';
  const isLeft = corner === 'sw' || corner === 'nw';

  // Base: brighter for front corners, darker for back
  const base = isFront ? C.b : C.shadow;
  ctx.fillStyle = base;
  ctx.fillRect(sx, sy, s, s);

  // Radiating wedge of stripes from the inner corner
  const innerX = isLeft ? sx + s : sx;
  const innerY = isFront ? sy : sy + s;
  const stripeCount = 4;
  for (let i = 0; i < stripeCount; i++) {
    if (i % 2 === 0) {
      const a0 = isFront ? (isLeft ? Math.PI * 0.5 : 0) : isLeft ? Math.PI : Math.PI * 1.5;
      const span = Math.PI * 0.5;
      const a = a0 + (i / stripeCount) * span;
      const a1 = a0 + ((i + 1) / stripeCount) * span;
      ctx.fillStyle = isFront
        ? `rgba(${parseInt(C.a.slice(1, 3), 16)},${parseInt(C.a.slice(3, 5), 16)},${parseInt(C.a.slice(5, 7), 16)},0.85)`
        : `rgba(${parseInt(C.a.slice(1, 3), 16)},${parseInt(C.a.slice(3, 5), 16)},${parseInt(C.a.slice(5, 7), 16)},0.50)`;
      ctx.beginPath();
      ctx.moveTo(innerX, innerY);
      ctx.arc(innerX, innerY, s * 1.5, a, a1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Canvas texture
  for (let y = 2; y < s; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    ctx.fillRect(sx, sy + y, s, 1);
  }

  // Shadow: dark toward back, lighter toward front
  const shadowAlpha = isFront ? 0.0 : 0.3;
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha.toFixed(2)})`;
  ctx.fillRect(sx, sy, s, s);
}

/**
 * Scalloped eave fringe — the bottom edge of the circus tent.
 * dir indicates which side: 's' = front, 'n' = back, 'e' = east, 'w' = west.
 */
export function drawCircusTentScallop(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  tint: CircusTint,
  dir: 's' | 'n' | 'e' | 'w',
): void {
  const C = CIRCUS_PALETTE[tint];
  const isBack = dir === 'n';
  const sw2 = Math.max(4, Math.floor(s * 0.26));

  // Body fill (matches the adjacent slope tile)
  ctx.fillStyle = isBack ? C.shadow : C.b;
  ctx.fillRect(sx, sy, s, s);
  for (let xi = 0; xi < s; xi += sw2 * 2) {
    ctx.fillStyle = isBack
      ? `rgba(0,0,0,0.18)`
      : `rgba(${parseInt(C.a.slice(1, 3), 16)},${parseInt(C.a.slice(3, 5), 16)},${parseInt(C.a.slice(5, 7), 16)},0.88)`;
    ctx.fillRect(sx + xi, sy, sw2, s);
  }

  // Large scallops (half-circle dips) along the outer edge
  const scallop = Math.max(7, Math.floor(s * 0.18));

  if (dir === 's' || dir === 'n') {
    // Scallops along top (back) or bottom (front) edge
    const ey = isBack ? sy : sy + s;
    const dir2 = isBack ? 1 : -1;
    for (let xi = sx; xi < sx + s; xi += scallop * 2) {
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(xi + scallop, ey, scallop, isBack ? 0 : Math.PI, isBack ? Math.PI : 0);
      ctx.fill();
    }
    // Gold fringe stripe
    ctx.fillStyle = C.gold;
    ctx.fillRect(sx, ey - (isBack ? 0 : 3), s, 3);
    // Pennant flags
    const flagColors = [C.a, C.b, C.gold, C.a, C.b];
    for (let fi = 0; fi < 5; fi++) {
      const fx = sx + (fi + 0.5) * (s / 5);
      const fy = ey + dir2 * scallop * 0.5;
      ctx.fillStyle = flagColors[fi % flagColors.length];
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + 7, fy + dir2 * 5);
      ctx.lineTo(fx, fy + dir2 * 10);
      ctx.closePath();
      ctx.fill();
    }
    // Guy-wire rope suggestion
    ctx.strokeStyle = 'rgba(120,90,40,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx + Math.floor(s / 2), ey);
    ctx.lineTo(sx + Math.floor(s / 2) + dir2 * 20, ey + dir2 * 15);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Side scallops (east/west)
    const ex = dir === 'w' ? sx : sx + s;
    for (let yi = sy; yi < sy + s; yi += scallop * 2) {
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(
        ex,
        yi + scallop,
        scallop,
        dir === 'w' ? -Math.PI / 2 : Math.PI / 2,
        dir === 'w' ? Math.PI / 2 : -Math.PI / 2,
        dir === 'w',
      );
      ctx.fill();
    }
    ctx.fillStyle = C.gold;
    ctx.fillRect(ex - (dir === 'e' ? 3 : 0), sy, 3, s);
  }
}
