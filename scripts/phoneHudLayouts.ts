/**
 * Every piece of a phone's HUD, in the dungeon and inside a building, at one
 * viewport, across every HUD state that moves them — taken from the rect
 * functions the renderers draw from and hit-test against, never from copied
 * constants.
 *
 * The platform is fixed when the game's modules load, so a caller must make
 * `navigator` look like a phone before importing this module.
 */

import { setViewportSize } from '../src/core/Viewport';
import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue } from '../src/map/tileTypes';
import * as UI from '../src/systems/DungeonUIRenderer';
import { MiniMapSystem } from '../src/systems/MiniMapSystem';
import { hotbarStripRect } from '../src/ui/InventoryPanel';
import { hudHpBarRects, hudKeepouts, hudPanelArea, hudToggleRect } from '../src/ui/HUD';
import { siegeHudPanelRect, siegeHudSlot } from '../src/systems/briarHollow/siegeHudLayout';
import { RESOURCE_HUD_HEIGHT, RESOURCE_HUD_WIDTH } from '../src/systems/briarHollow/ResourceHud';
import { interiorHudLayout } from '../src/scenes/interiorHudLayout';
import type { Rect } from '../src/systems/MobileHUDSystem';

/**
 * - `button`: a tap target. It must be wholly on screen, overlap no other
 *   piece, and leave the HP bars uncovered.
 * - `minimap`: a tap target like a button, except that it is allowed over the
 *   HP bars: an expanded minimap on a narrow phone is wider than the room
 *   beside the HUD panel, and the player expands it on purpose.
 * - `surface`: drawn but not tapped (the level timer, a name plate, the siege
 *   panel, the resource strip). No button may cover it.
 */
export type HudPieceKind = 'button' | 'minimap' | 'surface';

export interface HudPiece {
  readonly name: string;
  readonly kind: HudPieceKind;
  readonly rect: Rect;
  /**
   * Pieces this one may overlap: the siege panel, on a window with no room
   * anywhere, lies over the minimap the player can shrink.
   */
  readonly mayOverlap?: readonly string[];
}

export interface PhoneHudState {
  readonly scene: 'dungeon' | 'interior';
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly pieces: readonly HudPiece[];
  /** The HUD panel, drawn behind everything; the pieces keep clear of it where they can. */
  readonly hudPanel: Rect;
  readonly hpBars: readonly Rect[];
}

/** The minimap needs a map to exist; the layout only reads its size and expanded state. */
const tinyMap = new GameMap({
  tileHeight: TILE_SIZE,
  prebuiltStructure: [[{ tileId: '0#0', type: FloorTypeValue.tile_floor }]],
});

const BOOLEANS = [false, true] as const;

/** The dungeon HUD at `width` × `height` in every state that moves a piece of it. */
export function dungeonPhoneHudStates(width: number, height: number): PhoneHudState[] {
  const states: PhoneHudState[] = [];
  for (const miniMapExpanded of BOOLEANS) {
    for (const hudCollapsed of BOOLEANS) {
      for (const timer of BOOLEANS) {
        for (const build of BOOLEANS) {
          setViewportSize(width, height);
          UI.resetColumnLayoutState();
          const miniMap = new MiniMapSystem(tinyMap);
          if (miniMapExpanded) miniMap.toggle();
          const hudPanel = hudPanelArea(hudCollapsed, true);
          UI.setHudPanelRect(hudPanel);
          const miniMapLeft = miniMap.screenRect.x;
          UI.setHudPanelKeepouts(hudKeepouts(hudCollapsed, true, miniMapLeft));
          UI.setLevelTimerShown(timer);
          UI.setBuildSlotReserved(build);
          const pieces: HudPiece[] = [
            { name: 'minimap', kind: 'minimap', rect: miniMap.screenRect },
            { name: 'hotbar', kind: 'button', rect: hotbarStripRect() },
            { name: 'pause', kind: 'button', rect: UI.pauseButtonRect(miniMap) },
            { name: 'bag', kind: 'button', rect: UI.mobileBagButtonRect(miniMap) },
            { name: 'follower', kind: 'button', rect: UI.mobileFollowerButtonRect(miniMap) },
            { name: 'switch', kind: 'button', rect: UI.mobileSwitchButtonRect() },
            { name: 'summon', kind: 'button', rect: UI.mobileSummonButtonRect() },
            { name: 'chip', kind: 'button', rect: UI.achievementChipRect(miniMap) },
            { name: 'journal', kind: 'button', rect: UI.journalButtonRect(miniMap) },
          ];
          const toggle = hudToggleRect(hudCollapsed, true, miniMapLeft);
          if (toggle !== null) pieces.push({ name: 'hudToggle', kind: 'button', rect: toggle });
          if (build)
            pieces.push({ name: 'build', kind: 'button', rect: UI.buildButtonRect(miniMap) });
          if (timer)
            pieces.push({ name: 'timer', kind: 'surface', rect: UI.levelTimerRect(miniMap) });
          // The siege runs only where the Build slot is reserved: Briar Hollow.
          const siegeSlot = build ? siegeHudSlot(miniMap, hudPanel) : null;
          if (siegeSlot !== null) {
            pieces.push({
              name: 'siege',
              kind: 'surface',
              rect: siegeHudPanelRect(siegeSlot),
              mayOverlap: siegeSlot.crowded ? ['minimap'] : [],
            });
          }
          if (siegeSlot?.hidesResourceStrip !== true) {
            const strip = UI.topCentreStripSlot(
              miniMap,
              hudPanel,
              RESOURCE_HUD_WIDTH,
              RESOURCE_HUD_HEIGHT,
            );
            pieces.push({
              name: 'resourceStrip',
              kind: 'surface',
              rect: {
                x: strip.x,
                y: strip.y,
                w: RESOURCE_HUD_WIDTH * strip.scale,
                h: RESOURCE_HUD_HEIGHT * strip.scale,
              },
            });
          }
          const label = [
            miniMapExpanded ? 'minimap expanded' : 'minimap',
            hudCollapsed ? 'hud collapsed' : 'hud expanded',
            ...(timer ? ['timer'] : []),
            ...(build ? ['build+siege'] : []),
          ].join(', ');
          states.push({
            scene: 'dungeon',
            width,
            height,
            label,
            pieces,
            hudPanel,
            hpBars: hudHpBarRects(hudCollapsed, true),
          });
        }
      }
    }
  }
  UI.resetColumnLayoutState();
  return states;
}

/** A building interior's HUD at `width` × `height` in every state that moves a piece of it. */
export function interiorPhoneHudStates(width: number, height: number): PhoneHudState[] {
  const states: PhoneHudState[] = [];
  for (const miniMapExpanded of BOOLEANS) {
    for (const hudCollapsed of BOOLEANS) {
      for (const followButton of BOOLEANS) {
        for (const summonButton of BOOLEANS) {
          setViewportSize(width, height);
          const hotbar = hotbarStripRect();
          const layout = interiorHudLayout({
            viewportWidth: width,
            viewportHeight: height,
            mobile: true,
            hudCollapsed,
            miniMapExpanded,
            hotbarBandHeight: height - hotbar.y,
            followButton,
            summonButton,
            // Always offered here: the worst case for crowding is every piece on screen.
            buildButton: true,
            journalButton: true,
          });
          const pieces: HudPiece[] = [
            { name: 'minimap', kind: 'minimap', rect: layout.miniMap },
            { name: 'hotbar', kind: 'button', rect: hotbar },
            { name: 'pause', kind: 'button', rect: layout.pause },
          ];
          const optional: ReadonlyArray<readonly [string, HudPieceKind, Rect | null]> = [
            ['gear', 'button', layout.gear],
            ['bag', 'button', layout.bag],
            ['switch', 'button', layout.switchButton],
            ['follow', 'button', layout.follow],
            ['summon', 'button', layout.summon],
            ['hudToggle', 'button', layout.hudToggle],
            ['nameplate', 'surface', layout.nameplate],
            ['build', 'button', layout.build],
            ['achievementChip', 'button', layout.achievementChip],
            ['journal', 'button', layout.journal],
          ];
          for (const [name, kind, rect] of optional) {
            if (rect !== null) pieces.push({ name, kind, rect });
          }
          const label = [
            miniMapExpanded ? 'minimap expanded' : 'minimap',
            hudCollapsed ? 'hud collapsed' : 'hud expanded',
            ...(followButton ? ['follow'] : []),
            ...(summonButton ? ['summon'] : []),
          ].join(', ');
          states.push({
            scene: 'interior',
            width,
            height,
            label,
            pieces,
            hudPanel: layout.hud,
            hpBars: hudHpBarRects(hudCollapsed, true),
          });
        }
      }
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

/** The canvas size {@link drawPhoneHudSchematic} draws a `width` × `height` screen into. */
export function schematicSize(width: number, height: number): { w: number; h: number } {
  return { w: width, h: height + SCHEMATIC_OVERHANG_PX };
}

/**
 * A layout drawn as labelled boxes at its real rects — the HUD panel with its
 * HP bars in red, buttons in blue, the minimap in green, surfaces in amber —
 * with the screen's edge outlined and room below it, so a button that has
 * run off the bottom shows where it went.
 */
export function drawPhoneHudSchematic(ctx: CanvasRenderingContext2D, state: PhoneHudState): void {
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
  box(state.hudPanel, SCHEMATIC_PANEL_FILL, SCHEMATIC_PANEL_BORDER);
  label(state.hudPanel, 'HUD panel');
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
    `${state.scene} ${state.width}×${state.height} — ${state.label}`,
    SCHEMATIC_LABEL_PAD,
    size.h - SCHEMATIC_LABEL_PAD,
  );
}
