/**
 * Where every piece of on-screen chrome sits inside a building, computed
 * without drawing anything.
 *
 * The buttons come from `hudButtonLayout`, the same layout the scene outside
 * uses, so walking through a door moves none of them; what is left here is
 * what only a building has — the room-name plate.
 *
 * The scene draws its HUD from this layout, and the interior camera reads the
 * same rects to keep the room clear of them — so a button can never cover a
 * part of the room the camera believes is on show. Pure in its inputs, so a
 * layout check can ask about a phone from a desktop process.
 */

import { interiorMiniMapRect, type Rect } from '../systems/MobileHUDSystem';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { hudKeepouts, hudPanelArea, hudReportedPanelRect, hudToggleRect } from '../ui/HUD';
import {
  desktopSummonButtonRect,
  hudButtonLayout,
  phoneSummonButtonRect,
  phoneSwitchButtonRect,
} from '../ui/hudButtons/hudButtonLayout';
import { hudMiniMapRect } from '../ui/hudButtons/hudMiniMap';
import { drawText, measureTextWidth } from '../ui/TextBox';
import type { ScreenRect } from './interiorCamera';

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
  /** The phone layout: Switch and the packed button cluster are drawn. */
  readonly mobile: boolean;
  /** Whether the party HUD panel is collapsed, where the platform lets it be. */
  readonly hudCollapsed: boolean;
  readonly miniMapExpanded: boolean;
  readonly hotbarBandHeight: number;
  /** Whether the Follower button is offered in this room. */
  readonly followButton: boolean;
  /** Whether Mongo's Summon button is showing. */
  readonly summonButton: boolean;
  /** Whether the Build button is offered: once the party can open the Construction menu. */
  readonly buildButton: boolean;
  /** Whether the Journal's compass button is offered: on a floor with a Quest Journal. */
  readonly journalButton: boolean;
  /** The unopened-loot-box banner, while a safe room shows it. */
  readonly lootBoxBanner: Rect | null;
}

export interface InteriorHudLayout {
  /** The party HUD panel's area, from `hudPanelArea`. */
  readonly hud: Rect;
  /** The HUD panel's collapse toggle, where the platform has one. */
  readonly hudToggle: Rect | null;
  /** The left edge of the minimap footprint the toggle steps aside for, as `drawHUD` takes it. */
  readonly toggleClearOfX: number;
  /** The minimap and its caption. */
  readonly miniMap: Rect & { readonly size: number };
  readonly pause: Rect;
  readonly bag: Rect;
  readonly switchButton: Rect | null;
  /** The Follower button, or null where the room refuses the command. */
  readonly follow: Rect | null;
  readonly summon: Rect | null;
  /** The room-name plate, or null when the chrome leaves no room anywhere for one. */
  readonly nameplate: Rect | null;
  /** Whether the plate had to drop under the HUD panel rather than sit beside it. */
  readonly nameplateUnderHud: boolean;
  /** Top of a phone's skill-point badge: under the HUD panel, or under the plate when it is there. */
  readonly skillBadgeTop: number;
  readonly build: Rect | null;
  /**
   * The achievement chip's slot, reserved whether or not anything is unread,
   * so no other piece ever moves when an achievement is earned.
   */
  readonly achievementChip: Rect;
  readonly journal: Rect | null;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function grownRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/**
 * The name plate goes in the top band between the HUD panel and the
 * right-hand buttons when there is room for it, centred on the screen where it
 * can be; otherwise directly under the HUD panel, as wide as the column
 * allows. Under a tall HUD panel on a short screen that slot would reach down
 * into the bottom-row buttons or onto a button the layout packed beside the
 * panel, and the plate squeezes into the top band after all, cutting the name
 * short there — unless the band is too narrow even for that, when the plate is
 * left off rather than drawn as a sliver.
 */
function placeNameplate(
  input: InteriorHudLayoutInput,
  hud: Rect,
  rightColumnLeft: number,
  bottomChromeTop: number,
  buttons: readonly Rect[],
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
  const underHud: Rect = { x: hud.x, y: underHudTop, w: underHudWidth, h: NAMEPLATE_HEIGHT };
  const landsOnButton = buttons.some((button) =>
    rectsOverlap(underHud, grownRect(button, NAMEPLATE_GAP)),
  );
  if (landsOnButton) return inTopBand();
  return { rect: underHud, underHud: true };
}

export function interiorHudLayout(input: InteriorHudLayoutInput): InteriorHudLayout {
  const { viewportWidth: width, viewportHeight: height, mobile } = input;
  const hud = hudPanelArea(input.hudCollapsed, mobile);
  const miniMap = interiorMiniMapRect(width, input.miniMapExpanded);
  // The buttons and the HUD panel's toggle are laid out against the
  // overworld minimap's footprint, which the smaller interior minimap sits
  // inside, so that they stand exactly where they stand outside.
  const buttonMiniMap = hudMiniMapRect(width, input.miniMapExpanded);
  const toggleClearOfX = buttonMiniMap.x;
  const hudToggle = hudToggleRect(input.hudCollapsed, mobile, toggleClearOfX);
  const hotbarTop = height - input.hotbarBandHeight;

  const buttons = hudButtonLayout({
    viewportWidth: width,
    viewportHeight: height,
    mobile,
    miniMap: buttonMiniMap,
    hudPanel: hudReportedPanelRect(input.hudCollapsed, mobile),
    hudKeepouts: hudKeepouts(input.hudCollapsed, mobile, toggleClearOfX),
    // No floor with a collapse timer has buildings to go into.
    timer: false,
    build: input.buildButton,
    lootBoxBanner: input.lootBoxBanner,
    extras: [],
  });
  const follow = input.followButton ? buttons.follower : null;
  const build = input.buildButton ? buttons.build : null;
  const journal = input.journalButton ? buttons.journal : null;

  const switchButton = mobile ? phoneSwitchButtonRect(width, height) : null;
  let summon: Rect | null = null;
  if (input.summonButton) {
    summon = mobile ? phoneSummonButtonRect(width, height) : desktopSummonButtonRect(height);
  }
  const desktopFollow = mobile ? null : follow;
  const bottomChromeTop = Math.min(
    hotbarTop,
    ...[switchButton, summon, desktopFollow].flatMap((rect) => (rect === null ? [] : [rect.y])),
  );

  const placedButtons = [buttons.pause, buttons.bag, follow, build, buttons.chip, journal].flatMap(
    (rect) => (rect === null ? [] : [rect]),
  );
  const plateBandBottom = hud.y + NAMEPLATE_HEIGHT;
  const rightColumnLeft = Math.min(
    miniMap.x,
    ...placedButtons.flatMap((rect) => (rect.y > plateBandBottom ? [] : [rect.x])),
  );

  // A toggle stepped out from under the minimap can hang below the panel;
  // whatever stacks under the panel stacks under it too.
  const hudAndToggle = hudToggle === null ? hud : boundingRect(hud, hudToggle);
  const nameplate = placeNameplate(
    input,
    hudAndToggle,
    rightColumnLeft,
    bottomChromeTop,
    placedButtons,
  );
  const plateUnderHud = nameplate.underHud ? nameplate.rect : null;
  const skillBadgeTop =
    plateUnderHud !== null
      ? plateUnderHud.y + plateUnderHud.h + SKILL_BADGE_GAP
      : hudAndToggle.y + hudAndToggle.h + SKILL_BADGE_GAP;

  return {
    hud,
    hudToggle,
    toggleClearOfX,
    miniMap,
    pause: buttons.pause,
    bag: buttons.bag,
    switchButton,
    follow,
    summon,
    nameplate: nameplate.rect,
    nameplateUnderHud: nameplate.underHud,
    skillBadgeTop,
    build,
    achievementChip: buttons.chip,
    journal,
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
 * already takes it off the bottom of the view. Nor is the achievement chip,
 * which only shows until the player reads what it announces; reframing the
 * room around it would shift the view each time one was earned.
 */
export function interiorHudOccluders(layout: InteriorHudLayout): ScreenRect[] {
  const rects = [
    layout.hud,
    layout.hudToggle,
    layout.nameplate,
    layout.miniMap,
    layout.pause,
    layout.bag,
    layout.switchButton,
    layout.follow,
    layout.summon,
    layout.build,
    layout.journal,
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
