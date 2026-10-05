/**
 * What only a building adds to the shared HUD: the room-name banner in the
 * top band, and the chrome the interior camera frames the room clear of.
 *
 * The camera reads the HUD's own layout, computed without drawing anything,
 * so a button can never cover a part of the room the camera believes is on
 * show. Pure in its inputs, so a layout check can ask about any screen.
 */

import { layoutTopBand, topBandCard, type TopBandEntry } from '../ui/hud/topBand';
import { text } from '../ui/widgets/text';
import type { Theme } from '../ui/theme/tokens';
import { TOP_BAND_WIDTH } from '../ui/hud/topBandStack';
import type { HudGeometry } from '../ui/hud/hudLayout';
import type { Rect } from '../ui/core/geom';
import { skinsFor } from '../ui/theme/skins';

/** The tower's storeys, bottom up, as the room's banner names them. */
const TOWER_FLOOR_LABELS: readonly string[] = [
  'Ground Floor',
  '2nd Floor',
  '3rd Floor',
  'Top Floor',
];

const ROOM_NAME_ENTRY_ID = 'room-name';

/** The name a room's banner shows: the building's, plus the storey inside the tower. */
export function interiorRoomTitle(buildingName: string, towerFloor: number | null): string {
  if (towerFloor === null) return buildingName;
  const floorLabel = TOWER_FLOOR_LABELS[towerFloor] ?? `Floor ${towerFloor + 1}`;
  return `${buildingName} (${floorLabel})`;
}

/** The room-name banner's height: one line of label text on the band's card. */
function roomNameHeight(theme: Theme): number {
  return theme.type.label.lineHeight + skinsFor(theme).panel.hud.padding * 2;
}

/**
 * The room's name, the lowest-priority bar in the top band, so a fight's bars
 * stack above it. One line, cut short with an ellipsis, so the camera can
 * frame the room around it before it is drawn ({@link roomNameSlot}).
 */
export function roomNameEntry(title: string): TopBandEntry {
  return {
    id: ROOM_NAME_ENTRY_ID,
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.regular,
    height: (ui) => roomNameHeight(ui.theme),
    render: (ui, rect) => {
      const inner = topBandCard(ui, rect);
      text(ui, inner, { text: `Inside: ${title}`, role: 'label', align: 'center' });
    },
  };
}

/** Which of the room's own buttons it shows, each of which hides what is under it. */
export interface InteriorChrome {
  readonly follow: boolean;
  readonly summon: boolean;
  readonly build: boolean;
  readonly journal: boolean;
}

function toCanvasRect(rect: Rect, uiScale: number): Rect {
  return { x: rect.x * uiScale, y: rect.y * uiScale, w: rect.w * uiScale, h: rect.h * uiScale };
}

/** Where the room-name banner lands in the top band, with nothing above it. */
export function roomNameSlot(geometry: HudGeometry): Rect | null {
  const { theme } = geometry;
  const area = geometry.topBand;
  const height = roomNameHeight(theme);
  const slots = layoutTopBand(
    area,
    [
      {
        id: ROOM_NAME_ENTRY_ID,
        priority: 'banner',
        w: Math.min(TOP_BAND_WIDTH.regular, area.w),
        h: height,
      },
    ],
    geometry.topBandObstacles,
    theme.space.sm,
    geometry.topBandFloor,
  );
  return slots.length > 0 ? slots[0].rect : null;
}

/**
 * Every piece of the HUD that hides the room under it, in canvas CSS pixels:
 * what the interior camera frames the room clear of. The hotbar is not here:
 * the camera already takes its band off the bottom of the view. Nor is the
 * achievement chip, which only shows until the player reads what it
 * announces; reframing the room around it would shift the view each time one
 * was earned.
 */
export function interiorHudOccluders(
  geometry: HudGeometry,
  uiScale: number,
  chrome: InteriorChrome,
): Rect[] {
  const { buttons } = geometry;
  const rects: (Rect | null)[] = [
    geometry.framesBlock,
    geometry.miniMap,
    roomNameSlot(geometry),
    buttons.pause,
    buttons.bag,
    buttons.switchButton,
    chrome.follow ? buttons.follower : null,
    chrome.summon ? buttons.summon : null,
    chrome.build ? buttons.build : null,
    chrome.journal ? buttons.journal : null,
  ];
  return rects.flatMap((rect) => (rect === null ? [] : [toCanvasRect(rect, uiScale)]));
}

/** Height of the band at the bottom of the screen the hotbar covers, in CSS pixels. */
export function hotbarBandHeightCss(
  geometry: HudGeometry,
  uiScale: number,
  screenHeight: number,
): number {
  return Math.max(0, screenHeight - geometry.hotbar.strip.y * uiScale);
}
