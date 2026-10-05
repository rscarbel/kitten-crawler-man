/**
 * Every piece of the HUD at one screen size, across every HUD state that
 * moves one (the minimap's size, the Build slot) — taken from `hudLayout`, the function the HUD draws from and the
 * interior camera frames against, never from copied constants. The dungeon
 * and every building share that layout, so one set of states covers both.
 *
 * The top band's bars size themselves to their content, which needs a canvas
 * to measure; a representative stack stands in for them here — a boss bar, an
 * encounter bar, a countdown and a banner, each at a height the real cards
 * reach — and is placed by the band's own allocator.
 */

import { TOP_BAND_PRIORITIES, layoutTopBand, type TopBandPriority } from '../src/ui/hud/topBand';
import { TOP_BAND_WIDTH } from '../src/ui/hud/topBandStack';
import { hudLayout, type HudGeometry } from '../src/ui/hud/hudLayout';
import { NO_INSETS, resolveViewport } from '../src/ui/core/viewport';
import type { UiSize } from '../src/core/Settings';
import type { Rect } from '../src/ui/core/geom';
import type { Density } from '../src/ui/theme/tokens';

/**
 * - `button`: a tap target. It must be wholly on screen, overlap no other
 *   piece, and leave the HP meters uncovered.
 * - `minimap`: a tap target like a button, except that it is allowed over the
 *   HP meters: an expanded minimap on a narrow phone is wider than the room
 *   beside the unit frames, and the player expands it on purpose.
 * - `surface`: drawn but not tapped (a bar in the top band). No button may cover it.
 */
export type HudPieceKind = 'button' | 'minimap' | 'surface';

export interface HudPiece {
  readonly name: string;
  readonly kind: HudPieceKind;
  readonly rect: Rect;
  /**
   * Pieces this one may overlap: a bar in the top band may lie over the part
   * of an expanded minimap it grew into, which the player can shrink.
   */
  readonly mayOverlap?: readonly string[];
}

export interface HudState {
  readonly width: number;
  readonly height: number;
  readonly density: Density;
  readonly label: string;
  readonly geometry: HudGeometry;
  readonly pieces: readonly HudPiece[];
  /** The unit frames and the coin pill, drawn behind everything; the pieces keep clear of them where they can. */
  readonly framesBlock: Rect;
  readonly hpBars: readonly Rect[];
}

const BOOLEANS = [false, true] as const;

/**
 * The bars a fight puts up together — a boss and an encounter — which no
 * button may cover on any screen. Bars stacked under them must stay on screen,
 * but on a short phone they may lie over buttons rather than leave it.
 */
export const LEADING_BARS = ['boss', 'encounter'] as const;

/** Heights the real cards reach at their fullest, in UI units. */
const BAND_ENTRY_HEIGHTS: Readonly<Record<TopBandPriority, number>> = {
  boss: 76,
  encounter: 66,
  countdown: 56,
  banner: 40,
};

const BAND_ENTRY_WIDTHS: Readonly<Record<TopBandPriority, number>> = {
  boss: TOP_BAND_WIDTH.regular,
  encounter: TOP_BAND_WIDTH.regular,
  countdown: TOP_BAND_WIDTH.narrow,
  banner: TOP_BAND_WIDTH.wide,
};

/** The top band holding `priorities`, one representative bar each, laid out as the HUD lays it out. */
export function representativeTopBand(
  geometry: HudGeometry,
  priorities: readonly TopBandPriority[] = TOP_BAND_PRIORITIES,
): HudPiece[] {
  const area = geometry.topBand;
  const slots = layoutTopBand(
    area,
    priorities.map((priority) => ({
      id: `band-${priority}`,
      priority,
      w: Math.min(BAND_ENTRY_WIDTHS[priority], area.w),
      h: BAND_ENTRY_HEIGHTS[priority],
    })),
    geometry.topBandObstacles,
    geometry.theme.space.sm,
    geometry.topBandFloor,
  );
  return slots.map((slot) => ({
    name: slot.id,
    kind: 'surface',
    rect: slot.rect,
    mayOverlap: ['minimap'],
  }));
}

/** The HUD's tap targets and minimap for one layout. */
export function hudPieces(geometry: HudGeometry): HudPiece[] {
  const { buttons } = geometry;
  const pieces: HudPiece[] = [
    { name: 'minimap', kind: 'minimap', rect: geometry.normalMiniMap },
    { name: 'hotbar', kind: 'button', rect: geometry.hotbar.strip },
    { name: 'pause', kind: 'button', rect: buttons.pause },
    { name: 'bag', kind: 'button', rect: buttons.bag },
    { name: 'follower', kind: 'button', rect: buttons.follower },
    { name: 'summon', kind: 'button', rect: buttons.summon },
    { name: 'chip', kind: 'button', rect: buttons.chip },
    { name: 'journal', kind: 'button', rect: buttons.journal },
  ];
  if (buttons.build !== null) pieces.push({ name: 'build', kind: 'button', rect: buttons.build });
  if (buttons.switchButton !== null) {
    pieces.push({ name: 'switch', kind: 'button', rect: buttons.switchButton });
  }
  return pieces;
}

/**
 * The HUD on a `cssWidth` × `cssHeight` screen at `density` and the player's
 * UI size, in every state that moves a piece of it. Rects, and the state's
 * own width and height, are in UI units, as the HUD lays itself out.
 */
export function hudStates(
  cssWidth: number,
  cssHeight: number,
  density: Density,
  uiSize: UiSize = 'medium',
): HudState[] {
  const states: HudState[] = [];
  const resolved = resolveViewport({ cssWidth, cssHeight, density, uiSize, safeArea: NO_INSETS });
  const viewport = resolved.screen;
  const width = viewport.w;
  const height = viewport.h;
  for (const miniMapExpanded of BOOLEANS) {
    for (const build of BOOLEANS) {
      const geometry = hudLayout({
        viewport,
        size: resolved.size,
        density,
        miniMapExpanded,
        build,
      });
      const label = [
        uiSize,
        miniMapExpanded ? 'minimap expanded' : 'minimap',
        ...(build ? ['build'] : []),
      ].join(', ');
      states.push({
        width,
        height,
        density,
        label,
        geometry,
        pieces: [...hudPieces(geometry), ...representativeTopBand(geometry, LEADING_BARS)],
        framesBlock: geometry.framesBlock,
        hpBars: [geometry.frames.active.hp, geometry.frames.companion.hp],
      });
    }
  }
  return states;
}

const SCHEMATIC_BACKGROUND = '#1f2937';
const SCHEMATIC_PANEL_FILL = 'rgba(15,23,42,0.85)';
const SCHEMATIC_PANEL_BORDER = '#64748b';
const SCHEMATIC_HP_FILL = 'rgba(239,68,68,0.75)';
const SCHEMATIC_BUTTON_FILL = 'rgba(59,130,246,0.55)';
const SCHEMATIC_BUTTON_BORDER = '#93c5fd';
const SCHEMATIC_MINIMAP_FILL = 'rgba(34,197,94,0.35)';
const SCHEMATIC_SURFACE_FILL = 'rgba(234,179,8,0.45)';
const SCHEMATIC_OFFSCREEN_BORDER = '#f43f5e';
const SCHEMATIC_LABEL_COLOR = '#f8fafc';
const SCHEMATIC_LABEL_FONT_PX = 10;
const SCHEMATIC_LABEL_PAD = 3;
const SCHEMATIC_CAPTION_FONT_PX = 11;
/** Room under the screen for the layout's caption and anything that fell off the bottom. */
const SCHEMATIC_OVERHANG_PX = 110;

/** The canvas size {@link drawHudSchematic} draws a `width` × `height` screen into. */
export function schematicSize(width: number, height: number): { w: number; h: number } {
  return { w: width, h: height + SCHEMATIC_OVERHANG_PX };
}

/**
 * A layout drawn as labelled boxes at its real rects — the unit frames with
 * their HP meters in red, buttons in blue, the minimap in green, the top
 * band's bars in amber — with the screen's edge outlined and room below it, so
 * a button that has run off the bottom shows where it went.
 */
export function drawHudSchematic(ctx: CanvasRenderingContext2D, state: HudState): void {
  const size = schematicSize(state.width, state.height);
  ctx.fillStyle = '#0b0f17';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.fillStyle = SCHEMATIC_BACKGROUND;
  ctx.fillRect(0, 0, state.width, state.height);
  const box = (rect: Rect, fill: string, border: string): void => {
    ctx.fillStyle = fill;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  };
  const label = (rect: Rect, text: string): void => {
    ctx.fillStyle = SCHEMATIC_LABEL_COLOR;
    ctx.font = `bold ${SCHEMATIC_LABEL_FONT_PX}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, rect.x + SCHEMATIC_LABEL_PAD, rect.y + SCHEMATIC_LABEL_PAD);
  };
  box(state.framesBlock, SCHEMATIC_PANEL_FILL, SCHEMATIC_PANEL_BORDER);
  label(state.framesBlock, 'unit frames');
  for (const bar of state.hpBars) box(bar, SCHEMATIC_HP_FILL, SCHEMATIC_HP_FILL);
  const order: readonly HudPieceKind[] = ['surface', 'minimap', 'button'];
  for (const kind of order) {
    for (const piece of state.pieces.filter((p) => p.kind === kind)) {
      const fill =
        kind === 'button'
          ? SCHEMATIC_BUTTON_FILL
          : kind === 'minimap'
            ? SCHEMATIC_MINIMAP_FILL
            : SCHEMATIC_SURFACE_FILL;
      const r = piece.rect;
      const offscreen = r.x < 0 || r.y < 0 || r.x + r.w > state.width || r.y + r.h > state.height;
      box(r, fill, offscreen ? SCHEMATIC_OFFSCREEN_BORDER : SCHEMATIC_BUTTON_BORDER);
      label(r, piece.name);
    }
  }
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, state.width, state.height);
  ctx.fillStyle = SCHEMATIC_LABEL_COLOR;
  ctx.font = `${SCHEMATIC_CAPTION_FONT_PX}px sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    `${state.density} ${state.width}×${state.height} — ${state.label}`,
    SCHEMATIC_LABEL_PAD,
    size.h - SCHEMATIC_LABEL_PAD,
  );
}
