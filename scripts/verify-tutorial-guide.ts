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
 *  - every step points at the exact place to act (the reward chest opens
 *    itself, so its step points at nothing): the hotbar slot to press with a
 *    keyboard as on touch, the Switch button, the level badge and then a
 *    stat's "+"; a card with a lone OK, or its own "tap to continue", is left
 *    to speak for itself, with no arrow and no hint over it; the arrow to Mordecai
 *    holds until his "Talk" prompt takes over; a menu open at a step with
 *    nothing to do in it says how to leave and points at its close button;
 *
 * And the step-driven state the scene reads from it:
 *
 *  - Mordecai wears "!" while he must be met, "?" while he must be reported
 *    back to, and nothing at any other step;
 *  - each tutorial goblin is flagged as the objective only during its own step;
 *  - the safe-room doorway, the chest and the stairwell are lit only during
 *    their steps, and the chest stands down the moment it is opened;
 *  - a cat already at full health (god mode's heal) skips the potion step;
 *  - the human levels up exactly on the smush, never before, and the cat not at
 *    all; the stat step waits for his point to be spent (god mode or not),
 *    pins the pause menu to the Character page, then pans to the cat, and is
 *    skipped with no point to spend;
 *  - every step finished inside a menu completes, and asks for the menus to
 *    close, even while the menu halts the world;
 *  - after goblin B the game waits for the player's own switch back to the human,
 *    refusing the switch before that step and allowing it for good after;
 *  - a shut gate is drawn and holds its crawler back, rattling (once, not
 *    every frame) when walked into; once unlocked it stays shut while its
 *    crawler is far off or it is off screen, then rises in front of a crawler
 *    walking straight at it, at normal and at god-mode speed, without ever
 *    stopping them; the cat already standing at the fence when called is let
 *    through at once.
 *
 *   npm run verify:tutorial-guide
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';

installCanvasGlobals();

const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
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
/** How far either side of a prompt's range edge the arrow is checked. */
const PROMPT_EDGE_MARGIN_TILES = 0.25;

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
  const drawing: Drawing = { arrowTips: [], texts: [] };
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
      lucky_hoodie: null,
      magic_missile_tome: null,
    },
    hotbarSlotRects: [],
    bagHotbarSlotRects: [],
    isDragActive: false,
    isContextMenuOpen: false,
    contextMenuOptionRects: null,
    isAbilityDialogShowing: false,
    isRewardGrantedDialogShowing: false,
    followerMenuFollowMeRect: null,
    mordecaiPosition: null,
    isRewardScreenOpen: false,
    rewardsChipRect: null,
    isChestRewardOpen: false,
    switchButtonRect: null,
    levelBadgeRect: null,
    pauseFrame: null,
    characterSectionOpen: false,
    statSpendButtonRect: null,
    menuCloseRect: null,
    ...overrides,
  };
}

/** Where the active crawler stands and the camera looks, in world pixels. */
interface Viewpoint {
  readonly player: Point;
  readonly camera: Point;
}
const ORIGIN_VIEW: Viewpoint = { player: { x: 0, y: 0 }, camera: { x: 0, y: 0 } };

function draw(
  viewport: { readonly width: number; readonly height: number },
  state: TutorialState,
  renderCtx: RenderContext,
  view: Viewpoint = ORIGIN_VIEW,
): Drawing {
  setViewportSize(viewport.width, viewport.height);
  const tutorial = TutorialController.createForTutorial();
  Reflect.set(tutorial, '_state', state);
  const { ctx, drawing } = recordingContext(viewport.width, viewport.height);
  tutorial.renderOverlay(
    ctx,
    view.camera.x,
    view.camera.y,
    view.player.x,
    view.player.y,
    renderCtx,
  );
  return drawing;
}

/** Whether a guide arrow rests on `rect`: on its top edge, or from below on its bottom edge. */
function hasArrowAt(drawing: Drawing, rect: Rect): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE_PX;
  return drawing.arrowTips.some(
    (tip) => near(tip.x, centreX(rect)) && (near(tip.y, rect.y) || near(tip.y, rect.y + rect.h)),
  );
}

function hintMentions(drawing: Drawing, phrase: string): boolean {
  return drawing.texts
    .map((t) => t.text)
    .join(' ')
    .includes(phrase);
}

function hintText(drawing: Drawing): string {
  return drawing.texts.map((t) => t.text).join(' / ');
}

function inTouchMode<T>(run: () => T): T {
  noteFrameInputMode('touch', {});
  try {
    return run();
  } finally {
    resetInputMode();
  }
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
        lucky_hoodie: null,
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

section('the step after Mordecai names the reward chest and points at the rewards chip');
{
  const chip = { x: 900, y: 120, w: 44, h: 44 };
  const drawing = draw(
    DESKTOP,
    'HUMAN_TALKED_TO_MORDECAI',
    baseRenderContext({ rewardsChipRect: chip }),
  );
  check(hasArrowAt(drawing, chip), 'an arrow rests on the "Rewards waiting" chip');
  check(
    hintMentions(drawing, 'reward chest'),
    `the hint names the reward chest (${hintText(drawing)})`,
  );
  const hidden = draw(DESKTOP, 'HUMAN_TALKED_TO_MORDECAI', baseRenderContext({}));
  check(hidden.arrowTips.length === 0, 'no arrow while the chip is not shown');
}

section('a card with a single OK, or its own “continue”, is left to speak for itself');
{
  const reveal = draw(
    DESKTOP,
    'HUMAN_TALKED_TO_MORDECAI',
    baseRenderContext({ isRewardScreenOpen: true }),
  );
  check(
    reveal.arrowTips.length === 0 && reveal.texts.length === 0,
    'the reward chest screen, which carries its own controls, is left clear',
  );

  const abilityCard = draw(
    DESKTOP,
    'HUMAN_OPENED_ACHIEVEMENT',
    baseRenderContext({ isRewardGrantedDialogShowing: true }),
  );
  check(
    abilityCard.arrowTips.length === 0 && abilityCard.texts.length === 0,
    'the "New Ability!" card: no arrow on its lone OK, and no hint over it',
  );

  const chestCard = draw(
    DESKTOP,
    'CAT_INSIDE_TREASURE_ROOM',
    baseRenderContext({ isChestRewardOpen: true }),
  );
  check(
    chestCard.texts.length === 0,
    'the chest’s reward card, which says "tap to continue" itself, is left clear',
  );
}

section('with a keyboard, the hotbar slot to press is pointed at, as on touch');
{
  const slot: Rect = { x: 600, y: 820, w: 52, h: 52 };
  const potion = draw(DESKTOP, 'SWITCHED_TO_CAT', baseRenderContext({ hotbarSlotRects: [slot] }));
  check(hasArrowAt(potion, slot), 'the potion step: an arrow rests on slot 1');
  const missile = draw(
    DESKTOP,
    'CAT_EQUIPPED_MAGIC_MISSILE',
    baseRenderContext({ hotbarSlotRects: [slot] }),
  );
  check(hasArrowAt(missile, slot), 'the Magic Missile step: an arrow rests on slot 1');
  const missileTouch = inTouchMode(() =>
    draw(DESKTOP, 'CAT_EQUIPPED_MAGIC_MISSILE', baseRenderContext({ hotbarSlotRects: [slot] })),
  );
  check(hasArrowAt(missileTouch, slot), 'and on touch too');

  const tutorial = TutorialController.createForTutorial();
  const [, , guard1, guard2] = tutorial.allMobs;
  const between: Point = { x: (guard1.x + guard2.x) / 2, y: (guard1.y + guard2.y) / 2 };
  const smushView: Viewpoint = {
    player: between,
    camera: { x: between.x - DESKTOP.width / 2, y: between.y - DESKTOP.height / 2 },
  };
  const inRange = draw(
    DESKTOP,
    'HUMAN_EQUIPPED_SMUSH',
    baseRenderContext({ hotbarSlotRects: [slot] }),
    smushView,
  );
  check(hasArrowAt(inRange, slot), 'the Smush step, within reach of both guards: on slot 1');
  const farAway = draw(
    DESKTOP,
    'HUMAN_EQUIPPED_SMUSH',
    baseRenderContext({ hotbarSlotRects: [slot] }),
  );
  check(!hasArrowAt(farAway, slot), 'but not while a cast from there would miss them');
  const lines = potion.texts.filter((t) => t.y < slot.y);
  const lastLine = lastOf(lines);
  if (lastLine !== null) {
    check(
      lastLine.y + HINT_TEXT_SIZE_LINE_PX <= slot.y - GUIDE_ARROW_REACH_PX,
      `the hint (bottom ${lastLine.y + HINT_TEXT_SIZE_LINE_PX}) clears the arrow over the slot (top ${slot.y - GUIDE_ARROW_REACH_PX})`,
    );
  }
}

section('the switch-back step points at the Switch button and names the key');
{
  const switchButton: Rect = { x: 1320, y: 260, w: 48, h: 48 };
  const keyboard = draw(
    DESKTOP,
    'AWAITING_SWITCH_TO_HUMAN',
    baseRenderContext({ switchButtonRect: switchButton }),
  );
  check(hasArrowAt(keyboard, switchButton), 'with a keyboard: an arrow rests on the Switch button');
  check(hintMentions(keyboard, 'Press Tab'), `and the hint names the key (${hintText(keyboard)})`);
  const touch = inTouchMode(() =>
    draw(
      DESKTOP,
      'AWAITING_SWITCH_TO_HUMAN',
      baseRenderContext({ switchButtonRect: switchButton }),
    ),
  );
  check(hasArrowAt(touch, switchButton), 'on touch: an arrow rests on the Switch button');
  check(hintMentions(touch, 'Switch button'), `and the hint names it (${hintText(touch)})`);
}

section('the level-up step points at the level badge, then at a stat’s +');
{
  const badge: Rect = { x: 52, y: 12, w: 26, h: 16 };
  const keyboard = draw(DESKTOP, 'HUMAN_LEVELED_UP', baseRenderContext({ levelBadgeRect: badge }));
  check(hasArrowAt(keyboard, badge), 'an arrow rests on the badge');
  check(
    hintMentions(keyboard, '+1') && hintMentions(keyboard, 'Esc'),
    `the hint names the badge and the keyboard's way in (${hintText(keyboard)})`,
  );
  const touch = inTouchMode(() =>
    draw(DESKTOP, 'HUMAN_LEVELED_UP', baseRenderContext({ levelBadgeRect: badge })),
  );
  check(hasArrowAt(touch, badge), 'on touch too');

  const plus: Rect = { x: 900, y: 420, w: 40, h: 40 };
  const page = draw(
    DESKTOP,
    'HUMAN_LEVELED_UP',
    baseRenderContext({
      pauseMenuOpen: true,
      characterSectionOpen: true,
      pauseFrame: { x: 240, y: 110, w: 960, h: 680 },
      statSpendButtonRect: plus,
    }),
  );
  check(hasArrowAt(page, plus), 'on the Character page an arrow rests on the suggested +');
  check(
    hintMentions(page, 'Constitution') && !hintMentions(page, 'badge'),
    `and the hint says what a point does and suggests a stat (${hintText(page)})`,
  );
}

section('a menu open with nothing left to do in it says how to leave, and points at its ✕');
{
  const close: Rect = { x: 1160, y: 124, w: 32, h: 32 };
  const pauseMenu = {
    pauseMenuOpen: true,
    pauseFrame: { x: 240, y: 110, w: 960, h: 680 },
    menuCloseRect: close,
  };
  const keyboard = draw(DESKTOP, 'HUMAN_EQUIPPED_SMUSH', baseRenderContext(pauseMenu));
  check(hasArrowAt(keyboard, close), 'the pause menu mid-step: an arrow rests on its ✕');
  check(hintMentions(keyboard, 'Esc'), `and the hint says how to leave (${hintText(keyboard)})`);
  const touch = inTouchMode(() =>
    draw(DESKTOP, 'HUMAN_EQUIPPED_SMUSH', baseRenderContext(pauseMenu)),
  );
  check(hasArrowAt(touch, close), 'on touch too');
  check(hintMentions(touch, 'X button'), `naming the button (${hintText(touch)})`);
  const bagDuringLevelUp = draw(
    DESKTOP,
    'HUMAN_LEVELED_UP',
    baseRenderContext({
      inventoryFrame: { x: 240, y: 110, w: 960, h: 680 },
      inventoryPanelOpen: true,
      menuCloseRect: close,
    }),
  );
  check(
    hasArrowAt(bagDuringLevelUp, close),
    'the bag opened during the level-up step: an arrow rests on its ✕, not on a hidden badge',
  );
}

const { TILE_SIZE } = await import('../src/core/constants.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { applyGodModeToPlayer } = await import('../src/core/state/GodMode.js');
const { TUTORIAL_CHEST_POS, TUTORIAL_STAIR_FOOTPRINT, TUTORIAL_SAFE_ENTRANCE_TILE } =
  await import('../src/map/TutorialMap.js');

type Controller = InstanceType<typeof TutorialController>;
type MarkerState = ReturnType<Controller['mordecaiMarker']>;

/** Moves the controller through its own transition, so everything a step change sets is set. */
function advanceTo(tutorial: Controller, state: TutorialState): void {
  const advance: unknown = Reflect.get(tutorial, 'advance');
  if (typeof advance !== 'function') {
    throw new Error('TutorialController has no `advance` transition to drive the steps with');
  }
  Reflect.apply(advance, tutorial, [state]);
}

const STEPPED_STATES = [
  'SEPARATE_ROOMS',
  'HUMAN_MOVED',
  'HUMAN_NEAR_GOBLIN',
  'HUMAN_KILLED_GOBLIN',
  'HUMAN_GETS_TO_SAFE_ROOM',
  'HUMAN_TALKED_TO_MORDECAI',
  'HUMAN_OPENED_ACHIEVEMENT',
  'HUMAN_EQUIPPED_SMUSH',
  'HUMAN_SMUSHED_GUARDS',
  'HUMAN_LEVELED_UP',
  'CAMERA_PAN_TO_CAT',
  'SWITCHED_TO_CAT',
  'USED_HEALTH_POTION',
  'CAT_INSIDE_TREASURE_ROOM',
  'CAT_OPENED_TREASURE_BOX',
  'CAT_EQUIPPED_MAGIC_MISSILE',
  'CAT_SHOT_GUARD',
  'AWAITING_SWITCH_TO_HUMAN',
  'SWITCHED_TO_HUMAN',
  'CAT_ARRIVED',
  'TALKED_TO_MORDECAI_AGAIN',
] as const satisfies readonly TutorialState[];

section('Mordecai wears "!" to be met, "?" to be reported back to, nothing otherwise');
{
  const tutorial = TutorialController.createForTutorial();
  let mismatches = 0;
  for (const state of STEPPED_STATES) {
    advanceTo(tutorial, state);
    const expected: MarkerState =
      state === 'HUMAN_GETS_TO_SAFE_ROOM'
        ? 'exclamation'
        : state === 'CAT_ARRIVED'
          ? 'question'
          : 'none';
    const actual = tutorial.mordecaiMarker();
    if (actual !== expected) {
      mismatches++;
      check(false, `${state}: marker ${actual}, expected ${expected}`);
    }
  }
  check(mismatches === 0, 'the marker matches the step at every step');
}

section('each goblin is the objective only during its own step');
{
  const tutorial = TutorialController.createForTutorial();
  const [goblinA, goblinB, guard1, guard2] = tutorial.allMobs;
  const goblinASteps: readonly TutorialState[] = [
    'SEPARATE_ROOMS',
    'HUMAN_MOVED',
    'HUMAN_NEAR_GOBLIN',
  ];
  let mismatches = 0;
  for (const state of STEPPED_STATES) {
    advanceTo(tutorial, state);
    const expectedA = goblinASteps.includes(state);
    const expectedGuards = state === 'HUMAN_EQUIPPED_SMUSH';
    const expectedB = state === 'CAT_EQUIPPED_MAGIC_MISSILE';
    const flags = [goblinA, guard1, guard2, goblinB].map((mob) => mob.isCurrentObjective);
    const expected = [expectedA, expectedGuards, expectedGuards, expectedB];
    if (flags.some((flag, i) => flag !== expected[i])) {
      mismatches++;
      check(false, `${state}: flags ${flags.join(',')}, expected ${expected.join(',')}`);
    }
  }
  check(mismatches === 0, 'goblin A, both guards and goblin B each flagged on their step only');
}

section('the doorway, the chest and the stairwell are lit only during their steps');
{
  const tutorial = TutorialController.createForTutorial();
  const litTile = (): { x: number; y: number } | null => firstOf(tutorial.objectiveBeacons());
  const expectedPlaces: Partial<Record<TutorialState, { x: number; y: number }>> = {
    USED_HEALTH_POTION: TUTORIAL_CHEST_POS,
    CAT_INSIDE_TREASURE_ROOM: TUTORIAL_CHEST_POS,
    TALKED_TO_MORDECAI_AGAIN: {
      x: TUTORIAL_STAIR_FOOTPRINT.x,
      y: TUTORIAL_STAIR_FOOTPRINT.y + TUTORIAL_STAIR_FOOTPRINT.h - 1,
    },
  };
  let mismatches = 0;
  for (const state of STEPPED_STATES) {
    advanceTo(tutorial, state);
    const lit = litTile();
    if (state === 'HUMAN_KILLED_GOBLIN') {
      const ok = lit !== null && lit.y === TUTORIAL_SAFE_ENTRANCE_TILE.y;
      if (!ok) mismatches++;
      check(ok, `the safe-room doorway row is lit after goblin A dies (${JSON.stringify(lit)})`);
      continue;
    }
    const expected = expectedPlaces[state] ?? null;
    const matches =
      expected === null
        ? lit === null
        : lit !== null && lit.x === expected.x && lit.y === expected.y;
    if (!matches) {
      mismatches++;
      check(false, `${state}: lit ${JSON.stringify(lit)}, expected ${JSON.stringify(expected)}`);
    }
  }
  check(mismatches === 0, 'no step lights a place other than its own');

  const chestStep = TutorialController.createForTutorial();
  advanceTo(chestStep, 'CAT_INSIDE_TREASURE_ROOM');
  check(chestStep.objectiveBeacons().length === 1, 'the chest is lit while the cat walks to it');
  const reward = chestStep.openTreasureChest();
  check(
    reward?.catLoot.items.some((item) => item.id === 'magic_missile_tome') === true,
    'opening it on its step hands the scene the cat’s Magic Missile reward',
  );
  check(chestStep.objectiveBeacons().length === 0, 'and stands its beam down at once');

  const stairStep = TutorialController.createForTutorial();
  advanceTo(stairStep, 'TALKED_TO_MORDECAI_AGAIN');
  const stairBeam = firstOf(stairStep.objectiveBeacons());
  if (stairBeam === null) {
    check(false, 'the stairwell is lit on the last step');
  } else {
    const widthTiles = stairBeam.widthTiles ?? 1;
    const beamCentreX = stairBeam.x + widthTiles / 2;
    const beamGroundY = stairBeam.y + 1 - (stairBeam.backsetTiles ?? 0);
    const holeCentreX = TUTORIAL_STAIR_FOOTPRINT.x + TUTORIAL_STAIR_FOOTPRINT.w / 2;
    const holeCentreY = TUTORIAL_STAIR_FOOTPRINT.y + TUTORIAL_STAIR_FOOTPRINT.h / 2;
    check(
      widthTiles === TUTORIAL_STAIR_FOOTPRINT.w &&
        beamCentreX === holeCentreX &&
        beamGroundY === holeCentreY,
      `the stairwell's beam spans its ${TUTORIAL_STAIR_FOOTPRINT.w}×${TUTORIAL_STAIR_FOOTPRINT.h} hole, centred on it (beam ${widthTiles} wide at ${beamCentreX},${beamGroundY}; hole centre ${holeCentreX},${holeCentreY})`,
    );
  }
}

section('a cat already at full health skips the potion step');
{
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const tutorial = TutorialController.createForTutorial();
  tutorial.initializePlayers(human, cat);
  advanceTo(tutorial, 'SWITCHED_TO_CAT');
  tutorial.update(human, cat);
  check(tutorial.state === 'SWITCHED_TO_CAT', 'at 1 HP the cat waits for her potion');
  applyGodModeToPlayer(cat);
  tutorial.update(human, cat);
  check(
    tutorial.state === 'USED_HEALTH_POTION' && tutorial.canCatMove,
    `with god mode's heal she walks on without drinking (${tutorial.state})`,
  );
}

section('the arrow to Mordecai holds until his "Talk" prompt takes over');
{
  const { SafeRoomSystem } = await import('../src/systems/SafeRoomSystem.js');
  const mordecai: Point = { x: 40 * TILE_SIZE, y: 40 * TILE_SIZE };
  const viewFrom = (tilesAway: number): Viewpoint => {
    const player = { x: mordecai.x + tilesAway * TILE_SIZE, y: mordecai.y };
    return {
      player,
      camera: { x: player.x - DESKTOP.width / 2, y: player.y - DESKTOP.height / 2 },
    };
  };
  const promptTiles = SafeRoomSystem.MORDECAI_NEAR_DISTANCE;
  const justOutside = draw(
    DESKTOP,
    'HUMAN_GETS_TO_SAFE_ROOM',
    baseRenderContext({ mordecaiPosition: mordecai }),
    viewFrom(promptTiles + PROMPT_EDGE_MARGIN_TILES),
  );
  check(
    justOutside.arrowTips.length > 0,
    `just outside his prompt's ${promptTiles}-tile range the arrow still shows`,
  );
  const justInside = draw(
    DESKTOP,
    'HUMAN_GETS_TO_SAFE_ROOM',
    baseRenderContext({ mordecaiPosition: mordecai }),
    viewFrom(promptTiles - PROMPT_EDGE_MARGIN_TILES),
  );
  check(justInside.arrowTips.length === 0, 'inside it the arrow stands down for the prompt');
}

const { splitKillXp } = await import('../src/systems/CombatSystem.js');

/** Every tutorial kill in order, with who deals it. */
const TUTORIAL_KILL_ORDER = [
  { mob: 0, dealer: 'human' },
  { mob: 2, dealer: 'human' },
  { mob: 3, dealer: 'human' },
  { mob: 1, dealer: 'cat' },
] as const;
const GOBLIN_A_KILL = 0;
const FIRST_GUARD_KILL = 1;
const SECOND_GUARD_KILL = 2;
const HARD_DIFFICULTY_XP_SCALE = 1.25;
const LEVEL_BEFORE = 1;
const LEVEL_AFTER = 2;

/** The human's and the cat's levels after each tutorial kill, at a difficulty's reward scale. */
function levelsThroughTutorial(xpScale: number): { human: number; cat: number }[] {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const mobs = TutorialController.createForTutorial().allMobs;
  for (const mob of mobs) mob.applyDifficultyRewards(xpScale, 1);
  return TUTORIAL_KILL_ORDER.map(({ mob, dealer }) => {
    const split = splitKillXp({
      totalXp: mobs[mob].scaledXpValue,
      humanLevel: human.level,
      catLevel: cat.level,
      topDealer: dealer,
    });
    human.gainXp(split.human);
    cat.gainXp(split.cat);
    return { human: human.level, cat: cat.level };
  });
}

section('The human levels up exactly on the smush, and the cat not at all');
for (const xpScale of [1, HARD_DIFFICULTY_XP_SCALE]) {
  const levels = levelsThroughTutorial(xpScale);
  const at = (kill: number): { human: number; cat: number } => levels[kill];
  check(
    at(GOBLIN_A_KILL).human === LEVEL_BEFORE && at(FIRST_GUARD_KILL).human === LEVEL_BEFORE,
    `×${xpScale}: still level 1 after goblin A and the first guard`,
  );
  check(at(SECOND_GUARD_KILL).human === LEVEL_AFTER, `×${xpScale}: level 2 on the second guard`);
  const final = lastOf(levels);
  check(
    final !== null && final.human === LEVEL_AFTER && final.cat === LEVEL_BEFORE,
    `×${xpScale}: and no other level-up by the end (${JSON.stringify(final)})`,
  );
}

/** A controller with both crawlers, at `state`, with the human active or not. */
function tutorialAt(state: TutorialState): {
  tutorial: Controller;
  human: InstanceType<typeof HumanPlayer>;
  cat: InstanceType<typeof CatPlayer>;
} {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const tutorial = TutorialController.createForTutorial();
  tutorial.initializePlayers(human, cat);
  advanceTo(tutorial, state);
  return { tutorial, human, cat };
}

/** Frames enough for any of the tutorial's timed beats to run out. */
const BEAT_FRAMES = 200;

function runFrames(
  tutorial: Controller,
  human: InstanceType<typeof HumanPlayer>,
  cat: InstanceType<typeof CatPlayer>,
): void {
  for (let frame = 0; frame < BEAT_FRAMES; frame++) tutorial.update(human, cat);
}

section('the stat step waits for the human’s point, on the Character page, then pans to the cat');
{
  const { tutorial, human, cat } = tutorialAt('HUMAN_SMUSHED_GUARDS');
  human.gainXp(human.xpNeededForNextLevel);
  runFrames(tutorial, human, cat);
  check(tutorial.state === 'HUMAN_LEVELED_UP', `after the smush beat it waits (${tutorial.state})`);
  const restriction = tutorial.pauseRestriction();
  check(
    restriction?.kind === 'section' && restriction.section === 'character',
    'the pause menu is pinned to the Character page',
  );
  check(tutorial.forcesSkillPointBadge, 'and the level badge is kept on screen');
  applyGodModeToPlayer(human);
  runFrames(tutorial, human, cat);
  check(tutorial.state === 'HUMAN_LEVELED_UP', 'god mode spends nothing for the player');
  human.spendPoint('constitution');
  tutorial.update(human, cat);
  check(
    tutorial.state === 'CAMERA_PAN_TO_CAT' &&
      tutorial.needsAutoCloseMenus &&
      tutorial.needsCameraPanStart,
    `a point spent under god mode closes the menu and starts the pan (${tutorial.state})`,
  );

  const skipped = tutorialAt('HUMAN_SMUSHED_GUARDS');
  runFrames(skipped.tutorial, skipped.human, skipped.cat);
  check(
    skipped.tutorial.state === 'CAMERA_PAN_TO_CAT' || skipped.tutorial.state === 'SWITCHED_TO_CAT',
    `with no point to spend it goes straight to the pan (${skipped.tutorial.state})`,
  );
}

section('a step finished inside a menu completes while the menu halts the world');
{
  const { tutorial, human, cat } = tutorialAt('HUMAN_LEVELED_UP');
  human.gainXp(human.xpNeededForNextLevel);
  tutorial.updateUnderMenus(human, cat);
  check(tutorial.state === 'HUMAN_LEVELED_UP', 'with the point unspent the Character page stays');
  human.spendPoint('strength');
  tutorial.updateUnderMenus(human, cat);
  check(
    tutorial.state === 'CAMERA_PAN_TO_CAT' && tutorial.needsAutoCloseMenus,
    `the point spent, the step is done and asks for the menus to close (${tutorial.state})`,
  );

  const bag = tutorialAt('HUMAN_OPENED_ACHIEVEMENT');
  bag.human.inventory.addItem('smush_tome', 1);
  bag.human.inventory.addItem('health_potion', 1);
  bag.human.inventory.addItem('lucky_hoodie', 1);
  bag.human.inventory.placeOnHotbar('smush_tome', 0);
  bag.human.inventory.placeOnHotbar('health_potion', 1);
  bag.human.inventory.equipment.equipById('lucky_hoodie');
  bag.tutorial.updateUnderMenus(bag.human, bag.cat);
  check(
    bag.tutorial.state === 'HUMAN_EQUIPPED_SMUSH' && bag.tutorial.needsAutoCloseMenus,
    `The human's bag step, finished, closes the menus (${bag.tutorial.state})`,
  );
}

section('after goblin B the game waits for the player to switch back to the human');
{
  const { tutorial, human, cat } = tutorialAt('CAT_SHOT_GUARD');
  human.isActive = false;
  cat.isActive = true;
  check(!tutorial.canSwitchCharacter, 'the switch is refused before its step');
  runFrames(tutorial, human, cat);
  check(
    tutorial.state === 'AWAITING_SWITCH_TO_HUMAN' && tutorial.canSwitchCharacter,
    `then it waits, with the switch allowed (${tutorial.state})`,
  );
  human.isActive = true;
  cat.isActive = false;
  tutorial.update(human, cat);
  check(tutorial.state === 'SWITCHED_TO_HUMAN', 'the player’s own switch completes it');
  advanceTo(tutorial, 'TALKED_TO_MORDECAI_AGAIN');
  check(tutorial.canSwitchCharacter, 'and switching keeps working to the end of the tutorial');
}

const { PLAYER_SPEED } = await import('../src/core/constants.js');
const {
  TUTORIAL_GATE_SAFE_ENTRANCE,
  TUTORIAL_GATE_G1,
  TUTORIAL_GATE_G2,
  TUTORIAL_GATE_G3,
  TUTORIAL_GOBLIN_B_DOOR,
  TUTORIAL_GATE_SMUSH,
  TUTORIAL_CAT_SPAWN_TILE,
  GOBLIN_B_POS,
} = await import('../src/map/TutorialMap.js');

/** How far up the hall a crawler starts its walk at a gate. */
const GATE_WALK_START_TILES = 8;
/** How far past a gate's row the walk carries on, to be sure the crawler is through. */
const GATE_WALK_PAST_TILES = 2;
/** Frames enough for any gate to finish opening and settle. */
const GATE_SETTLE_FRAMES = 120;
/** Ink a drawn gate must leave in its own patch of screen, as a share of its pixels. */
const MIN_GATE_INK_SHARE = 0.05;
const ALPHA_CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** A camera far enough from every gate that none is on screen. */
const FAR_AWAY_PX = -100000;

type GateView = Parameters<Controller['updateGates']>[2];

/** What the gates see: a camera, and every dialog box shut unless said otherwise. */
function gateView(camera: { x: number; y: number }, dialogOpen = false): GateView {
  return { camera, dialogOpen };
}

const TILE_FRACTION_HALF = 0.5;
/** Smush's level in the tutorial, the one taught at the smush gate. */
const TUTORIAL_SMUSH_LEVEL = 1;
/** Tiles of slack goblin B must stand beyond Smush's blast, so a step closer never reaches him. */
const SMUSH_REACH_MARGIN_TILES = 1;
/** More than any tutorial goblin's health. */
const SMUSH_TEST_DAMAGE = 100;
/** Where the door's leaves meet the floor, down its row. */
const DOOR_GROUND_LINE_TILES = 0.55;
const FAR_VIEW = gateView({ x: FAR_AWAY_PX, y: FAR_AWAY_PX });

/** Two fresh crawlers and a fresh tutorial, the human the one being steered. */
function freshTutorial(): {
  tutorial: Controller;
  human: InstanceType<typeof HumanPlayer>;
  cat: InstanceType<typeof CatPlayer>;
} {
  setViewportSize(DESKTOP.width, DESKTOP.height);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const tutorial = TutorialController.createForTutorial();
  tutorial.initializePlayers(human, cat);
  human.isActive = true;
  return { tutorial, human, cat };
}

/** Runs the gates long enough for any that started opening to finish. */
function settleGates(
  tutorial: Controller,
  human: InstanceType<typeof HumanPlayer>,
  cat: InstanceType<typeof CatPlayer>,
  view: GateView,
): void {
  for (let frame = 0; frame < GATE_SETTLE_FRAMES; frame++) tutorial.updateGates(human, cat, view);
}

function raisedCue(tutorial: Controller, cue: string): boolean {
  return tutorial.drainGateCues().some((raised) => raised.cue === cue);
}

/** The smush gate's middle, where its cues sound from. */
const SMUSH_GATE_CENTRE = {
  x: (TUTORIAL_GATE_SMUSH.x + TILE_FRACTION_HALF) * TILE_SIZE,
  y: ((TUTORIAL_GATE_SMUSH.y1 + TUTORIAL_GATE_SMUSH.y2 + 1) / 2) * TILE_SIZE,
};

/** Whether `cue` was raised by the smush gate rather than any other gate the step unlocked. */
function smushGateRaised(tutorial: Controller, cue: string): boolean {
  return tutorial
    .drainGateCues()
    .some(
      (raised) =>
        raised.cue === cue && raised.x === SMUSH_GATE_CENTRE.x && raised.y === SMUSH_GATE_CENTRE.y,
    );
}

/** A camera centred on the crawler, as the scene's own follows the active one. */
function cameraOn(crawler: { x: number; y: number }): { x: number; y: number } {
  return {
    x: crawler.x + TILE_SIZE / 2 - DESKTOP.width / 2,
    y: crawler.y + TILE_SIZE / 2 - DESKTOP.height / 2,
  };
}

/** The human standing in the safe-entrance gate's hall, `tilesNorth` rows short of its clamp line. */
function humanInSafeEntranceHall(tilesNorth: number): {
  tutorial: Controller;
  human: InstanceType<typeof HumanPlayer>;
  cat: InstanceType<typeof CatPlayer>;
} {
  setViewportSize(DESKTOP.width, DESKTOP.height);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const tutorial = TutorialController.createForTutorial();
  tutorial.initializePlayers(human, cat);
  human.isActive = true;
  const middleColumn = (TUTORIAL_GATE_SAFE_ENTRANCE.x1 + TUTORIAL_GATE_SAFE_ENTRANCE.x2) / 2;
  human.x = middleColumn * TILE_SIZE;
  human.y = TUTORIAL_GATE_SAFE_ENTRANCE.clampPxY - tilesNorth * TILE_SIZE;
  return { tutorial, human, cat };
}

/**
 * The human walks straight west along the connector at the smush gate from the
 * safe room; counts the frames a gate stopped him.
 */
function walkThroughSmushGate(godMode: boolean): { stops: number; through: boolean } {
  const { tutorial, human, cat } = freshTutorial();
  if (godMode) applyGodModeToPlayer(human);
  human.x = TUTORIAL_GATE_SMUSH.clampPxX + GATE_WALK_START_TILES * TILE_SIZE;
  human.y = ((TUTORIAL_GATE_SMUSH.y1 + TUTORIAL_GATE_SMUSH.y2) / 2) * TILE_SIZE;
  advanceTo(tutorial, 'HUMAN_SMUSHED_GUARDS');
  const step = PLAYER_SPEED * human.speedMultiplier;
  const goalX = (TUTORIAL_GATE_SMUSH.x - GATE_WALK_PAST_TILES) * TILE_SIZE;
  let stops = 0;
  for (let frame = 0; frame < GATE_SETTLE_FRAMES * 2 && human.x > goalX; frame++) {
    const wanted = human.x - step;
    human.x = wanted;
    tutorial.applyGateConstraints(human, cat);
    if (human.x > wanted) stops++;
    tutorial.updateGates(human, cat, gateView(cameraOn(human)));
  }
  return { stops, through: human.x <= goalX };
}

section('a shut gate is drawn and holds its crawler back');
{
  const { tutorial, human, cat } = humanInSafeEntranceHall(0);
  const camera = cameraOn(human);
  const ctx = gameContext(DESKTOP.width, DESKTOP.height);
  for (const piece of tutorial.gateRenderables()) piece.render(ctx, camera.x, camera.y, TILE_SIZE);
  const gateLeft = TUTORIAL_GATE_SAFE_ENTRANCE.x1 * TILE_SIZE - camera.x;
  const gateTop = (TUTORIAL_GATE_SAFE_ENTRANCE.y - 1) * TILE_SIZE - camera.y;
  const gateWidth =
    (TUTORIAL_GATE_SAFE_ENTRANCE.x2 - TUTORIAL_GATE_SAFE_ENTRANCE.x1 + 1) * TILE_SIZE;
  const gateHeight = 2 * TILE_SIZE;
  const pixels = ctx.getImageData(gateLeft, gateTop, gateWidth, gateHeight).data;
  let inked = 0;
  for (let i = ALPHA_OFFSET; i < pixels.length; i += ALPHA_CHANNELS) if (pixels[i] > 0) inked++;
  const share = inked / (gateWidth * gateHeight);
  check(share >= MIN_GATE_INK_SHARE, `the shut gate is painted (${(share * 100).toFixed(0)}% ink)`);

  human.y = (TUTORIAL_GATE_SAFE_ENTRANCE.y + 1) * TILE_SIZE;
  tutorial.applyGateConstraints(human, cat);
  check(
    human.y === TUTORIAL_GATE_SAFE_ENTRANCE.clampPxY,
    `The human walking into it is held at its clamp line (y ${human.y})`,
  );
  const firstBump = tutorial.drainGateCues().map((raised) => raised.cue);
  human.y += PLAYER_SPEED;
  tutorial.applyGateConstraints(human, cat);
  const secondBump = tutorial.drainGateCues().map((raised) => raised.cue);
  check(
    firstBump.includes('gateLocked') && !secondBump.includes('gateLocked'),
    `it rattles when walked into, and not again on the very next frame (${firstBump.join(',')} / ${secondBump.join(',')})`,
  );
}

section("The human's safe-room gate rises as soon as all of it is in view, however far off he is");
{
  const { tutorial, human, cat } = humanInSafeEntranceHall(GATE_WALK_START_TILES);
  advanceTo(tutorial, 'HUMAN_KILLED_GOBLIN');
  const gateRowPx = TUTORIAL_GATE_SAFE_ENTRANCE.y * TILE_SIZE;
  const cutOff = gateView({ x: cameraOn(human).x, y: gateRowPx - DESKTOP.height });
  tutorial.updateGates(human, cat, cutOff);
  check(raisedCue(tutorial, 'gateUnlock'), 'its latch sounds the moment goblin A dies');
  tutorial.updateGates(human, cat, cutOff);
  check(!raisedCue(tutorial, 'gateRaise'), 'it stays down while the view cuts it off');
  tutorial.updateGates(human, cat, gateView(cameraOn(human)));
  check(
    raisedCue(tutorial, 'gateRaise'),
    `and rises once it is wholly in view, the human still ${GATE_WALK_START_TILES} tiles up the hall`,
  );
}

section("The cat's gate opens once every dialog box is shut, wherever she is");
{
  const { tutorial, human, cat } = freshTutorial();
  human.isActive = false;
  cat.isActive = true;
  cat.x = TUTORIAL_CAT_SPAWN_TILE.x * TILE_SIZE;
  cat.y = TUTORIAL_CAT_SPAWN_TILE.y * TILE_SIZE;
  advanceTo(tutorial, 'SWITCHED_TO_CAT');
  tutorial.updateGates(human, cat, gateView(cameraOn(cat), true));
  check(!raisedCue(tutorial, 'gateRaise'), 'it stays down while a dialog box is open');
  tutorial.updateGates(human, cat, FAR_VIEW);
  check(raisedCue(tutorial, 'gateRaise'), 'and rises the frame the last one closes');
  settleGates(tutorial, human, cat, FAR_VIEW);
  cat.y = TUTORIAL_GATE_G1.clampPxY + PLAYER_SPEED;
  tutorial.applyGateConstraints(human, cat);
  check(cat.y > TUTORIAL_GATE_G1.clampPxY, 'after which it no longer holds her');
}

section("the final gate opens the moment Mordecai's farewell ends");
{
  const { tutorial, human, cat } = freshTutorial();
  human.x = ((TUTORIAL_GATE_G3.x1 + TUTORIAL_GATE_G3.x2) / 2) * TILE_SIZE;
  advanceTo(tutorial, 'CAT_ARRIVED');
  settleGates(tutorial, human, cat, gateView(cameraOn(human)));
  human.y = TUTORIAL_GATE_G3.clampPxY + PLAYER_SPEED;
  tutorial.applyGateConstraints(human, cat);
  check(human.y === TUTORIAL_GATE_G3.clampPxY, 'it holds the human until the farewell is heard');
  advanceTo(tutorial, 'TALKED_TO_MORDECAI_AGAIN');
  tutorial.drainGateCues();
  tutorial.updateGates(human, cat, FAR_VIEW);
  check(raisedCue(tutorial, 'gateRaise'), 'then rises at once, in view or not');
  settleGates(tutorial, human, cat, FAR_VIEW);
  human.y = TUTORIAL_GATE_G3.clampPxY + PLAYER_SPEED;
  tutorial.applyGateConstraints(human, cat);
  check(human.y > TUTORIAL_GATE_G3.clampPxY, 'and lets him through');
}

section('the smush gate waits for the human to walk up to it, on screen, and never stops him');
{
  const { tutorial, human, cat } = freshTutorial();
  human.x = TUTORIAL_GATE_SMUSH.clampPxX + GATE_WALK_START_TILES * TILE_SIZE;
  human.y = ((TUTORIAL_GATE_SMUSH.y1 + TUTORIAL_GATE_SMUSH.y2) / 2) * TILE_SIZE;
  advanceTo(tutorial, 'HUMAN_SMUSHED_GUARDS');
  tutorial.updateGates(human, cat, gateView(cameraOn(human)));
  check(!smushGateRaised(tutorial, 'gateRaise'), 'it stays down while the human is far off');
  human.x = TUTORIAL_GATE_SMUSH.clampPxX;
  tutorial.updateGates(human, cat, FAR_VIEW);
  check(
    !smushGateRaised(tutorial, 'gateRaise'),
    'and while it is off screen, even with the human at it',
  );
  tutorial.updateGates(human, cat, gateView(cameraOn(human)));
  check(
    smushGateRaised(tutorial, 'gateRaise'),
    'and rises when it comes on screen with the human beside it',
  );

  const normal = walkThroughSmushGate(false);
  check(
    normal.through && normal.stops === 0,
    `walking at it, the human passes without a stop (${normal.stops} frames held)`,
  );
  const god = walkThroughSmushGate(true);
  check(god.through && god.stops === 0, `at god-mode pace too (${god.stops} frames held)`);
}

section('the cat waiting at the fence goes through the moment she is called');
{
  const { tutorial, human, cat } = freshTutorial();
  cat.x = ((TUTORIAL_GATE_G2.x1 + TUTORIAL_GATE_G2.x2) / 2) * TILE_SIZE;
  cat.y = TUTORIAL_GATE_G2.clampPxY;
  advanceTo(tutorial, 'SWITCHED_TO_HUMAN');
  settleGates(tutorial, human, cat, FAR_VIEW);
  tutorial.drainGateCues();
  cat.y += PLAYER_SPEED;
  tutorial.applyGateConstraints(human, cat);
  check(
    cat.y === TUTORIAL_GATE_G2.clampPxY,
    `before she is called the fence holds her (y ${cat.y} vs ${TUTORIAL_GATE_G2.clampPxY})`,
  );
  advanceTo(tutorial, 'CAT_ARRIVED');
  tutorial.updateGates(human, cat, FAR_VIEW);
  check(
    raisedCue(tutorial, 'fenceGateSwing'),
    'called, its gate swings open at once, though the human is too far off to see it',
  );
  settleGates(tutorial, human, cat, FAR_VIEW);
  const before = cat.y + PLAYER_SPEED;
  cat.y = before;
  tutorial.applyGateConstraints(human, cat);
  check(cat.y === before, 'and once it is open it no longer holds her');
}

section("goblin B's door keeps the human off him until the cat's missile kills him");
{
  const { tutorial, human, cat } = freshTutorial();
  human.x = ((TUTORIAL_GOBLIN_B_DOOR.x1 + TUTORIAL_GOBLIN_B_DOOR.x2) / 2) * TILE_SIZE;
  human.y = TUTORIAL_GOBLIN_B_DOOR.southClampPxY + TILE_SIZE;
  advanceTo(tutorial, 'CAT_EQUIPPED_MAGIC_MISSILE');
  settleGates(tutorial, human, cat, gateView(cameraOn(human)));
  for (let frame = 0; frame < GATE_SETTLE_FRAMES; frame++) {
    human.y -= PLAYER_SPEED;
    tutorial.applyGateConstraints(human, cat);
  }
  const goblinBottomPx = (GOBLIN_B_POS.y + 1) * TILE_SIZE;
  check(
    human.y === TUTORIAL_GOBLIN_B_DOOR.southClampPxY && human.y > goblinBottomPx,
    `walking north at goblin B, the human is held south of his door (y ${human.y}, goblin ends at ${goblinBottomPx})`,
  );
  const { getSmushStats } = await import('../src/abilities/smush.js');
  const humanCentreY = TUTORIAL_GOBLIN_B_DOOR.southClampPxY + TILE_SIZE / 2;
  const goblinCentreY = (GOBLIN_B_POS.y + 1 / 2) * TILE_SIZE;
  const smushReachPx =
    (getSmushStats(TUTORIAL_SMUSH_LEVEL).outerBlastRadius + SMUSH_REACH_MARGIN_TILES) * TILE_SIZE;
  check(
    humanCentreY - goblinCentreY > smushReachPx,
    `from there goblin B is ${((humanCentreY - goblinCentreY) / TILE_SIZE).toFixed(1)} tiles off, past a level-1 Smush's blast plus ${SMUSH_REACH_MARGIN_TILES} (${(smushReachPx / TILE_SIZE).toFixed(1)})`,
  );
  const goblinB = tutorial.allMobs.find(
    (mob) => mob.x === GOBLIN_B_POS.x * TILE_SIZE && mob.y === GOBLIN_B_POS.y * TILE_SIZE,
  );
  check(
    goblinB !== undefined &&
      !goblinB.takesPlayerDamage('smush') &&
      !goblinB.takesPlayerDamage('melee') &&
      !goblinB.takesPlayerDamage('slingshot') &&
      goblinB.takesPlayerDamage('missile'),
    "and nothing of the human's can hurt goblin B at any range, god-mode Smush included: only the cat's missile",
  );
  if (goblinB !== undefined) {
    goblinB.takeDamageFrom(SMUSH_TEST_DAMAGE, human, 'smush');
    check(goblinB.isAlive, 'a Smush landing on him anyway leaves him standing');
  }
  const missileReachPx = cat.attackReachPx();
  const catFootY = TUTORIAL_GATE_G2.clampPxY + TILE_SIZE / 2;
  const doorFootY = (TUTORIAL_GOBLIN_B_DOOR.y + DOOR_GROUND_LINE_TILES) * TILE_SIZE;
  check(
    catFootY + missileReachPx < doorFootY,
    `the cat's missile, fired from the fence, dies ${((doorFootY - catFootY - missileReachPx) / TILE_SIZE).toFixed(1)} tiles short of the solid door`,
  );
  advanceTo(tutorial, 'CAT_SHOT_GUARD');
  tutorial.drainGateCues();
  tutorial.updateGates(human, cat, FAR_VIEW);
  check(raisedCue(tutorial, 'doorOpen'), 'it swings open the moment goblin B dies');
  settleGates(tutorial, human, cat, FAR_VIEW);
  human.y -= PLAYER_SPEED;
  const wanted = human.y;
  tutorial.applyGateConstraints(human, cat);
  check(human.y === wanted, 'and then holds nobody back');
}

section('a gate unlocked far from the player is still heard, from its direction');
{
  const { placedGain } = await import('../src/audio/AudioManager.js');
  const { soundTraits } = await import('../src/audio/soundTraits.js');
  const { TUTORIAL_CUES, tutorialCueSource } = await import('../src/systems/tutorialSoundCues.js');
  const { TUTORIAL_HUMAN_SPAWN_TILE } = await import('../src/map/TutorialMap.js');
  setViewportSize(DESKTOP.width, DESKTOP.height);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const tutorial = TutorialController.createForTutorial();
  tutorial.initializePlayers(human, cat);
  human.isActive = true;
  human.x = TUTORIAL_HUMAN_SPAWN_TILE.x * TILE_SIZE;
  human.y = TUTORIAL_HUMAN_SPAWN_TILE.y * TILE_SIZE;
  cat.x = FAR_AWAY_PX;
  cat.y = FAR_AWAY_PX;
  advanceTo(tutorial, 'SWITCHED_TO_CAT');
  tutorial.updateGates(human, cat, gateView(cameraOn(human)));
  const unlock = tutorial.drainGateCues().find((raised) => raised.cue === 'gateUnlock');
  check(unlock !== undefined, "The cat's gate unlocks while the human is across the map");
  if (unlock !== undefined) {
    const ears = { x: human.x + TILE_SIZE / 2, y: human.y + TILE_SIZE / 2 };
    const tilesFrom = (point: { x: number; y: number }): number =>
      Math.hypot(point.x - ears.x, point.y - ears.y) / TILE_SIZE;
    const hearing = Math.min(...TUTORIAL_CUES.gateUnlock.map((id) => soundTraits(id).hearingTiles));
    const source = tutorialCueSource(unlock, human);
    const sameSide = Math.sign(source.x - ears.x) === Math.sign(unlock.x - ears.x);
    check(
      tilesFrom(unlock) > hearing && placedGain(tilesFrom(source), hearing) > 0 && sameSide,
      `the gate is ${tilesFrom(unlock).toFixed(0)} tiles off, past hearing (${hearing}), and its latch plays ${tilesFrom(source).toFixed(0)} tiles off on the same side`,
    );
  }
}

if (failures > 0) {
  console.log(`\n${failures} tutorial guide check(s) failed.`);
  process.exit(1);
}
console.log('\nAll tutorial guide checks passed.');
