/**
 * Where everything on the title screen goes, as a pure function of the
 * viewport. Two compositions: a wide one with the menu in a column beside the
 * heroes (a phone on its side included: a bottom sheet there would cover
 * them), and a tall one with the menu docked under them. Every value is in
 * canvas CSS pixels, the space layers paint in. The hall fills the whole
 * screen; the logo, the heroes, the menu and the lines of text keep inside
 * the safe area.
 */

import type { Rect } from '../../ui/core/geom';
import type { SafeAreaInsets, SizeClass } from '../../ui/core/viewport';
import type { TitleLightRig, TitlePoint, TitleTorchLight } from './titleLayer';

export type TitleComposition = 'landscape' | 'portrait';

/** Every anchor a layer or surface positions itself from. */
export interface TitleStage {
  readonly width: number;
  readonly height: number;
  readonly composition: TitleComposition;
  /** Where the far wall meets the floor. */
  readonly horizonY: number;
  /** The line the heroes stand on. */
  readonly floorY: number;
  /** Between the heroes' feet. */
  readonly heroSpot: TitlePoint;
  /** The scale figures are drawn at so they read at this size. */
  readonly heroScale: number;
  readonly logoRect: Rect;
  /** The room the menu is laid out in. */
  readonly menuRect: Rect;
  /**
   * Whether the menu sits at the foot of its room rather than in its middle:
   * docked under the heroes held upright, and low in its column on a phone on
   * its side, which leaves the System AI room between it and the logo.
   */
  readonly menuAtFoot: boolean;
  /**
   * Where the sound hint and the System AI's line sit beside the menu. In
   * portrait they sit just above the docked menu instead, whose height only
   * the UI knows.
   */
  readonly promptRect: Rect;
  /** Wall torch mounts, far to near. `lights.torches` holds their live state by the same index. */
  readonly torches: readonly TitlePoint[];
  /** The stairwell the dive pushes into. */
  readonly stairwell: TitlePoint;
  readonly lights: TitleLightRig;
}

/** Wider than this (width ÷ height) takes the landscape composition. */
const LANDSCAPE_MIN_ASPECT = 1;

/** The fraction of the height where the far wall meets the floor. */
const HORIZON_FRACTION = { landscape: 0.52, portrait: 0.46 } as const;
const FLOOR_FRACTION = { landscape: 0.84, portrait: 0.6 } as const;

/** The heroes stand left of centre in landscape, leaving the right to the menu. */
const HERO_X_FRACTION = { landscape: 0.38, portrait: 0.5 } as const;

/**
 * Figures are sized from the shorter side, so a phone either way up reads the
 * same: one step of figure scale per this many CSS pixels of it.
 */
const SHORT_SIDE_PX_PER_HERO_SCALE = 220;
const MIN_HERO_SCALE = 1.5;
/**
 * A phone held upright has height to spare between the logo and the menu, so
 * its heroes grow to the smaller of these: one step of figure scale per this
 * many CSS pixels of the width, or of the height.
 */
const PORTRAIT_PX_PER_HERO_SCALE = { width: 160, height: 350 } as const;

interface FractionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const LOGO_FRACTIONS: Readonly<Record<TitleComposition, FractionRect>> = {
  landscape: { x: 0.12, y: 0.06, w: 0.76, h: 0.3 },
  portrait: { x: 0.06, y: 0.07, w: 0.88, h: 0.2 },
};

const MENU_FRACTIONS: Readonly<Record<TitleComposition, FractionRect>> = {
  landscape: { x: 0.6, y: 0.42, w: 0.34, h: 0.5 },
  portrait: { x: 0.06, y: 0.64, w: 0.88, h: 0.34 },
};

const PROMPT_FRACTIONS: Readonly<Record<TitleComposition, FractionRect>> = {
  landscape: { x: 0.06, y: 0.88, w: 0.5, h: 0.1 },
  portrait: { x: 0.06, y: 0.58, w: 0.88, h: 0.05 },
};

/** Torch mounts as fractions of the width and height of the hall, far to near. */
const TORCH_FRACTIONS: Readonly<Record<TitleComposition, readonly TitlePoint[]>> = {
  landscape: [
    { x: 0.44, y: 0.4 },
    { x: 0.56, y: 0.4 },
    { x: 0.3, y: 0.34 },
    { x: 0.7, y: 0.34 },
    { x: 0.1, y: 0.28 },
    { x: 0.9, y: 0.28 },
  ],
  portrait: [
    { x: 0.4, y: 0.36 },
    { x: 0.6, y: 0.36 },
    { x: 0.16, y: 0.3 },
    { x: 0.84, y: 0.3 },
  ],
};

const STAIRWELL_FRACTION: Readonly<Record<TitleComposition, TitlePoint>> = {
  landscape: { x: 0.5, y: 0.5 },
  portrait: { x: 0.5, y: 0.44 },
};

function scaledRect(fractions: FractionRect, room: Rect): Rect {
  return {
    x: room.x + fractions.x * room.w,
    y: room.y + fractions.y * room.h,
    w: fractions.w * room.w,
    h: fractions.h * room.h,
  };
}

function safeRoom(width: number, height: number, insets: SafeAreaInsets): Rect {
  return {
    x: insets.l,
    y: insets.t,
    w: Math.max(1, width - insets.l - insets.r),
    h: Math.max(1, height - insets.t - insets.b),
  };
}

function heroScaleFor(composition: TitleComposition, safe: Rect): number {
  const fromShortSide = Math.min(safe.w, safe.h) / SHORT_SIDE_PX_PER_HERO_SCALE;
  if (composition === 'landscape') return Math.max(MIN_HERO_SCALE, fromShortSide);
  const upright = Math.min(
    safe.w / PORTRAIT_PX_PER_HERO_SCALE.width,
    safe.h / PORTRAIT_PX_PER_HERO_SCALE.height,
  );
  return Math.max(MIN_HERO_SCALE, fromShortSide, upright);
}

function scaledPoint(fractions: TitlePoint, width: number, height: number): TitlePoint {
  return { x: fractions.x * width, y: fractions.y * height };
}

/** The composition a viewport of this shape takes. */
export function titleComposition(width: number, height: number): TitleComposition {
  return width / Math.max(1, height) > LANDSCAPE_MIN_ASPECT ? 'landscape' : 'portrait';
}

/** The viewport a stage is laid out for, in CSS pixels. */
export interface TitleStageViewport {
  readonly width: number;
  readonly height: number;
  readonly safeArea: SafeAreaInsets;
  /** The UI's size class at this viewport. */
  readonly size: SizeClass;
}

/** Every anchor for a viewport of `width` × `height` CSS pixels. */
export function stageLayout(viewport: TitleStageViewport, lights: TitleLightRig): TitleStage {
  const { width, height } = viewport;
  const composition = titleComposition(width, height);
  const safe = safeRoom(width, height, viewport.safeArea);
  const floorY = FLOOR_FRACTION[composition] * height;
  return {
    width,
    height,
    composition,
    horizonY: HORIZON_FRACTION[composition] * height,
    floorY,
    heroSpot: { x: safe.x + HERO_X_FRACTION[composition] * safe.w, y: floorY },
    heroScale: heroScaleFor(composition, safe),
    logoRect: scaledRect(LOGO_FRACTIONS[composition], safe),
    menuRect: scaledRect(MENU_FRACTIONS[composition], safe),
    menuAtFoot: composition === 'portrait' || viewport.size === 'compact',
    promptRect: scaledRect(PROMPT_FRACTIONS[composition], safe),
    torches: TORCH_FRACTIONS[composition].map((torch) => scaledPoint(torch, width, height)),
    stairwell: scaledPoint(STAIRWELL_FRACTION[composition], width, height),
    lights,
  };
}

/** A stage rect in the UI units a surface lays out in. */
export function stageRectInUi(rect: Rect, uiScale: number): Rect {
  return { x: rect.x / uiScale, y: rect.y / uiScale, w: rect.w / uiScale, h: rect.h / uiScale };
}

/** Steady flicker: a torch whose layer has not run yet burns at exactly its level. */
const NEUTRAL_FLICKER = 1;

/** The scene's side of the light rig: resized to the stage's torches, never reset. */
export class TitleLightRigState implements TitleLightRig {
  private readonly torchStates: TitleTorchLight[] = [];
  ambient = 0;
  spotlight = 0;

  get torches(): readonly TitleTorchLight[] {
    return this.torchStates;
  }

  /**
   * Matches the torch list to a new composition's mounts. Torches that stay
   * keep their state; new ones start burning at the level of the first, so a
   * rotation to a composition with more mounts never shows a dark one.
   */
  fitTo(torchCount: number): void {
    const template = this.torchStates[0] ?? { level: 0, flicker: NEUTRAL_FLICKER };
    while (this.torchStates.length < torchCount) {
      this.torchStates.push({ level: template.level, flicker: NEUTRAL_FLICKER });
    }
    this.torchStates.length = torchCount;
  }
}
