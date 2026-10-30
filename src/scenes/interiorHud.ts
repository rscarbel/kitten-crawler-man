/**
 * What only a building adds to the shared HUD: the room-name banner in the
 * top band, and the chrome the interior camera frames the room clear of.
 *
 * The camera reads the HUD's own layout, computed without drawing anything,
 * so a button can never cover a part of the room the camera believes is on
 * show. Pure in its inputs, so a layout check can ask about any screen.
 */

import { bandCardInsets, layoutTopBand, topBandCard, type TopBandEntry } from '../ui/hud/topBand';
import { text } from '../ui/widgets/text';
import type { Theme } from '../ui/theme/tokens';
import { TOP_BAND_WIDTH } from '../ui/hud/topBandStack';
import type { HudGeometry } from '../ui/hud/hudLayout';
import type { Rect } from '../ui/core/geom';
import type { SizeClass } from '../ui/core/viewport';
import { buildingDisplayName, type BuildingId } from '../map/buildingIds';
import { towerStoreyLabel } from '../map/town/interiors/townCenterTower';

const ROOM_NAME_ENTRY_ID = 'room-name';

/** How long a room's name holds after the party comes in: it is arrival news, not a standing label. */
const ROOM_NAME_HOLD_FRAMES = 240;
/** How long it then takes to fade out. */
const ROOM_NAME_FADE_FRAMES = 45;

/** The name a room's banner shows: the building's, plus the storey inside the tower. */
export function interiorRoomTitle(buildingId: BuildingId, towerFloor: number | null): string {
  const displayName = buildingDisplayName(buildingId);
  if (towerFloor === null) return displayName;
  return `${displayName} (${towerStoreyLabel(towerFloor)})`;
}

/** The room-name banner's height: one line of label text on the band's card. */
function roomNameHeight(theme: Theme, size: SizeClass): number {
  return theme.type.label.lineHeight + bandCardInsets(theme, size).y * 2;
}

/**
 * The room's name as arrival news, `framesSinceArrival` after the party came
 * onto the floor: held, faded out, then gone. It is the band's `arrival`
 * entry, so any other card takes the band from it. One line, cut short with
 * an ellipsis, so the camera can frame the room around it before it is drawn
 * ({@link roomNameSlot}). Null once it has faded.
 */
export function roomNameEntry(title: string, framesSinceArrival: number): TopBandEntry | null {
  const framesIntoFade = framesSinceArrival - ROOM_NAME_HOLD_FRAMES;
  if (framesIntoFade >= ROOM_NAME_FADE_FRAMES) return null;
  const alpha = framesIntoFade <= 0 ? 1 : 1 - framesIntoFade / ROOM_NAME_FADE_FRAMES;
  return {
    id: ROOM_NAME_ENTRY_ID,
    priority: 'arrival',
    maxWidth: TOP_BAND_WIDTH.regular,
    height: (ui) => roomNameHeight(ui.theme, ui.size),
    render: (ui, rect) => {
      const { ctx } = ui;
      ctx.save();
      ctx.globalAlpha *= alpha;
      const inner = topBandCard(ui, rect);
      text(ui, inner, { text: `Inside: ${title}`, role: 'label', align: 'center' });
      ctx.restore();
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
  const height = roomNameHeight(theme, geometry.size);
  const slots = layoutTopBand(
    area,
    [
      {
        id: ROOM_NAME_ENTRY_ID,
        priority: 'arrival',
        w: Math.min(TOP_BAND_WIDTH.regular, area.w),
        h: height,
      },
    ],
    geometry.topBandObstacles,
    theme.space.sm,
    geometry.topBandFloor,
    geometry.topBandKeepClear,
  );
  return slots.length > 0 ? slots[0].rect : null;
}

/**
 * Every piece of the HUD that hides the room under it, in canvas CSS pixels:
 * what the interior camera frames the room clear of. The hotbar is not here:
 * the camera already takes its band off the bottom of the view. Nor is the
 * achievement chip, which only shows until the player reads what it
 * announces; reframing the room around it would shift the view each time one
 * was earned. The room-name slot stays here after the name has faded, so
 * its going never reframes the room; the cards a fight stacks in the band
 * are the camera's top inset instead (`TopBandReach`).
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
