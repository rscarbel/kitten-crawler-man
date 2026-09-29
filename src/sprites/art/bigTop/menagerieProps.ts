/**
 * Act II, the Menagerie: the cages set into the drapes and what is left in
 * them, the ushers' follow-spots on their yokes, the ringmaster's feeding
 * bells, the dead audience in the bleachers, and the animal-handling gear the
 * two crawlers work for each other.
 *
 * Every still picture is baked once through `bigTopPropCache` and blitted;
 * what moves with the frame is quantised into a few baked frames or drawn
 * live over them.
 */

import {
  EVERY_EDGE,
  ONE_TILE_BOX,
  drawBigTopProp,
  type BigTopPropBox,
  type BigTopPropCatalogueEntry,
  type BigTopPropEdge,
} from './bigTopPropCache';
import {
  BACKSTAGE,
  BLOOD,
  BONE,
  BRASS,
  DAMAGE_STAGE_COUNT,
  GILT,
  INK,
  IRON,
  LIMELIGHT,
  MILDEW,
  NAVY,
  RINGMASTER,
  ROT_TIMBER,
  STAGE_RED,
  STRAW,
  TAU,
  blend,
  contactShadow,
  hitsLanded,
  jitterTone,
  litColumn,
  litFill,
  loopFrame,
  outline,
  paint,
  paintCarlChevrons,
  paintDonutHoop,
  paintImpact,
  paintPulseHalo,
  propRng,
  pulseStrength,
  type Ctx,
  type RGB,
} from './bigTopPropKit';
import type { MazeDestructibleArt } from './fireWalkProps';

/** How a feeding bell's post currently looks. */
export interface MazeBellArt {
  readonly phase: number;
  readonly struck: boolean;
  /** True while the bell's hold is running. */
  readonly holding: boolean;
  /** 1 → 0 across the hold. */
  readonly holdFraction: number;
  /** False while the post is on cooldown and will not answer. */
  readonly ready: boolean;
  readonly pulsing: boolean;
}

type Painter = (ctx: Ctx, originX: number, originY: number, size: number) => void;

// ── Cages ────────────────────────────────────────────────────────────────────

/** What a cage still holds. Most hold nothing, or nothing that will move again. */
export type CageOccupant = 'empty' | 'watcher' | 'husk' | 'lion' | 'lemur';
const CAGE_OCCUPANTS: ReadonlyArray<CageOccupant> = ['empty', 'watcher', 'husk', 'lion', 'lemur'];

/** Cumulative shares of each occupant across the act's cages, in `CAGE_OCCUPANTS` order. */
const OCCUPANT_THRESHOLDS: ReadonlyArray<number> = [0.36, 0.58, 0.76, 0.9, 1];
const HASH_SALT_OCCUPANT = 43.17;
const HASH_SPREAD = 43758.5453;
const HASH_SEED_WEIGHT = 12.9898;
const HASH_SALT_WEIGHT = 78.233;

function seedUnit(seed: number, salt: number): number {
  const scattered = Math.sin(seed * HASH_SEED_WEIGHT + salt * HASH_SALT_WEIGHT) * HASH_SPREAD;
  return scattered - Math.floor(scattered);
}

/** Which occupant a cage with this seed holds. Stable for the life of the tent. */
export function cageOccupantFor(seed: number): CageOccupant {
  const roll = seedUnit(seed, HASH_SALT_OCCUPANT);
  const index = OCCUPANT_THRESHOLDS.findIndex((threshold) => roll < threshold);
  return CAGE_OCCUPANTS[index] ?? 'empty';
}

/** Whether an occupant can throw itself at the bars. */
export function occupantLunges(occupant: CageOccupant): boolean {
  return occupant === 'lion' || occupant === 'lemur';
}

/**
 * The idle loop: six frames, each held for a quarter-second, so a mane
 * breathes and a hanging lemur sways without ever strobing.
 */
const CAGE_IDLE_FRAMES = 6;
const CAGE_IDLE_FRAMES_PER_STEP = 15;
/** Game frames a lunge lasts, from the lantern catching to the beast falling back. */
export const CAGE_LUNGE_DURATION_FRAMES = 36;
const CAGE_LUNGE_FRAMES = 5;
/** How far forward the beast is on each lunge frame: a lunge, a hold on the bars, a fall back. */
const LUNGE_REACH: ReadonlyArray<number> = [0.55, 1, 1, 0.7, 0.3];

const CAGE_HEADER_HEIGHT = 0.13;
const CAGE_SILL_TOP = 0.86;
const CAGE_BACK_BOTTOM = 0.8;
const CAGE_FAR_BARS = 5;
const CAGE_FAR_BAR_WIDTH = 0.022;
const CAGE_FAR_BAR_SHIFT = 0.035;
const CAGE_FAR_BAR_ALPHA = 0.4;
const CAGE_NEAR_BARS = 4;
const CAGE_NEAR_BAR_WIDTH = 0.04;
const CAGE_STRAW_TOP = 0.7;
const CAGE_STRAW_WISPS = 9;
const CAGE_GLINT_ALPHA = 0.95;
const CAGE_BACK_STRAW_WARMTH = 0.35;
/** The far bars hang from just under the header, so they read as further off than the near ones. */
const CAGE_FAR_BAR_DROP = 0.02;
/** The straw bedding's heaped top edge and loose wisps, as tile fractions. */
const CAGE_STRAW = {
  leftDrop: 0.04,
  dipX: 0.3,
  dipRise: 0.03,
  crestX: 0.55,
  swellX: 0.8,
  swellDrop: 0.03,
  rightRise: 0.01,
  lightHeight: 0.16,
  wispAlpha: 0.7,
  wispWidth: 0.015,
  wispDepth: 0.03,
  wispScatter: 0.1,
  wispLean: 0.12,
  wispLength: 0.05,
} as const;
/** A pair of eyes in the dark: a soft glow and a hard glint. */
const CAGE_EYE = {
  glowRadius: 0.05,
  glowAlpha: 0.7,
  glintHalfWidth: 0.012,
  glintRise: 0.01,
  glintWidth: 0.024,
  glintHeight: 0.02,
} as const;

interface CageLook {
  readonly occupant: CageOccupant;
  readonly variant: number;
  /** A shut cage gate in a lane rather than a cage front in a drape. */
  readonly gate: boolean;
}

function paintCageBack(ctx: Ctx, ox: number, oy: number, s: number, rng: () => number): void {
  const back = ctx.createLinearGradient(
    0,
    oy + s * CAGE_HEADER_HEIGHT,
    0,
    oy + s * CAGE_BACK_BOTTOM,
  );
  back.addColorStop(0, paint(BACKSTAGE.shadow));
  back.addColorStop(1, paint(blend(BACKSTAGE.accent, STRAW.shadow, CAGE_BACK_STRAW_WARMTH)));
  ctx.fillStyle = back;
  ctx.fillRect(ox, oy + s * CAGE_HEADER_HEIGHT, s, s * (CAGE_SILL_TOP - CAGE_HEADER_HEIGHT));
  // The far side of the cage: thinner bars, in shadow, a step up and over.
  for (let bar = 0; bar < CAGE_FAR_BARS; bar++) {
    const barX = ox + s * ((bar + 0.5) / CAGE_FAR_BARS + CAGE_FAR_BAR_SHIFT);
    ctx.fillStyle = paint(IRON.light, CAGE_FAR_BAR_ALPHA);
    ctx.fillRect(
      barX,
      oy + s * (CAGE_HEADER_HEIGHT + CAGE_FAR_BAR_DROP),
      s * CAGE_FAR_BAR_WIDTH,
      s * (CAGE_STRAW_TOP - CAGE_HEADER_HEIGHT),
    );
  }
  ctx.beginPath();
  ctx.moveTo(ox, oy + s * (CAGE_STRAW_TOP + CAGE_STRAW.leftDrop));
  ctx.quadraticCurveTo(
    ox + s * CAGE_STRAW.dipX,
    oy + s * (CAGE_STRAW_TOP - CAGE_STRAW.dipRise),
    ox + s * CAGE_STRAW.crestX,
    oy + s * CAGE_STRAW_TOP,
  );
  ctx.quadraticCurveTo(
    ox + s * CAGE_STRAW.swellX,
    oy + s * (CAGE_STRAW_TOP + CAGE_STRAW.swellDrop),
    ox + s,
    oy + s * (CAGE_STRAW_TOP - CAGE_STRAW.rightRise),
  );
  ctx.lineTo(ox + s, oy + s * CAGE_SILL_TOP);
  ctx.lineTo(ox, oy + s * CAGE_SILL_TOP);
  ctx.closePath();
  ctx.fillStyle = litFill(ctx, ox, oy + s * CAGE_STRAW_TOP, s, s * CAGE_STRAW.lightHeight, {
    shadow: STRAW.shadow,
    mid: blend(STRAW.shadow, STRAW.mid, 0.5),
    light: STRAW.mid,
    accent: STRAW.light,
  });
  ctx.fill();
  ctx.strokeStyle = paint(STRAW.light, CAGE_STRAW.wispAlpha);
  ctx.lineWidth = Math.max(1, s * CAGE_STRAW.wispWidth);
  ctx.beginPath();
  for (let wisp = 0; wisp < CAGE_STRAW_WISPS; wisp++) {
    const wispX = ox + s * rng();
    const wispY = oy + s * (CAGE_STRAW_TOP + CAGE_STRAW.wispDepth + rng() * CAGE_STRAW.wispScatter);
    ctx.moveTo(wispX, wispY);
    ctx.lineTo(wispX + s * (rng() - 0.5) * CAGE_STRAW.wispLean, wispY - s * CAGE_STRAW.wispLength);
  }
  ctx.stroke();
}

function paintEyes(
  ctx: Ctx,
  cx: number,
  cy: number,
  s: number,
  spread: number,
  open: number,
  color: RGB,
): void {
  if (open <= 0) return;
  for (const side of [-1, 1]) {
    const eyeX = cx + side * s * spread;
    const glowRadius = s * CAGE_EYE.glowRadius;
    const glow = ctx.createRadialGradient(eyeX, cy, 0, eyeX, cy, glowRadius);
    glow.addColorStop(0, paint(color, CAGE_EYE.glowAlpha * open));
    glow.addColorStop(1, paint(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(eyeX - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);
    ctx.fillStyle = paint(LIMELIGHT.accent, CAGE_GLINT_ALPHA * open);
    ctx.fillRect(
      eyeX - s * CAGE_EYE.glintHalfWidth,
      cy - s * CAGE_EYE.glintRise,
      Math.max(1, s * CAGE_EYE.glintWidth),
      Math.max(1, s * CAGE_EYE.glintHeight * open),
    );
  }
}

/** A glint that holds, blinks once, and holds again across the idle loop. */
const WATCHER_BLINK: ReadonlyArray<number> = [1, 1, 0.5, 0, 0.7, 1];

/** A dead beast lying in the straw, as tile fractions. */
const HUSK = {
  floorDrop: 0.06,
  shadowDrop: 0.04,
  shadowRadiusX: 0.3,
  shadowRadiusY: 0.05,
  shadowAlpha: 0.7,
  bodyRadiusX: 0.28,
  bodyRadiusY: 0.09,
  bodyTilt: -0.08,
  hideRot: 0.4,
  ribWidth: 0.022,
  ribs: 5,
  firstRibX: 0.36,
  ribSpacing: 0.055,
  ribFootDrop: 0.04,
  ribBendX: 0.03,
  ribBendRise: 0.09,
  ribTipX: 0.02,
  ribTipRise: 0.1,
  skullX: 0.76,
  skullLift: 0.02,
  skullRadiusX: 0.07,
  skullRadiusY: 0.05,
  skullTilt: 0.3,
  socketLift: 0.035,
  socketWidth: 0.025,
  socketHeight: 0.02,
} as const;

function paintHusk(ctx: Ctx, ox: number, oy: number, s: number): void {
  const floorY = oy + s * (CAGE_STRAW_TOP + HUSK.floorDrop);
  contactShadow(
    ctx,
    ox + s * 0.5,
    floorY + s * HUSK.shadowDrop,
    s * HUSK.shadowRadiusX,
    s * HUSK.shadowRadiusY,
    HUSK.shadowAlpha,
  );
  ctx.beginPath();
  ctx.ellipse(
    ox + s * 0.5,
    floorY,
    s * HUSK.bodyRadiusX,
    s * HUSK.bodyRadiusY,
    HUSK.bodyTilt,
    0,
    TAU,
  );
  ctx.fillStyle = paint(blend(BACKSTAGE.accent, ROT_TIMBER.mid, HUSK.hideRot));
  ctx.fill();
  outline(ctx, s);
  // Ribs standing out of the hide, lit on their upper-left.
  ctx.strokeStyle = paint(BONE.shadow);
  ctx.lineWidth = Math.max(1, s * HUSK.ribWidth);
  ctx.beginPath();
  for (let rib = 0; rib < HUSK.ribs; rib++) {
    const ribX = ox + s * (HUSK.firstRibX + rib * HUSK.ribSpacing);
    ctx.moveTo(ribX, floorY + s * HUSK.ribFootDrop);
    ctx.quadraticCurveTo(
      ribX - s * HUSK.ribBendX,
      floorY - s * HUSK.ribBendRise,
      ribX + s * HUSK.ribTipX,
      floorY - s * HUSK.ribTipRise,
    );
  }
  ctx.stroke();
  const skullX = ox + s * HUSK.skullX;
  ctx.beginPath();
  ctx.ellipse(
    skullX,
    floorY - s * HUSK.skullLift,
    s * HUSK.skullRadiusX,
    s * HUSK.skullRadiusY,
    HUSK.skullTilt,
    0,
    TAU,
  );
  ctx.fillStyle = paint(BONE.mid);
  ctx.fill();
  outline(ctx, s);
  ctx.fillStyle = paint(INK);
  ctx.fillRect(skullX, floorY - s * HUSK.socketLift, s * HUSK.socketWidth, s * HUSK.socketHeight);
}

/** The old lion, as tile fractions; `lunge*` terms scale with how far it has thrown itself forward. */
const LION = {
  headX: 0.52,
  lungeLean: 0.02,
  headY: 0.47,
  breathBob: 0.012,
  lungeDrop: 0.06,
  lungeGrow: 0.3,
  bodyX: 0.66,
  bodyY: 0.62,
  bodyRadiusX: 0.26,
  bodyRadiusY: 0.13,
  bodyTilt: -0.15,
  bodyMildew: 0.5,
  rimAlpha: 0.55,
  rimWidth: 0.02,
  /** The rim light along the back, in half-turns from east. */
  rimArcStart: 1.05,
  rimArcEnd: 1.6,
  maneReach: 0.22,
  maneBreath: 0.01,
  maneClumps: 16,
  clumpScatter: 0.3,
  clumpBreathSway: 0.04,
  clumpRoot: 0.5,
  clumpReach: 1.05,
  clumpReachScatter: 0.2,
  /** Every third clump catches the light. */
  clumpAccentEvery: 3,
  clumpToneJitter: 8,
  clumpAlpha: 0.9,
  clumpWidth: 0.04,
  clumpCurl: 0.25,
  clumpBend: 0.85,
  clumpTipTurn: 0.1,
  clumpDroop: 0.02,
  muzzleDrop: 0.03,
  muzzleRadiusX: 0.085,
  muzzleRadiusY: 0.1,
  muzzleMildew: 0.3,
  /** Past this much of a lunge the jaw is open and the paws are on the sill. */
  jawOpensAt: 0.5,
  jawDrop: 0.09,
  jawRadiusX: 0.05,
  jawRadiusY: 0.035,
  fangLeftX: 0.035,
  fangRightX: 0.02,
  fangDrop: 0.065,
  fangWidth: 0.015,
  fangHeight: 0.025,
  eyeLift: 0.02,
  eyeSpread: 0.04,
  pawXs: [0.38, 0.62],
  pawLift: 0.03,
  pawRadiusX: 0.06,
  pawRadiusY: 0.04,
  clawWidth: 0.015,
  clawRootSpacing: 0.03,
  clawRootDrop: 0.02,
  clawTipSpacing: 0.035,
  clawTipDrop: 0.06,
} as const;

function paintLion(
  ctx: Ctx,
  ox: number,
  oy: number,
  s: number,
  frame: number,
  reach: number,
): void {
  const breath = Math.sin((frame / CAGE_IDLE_FRAMES) * TAU);
  const headX = ox + s * (LION.headX - reach * LION.lungeLean);
  const headY = oy + s * (LION.headY + breath * LION.breathBob + reach * LION.lungeDrop);
  const scale = 1 + reach * LION.lungeGrow;
  // The hunched body behind the head.
  const bodyX = ox + s * LION.bodyX;
  const bodyY = oy + s * LION.bodyY;
  ctx.beginPath();
  ctx.ellipse(bodyX, bodyY, s * LION.bodyRadiusX, s * LION.bodyRadiusY, LION.bodyTilt, 0, TAU);
  ctx.fillStyle = paint(blend(ROT_TIMBER.mid, MILDEW.shadow, LION.bodyMildew));
  ctx.fill();
  ctx.strokeStyle = paint(MILDEW.light, LION.rimAlpha);
  ctx.lineWidth = Math.max(1, s * LION.rimWidth);
  ctx.beginPath();
  ctx.ellipse(
    bodyX,
    bodyY,
    s * LION.bodyRadiusX,
    s * LION.bodyRadiusY,
    LION.bodyTilt,
    Math.PI * LION.rimArcStart,
    Math.PI * LION.rimArcEnd,
  );
  ctx.stroke();
  // The matted mane: clumped strands, mildewed, darker at the roots.
  const maneRadius = s * (LION.maneReach + breath * LION.maneBreath) * scale;
  const rng = propRng('lionMane');
  ctx.beginPath();
  ctx.arc(headX, headY, maneRadius, 0, TAU);
  ctx.fillStyle = paint(MILDEW.mid);
  ctx.fill();
  ctx.lineCap = 'round';
  for (let clump = 0; clump < LION.maneClumps; clump++) {
    const angle =
      (TAU / LION.maneClumps) * clump + rng() * LION.clumpScatter + breath * LION.clumpBreathSway;
    const inner = maneRadius * LION.clumpRoot;
    const outer = maneRadius * (LION.clumpReach + rng() * LION.clumpReachScatter);
    const catchesLight = clump % LION.clumpAccentEvery === 0;
    ctx.strokeStyle = paint(
      jitterTone(catchesLight ? MILDEW.accent : MILDEW.light, rng, LION.clumpToneJitter),
      LION.clumpAlpha,
    );
    ctx.lineWidth = Math.max(1, s * LION.clumpWidth * scale);
    ctx.beginPath();
    ctx.moveTo(headX + Math.cos(angle) * inner, headY + Math.sin(angle) * inner);
    ctx.quadraticCurveTo(
      headX + Math.cos(angle + LION.clumpCurl) * outer * LION.clumpBend,
      headY + Math.sin(angle + LION.clumpCurl) * outer * LION.clumpBend,
      headX + Math.cos(angle + LION.clumpTipTurn) * outer,
      headY + Math.sin(angle + LION.clumpTipTurn) * outer + s * LION.clumpDroop,
    );
    ctx.stroke();
  }
  // The muzzle and a jaw that opens as it throws itself forward.
  ctx.beginPath();
  ctx.ellipse(
    headX,
    headY + s * LION.muzzleDrop * scale,
    s * LION.muzzleRadiusX * scale,
    s * LION.muzzleRadiusY * scale,
    0,
    0,
    TAU,
  );
  ctx.fillStyle = paint(blend(ROT_TIMBER.mid, MILDEW.mid, LION.muzzleMildew));
  ctx.fill();
  outline(ctx, s);
  if (reach > LION.jawOpensAt) {
    ctx.beginPath();
    ctx.ellipse(
      headX,
      headY + s * LION.jawDrop * scale,
      s * LION.jawRadiusX * scale,
      s * LION.jawRadiusY * reach * scale,
      0,
      0,
      TAU,
    );
    ctx.fillStyle = paint(BLOOD.shadow);
    ctx.fill();
    ctx.fillStyle = paint(BONE.light);
    const fangY = headY + s * LION.fangDrop * scale;
    ctx.fillRect(
      headX - s * LION.fangLeftX * scale,
      fangY,
      s * LION.fangWidth,
      s * LION.fangHeight,
    );
    ctx.fillRect(
      headX + s * LION.fangRightX * scale,
      fangY,
      s * LION.fangWidth,
      s * LION.fangHeight,
    );
  }
  paintEyes(
    ctx,
    headX,
    headY - s * LION.eyeLift * scale,
    s,
    LION.eyeSpread * scale,
    1,
    LIMELIGHT.mid,
  );
}

function paintLionPaws(ctx: Ctx, ox: number, oy: number, s: number, reach: number): void {
  if (reach < LION.jawOpensAt) return;
  for (const pawX of LION.pawXs) {
    const x = ox + s * pawX;
    const y = oy + s * (CAGE_SILL_TOP - LION.pawLift);
    ctx.beginPath();
    ctx.ellipse(x, y, s * LION.pawRadiusX, s * LION.pawRadiusY, 0, 0, TAU);
    ctx.fillStyle = paint(blend(ROT_TIMBER.mid, MILDEW.mid, LION.muzzleMildew));
    ctx.fill();
    outline(ctx, s);
    ctx.strokeStyle = paint(BONE.accent);
    ctx.lineWidth = Math.max(1, s * LION.clawWidth);
    ctx.beginPath();
    for (let claw = -1; claw <= 1; claw++) {
      ctx.moveTo(x + claw * s * LION.clawRootSpacing, y + s * LION.clawRootDrop);
      ctx.lineTo(x + claw * s * LION.clawTipSpacing, y + s * LION.clawTipDrop);
    }
    ctx.stroke();
  }
}

/** The lemur hanging by its tail from the ceiling bars, as tile fractions from its pivot. */
const LEMUR = {
  pivotDrop: 0.02,
  idleSway: 0.18,
  lungeSwing: 0.5,
  tailRings: 6,
  tailWidth: 0.035,
  tailX: 0.1,
  tailDrop: 0.02,
  tailRadius: 0.05,
  bodyY: 0.2,
  bodyRadiusX: 0.07,
  bodyRadiusY: 0.15,
  furMix: 0.5,
  rimAlpha: 0.5,
  rimWidth: 0.018,
  /** The rim light down its flank, in half-turns from east. */
  rimArcStart: 0.9,
  rimArcEnd: 1.4,
  armWidth: 0.035,
  armTuck: 0.08,
  armLungeReach: 0.12,
  shoulderX: 0.05,
  shoulderY: 0.28,
  handY: 0.36,
  handLungeDrop: 0.05,
  headY: 0.37,
  headRadius: 0.075,
  eyeY: 0.38,
  eyeSpread: 0.032,
} as const;

function paintLemur(
  ctx: Ctx,
  ox: number,
  oy: number,
  s: number,
  frame: number,
  reach: number,
): void {
  const pivotX = ox + s * 0.5;
  const pivotY = oy + s * (CAGE_HEADER_HEIGHT + LEMUR.pivotDrop);
  const sway =
    Math.sin((frame / CAGE_IDLE_FRAMES) * TAU) * LEMUR.idleSway + reach * LEMUR.lungeSwing;
  // The ringed tail wrapped round the ceiling bars.
  ctx.lineCap = 'round';
  for (let ring = 0; ring < LEMUR.tailRings; ring++) {
    ctx.strokeStyle = paint(ring % 2 === 0 ? BONE.mid : BACKSTAGE.shadow);
    ctx.lineWidth = Math.max(1, s * LEMUR.tailWidth);
    ctx.beginPath();
    ctx.arc(
      pivotX - s * LEMUR.tailX,
      pivotY + s * LEMUR.tailDrop,
      s * LEMUR.tailRadius,
      (ring / LEMUR.tailRings) * TAU,
      ((ring + 1) / LEMUR.tailRings) * TAU,
    );
    ctx.stroke();
  }
  const fur = paint(blend(NAVY.light, BONE.shadow, LEMUR.furMix));
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(sway);
  ctx.beginPath();
  ctx.ellipse(0, s * LEMUR.bodyY, s * LEMUR.bodyRadiusX, s * LEMUR.bodyRadiusY, 0, 0, TAU);
  ctx.fillStyle = fur;
  ctx.fill();
  outline(ctx, s);
  ctx.strokeStyle = paint(BONE.light, LEMUR.rimAlpha);
  ctx.lineWidth = Math.max(1, s * LEMUR.rimWidth);
  ctx.beginPath();
  ctx.ellipse(
    0,
    s * LEMUR.bodyY,
    s * LEMUR.bodyRadiusX,
    s * LEMUR.bodyRadiusY,
    0,
    Math.PI * LEMUR.rimArcStart,
    Math.PI * LEMUR.rimArcEnd,
  );
  ctx.stroke();
  // Arms out to the bars as it swings at them; tucked otherwise.
  ctx.strokeStyle = fur;
  ctx.lineWidth = Math.max(1, s * LEMUR.armWidth);
  ctx.beginPath();
  const armReach = LEMUR.armTuck + reach * LEMUR.armLungeReach;
  const handY = s * (LEMUR.handY + reach * LEMUR.handLungeDrop);
  ctx.moveTo(-s * LEMUR.shoulderX, s * LEMUR.shoulderY);
  ctx.lineTo(-s * armReach, handY);
  ctx.moveTo(s * LEMUR.shoulderX, s * LEMUR.shoulderY);
  ctx.lineTo(s * armReach, handY);
  ctx.stroke();
  // Hanging upside down: the head is at the bottom, eyes the biggest thing on it.
  ctx.beginPath();
  ctx.arc(0, s * LEMUR.headY, s * LEMUR.headRadius, 0, TAU);
  ctx.fillStyle = paint(BONE.shadow);
  ctx.fill();
  outline(ctx, s);
  paintEyes(ctx, 0, s * LEMUR.eyeY, s, LEMUR.eyeSpread, 1, LIMELIGHT.light);
  ctx.restore();
}

/** The painted band along the header, as shares of the header's height. */
const CAGE_HEADER_BAND_TOP = 0.6;
const CAGE_HEADER_BAND_HEIGHT = 0.25;
/** A gate's hasp strap and padlock, as tile fractions. */
const CAGE_GATE_LOCK = {
  haspY: 0.45,
  haspHeight: 0.06,
  lockX: 0.44,
  lockY: 0.5,
  lockSize: 0.12,
  lockCorner: 0.02,
  shackleWidth: 0.02,
  shackleRadius: 0.035,
} as const;

function paintCageFront(ctx: Ctx, ox: number, oy: number, s: number, gate: boolean): void {
  for (let bar = 0; bar < CAGE_NEAR_BARS; bar++) {
    const barX = ox + s * ((bar + 0.5) / CAGE_NEAR_BARS) - (s * CAGE_NEAR_BAR_WIDTH) / 2;
    ctx.beginPath();
    ctx.rect(
      barX,
      oy + s * CAGE_HEADER_HEIGHT,
      s * CAGE_NEAR_BAR_WIDTH,
      s * (CAGE_SILL_TOP - CAGE_HEADER_HEIGHT),
    );
    ctx.fillStyle = litColumn(ctx, barX, s * CAGE_NEAR_BAR_WIDTH, IRON);
    ctx.fill();
    outline(ctx, s);
  }
  ctx.beginPath();
  ctx.rect(ox, oy, s, s * CAGE_HEADER_HEIGHT);
  ctx.fillStyle = litFill(ctx, ox, oy, s, s * CAGE_HEADER_HEIGHT, ROT_TIMBER);
  ctx.fill();
  outline(ctx, s);
  ctx.fillStyle = paint(gate ? STAGE_RED.shadow : NAVY.mid);
  ctx.fillRect(
    ox,
    oy + s * CAGE_HEADER_HEIGHT * CAGE_HEADER_BAND_TOP,
    s,
    s * CAGE_HEADER_HEIGHT * CAGE_HEADER_BAND_HEIGHT,
  );
  ctx.beginPath();
  ctx.rect(ox, oy + s * CAGE_SILL_TOP, s, s * (1 - CAGE_SILL_TOP));
  ctx.fillStyle = litFill(ctx, ox, oy + s * CAGE_SILL_TOP, s, s * (1 - CAGE_SILL_TOP), ROT_TIMBER);
  ctx.fill();
  outline(ctx, s);
  if (!gate) return;
  // A gate has a hasp and a padlock, and a cross-strap: this one is a door.
  const haspY = oy + s * CAGE_GATE_LOCK.haspY;
  const haspHeight = s * CAGE_GATE_LOCK.haspHeight;
  ctx.fillStyle = litFill(ctx, ox, haspY, s, haspHeight, IRON);
  ctx.fillRect(ox, haspY, s, haspHeight);
  const lockX = ox + s * CAGE_GATE_LOCK.lockX;
  const lockY = oy + s * CAGE_GATE_LOCK.lockY;
  const lockSize = s * CAGE_GATE_LOCK.lockSize;
  ctx.beginPath();
  ctx.roundRect(lockX, lockY, lockSize, lockSize, s * CAGE_GATE_LOCK.lockCorner);
  ctx.fillStyle = litFill(ctx, lockX, lockY, lockSize, lockSize, BRASS);
  ctx.fill();
  outline(ctx, s);
  ctx.strokeStyle = paint(BRASS.light);
  ctx.lineWidth = Math.max(1, s * CAGE_GATE_LOCK.shackleWidth);
  ctx.beginPath();
  ctx.arc(ox + s * 0.5, lockY, s * CAGE_GATE_LOCK.shackleRadius, Math.PI, 0);
  ctx.stroke();
}

/** The pacing shape behind a cage gate, as tile fractions. */
const PROWLER = {
  pace: 0.18,
  bodyY: 0.56,
  bodyRadiusX: 0.24,
  bodyRadiusY: 0.16,
  bodyAlpha: 0.85,
  /** The head leads the body on each turn. */
  headLead: 1.2,
  eyeY: 0.5,
  eyeSpread: 0.045,
} as const;

/** Where the watcher's eyes sit; each cage variant sets them a step further east. */
const WATCHER_EYES = { firstX: 0.35, variantStep: 0.1, y: 0.44, spread: 0.035 } as const;

/** The shadow behind a shut cage gate that has not stopped moving: it paces the width of the cage. */
function paintProwler(ctx: Ctx, ox: number, oy: number, s: number, frame: number): void {
  const drift = Math.sin((frame / CAGE_IDLE_FRAMES) * TAU) * PROWLER.pace;
  ctx.beginPath();
  ctx.ellipse(
    ox + s * (0.5 + drift),
    oy + s * PROWLER.bodyY,
    s * PROWLER.bodyRadiusX,
    s * PROWLER.bodyRadiusY,
    0,
    0,
    TAU,
  );
  ctx.fillStyle = paint(BACKSTAGE.accent, PROWLER.bodyAlpha);
  ctx.fill();
  paintEyes(
    ctx,
    ox + s * (0.5 + drift * PROWLER.headLead),
    oy + s * PROWLER.eyeY,
    s,
    PROWLER.eyeSpread,
    1,
    LIMELIGHT.mid,
  );
}

function cagePainter(look: CageLook, frame: number, reach: number): Painter {
  return (ctx, ox, oy, s) => {
    const rng = propRng(`cage${look.variant}`);
    paintCageBack(ctx, ox, oy, s, rng);
    switch (look.occupant) {
      case 'empty':
        break;
      case 'watcher':
        paintEyes(
          ctx,
          ox + s * (WATCHER_EYES.firstX + look.variant * WATCHER_EYES.variantStep),
          oy + s * WATCHER_EYES.y,
          s,
          WATCHER_EYES.spread,
          WATCHER_BLINK[frame] ?? 1,
          LIMELIGHT.mid,
        );
        break;
      case 'husk':
        paintHusk(ctx, ox, oy, s);
        break;
      case 'lion':
        paintLion(ctx, ox, oy, s, frame, reach);
        break;
      case 'lemur':
        paintLemur(ctx, ox, oy, s, frame, reach);
        break;
    }
    if (look.gate) paintProwler(ctx, ox, oy, s, frame);
    paintCageFront(ctx, ox, oy, s, look.gate);
    if (look.occupant === 'lion') paintLionPaws(ctx, ox, oy, s, reach);
  };
}

const CAGE_VARIANTS = 3;

/**
 * A cage front set into a menagerie drape. `lunge` is how far through a lunge
 * at the bars the beast is (0..1), or `null` when it is still.
 */
export function drawMenagerieCageFront(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  seed: number,
  phase: number,
  lunge: number | null,
): void {
  const occupant = cageOccupantFor(seed);
  const variant = ((seed % CAGE_VARIANTS) + CAGE_VARIANTS) % CAGE_VARIANTS;
  const look: CageLook = { occupant, variant, gate: false };
  const still = occupant === 'empty' || occupant === 'husk';
  if (lunge !== null && occupantLunges(occupant)) {
    const frame = Math.min(
      CAGE_LUNGE_FRAMES - 1,
      Math.floor(Math.max(0, lunge) * CAGE_LUNGE_FRAMES),
    );
    const reach = LUNGE_REACH[frame] ?? 0;
    drawBigTopProp(
      ctx,
      { prop: 'cage', state: `${occupant}|${variant}|lunge`, frame },
      ONE_TILE_BOX,
      cagePainter(look, 0, reach),
      x,
      y,
      size,
    );
    return;
  }
  const frame = still
    ? 0
    : loopFrame(
        phase + seed * CAGE_IDLE_FRAMES_PER_STEP,
        CAGE_IDLE_FRAMES,
        CAGE_IDLE_FRAMES_PER_STEP,
      );
  drawBigTopProp(
    ctx,
    { prop: 'cage', state: `${occupant}|${variant}|idle`, frame },
    ONE_TILE_BOX,
    cagePainter(look, frame, 0),
    x,
    y,
    size,
  );
}

/** A shut cage gate barring a lane, something pacing behind it. */
export function drawCageGateBarrier(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  const frame = loopFrame(phase, CAGE_IDLE_FRAMES, CAGE_IDLE_FRAMES_PER_STEP * 2);
  const look: CageLook = { occupant: 'empty', variant: 0, gate: true };
  drawBigTopProp(
    ctx,
    { prop: 'cageGate', state: 'shut', frame },
    ONE_TILE_BOX,
    cagePainter(look, frame, 0),
    x,
    y,
    size,
  );
}

// ── Follow-spots ─────────────────────────────────────────────────────────────

/** Where the lamp's pivot sits in its own wall tile, in tiles. */
export const FOLLOW_SPOT_PIVOT = { x: 0.5, y: 0.66 } as const;
/** How far in front of the pivot the lens sits, in tiles. */
export const FOLLOW_SPOT_LENS_REACH = 0.3;
/** Aim steps baked around the circle; a sixteenth of a right angle per step. */
const FOLLOW_SPOT_AIM_STEPS = 64;
const FOLLOW_SPOT_BOX: BigTopPropBox = { left: -0.1, top: 0, width: 1.2, height: 1.1 };
const LAMP_BACK = 0.2;
const LAMP_HALF_WIDTH = 0.13;
const LAMP_LENS_RADIUS = 0.1;
const YOKE_WIDTH = 0.035;
const BRACKET_Y = 0.18;
/** The lamp's bracket, drum, fork, lens and iris, as tile fractions. */
const FOLLOW_SPOT_LAMP = {
  shadowOffsetX: 0.05,
  shadowOffsetY: 0.06,
  shadowRadiusX: 0.3,
  shadowRadiusY: 0.16,
  shadowAlpha: 0.5,
  plateHalfWidth: 0.09,
  plateRise: 0.06,
  plateWidth: 0.18,
  plateHeight: 0.1,
  drumShadeStop: 0.4,
  drumCorner: 0.04,
  finWidth: 0.02,
  fins: 3,
  firstFin: 0.05,
  finSpacing: 0.06,
  forkHalfWidth: 0.03,
  forkWidth: 0.06,
  forkDepth: 0.04,
  barrelRadiusX: 0.045,
  barrelFlare: 1.2,
  lensInset: 0.01,
  lensRadiusX: 0.03,
  irisAlpha: 0.8,
  irisWidth: 0.015,
  /** The shut iris's second blade crosses the first on the slant. */
  irisBladeReach: 0.03,
  irisBladeSpan: 0.6,
  pivotCapRadius: 0.035,
} as const;

function followSpotPainter(aimStep: number, open: boolean): Painter {
  const aim = (aimStep / FOLLOW_SPOT_AIM_STEPS) * TAU;
  return (ctx, ox, oy, s) => {
    const pivotX = ox + s * FOLLOW_SPOT_PIVOT.x;
    const pivotY = oy + s * FOLLOW_SPOT_PIVOT.y;
    // The bracket plate on the drape and the yoke down from it.
    contactShadow(
      ctx,
      pivotX + s * FOLLOW_SPOT_LAMP.shadowOffsetX,
      pivotY + s * FOLLOW_SPOT_LAMP.shadowOffsetY,
      s * FOLLOW_SPOT_LAMP.shadowRadiusX,
      s * FOLLOW_SPOT_LAMP.shadowRadiusY,
      FOLLOW_SPOT_LAMP.shadowAlpha,
    );
    const plateLeft = pivotX - s * FOLLOW_SPOT_LAMP.plateHalfWidth;
    const plateTop = oy + s * (BRACKET_Y - FOLLOW_SPOT_LAMP.plateRise);
    const plateWidth = s * FOLLOW_SPOT_LAMP.plateWidth;
    const plateHeight = s * FOLLOW_SPOT_LAMP.plateHeight;
    ctx.beginPath();
    ctx.rect(plateLeft, plateTop, plateWidth, plateHeight);
    ctx.fillStyle = litFill(ctx, plateLeft, plateTop, plateWidth, plateHeight, IRON);
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.rect(
      pivotX - (s * YOKE_WIDTH) / 2,
      oy + s * BRACKET_Y,
      s * YOKE_WIDTH,
      pivotY - oy - s * BRACKET_Y,
    );
    ctx.fillStyle = litColumn(ctx, pivotX - (s * YOKE_WIDTH) / 2, s * YOKE_WIDTH, BRASS);
    ctx.fill();
    outline(ctx, s);

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(aim);
    const length = s * (LAMP_BACK + FOLLOW_SPOT_LENS_REACH);
    const halfWidth = s * LAMP_HALF_WIDTH;
    // The drum: brass, lit across its width from whichever side faces up-left.
    const upLeftSide = Math.sin(aim) + Math.cos(aim) > 0 ? -1 : 1;
    const drum = ctx.createLinearGradient(0, upLeftSide * halfWidth, 0, -upLeftSide * halfWidth);
    drum.addColorStop(0, paint(BRASS.accent));
    drum.addColorStop(FOLLOW_SPOT_LAMP.drumShadeStop, paint(BRASS.mid));
    drum.addColorStop(1, paint(BRASS.shadow));
    ctx.beginPath();
    ctx.roundRect(
      -s * LAMP_BACK,
      -halfWidth,
      length,
      halfWidth * 2,
      s * FOLLOW_SPOT_LAMP.drumCorner,
    );
    ctx.fillStyle = drum;
    ctx.fill();
    outline(ctx, s);
    // Cooling fins round the lamphouse.
    ctx.strokeStyle = paint(BRASS.shadow);
    ctx.lineWidth = Math.max(1, s * FOLLOW_SPOT_LAMP.finWidth);
    ctx.beginPath();
    for (let fin = 0; fin < FOLLOW_SPOT_LAMP.fins; fin++) {
      const finX =
        -s * LAMP_BACK + s * (FOLLOW_SPOT_LAMP.firstFin + fin * FOLLOW_SPOT_LAMP.finSpacing);
      ctx.moveTo(finX, -halfWidth);
      ctx.lineTo(finX, halfWidth);
    }
    ctx.stroke();
    // The yoke's fork, either side of the drum at the pivot.
    ctx.fillStyle = paint(IRON.mid);
    const forkLeft = -s * FOLLOW_SPOT_LAMP.forkHalfWidth;
    const forkWidth = s * FOLLOW_SPOT_LAMP.forkWidth;
    const forkDepth = s * FOLLOW_SPOT_LAMP.forkDepth;
    ctx.fillRect(forkLeft, -halfWidth - forkDepth, forkWidth, forkDepth);
    ctx.fillRect(forkLeft, halfWidth, forkWidth, forkDepth);
    // The lens barrel and its iris shutter.
    const lensX = s * FOLLOW_SPOT_LENS_REACH;
    ctx.beginPath();
    ctx.ellipse(
      lensX,
      0,
      s * FOLLOW_SPOT_LAMP.barrelRadiusX,
      s * LAMP_LENS_RADIUS * FOLLOW_SPOT_LAMP.barrelFlare,
      0,
      0,
      TAU,
    );
    ctx.fillStyle = paint(IRON.light);
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    const glassX = lensX + s * FOLLOW_SPOT_LAMP.lensInset;
    ctx.ellipse(glassX, 0, s * FOLLOW_SPOT_LAMP.lensRadiusX, s * LAMP_LENS_RADIUS, 0, 0, TAU);
    if (open) {
      ctx.fillStyle = paint(LIMELIGHT.accent);
      ctx.fill();
    } else {
      ctx.fillStyle = paint(IRON.shadow);
      ctx.fill();
      ctx.strokeStyle = paint(IRON.accent, FOLLOW_SPOT_LAMP.irisAlpha);
      ctx.lineWidth = Math.max(1, s * FOLLOW_SPOT_LAMP.irisWidth);
      ctx.beginPath();
      ctx.moveTo(glassX, -s * LAMP_LENS_RADIUS);
      ctx.lineTo(glassX, s * LAMP_LENS_RADIUS);
      ctx.moveTo(
        lensX - s * FOLLOW_SPOT_LAMP.lensInset,
        -s * LAMP_LENS_RADIUS * FOLLOW_SPOT_LAMP.irisBladeSpan,
      );
      ctx.lineTo(
        lensX + s * FOLLOW_SPOT_LAMP.irisBladeReach,
        s * LAMP_LENS_RADIUS * FOLLOW_SPOT_LAMP.irisBladeSpan,
      );
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, s * FOLLOW_SPOT_LAMP.pivotCapRadius, 0, TAU);
    ctx.fillStyle = paint(BRASS.accent);
    ctx.fill();
    outline(ctx, s);
  };
}

function aimStepOf(aimRadians: number): number {
  const step = Math.round((aimRadians / TAU) * FOLLOW_SPOT_AIM_STEPS);
  return ((step % FOLLOW_SPOT_AIM_STEPS) + FOLLOW_SPOT_AIM_STEPS) % FOLLOW_SPOT_AIM_STEPS;
}

/**
 * An usher's follow-spot on the drape at the far end of its lane: a brass
 * lamphouse on a yoke, aimed at `aimRadians` (screen angle, 0 east, a quarter
 * turn south), its iris shutter open or shut.
 */
export function drawFollowSpotLamp(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  aimRadians: number,
  shutterOpen: boolean,
): void {
  const step = aimStepOf(aimRadians);
  drawBigTopProp(
    ctx,
    { prop: 'followSpot', state: shutterOpen ? 'open' : 'shut', frame: step },
    FOLLOW_SPOT_BOX,
    followSpotPainter(step, shutterOpen),
    x,
    y,
    size,
  );
}

const CONE_LENS_HALF_WIDTH = 0.07;
const CONE_FOOT_HALF_WIDTH = 0.45;
const CONE_LENS_ALPHA = 0.28;
/**
 * The cone fades out this far short of the cell it has caught, in tiles. The
 * pool on that cell is the hazard, drawn over the stage lights at full
 * strength; light added under its translucent edge would tint the warning.
 */
const CONE_STOP_SHORT_TILES = 0.95;

/** A rectangle in screen pixels the cone may not leave. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The follow-spot's beam through the air, lens to floor: a faint additive
 * cone, clipped to the lane it lights so it never spills across a wall.
 */
export function drawFollowSpotCone(
  ctx: Ctx,
  lensX: number,
  lensY: number,
  targetX: number,
  targetY: number,
  size: number,
  strength: number,
  lane: ScreenRect,
): void {
  if (strength <= 0) return;
  const fullLength = Math.hypot(targetX - lensX, targetY - lensY);
  const length = fullLength - size * CONE_STOP_SHORT_TILES;
  if (length < 1) return;
  const dirX = (targetX - lensX) / fullLength;
  const dirY = (targetY - lensY) / fullLength;
  const endX = lensX + dirX * length;
  const endY = lensY + dirY * length;
  const normalX = -dirY;
  const normalY = dirX;
  const lensHalf = size * CONE_LENS_HALF_WIDTH;
  const footHalf =
    lensHalf + (size * CONE_FOOT_HALF_WIDTH - lensHalf) * (length / Math.max(1, fullLength));
  ctx.save();
  ctx.beginPath();
  ctx.rect(lane.x, lane.y, lane.width, lane.height);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(lensX, lensY, endX, endY);
  beam.addColorStop(0, paint(LIMELIGHT.light, CONE_LENS_ALPHA * strength));
  beam.addColorStop(1, paint(LIMELIGHT.mid, 0));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(lensX + normalX * lensHalf, lensY + normalY * lensHalf);
  ctx.lineTo(endX + normalX * footHalf, endY + normalY * footHalf);
  ctx.lineTo(endX - normalX * footHalf, endY - normalY * footHalf);
  ctx.lineTo(lensX - normalX * lensHalf, lensY - normalY * lensHalf);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── The ringmaster's feeding bell ────────────────────────────────────────────

const BELL_BOX: BigTopPropBox = { left: -0.15, top: -0.95, width: 1.3, height: 1.95 };
const BELL_POST_WIDTH = 0.13;
const BELL_POST_TOP = -0.78;
const BELL_FOOT_Y = 0.86;
const BELL_STRIPES = 7;
const BELL_ARM_HALF = 0.24;
const BELL_PIVOT_Y = -0.7;
const BELL_RADIUS = 0.19;
const BELL_HEIGHT = 0.3;
const BELL_ROPE_DROP = 0.55;
/** The widest swing, at the start of a hold; it dies away with the hold. */
const BELL_MAX_SWING_RADIANS = 0.5;
/** A full swing takes about two-thirds of a second: slow enough to count. */
const BELL_SWING_RADIANS_PER_FRAME = 0.16;
const BELL_SWING_STEPS = 4;
const BELL_DULL_ALPHA = 0.45;
const BELL_RING_ARCS = 2;
const BELL_RING_ARC_STEP = 0.12;
const BELL_RING_ALPHA = 0.55;
const BELL_RING_LINE_WIDTH = 0.04;
/** The ring lines sit a little below the bell's crown, level with its sound bow. */
const BELL_RING_CENTRE = 0.6;
const BELL_RING_ARC_HALF_RADIANS = 0.5;
/** The bell's base plate, striped post, gallows arm, finial, rope and cast body, as tile fractions. */
const BELL = {
  shadowOffsetX: 0.05,
  shadowRadiusX: 0.3,
  shadowRadiusY: 0.08,
  footLift: 0.02,
  footRadiusX: 0.2,
  footRadiusY: 0.06,
  footLightTop: 0.08,
  footLightWidth: 0.4,
  footLightHeight: 0.12,
  postFootGap: 0.02,
  postSheenAlpha: 0.35,
  armHeight: 0.05,
  finialRise: 0.06,
  finialRadius: 0.055,
  finialLightTop: 0.11,
  ropeLightHalfWidth: 0.02,
  ropeLightWidth: 0.04,
  ropeWidth: 0.035,
  toggleRadiusX: 0.035,
  toggleRadiusY: 0.06,
  /** The waist's control points, as a share of the mouth's radius. */
  waist: 0.7,
  waistDrop: 0.1,
  lipSag: 0.05,
  highlightAlpha: 0.8,
  highlightWidth: 0.02,
  highlightTopX: 0.45,
  highlightTopY: 0.08,
  highlightBendX: 0.7,
  highlightBendY: 0.18,
  highlightFootX: 0.8,
  highlightFootY: 0.26,
} as const;

function bellPainter(swingStep: number, dull: boolean): Painter {
  const swing = (swingStep / BELL_SWING_STEPS) * BELL_MAX_SWING_RADIANS;
  return (ctx, ox, oy, s) => {
    const cx = ox + s * 0.5;
    const footY = oy + s * BELL_FOOT_Y;
    const postTop = oy + s * BELL_POST_TOP;
    const postWidth = s * BELL_POST_WIDTH;
    contactShadow(
      ctx,
      cx + s * BELL.shadowOffsetX,
      footY,
      s * BELL.shadowRadiusX,
      s * BELL.shadowRadiusY,
    );
    ctx.beginPath();
    ctx.ellipse(
      cx,
      footY - s * BELL.footLift,
      s * BELL.footRadiusX,
      s * BELL.footRadiusY,
      0,
      0,
      TAU,
    );
    ctx.fillStyle = litFill(
      ctx,
      cx - s * BELL.footRadiusX,
      footY - s * BELL.footLightTop,
      s * BELL.footLightWidth,
      s * BELL.footLightHeight,
      IRON,
    );
    ctx.fill();
    outline(ctx, s);

    // The striped post, barber-pole fashion, in Donut's red and bone.
    const traceP = (): void => {
      ctx.beginPath();
      ctx.rect(cx - postWidth / 2, postTop, postWidth, footY - postTop - s * BELL.postFootGap);
    };
    traceP();
    ctx.fillStyle = paint(BONE.light);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const stripeStep = (footY - postTop) / BELL_STRIPES;
    ctx.fillStyle = paint(STAGE_RED.mid);
    for (let stripe = -1; stripe < BELL_STRIPES + 1; stripe++) {
      const top = postTop + stripeStep * stripe;
      ctx.beginPath();
      ctx.moveTo(cx - postWidth, top + stripeStep * 0.5);
      ctx.lineTo(cx + postWidth, top);
      ctx.lineTo(cx + postWidth, top + stripeStep * 0.5);
      ctx.lineTo(cx - postWidth, top + stripeStep);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = litColumn(ctx, cx - postWidth / 2, postWidth, {
      shadow: INK,
      mid: INK,
      light: INK,
      accent: BONE.accent,
    });
    ctx.globalAlpha = BELL.postSheenAlpha;
    ctx.fillRect(cx - postWidth / 2, postTop, postWidth, footY - postTop);
    ctx.restore();
    traceP();
    outline(ctx, s);

    // The gallows arm across the top, and the gilt finial.
    ctx.beginPath();
    ctx.rect(cx - s * BELL_ARM_HALF, postTop, s * BELL_ARM_HALF * 2, s * BELL.armHeight);
    ctx.fillStyle = litFill(
      ctx,
      cx - s * BELL_ARM_HALF,
      postTop,
      s * BELL_ARM_HALF * 2,
      s * BELL.armHeight,
      IRON,
    );
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    const finialRadius = s * BELL.finialRadius;
    ctx.arc(cx, postTop - s * BELL.finialRise, finialRadius, 0, TAU);
    ctx.fillStyle = litFill(
      ctx,
      cx - finialRadius,
      postTop - s * BELL.finialLightTop,
      finialRadius * 2,
      finialRadius * 2,
      GILT,
    );
    ctx.fill();
    outline(ctx, s);

    const pivotY = oy + s * BELL_PIVOT_Y;
    ctx.save();
    ctx.translate(cx, pivotY);
    ctx.rotate(swing);
    // The pull rope and its bone toggle, the thing a cat can actually reach.
    ctx.strokeStyle = litColumn(ctx, -s * BELL.ropeLightHalfWidth, s * BELL.ropeLightWidth, BONE);
    ctx.lineWidth = Math.max(1, s * BELL.ropeWidth);
    ctx.beginPath();
    ctx.moveTo(0, s * BELL_HEIGHT);
    ctx.lineTo(0, s * (BELL_HEIGHT + BELL_ROPE_DROP));
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(
      0,
      s * (BELL_HEIGHT + BELL_ROPE_DROP),
      s * BELL.toggleRadiusX,
      s * BELL.toggleRadiusY,
      0,
      0,
      TAU,
    );
    ctx.fillStyle = paint(STAGE_RED.light);
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.moveTo(-s * BELL_RADIUS, s * BELL_HEIGHT);
    const waistX = s * BELL_RADIUS * BELL.waist;
    const waistY = s * BELL.waistDrop;
    ctx.bezierCurveTo(-waistX, waistY, -waistX, 0, 0, 0);
    ctx.bezierCurveTo(waistX, 0, waistX, waistY, s * BELL_RADIUS, s * BELL_HEIGHT);
    ctx.quadraticCurveTo(0, s * (BELL_HEIGHT + BELL.lipSag), -s * BELL_RADIUS, s * BELL_HEIGHT);
    ctx.closePath();
    ctx.fillStyle = litFill(ctx, -s * BELL_RADIUS, 0, s * BELL_RADIUS * 2, s * BELL_HEIGHT, GILT);
    ctx.fill();
    outline(ctx, s);
    ctx.strokeStyle = paint(GILT.accent, BELL.highlightAlpha);
    ctx.lineWidth = Math.max(1, s * BELL.highlightWidth);
    ctx.beginPath();
    ctx.moveTo(-s * BELL_RADIUS * BELL.highlightTopX, s * BELL.highlightTopY);
    ctx.quadraticCurveTo(
      -s * BELL_RADIUS * BELL.highlightBendX,
      s * BELL.highlightBendY,
      -s * BELL_RADIUS * BELL.highlightFootX,
      s * BELL.highlightFootY,
    );
    ctx.stroke();
    if (dull) {
      ctx.fillStyle = paint(INK, BELL_DULL_ALPHA);
      ctx.fill();
    }
    ctx.restore();
  };
}

/**
 * The ringmaster's feeding bell on its striped post. While it holds, it
 * swings, and the swing dies away as the hold runs out: the arc is the clock.
 */
export function drawFeedingBell(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: MazeBellArt,
): void {
  const cx = x + size / 2;
  const strength = pulseStrength(state.phase, state.pulsing);
  paintPulseHalo(ctx, cx, y + size / 2, size, strength, GILT.accent);
  const remaining = state.holding ? Math.max(0, Math.min(1, state.holdFraction)) : 0;
  const swing = remaining * Math.sin(state.phase * BELL_SWING_RADIANS_PER_FRAME);
  const swingStep = Math.round(swing * BELL_SWING_STEPS);
  const dull = !state.ready && !state.holding;
  drawBigTopProp(
    ctx,
    { prop: 'feedingBell', state: dull ? 'dull' : 'bright', frame: swingStep },
    BELL_BOX,
    bellPainter(swingStep, dull),
    x,
    y,
    size,
  );
  if (remaining > 0) {
    const bellY = y + size * (BELL_PIVOT_Y + BELL_HEIGHT * BELL_RING_CENTRE);
    ctx.save();
    ctx.strokeStyle = paint(LIMELIGHT.accent, BELL_RING_ALPHA * remaining);
    ctx.lineWidth = Math.max(1, size * BELL_RING_LINE_WIDTH);
    for (let arc = 1; arc <= BELL_RING_ARCS; arc++) {
      const radius = size * (BELL_RADIUS + BELL_RING_ARC_STEP * arc);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        const centre = side > 0 ? 0 : Math.PI;
        ctx.arc(
          cx,
          bellY,
          radius,
          centre - BELL_RING_ARC_HALF_RADIANS,
          centre + BELL_RING_ARC_HALF_RADIANS,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  paintDonutHoop(ctx, cx, y + size / 2, size, strength);
  paintImpact(ctx, cx, y + size * (BELL_PIVOT_Y + BELL_HEIGHT / 2), size, state.struck);
}

/** The trough's tapered box, its swill, and its iron band, as tile fractions. */
const TROUGH = {
  top: 0.58,
  bottom: 0.9,
  shadowRadiusX: 0.44,
  shadowRadiusY: 0.05,
  rimLeft: 0.06,
  rimRight: 0.94,
  footRight: 0.86,
  footLeft: 0.14,
  lumps: 6,
  firstLumpX: 0.18,
  lumpSpacing: 0.13,
  lumpLift: 0.01,
  lumpRadiusX: 0.07,
  lumpRadiusY: 0.045,
  lumpToneJitter: 10,
  wispAlpha: 0.8,
  wispWidth: 0.015,
  wisps: 6,
  wispLeft: 0.15,
  wispSpread: 0.7,
  wispLean: 0.12,
  wispLength: 0.06,
  bandLightHeight: 0.05,
  bandLeft: 0.1,
  bandDrop: 0.12,
  bandWidth: 0.8,
  bandHeight: 0.04,
} as const;

function paintFeedTrough(ctx: Ctx, ox: number, oy: number, s: number): void {
  const rng = propRng('feedTrough');
  const top = oy + s * TROUGH.top;
  const bottom = oy + s * TROUGH.bottom;
  contactShadow(ctx, ox + s * 0.5, bottom, s * TROUGH.shadowRadiusX, s * TROUGH.shadowRadiusY);
  ctx.beginPath();
  ctx.moveTo(ox + s * TROUGH.rimLeft, top);
  ctx.lineTo(ox + s * TROUGH.rimRight, top);
  ctx.lineTo(ox + s * TROUGH.footRight, bottom);
  ctx.lineTo(ox + s * TROUGH.footLeft, bottom);
  ctx.closePath();
  ctx.fillStyle = litFill(ctx, ox, top, s, bottom - top, ROT_TIMBER);
  ctx.fill();
  outline(ctx, s);
  // The swill heaped in it: offal and straw, gone dark.
  for (let lump = 0; lump < TROUGH.lumps; lump++) {
    ctx.beginPath();
    ctx.ellipse(
      ox + s * (TROUGH.firstLumpX + lump * TROUGH.lumpSpacing),
      top - s * TROUGH.lumpLift,
      s * TROUGH.lumpRadiusX,
      s * TROUGH.lumpRadiusY,
      rng(),
      0,
      TAU,
    );
    const lumpTone = lump % 2 === 0 ? BLOOD.mid : BLOOD.shadow;
    ctx.fillStyle = paint(jitterTone(lumpTone, rng, TROUGH.lumpToneJitter));
    ctx.fill();
  }
  ctx.strokeStyle = paint(STRAW.light, TROUGH.wispAlpha);
  ctx.lineWidth = Math.max(1, s * TROUGH.wispWidth);
  ctx.beginPath();
  for (let wisp = 0; wisp < TROUGH.wisps; wisp++) {
    const wispX = ox + s * (TROUGH.wispLeft + rng() * TROUGH.wispSpread);
    ctx.moveTo(wispX, top);
    ctx.lineTo(wispX + s * (rng() - 0.5) * TROUGH.wispLean, top - s * TROUGH.wispLength);
  }
  ctx.stroke();
  ctx.fillStyle = litFill(ctx, ox, top, s, s * TROUGH.bandLightHeight, IRON);
  ctx.fillRect(
    ox + s * TROUGH.bandLeft,
    top + s * TROUGH.bandDrop,
    s * TROUGH.bandWidth,
    s * TROUGH.bandHeight,
  );
}

/** The feeding trough beside a bell, on the drape at its foot: where the follow-spots turn at feeding time. */
export function drawFeedTrough(ctx: Ctx, x: number, y: number, size: number): void {
  drawBigTopProp(
    ctx,
    { prop: 'feedTrough', state: 'full', frame: 0 },
    ONE_TILE_BOX,
    paintFeedTrough,
    x,
    y,
    size,
  );
}

// ── The dead audience ────────────────────────────────────────────────────────

type SpectatorLook = 'bowler' | 'bare' | 'bonnet' | 'child';
const SPECTATOR_LOOKS: ReadonlyArray<SpectatorLook> = [
  'bowler',
  'bare',
  'bowler',
  'bonnet',
  'bare',
  'child',
];
/** The clapper's loop: six frames at a slow, broken rhythm of about one clap a second. */
const CLAP_FRAMES = 6;
const CLAP_FRAMES_PER_STEP = 10;
const CLAP_SPREAD: ReadonlyArray<number> = [1, 0.6, 0.1, 0, 0.3, 0.8];
const SPECTATOR_BOX: BigTopPropBox = { left: 0, top: -0.3, width: 1, height: 1.3 };
const BENCH_Y = 0.78;
const BENCH_HEIGHT = 0.12;
/** The audience is dead and sits in the dark: a rim of light and little else. */
const SPECTATOR_RIM_ALPHA = 0.55;

/** One of the dead audience, as tile fractions; head-wear terms are shares of the head's radius. */
const SPECTATOR = {
  tierY: 0.34,
  tierHeight: 0.06,
  childScale: 0.72,
  slumpRange: 0.5,
  seatScatter: 0.12,
  torsoHeight: 0.38,
  coatDrab: 0.5,
  coatToneJitter: 6,
  slumpLean: 0.4,
  hipHalfWidth: 0.17,
  shoulderHalfWidth: 0.14,
  shoulderDrop: 0.04,
  neckRise: 0.03,
  rimWidth: 0.02,
  armMinPx: 1.5,
  armWidth: 0.06,
  armRootDrop: 0.06,
  deadHandHalfWidth: 0.16,
  deadHandLift: 0.02,
  clapHandDrop: 0.2,
  clapMinSpread: 0.02,
  clapSpread: 0.1,
  handRadius: 0.03,
  slumpHeadShift: 0.1,
  headRise: 0.06,
  slumpHeadDrop: 0.05,
  headRadius: 0.09,
  skinPallor: 0.4,
  /** The rim light on the crown, in half-turns from east. */
  rimArcStart: 1.05,
  rimArcEnd: 1.6,
  brimDrop: 0.55,
  brimReach: 1.45,
  brimDepth: 0.28,
  brimTilt: 0.3,
  crownDrop: 0.6,
  crownRadius: 0.95,
  crownSheenAlpha: 0.6,
  crownSheenWidth: 0.015,
  crownSheenArcStart: 1.1,
  crownSheenArcEnd: 1.5,
  bonnetDrop: 0.1,
  bonnetRadius: 1.25,
  bonnetArcStart: 0.9,
  bonnetArcEnd: 2.1,
  bonnetFade: 0.4,
  balloonHandLift: 0.04,
  balloonOffsetX: 0.08,
  balloonRise: 0.12,
  stringAlpha: 0.7,
  stringWidth: 0.012,
  stringPullX: 0.1,
  stringPullY: 0.3,
  stringSagX: 0.08,
  stringSagY: 0.3,
  stringTie: 0.1,
  balloonRadiusX: 0.08,
  balloonRadiusY: 0.1,
  balloonTilt: 0.4,
} as const;

function spectatorPainter(look: SpectatorLook, slumpSeed: number, clap: number | null): Painter {
  return (ctx, ox, oy, s) => {
    const rng = propRng(`spectator${look}${slumpSeed}`);
    // The tier behind, and the bench this one sits on.
    ctx.fillStyle = paint(BACKSTAGE.mid);
    ctx.fillRect(ox, oy + s * SPECTATOR.tierY, s, s * SPECTATOR.tierHeight);
    const benchTop = oy + s * BENCH_Y;
    ctx.beginPath();
    ctx.rect(ox, benchTop, s, s * BENCH_HEIGHT);
    ctx.fillStyle = litFill(ctx, ox, benchTop, s, s * BENCH_HEIGHT, {
      shadow: ROT_TIMBER.shadow,
      mid: blend(ROT_TIMBER.shadow, ROT_TIMBER.mid, 0.5),
      light: ROT_TIMBER.mid,
      accent: ROT_TIMBER.light,
    });
    ctx.fill();
    outline(ctx, s);

    const child = look === 'child';
    const scale = child ? SPECTATOR.childScale : 1;
    const slump = (rng() - 0.5) * SPECTATOR.slumpRange;
    const cx = ox + s * (0.5 + (rng() - 0.5) * SPECTATOR.seatScatter);
    const hipY = benchTop;
    const shoulderY = hipY - s * SPECTATOR.torsoHeight * scale;
    const coat = jitterTone(
      look === 'bonnet' ? BLOOD.shadow : blend(NAVY.shadow, BACKSTAGE.accent, SPECTATOR.coatDrab),
      rng,
      SPECTATOR.coatToneJitter,
    );
    ctx.save();
    ctx.translate(cx, hipY);
    ctx.rotate(slump * SPECTATOR.slumpLean);
    ctx.translate(-cx, -hipY);
    const hipHalf = s * SPECTATOR.hipHalfWidth * scale;
    const shoulderHalf = s * SPECTATOR.shoulderHalfWidth * scale;
    const shoulderEdgeY = shoulderY + s * SPECTATOR.shoulderDrop;
    const traceTorso = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx - hipHalf, hipY);
      ctx.lineTo(cx - shoulderHalf, shoulderEdgeY);
      ctx.quadraticCurveTo(
        cx,
        shoulderY - s * SPECTATOR.neckRise,
        cx + shoulderHalf,
        shoulderEdgeY,
      );
      ctx.lineTo(cx + hipHalf, hipY);
      ctx.closePath();
    };
    traceTorso();
    ctx.fillStyle = paint(coat);
    ctx.fill();
    outline(ctx, s);
    traceTorso();
    ctx.strokeStyle = paint(BONE.mid, SPECTATOR_RIM_ALPHA);
    ctx.lineWidth = Math.max(1, s * SPECTATOR.rimWidth);
    ctx.stroke();

    // Arms: hanging dead, or clapping for a show that stopped long ago.
    ctx.strokeStyle = paint(coat);
    ctx.lineWidth = Math.max(SPECTATOR.armMinPx, s * SPECTATOR.armWidth * scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const armRootY = shoulderY + s * SPECTATOR.armRootDrop;
    const clapHandY = shoulderY + s * SPECTATOR.clapHandDrop;
    const clapSpread = (open: number): number =>
      s * (SPECTATOR.clapMinSpread + open * SPECTATOR.clapSpread);
    if (clap === null) {
      const deadHandHalf = s * SPECTATOR.deadHandHalfWidth * scale;
      const deadHandY = hipY - s * SPECTATOR.deadHandLift;
      ctx.moveTo(cx - shoulderHalf, armRootY);
      ctx.lineTo(cx - deadHandHalf, deadHandY);
      ctx.moveTo(cx + shoulderHalf, armRootY);
      ctx.lineTo(cx + deadHandHalf, deadHandY);
    } else {
      const spread = clapSpread(clap);
      ctx.moveTo(cx - s * SPECTATOR.shoulderHalfWidth, armRootY);
      ctx.lineTo(cx - spread, clapHandY);
      ctx.moveTo(cx + s * SPECTATOR.shoulderHalfWidth, armRootY);
      ctx.lineTo(cx + spread, clapHandY);
    }
    ctx.stroke();
    if (clap !== null) {
      const spread = clapSpread(clap);
      ctx.fillStyle = paint(BONE.shadow);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * spread, clapHandY, s * SPECTATOR.handRadius, 0, TAU);
        ctx.fill();
      }
    }

    // The head, dropped forward or lolled to one side.
    const headX = cx + slump * s * SPECTATOR.slumpHeadShift;
    const headY =
      shoulderY - s * SPECTATOR.headRise * scale + Math.abs(slump) * s * SPECTATOR.slumpHeadDrop;
    const headRadius = s * SPECTATOR.headRadius * scale;
    ctx.beginPath();
    ctx.arc(headX, headY, headRadius, 0, TAU);
    ctx.fillStyle = paint(blend(BONE.shadow, BACKSTAGE.accent, SPECTATOR.skinPallor));
    ctx.fill();
    outline(ctx, s);
    ctx.strokeStyle = paint(BONE.mid, SPECTATOR_RIM_ALPHA);
    ctx.lineWidth = Math.max(1, s * SPECTATOR.rimWidth);
    ctx.beginPath();
    ctx.arc(
      headX,
      headY,
      headRadius,
      Math.PI * SPECTATOR.rimArcStart,
      Math.PI * SPECTATOR.rimArcEnd,
    );
    ctx.stroke();
    switch (look) {
      case 'bowler': {
        ctx.beginPath();
        ctx.ellipse(
          headX,
          headY - headRadius * SPECTATOR.brimDrop,
          headRadius * SPECTATOR.brimReach,
          headRadius * SPECTATOR.brimDepth,
          slump * SPECTATOR.brimTilt,
          0,
          TAU,
        );
        const crownY = headY - headRadius * SPECTATOR.crownDrop;
        const crownRadius = headRadius * SPECTATOR.crownRadius;
        ctx.arc(headX, crownY, crownRadius, Math.PI, 0);
        ctx.fillStyle = paint(INK);
        ctx.fill();
        ctx.strokeStyle = paint(BONE.shadow, SPECTATOR.crownSheenAlpha);
        ctx.lineWidth = Math.max(1, s * SPECTATOR.crownSheenWidth);
        ctx.beginPath();
        ctx.arc(
          headX,
          crownY,
          crownRadius,
          Math.PI * SPECTATOR.crownSheenArcStart,
          Math.PI * SPECTATOR.crownSheenArcEnd,
        );
        ctx.stroke();
        break;
      }
      case 'bonnet': {
        ctx.beginPath();
        ctx.arc(
          headX,
          headY - headRadius * SPECTATOR.bonnetDrop,
          headRadius * SPECTATOR.bonnetRadius,
          Math.PI * SPECTATOR.bonnetArcStart,
          Math.PI * SPECTATOR.bonnetArcEnd,
        );
        ctx.fillStyle = paint(blend(BLOOD.mid, BACKSTAGE.accent, SPECTATOR.bonnetFade));
        ctx.fill();
        outline(ctx, s);
        break;
      }
      case 'child': {
        // A balloon string up out of a small hand, to a balloon gone slack.
        const handX = cx + shoulderHalf;
        const handY = hipY - s * SPECTATOR.balloonHandLift;
        const balloonX = handX + s * SPECTATOR.balloonOffsetX;
        const balloonY = oy - s * SPECTATOR.balloonRise;
        ctx.strokeStyle = paint(BONE.mid, SPECTATOR.stringAlpha);
        ctx.lineWidth = Math.max(1, s * SPECTATOR.stringWidth);
        ctx.beginPath();
        ctx.moveTo(handX, handY);
        ctx.bezierCurveTo(
          handX + s * SPECTATOR.stringPullX,
          handY - s * SPECTATOR.stringPullY,
          balloonX - s * SPECTATOR.stringSagX,
          balloonY + s * SPECTATOR.stringSagY,
          balloonX,
          balloonY + s * SPECTATOR.stringTie,
        );
        ctx.stroke();
        const balloonRadiusX = s * SPECTATOR.balloonRadiusX;
        const balloonRadiusY = s * SPECTATOR.balloonRadiusY;
        ctx.beginPath();
        ctx.ellipse(
          balloonX,
          balloonY,
          balloonRadiusX,
          balloonRadiusY,
          SPECTATOR.balloonTilt,
          0,
          TAU,
        );
        ctx.fillStyle = litFill(
          ctx,
          balloonX - balloonRadiusX,
          balloonY - balloonRadiusY,
          balloonRadiusX * 2,
          balloonRadiusY * 2,
          STAGE_RED,
        );
        ctx.fill();
        outline(ctx, s);
        break;
      }
      case 'bare':
        break;
    }
    ctx.restore();
  };
}

const HASH_SALT_LOOK = 17.3;

/**
 * One of the dead audience in the menagerie's bleachers. `clapping` makes this
 * the one still applauding, a slow loop for a show that ended years ago.
 */
export function drawBleacherSpectator(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  seed: number,
  clapping: boolean,
  phase: number,
): void {
  const lookIndex = Math.floor(seedUnit(seed, HASH_SALT_LOOK) * SPECTATOR_LOOKS.length);
  const look = clapping ? 'bare' : (SPECTATOR_LOOKS[lookIndex] ?? 'bare');
  const frame = clapping ? loopFrame(phase, CLAP_FRAMES, CLAP_FRAMES_PER_STEP) : 0;
  const clap = clapping ? (CLAP_SPREAD[frame] ?? 0) : null;
  drawBigTopProp(
    ctx,
    { prop: 'spectator', state: `${look}|${seed}|${clapping ? 'clap' : 'still'}`, frame },
    SPECTATOR_BOX,
    spectatorPainter(look, seed, clap),
    x,
    y,
    size,
  );
}

// ── Donut's release ring on its chain ────────────────────────────────────────

const RING_LATCH_HEIGHT = 0.08;
const RING_CHAIN_LINKS = 6;
const RING_LINK_STEP = 0.07;
const RING_CENTRE_Y = 0.62;
const RING_RADIUS = 0.16;
const RING_THICKNESS = 0.06;
const RING_SWAY_FRAMES = 8;
const RING_SWAY_FRAMES_PER_STEP = 16;
const RING_SWAY_TILES = 0.03;
/** Once tripped, only the links still hanging from the latch are drawn. */
const RING_BROKEN_LINKS = 2;
/** The ink line round the ring, in screen pixels: a pixel of outline either side at any zoom. */
const RING_OUTLINE_PX = 2;
const RING_LINK_INK_MIN_PX = 2;
/** The latch, chain, fallen ring and striped grip, as tile fractions. */
const RELEASE_RING = {
  latchHalfWidth: 0.12,
  floorY: 0.9,
  linkWidth: 0.022,
  linkFaceHalfWidth: 0.025,
  linkEdgeHalfWidth: 0.01,
  linkHalfHeight: 0.045,
  linkInkWidth: 0.035,
  linkMetalWidth: 0.018,
  fallenDriftX: 0.1,
  fallenLift: 0.02,
  shadowOffsetX: 0.03,
  shadowRadiusX: 0.2,
  shadowRadiusY: 0.06,
  /** A ring lying on the floor is seen nearly edge-on. */
  fallenFlatten: 0.35,
  gripWraps: 5,
  /** Where the grip starts and how much of the ring each wrap covers, in half-turns. */
  gripStart: 0.3,
  gripWrapArc: 0.1,
  gripThickness: 1.3,
} as const;
/** The blow lands on the ring, which is smaller than the tile the impact is sized for. */
const RING_IMPACT_SCALE = 1.6;

function releaseRingPainter(broken: boolean, swayFrame: number): Painter {
  return (ctx, ox, oy, s) => {
    const cx = ox + s * 0.5;
    const sway = Math.sin((swayFrame / RING_SWAY_FRAMES) * TAU) * s * RING_SWAY_TILES;
    // The cage-door latch the chain trips, up on its bracket.
    ctx.beginPath();
    const latchLeft = cx - s * RELEASE_RING.latchHalfWidth;
    const latchWidth = s * RELEASE_RING.latchHalfWidth * 2;
    ctx.rect(latchLeft, oy, latchWidth, s * RING_LATCH_HEIGHT);
    ctx.fillStyle = litFill(ctx, latchLeft, oy, latchWidth, s * RING_LATCH_HEIGHT, IRON);
    ctx.fill();
    outline(ctx, s);
    const floorY = oy + s * RELEASE_RING.floorY;
    const linkCount = broken ? RING_BROKEN_LINKS : RING_CHAIN_LINKS;
    ctx.lineWidth = Math.max(1, s * RELEASE_RING.linkWidth);
    for (let link = 0; link < linkCount; link++) {
      const along = link / RING_CHAIN_LINKS;
      const linkX = cx + sway * along;
      const linkY = oy + s * (RING_LATCH_HEIGHT + RING_LINK_STEP * (link + 0.5));
      ctx.beginPath();
      const linkHalfWidth =
        link % 2 === 0 ? RELEASE_RING.linkFaceHalfWidth : RELEASE_RING.linkEdgeHalfWidth;
      ctx.ellipse(linkX, linkY, s * linkHalfWidth, s * RELEASE_RING.linkHalfHeight, 0, 0, TAU);
      ctx.strokeStyle = paint(INK);
      ctx.lineWidth = Math.max(RING_LINK_INK_MIN_PX, s * RELEASE_RING.linkInkWidth);
      ctx.stroke();
      ctx.strokeStyle = paint(IRON.accent);
      ctx.lineWidth = Math.max(1, s * RELEASE_RING.linkMetalWidth);
      ctx.stroke();
    }
    const ringX = broken ? cx + s * RELEASE_RING.fallenDriftX : cx + sway;
    const ringY = broken ? floorY - s * RELEASE_RING.fallenLift : oy + s * RING_CENTRE_Y;
    contactShadow(
      ctx,
      ringX + s * RELEASE_RING.shadowOffsetX,
      floorY,
      s * RELEASE_RING.shadowRadiusX,
      s * RELEASE_RING.shadowRadiusY,
    );
    ctx.save();
    ctx.translate(ringX, ringY);
    if (broken) ctx.scale(1, RELEASE_RING.fallenFlatten);
    ctx.beginPath();
    ctx.arc(0, 0, s * RING_RADIUS, 0, TAU);
    ctx.strokeStyle = paint(INK);
    ctx.lineWidth = s * RING_THICKNESS + RING_OUTLINE_PX;
    ctx.stroke();
    ctx.strokeStyle = litFill(
      ctx,
      -s * RING_RADIUS,
      -s * RING_RADIUS,
      s * RING_RADIUS * 2,
      s * RING_RADIUS * 2,
      GILT,
    );
    ctx.lineWidth = s * RING_THICKNESS;
    ctx.stroke();
    // The striped grip bound round the bottom of the ring: hers.
    for (let wrap = 0; wrap < RELEASE_RING.gripWraps; wrap++) {
      const angle = Math.PI * (RELEASE_RING.gripStart + wrap * RELEASE_RING.gripWrapArc);
      ctx.beginPath();
      ctx.arc(0, 0, s * RING_RADIUS, angle, angle + Math.PI * RELEASE_RING.gripWrapArc);
      ctx.strokeStyle = paint(wrap % 2 === 0 ? STAGE_RED.mid : BONE.light);
      ctx.lineWidth = s * RING_THICKNESS * RELEASE_RING.gripThickness;
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** The release ring Donut shoots: a gilt ring on a chain that trips a cage door's latch. */
export function drawCageReleaseRing(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  const cx = x + size / 2;
  const strength = pulseStrength(state.phase, state.pulsing);
  if (!state.broken) paintPulseHalo(ctx, cx, y + size / 2, size, strength, GILT.accent);
  const swayFrame = state.broken
    ? 0
    : loopFrame(state.phase, RING_SWAY_FRAMES, RING_SWAY_FRAMES_PER_STEP);
  drawBigTopProp(
    ctx,
    { prop: 'releaseRing', state: state.broken ? 'tripped' : 'set', frame: swayFrame },
    ONE_TILE_BOX,
    releaseRingPainter(state.broken, swayFrame),
    x,
    y,
    size,
  );
  if (state.broken) return;
  paintDonutHoop(ctx, cx, y + size / 2, size, strength);
  paintImpact(
    ctx,
    cx,
    y + size * RING_CENTRE_Y,
    size,
    state.struck,
    RING_RADIUS * RING_IMPACT_SCALE,
  );
}

// ── Carl's capstan winch ─────────────────────────────────────────────────────

const WINCH_CHEEK_WIDTH = 0.1;
const WINCH_CHEEK_TOP = 0.3;
const WINCH_BASE_Y = 0.86;
const WINCH_DRUM_TOP = 0.42;
const WINCH_DRUM_HEIGHT = 0.26;
const WINCH_GEAR_RADIUS = 0.14;
const WINCH_GEAR_TEETH = 10;
const WINCH_TOOTH_DEPTH = 0.04;
const WINCH_PAWL_LENGTH = 0.2;
/** How far the pawl lifts off the teeth while a blow is turning the drum. */
const WINCH_PAWL_LIFT_RADIANS = 0.7;
/** Rope coils on a fresh drum; each landed turn pays one out. */
const WINCH_FULL_COILS = 5;
/** A broken winch has spun freely and stopped between teeth. */
const WINCH_SPUN_TEETH = 4.5;
/** The bed, cheeks, drum, rope, ratchet, wear marks and pawl, as tile fractions. */
const WINCH = {
  shadowX: 0.52,
  shadowDrop: 0.04,
  shadowRadiusX: 0.44,
  shadowRadiusY: 0.08,
  bedLeft: 0.08,
  bedRise: 0.06,
  bedWidth: 0.84,
  bedHeight: 0.1,
  cheekLeftX: 0.14,
  cheekRightEdge: 0.86,
  cheekFootRise: 0.05,
  cheekTaper: 0.02,
  drumLeft: 0.24,
  drumWidth: 0.52,
  drumSheenStop: 0.35,
  drumBodyStop: 0.6,
  coilWidth: 0.03,
  firstCoil: 0.12,
  coilSpacing: 0.06,
  coilInset: 0.02,
  coilSlant: 0.04,
  hoopWidth: 0.04,
  slackFromX: 0.2,
  slackBendX: 0.2,
  slackMidX: 0.5,
  slackScatter: 0.1,
  slackDrop: 0.02,
  slackEndX: 0.9,
  gearEastX: 0.74,
  gearWestX: 0.26,
  /** How far round each tooth its tip sits: a ratchet's teeth rake one way. */
  toothRake: 0.7,
  gearLightReach: 0.2,
  hubRadius: 0.05,
  firstMark: 0.34,
  markSpacing: 0.12,
  markRise: 0.07,
  markWidth: 0.07,
  markHeight: 0.04,
  pawlOffsetX: 0.02,
  pawlRise: 0.14,
  pawlRestTilt: 0.35,
  pawlRootHalfWidth: 0.025,
  pawlTipRise: 0.01,
  pawlHookReach: 0.02,
  pawlHookDrop: 0.02,
  pawlLightTop: 0.03,
  pawlLightHeight: 0.06,
  pawlPivotRadius: 0.03,
} as const;

function winchPainter(
  facing: 'west' | 'east',
  stage: number,
  pawlUp: boolean,
  broken: boolean,
): Painter {
  return (ctx, ox, oy, s) => {
    const rng = propRng(`winch${facing}${stage}`);
    const baseY = oy + s * WINCH_BASE_Y;
    contactShadow(
      ctx,
      ox + s * WINCH.shadowX,
      baseY + s * WINCH.shadowDrop,
      s * WINCH.shadowRadiusX,
      s * WINCH.shadowRadiusY,
    );
    // The timber bed and its two cheeks.
    const bedTop = baseY - s * WINCH.bedRise;
    ctx.beginPath();
    ctx.rect(ox + s * WINCH.bedLeft, bedTop, s * WINCH.bedWidth, s * WINCH.bedHeight);
    ctx.fillStyle = litFill(ctx, ox, bedTop, s, s * WINCH.bedHeight, ROT_TIMBER);
    ctx.fill();
    outline(ctx, s);
    const cheekFootY = baseY - s * WINCH.cheekFootRise;
    for (const cheekX of [WINCH.cheekLeftX, WINCH.cheekRightEdge - WINCH_CHEEK_WIDTH]) {
      ctx.beginPath();
      ctx.moveTo(ox + s * cheekX, cheekFootY);
      ctx.lineTo(ox + s * (cheekX + WINCH.cheekTaper), oy + s * WINCH_CHEEK_TOP);
      ctx.lineTo(
        ox + s * (cheekX + WINCH_CHEEK_WIDTH - WINCH.cheekTaper),
        oy + s * WINCH_CHEEK_TOP,
      );
      ctx.lineTo(ox + s * (cheekX + WINCH_CHEEK_WIDTH), cheekFootY);
      ctx.closePath();
      ctx.fillStyle = litColumn(ctx, ox + s * cheekX, s * WINCH_CHEEK_WIDTH, ROT_TIMBER);
      ctx.fill();
      outline(ctx, s);
    }
    // The drum: ringmaster blue with brass hoops, the rope wound on it.
    const drumLeft = ox + s * WINCH.drumLeft;
    const drumWidth = s * WINCH.drumWidth;
    const drumTop = oy + s * WINCH_DRUM_TOP;
    const drumHeight = s * WINCH_DRUM_HEIGHT;
    ctx.beginPath();
    ctx.rect(drumLeft, drumTop, drumWidth, drumHeight);
    const drum = ctx.createLinearGradient(0, drumTop, 0, drumTop + drumHeight);
    drum.addColorStop(0, paint(RINGMASTER.light));
    drum.addColorStop(WINCH.drumSheenStop, paint(RINGMASTER.accent));
    drum.addColorStop(WINCH.drumBodyStop, paint(RINGMASTER.mid));
    drum.addColorStop(1, paint(RINGMASTER.shadow));
    ctx.fillStyle = drum;
    ctx.fill();
    outline(ctx, s);
    const coils = broken ? 1 : WINCH_FULL_COILS - stage;
    ctx.strokeStyle = paint(BONE.mid);
    ctx.lineWidth = Math.max(1, s * WINCH.coilWidth);
    ctx.beginPath();
    for (let coil = 0; coil < coils; coil++) {
      const coilX = drumLeft + s * (WINCH.firstCoil + coil * WINCH.coilSpacing);
      ctx.moveTo(coilX, drumTop + s * WINCH.coilInset);
      ctx.lineTo(coilX + s * WINCH.coilSlant, drumTop + drumHeight - s * WINCH.coilInset);
    }
    ctx.stroke();
    const hoopWidth = s * WINCH.hoopWidth;
    ctx.fillStyle = litFill(ctx, drumLeft, drumTop, hoopWidth, drumHeight, BRASS);
    ctx.fillRect(drumLeft, drumTop, hoopWidth, drumHeight);
    ctx.fillRect(drumLeft + drumWidth - hoopWidth, drumTop, hoopWidth, drumHeight);
    if (broken) {
      // Paid out: the rope lies slack across the bed.
      ctx.strokeStyle = paint(BONE.mid);
      ctx.lineWidth = Math.max(1, s * WINCH.coilWidth);
      ctx.beginPath();
      ctx.moveTo(drumLeft + s * WINCH.slackFromX, drumTop + drumHeight);
      ctx.bezierCurveTo(
        ox + s * WINCH.slackBendX,
        baseY,
        ox + s * (WINCH.slackMidX + rng() * WINCH.slackScatter),
        baseY + s * WINCH.slackDrop,
        ox + s * WINCH.slackEndX,
        baseY - s * WINCH.slackDrop,
      );
      ctx.stroke();
    }

    // The ratchet on the side Carl stands, and the pawl that clicks into it.
    const gearX = facing === 'east' ? ox + s * WINCH.gearEastX : ox + s * WINCH.gearWestX;
    const gearY = drumTop + drumHeight / 2;
    const toothAngle = TAU / WINCH_GEAR_TEETH;
    const turn = broken ? toothAngle * WINCH_SPUN_TEETH : stage * toothAngle;
    ctx.beginPath();
    for (let tooth = 0; tooth < WINCH_GEAR_TEETH; tooth++) {
      const angle = turn + tooth * toothAngle;
      const outer = s * (WINCH_GEAR_RADIUS + WINCH_TOOTH_DEPTH);
      const inner = s * WINCH_GEAR_RADIUS;
      ctx.lineTo(gearX + Math.cos(angle) * inner, gearY + Math.sin(angle) * inner);
      ctx.lineTo(
        gearX + Math.cos(angle + toothAngle * WINCH.toothRake) * outer,
        gearY + Math.sin(angle + toothAngle * WINCH.toothRake) * outer,
      );
      ctx.lineTo(
        gearX + Math.cos(angle + toothAngle) * inner,
        gearY + Math.sin(angle + toothAngle) * inner,
      );
    }
    ctx.closePath();
    const gearLightReach = s * WINCH.gearLightReach;
    ctx.fillStyle = litFill(
      ctx,
      gearX - gearLightReach,
      gearY - gearLightReach,
      gearLightReach * 2,
      gearLightReach * 2,
      BRASS,
    );
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.arc(gearX, gearY, s * WINCH.hubRadius, 0, TAU);
    ctx.fillStyle = paint(IRON.light);
    ctx.fill();
    outline(ctx, s);
    // One notch of wear per turn, the count a player reads from across the lane.
    ctx.fillStyle = paint(BONE.accent);
    for (let mark = 0; mark < stage; mark++) {
      ctx.fillRect(
        ox + s * (WINCH.firstMark + mark * WINCH.markSpacing),
        drumTop - s * WINCH.markRise,
        s * WINCH.markWidth,
        s * WINCH.markHeight,
      );
    }
    const pawlPivotX = gearX + (facing === 'east' ? -1 : 1) * s * WINCH.pawlOffsetX;
    const pawlPivotY = gearY - s * (WINCH_GEAR_RADIUS + WINCH.pawlRise);
    const restAngle = Math.PI / 2 + (facing === 'east' ? WINCH.pawlRestTilt : -WINCH.pawlRestTilt);
    const lift = pawlUp || broken ? (facing === 'east' ? -1 : 1) * WINCH_PAWL_LIFT_RADIANS : 0;
    ctx.save();
    ctx.translate(pawlPivotX, pawlPivotY);
    ctx.rotate(restAngle + lift);
    ctx.beginPath();
    ctx.moveTo(0, -s * WINCH.pawlRootHalfWidth);
    ctx.lineTo(s * WINCH_PAWL_LENGTH, -s * WINCH.pawlTipRise);
    ctx.lineTo(s * (WINCH_PAWL_LENGTH + WINCH.pawlHookReach), s * WINCH.pawlHookDrop);
    ctx.lineTo(0, s * WINCH.pawlRootHalfWidth);
    ctx.closePath();
    ctx.fillStyle = litFill(
      ctx,
      0,
      -s * WINCH.pawlLightTop,
      s * WINCH_PAWL_LENGTH,
      s * WINCH.pawlLightHeight,
      IRON,
    );
    ctx.fill();
    outline(ctx, s);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(pawlPivotX, pawlPivotY, s * WINCH.pawlPivotRadius, 0, TAU);
    ctx.fillStyle = paint(BRASS.accent);
    ctx.fill();
    outline(ctx, s);
  };
}

/** Carl's capstan winch: every blow turns the drum a tooth, and the pawl clicks home. */
export function drawCapstanWinch(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  const stage = hitsLanded(state.integrity);
  const cx = x + size / 2;
  const strength = pulseStrength(state.phase, state.pulsing);
  if (!state.broken) paintPulseHalo(ctx, cx, y + size / 2, size, strength, BRASS.accent);
  // The pawl rides up over a tooth while the blow's flash lasts and drops home after: the click.
  const pawlUp = state.struck;
  drawBigTopProp(
    ctx,
    {
      prop: 'capstanWinch',
      state: `${state.facing}|${state.broken ? 'spent' : stage}|${pawlUp ? 'up' : 'home'}`,
      frame: 0,
    },
    ONE_TILE_BOX,
    winchPainter(state.facing, stage, pawlUp, state.broken),
    x,
    y,
    size,
  );
  if (state.broken) return;
  paintCarlChevrons(ctx, cx, y + size / 2, size, state.facing, strength);
  paintImpact(
    ctx,
    cx,
    y + size * (WINCH_DRUM_TOP + WINCH_DRUM_HEIGHT / 2),
    size,
    state.struck,
    WINCH_GEAR_RADIUS * 2,
  );
}

/**
 * Every baked picture this module can ask the cache for, so the art gate can
 * paint each on its own and hold it to the strict canvas and its cell.
 */
export function menageriePropCatalogue(): ReadonlyArray<BigTopPropCatalogueEntry> {
  // A cage front is set into the drape edge to edge; the bleacher bench runs
  // on into the next seat; the release chain climbs to the latch above.
  const benchEdges: ReadonlyArray<BigTopPropEdge> = ['left', 'right'];
  const chainEdge: ReadonlyArray<BigTopPropEdge> = ['top'];
  const entries: BigTopPropCatalogueEntry[] = [
    {
      key: { prop: 'feedTrough', state: 'full', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintFeedTrough,
    },
  ];
  for (const occupant of CAGE_OCCUPANTS) {
    for (let variant = 0; variant < CAGE_VARIANTS; variant++) {
      const look: CageLook = { occupant, variant, gate: false };
      for (let frame = 0; frame < CAGE_IDLE_FRAMES; frame++) {
        entries.push({
          key: { prop: 'cage', state: `${occupant}|${variant}|idle`, frame },
          box: ONE_TILE_BOX,
          painter: cagePainter(look, frame, 0),
          openEdges: EVERY_EDGE,
        });
      }
      if (!occupantLunges(occupant)) continue;
      for (let frame = 0; frame < CAGE_LUNGE_FRAMES; frame++) {
        entries.push({
          key: { prop: 'cage', state: `${occupant}|${variant}|lunge`, frame },
          box: ONE_TILE_BOX,
          painter: cagePainter(look, 0, LUNGE_REACH[frame] ?? 0),
          openEdges: EVERY_EDGE,
        });
      }
    }
  }
  for (let frame = 0; frame < CAGE_IDLE_FRAMES; frame++) {
    entries.push({
      key: { prop: 'cageGate', state: 'shut', frame },
      box: ONE_TILE_BOX,
      painter: cagePainter({ occupant: 'empty', variant: 0, gate: true }, frame, 0),
      openEdges: EVERY_EDGE,
    });
  }
  for (let step = 0; step < FOLLOW_SPOT_AIM_STEPS; step++) {
    for (const open of [true, false]) {
      entries.push({
        key: { prop: 'followSpot', state: open ? 'open' : 'shut', frame: step },
        box: FOLLOW_SPOT_BOX,
        painter: followSpotPainter(step, open),
      });
    }
  }
  for (let swingStep = -BELL_SWING_STEPS; swingStep <= BELL_SWING_STEPS; swingStep++) {
    for (const dull of [false, true]) {
      entries.push({
        key: { prop: 'feedingBell', state: dull ? 'dull' : 'bright', frame: swingStep },
        box: BELL_BOX,
        painter: bellPainter(swingStep, dull),
      });
    }
  }
  for (const seed of SPECTATOR_LOOKS.keys()) {
    const look = SPECTATOR_LOOKS[seed] ?? 'bare';
    entries.push({
      key: { prop: 'spectator', state: `${look}|${seed}|still`, frame: 0 },
      box: SPECTATOR_BOX,
      painter: spectatorPainter(look, seed, null),
      openEdges: benchEdges,
    });
  }
  for (let frame = 0; frame < CLAP_FRAMES; frame++) {
    entries.push({
      key: { prop: 'spectator', state: 'bare|0|clap', frame },
      box: SPECTATOR_BOX,
      painter: spectatorPainter('bare', 0, CLAP_SPREAD[frame] ?? 0),
      openEdges: benchEdges,
    });
  }
  for (let frame = 0; frame < RING_SWAY_FRAMES; frame++) {
    entries.push({
      key: { prop: 'releaseRing', state: 'set', frame },
      box: ONE_TILE_BOX,
      painter: releaseRingPainter(false, frame),
      openEdges: chainEdge,
    });
  }
  entries.push({
    key: { prop: 'releaseRing', state: 'tripped', frame: 0 },
    box: ONE_TILE_BOX,
    painter: releaseRingPainter(true, 0),
    openEdges: chainEdge,
  });
  for (const facing of ['west', 'east'] as const) {
    for (let stage = 0; stage < DAMAGE_STAGE_COUNT; stage++) {
      for (const pawlUp of [false, true]) {
        entries.push({
          key: {
            prop: 'capstanWinch',
            state: `${facing}|${stage}|${pawlUp ? 'up' : 'home'}`,
            frame: 0,
          },
          box: ONE_TILE_BOX,
          painter: winchPainter(facing, stage, pawlUp, false),
        });
      }
    }
    entries.push({
      key: { prop: 'capstanWinch', state: `${facing}|spent|home`, frame: 0 },
      box: ONE_TILE_BOX,
      painter: winchPainter(facing, DAMAGE_STAGE_COUNT, false, true),
    });
  }
  return entries;
}
