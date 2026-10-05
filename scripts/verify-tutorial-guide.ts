/**
 * The tutorial's screen-space guidance, drawn by the real `TutorialController`
 * into a recording context from a hand-built render context:
 *
 *  - with the inventory open on its Character tab, the guide points at the
 *    Bag tab, never back at the (hidden) Pause button;
 *  - with the pause menu open, it points at the menu's Inventory entry;
 *  - on a short phone screen, where the inventory fills the height, the hint
 *    box takes the top of the screen, clear of the bag's filters and items,
 *    unless the guide points into the header row, which it then keeps clear;
 *  - a hint that wraps to three lines grows its box rather than spilling;
 *  - on touch, the call-the-cat hint clears the Follower button and its arrow;
 *  - a closed gate's edge glows, as well as its fill.
 *
 *   npm run verify:tutorial-guide
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';

installCanvasGlobals();

const { setViewportSize } = await import('../src/core/Viewport.js');
const { TutorialController } = await import('../src/systems/TutorialController.js');
const { noteFrameInputMode, resetInputMode } = await import('../src/ui/core/inputMode.js');
const { worldPalette } = await import('../src/ui/theme/worldInk.js');

type RenderContext = Parameters<InstanceType<typeof TutorialController>['renderOverlay']>[5];
type TutorialState = InstanceType<typeof TutorialController>['state'];

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
interface Point {
  readonly x: number;
  readonly y: number;
}
interface DrawnText {
  readonly text: string;
  readonly y: number;
}
interface Drawing {
  /** The tip of every guide arrow drawn: the point it rests on. */
  readonly arrowTips: Point[];
  readonly texts: DrawnText[];
  /** Edges stroked with a glow under them. */
  glowingStrokes: number;
}

const PHONE_LANDSCAPE = { width: 568, height: 320 } as const;
const PHONE_PORTRAIT_NARROW = { width: 320, height: 568 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
/** How near a measured position must land to the one expected. */
const TOLERANCE_PX = 1;
const HINT_TEXT_SIZE_LINE_PX = 19;
const THREE_LINES = 3;
/** The hint box's inner padding and its gap above the hotbar. */
const HINT_BOX_PADDING_PX = 14;
const HINT_BOX_GAP_PX = 8;
/** The guide arrow's height plus its bounce: how far above its tip it can reach. */
const GUIDE_ARROW_REACH_PX = 36;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

function firstOf<T>(items: readonly T[]): T | null {
  return items.length > 0 ? items[0] : null;
}

function lastOf<T>(items: readonly T[]): T | null {
  return items.length > 0 ? items[items.length - 1] : null;
}

function centreX(rect: Rect): number {
  return rect.x + rect.w / 2;
}

/**
 * Wraps a real node-canvas context, recording the tip of each guide arrow
 * (the first point of a path filled in the guide's accent) and each line of
 * text drawn.
 */
function recordingContext(
  width: number,
  height: number,
): {
  ctx: CanvasRenderingContext2D;
  drawing: Drawing;
} {
  const real = gameContext(width, height);
  const drawing: Drawing = { arrowTips: [], texts: [], glowingStrokes: 0 };
  let pathStart: Point | null = null;
  const accent = worldPalette.guide.accent.toLowerCase();
  const ctx = new Proxy(real, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        if (prop === 'beginPath') pathStart = null;
        if (prop === 'moveTo' && pathStart === null) {
          const [x, y] = args;
          if (typeof x === 'number' && typeof y === 'number') pathStart = { x, y };
        }
        if (prop === 'fill' && pathStart !== null) {
          const style = target.fillStyle;
          if (typeof style === 'string' && style.toLowerCase() === accent) {
            drawing.arrowTips.push(pathStart);
          }
        }
        if ((prop === 'stroke' || prop === 'strokeRect') && target.shadowBlur > 0) {
          drawing.glowingStrokes++;
        }
        if (prop === 'fillText') {
          const [text, , y] = args;
          if (typeof text === 'string' && typeof y === 'number') drawing.texts.push({ text, y });
        }
        return Reflect.apply(value, target, args);
      };
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  return { ctx, drawing };
}

function baseRenderContext(overrides: Partial<RenderContext>): RenderContext {
  return {
    isPlayerInSafeRoom: true,
    pauseMenuOpen: false,
    inventoryPanelOpen: false,
    inventoryFrame: null,
    inventoryBagTabRect: null,
    pauseInventoryEntryRect: null,
    pauseButtonRect: null,
    followerButtonRect: null,
    followerMenuOpen: false,
    bagItemRects: {
      smush_tome: null,
      health_potion: null,
      enchanted_bigboi_boxers: null,
      magic_missile_tome: null,
    },
    hotbarSlotRects: [],
    bagHotbarSlotRects: [],
    isDragActive: false,
    isAchievementNotifActive: false,
    isContextMenuOpen: false,
    contextMenuOptionRects: null,
    isAbilityDialogShowing: false,
    isRewardGrantedDialogShowing: false,
    followerMenuFollowMeRect: null,
    ...overrides,
  };
}

function draw(
  viewport: { readonly width: number; readonly height: number },
  state: TutorialState,
  renderCtx: RenderContext,
): Drawing {
  setViewportSize(viewport.width, viewport.height);
  const tutorial = TutorialController.createForTutorial();
  Reflect.set(tutorial, '_state', state);
  const { ctx, drawing } = recordingContext(viewport.width, viewport.height);
  tutorial.renderOverlay(ctx, 0, 0, 0, 0, renderCtx);
  return drawing;
}

function hasArrowAt(drawing: Drawing, rect: Rect): boolean {
  return drawing.arrowTips.some(
    (tip) =>
      Math.abs(tip.x - centreX(rect)) <= TOLERANCE_PX && Math.abs(tip.y - rect.y) <= TOLERANCE_PX,
  );
}

const pauseButton: Rect = { x: 520, y: 8, w: 40, h: 40 };

section('the inventory open on its Character tab points at the Bag tab');
{
  const bagTab: Rect = { x: 70, y: 44, w: 100, h: 40 };
  const drawing = draw(
    PHONE_LANDSCAPE,
    'HUMAN_OPENED_ACHIEVEMENT',
    baseRenderContext({
      inventoryFrame: { x: 0, y: 32, w: 568, h: 288 },
      inventoryBagTabRect: bagTab,
      pauseButtonRect: pauseButton,
    }),
  );
  check(hasArrowAt(drawing, bagTab), 'an arrow rests on the Bag tab');
  check(!hasArrowAt(drawing, pauseButton), 'and none on the Pause button under the panel');
  check(
    drawing.texts.some((t) => t.text.includes('Bag tab')),
    `the hint names the Bag tab (${drawing.texts.map((t) => t.text).join(' / ')})`,
  );
  check(
    !drawing.texts.some((t) => t.text.includes('Pause')),
    'and does not send the player to the pause menu',
  );
}

section('the cat’s step, too');
{
  const bagTab: Rect = { x: 70, y: 44, w: 100, h: 40 };
  const drawing = draw(
    PHONE_LANDSCAPE,
    'CAT_OPENED_TREASURE_BOX',
    baseRenderContext({
      inventoryFrame: { x: 0, y: 32, w: 568, h: 288 },
      inventoryBagTabRect: bagTab,
      pauseButtonRect: pauseButton,
    }),
  );
  check(hasArrowAt(drawing, bagTab), 'an arrow rests on the Bag tab');
}

section('the pause menu open points at its Inventory entry');
{
  const entry: Rect = { x: 300, y: 260, w: 210, h: 44 };
  const drawing = draw(
    DESKTOP,
    'HUMAN_OPENED_ACHIEVEMENT',
    baseRenderContext({
      pauseMenuOpen: true,
      pauseInventoryEntryRect: entry,
      pauseButtonRect: pauseButton,
    }),
  );
  check(hasArrowAt(drawing, entry), 'an arrow rests on the Inventory entry');
}

section('a phone the inventory fills, on its Bag tab: the hint takes the top, clear of the bag');
{
  const header: Rect = { x: 70, y: 44, w: 200, h: 44 };
  const filterRow: Rect = { x: 16, y: 100, w: 536, h: 40 };
  const smushTome: Rect = { x: 64, y: 156, w: 44, h: 44 };
  const drawing = draw(
    PHONE_LANDSCAPE,
    'HUMAN_OPENED_ACHIEVEMENT',
    baseRenderContext({
      inventoryPanelOpen: true,
      inventoryFrame: { x: 0, y: 32, w: 568, h: 288 },
      inventoryBagTabRect: header,
      bagItemRects: {
        smush_tome: smushTome,
        health_potion: null,
        enchanted_bigboi_boxers: null,
        magic_missile_tome: null,
      },
    }),
  );
  const hintLines = drawing.texts.filter((t) => t.text.includes('Smush'));
  const lastLine = lastOf(hintLines);
  check(lastLine !== null, 'the drag hint is drawn');
  check(hasArrowAt(drawing, smushTome), 'an arrow rests on the Smush tome');
  if (lastLine !== null) {
    const boxBottom = lastLine.y + HINT_TEXT_SIZE_LINE_PX + HINT_BOX_PADDING_PX;
    const arrowTop = smushTome.y - GUIDE_ARROW_REACH_PX;
    check(
      boxBottom <= filterRow.y,
      `its box (bottom ${boxBottom}) ends above the filter row (y ${filterRow.y})`,
    );
    check(boxBottom <= arrowTop, `and above the arrow on the item (top ${arrowTop})`);
  }
}

section(
  'a phone the inventory fills, on another tab: the hint keeps off the header it points into',
);
{
  const header: Rect = { x: 70, y: 44, w: 200, h: 44 };
  const drawing = draw(
    PHONE_LANDSCAPE,
    'HUMAN_OPENED_ACHIEVEMENT',
    baseRenderContext({
      inventoryFrame: { x: 0, y: 32, w: 568, h: 288 },
      inventoryBagTabRect: header,
    }),
  );
  const headerBottom = header.y + header.h;
  const hintLines = drawing.texts.filter((t) => t.text.includes('Bag tab'));
  const firstLine = firstOf(hintLines);
  const lastLine = lastOf(hintLines);
  check(firstLine !== null && lastLine !== null, 'the Bag tab hint is drawn');
  if (firstLine !== null && lastLine !== null) {
    const textTop = firstLine.y;
    const textBottom = lastLine.y + HINT_TEXT_SIZE_LINE_PX;
    const clear = textTop >= headerBottom || textBottom <= header.y;
    check(
      clear,
      `its text (y ${textTop}–${textBottom}) clears the header row (y ${header.y}–${headerBottom})`,
    );
  }
}

section('a hint that wraps to three lines grows its box');
{
  const hotbarSlot: Rect = { x: 100, y: 500, w: 44, h: 44 };
  const drawing = draw(
    PHONE_PORTRAIT_NARROW,
    'SWITCHED_TO_CAT',
    baseRenderContext({ hotbarSlotRects: [hotbarSlot] }),
  );
  const lines = drawing.texts.filter((t) => t.y < hotbarSlot.y);
  const lastLine = lastOf(lines);
  check(lines.length >= THREE_LINES, `the hint wraps to ${lines.length} lines`);
  if (lastLine !== null) {
    check(
      lastLine.y + HINT_TEXT_SIZE_LINE_PX + HINT_BOX_PADDING_PX + HINT_BOX_GAP_PX <= hotbarSlot.y,
      `its last line (y ${lastLine.y}) sits inside a box that ends above the hotbar (y ${hotbarSlot.y})`,
    );
  }
}

section('on touch, the call-the-cat hint clears the Follower button and its arrow');
{
  const touchOwner = {};
  noteFrameInputMode('touch', touchOwner);
  const hotbarSlot: Rect = { x: 100, y: 820, w: 52, h: 52 };
  const followerButton: Rect = { x: 1300, y: 700, w: 60, h: 60 };
  const drawing = draw(
    DESKTOP,
    'SWITCHED_TO_HUMAN',
    baseRenderContext({ hotbarSlotRects: [hotbarSlot], followerButtonRect: followerButton }),
  );
  resetInputMode();
  const arrowTop = Math.min(...drawing.arrowTips.map((tip) => tip.y)) - GUIDE_ARROW_REACH_PX;
  const lines = drawing.texts.filter((t) => t.text.length > 0);
  const lastLine = lastOf(lines);
  check(hasArrowAt(drawing, followerButton), 'an arrow rests on the Follower button');
  if (lastLine !== null) {
    check(
      lastLine.y + HINT_TEXT_SIZE_LINE_PX <= arrowTop,
      `the hint's last line (bottom ${lastLine.y + HINT_TEXT_SIZE_LINE_PX}) sits above the arrow (top ${arrowTop})`,
    );
  }
}

section('a closed gate glows along its edge');
{
  setViewportSize(DESKTOP.width, DESKTOP.height);
  const tutorial = TutorialController.createForTutorial();
  const { ctx, drawing } = recordingContext(DESKTOP.width, DESKTOP.height);
  tutorial.renderGatesAndLedge(ctx, 0, 0);
  check(
    drawing.glowingStrokes > 0,
    `the gate's edge is stroked with a glow (${drawing.glowingStrokes})`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} tutorial guide check(s) failed.`);
  process.exit(1);
}
console.log('\nAll tutorial guide checks passed.');
