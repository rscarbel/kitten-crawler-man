#!/usr/bin/env tsx
/**
 * The click-through gate for `UiRoot`, run headless against fake surfaces.
 *
 * The probe at the top is what every real surface will be put through: tap the
 * centre of every region it registered, tap points it visibly covers, and check
 * that exactly the intended handler fired and the world saw nothing. It starts
 * with a self-test against a deliberately leaky surface, so a probe that has
 * stopped catching click-through fails here first.
 *
 * Then unit checks of the dispatcher: capture, the modal scrim, a modal
 * opening mid-gesture, Escape order, clip-intersected hits, focus scoping,
 * keyboard activation, world ownership, wheel routing, drag hand-off,
 * press-on-down, state clearing and pointer scaling.
 *
 * Last, the real `DungeonScene` on a desktop and on a phone, through
 * `uiInputDungeon.ts`: the known click-through cases against its own surfaces.
 *
 * Run: npm run verify:ui-input
 */

import { spawnSync } from 'node:child_process';
import { gameContext } from './nodeGameContext.js';
import type { SoundId } from '../src/audio/sounds.js';
import {
  UiRoot,
  UI_ERROR_SOUND,
  UI_TAP_SOUND,
  type Band,
  type DragPoint,
  type HitHandlers,
  type HitState,
  type KeyModifiers,
  type ReleaseInfo,
  type Surface,
  type TapEvent,
  type Ui,
  type WorldGesture,
} from '../src/ui/core/UiRoot.js';
import {
  contains,
  grid,
  inset,
  intersect,
  splitH,
  splitV,
  type Rect,
} from '../src/ui/core/geom.js';
import {
  MENU_TAP_MAX_DISTANCE,
  MOUSE_POINTER_ID,
  PointerInput,
  PRIMARY_BUTTON,
  TAP_SLOP,
} from '../src/ui/core/pointer.js';
import { UiStateSlot } from '../src/ui/core/uiState.js';
import { activeInputMode } from '../src/ui/core/inputMode.js';
import { keybindings } from '../src/core/Keybindings.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import type { UiSize } from '../src/core/Settings.js';
import { GLYPH_IDS, GLYPH_PATHS, parsePathData } from '../src/ui/theme/glyphs.js';
import { resolveTheme } from '../src/ui/theme/tokens.js';
import { skinsFor } from '../src/ui/theme/skins.js';
import { itemSlot } from '../src/ui/widgets/itemSlot.js';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function mid(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Points on bare world, away from every fake surface's controls. */
const BARE_WORLD: Point = { x: 700, y: 500 };
const BARE_WORLD_NUDGED: Point = { x: 720, y: 500 };
const SCREEN_CORNER: Point = { x: 5, y: 5 };

const SCREEN_W = 800;
const SCREEN_H = 600;
const TOUCH_POINTER_ID = 7;
/** CSS points round-trip through the UI scale in floating point; this is "the same point". */
const SAME_POINT_TOLERANCE = 1e-9;
/** One mouse-wheel notch. */
const WHEEL_NOTCH = 40;

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_POINT_TOLERANCE;
}

// ── Fakes ──────────────────────────────────────────────────────────────────

/** Everything the fakes report, in order. */
interface Recorder {
  readonly fired: string[];
  readonly world: WorldGesture[];
  readonly sounds: SoundId[];
  readonly warnings: string[];
}

function recorder(): Recorder {
  return { fired: [], world: [], sounds: [], warnings: [] };
}

function clear(rec: Recorder): void {
  rec.fired.length = 0;
  rec.world.length = 0;
  rec.sounds.length = 0;
  rec.warnings.length = 0;
}

interface FakeSurfaceSpec {
  readonly id: string;
  readonly band: Band;
  readonly open?: boolean;
  readonly haltsWorld?: boolean;
  readonly closable?: boolean;
  readonly blocksEscape?: boolean;
  readonly draw: (ui: Ui, self: FakeSurface) => void;
}

class FakeSurface implements Surface {
  readonly id: string;
  readonly band: Band;
  readonly haltsWorld: boolean;
  readonly blocksEscape: boolean;
  readonly close?: () => void;
  open: boolean;
  /** The last HitState each widget id was given, for visual-state checks. */
  readonly states = new Map<string, HitState>();
  private readonly draw: (ui: Ui, self: FakeSurface) => void;

  constructor(spec: FakeSurfaceSpec) {
    this.id = spec.id;
    this.band = spec.band;
    this.open = spec.open ?? true;
    this.haltsWorld = spec.haltsWorld ?? false;
    this.blocksEscape = spec.blocksEscape ?? false;
    this.draw = spec.draw;
    if (spec.closable === true) {
      this.close = () => {
        this.open = false;
      };
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  render(ui: Ui): void {
    this.draw(ui, this);
  }
}

/** Registers a button that logs `${surface}/${id}` when it fires. */
function fakeButton(
  ui: Ui,
  self: FakeSurface,
  rec: Recorder,
  id: string,
  rect: Rect,
  extra: Partial<HitHandlers> = {},
): HitState {
  const state = ui.hit(id, rect, {
    onTap: () => rec.fired.push(`${self.id}/${id}`),
    ...extra,
  });
  self.states.set(id, state);
  return state;
}

interface Harness {
  readonly root: UiRoot;
  readonly rec: Recorder;
  readonly ctx: CanvasRenderingContext2D;
  frame(): void;
  tap(p: Point, pointerId?: number): void;
  down(p: Point, pointerId?: number): void;
  move(p: Point, pointerId?: number): void;
  up(p: Point, pointerId?: number): void;
  wheel(p: Point, deltaY: number): void;
  cancel(p: Point, pointerId?: number): void;
}

function harness(surfaces: readonly Surface[], uiSize: UiSize = 'medium'): Harness {
  const rec = recorder();
  const viewport = (): ViewportInput => ({
    cssWidth: SCREEN_W,
    cssHeight: SCREEN_H,
    density: 'pointer',
    uiSize,
    safeArea: NO_INSETS,
  });
  let clock = 0;
  const root = new UiRoot({
    audio: { play: (id) => rec.sounds.push(id) },
    viewport,
    handleWorldPointer: (gesture) => rec.world.push(gesture),
    now: () => clock,
    warn: (message) => rec.warnings.push(message),
  });
  for (const surface of surfaces) root.mount(surface);
  const ctx = gameContext(SCREEN_W, SCREEN_H);
  const gesture = (
    kind: 'down' | 'move' | 'up' | 'cancel' | 'wheel',
    { x, y }: Point,
    pointerId: number,
    deltaY = 0,
  ): void => {
    const source = pointerId === MOUSE_POINTER_ID ? 'mouse' : 'touch';
    root.pointer({
      kind,
      pointerId,
      source,
      x,
      y,
      cssX: x,
      cssY: y,
      button: PRIMARY_BUTTON,
      deltaY,
    });
  };
  const FRAME_MS = 16;
  return {
    root,
    rec,
    ctx,
    frame: () => {
      clock += FRAME_MS;
      root.frame(ctx);
    },
    down: (p, pointerId = MOUSE_POINTER_ID) => gesture('down', p, pointerId),
    move: (p, pointerId = MOUSE_POINTER_ID) => gesture('move', p, pointerId),
    up: (p, pointerId = MOUSE_POINTER_ID) => gesture('up', p, pointerId),
    tap: (p, pointerId = MOUSE_POINTER_ID) => {
      gesture('down', p, pointerId);
      gesture('up', p, pointerId);
    },
    wheel: (p, deltaY) => gesture('wheel', p, MOUSE_POINTER_ID, deltaY),
    cancel: (p, pointerId = MOUSE_POINTER_ID) => gesture('cancel', p, pointerId),
  };
}

// ── The click-through probe ─────────────────────────────────────────────────

/**
 * Taps every region `surfaceId` registered, at the centre of its visible part
 * where it is the topmost region, then taps sample points across `covers`
 * (what the surface visibly occupies). Returns one line per click-through or
 * misfire found.
 */
function probeSurface(h: Harness, surfaceId: string, covers: Rect): string[] {
  const problems: string[] = [];
  h.frame();
  const regions = h.root.regions().filter((region) => region.surfaceId === surfaceId);
  for (const region of regions) {
    const x = region.rect.x + region.rect.w / 2;
    const y = region.rect.y + region.rect.h / 2;
    const topmost = [...h.root.regions()].reverse().find((r) => contains(r.rect, x, y));
    if (topmost?.id !== region.id) continue;
    clear(h.rec);
    h.tap({ x, y });
    const expected = region.onTap === undefined || region.disabled ? [] : [region.id];
    if (h.rec.fired.join() !== expected.join()) {
      problems.push(
        `${region.id}: expected [${expected.join()}] to fire, got [${h.rec.fired.join()}]`,
      );
    }
    if (h.rec.world.length > 0) problems.push(`${region.id}: a tap on it reached the world`);
    h.frame();
  }
  const SAMPLES_PER_AXIS = 5;
  const CELL_CENTRE = 0.5;
  for (let ix = 0; ix < SAMPLES_PER_AXIS; ix++) {
    for (let iy = 0; iy < SAMPLES_PER_AXIS; iy++) {
      const x = covers.x + (covers.w * (ix + CELL_CENTRE)) / SAMPLES_PER_AXIS;
      const y = covers.y + (covers.h * (iy + CELL_CENTRE)) / SAMPLES_PER_AXIS;
      clear(h.rec);
      h.tap({ x, y });
      if (h.rec.world.length > 0)
        problems.push(`(${x}, ${y}) inside ${surfaceId} reached the world`);
      const foreign = h.rec.fired.filter((id) => !id.startsWith(`${surfaceId}/`));
      if (foreign.length > 0)
        problems.push(`(${x}, ${y}) inside ${surfaceId} fired ${foreign.join()}`);
      h.frame();
    }
  }
  return problems;
}

const PANEL_RECT: Rect = { x: 200, y: 150, w: 400, h: 300 };
const PANEL_BUTTON: Rect = { x: 350, y: 380, w: 100, h: 40 };
const HUD_BUTTON: Rect = { x: 220, y: 170, w: 60, h: 40 };

function hudSurface(rec: () => Recorder): FakeSurface {
  return new FakeSurface({
    id: 'hud',
    band: 'hud',
    draw: (ui, self) => fakeButton(ui, self, rec(), 'bag', HUD_BUTTON),
  });
}

function panelSurface(
  id: string,
  band: Band,
  rec: () => Recorder,
  opts: { blocksFrame: boolean },
): FakeSurface {
  return new FakeSurface({
    id,
    band,
    closable: true,
    haltsWorld: true,
    draw: (ui, self) => {
      if (opts.blocksFrame) ui.block(PANEL_RECT);
      fakeButton(ui, self, rec(), 'ok', PANEL_BUTTON);
    },
  });
}

section('probe self-test: a panel that forgets to block its frame is caught');
{
  let rec = recorder();
  const leaky = panelSurface('leaky', 'panel', () => rec, { blocksFrame: false });
  const h = harness([hudSurface(() => rec), leaky]);
  rec = h.rec;
  const problems = probeSurface(h, 'leaky', PANEL_RECT);
  check(
    problems.length > 0,
    `the probe reports click-through on the leaky panel (${problems.length} finding(s))`,
  );
  check(
    problems.some((line) => line.includes('fired hud/bag')),
    'the probe names the HUD button the leaky panel let a tap through to',
  );
  check(
    problems.some((line) => line.includes('reached the world')),
    'the probe names the world as reached through the leaky panel',
  );
}

section('probe: a panel that blocks its frame passes');
{
  let rec = recorder();
  const sealed = panelSurface('sealed', 'panel', () => rec, { blocksFrame: true });
  const h = harness([hudSurface(() => rec), sealed]);
  rec = h.rec;
  const problems = probeSurface(h, 'sealed', PANEL_RECT);
  check(problems.length === 0, `no click-through through a blocked panel ${problems.join('; ')}`);
}

section('probe: the same forgetful surface in the modal band is sealed by its automatic scrim');
{
  let rec = recorder();
  const modal = panelSurface('modal', 'modal', () => rec, { blocksFrame: false });
  const h = harness([hudSurface(() => rec), modal]);
  rec = h.rec;
  const screen: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
  const problems = probeSurface(h, 'modal', screen);
  check(problems.length === 0, `the scrim seals the whole screen ${problems.join('; ')}`);
}

// ── Capture ────────────────────────────────────────────────────────────────

const LEFT_BUTTON: Rect = { x: 100, y: 100, w: 80, h: 40 };
const RIGHT_BUTTON: Rect = { x: 300, y: 100, w: 80, h: 40 };

function twoButtonSurface(rec: () => Recorder, haltsWorld = false): FakeSurface {
  return new FakeSurface({
    id: 'menu',
    band: 'panel',
    haltsWorld,
    draw: (ui, self) => {
      fakeButton(ui, self, rec(), 'left', LEFT_BUTTON);
      fakeButton(ui, self, rec(), 'right', RIGHT_BUTTON);
    },
  });
}

section('capture on down, tap on up');
{
  let rec = recorder();
  const menu = twoButtonSurface(() => rec);
  const h = harness([menu]);
  rec = h.rec;
  h.frame();
  h.down(mid(LEFT_BUTTON));
  h.move(mid(RIGHT_BUTTON));
  h.up(mid(RIGHT_BUTTON));
  check(
    rec.fired.length === 0,
    'down on Left, up on Right: neither fires (Right never owned the gesture)',
  );
  check(rec.world.length === 0, 'and the world sees none of it');

  clear(rec);
  const WITHIN_SLOP = TAP_SLOP - 1;
  h.down(mid(LEFT_BUTTON));
  h.up({ x: LEFT_BUTTON.x + LEFT_BUTTON.w + WITHIN_SLOP, y: mid(LEFT_BUTTON).y });
  check(
    rec.fired.join() === 'menu/left',
    'a release just outside Left but within TAP_SLOP still taps Left',
  );
  check(rec.sounds.join() === UI_TAP_SOUND, 'the dispatcher plays the tap sound once');

  clear(rec);
  h.down(mid(LEFT_BUTTON));
  h.frame();
  check(
    menu.states.get('left')?.pressed === true,
    'Left shows pressed while the pointer is down on it',
  );
  h.up(mid(LEFT_BUTTON));
}

// ── Scrim ──────────────────────────────────────────────────────────────────

section('a modal scrim swallows taps everywhere outside its buttons');
{
  let rec = recorder();
  const modal = new FakeSurface({
    id: 'confirm',
    band: 'modal',
    haltsWorld: true,
    draw: (ui, self) => fakeButton(ui, self, rec, 'yes', PANEL_BUTTON),
  });
  const h = harness([hudSurface(() => rec), modal]);
  rec = h.rec;
  h.frame();
  h.tap(mid(HUD_BUTTON));
  check(rec.fired.length === 0, 'a tap on the HUD button under the scrim fires nothing');
  h.tap(SCREEN_CORNER);
  check(rec.world.length === 0, 'a tap on bare scrim never reaches the world');
  h.tap(mid(PANEL_BUTTON));
  check(rec.fired.join() === 'confirm/yes', 'the modal’s own button still fires');
}

// ── Mid-gesture overlay ─────────────────────────────────────────────────────

section('a modal opening between down and up');
{
  let rec = recorder();
  const modal = new FakeSurface({
    id: 'levelUp',
    band: 'modal',
    open: false,
    haltsWorld: true,
    draw: (ui, self) => fakeButton(ui, self, rec, 'ok', PANEL_BUTTON),
  });
  const h = harness([hudSurface(() => rec), modal]);
  rec = h.rec;
  h.frame();
  h.down(mid(HUD_BUTTON));
  modal.open = true;
  h.frame();
  h.up(mid(HUD_BUTTON));
  check(
    rec.fired.length === 0,
    'the HUD button that owned the down does not fire under the new modal',
  );
  check(rec.world.length === 0, 'and the world does not fire either');

  modal.open = false;
  h.frame();
  clear(rec);
  h.down(BARE_WORLD);
  modal.open = true;
  h.frame();
  h.up(BARE_WORLD);
  const kinds = rec.world.map((gesture) => gesture.kind).join();
  check(
    kinds === 'down,cancel',
    `a world-owned gesture covered mid-way ends in cancel, not a tap (got ${kinds})`,
  );
  check(!rec.world.some((gesture) => gesture.tap), 'the world never sees a tap from it');

  modal.open = false;
  h.frame();
  clear(rec);
  h.down(mid(HUD_BUTTON));
  modal.open = true;
  h.up(mid(HUD_BUTTON));
  check(
    rec.fired.length === 0,
    'a modal opened since the last frame blocks even before it has rendered',
  );
}

section('a dialog that closes on tap does not pass the same tap to the world');
{
  let rec = recorder();
  const dialog = new FakeSurface({
    id: 'dialog',
    band: 'modal',
    haltsWorld: true,
    draw: (ui, self) =>
      fakeButton(ui, self, rec, 'close', PANEL_BUTTON, {
        onTap: () => {
          rec.fired.push('dialog/close');
          self.open = false;
        },
      }),
  });
  const h = harness([dialog]);
  rec = h.rec;
  h.frame();
  h.tap(mid(PANEL_BUTTON));
  check(rec.fired.join() === 'dialog/close', 'the close button fires');
  check(rec.world.length === 0, 'the world sees nothing of that tap');
  h.frame();
  h.tap(mid(PANEL_BUTTON));
  check(rec.world.length === 2, 'the next tap on the same spot goes to the world (down + up)');
}

section('a surface closed since the last frame registers nothing');
{
  let rec = recorder();
  const panel = panelSurface('shop', 'panel', () => rec, { blocksFrame: true });
  const h = harness([panel]);
  rec = h.rec;
  h.frame();
  panel.open = false;
  h.tap(mid(PANEL_BUTTON));
  check(rec.fired.length === 0, 'its button cannot fire from the stale registry');
}

// ── Escape ─────────────────────────────────────────────────────────────────

section('Escape order');
{
  let rec = recorder();
  const hud = hudSurface(() => rec);
  const panel = panelSurface('inventory', 'panel', () => rec, { blocksFrame: true });
  const modal = panelSurface('confirm', 'modal', () => rec, { blocksFrame: false });
  const h = harness([hud, panel, modal]);
  rec = h.rec;
  h.frame();
  check(h.root.escape(), 'the first Escape is spent');
  check(!modal.open && panel.open, 'it closed the modal and only the modal');
  check(h.root.escape() && !panel.open, 'the second Escape closes the panel');
  check(!h.root.escape(), 'the third finds nothing closable and falls to the scene');
  check(
    h.root.key('Escape') === 'gameplay',
    'key("Escape") reports gameplay so the scene can toggle pause',
  );

  const guard = new FakeSurface({
    id: 'death',
    band: 'system',
    blocksEscape: true,
    haltsWorld: true,
    draw: () => undefined,
  });
  panel.open = true;
  const guarded = harness([panel, guard]);
  guarded.frame();
  check(guarded.root.escape(), 'a blocksEscape surface spends Escape');
  check(panel.open, 'and nothing beneath it closes');

  const newer = panelSurface('newer', 'panel', () => rec, { blocksFrame: true });
  const older = panelSurface('older', 'panel', () => rec, { blocksFrame: true });
  newer.open = false;
  const ordered = harness([newer, older]);
  ordered.frame();
  newer.open = true;
  ordered.frame();
  check(
    ordered.root.openSurfaceIds().join() === 'older,newer',
    'within a band the stack orders by open time, not mount order',
  );
  ordered.root.escape();
  check(!newer.isOpen() && older.isOpen(), 'Escape closes the most recently opened panel first');
}

// ── Clip ───────────────────────────────────────────────────────────────────

section('hits are intersected with the clip');
{
  let rec = recorder();
  const LIST_VIEW: Rect = { x: 100, y: 100, w: 300, h: 100 };
  const HIDDEN_ROW: Rect = { x: 100, y: 40, w: 300, h: 40 };
  const HALF_ROW: Rect = { x: 100, y: 180, w: 300, h: 40 };
  const CLIPPED_HALF: Point = { x: 200, y: 210 };
  const VISIBLE_HALF: Point = { x: 200, y: 190 };
  const list = new FakeSurface({
    id: 'list',
    band: 'panel',
    draw: (ui, self) => {
      ui.block(inset(LIST_VIEW, -TAP_SLOP * TAP_SLOP));
      ui.clip(LIST_VIEW, () => {
        fakeButton(ui, self, rec, 'hidden', HIDDEN_ROW);
        fakeButton(ui, self, rec, 'half', HALF_ROW);
      });
    },
  });
  const h = harness([list]);
  rec = h.rec;
  h.frame();
  const ids = h.root.regions().map((region) => region.id);
  check(!ids.includes('list/hidden'), 'a row scrolled fully out of view registers nothing');
  const half = h.root.regions().find((region) => region.id === 'list/half');
  const expectedVisible = intersect(HALF_ROW, LIST_VIEW);
  check(
    half !== undefined && expectedVisible !== null && half.rect.h === expectedVisible.h,
    'a half-visible row registers only its visible part',
  );
  h.tap(CLIPPED_HALF);
  check(rec.fired.length === 0, 'a tap on the clipped-off half does nothing');
  h.tap(VISIBLE_HALF);
  check(rec.fired.join() === 'list/half', 'a tap on the visible half fires the row');
}

// ── Focus ──────────────────────────────────────────────────────────────────

section('focus is scoped to the topmost panel, modal or system surface');
{
  let rec = recorder();
  const hud = hudSurface(() => rec);
  const menu = twoButtonSurface(() => rec, true);
  const confirm = new FakeSurface({
    id: 'confirm',
    band: 'modal',
    open: false,
    haltsWorld: true,
    closable: true,
    draw: (ui, self) => {
      fakeButton(ui, self, rec, 'no', { x: 300, y: 300, w: 80, h: 40 });
      fakeButton(ui, self, rec, 'yes', { x: 420, y: 300, w: 80, h: 40 }, { primary: true });
    },
  });
  const h = harness([hud, menu, confirm]);
  rec = h.rec;
  h.frame();
  const visited: string[] = [];
  const TAB_PRESSES = 3;
  for (let step = 0; step < TAB_PRESSES; step++) {
    h.root.key('Tab');
    h.frame();
    for (const [id, state] of menu.states) if (state.focused) visited.push(id);
    if ([...hud.states.values()].some((state) => state.focused)) visited.push('HUD');
  }
  check(
    visited.join() === 'left,right,left',
    `Tab cycles the panel’s controls only (got ${visited.join()})`,
  );

  confirm.open = true;
  h.frame();
  h.root.key('Tab');
  h.frame();
  check(
    confirm.states.get('yes')?.focused === true,
    'a modal takes the ring and starts on its primary control',
  );
  check(
    ![...menu.states.values()].some((state) => state.focused),
    'the panel beneath shows no focus',
  );
  h.root.key('ArrowLeft');
  h.frame();
  check(confirm.states.get('no')?.focused === true, 'arrows move spatially within the modal');

  section('keyboard activation calls onTap directly');
  clear(rec);
  const outcome = h.root.key('Enter');
  check(outcome === 'consumed', 'Enter on a focused control is consumed');
  check(rec.fired.join() === 'confirm/no', 'it fires exactly the focused control');
  check(rec.world.length === 0, 'no pointer gesture is synthesised');
  check(rec.sounds.join() === UI_TAP_SOUND, 'the dispatcher plays the tap sound');

  confirm.open = false;
  h.frame();
  confirm.open = true;
  h.frame();
  clear(rec);
  h.root.key(' ');
  check(
    rec.fired.join() === 'confirm/yes',
    'Space with nothing focused activates the primary control',
  );
}

section('disabled controls');
{
  let rec = recorder();
  const panel = new FakeSurface({
    id: 'shop',
    band: 'panel',
    haltsWorld: true,
    draw: (ui, self) => {
      fakeButton(ui, self, rec, 'buy', LEFT_BUTTON, { disabled: true, primary: true });
    },
  });
  const h = harness([panel]);
  rec = h.rec;
  h.frame();
  h.tap(mid(LEFT_BUTTON));
  check(rec.fired.length === 0, 'a disabled control never fires');
  check(rec.world.length === 0, 'and swallows the tap like a block');
  check(rec.sounds.join() === UI_ERROR_SOUND, 'and plays the error cue');
  clear(rec);
  h.root.key('Enter');
  check(
    rec.fired.length === 0 && rec.sounds.join() === UI_ERROR_SOUND,
    'Enter on it plays the error cue too',
  );
  h.move(mid(LEFT_BUTTON));
  h.frame();
  check(
    panel.states.get('buy')?.hovered === true,
    'it still reports hover, for its reason tooltip',
  );
}

// ── World ownership ────────────────────────────────────────────────────────

section('the world receives only gestures it owned on down');
{
  let rec = recorder();
  const h = harness([hudSurface(() => rec)]);
  rec = h.rec;
  h.frame();
  h.down(mid(HUD_BUTTON));
  h.move(BARE_WORLD);
  h.up(BARE_WORLD);
  check(
    rec.world.length === 0,
    'a gesture that went down on a button never reaches the world, wherever it ends',
  );

  clear(rec);
  h.tap(BARE_WORLD);
  const kinds = rec.world.map((gesture) => gesture.kind).join();
  check(kinds === 'down,up', `a tap on bare world reaches it as down,up (got ${kinds})`);
  check(rec.world.length > 1 && rec.world[1].tap, 'and the up is flagged as a tap');

  clear(rec);
  h.down(BARE_WORLD, MOUSE_POINTER_ID);
  h.down(mid(HUD_BUTTON), TOUCH_POINTER_ID);
  h.up(mid(HUD_BUTTON), TOUCH_POINTER_ID);
  h.move(BARE_WORLD_NUDGED, MOUSE_POINTER_ID);
  h.up(BARE_WORLD_NUDGED, MOUSE_POINTER_ID);
  check(
    rec.world.every((gesture) => gesture.pointerId === MOUSE_POINTER_ID),
    'with two pointers down, the world sees only the one it owns',
  );
  check(rec.fired.join() === 'hud/bag', 'and the other pointer taps its button');
}

section('the world is halted while a halting surface is open');
{
  let rec = recorder();
  const panel = panelSurface('pause', 'panel', () => rec, { blocksFrame: true });
  const h = harness([panel]);
  rec = h.rec;
  h.frame();
  check(h.root.worldHalted(), 'worldHalted() is true');
  check(h.root.key('w') === 'blocked', 'an unclaimed gameplay key is blocked');
  panel.open = false;
  check(
    !h.root.worldHalted() && h.root.key('w') === 'gameplay',
    'closing it lets keys reach gameplay',
  );
}

// ── Wheel, drag, press ─────────────────────────────────────────────────────

section('wheel routing');
{
  let rec = recorder();
  let scrolled = 0;
  const SCROLL_VIEW: Rect = { x: 100, y: 100, w: 300, h: 200 };
  const ROW: Rect = { x: 100, y: 120, w: 300, h: 40 };
  const list = new FakeSurface({
    id: 'list',
    band: 'panel',
    draw: (ui, self) => {
      ui.hit('scroll', SCROLL_VIEW, {
        onWheel: (dy) => {
          scrolled += dy;
        },
        onDrag: {
          onMove: (point) => rec.fired.push(`drag:${Math.round(point.dy)}`),
        },
      });
      fakeButton(ui, self, rec, 'row', ROW);
    },
  });
  const modal = new FakeSurface({ id: 'modal', band: 'modal', open: false, draw: () => undefined });
  const h = harness([list, modal]);
  rec = h.rec;
  h.frame();
  const WHEEL_DELTA = 40;
  h.wheel(mid(ROW), WHEEL_DELTA);
  check(scrolled === WHEEL_DELTA, 'a wheel over a row scrolls the view the row sits in');
  h.wheel(BARE_WORLD, WHEEL_DELTA);
  check(
    rec.world.length === 1 && rec.world[0]?.kind === 'wheel',
    'a wheel over bare world goes to the world',
  );
  modal.open = true;
  h.frame();
  h.wheel(mid(ROW), WHEEL_DELTA);
  check(scrolled === WHEEL_DELTA, 'a modal’s scrim swallows the wheel');
  modal.open = false;
  h.frame();

  section('dragging a row hands the gesture to the scroll view beneath it');
  clear(rec);
  const DRAG_DISTANCE = 30;
  h.down(mid(ROW));
  h.move({ x: mid(ROW).x, y: mid(ROW).y + DRAG_DISTANCE });
  h.up({ x: mid(ROW).x, y: mid(ROW).y + DRAG_DISTANCE });
  check(rec.fired.includes(`drag:${DRAG_DISTANCE}`), 'the scroll view receives the drag');
  check(!rec.fired.includes('list/row'), 'the row does not also tap');
}

section('onPress fires on down and the release is ignored');
{
  let rec = recorder();
  const hotbar = new FakeSurface({
    id: 'hotbar',
    band: 'hud',
    draw: (ui, self) => {
      fakeButton(ui, self, rec, 'slot1', LEFT_BUTTON, {
        onPress: () => rec.fired.push('hotbar/slot1:press'),
      });
    },
  });
  const h = harness([hotbar]);
  rec = h.rec;
  h.frame();
  h.down(mid(LEFT_BUTTON));
  check(rec.fired.join() === 'hotbar/slot1:press', 'press fires on down');
  h.up(mid(LEFT_BUTTON));
  check(rec.fired.join() === 'hotbar/slot1:press', 'the release fires nothing more');
}

// ── State, warnings, scaling ───────────────────────────────────────────────

section('per-surface state is cleared when the surface closes');
{
  const COUNTER = new UiStateSlot('counter', () => ({ value: 0 }));
  const seen: number[] = [];
  const panel = new FakeSurface({
    id: 'counter',
    band: 'panel',
    draw: (ui) => {
      const counter = ui.state(COUNTER, 'clicks');
      counter.value++;
      seen.push(counter.value);
    },
  });
  const h = harness([panel]);
  h.frame();
  h.frame();
  panel.open = false;
  h.frame();
  panel.open = true;
  h.frame();
  check(
    seen.join() === '1,2,1',
    `state persists across frames and resets on reopen (got ${seen.join()})`,
  );
}

section('tweens ease toward their target');
{
  const values: number[] = [];
  const TARGET = 100;
  const panel = new FakeSurface({
    id: 'fade',
    band: 'panel',
    draw: (ui) => values.push(ui.tween('alpha', TARGET, { from: 0 })),
  });
  const h = harness([panel]);
  const FRAMES = 12;
  for (let frame = 0; frame < FRAMES; frame++) h.frame();
  const rising = values.every((value, index) => index === 0 || value >= (values[index - 1] ?? 0));
  check(
    values[0] === 0 && rising && values[values.length - 1] === TARGET,
    'starts at `from`, rises, lands on target',
  );
}

section('duplicate ids in one surface warn in dev');
{
  const panel = new FakeSurface({
    id: 'dupes',
    band: 'panel',
    draw: (ui) => {
      ui.hit('same', LEFT_BUTTON, {});
      ui.hit('same', RIGHT_BUTTON, {});
    },
  });
  const h = harness([panel]);
  h.frame();
  check(h.rec.warnings.length === 1, 'one warning for the shared id');
  h.frame();
  check(h.rec.warnings.length === 1, 'and it is not repeated every frame');
}

section('UI scale');
{
  const gestures: { x: number; y: number }[] = [];
  const LARGE_SCALE = 1.125;
  const input = new PointerInput(
    (gesture) => gestures.push(gesture),
    () => LARGE_SCALE,
  );
  const CSS_POINT = 225;
  input.mouseDown(CSS_POINT, CSS_POINT, PRIMARY_BUTTON);
  input.mouseDown(CSS_POINT, CSS_POINT, PRIMARY_BUTTON);
  check(gestures.length === 1, 'a second mouse down mid-press is ignored');
  check(
    gestures[0]?.x === CSS_POINT / LARGE_SCALE,
    'pointer coordinates are divided by the UI scale',
  );
  const h = harness([], 'large');
  h.frame();
  check(h.root.uiScale === LARGE_SCALE, 'the root resolves uiScale from the uiSize setting');
  check(
    h.root.viewport.screen.w === SCREEN_W / LARGE_SCALE,
    'the viewport is measured in UI units',
  );
}

// ── Geometry, glyphs, theme ────────────────────────────────────────────────

section('a non-halting focus scope leaves Space, Enter, Tab and arrows to gameplay');
{
  let rec = recorder();
  const chatter = new FakeSurface({
    id: 'chatter',
    band: 'panel',
    haltsWorld: false,
    draw: (ui, self) => {
      fakeButton(ui, self, rec, 'left', LEFT_BUTTON, { primary: true });
      fakeButton(ui, self, rec, 'right', RIGHT_BUTTON);
    },
  });
  const h = harness([chatter]);
  rec = h.rec;
  h.frame();
  const outcomes = [' ', 'Enter', 'Tab', 'ArrowDown'].map((key) => h.root.key(key));
  check(
    outcomes.every((outcome) => outcome === 'gameplay'),
    `every focus key reaches gameplay (got ${outcomes.join()})`,
  );
  check(rec.fired.length === 0, 'and none of them fires a control');
}

section('after a pointer press, Enter answers the primary control, not a stale focus');
{
  let rec = recorder();
  const menu = new FakeSurface({
    id: 'menu',
    band: 'panel',
    haltsWorld: true,
    draw: (ui, self) => {
      ui.block(PANEL_RECT);
      fakeButton(ui, self, rec, 'left', LEFT_BUTTON);
      fakeButton(ui, self, rec, 'right', RIGHT_BUTTON, { primary: true });
    },
  });
  const h = harness([menu]);
  rec = h.rec;
  h.frame();
  h.root.key('Tab');
  h.root.key('Tab');
  h.frame();
  check(menu.states.get('left')?.focused === true, 'Tab has moved focus off the primary onto Left');
  h.tap(mid(PANEL_RECT));
  h.frame();
  clear(rec);
  h.root.key('Enter');
  check(rec.fired.join() === 'menu/right', `Enter fires the primary (got ${rec.fired.join()})`);
}

section('regions that share an id each tap on their own');
{
  let rec = recorder();
  const ROW_COUNT = 3;
  const ROW_HEIGHT = 40;
  const LIST_TOP = 100;
  const rowRect = (index: number): Rect => ({
    x: 100,
    y: LIST_TOP + index * ROW_HEIGHT,
    w: 200,
    h: ROW_HEIGHT,
  });
  const shop = new FakeSurface({
    id: 'shop',
    band: 'panel',
    draw: (ui) => {
      for (let index = 0; index < ROW_COUNT; index++) {
        ui.hit('buy', rowRect(index), { onTap: () => rec.fired.push(`buy${index}`) });
      }
    },
  });
  const h = harness([shop]);
  rec = h.rec;
  h.frame();
  const LAST_ROW = ROW_COUNT - 1;
  h.tap(mid(rowRect(LAST_ROW)));
  check(
    rec.fired.join() === `buy${LAST_ROW}`,
    `the last Buy row fires itself (got [${rec.fired.join()}])`,
  );
  clear(rec);
  h.down(mid(rowRect(1)));
  h.frame();
  h.up(mid(rowRect(1)));
  check(rec.fired.join() === 'buy1', 'a middle row still fires after a frame mid-gesture');
}

section('a world gesture released over a control that was already there is not cancelled');
{
  let rec = recorder();
  const h = harness([hudSurface(() => rec)]);
  rec = h.rec;
  h.frame();
  h.down(BARE_WORLD);
  h.move(mid(HUD_BUTTON));
  h.up(mid(HUD_BUTTON));
  const kinds = rec.world.map((gesture) => gesture.kind).join();
  check(kinds === 'down,move,up', `the world gets its release (got ${kinds})`);
  check(rec.fired.length === 0, 'and the HUD button, which never owned it, does not fire');
}

section('cancel delivery and drag endings');
{
  let rec = recorder();
  const SCROLL_VIEW: Rect = { x: 100, y: 100, w: 300, h: 200 };
  const DRAG_DISTANCE = 30;
  const list = new FakeSurface({
    id: 'list',
    band: 'panel',
    draw: (ui) => {
      ui.hit('scroll', SCROLL_VIEW, {
        onDrag: {
          onMove: () => undefined,
          onEnd: (_point, cancelled) =>
            rec.fired.push(cancelled ? 'end:cancelled' : 'end:released'),
        },
      });
    },
  });
  const h = harness([list]);
  rec = h.rec;
  h.frame();
  const start = mid(SCROLL_VIEW);
  const dragged = { x: start.x, y: start.y + DRAG_DISTANCE };
  h.down(start);
  h.move(dragged);
  h.up(dragged);
  check(rec.fired.join() === 'end:released', 'a released drag ends with cancelled = false');
  clear(rec);
  h.down(start);
  h.move(dragged);
  h.cancel(dragged);
  check(rec.fired.join() === 'end:cancelled', 'a cancelled drag ends with cancelled = true');
  clear(rec);
  h.down(BARE_WORLD);
  h.cancel(BARE_WORLD);
  const kinds = rec.world.map((gesture) => gesture.kind).join();
  check(
    kinds === 'down,cancel',
    `the world receives the cancel of a gesture it owns (got ${kinds})`,
  );
}

section('a surface that throws while rendering costs only itself');
{
  let rec = recorder();
  const broken = new FakeSurface({
    id: 'broken',
    band: 'panel',
    draw: () => {
      throw new Error('deliberate render failure');
    },
  });
  const above = new FakeSurface({
    id: 'above',
    band: 'modal',
    draw: (ui, self) => fakeButton(ui, self, rec, 'ok', PANEL_BUTTON),
  });
  const h = harness([broken, above]);
  rec = h.rec;
  let threw = false;
  try {
    h.frame();
  } catch {
    threw = true;
  }
  check(!threw, 'frame() does not throw');
  check(h.ctx.getTransform().a === 1, 'the UI scale is restored after the frame');
  h.tap(mid(PANEL_BUTTON));
  check(rec.fired.join() === 'above/ok', 'the surface above still rendered and registered');
}

section('frame() draws in UI units');
{
  let scaleSeen = 0;
  const probe = new FakeSurface({
    id: 'probe',
    band: 'hud',
    draw: (ui) => {
      scaleSeen = ui.ctx.getTransform().a;
    },
  });
  const h = harness([probe], 'large');
  h.frame();
  check(
    scaleSeen === h.root.uiScale,
    `surfaces render inside ctx.scale(uiScale) (saw ${scaleSeen})`,
  );
}

section('the mouse leaving the canvas clears hover');
{
  let left = 0;
  const input = new PointerInput(
    () => undefined,
    () => 1,
    () => {
      left++;
    },
  );
  input.mouseLeave(0, 0);
  check(left === 1, 'leaving without a press still signals the leave');
  let rec = recorder();
  const h = harness([hudSurface(() => rec)]);
  rec = h.rec;
  h.frame();
  h.move(mid(HUD_BUTTON));
  check(h.root.pointerOverUi(), 'pointerOverUi() is true over a control');
  h.root.pointerLeft();
  check(!h.root.pointerOverUi(), 'and false once the pointer has left');
  h.move(BARE_WORLD);
  check(!h.root.pointerOverUi(), 'and false over bare world');
}

section('dispose() drops every surface’s state');
{
  const COUNTER = new UiStateSlot('disposeCounter', () => ({ value: 0 }));
  const seen: number[] = [];
  const panel = new FakeSurface({
    id: 'counter',
    band: 'panel',
    draw: (ui) => {
      const counter = ui.state(COUNTER, 'clicks');
      counter.value++;
      seen.push(counter.value);
    },
  });
  const h = harness([panel]);
  h.frame();
  h.frame();
  h.root.dispose();
  h.frame();
  check(seen.join() === '1,2,1', `state starts over after dispose (got ${seen.join()})`);
}

section('a disposed touch root stops speaking for the input mode');
{
  const touchRoot = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: SCREEN_W,
      cssHeight: SCREEN_H,
      density: 'touch',
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => 0,
    warn: () => undefined,
  });
  const pointerRoot = harness([]);
  touchRoot.frame(gameContext(SCREEN_W, SCREEN_H));
  check(
    activeInputMode() === 'touch',
    `a framed touch root sets touch copy (${activeInputMode()})`,
  );
  pointerRoot.root.dispose();
  check(
    activeInputMode() === 'touch',
    `disposing a root that did not frame last leaves it (${activeInputMode()})`,
  );
  touchRoot.dispose();
  check(
    activeInputMode() === 'pointer',
    `disposing the touch root hands back the detected mode (${activeInputMode()})`,
  );
}

section('a zero-length arc draws nothing rather than NaN');
{
  const calls = parsePathData('M5 5a2 2 0 0 1 0 0');
  const finite = calls.every((call) =>
    Object.values(call).every((value) => typeof value !== 'number' || Number.isFinite(value)),
  );
  check(
    finite && calls.length === 1,
    `the arc is skipped (got ${calls.length} call(s), finite=${finite})`,
  );
}

function isAttackKey(key: string): boolean {
  return keybindings.actionFor(key) === 'attack';
}

/**
 * The `onKey` of a floating dialog whose advance is the attack key (Space
 * unless rebound): once per fresh press, never for a held or repeating one.
 */
function advanceOnAttackKey(advanced: string[]): (key: string, mods: KeyModifiers) => boolean {
  return (key, mods) => {
    if (!isAttackKey(key)) return false;
    const freshPress = mods.repeat !== true && mods.predatesSurface !== true;
    if (freshPress) advanced.push('advance');
    return true;
  };
}

section('a floating notification passes keys it does not want to the menu beneath it');
{
  const picked: string[] = [];
  const conversation: Surface = {
    id: 'conversation',
    band: 'panel',
    isOpen: () => true,
    render: () => undefined,
    onKey: (key) => {
      if (key !== '1') return false;
      picked.push(key);
      return true;
    },
    haltsWorld: false,
    locksKeyboard: true,
  };
  const notification: Surface = {
    id: 'notification',
    band: 'system',
    isOpen: () => true,
    render: (ui) => ui.block(ui.screen),
    onKey: isAttackKey,
    haltsWorld: false,
    locksKeyboard: false,
  };
  const h = harness([conversation, notification]);
  h.frame();
  check(
    h.root.key('1') === 'consumed' && picked.join() === '1',
    'a digit reaches the conversation’s numbered choices under the notification',
  );
  check(h.root.key(' ') === 'consumed', 'and the notification still takes the Space it wants');
}

// ── Gesture delivery ───────────────────────────────────────────────────────

/** Every gesture callback one region received, in order. */
interface GestureLog {
  readonly downs: TapEvent[];
  readonly releases: ReleaseInfo[];
  readonly taps: TapEvent[];
  readonly drags: DragPoint[];
  readonly secondary: TapEvent[];
  readonly order: string[];
}

function gestureLog(): GestureLog {
  return { downs: [], releases: [], taps: [], drags: [], secondary: [], order: [] };
}

const LOGGED_AREA: Rect = { x: 225, y: 225, w: 180, h: 90 };

interface LoggingSurfaceOptions {
  readonly band?: Band;
  readonly area?: Rect | 'fullscreen';
  readonly open?: () => boolean;
  readonly haltsWorld?: boolean;
  readonly dragSlop?: number;
}

/** A surface with one region that logs down, release, tap, drag and right-click. */
function loggingSurface(id: string, log: GestureLog, opts: LoggingSurfaceOptions = {}): Surface {
  return {
    id,
    band: opts.band ?? 'panel',
    isOpen: opts.open ?? (() => true),
    haltsWorld: opts.haltsWorld ?? false,
    render: (ui) => {
      const area = opts.area === 'fullscreen' ? ui.screen : (opts.area ?? LOGGED_AREA);
      ui.hit('area', area, {
        onDown: (e) => {
          log.downs.push(e);
          log.order.push('down');
        },
        onRelease: (_e, info) => {
          log.releases.push(info);
          log.order.push(info.dragged ? 'release-drag' : 'release');
        },
        onTap: (e) => {
          log.taps.push(e);
          log.order.push('tap');
        },
        onDrag: { onMove: (point) => log.drags.push(point) },
        onSecondaryTap: (e) => log.secondary.push(e),
        dragSlop: opts.dragSlop,
      });
    },
  };
}

section('a tap reaches its region in UI units at any UI scale: down, release, then tap');
{
  const log = gestureLog();
  const h = harness([loggingSurface('panel', log)], 'large');
  h.frame();
  const centrePoint = mid(LOGGED_AREA);
  h.tap(centrePoint);
  const tap = log.taps[0];
  check(
    log.taps.length > 0 && closeTo(tap.x, centrePoint.x) && closeTo(tap.y, centrePoint.y),
    'the tap reaches onTap at the point it landed on',
  );
  check(
    log.order.join() === 'down,release,tap',
    `down, release, then tap (got ${log.order.join()})`,
  );
  check(h.rec.world.length === 0, 'the world saw nothing of a tap on the region');
  const justOutside = { x: LOGGED_AREA.x + LOGGED_AREA.w + TAP_SLOP + 1, y: centrePoint.y };
  h.tap(justOutside);
  check(log.taps.length === 1, 'a tap beside a panel-band region misses it');
  check(
    h.rec.world.some((g) => g.kind === 'up' && g.tap),
    'and reaches the world, since a panel blocks only what it registers',
  );
}

section('a drag that starts on a region is its own to the end, with no tap after');
{
  const SLOPS_ACROSS = 4;
  const SLOPS_DOWN = 20;
  const log = gestureLog();
  const h = harness([loggingSurface('panel', log)]);
  h.frame();
  const start = mid(LOGGED_AREA);
  const far = { x: start.x + TAP_SLOP * SLOPS_ACROSS, y: start.y + TAP_SLOP * SLOPS_DOWN };
  h.down(start, TOUCH_POINTER_ID);
  h.move(far, TOUCH_POINTER_ID);
  h.up(far, TOUCH_POINTER_ID);
  check(log.downs.length === 1 && log.downs[0].source === 'touch', 'the press went down');
  check(
    log.drags.some((point) => !contains(LOGGED_AREA, point.x, point.y)),
    'moves past the slop reached onDrag, off the region included',
  );
  check(log.releases.length === 1 && log.releases[0].dragged, 'the release reports the drag');
  check(log.taps.length === 0, 'no tap follows a drag');
  check(h.rec.world.length === 0, 'the world never saw the gesture');
}

section('a modal raised mid-press: the press still releases, nothing taps');
{
  const hudLog = gestureLog();
  const modalLog = gestureLog();
  let modalOpen = false;
  const h = harness([
    loggingSurface('hotbar', hudLog, { band: 'hud' }),
    loggingSurface('level-up', modalLog, {
      band: 'system',
      area: 'fullscreen',
      open: () => modalOpen,
      haltsWorld: true,
    }),
  ]);
  h.frame();
  const slot = mid(LOGGED_AREA);
  h.down(slot, TOUCH_POINTER_ID);
  modalOpen = true;
  h.frame();
  h.up(slot, TOUCH_POINTER_ID);
  check(hudLog.downs.length === 1, 'the hotbar saw its press');
  check(
    hudLog.releases.length === 1 && hudLog.releases[0].covered,
    'and its release, flagged as covered, so nothing it started is left held',
  );
  check(hudLog.taps.length === 0, 'but the covered slot did not activate');
  check(modalLog.taps.length === 0, 'and the dialog that rose over it was not accepted unseen');
  check(h.rec.world.length === 0, 'and the world saw none of it');
}

section('a surface band read live re-sorts the stack');
{
  let band: Band = 'panel';
  const shifting: Surface = {
    id: 'shifting',
    get band() {
      return band;
    },
    isOpen: () => true,
    render: () => undefined,
    get haltsWorld() {
      return band === 'modal';
    },
  };
  const modal = new FakeSurface({ id: 'modal', band: 'modal', draw: () => undefined });
  const h = harness([modal, shifting]);
  h.frame();
  check(h.root.openSurfaceIds().join() === 'shifting,modal', 'as a panel it sits under the modal');
  check(!h.root.worldHalted(), 'and does not halt the world');
  band = 'modal';
  check(
    h.root.openSurfaceIds().join() === 'modal,shifting',
    'as a modal it sits above the one opened before it',
  );
  check(h.root.worldHalted(), 'and its live haltsWorld halts the world');
}

section('keyboard: locks, Space handling and declined Escape');
{
  const advanced: string[] = [];
  let pickerOpen = true;
  const picker: Surface = {
    id: 'picker',
    band: 'modal',
    isOpen: () => pickerOpen,
    render: () => undefined,
    onKey: isAttackKey,
    haltsWorld: false,
    locksKeyboard: true,
  };
  const dialog: Surface = {
    id: 'dialog',
    band: 'panel',
    isOpen: () => true,
    render: () => undefined,
    onKey: advanceOnAttackKey(advanced),
    close: () => advanced.push('closed'),
    wantsEscape: () => false,
    haltsWorld: false,
  };
  const h = harness([dialog, picker]);
  h.frame();
  check(
    h.root.key('w') === 'blocked',
    'a key under a keyboard-locking, non-halting surface is blocked',
  );
  check(h.root.key(' ') === 'consumed' && advanced.length === 0, 'the top surface eats Space');
  pickerOpen = false;
  check(h.root.key('w') === 'gameplay', 'with only a floating dialog up, keys reach gameplay');
  check(
    h.root.key(' ') === 'consumed' && advanced.join() === 'advance',
    'Space advances the dialog',
  );
  check(
    h.root.key(' ', { repeat: true }) === 'consumed' && advanced.length === 1,
    'a held Space is eaten without advancing again',
  );
  check(
    h.root.key('Escape') === 'gameplay' && !advanced.includes('closed'),
    'a surface declining Escape lets it fall through to the scene',
  );
}

section('a surface’s attack-key hook follows the binding, not the literal Space');
{
  const advanced: string[] = [];
  const dialog: Surface = {
    id: 'dialog',
    band: 'panel',
    isOpen: () => true,
    render: () => undefined,
    onKey: advanceOnAttackKey(advanced),
    haltsWorld: false,
  };
  const h = harness([dialog]);
  h.frame();
  const REBOUND_ATTACK = 'f';
  keybindings.rebind('attack', 0, REBOUND_ATTACK);
  try {
    check(
      h.root.key(REBOUND_ATTACK) === 'consumed' && advanced.length === 1,
      'the rebound attack key advances the dialog',
    );
    h.root.key(REBOUND_ATTACK, { predatesSurface: true });
    check(advanced.length === 1, 'an attack press held from before the dialog does not advance it');
  } finally {
    keybindings.resetAction('attack');
  }
}

section('key hooks see keys before any open menu');
{
  const graded: string[] = [];
  const menu = new FakeSurface({ id: 'menu', band: 'modal', draw: () => undefined });
  const h = harness([menu]);
  h.frame();
  const remove = h.root.addKeyHook((key) => {
    if (key !== ' ') return false;
    graded.push(key);
    return true;
  });
  check(
    h.root.key(' ') === 'consumed' && graded.length === 1,
    'the hook grades the press under a modal',
  );
  remove();
  h.root.key(' ');
  check(graded.length === 1, 'a removed hook sees nothing');
}

section('a region’s drag slop keeps a wandering press a tap');
{
  const WANDER = (TAP_SLOP + MENU_TAP_MAX_DISTANCE) / 2;
  const slack = gestureLog();
  const strict = gestureLog();
  for (const [log, dragSlop] of [
    [slack, MENU_TAP_MAX_DISTANCE],
    [strict, undefined],
  ] as const) {
    const h = harness([
      loggingSurface('menu', log, {
        band: 'modal',
        area: 'fullscreen',
        haltsWorld: true,
        dragSlop,
      }),
    ]);
    h.frame();
    const start = mid(LOGGED_AREA);
    const wandered = { x: start.x + WANDER, y: start.y };
    h.down(start, TOUCH_POINTER_ID);
    h.move(wandered, TOUCH_POINTER_ID);
    h.up(wandered, TOUCH_POINTER_ID);
  }
  check(slack.taps.length === 1 && slack.drags.length === 0, 'within its slop the press taps');
  check(strict.taps.length === 0 && strict.drags.length > 0, 'the default slop makes it a drag');
}

section('the mouse leaving with a button held clears hover');
{
  const log = gestureLog();
  const h = harness([loggingSurface('panel', log)]);
  h.frame();
  const input = new PointerInput(
    (gesture) => h.root.pointer(gesture),
    () => h.root.uiScale,
    () => h.root.pointerLeft(),
  );
  const over = mid(LOGGED_AREA);
  input.mouseMove(over.x, over.y);
  input.mouseDown(over.x, over.y, PRIMARY_BUTTON);
  check(h.root.mouse?.down === true, 'the held press shows as down');
  input.mouseLeave(over.x, over.y);
  check(h.root.mouse === null, 'after leaving, there is no mouse');
  check(!h.root.pointerOverUi(), 'and nothing is hovered');
  input.mouseMove(over.x, over.y);
  input.mouseDown(over.x, over.y, PRIMARY_BUTTON);
  input.cancelAll();
  check(h.root.mouse === null, 'losing focus mid-press clears hover too');
}

section('only the primary button presses, drags and taps; right-click is opt-in');
{
  const SECONDARY = 2;
  const log = gestureLog();
  const h = harness([loggingSurface('bag', log)]);
  h.frame();
  const input = new PointerInput(
    (gesture) => h.root.pointer(gesture),
    () => h.root.uiScale,
    () => h.root.pointerLeft(),
  );
  const at = mid(LOGGED_AREA);
  input.mouseDown(at.x, at.y, SECONDARY);
  check(h.root.mouse?.down !== true, 'a held right button is not a held mouse');
  input.mouseUp(at.x, at.y, SECONDARY);
  check(
    log.downs.length === 0 && log.releases.length === 0 && log.taps.length === 0,
    'a right-click never presses, releases or taps',
  );
  check(log.secondary.length === 1, 'it reaches onSecondaryTap');
  input.mouseDown(at.x, at.y, PRIMARY_BUTTON);
  input.mouseUp(at.x, at.y, PRIMARY_BUTTON);
  check(log.taps.length === 1 && log.secondary.length === 1, 'a left-click taps, and only that');
}

section('Enter answers once per fresh press, at the activated control’s centre');
{
  const OK_BUTTON: Rect = { x: 300, y: 300, w: 120, h: 40 };
  const taps: TapEvent[] = [];
  const menu: Surface = {
    id: 'menu',
    band: 'modal',
    isOpen: () => true,
    render: (ui) => {
      ui.hit('ok', OK_BUTTON, { primary: true, onTap: (e) => taps.push(e) });
    },
    haltsWorld: true,
  };
  const h = harness([menu], 'large');
  h.frame();
  check(
    h.root.key('Enter', { predatesSurface: true }) === 'consumed' && taps.length === 0,
    'a held-over Enter is inert',
  );
  check(
    h.root.key('Enter', { repeat: true }) === 'consumed' && taps.length === 0,
    'a repeating Enter is inert',
  );
  check(h.root.key('Enter') === 'consumed', 'a fresh Enter is the menu’s');
  const centrePoint = mid(OK_BUTTON);
  const tap = taps[0];
  check(
    taps.length === 1 &&
      tap.source === 'keyboard' &&
      closeTo(tap.x, centrePoint.x) &&
      closeTo(tap.y, centrePoint.y),
    'and taps the primary control at its centre',
  );
}

section('a ringless modal over a conversation’s choices: Space is the modal’s, not the choice’s');
{
  const CHOICE: Rect = { x: 300, y: 400, w: 120, h: 40 };
  const fired: string[] = [];
  let noticeTakesSpace = true;
  const conversation: Surface = {
    id: 'conversation',
    band: 'panel',
    isOpen: () => true,
    render: (ui) => {
      ui.hit('accept', CHOICE, { primary: true, onTap: () => fired.push('choice') });
    },
    haltsWorld: false,
  };
  const notice: Surface = {
    id: 'notice',
    band: 'modal',
    isOpen: () => true,
    render: (ui) => {
      ui.hit('dismiss', ui.screen, { focusable: false, onTap: () => fired.push('notice-tap') });
    },
    onKey: (key) => {
      if (!noticeTakesSpace || !isAttackKey(key)) return false;
      fired.push('notice-space');
      return true;
    },
    haltsWorld: true,
  };
  const h = harness([conversation, notice]);
  h.frame();
  check(h.root.key(' ') === 'consumed', 'Space is consumed');
  check(
    fired.join() === 'notice-space',
    `the modal’s own Space answers it (fired: ${fired.join() || 'nothing'})`,
  );
  noticeTakesSpace = false;
  fired.length = 0;
  h.root.key(' ');
  h.root.key('Enter');
  check(
    fired.length === 0,
    `a modal that wants neither key still keeps them from the choice beneath (fired: ${fired.join() || 'nothing'})`,
  );
}

section('geometry helpers');
{
  const FRAME: Rect = { x: 0, y: 0, w: 100, h: 50 };
  const GAP = 10;
  const FIXED = 20;
  const rows = splitV(FRAME, [FIXED, 'fill'], GAP);
  check(
    rows[1]?.y === FIXED + GAP && rows[1].h === FRAME.h - FIXED - GAP,
    'splitV gives fill the remainder',
  );
  const columns = splitH(FRAME, ['fill', 'fill'], GAP);
  check(
    columns[0]?.w === (FRAME.w - GAP) / 2 && columns[1]?.x === (FRAME.w + GAP) / 2,
    'splitH shares fill evenly',
  );
  const MIN_CELL = 25;
  const COLUMNS = 3;
  const CELLS = 5;
  const cells = grid(FRAME, CELLS, { minCell: MIN_CELL, gap: GAP });
  check(
    cells.length === CELLS && cells[COLUMNS - 1]?.y === 0 && cells[COLUMNS]?.y !== 0,
    'grid fits three columns of at least 25 in 100',
  );
  check(intersect(LEFT_BUTTON, RIGHT_BUTTON) === null, 'disjoint rects do not intersect');
}

section('glyphs parse');
{
  let parsed = 0;
  for (const id of GLYPH_IDS) {
    try {
      for (const data of GLYPH_PATHS[id]) parsePathData(data);
      parsed++;
    } catch (error) {
      check(false, `${id}: ${String(error)}`);
    }
  }
  check(parsed === GLYPH_IDS.length, `all ${GLYPH_IDS.length} glyphs parse`);
}

section('theme');
{
  const pointer = resolveTheme('pointer');
  const touch = resolveTheme('touch');
  const TOUCH_TARGET = 44;
  check(
    touch.size.control === TOUCH_TARGET && pointer.size.control < TOUCH_TARGET,
    'touch raises control size',
  );
  check(resolveTheme('touch') === touch, 'resolved themes are cached');
  const skins = skinsFor(touch);
  check(
    skins.controlSize.md.height === touch.size.control,
    'md controls are the density’s control size',
  );
}

section('a layer (context menu, popover) owns keyboard, wheel, drag and Escape');
{
  let menuOpen = true;
  const listLog: string[] = [];
  const menuRec: Recorder = recorder();
  const host = new FakeSurface({
    id: 'host',
    band: 'panel',
    haltsWorld: true,
    closable: true,
    draw: (ui, self) => {
      ui.hit(
        'list',
        { x: 0, y: 0, w: 400, h: 400 },
        {
          onWheel: () => listLog.push('wheel'),
          onDrag: { onMove: () => listLog.push('drag') },
        },
      );
      fakeButton(ui, self, menuRec, 'row', { x: 10, y: 10, w: 100, h: 30 });
      fakeButton(ui, self, menuRec, 'buy', { x: 10, y: 500, w: 100, h: 30 }, { primary: true });
      if (!menuOpen) return;
      ui.layer({
        onEscape: () => {
          menuOpen = false;
          menuRec.fired.push('host/dismissed');
        },
      });
      ui.hit(
        'dismiss',
        { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H },
        {
          focusable: false,
          onTap: () => {
            menuOpen = false;
          },
        },
      );
      fakeButton(ui, self, menuRec, 'drop', { x: 200, y: 200, w: 100, h: 30 });
    },
  });
  const h = harness([host]);
  h.frame();
  h.root.key('Enter');
  check(
    !menuRec.fired.includes('host/buy'),
    'Enter does not reach a primary control under the layer',
  );
  h.root.key('Tab');
  h.frame();
  check(host.states.get('row')?.focused !== true, 'Tab does not land on a control under the layer');
  h.root.key('Enter');
  check(menuRec.fired.includes('host/drop'), 'Tab then Enter activates the layer’s own item');
  h.wheel({ x: 50, y: 50 }, WHEEL_NOTCH);
  check(!listLog.includes('wheel'), 'wheel over the layer does not scroll the list beneath it');
  h.down({ x: 50, y: 50 });
  h.move({ x: 50, y: 90 });
  h.move({ x: 50, y: 120 });
  h.up({ x: 50, y: 120 });
  check(!listLog.includes('drag'), 'dragging on the layer does not scroll the list beneath it');
  menuOpen = true;
  menuRec.fired.length = 0;
  h.frame();
  h.root.key('Escape');
  check(
    menuRec.fired.includes('host/dismissed') && host.open,
    'Escape dismisses the layer, not its surface',
  );
  h.frame();
  h.root.key('Escape');
  check(!host.open, 'with the layer gone, Escape closes the surface');
}

section('onOutsideDown fires for a press anywhere else, not on the region');
{
  const rec = recorder();
  const field = new FakeSurface({
    id: 'field',
    band: 'panel',
    draw: (ui, self) => {
      fakeButton(
        ui,
        self,
        rec,
        'input',
        { x: 10, y: 10, w: 200, h: 30 },
        {
          onOutsideDown: () => rec.fired.push('field/blurred'),
        },
      );
      fakeButton(ui, self, rec, 'other', { x: 10, y: 100, w: 100, h: 30 });
    },
  });
  const h = harness([field]);
  h.frame();
  h.tap({ x: 50, y: 20 });
  check(!rec.fired.includes('field/blurred'), 'a press on the region itself is not outside');
  h.tap({ x: 50, y: 110 });
  check(
    rec.fired.includes('field/blurred') && rec.fired.includes('field/other'),
    'a press on another control is outside, and that control still taps',
  );
  rec.fired.length = 0;
  h.tap(BARE_WORLD);
  check(rec.fired.includes('field/blurred'), 'a press on the bare world is outside too');
}

section('hit rects follow the context transform (open animations)');
{
  const SLIDE_DOWN = 50;
  const SCALED_ORIGIN = 300;
  const SHRINK = 0.5;
  const rec = recorder();
  const shifted = new FakeSurface({
    id: 'anim',
    band: 'panel',
    draw: (ui, self) => {
      ui.ctx.translate(0, SLIDE_DOWN);
      fakeButton(ui, self, rec, 'moved', { x: 10, y: 10, w: 100, h: 30 });
      ui.ctx.translate(SCALED_ORIGIN, SCALED_ORIGIN);
      ui.ctx.scale(SHRINK, SHRINK);
      fakeButton(ui, self, rec, 'scaled', { x: 0, y: 0, w: 100, h: 100 });
    },
  });
  const h = harness([shifted]);
  h.frame();
  h.tap({ x: 60, y: 25 });
  check(
    !rec.fired.includes('anim/moved'),
    'a tap where the control was before the translate misses',
  );
  h.tap({ x: 60, y: 75 });
  check(rec.fired.includes('anim/moved'), 'a tap where the control is drawn hits');
  h.tap({ x: 340, y: 390 });
  check(rec.fired.includes('anim/scaled'), 'a scaled control is hit inside its drawn bounds');
  rec.fired.length = 0;
  h.tap({ x: 390, y: 440 });
  check(!rec.fired.includes('anim/scaled'), 'and missed outside them');
}

section('a hover-only region shows hover and lets every press through');
{
  const BACKDROP: Rect = { x: 100, y: 100, w: 400, h: 300 };
  const TIP: Rect = { x: 150, y: 150, w: 60, h: 60 };
  const SLOT: Rect = { x: 300, y: 150, w: 60, h: 60 };
  const LONE_TIP: Rect = { x: 600, y: 100, w: 60, h: 60 };
  const rec = recorder();
  const wheeled: number[] = [];
  const slotStates: HitState[] = [];
  const reward = new FakeSurface({
    id: 'reward',
    band: 'panel',
    draw: (ui, self) => {
      fakeButton(ui, self, rec, 'backdrop', BACKDROP, { onWheel: (dy) => wheeled.push(dy) });
      self.states.set(
        'tip',
        ui.hit('tip', TIP, { hoverOnly: true, onTap: () => rec.fired.push('reward/tip') }),
      );
      self.states.set('lone', ui.hit('lone', LONE_TIP, { hoverOnly: true }));
      slotStates.push(itemSlot(ui, SLOT, { id: 'slot', item: 'health_potion', tooltip: true }));
    },
  });
  const h = harness([reward]);
  h.frame();
  h.move(mid(TIP));
  h.frame();
  check(reward.states.get('tip')?.hovered === true, 'the hover-only region reports hover');
  check(
    reward.states.get('backdrop')?.hovered === true,
    'the control beneath it keeps its hover too',
  );
  check(h.root.pointerOverUi(), 'the pointer over it counts as over the UI');

  h.down(mid(TIP));
  h.frame();
  check(reward.states.get('tip')?.pressed !== true, 'a press never makes it look pressed');
  h.up(mid(TIP));
  check(
    rec.fired.join() === 'reward/backdrop',
    `a tap on it reaches the control beneath, never its own onTap (got ${rec.fired.join()})`,
  );

  h.wheel(mid(TIP), WHEEL_NOTCH);
  check(wheeled.join() === String(WHEEL_NOTCH), 'the wheel over it reaches the control beneath');

  rec.fired.length = 0;
  h.tap(mid(LONE_TIP));
  check(
    h.rec.world.some((gesture) => gesture.kind === 'up' && gesture.tap),
    'with nothing beneath, the tap goes on to the world',
  );

  const TAB_PRESSES = 3;
  let tipFocused = false;
  for (let step = 0; step < TAB_PRESSES; step++) {
    h.root.key('Tab');
    h.frame();
    if (reward.states.get('tip')?.focused === true || reward.states.get('lone')?.focused === true)
      tipFocused = true;
  }
  check(!tipFocused, 'it never joins the focus ring');

  h.move(mid(SLOT));
  h.frame();
  const lastSlotState = slotStates.slice(-1);
  check(
    lastSlotState.some((state) => state.hovered),
    'a display-only item slot with a tooltip reports hover',
  );
  rec.fired.length = 0;
  h.tap(mid(SLOT));
  check(
    rec.fired.join() === 'reward/backdrop',
    'and a tap on that slot reaches the control beneath it',
  );
}

section('the real dungeon scene, on a desktop and on a phone');
{
  // Each in its own process: the platform is decided once, when the game's modules load.
  for (const platform of ['desktop', 'phone'] as const) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, 'scripts/uiInputDungeon.ts', `--platform=${platform}`],
      { stdio: 'inherit' },
    );
    check(child.status === 0, `the dungeon's click-through cases hold on ${platform}`);
  }
}

console.log(failures === 0 ? '\nAll UI input checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
