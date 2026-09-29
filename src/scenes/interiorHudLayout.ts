/**
 * Where every piece of on-screen chrome sits inside a building, computed
 * without drawing anything.
 *
 * The scene draws its HUD from this layout, and the interior camera reads the
 * same rects to keep the room clear of them — so a button can never cover a
 * part of the room the camera believes is on show. Pure in its inputs, so a
 * layout check can ask about a phone from a desktop process.
 */

import {
  bottomRowButtonRects,
  interiorMiniMapRect,
  rightColumnButtonRect,
  SMALL_BUTTON_SIZE,
  stackedAboveRect,
  type Rect,
} from '../systems/MobileHUDSystem';
import { SUMMON_BUTTON_HEIGHT, SUMMON_BUTTON_WIDTH } from '../systems/MongoSystem';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { hudHpBarRects, hudPanelArea, hudToggleRect } from '../ui/HUD';
import { insetRect, packStack } from '../ui/hudPacking';
import { hotbarStripRectFor } from '../ui/InventoryPanel';
import { drawText, measureTextWidth } from '../ui/TextBox';
import type { ScreenRect } from './interiorCamera';

/** Clear space between the minimap's caption and the Pause button below it. */
const MINIMAP_TO_PAUSE_GAP = 20;
/** Clear space between the phone's Pause, Gear and Bag buttons, and round them. */
const PHONE_BUTTON_GAP = 6;
/** Keeps the phone's right-hand buttons off the screen's edges. */
const PHONE_SCREEN_MARGIN = 8;
/**
 * What a pixel of sideways drift from the column under the minimap costs, in
 * pixels of drop down it: large enough that a portrait phone keeps Pause, Gear
 * and Bag in one column under the minimap, and a landscape one moves them
 * beside it only once that column runs into the bottom-row buttons.
 */
const COLUMN_SHIFT_COST = 4;
/**
 * The height the phone's bottom-row buttons are lifted by. A fixed band rather
 * than the hotbar's measured one: the row is laid out against the phone
 * hotbar's usual height.
 */
const MOBILE_BOTTOM_ROW_HOTBAR_HEIGHT = 52;
/** Left edge of the desktop Summon button. */
const DESKTOP_SUMMON_LEFT = 10;
/** Clearance between the desktop Summon button and the hotbar band it sits above. */
const DESKTOP_SUMMON_HOTBAR_GAP = 8;

/** Clear space kept between the name plate and the HUD it sits beside or under. */
const NAMEPLATE_GAP = 6;
const NAMEPLATE_HEIGHT = 22;
/**
 * The plate never grows past this, so on a wide screen it reads as a label
 * rather than a bar across the room.
 */
const NAMEPLATE_MAX_WIDTH = 320;
/**
 * Narrower than this between the HUD panel and the right-hand column, and the
 * plate moves under the HUD panel instead: below it, a short room name still
 * has to be cut.
 */
const NAMEPLATE_MIN_TOP_WIDTH = 150;
/**
 * The narrowest the plate is ever drawn: room for a few letters and an
 * ellipsis at the smallest text size. Squeezed narrower between the HUD panel
 * and the minimap, it would be a sliver naming nothing, so it is left off.
 */
const NAMEPLATE_MIN_SQUEEZED_WIDTH = 64;
const NAMEPLATE_TEXT_PAD_X = 8;
/** The plate's text size at its largest, and the smallest it may step down to. */
const NAMEPLATE_TEXT_SIZE_MAX = 13;
const NAMEPLATE_TEXT_SIZE_MIN = 10;
/** Largest size first; the plate steps down one px at a time before cutting text. */
const NAMEPLATE_TEXT_SIZES: readonly number[] = Array.from(
  { length: NAMEPLATE_TEXT_SIZE_MAX - NAMEPLATE_TEXT_SIZE_MIN + 1 },
  (_, index) => NAMEPLATE_TEXT_SIZE_MAX - index,
);
const NAMEPLATE_TEXT_COLOR = '#d4edaa';
const ELLIPSIS = '…';
/** Clear space above a phone's skill-point badge, under whatever it stacks below. */
const SKILL_BADGE_GAP = 4;
/** The tower's storeys, bottom up, as the name plate names them. */
const TOWER_FLOOR_LABELS: readonly string[] = [
  'Ground Floor',
  '2nd Floor',
  '3rd Floor',
  'Top Floor',
];

/** The name a room's plate shows: the building's, plus the storey inside the tower. */
export function interiorRoomTitle(buildingName: string, towerFloor: number | null): string {
  if (towerFloor === null) return buildingName;
  const floorLabel = TOWER_FLOOR_LABELS[towerFloor] ?? `Floor ${towerFloor + 1}`;
  return `${buildingName} (${floorLabel})`;
}

/** What the layout depends on — everything a frame can change. */
export interface InteriorHudLayoutInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** The phone layout: Gear, Bag, Switch and the bottom row are drawn. */
  readonly mobile: boolean;
  /** Whether the party HUD panel is collapsed, where the platform lets it be. */
  readonly hudCollapsed: boolean;
  readonly miniMapExpanded: boolean;
  readonly hotbarBandHeight: number;
  /** Whether the phone's Follow button is offered in this room. */
  readonly followButton: boolean;
  /** Whether Mongo's Summon button is showing. */
  readonly summonButton: boolean;
}

export interface InteriorHudLayout {
  /** The party HUD panel's area, from `hudPanelArea`. */
  readonly hud: Rect;
  /** The HUD panel's collapse toggle, where the platform has one. */
  readonly hudToggle: Rect | null;
  /** The minimap and its caption. */
  readonly miniMap: Rect & { readonly size: number };
  readonly pause: Rect;
  readonly gear: Rect | null;
  readonly bag: Rect | null;
  readonly switchButton: Rect | null;
  readonly follow: Rect | null;
  readonly summon: Rect | null;
  /** The room-name plate, or null when the chrome leaves no room anywhere for one. */
  readonly nameplate: Rect | null;
  /** Whether the plate had to drop under the HUD panel rather than sit beside it. */
  readonly nameplateUnderHud: boolean;
  /** Top of a phone's skill-point badge: under the HUD panel, or under the plate when it is there. */
  readonly skillBadgeTop: number;
}

/**
 * The name plate goes in the top band between the HUD panel and the minimap
 * column when there is room for it, centred on the screen where it can be;
 * otherwise directly under the HUD panel, as wide as the column allows. Under
 * a tall HUD panel on a short screen that slot would reach down into the
 * bottom-row buttons, and the plate squeezes into the top band after all,
 * cutting the name short there — unless the band is too narrow even for that,
 * when the plate is left off rather than drawn as a sliver.
 */
function placeNameplate(
  input: InteriorHudLayoutInput,
  hud: Rect,
  rightColumnLeft: number,
  bottomChromeTop: number,
): { rect: Rect | null; underHud: boolean } {
  const topBandLeft = hud.x + hud.w + NAMEPLATE_GAP;
  const topBandRight = rightColumnLeft - NAMEPLATE_GAP;
  const topBandWidth = Math.max(0, topBandRight - topBandLeft);
  const inTopBand = (): { rect: Rect | null; underHud: boolean } => {
    if (topBandWidth < NAMEPLATE_MIN_SQUEEZED_WIDTH) return { rect: null, underHud: false };
    const w = Math.min(NAMEPLATE_MAX_WIDTH, topBandWidth);
    const centred = input.viewportWidth / 2 - w / 2;
    const x = Math.min(Math.max(centred, topBandLeft), topBandRight - w);
    return { rect: { x, y: hud.y, w, h: NAMEPLATE_HEIGHT }, underHud: false };
  };
  if (topBandWidth >= NAMEPLATE_MIN_TOP_WIDTH) return inTopBand();
  const underHudTop = hud.y + hud.h + NAMEPLATE_GAP;
  const underHudFits = underHudTop + NAMEPLATE_HEIGHT + NAMEPLATE_GAP <= bottomChromeTop;
  const underHudWidth = Math.max(
    0,
    Math.min(NAMEPLATE_MAX_WIDTH, rightColumnLeft - NAMEPLATE_GAP - hud.x),
  );
  if (!underHudFits || underHudWidth < NAMEPLATE_MIN_SQUEEZED_WIDTH) return inTopBand();
  return {
    rect: { x: hud.x, y: underHudTop, w: underHudWidth, h: NAMEPLATE_HEIGHT },
    underHud: true,
  };
}

/**
 * The phone's bottom-row buttons: Switch at the left and `extraCount` more
 * packed in from the right. Where the right-hand ones would land on
 * `keepClearOf` — the minimap reaching down on a short landscape screen, or
 * Pause, Gear and Bag hung under it — they step left until they are clear.
 */
function phoneBottomRow(
  input: InteriorHudLayoutInput,
  keepClearOf: readonly Rect[],
  extraCount: number,
): { switchButton: Rect; extras: Rect[] } {
  const row = bottomRowButtonRects(
    input.viewportWidth,
    input.viewportHeight,
    MOBILE_BOTTOM_ROW_HOTBAR_HEIGHT,
    extraCount,
  );
  const leftLimit = row.switchButton.x + row.switchButton.w + PHONE_BUTTON_GAP;
  let extras = row.extras;
  for (;;) {
    const shift = Math.max(
      0,
      ...extras.flatMap((rect) =>
        keepClearOf
          .filter((other) => rectsOverlap(rect, grownRect(other, PHONE_BUTTON_GAP)))
          .map((other) => rect.x + rect.w - (other.x - PHONE_BUTTON_GAP)),
      ),
    );
    const shifted = extras.map((rect) => ({ ...rect, x: rect.x - shift }));
    const runsIntoSwitch = shifted.some((rect) => rect.x < leftLimit);
    if (shift === 0 || runsIntoSwitch) return { ...row, extras };
    extras = shifted;
  }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function grownRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/**
 * A phone's Pause, Gear and Bag: one column under the minimap, as long as it
 * fits above the hotbar; on a short screen — a phone in landscape — beside
 * the minimap or across, wherever there is clear room, kept together where
 * they can be. They keep clear of the minimap, the hotbar, Switch and Summon
 * (Summon counted whether or not it shows, so switching crawler never moves
 * Pause) and the HUD panel's toggle and HP bars, and of the rest of the HUD
 * panel while there is room elsewhere. Follow steps aside for them instead.
 */
function phoneRightButtons(
  input: InteriorHudLayoutInput,
  miniMap: Rect,
  hud: Rect,
  hudToggle: Rect | null,
): { pause: Rect; gear: Rect; bag: Rect } {
  const { viewportWidth: width, viewportHeight: height } = input;
  const anchorRight = width - PHONE_SCREEN_MARGIN;
  const anchorTop = miniMap.y + miniMap.h + MINIMAP_TO_PAUSE_GAP;
  const switchButton = bottomRowButtonRects(
    width,
    height,
    MOBILE_BOTTOM_ROW_HOTBAR_HEIGHT,
    0,
  ).switchButton;
  const blocked: Rect[] = [
    { ...miniMap, h: miniMap.h + MINIMAP_TO_PAUSE_GAP - PHONE_BUTTON_GAP },
    insetRect(hotbarStripRectFor(width, height), PHONE_BUTTON_GAP),
    switchButton,
    stackedAboveRect(switchButton),
    ...(hudToggle === null ? [] : [hudToggle]),
    ...hudHpBarRects(input.hudCollapsed, true),
  ];
  const [pause, gear, bag] = packStack(
    [SMALL_BUTTON_SIZE, SMALL_BUTTON_SIZE, SMALL_BUTTON_SIZE],
    [],
    {
      bounds: {
        x: PHONE_SCREEN_MARGIN,
        y: miniMap.y,
        w: width - PHONE_SCREEN_MARGIN * 2,
        h: height - miniMap.y - PHONE_SCREEN_MARGIN,
      },
      blocked,
      avoid: [hud],
      gap: PHONE_BUTTON_GAP,
      cost: (rect) => (anchorRight - (rect.x + rect.w)) * COLUMN_SHIFT_COST + rect.y,
      seedXs: [],
      seedYs: [anchorTop],
    },
  );
  return { pause, gear, bag };
}

export function interiorHudLayout(input: InteriorHudLayoutInput): InteriorHudLayout {
  const hud = hudPanelArea(input.hudCollapsed, input.mobile);
  const miniMap = interiorMiniMapRect(input.viewportWidth, input.miniMapExpanded);
  const hudToggle = hudToggleRect(input.hudCollapsed, input.mobile, miniMap.x);
  const hotbarTop = input.viewportHeight - input.hotbarBandHeight;

  const phoneButtons = input.mobile ? phoneRightButtons(input, miniMap, hud, hudToggle) : null;
  const bottomRow =
    phoneButtons === null
      ? null
      : phoneBottomRow(
          input,
          [miniMap, phoneButtons.pause, phoneButtons.gear, phoneButtons.bag],
          input.followButton ? 1 : 0,
        );
  const switchButton = bottomRow?.switchButton ?? null;
  const follow = bottomRow?.extras[0] ?? null;
  let summon: Rect | null = null;
  if (input.summonButton) {
    summon =
      switchButton !== null
        ? stackedAboveRect(switchButton)
        : {
            x: DESKTOP_SUMMON_LEFT,
            y: hotbarTop - SUMMON_BUTTON_HEIGHT - DESKTOP_SUMMON_HOTBAR_GAP,
            w: SUMMON_BUTTON_WIDTH,
            h: SUMMON_BUTTON_HEIGHT,
          };
  }
  const bottomChromeTop = Math.min(
    hotbarTop,
    ...[switchButton, follow, summon].flatMap((rect) => (rect === null ? [] : [rect.y])),
  );

  const pause =
    phoneButtons?.pause ??
    rightColumnButtonRect(input.viewportWidth, miniMap.y + miniMap.h + MINIMAP_TO_PAUSE_GAP);
  const rightColumnLeft = Math.min(
    miniMap.x,
    ...[pause, phoneButtons?.gear, phoneButtons?.bag].flatMap((rect) =>
      rect === undefined || rect.y > hud.y + NAMEPLATE_HEIGHT ? [] : [rect.x],
    ),
  );

  // A toggle stepped out from under the minimap can hang below the panel;
  // whatever stacks under the panel stacks under it too.
  const hudAndToggle = hudToggle === null ? hud : boundingRect(hud, hudToggle);
  const nameplate = placeNameplate(input, hudAndToggle, rightColumnLeft, bottomChromeTop);
  const plateUnderHud = nameplate.underHud ? nameplate.rect : null;
  const skillBadgeTop =
    plateUnderHud !== null
      ? plateUnderHud.y + plateUnderHud.h + SKILL_BADGE_GAP
      : hudAndToggle.y + hudAndToggle.h + SKILL_BADGE_GAP;

  return {
    hud,
    hudToggle,
    miniMap,
    pause,
    gear: phoneButtons?.gear ?? null,
    bag: phoneButtons?.bag ?? null,
    switchButton,
    follow,
    summon,
    nameplate: nameplate.rect,
    nameplateUnderHud: nameplate.underHud,
    skillBadgeTop,
  };
}

function boundingRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function toScreenRect(rect: Rect): ScreenRect {
  return { left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h };
}

/**
 * Every rect of the layout that hides the room under it — what the interior
 * camera frames the room clear of. The hotbar band is not here: the camera
 * already takes it off the bottom of the view.
 */
export function interiorHudOccluders(layout: InteriorHudLayout): ScreenRect[] {
  const rects = [
    layout.hud,
    layout.hudToggle,
    layout.nameplate,
    layout.miniMap,
    layout.pause,
    layout.gear,
    layout.bag,
    layout.switchButton,
    layout.follow,
    layout.summon,
  ];
  const drawn: ScreenRect[] = [];
  for (const rect of rects) if (rect !== null) drawn.push(toScreenRect(rect));
  return drawn;
}

/**
 * The longest prefix of `text` that fits `maxWidth` with an ellipsis after it,
 * for a name too long for the plate at its smallest size.
 */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
): string {
  for (let length = text.length - 1; length > 0; length--) {
    const cut = `${text.slice(0, length).trimEnd()}${ELLIPSIS}`;
    if (measureTextWidth(ctx, cut, { size, bold: true }) <= maxWidth) return cut;
  }
  return ELLIPSIS;
}

/** What the plate shows for a room, as {@link chooseNameplateText} picks it. */
export interface NameplateText {
  readonly text: string;
  readonly size: number;
  readonly width: number;
  /** Whether `text` at `size` fits between the plate's padding. */
  readonly fits: boolean;
}

/**
 * The text the plate shows: "Inside: <name>" and then the bare name, each at
 * every size from largest to smallest, before cutting the bare name short at
 * the smallest size.
 */
export function chooseNameplateText(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  roomName: string,
): NameplateText {
  const textWidth = Math.max(0, rect.w - NAMEPLATE_TEXT_PAD_X * 2);
  for (const text of [`Inside: ${roomName}`, roomName]) {
    for (const size of NAMEPLATE_TEXT_SIZES) {
      const width = measureTextWidth(ctx, text, { size, bold: true });
      if (width <= textWidth) return { text, size, width, fits: true };
    }
  }
  const size = NAMEPLATE_TEXT_SIZE_MIN;
  const cut = ellipsize(ctx, roomName, textWidth, size);
  const width = measureTextWidth(ctx, cut, { size, bold: true });
  return { text: cut, size, width, fits: width <= textWidth };
}

/** The room-name plate, with the text {@link chooseNameplateText} picks. */
export function drawInteriorNameplate(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  roomName: string,
): void {
  drawBox(ctx, {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    ...BOX_PRESETS.roomNameplate,
  });
  const chosen = chooseNameplateText(ctx, rect, roomName);
  drawText(ctx, chosen.text, {
    x: rect.x + rect.w / 2,
    y: rect.y + (rect.h - chosen.size) / 2,
    size: chosen.size,
    bold: true,
    color: NAMEPLATE_TEXT_COLOR,
    align: 'center',
  });
}
