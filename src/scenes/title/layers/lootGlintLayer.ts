/**
 * A loot box left on the floor in the shadows beside the heroes:
 * a gilded, domed chest, easy to miss until a glint runs across its lid and
 * gives it away.
 */

import { drawRadialGlow, type GlowStop } from '../../../sprites/radialGlow';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import { TILE_SIZE } from '../../../core/constants';
import { applyTitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';
import type { TitleEventFire } from '../titleEvents';
import { floorScaleAt, titleHall, type TitleHall } from '../titleHall';
import { TitleShadeBuffer } from '../titleShade';

/** The box sits on the floor just behind the heroes' plane. */
const LOOT_DEPTH = 0.75;

/** Where the box stands, in hero tiles from the hero spot, by composition: in the dark, clear of the menu. */
const BOX_OFFSET_TILES = {
  landscape: { x: -2.9, y: -0.45 },
  portrait: { x: 2.25, y: -0.35 },
} as const;

/** Chest proportions in floor tiles where it stands. */
const BOX_WIDTH_TILES = 0.82;
const BODY_HEIGHT_TILES = 0.42;
/** The lid's straight lip below its dome, and the dome's rise. */
const LID_LIP_TILES = 0.07;
const LID_DOME_TILES = 0.17;
const LID_OVERHANG_TILES = 0.035;
const RIM_TILES = 0.04;
const BAND_TILES = 0.075;
/** The two gilded bands, as shares of the width from the left. */
const LEFT_BAND_AT = 0.2;
const RIGHT_BAND_AT = 0.8;
const BAND_AT = [LEFT_BAND_AT, RIGHT_BAND_AT] as const;
/** Plank seams across the body, as shares of its height from the top. */
const UPPER_SEAM_AT = 0.36;
const LOWER_SEAM_AT = 0.68;
const PLANK_SEAMS_AT = [UPPER_SEAM_AT, LOWER_SEAM_AT] as const;
const SEAM_TILES = 0.012;
/** The shaded right flank, as a share of the width. */
const FLANK_SHARE = 0.24;
const LOCK_WIDTH_TILES = 0.15;
const LOCK_HEIGHT_TILES = 0.17;
const KEYHOLE_RADIUS_TILES = 0.022;
const KEYHOLE_SLOT_TILES = 0.045;
/** The lit edge of a gilded part, as a share of its own thickness. */
const EDGE_SHARE = 0.3;
/** The crown highlight's reach across the dome, as a share of its half-width. */
const CROWN_LIGHT_SHARE = 0.75;
const CONTACT_SHADOW_RX_TILES = 0.55;
const CONTACT_SHADOW_RY_TILES = 0.1;
const CONTACT_SHADOW_ALPHA = 0.6;
/** Paint box around the chest, in its tiles, roomy enough for the shadow and the overhang. */
const PAINT_MARGIN_TILES = 0.2;

/** How much shadow covers the box before the hall is lit, once it is, and how much the glint lifts it. */
const DARK_SHADE = 0.86;
const RESTING_SHADE = 0.36;
const GLINT_SHADE_LIFT = 0.3;

/** Where on the dome the glint flares, as a share of the width from the left: the right band's crown. */
const GLINT_ALONG_LID = RIGHT_BAND_AT;
/** The glint at its brightest, in chest tiles. */
const GLINT_ARM_TILES = 0.32;
const GLINT_WAIST_TILES = 0.035;
const GLINT_BLOOM_TILES = 0.5;
/** The star turns an eighth of a turn over the glint. */
const EIGHTHS_PER_TURN = 8;
const GLINT_TURN_RADIANS = (Math.PI * 2) / EIGHTHS_PER_TURN;
/** The second, shorter pair of arms, as a share of the first. */
const GLINT_CROSS_SHARE = 0.55;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

const GLOW_STOPS: readonly GlowStop[] = [
  { offset: 0, color: TITLE_INK.loot.glintBody },
  { offset: 1, color: TITLE_INK.loot.glintFade },
];

interface BoxGeometry {
  readonly centreX: number;
  readonly bottom: number;
  readonly tile: number;
}

function boxGeometry(stage: TitleStage, hall: TitleHall): BoxGeometry {
  const heroTile = TILE_SIZE * stage.heroScale;
  const offset = BOX_OFFSET_TILES[stage.composition];
  const bottom = stage.floorY + offset.y * heroTile;
  return {
    centreX: stage.heroSpot.x + offset.x * heroTile,
    bottom,
    tile: hall.farPxPerTile * floorScaleAt(hall, bottom),
  };
}

/** A gilded strip: its face, a lit top edge and a shadowed bottom edge. */
function gilt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const edge = Math.min(w, h) * EDGE_SHARE;
  ctx.fillStyle = TITLE_INK.loot.trim;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = TITLE_INK.loot.trimLight;
  ctx.fillRect(x, y, w, edge);
  ctx.fillStyle = TITLE_INK.loot.trimShade;
  ctx.fillRect(x, y + h - edge, w, edge);
}

function paintChest(ctx: CanvasRenderingContext2D, box: BoxGeometry): void {
  const { centreX, bottom, tile } = box;
  const width = BOX_WIDTH_TILES * tile;
  const left = centreX - width * HALF;
  const bodyTop = bottom - BODY_HEIGHT_TILES * tile;
  const bodyHeight = bottom - bodyTop;
  const overhang = LID_OVERHANG_TILES * tile;
  const lidLeft = left - overhang;
  const lidWidth = width + overhang * 2;
  const lipTop = bodyTop - LID_LIP_TILES * tile;
  const domeRise = LID_DOME_TILES * tile;

  ctx.save();
  ctx.globalAlpha = CONTACT_SHADOW_ALPHA;
  ctx.fillStyle = TITLE_INK.cast.shadow;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    bottom,
    CONTACT_SHADOW_RX_TILES * tile,
    CONTACT_SHADOW_RY_TILES * tile,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = TITLE_INK.loot.body;
  ctx.fillRect(left, bodyTop, width, bodyHeight);
  ctx.fillStyle = TITLE_INK.loot.bodyShade;
  ctx.fillRect(left + width * (1 - FLANK_SHARE), bodyTop, width * FLANK_SHARE, bodyHeight);
  ctx.fillStyle = TITLE_INK.loot.plankSeam;
  for (const share of PLANK_SEAMS_AT) {
    ctx.fillRect(left, bodyTop + bodyHeight * share, width, SEAM_TILES * tile);
  }

  ctx.fillStyle = TITLE_INK.loot.lid;
  ctx.beginPath();
  ctx.moveTo(lidLeft, bodyTop);
  ctx.lineTo(lidLeft, lipTop);
  ctx.ellipse(centreX, lipTop, lidWidth * HALF, domeRise, 0, Math.PI, FULL_TURN);
  ctx.lineTo(lidLeft + lidWidth, bodyTop);
  ctx.closePath();
  ctx.fill();

  const crown = ctx.createRadialGradient(
    centreX,
    lipTop - domeRise,
    0,
    centreX,
    lipTop - domeRise,
    lidWidth * HALF * CROWN_LIGHT_SHARE,
  );
  crown.addColorStop(0, TITLE_INK.loot.lidLight);
  crown.addColorStop(1, TITLE_INK.loot.lidLightFade);
  ctx.fillStyle = crown;
  ctx.fill();

  const band = BAND_TILES * tile;
  for (const share of BAND_AT) {
    const x = left + width * share - band * HALF;
    const along = (x + band * HALF - centreX) / (lidWidth * HALF);
    const domeTopAt = lipTop - domeRise * Math.sqrt(Math.max(0, 1 - along * along));
    gilt(ctx, x, domeTopAt, band, bottom - domeTopAt);
  }

  const rim = RIM_TILES * tile;
  gilt(ctx, lidLeft, bodyTop - rim * HALF, lidWidth, rim);
  gilt(ctx, left, bottom - rim, width, rim);

  const lockWidth = LOCK_WIDTH_TILES * tile;
  const lockHeight = LOCK_HEIGHT_TILES * tile;
  const lockTop = bodyTop - lockHeight * HALF * HALF;
  ctx.fillStyle = TITLE_INK.loot.trimShade;
  ctx.fillRect(centreX - lockWidth * HALF, lockTop, lockWidth, lockHeight);
  ctx.fillStyle = TITLE_INK.loot.lock;
  const inset = lockWidth * EDGE_SHARE * HALF;
  ctx.fillRect(
    centreX - lockWidth * HALF + inset,
    lockTop + inset,
    lockWidth - inset * 2,
    lockHeight - inset * 2,
  );
  ctx.fillStyle = TITLE_INK.loot.keyhole;
  const keyholeY = lockTop + lockHeight * HALF;
  const keyholeRadius = KEYHOLE_RADIUS_TILES * tile;
  ctx.beginPath();
  ctx.arc(centreX, keyholeY - keyholeRadius, keyholeRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillRect(
    centreX - keyholeRadius * HALF,
    keyholeY - keyholeRadius,
    keyholeRadius,
    KEYHOLE_SLOT_TILES * tile,
  );
}

function paintGlint(ctx: CanvasRenderingContext2D, box: BoxGeometry, progress: number): void {
  const strength = Math.sin(Math.PI * progress);
  const { tile } = box;
  const width = BOX_WIDTH_TILES * tile;
  const x = box.centreX - width * HALF + width * GLINT_ALONG_LID;
  const y = box.bottom - (BODY_HEIGHT_TILES + LID_LIP_TILES + LID_DOME_TILES * HALF) * tile;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  drawRadialGlow(ctx, x, y, GLINT_BLOOM_TILES * tile * strength, GLOW_STOPS);
  ctx.translate(x, y);
  ctx.rotate(GLINT_TURN_RADIANS * progress);
  ctx.fillStyle = TITLE_INK.loot.glintCore;
  const arm = GLINT_ARM_TILES * tile * strength;
  const waist = GLINT_WAIST_TILES * tile * strength;
  for (const [length, quarterTurns] of [
    [arm, 0],
    [arm * GLINT_CROSS_SHARE, 1],
  ] as const) {
    ctx.save();
    ctx.rotate((quarterTurns * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(-length, 0);
    ctx.lineTo(0, -waist);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, waist);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function lootGlintLayer(): TitleLayer {
  let glint: TitleEventFire | null = null;
  let hall: TitleHall | null = null;
  const shade = new TitleShadeBuffer();
  return {
    id: 'lootGlint',
    depth: LOOT_DEPTH,
    layout: (stage) => {
      hall = titleHall(stage);
    },
    onEvent: (fire) => {
      if (fire.id === 'lootGlint') glint = fire;
    },
    render: (ctx, clock, stage, camera) => {
      const staged = hall ?? titleHall(stage);
      applyTitleCamera(ctx, camera, LOOT_DEPTH);
      const box = boxGeometry(stage, staged);
      const fire = glint;
      const sinceMs = fire === null ? -1 : clock.elapsedMs - fire.startedAtMs;
      const glinting = fire !== null && sinceMs >= 0 && sinceMs < fire.durationMs;
      const progress = glinting ? sinceMs / fire.durationMs : 0;
      const lift = glinting ? GLINT_SHADE_LIFT * Math.sin(Math.PI * progress) : 0;
      const lit = Math.max(stage.lights.ambient, clock.ignitionProgress);
      const resting = DARK_SHADE + (RESTING_SHADE - DARK_SHADE) * lit;
      const reach = (BOX_WIDTH_TILES * HALF + PAINT_MARGIN_TILES) * box.tile;
      const height =
        (BODY_HEIGHT_TILES + LID_LIP_TILES + LID_DOME_TILES + PAINT_MARGIN_TILES * 2) * box.tile;
      const paintBox = {
        x: box.centreX - reach,
        y: box.bottom + PAINT_MARGIN_TILES * box.tile - height,
        w: reach * 2,
        h: height,
      };
      shade.draw(ctx, paintBox, resting - lift, TITLE_INK.cast.shadow, (target) =>
        paintChest(target, box),
      );
      if (glinting) paintGlint(ctx, box, progress);
    },
    dispose: () => shade.dispose(),
  };
}
