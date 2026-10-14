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
import type { PokerCue } from '../src/systems/casino/poker/pokerSoundCues.js';
import {
  UiRoot,
  UI_ERROR_SOUND,
  UI_TAP_SOUND,
  type Band,
  type DragPoint,
  type HitHandlers,
  type HitRegion,
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
import { renderTopBand, type TopBandEntry } from '../src/ui/hud/topBand.js';
import { stackedBandEntry } from '../src/ui/hud/topBandStack.js';

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

section(
  'a top-band readout lets a tap through to the world; a control inside an entry keeps its own',
);
{
  const BAND_AREA: Rect = { x: 200, y: 20, w: 400, h: 400 };
  const BAND_BUTTON_H = 40;
  const readout = stackedBandEntry({
    id: 'readout',
    priority: 'encounter',
    rows: [{ kind: 'text', text: 'Bugaboos in 18s', role: 'label' }],
  });
  const withControl: TopBandEntry = {
    id: 'with-control',
    priority: 'banner',
    maxWidth: BAND_AREA.w,
    height: () => BAND_BUTTON_H,
    render: (ui, rect) => {
      ui.hit('band-button', rect, { onTap: () => rec.fired.push('hud/band-button') });
    },
  };
  let placed: { readonly id: string; readonly rect: Rect }[] = [];
  let rec = recorder();
  const band = new FakeSurface({
    id: 'hud',
    band: 'hud',
    draw: (ui) => {
      placed = renderTopBand(ui, BAND_AREA, [readout, withControl], []);
    },
  });
  const h = harness([band]);
  rec = h.rec;
  h.frame();
  const readoutRect = placed.find((slot) => slot.id === 'readout')?.rect ?? null;
  const controlRect = placed.find((slot) => slot.id === 'with-control')?.rect ?? null;
  check(readoutRect !== null && controlRect !== null, 'both band entries are placed');
  if (readoutRect !== null && controlRect !== null) {
    h.tap(mid(readoutRect));
    const kinds = rec.world.map((gesture) => gesture.kind).join();
    check(kinds === 'down,up', `a tap on a readout reaches the world as down,up (got ${kinds})`);
    clear(rec);
    h.frame();
    h.tap(mid(controlRect));
    check(rec.fired.join() === 'hud/band-button', 'a control inside a band entry still fires');
    check(rec.world.length === 0, 'and the world does not see that tap');
  }
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

section('an overlay draws above every band and takes no input');
{
  const OVERLAY_BUTTON: Rect = { x: 360, y: 390, w: 80, h: 20 };
  const rec = recorder();
  const paintOrder: string[] = [];
  const hud = new FakeSurface({
    id: 'hud',
    band: 'hud',
    draw: (ui) => {
      ui.overlay(() => {
        paintOrder.push('hud overlay');
        ui.hit('stolen', OVERLAY_BUTTON, { onTap: () => rec.fired.push('hud/stolen') });
      });
      paintOrder.push('hud');
    },
  });
  const panel = new FakeSurface({
    id: 'panel',
    band: 'panel',
    draw: (ui, self) => {
      paintOrder.push('panel');
      ui.defer(() => paintOrder.push('panel deferred'));
      fakeButton(ui, self, rec, 'ok', PANEL_BUTTON);
    },
  });
  const toast = new FakeSurface({
    id: 'toast',
    band: 'toast',
    draw: () => paintOrder.push('toast'),
  });
  const h = harness([hud, panel, toast]);
  h.frame();
  check(
    paintOrder.join() === 'hud,panel,panel deferred,toast,hud overlay',
    `a HUD overlay paints after every band, a panel's deferred draw only after the panel (got ${paintOrder.join()})`,
  );
  check(
    !h.root.regions().some((region) => region.id === 'hud/stolen'),
    'a region registered from an overlay is refused',
  );
  check(
    h.rec.warnings.some((message) => message.includes('overlays take no input')),
    'and the refusal warns in dev',
  );
  toast.open = false;
  h.frame();
  clear(h.rec);
  h.tap(mid(OVERLAY_BUTTON));
  check(
    rec.fired.join() === 'panel/ok',
    `a tap under the overlay reaches the panel beneath it (got ${rec.fired.join()})`,
  );
}

section('an overlay under a scrim is dropped, and paints from its surface’s starting state');
{
  const WIDGET_SHIFT = 37;
  const WIDGET_ALPHA = 0.3;
  const painted: string[] = [];
  const seen: {
    start: DOMMatrix | null;
    startAlpha: number | null;
    overlay: DOMMatrix | null;
    overlayAlpha: number | null;
  } = { start: null, startAlpha: null, overlay: null, overlayAlpha: null };
  const bag = new FakeSurface({
    id: 'bag',
    band: 'panel',
    draw: (ui) => {
      seen.start = ui.ctx.getTransform();
      seen.startAlpha = ui.ctx.globalAlpha;
      ui.ctx.save();
      ui.ctx.translate(WIDGET_SHIFT, WIDGET_SHIFT);
      ui.ctx.globalAlpha = WIDGET_ALPHA;
      ui.overlay(() => {
        painted.push('bag tip');
        seen.overlay = ui.ctx.getTransform();
        seen.overlayAlpha = ui.ctx.globalAlpha;
      });
      ui.ctx.restore();
    },
  });
  const levelUp = new FakeSurface({
    id: 'level-up',
    band: 'system',
    open: false,
    draw: () => undefined,
  });
  const h = harness([bag, levelUp]);
  const before = h.ctx.getTransform();
  const alphaBefore = h.ctx.globalAlpha;
  h.frame();
  check(painted.join() === 'bag tip', 'with nothing above, the panel’s overlay paints');
  const { start, overlay } = seen;
  check(
    start !== null && start.e === overlay?.e && start.f === overlay.f,
    'it paints at the surface’s starting transform, not the widget’s translate',
  );
  check(
    seen.overlayAlpha !== null && seen.overlayAlpha === seen.startAlpha,
    `and at the surface’s starting alpha (got ${String(seen.overlayAlpha)})`,
  );
  const after = h.ctx.getTransform();
  check(
    after.a === before.a && after.e === before.e && after.f === before.f,
    'the canvas transform is restored after the overlays',
  );
  check(h.ctx.globalAlpha === alphaBefore, 'and so is its alpha');

  painted.length = 0;
  levelUp.open = true;
  h.frame();
  check(
    painted.length === 0,
    `a system surface above the panel drops its overlay (painted: ${painted.join() || 'none'})`,
  );

  painted.length = 0;
  levelUp.open = false;
  bag.open = false;
  h.frame();
  check(painted.length === 0, 'a closed surface’s overlay is not painted on the next frame');
}

section('the poker table: Space on a focused control presses it instead of leaving');
{
  // The table paints Deuce and the regulars from offscreen caches, which need a canvas to allocate.
  const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
  installCanvasGlobals();
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { ClubPokerSystem } = await import('../src/systems/ClubPokerSystem.js');
  const { POKER_DEV_SEED } = await import('../src/systems/casino/poker/npc/personality.js');
  const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
  const { mulberry32 } = await import('../src/sprites/person/rng.js');
  const POKER_STEP_MS = 50;
  const POKER_MAX_STEPS = 2000;
  const POKER_SHUFFLE_SEED = 7;
  const attackKey = keybindings.keysFor('attack')[0] ?? ' ';

  /** A seated party at its first decision; folded when asked, so the row holds Skip and Leave. */
  const seatedTable = (fold: boolean) => {
    let now = 0;
    const player = new HumanPlayer(0, 0, TILE_SIZE);
    const companion = new CatPlayer(1, 0, TILE_SIZE);
    player.coins = POKER_STAKES.penny.buyIn;
    const poker = new ClubPokerSystem(
      null,
      POKER_DEV_SEED,
      () => now,
      mulberry32(POKER_SHUFFLE_SEED),
    );
    poker.buyIn('penny', player, companion);
    poker.dismissRules();
    const step = (): void => {
      now += POKER_STEP_MS;
      poker.update();
    };
    for (let i = 0; i < POKER_MAX_STEPS && poker.pokerTable?.awaitingPlayer !== true; i++) step();
    if (fold) {
      poker.act({ kind: 'fold' });
      step();
    }
    const surface = poker.tableSurface('poker-table', {
      active: () => player,
      companion: () => companion,
    });
    return { poker, surface, step };
  };

  const focused = seatedTable(true);
  const h = harness([focused.surface]);
  h.frame();
  // The ring runs in registration order; Tab walks it from the first control to Skip to Next Hand.
  const ring = h.root
    .regions()
    .filter((region) => region.focusable && !region.disabled && !region.hoverOnly);
  const tabsToSkip = ring.findIndex((region) => region.id.endsWith('/skip')) + 1;
  check(tabsToSkip > 0, 'a folded table offers Skip to Next Hand to the keyboard');
  for (let press = 0; press < tabsToSkip; press++) {
    h.root.key('Tab');
    h.frame();
  }
  h.root.key(attackKey);
  h.frame();
  check(
    focused.poker.tableOpen,
    'the attack key on a keyboard-focused table control presses it rather than leaving',
  );
  // The press started a skip, which takes Skip out of the focus ring; a
  // second press must not fall through to the leave the attack key means.
  h.root.key(attackKey);
  h.frame();
  check(
    focused.poker.tableOpen,
    'Tab to Skip, then the attack key twice: the player is still seated',
  );

  const unfocused = seatedTable(true);
  const bare = harness([unfocused.surface]);
  bare.frame();
  bare.root.key(attackKey);
  bare.frame();
  check(!unfocused.poker.tableOpen, 'with nothing focused, the attack key leaves a folded table');

  // Skip to Next Hand shows that it took, takes no second press, and clears with the next hand.
  const skipped = seatedTable(true);
  const skipView = harness([skipped.surface]);
  skipView.frame();
  const skipRegion = (): HitRegion | undefined =>
    skipView.root.regions().find((region) => region.id.endsWith('/skip'));
  const before = skipRegion();
  check(before !== undefined && !before.disabled, 'a folded table offers Skip to Next Hand');
  if (before !== undefined) {
    const centre = { x: before.rect.x + before.rect.w / 2, y: before.rect.y + before.rect.h / 2 };
    skipView.tap(centre);
    skipView.frame();
    const during = skipRegion();
    check(
      skipped.poker['skipping'] && during !== undefined && !during.focusable,
      'after Skip is pressed the button shows it is skipping and leaves the focus ring',
    );
    const handBefore = skipped.poker.pokerTable?.handNumber ?? 0;
    const soundsBefore = skipView.rec.sounds.length;
    skipView.tap(centre);
    skipView.frame();
    check(
      skipped.poker['skipping'] && skipView.rec.sounds.length === soundsBefore,
      'a second press while skipping changes nothing and makes no sound',
    );
    for (
      let i = 0;
      i < POKER_MAX_STEPS && (skipped.poker.pokerTable?.handNumber ?? 0) === handBefore;
      i++
    ) {
      skipped.step();
    }
    skipView.frame();
    const after = skipRegion();
    const handAfter = skipped.poker.pokerTable?.handNumber ?? 0;
    check(
      handAfter > handBefore &&
        !skipped.poker['skipping'] &&
        (after === undefined || after.focusable),
      `once the next hand starts the skip state clears (hand ${handBefore} → ${handAfter})`,
    );
  }

  // A regular's plate in the focus ring: the attack key opens their card, never leaves.
  const plated = seatedTable(true);
  const seats = harness([plated.surface]);
  seats.frame();
  const plateRing = seats.root
    .regions()
    .filter((region) => region.focusable && !region.disabled && !region.hoverOnly);
  const tabsToPlate = plateRing.findIndex((region) => /\/seat-\d+$/.test(region.id)) + 1;
  check(tabsToPlate > 0, 'a seated table offers the regulars’ plates to the keyboard');
  for (let press = 0; press < tabsToPlate; press++) {
    seats.root.key('Tab');
    seats.frame();
  }
  seats.root.key(attackKey);
  seats.frame();
  check(
    plated.poker.tableOpen && plated.poker['seatInfo'] !== null,
    'the attack key on a keyboard-focused seat plate opens its card and keeps the player seated',
  );

  // A desktop table's raise tray leaves Leave showing beside it; showing means pressable.
  const sizing = seatedTable(false);
  const trayOpened = sizing.poker.openRaiseTray();
  const desk = harness([sizing.surface]);
  desk.frame();
  const leave = desk.root.regions().find((region) => region.id.endsWith('/leave'));
  check(
    trayOpened && leave !== undefined,
    'a desktop table shows Leave beside the open raise tray',
  );
  if (leave !== undefined) {
    check(leave.layer > 0, 'Leave sits on the raise tray’s layer, where the keyboard can reach it');
    desk.tap({ x: leave.rect.x + leave.rect.w / 2, y: leave.rect.y + leave.rect.h / 2 });
    desk.frame();
    check(
      sizing.poker['leaveConfirm'].isOpen,
      'one click on Leave beside the raise tray asks to fold and leave, not just closes the tray',
    );
  }
}

section('the poker table: a seat opens its card, History opens the history, Escape closes each');
{
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { ClubPokerSystem } = await import('../src/systems/ClubPokerSystem.js');
  const { POKER_DEV_SEED } = await import('../src/systems/casino/poker/npc/personality.js');
  const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
  const { mulberry32 } = await import('../src/sprites/person/rng.js');
  const POKER_SHUFFLE_SEED = 11;
  /** The first regular clockwise from the player: a fresh table always seats someone there. */
  const TAPPED_SEAT = 1;

  let now = 0;
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(1, 0, TILE_SIZE);
  player.coins = POKER_STAKES.penny.buyIn;
  const poker = new ClubPokerSystem(
    null,
    POKER_DEV_SEED,
    () => now,
    mulberry32(POKER_SHUFFLE_SEED),
  );
  poker.buyIn('penny', player, companion);
  const rulesRaisedThemselves = poker['rules'].isOpen;
  check(rulesRaisedThemselves, 'the first sit-down of a visit raises the rules sheet unasked');
  poker.dismissRules();
  now += 1;
  poker.update();
  const seat = { active: () => player, companion: () => companion };
  const h = harness([
    poker.tableSurface('poker-table', seat),
    poker.historySurface('poker-history'),
    poker.seatInfoSurface('poker-seat-info'),
  ]);
  h.frame();
  const centre = (rect: { x: number; y: number; w: number; h: number }): Point => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  });

  const plate = h.root.regions().find((region) => region.id === `poker-table/seat-${TAPPED_SEAT}`);
  check(plate !== undefined, 'a regular’s plate registers a tap region');
  if (plate !== undefined) {
    h.tap(centre(plate.rect));
    h.frame();
    check(h.root.isOpen('poker-seat-info'), 'tapping a regular’s plate opens their seat card');
    h.root.key('Escape');
    h.frame();
    check(!h.root.isOpen('poker-seat-info'), 'Escape closes the seat card');
    check(poker.tableOpen, 'and leaves the player seated at the table');
  }

  const history = h.root.regions().find((region) => region.id === 'poker-table/history');
  check(history !== undefined && !history.disabled, 'the table’s History button is enabled');
  if (history !== undefined) {
    h.tap(centre(history.rect));
    h.frame();
    check(h.root.isOpen('poker-history'), 'History opens the hand history');
    h.root.key('Escape');
    h.frame();
    check(!h.root.isOpen('poker-history'), 'Escape closes the hand history');
    check(poker.tableOpen, 'and leaves the player seated at the table');
  }
}

section('the poker table: each sound cue once per event, none while skipping or leaving');
{
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { ClubPokerSystem } = await import('../src/systems/ClubPokerSystem.js');
  const { POKER_DEV_SEED } = await import('../src/systems/casino/poker/npc/personality.js');
  const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
  const { POKER_CUES, shuffleSound } =
    await import('../src/systems/casino/poker/pokerSoundCues.js');
  const { HOLE_CARD_COUNT, POKER_SEAT_COUNT } =
    await import('../src/systems/casino/poker/PokerTable.js');
  const { mulberry32 } = await import('../src/sprites/person/rng.js');
  const POKER_STEP_MS = 50;
  const POKER_MAX_STEPS = 4000;
  const POKER_SHUFFLE_SEED = 23;

  let now = 0;
  const played: SoundId[] = [];
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(1, 0, TILE_SIZE);
  player.coins = POKER_STAKES.penny.buyIn;
  const poker = new ClubPokerSystem(
    { play: (id) => void played.push(id) },
    POKER_DEV_SEED,
    () => now,
    mulberry32(POKER_SHUFFLE_SEED),
  );
  const step = (): void => {
    now += POKER_STEP_MS;
    poker.update();
  };
  const count = (id: SoundId): number => played.filter((sound) => sound === id).length;
  // Every take of a cue counts, so a cue that rotates recordings is never undercounted.
  const takesOf = (cue: PokerCue): readonly SoundId[] => POKER_CUES[cue];
  const countCue = (cue: PokerCue): number =>
    played.filter((sound) => takesOf(cue).includes(sound)).length;

  poker.buyIn('penny', player, companion);
  poker.dismissRules();
  check(countCue('buy_in') === 1, 'buying in plays the purchase cue once');
  played.length = 0;
  for (let i = 0; i < POKER_MAX_STEPS && poker.pokerTable?.awaitingPlayer !== true; i++) step();
  const table = poker.pokerTable;
  const handNumber = table?.handNumber ?? 0;
  check(
    count(shuffleSound(handNumber)) === 1,
    `the hand's shuffle plays once (played ${count(shuffleSound(handNumber))})`,
  );
  // Folds and deals may share a recording, so each fold before the player's
  // turn adds one to the count rather than passing for a dealt card.
  const foldsSoFar = table?.history.filter((record) => record.kind === 'fold').length ?? 0;
  const foldSharesADealTake = takesOf('fold').some((take) => takesOf('deal_card').includes(take));
  const foldsSoundingAsDeals = foldSharesADealTake ? foldsSoFar : 0;
  const expectedDealSounds = POKER_SEAT_COUNT * HOLE_CARD_COUNT + foldsSoundingAsDeals;
  const dealSounds = countCue('deal_card');
  check(
    dealSounds === expectedDealSounds,
    `one deal cue per hole card (played ${dealSounds}, expected ${expectedDealSounds})`,
  );

  played.length = 0;
  poker.act({ kind: 'fold' });
  step();
  const foldSounds = played.length;
  poker.skip();
  const firstHand = handNumber;
  for (let i = 0; i < POKER_MAX_STEPS && (poker.pokerTable?.handNumber ?? 0) === firstHand; i++) {
    const before = played.length;
    step();
    // Skipping ends where the next hand starts. Its first beat is a step of
    // its own (the table waits between hands far longer than one step), so
    // that step's sounds are the new hand's, not the skipped one's.
    if ((poker.pokerTable?.handNumber ?? 0) !== firstHand) played.length = before;
  }
  const skippedSounds = played.slice(foldSounds);
  check(foldSounds === 1, `the fold itself sounds once (played ${foldSounds})`);
  check(
    skippedSounds.length === 0,
    `a hand skipped through after folding stays silent (played ${skippedSounds.join(', ') || 'nothing'})`,
  );

  for (let i = 0; i < POKER_MAX_STEPS && poker.pokerTable?.awaitingPlayer !== true; i++) step();
  played.length = 0;
  poker.forceClose(player);
  check(
    played.length === 0,
    `a teardown mid-hand settles the hand without a sound (played ${played.join(', ') || 'nothing'})`,
  );
}

section('the poker table: after the player acts, real-time frames play the hand on');
{
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { ClubPokerSystem } = await import('../src/systems/ClubPokerSystem.js');
  const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
  const { mulberry32, subSeed } = await import('../src/sprites/person/rng.js');
  /** A seed whose regulars tank long enough to have looked like a stall in review. */
  const STALL_REVIEW_SEED = 0x0c4a5d1a;
  const SHUFFLE_SALT = 0x5e47;
  const MS_PER_SECOND = 1000;
  const FRAMES_PER_SECOND = 60;
  const FRAME_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
  /** Every regular may think for the longest a decision takes; a street still finishes well inside this. */
  const PLAY_ON_WITHIN_SECONDS = 60;
  const PLAY_ON_WITHIN_MS = PLAY_ON_WITHIN_SECONDS * MS_PER_SECOND;
  const POKER_STEP_MS = 50;
  const POKER_MAX_STEPS = 4000;

  let now = 0;
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(1, 0, TILE_SIZE);
  player.coins = POKER_STAKES.penny.buyIn;
  const poker = new ClubPokerSystem(
    null,
    STALL_REVIEW_SEED,
    () => now,
    mulberry32(subSeed(STALL_REVIEW_SEED, SHUFFLE_SALT)),
  );
  poker.buyIn('penny', player, companion);
  poker.dismissRules();
  for (let i = 0; i < POKER_MAX_STEPS && poker.pokerTable?.awaitingPlayer !== true; i++) {
    now += POKER_STEP_MS;
    poker.update();
  }
  const table = poker.pokerTable;
  const legal = table?.playerLegalActions() ?? null;
  check(table !== null && legal !== null, 'the review seed reaches the player’s first decision');
  if (table !== null && legal !== null) {
    poker.openRaiseTray();
    poker.act(legal.call !== null ? { kind: 'call' } : { kind: 'check' });
    const before = { hand: table.handNumber, board: table.board.length };
    let waited = 0;
    const movedOn = (): boolean =>
      table.awaitingPlayer ||
      table.handNumber !== before.hand ||
      table.board.length !== before.board;
    while (waited < PLAY_ON_WITHIN_MS && !movedOn()) {
      now += FRAME_MS;
      waited += FRAME_MS;
      poker.update();
    }
    check(
      movedOn(),
      `sixty-a-second frames reach the next decision, street or hand after the player calls (waited ${Math.round(waited)} ms)`,
    );
  }
}

section('the poker table: the Game over prompt answers Escape, Space, Enter and New game');
{
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { ClubPokerSystem, gameOverBody } = await import('../src/systems/ClubPokerSystem.js');
  const { POKER_DEV_SEED } = await import('../src/systems/casino/poker/npc/personality.js');
  const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
  const { partyCoins } = await import('../src/core/partyCoins.js');
  const { playUntilBust, playUntilGameOver } =
    await import('../src/dev/uiGallery/dialogs/poker.js');
  const { mulberry32 } = await import('../src/sprites/person/rng.js');
  const POKER_STEP_MS = 50;
  const POKER_SHUFFLE_SEED = 13;
  /** Deals tried in search of one that leaves the player's stack short of a buy-in. */
  const SHORT_STACK_SEEDS = 40;
  const POKER_MAX_STEPS = 2000;
  const buyIn = POKER_STAKES.penny.buyIn;

  /** A party whose game has just ended, with `purse` left over after the buy-in. */
  const finishedGame = (purse: number, shuffleSeed = POKER_SHUFFLE_SEED, skipFirst = false) => {
    const player = new HumanPlayer(0, 0, TILE_SIZE);
    const companion = new CatPlayer(1, 0, TILE_SIZE);
    player.coins = buyIn + purse;
    companion.coins = 0;
    let now = 0;
    const poker = new ClubPokerSystem(null, POKER_DEV_SEED, () => now, mulberry32(shuffleSeed));
    poker.buyIn('penny', player, companion);
    poker.dismissRules();
    const table = poker.pokerTable;
    if (skipFirst) {
      for (let i = 0; i < POKER_MAX_STEPS && table?.playerLegalActions()?.canFold !== true; i++) {
        now += POKER_STEP_MS;
        poker.update();
      }
      poker.act({ kind: 'fold' });
      poker.skip();
    }
    const skippingBeforeEnd = poker['skipping'];
    const ended = table !== null && playUntilGameOver(table);
    now += POKER_STEP_MS;
    poker.update();
    const surface = poker.gameOverSurface('poker-game-over', {
      active: () => player,
      companion: () => companion,
    });
    const view = harness([surface]);
    view.frame();
    return {
      poker,
      table,
      ended,
      player,
      companion,
      view,
      skippingBeforeEnd,
      stack: table?.playerStack ?? 0,
    };
  };
  const newGameRegion = (view: Harness): HitRegion | undefined =>
    view.root.regions().find((region) => region.id.endsWith('/new-game'));

  for (const key of ['Escape', ' ', 'Enter'] as const) {
    const over = finishedGame(0);
    const purse = partyCoins(over.player, over.companion);
    over.view.root.key(key);
    over.view.frame();
    check(
      over.ended &&
        !over.poker.tableOpen &&
        partyCoins(over.player, over.companion) === purse + over.stack,
      `${key === ' ' ? 'Space' : key} on Game over leaves and cashes out the ${over.stack} stack`,
    );
  }

  const brokeLine = gameOverBody(POKER_STAKES.penny.name, 0, buyIn);
  const flushLine = gameOverBody(POKER_STAKES.penny.name, buyIn, buyIn);
  check(
    !brokeLine.includes('Cash out') &&
      brokeLine.includes('Leave') &&
      flushLine.includes('Cash out'),
    `with no chips the Game over line offers Leave, not a cash-out ("${brokeLine}")`,
  );

  // Leaving with nothing left says nothing; leaving with chips still reports the cash-out.
  const leaveNotices = (bust: boolean): string[] => {
    const notices: string[] = [];
    const player = new HumanPlayer(0, 0, TILE_SIZE);
    const companion = new CatPlayer(1, 0, TILE_SIZE);
    player.coins = buyIn;
    let now = 0;
    const poker = new ClubPokerSystem(
      null,
      POKER_DEV_SEED,
      () => now,
      mulberry32(POKER_SHUFFLE_SEED),
    );
    poker.onNotice = (message) => notices.push(message);
    poker.buyIn('penny', player, companion);
    poker.dismissRules();
    const table = poker.pokerTable;
    if (table !== null && bust) playUntilBust(table);
    now += POKER_STEP_MS;
    poker.update();
    const seat = { active: () => player, companion: () => companion };
    const view = harness([
      bust ? poker.bustSurface('poker-bust', seat) : poker.tableSurface('poker-table', seat),
    ]);
    view.frame();
    if (bust) view.root.key('Escape');
    else poker.requestLeave(player);
    view.frame();
    return notices;
  };
  const afterBust = leaveNotices(true);
  const withChips = leaveNotices(false);
  check(
    afterBust.every((notice) => !notice.startsWith('Cashed out')) &&
      withChips.some((notice) => notice.startsWith('Cashed out')),
    `leaving with nothing posts no "Cashed out" toast, leaving with chips still does (${afterBust.length} / ${withChips.length} notices)`,
  );

  const skippedToEnd = finishedGame(0, POKER_SHUFFLE_SEED, true);
  check(
    skippedToEnd.ended && skippedToEnd.skippingBeforeEnd && !skippedToEnd.poker['skipping'],
    'a skip running when the game ends is cleared, so a New game does not start skipping',
  );

  // A deal where the player's blind went in and was lost, so the stack is short of a buy-in.
  let broke = finishedGame(0);
  for (let seed = 0; seed < SHORT_STACK_SEEDS && broke.stack >= buyIn; seed++) {
    broke = finishedGame(0, seed);
  }
  const brokeShort = broke.stack < buyIn;
  check(
    brokeShort && newGameRegion(broke.view)?.disabled === true,
    `New game is disabled when the purse plus the ${broke.stack} stack is short of ${buyIn}`,
  );

  const flush = finishedGame(buyIn);
  const purse = partyCoins(flush.player, flush.companion);
  const button = newGameRegion(flush.view);
  check(
    button !== undefined && !button.disabled,
    'New game is offered when the party can cover it',
  );
  if (button !== undefined) {
    flush.view.tap({ x: button.rect.x + button.rect.w / 2, y: button.rect.y + button.rect.h / 2 });
    flush.view.frame();
    const next = flush.poker.pokerTable;
    check(
      next !== null &&
        next !== flush.table &&
        partyCoins(flush.player, flush.companion) === purse + flush.stack - buyIn,
      `New game cashes the ${flush.stack} stack out and charges the ${buyIn} buy-in once`,
    );
  }
}

section('the Wheel of Fortune warnings and SPIN, on a desktop and on phones');
{
  const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
  installCanvasGlobals();
  const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
  const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
  const { TILE_SIZE } = await import('../src/core/constants.js');
  const { createWheelLedger } = await import('../src/core/WheelLedger.js');
  const { ClubWheelSystem, WHEEL_ARMING_MS, WHEEL_SPIN_HOLD_MS, WHEEL_SPIN_KEY } =
    await import('../src/systems/ClubWheelSystem.js');
  const WHEEL_FRAME_MS = 16;
  const WHEEL_PURSE = 50_000;
  /** Well inside the hold, so letting go here must cancel. */
  const SHORT_HOLD_MS = 300;
  /** Partway through the arming delay. */
  const EARLY_MS = 400;
  const layouts = [
    { label: 'desktop', cssWidth: 1440, cssHeight: 900, density: 'pointer' },
    { label: 'phone upright', cssWidth: 390, cssHeight: 844, density: 'touch' },
    { label: 'phone on its side', cssWidth: 844, cssHeight: 390, density: 'touch' },
  ] as const;

  for (const layout of layouts) {
    let now = 0;
    let saves = 0;
    const human = new HumanPlayer(0, 0, TILE_SIZE);
    const cat = new CatPlayer(1, 0, TILE_SIZE);
    human.coins = WHEEL_PURSE;
    const seat = { active: () => human, companion: () => cat };
    const wheel = new ClubWheelSystem({
      audio: null,
      audioScope: null,
      ledger: createWheelLedger(),
      saveNow: () => {
        saves++;
        return Promise.resolve('disabled');
      },
      progressWipe: null,
      afterNothing: () => undefined,
      grantAttackCow: () => undefined,
      clock: () => now,
      // A drawn Nothing would make its round-trip the wipe, not a save; this checks the save.
      forcedOutcome: (board) => {
        const index = board.findIndex((wedge) => wedge.prize.kind === 'spin_again');
        return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
      },
    });
    const root = new UiRoot({
      audio: null,
      viewport: () => ({
        cssWidth: layout.cssWidth,
        cssHeight: layout.cssHeight,
        density: layout.density,
        uiSize: 'medium',
        safeArea: NO_INSETS,
      }),
      now: () => now,
      warn: () => undefined,
    });
    for (const surface of wheel.surfaces(seat)) root.mount(surface);
    const ctx = gameContext(layout.cssWidth, layout.cssHeight);
    const frame = (ms = WHEEL_FRAME_MS): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += WHEEL_FRAME_MS) {
        now += WHEEL_FRAME_MS;
        wheel.update();
        root.frame(ctx);
      }
    };
    const gesture = (kind: 'down' | 'move' | 'up', point: Point): void => {
      const scale = root.uiScale;
      root.pointer({
        kind,
        pointerId: TOUCH_POINTER_ID,
        source: layout.density === 'touch' ? 'touch' : 'mouse',
        x: point.x,
        y: point.y,
        cssX: point.x * scale,
        cssY: point.y * scale,
        button: PRIMARY_BUTTON,
        deltaY: 0,
      });
    };
    const tap = (point: Point): void => {
      gesture('down', point);
      gesture('up', point);
      frame();
    };
    const region = (suffix: string): HitRegion | undefined =>
      root.regions().find((candidate) => candidate.id.endsWith(suffix));
    const freshWarning = (): void => {
      wheel.resetForReview();
      frame();
      wheel.open(seat);
      frame();
    };
    const where = `(${layout.label})`;

    for (const key of ['Enter', ' ', 'Escape']) {
      freshWarning();
      root.key(key);
      frame();
      check(
        wheel.currentScreen === 'closed',
        `${where} ${JSON.stringify(key)} on the warning answers No`,
      );
      wheel.openPromptForReview(seat, 'confirm');
      frame();
      root.key(key);
      frame();
      check(
        wheel.currentScreen === 'closed',
        `${where} ${JSON.stringify(key)} on the confirm answers No`,
      );
    }

    freshWarning();
    tap(SCREEN_CORNER);
    check(wheel.currentScreen === 'closed', `${where} a tap on the warning's scrim answers No`);
    wheel.openPromptForReview(seat, 'confirm');
    frame();
    tap(SCREEN_CORNER);
    check(wheel.currentScreen === 'closed', `${where} a tap on the confirm's scrim answers No`);

    freshWarning();
    frame(EARLY_MS);
    const earlyYes = region('/yes');
    if (earlyYes !== undefined) tap(mid(earlyYes.rect));
    check(
      earlyYes !== undefined && wheel.currentScreen === 'warning',
      `${where} Yes does nothing while the warning arms`,
    );
    frame(WHEEL_ARMING_MS);
    const firstYes = region('/yes');
    if (firstYes === undefined) {
      check(false, `${where} the warning shows Yes`);
    } else {
      const point = mid(firstYes.rect);
      tap(point);
      check(wheel.currentScreen === 'confirm', `${where} an armed Yes opens the confirm`);
      tap(point);
      check(
        wheel.currentScreen !== 'wheel',
        `${where} a double tap on the warning's Yes never confirms the second prompt`,
      );
      if (wheel.currentScreen === 'closed') wheel.openPromptForReview(seat, 'confirm');
      frame(WHEEL_ARMING_MS + WHEEL_FRAME_MS);
      const confirmYes = region('/yes');
      tap(point);
      check(
        wheel.currentScreen !== 'wheel',
        `${where} the confirm's Yes never sits where the warning's Yes sat`,
      );
      check(
        confirmYes !== undefined && intersect(confirmYes.rect, firstYes.rect) === null,
        `${where} the two Yes buttons do not overlap`,
      );
    }

    wheel.resetForReview();
    wheel.openWheelForReview(seat);
    frame();
    const spin = region('/spin');
    if (spin === undefined) {
      check(false, `${where} the wheel shows SPIN`);
      continue;
    }
    const spinAt = mid(spin.rect);
    gesture('down', spinAt);
    frame(SHORT_HOLD_MS);
    gesture('up', spinAt);
    frame();
    check(wheel.phaseKind === 'idle' && saves === 0, `${where} a short press on SPIN never spins`);
    root.key(WHEEL_SPIN_KEY);
    frame(SHORT_HOLD_MS);
    root.keyUp(WHEEL_SPIN_KEY);
    frame(WHEEL_SPIN_HOLD_MS);
    check(wheel.phaseKind === 'idle' && saves === 0, `${where} Space let go early never spins`);
    root.key(WHEEL_SPIN_KEY);
    frame(SHORT_HOLD_MS);
    root.blur();
    frame(WHEEL_SPIN_HOLD_MS);
    check(
      wheel.phaseKind === 'idle' && saves === 0,
      `${where} the window losing focus during a Space hold never spins`,
    );
    const offSpin = { x: spin.rect.x + spin.rect.w / 2, y: spin.rect.y - spin.rect.h };
    gesture('down', spinAt);
    frame(SHORT_HOLD_MS);
    gesture('move', offSpin);
    frame(WHEEL_SPIN_HOLD_MS);
    gesture('up', offSpin);
    frame();
    check(
      wheel.phaseKind === 'idle' && saves === 0,
      `${where} sliding off SPIN before the hold completes never spins`,
    );
    gesture('down', spinAt);
    frame(WHEEL_SPIN_HOLD_MS + WHEEL_FRAME_MS);
    gesture('up', spinAt);
    await Promise.resolve();
    frame();
    check(
      saves === 1 && wheel.phaseKind !== 'idle',
      `${where} a full hold on SPIN spins (phase ${wheel.phaseKind}, saves ${saves})`,
    );
    root.key('Escape');
    frame();
    check(wheel.currentScreen === 'wheel', `${where} Escape does not leave a turning wheel`);
    root.dispose();
  }
}

section('the slot machine: SPIN spins, a tap mid-celebration skips, Leave and Escape close');
{
  const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
  installCanvasGlobals();
  const { openStagedSlots, stageSlots, SLOTS_STAGE_STEP_MS } =
    await import('../src/dev/slotsStaging.js');
  const SLOTS_SETTLE_MS = 6000;
  const regionCentre = (h: Harness, id: string): Point | null => {
    const region = h.root.regions().find((r) => r.id.endsWith(`/${id}`));
    return region === undefined
      ? null
      : { x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 };
  };
  const machine = (stage: 'idle' | 'big-win') => {
    const staged = openStagedSlots();
    stageSlots(staged, stage);
    const h = harness([staged.host.machineSurface('slots', staged.seat)]);
    h.frame();
    return { staged, h };
  };

  const idle = machine('idle');
  const spinAt = regionCentre(idle.h, 'spin');
  check(spinAt !== null, 'the machine draws a SPIN control');
  const wageredBefore = idle.staged.host.coinsWageredThisVisit;
  if (spinAt !== null) idle.h.tap(spinAt);
  idle.h.frame();
  check(
    idle.staged.host.coinsWageredThisVisit > wageredBefore && idle.staged.host.motion.reelsMoving,
    'a tap on SPIN takes the bet and starts the reels',
  );
  check(
    idle.h.rec.sounds.includes('slots_spin_button'),
    'SPIN sounds its own cue from the dispatcher',
  );
  idle.staged.advance(SLOTS_SETTLE_MS);
  idle.h.frame();
  const spinsBefore = idle.staged.host.machine.paidSpins;
  idle.h.root.key(' ');
  idle.h.frame();
  check(
    idle.staged.host.machine.paidSpins === spinsBefore + 1,
    'Space spins a resting machine, even with the attack key on Space',
  );
  idle.staged.advance(SLOTS_SETTLE_MS);
  idle.h.frame();
  const leaveAt = regionCentre(idle.h, 'leave');
  if (leaveAt !== null) idle.h.tap(leaveAt);
  idle.h.frame();
  check(!idle.staged.host.anySurfaceOpen, 'Leave closes a resting machine');
  idle.h.root.dispose();

  const big = machine('big-win');
  check(big.staged.host.motion.celebration !== null, 'the big-win machine is celebrating');
  const betUpAt = regionCentre(big.h, 'bet-up');
  const betBefore = big.staged.host.betPerLine;
  const cabinet = big.staged.host.layout?.glass ?? null;
  if (cabinet !== null) big.h.tap({ x: cabinet.x + cabinet.w / 2, y: cabinet.y + cabinet.h / 2 });
  big.staged.advance(SLOTS_STAGE_STEP_MS);
  big.h.frame();
  check(
    big.staged.host.motion.celebration?.skipped === true,
    'a tap on the glass mid-celebration skips the rollup',
  );
  if (betUpAt !== null) big.h.tap(betUpAt);
  big.h.frame();
  check(big.staged.host.betPerLine === betBefore, 'the bet is locked while a win is celebrated');
  const coinsBeforeLeaving = big.staged.human.coins;
  big.h.root.key('Escape');
  big.h.frame();
  check(!big.staged.host.anySurfaceOpen, 'Escape mid-celebration settles the win and closes');
  check(
    big.staged.human.coins > coinsBeforeLeaving,
    'the win on the glass was paid before the machine closed',
  );
  big.h.root.dispose();
}

section('the slot machine: a skip before the banner lands plays no slam, shake, flash or fanfare');
{
  const { openStagedSlots, stepUntil, SLOTS_STAGE_STEP_MS } =
    await import('../src/dev/slotsStaging.js');
  const { MAX_BET_PER_LINE } = await import('../src/systems/casino/slots/slotBets.js');
  /** Long past the end of any jackpot celebration and its flash pulses. */
  const AFTERMATH_MS = 20000;
  const played: string[] = [];
  const paused: string[] = [];
  const audio = {
    play: (id: string) => void played.push(id),
    stopSound: () => undefined,
    fadeOutSound: () => undefined,
    duckMusic: () => undefined,
    unduckMusic: () => undefined,
    pauseMusic: (reason?: string) => void paused.push(reason ?? 'menu'),
    resumeMusic: () => undefined,
  };
  const staged = openStagedSlots(audio);
  staged.host.betPerLine = MAX_BET_PER_LINE;
  check(staged.host.forceNext('jackpot') && staged.host.spin(), 'a jackpot spin starts');
  stepUntil(staged, () => staged.host.motion.celebration !== null);
  staged.host.skip();
  const motion = staged.host.motion;
  let shook = false;
  let flashed = false;
  for (let elapsed = 0; elapsed < AFTERMATH_MS; elapsed += SLOTS_STAGE_STEP_MS) {
    staged.advance(SLOTS_STAGE_STEP_MS);
    shook ||= motion.shakeOffset().x !== 0 || motion.shakeOffset().y !== 0;
    flashed ||= motion.flashAlpha() > 0;
  }
  check(!shook && !flashed, 'a skip before the banner neither shakes the screen nor flashes it');
  check(
    !played.includes('slots_jackpot_siren') && paused.length === 0,
    'the skipped banner sounds no siren and never silences the music',
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
