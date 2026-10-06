/**
 * The surface stack: one ordered list of everything on screen that can take
 * input or hide the world, from which draw order, pointer order, Escape order,
 * keyboard focus and "is the world halted" are all derived.
 *
 * A scene builds one `UiRoot`, mounts each surface once, calls {@link UiRoot.frame}
 * once per render, and forwards pointer gestures and keys to it. While a
 * surface renders, its widgets register hit regions; the registry is frozen at
 * the end of the frame and every input event reads the frozen copy, so what
 * was drawn and what can be hit are the same data.
 *
 * Headless by design: no DOM access. The viewport, clock and audio are
 * injected, so a node harness can drive it with fake surfaces.
 */

import type { SoundId } from '../../audio/sounds';
import { motion, resolveTheme, type Density, type Theme } from '../theme/tokens';
import { paintIsolated } from '../isolatedPaint';
import { forgetFrameInputMode, noteFrameInputMode } from './inputMode';
import { contains, inset, intersect, type Rect } from './geom';
import { PRIMARY_BUTTON, TAP_SLOP, type PointerGesture, type PointerSource } from './pointer';
import { UiStateStore, type TweenOptions, type UiStateSlot } from './uiState';
import { resolveViewport, type SizeClass, type UiViewport, type ViewportInput } from './viewport';

/** Bands, bottom to top. A surface's band fixes its place in the stack before open order does. */
export const BANDS = ['world', 'hud', 'panel', 'modal', 'toast', 'system'] as const;

export type Band = (typeof BANDS)[number];

const BAND_INDEX: Readonly<Record<Band, number>> = {
  world: 0,
  hud: 1,
  panel: 2,
  modal: 3,
  toast: 4,
  system: 5,
};

/** Surfaces in these bands get a full-screen block before they render, so they can't forget to claim the screen. */
const SCRIM_BANDS: ReadonlySet<Band> = new Set<Band>(['modal', 'system']);

/** The topmost open surface in one of these bands owns the keyboard focus ring. */
const FOCUS_BANDS: ReadonlySet<Band> = new Set<Band>(['panel', 'modal', 'system']);

/** The sound a tap plays unless its region names another (or `null`). */
export const UI_TAP_SOUND: SoundId = 'menu_click';

/** The sound a tap on a disabled control plays. */
export const UI_ERROR_SOUND: SoundId = 'error';

/** The widget id of the full-screen block a modal or system surface gets before it renders. */
export const SCRIM_WIDGET_ID = '__scrim';

/** Modifier and timing state that travels with a key. */
export interface KeyModifiers {
  readonly shift?: boolean;
  /** An auto-repeat of a key already down. */
  readonly repeat?: boolean;
  /** The keydown's own `timeStamp`, on `performance.now()`'s timebase, for timing-graded presses. */
  readonly timeStamp?: number;
  /**
   * The key was already held when the surface now in focus appeared. Such a
   * press was aimed at whatever came before, so it must not activate or move
   * focus in the new surface.
   */
  readonly predatesSurface?: boolean;
}

/**
 * Anything on screen that can take input or hide the world.
 *
 * `band`, `haltsWorld`, `locksKeyboard` and `blocksEscape` are read afresh
 * every time they are needed, so a surface whose claim changes while it is
 * open (a conversation that halts for one request and floats for the next)
 * may implement them as getters.
 */
export interface Surface {
  /** Unique per scene; used for focus scoping, uiState keys and debugging. */
  readonly id: string;
  readonly band: Band;
  isOpen(): boolean;
  render(ui: Ui): void;
  /** Present means Escape closes it. Absent means Escape passes beneath (or is blocked by `blocksEscape`). */
  close?(): void;
  /** When present and false, Escape passes beneath this surface as if it had no `close`. */
  wantsEscape?(): boolean;
  /** While open, gameplay is paused and gameplay keys are swallowed. */
  readonly haltsWorld: boolean;
  /** While open, keys no surface consumed are kept from gameplay even though the world runs on. */
  readonly locksKeyboard?: boolean;
  /** True for load-bearing scenes where Escape must do nothing at all. */
  readonly blocksEscape?: boolean;
  /** Raw key hook for surfaces with typed input (search, rebind, stepper digits). Return true to consume. */
  onKey?(key: string, mods: KeyModifiers): boolean;
  /**
   * While open, keys are free text being typed into it (the chat box), so the
   * key hooks are not offered them: a world timing press would eat a letter.
   */
  readonly takesText?: boolean;
}

/** Where and how a tap landed. Keyboard activation reports the region's centre. */
export interface TapEvent {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly source: PointerSource | 'keyboard';
  /** The input event's own `timeStamp`, when the host supplied one. */
  readonly timeStamp?: number;
  /** The pointer that made it, so a handler can tell two fingers apart. Absent for keyboard activation. */
  readonly pointerId?: number;
}

/** How the gesture a region owned came to an end. */
export interface ReleaseInfo {
  /** It travelled past `TAP_SLOP` and was handed to a drag handler. */
  readonly dragged: boolean;
  /** It was cancelled rather than released. */
  readonly cancelled: boolean;
  /**
   * A surface that opened after the gesture went down now covers where it
   * ended (a reward card raised mid-drag): the release belongs to nothing
   * under it, so a drag should be abandoned rather than dropped.
   */
  readonly covered: boolean;
}

/** One step of a drag, in UI units. `dx`/`dy` are measured from where the gesture went down. */
export interface DragPoint {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly startX: number;
  readonly startY: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * A drag starts once the pointer leaves `TAP_SLOP`. A drag never also taps.
 * `onEnd` gets `cancelled: true` when the gesture was cancelled rather than released.
 */
export interface DragHandlers {
  onStart?(point: DragPoint): void;
  onMove(point: DragPoint): void;
  onEnd?(point: DragPoint, cancelled: boolean): void;
}

/** What a region does when it receives input. Every handler is optional. */
export interface HitHandlers {
  /** Fires on release, only for the gesture's owner, only if nothing has covered it since. */
  readonly onTap?: (e: TapEvent) => void;
  /** Fires on down. Only for combat-critical controls (the hotbar); the release is then ignored. */
  readonly onPress?: (e: TapEvent) => void;
  /**
   * Fires on down without claiming the release, unlike `onPress`: the
   * gesture still taps or drags as usual. Paired with `onRelease`.
   */
  readonly onDown?: (e: TapEvent) => void;
  /**
   * Fires exactly once when a gesture whose down landed on this region ends,
   * however it ends, before `onTap`. Captured at down, so it fires even if
   * the region has since gone.
   */
  readonly onRelease?: (e: TapEvent, info: ReleaseInfo) => void;
  /**
   * A tap with a non-primary mouse button (right-click). Every other handler
   * sees the primary button only; a region without this ignores the others.
   */
  readonly onSecondaryTap?: (e: TapEvent) => void;
  readonly onDrag?: DragHandlers;
  /** How far, in UI units, a press may wander before it becomes a drag rather than a tap. Defaults to `TAP_SLOP`. */
  readonly dragSlop?: number;
  readonly onWheel?: (dy: number) => void;
  /**
   * Fires when a gesture goes down anywhere outside this region, on another
   * control or on the world, without taking that press from its owner. For
   * fields that let go of the keyboard when the player presses elsewhere.
   */
  readonly onOutsideDown?: () => void;
  /** Joins the keyboard focus ring. Defaults to true when `onTap` is given and the region is enabled. */
  readonly focusable?: boolean;
  /** Enter/Space activates this region when nothing else is focused. */
  readonly primary?: boolean;
  /** Swallows input like a block, plays the error cue on tap, never fires a handler. Still reports hover. */
  readonly disabled?: boolean;
  /** Played when a tap or press fires. Defaults to {@link UI_TAP_SOUND}; `null` is silent. */
  readonly sound?: SoundId | null;
  /**
   * Reports hover and nothing else: every other handler is ignored, it never
   * joins the focus ring, and presses, taps and the wheel pass through it to
   * whatever lies beneath, which keeps its own hover too. For display-only
   * things that show a tooltip.
   */
  readonly hoverOnly?: boolean;
}

/** How a region should look this frame. */
export interface HitState {
  /** The mouse is over it and nothing above it. */
  readonly hovered: boolean;
  /** A gesture it owns is down and still inside it. Draw the pressed look now, even though the tap fires on release. */
  readonly pressed: boolean;
  /** It holds keyboard focus and the player is using the keyboard: draw the focus ring. */
  readonly focused: boolean;
}

/** One registered region in the frozen registry. */
export interface HitRegion {
  readonly surfaceId: string;
  /** `${surfaceId}/${widgetId}`, stable across frames. */
  readonly id: string;
  /** Already intersected with the clip that was active when it registered. */
  readonly rect: Rect;
  readonly band: Band;
  readonly onTap?: (e: TapEvent) => void;
  readonly onPress?: (e: TapEvent) => void;
  readonly onDown?: (e: TapEvent) => void;
  readonly onRelease?: (e: TapEvent, info: ReleaseInfo) => void;
  readonly onSecondaryTap?: (e: TapEvent) => void;
  readonly onDrag?: DragHandlers;
  readonly dragSlop: number;
  readonly onWheel?: (dy: number) => void;
  readonly onOutsideDown?: () => void;
  readonly focusable: boolean;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly sound: SoundId | null;
  /** Hover is all it takes: pointer input passes through it. */
  readonly hoverOnly: boolean;
  /** The surface's layer this region sits on: 0, or the count of `ui.layer()` calls before it this frame. */
  readonly layer: number;
}

/** A gesture delivered to the world: only gestures no surface claimed on down. */
export interface WorldGesture extends PointerGesture {
  /** On `up`: the pointer stayed within `TAP_SLOP` of where it went down. Always false otherwise. */
  readonly tap: boolean;
}

/** The audio a `UiRoot` plays through; `AudioManager` satisfies it. */
export interface UiAudio {
  play(id: SoundId): void;
}

/**
 * The context a surface renders with. Widgets are free functions over it:
 * `button(ui, rect, opts)`.
 */
export interface Ui {
  readonly ctx: CanvasRenderingContext2D;
  /** Resolved tokens for the current density. */
  readonly theme: Theme;
  /** UI units, safe-area insets already applied. Lay content out in this. */
  readonly viewport: Rect;
  /** The whole canvas in UI units. Scrims cover this. */
  readonly screen: Rect;
  readonly size: SizeClass;
  readonly density: Density;
  /** UI units per CSS pixel. The context is already scaled by it. */
  readonly uiScale: number;
  /** Milliseconds, for animation. */
  readonly now: number;
  /** The rendering surface's id. */
  readonly surfaceId: string;
  /** When this surface last opened, on the same clock as `now`. */
  readonly openedAt: number;
  /** The mouse position in UI units, or `null` when there is no mouse or it is off the canvas. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** The active clip in UI units, or `null` when everything is clipped away. */
  readonly clipRect: Rect | null;
  /** Registers a region (clipped to the active clip) and returns its visual state. Later registrations sit above earlier ones. */
  hit(id: string, rect: Rect, handlers: HitHandlers): HitState;
  /** Registers a region that swallows input and does nothing. */
  block(rect: Rect): void;
  /** Runs `draw` with drawing and hit registration clipped to `rect` (intersected with any outer clip). */
  clip<T>(rect: Rect, draw: () => T): T;
  /** Per-surface, per-widget state; cleared when the surface closes. */
  state<T>(slot: UiStateSlot<T>, id: string, init?: () => T): T;
  /** Replaces a state value (for immutable state). */
  setState<T>(slot: UiStateSlot<T>, id: string, value: T): void;
  /** Eases a number toward `target` over `opts.ms` (default `motion.base`) and returns its current value. */
  tween(id: string, target: number, opts?: Partial<TweenOptions>): number;
  playSound(id: SoundId): void;
  /**
   * Runs `draw` once this surface has finished rendering, above everything it
   * drew and unclipped. Regions it registers sit above the surface's other
   * regions. Tooltips, context menus and popovers draw through this so they
   * are never painted over by a sibling drawn later.
   */
  defer(draw: () => void): void;
  /**
   * Runs `draw` once every surface has rendered, above all of them (any band)
   * and unclipped, under the surface's starting transform and opacity (not a
   * widget's own bounce or scale). For hover descriptions and drag ghosts: a
   * tooltip on a HUD slot must still read over a menu opened above the HUD.
   * An overlay from a surface under a modal or system scrim is dropped, since
   * nothing under a scrim can be hovered. An overlay takes no input; regions
   * it tries to register are refused.
   */
  overlay(draw: () => void): void;
  /**
   * Starts a dismissable layer (a context menu, a popover): every region this
   * surface registers after the call, this frame, sits on it. While a layer
   * is up, keyboard focus, Enter's primary control, wheel and drag hand-off
   * stop at it, so nothing beneath it in the surface can be reached through
   * it, and Escape calls `onEscape` before any surface is closed.
   */
  layer(opts?: { readonly onEscape?: () => void }): void;
  /**
   * Puts keyboard focus on this surface's region `id`, as if the keyboard had
   * walked there, while this surface owns the focus ring. For a menu that
   * starts on a visible default, or whose selection follows the pointer.
   */
  focus(id: string): void;
}

export interface UiRootOptions {
  readonly audio: UiAudio | null;
  /** Read once per frame. */
  readonly viewport: () => ViewportInput;
  /**
   * Receives every gesture whose down landed on no region. The only way world
   * code sees pointer input. A release over something that opened mid-gesture
   * arrives as `cancel`.
   */
  readonly handleWorldPointer?: (gesture: WorldGesture) => void;
  /** Milliseconds. Defaults to `performance.now`. */
  readonly now?: () => number;
  /** Development warnings (duplicate region ids). Defaults to `console.warn`; pass a no-op to silence. */
  readonly warn?: (message: string) => void;
}

/**
 * What a key did:
 * - `consumed`: a surface used it; nothing else may.
 * - `gameplay`: no surface wanted it and nothing halts the world; gameplay may act on it. An
 *   unclaimed Escape is always `gameplay`, so the scene can toggle pause.
 * - `blocked`: no surface wanted it, but the world is halted or the keyboard locked; gameplay must ignore it.
 */
export type KeyOutcome = 'consumed' | 'gameplay' | 'blocked';

interface MountedSurface {
  readonly surface: Surface;
  open: boolean;
  openSeq: number;
  openedAt: number;
}

/**
 * Which registration of `regionId` is meant. Ids may repeat within a surface
 * (three "Buy" rows); the occurrence picks the same row out of the next
 * frame's registry.
 */
interface RegionRef {
  readonly regionId: string;
  readonly occurrence: number;
}

type GestureOwner =
  | ({ readonly kind: 'region' } & RegionRef)
  | { readonly kind: 'world' }
  /** Down landed on a surface that opened after the last frame; the gesture is swallowed. */
  | { readonly kind: 'none' };

interface ActiveGesture {
  readonly pointerId: number;
  readonly source: PointerSource;
  readonly button: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  owner: GestureOwner;
  dragging: boolean;
  /** `onPress` fired on down, so the release does nothing. */
  pressed: boolean;
  /** The down region's `onRelease`, held from the down so it fires even if that region has gone. */
  readonly release: ((e: TapEvent, info: ReleaseInfo) => void) | null;
  readonly timeStamp: number | undefined;
  /** The open counter when the gesture went down; a surface opened later sits over it. */
  readonly openCounterAtDown: number;
}

/** Where a point hits: a region, or a just-opened modal that hasn't registered yet. */
type HitTarget =
  | { readonly kind: 'region'; readonly region: HitRegion; readonly index: number }
  | { readonly kind: 'pending' };

/** A registered region and its position in the frozen registry. */
interface IndexedRegion {
  readonly region: HitRegion;
  readonly index: number;
}

const NO_HIT: HitState = { hovered: false, pressed: false, focused: false };

const SPACE_KEYS: ReadonlySet<string> = new Set([' ', 'Spacebar', 'Space']);
/** Keys that activate the focused (or primary) control. */
export const ACTIVATE_KEYS: ReadonlySet<string> = new Set(['Enter', ...SPACE_KEYS]);

type Direction = 'up' | 'down' | 'left' | 'right';

const ARROW_DIRECTIONS: Readonly<Partial<Record<string, Direction>>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Keys that move keyboard focus round the ring. */
export const FOCUS_MOVE_KEYS: ReadonlySet<string> = new Set([
  'Tab',
  ...Object.keys(ARROW_DIRECTIONS),
]);

/** Arrow navigation prefers a target straight ahead: sideways distance counts this many times over. */
const CROSS_AXIS_WEIGHT = 2;

/**
 * Shortest gap between two focus steps driven by the OS key-repeat stream.
 * Auto-repeat runs at around thirty presses a second, which would walk a short
 * menu end to end before the player has read it. A fresh press is never
 * throttled, only the repeats behind it.
 */
const FOCUS_REPEAT_INTERVAL_MS = 140;

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function bandIndexOf(entry: MountedSurface): number {
  return BAND_INDEX[entry.surface.band];
}

function centre(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export class UiRoot {
  private readonly mounted: MountedSurface[] = [];
  private stack: MountedSurface[] = [];
  private openCounter = 0;
  private frozen: HitRegion[] = [];
  private frozenSurfaces = new Set<string>();
  /** Each surface's topmost layer last frame, and what Escape does to it. */
  private frozenLayers = new Map<string, { depth: number; onEscape: (() => void) | null }>();
  private readonly gestures = new Map<number, ActiveGesture>();
  private readonly keyHooks: ((key: string, mods: KeyModifiers) => boolean)[] = [];
  private readonly store = new UiStateStore();
  private mousePos: { x: number; y: number } | null = null;
  private focusScopeId: string | null = null;
  private focused: RegionRef | null = null;
  private focusVisible = false;
  /** Timed off the key event's own `timeStamp`, so a stalled thread's backlog of repeats is not let through as one instant. */
  private lastFocusStepAtMs = Number.NEGATIVE_INFINITY;
  /**
   * Keys struck fresh since the focus ring last came up. A repeat of any
   * other key belongs to a press made before the ring existed (an arrow held
   * through a conversation's last line as its choice row appears), so it is
   * swallowed rather than walking the new ring.
   */
  private readonly keysStruckForRing = new Set<string>();
  /** Whether the focus scope declared any focusable control last frame. */
  private ringWasUp = false;
  private viewportState: UiViewport;
  private readonly warned = new Set<string>();
  private readonly clock: () => number;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: UiRootOptions) {
    this.clock = options.now ?? defaultNow;
    this.warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
    this.viewportState = resolveViewport(options.viewport());
  }

  /** Adds a surface to the stack. Call once per surface; it renders whenever `isOpen()` is true. */
  mount(surface: Surface): void {
    if (this.mounted.some((entry) => entry.surface.id === surface.id)) {
      throw new Error(`UiRoot: a surface with id "${surface.id}" is already mounted`);
    }
    this.mounted.push({
      surface,
      open: false,
      openSeq: 0,
      openedAt: 0,
    });
  }

  /** Removes a surface, clearing its state. */
  unmount(surface: Surface): void {
    const index = this.mounted.findIndex((entry) => entry.surface === surface);
    if (index === -1) return;
    this.mounted.splice(index, 1);
    this.store.clearSurface(surface.id);
    this.refreshStack();
  }

  /** The viewport resolved at the last frame. */
  get viewport(): UiViewport {
    return this.viewportState;
  }

  /** CSS pixels per UI unit; `PointerInput` divides CSS coordinates by this. */
  get uiScale(): number {
    return this.viewportState.uiScale;
  }

  /** Open surfaces bottom to top, as of now. */
  openSurfaceIds(): string[] {
    this.refreshStack();
    return this.stack.map((entry) => entry.surface.id);
  }

  /** The registry frozen at the end of the last frame, bottom to top. */
  regions(): readonly HitRegion[] {
    return this.frozen;
  }

  /**
   * Whether the mouse is over any registered region right now. World hover
   * (entity tooltips) should stay quiet while this is true.
   */
  pointerOverUi(): boolean {
    if (this.mousePos === null) return false;
    this.refreshStack();
    return this.targetAt(this.mousePos.x, this.mousePos.y, true) !== null;
  }

  /** Forgets every mounted surface's state and any gesture in flight. Call when the owning scene exits. */
  dispose(): void {
    for (const entry of this.mounted) {
      this.store.clearSurface(entry.surface.id);
      entry.open = false;
    }
    this.stack = [];
    this.gestures.clear();
    this.frozen = [];
    this.frozenSurfaces = new Set();
    this.frozenLayers = new Map();
    this.focused = null;
    this.focusVisible = false;
    this.keysStruckForRing.clear();
    this.ringWasUp = false;
    forgetFrameInputMode(this);
  }

  /** True while any open surface halts the world. */
  worldHalted(): boolean {
    return this.mounted.some((entry) => entry.surface.haltsWorld && entry.surface.isOpen());
  }

  /** True while any open surface halts the world or locks the keyboard. */
  keyboardLocked(): boolean {
    return this.mounted.some(
      (entry) =>
        (entry.surface.haltsWorld || entry.surface.locksKeyboard === true) &&
        entry.surface.isOpen(),
    );
  }

  /** Whether an unconsumed key may reach gameplay: only while nothing halts the world or locks the keyboard. */
  keyReachesGameplay(): boolean {
    return !this.keyboardLocked();
  }

  /** Whether any surface in a band above `band` is open. */
  anyOpenAbove(band: Band): boolean {
    return this.openSurfaceIdsAbove(band).length > 0;
  }

  /** The open surfaces in bands above `band`, bottom to top. */
  openSurfaceIdsAbove(band: Band): string[] {
    this.refreshStack();
    const floor = BAND_INDEX[band];
    return this.stack
      .filter((entry) => bandIndexOf(entry) > floor)
      .map((entry) => entry.surface.id);
  }

  /** Whether the surface with this id is open, as of now. */
  isOpen(surfaceId: string): boolean {
    this.refreshStack();
    return this.isSurfaceOpen(surfaceId);
  }

  /**
   * The surface that owns keyboard focus now: the topmost open panel, modal or
   * system surface, or null. A change in it is a new menu in front of the player.
   */
  focusSurfaceId(): string | null {
    this.refreshStack();
    return this.focusScopeId;
  }

  /** The mouse in UI units, and whether a button is down, or null while the mouse is off the canvas. */
  get mouse(): { readonly x: number; readonly y: number; readonly down: boolean } | null {
    const pos = this.mousePos;
    if (pos === null) return null;
    let down = false;
    for (const gesture of this.gestures.values()) {
      if (gesture.source === 'mouse' && gesture.button === PRIMARY_BUTTON) down = true;
    }
    return { x: pos.x, y: pos.y, down };
  }

  private refreshStack(): void {
    const now = this.clock();
    for (const entry of this.mounted) {
      const open = entry.surface.isOpen();
      if (open && !entry.open) {
        this.openCounter++;
        entry.openSeq = this.openCounter;
        entry.openedAt = now;
      } else if (!open && entry.open) {
        this.store.clearSurface(entry.surface.id);
      }
      entry.open = open;
    }
    this.stack = this.mounted
      .filter((entry) => entry.open)
      .sort((a, b) => bandIndexOf(a) - bandIndexOf(b) || a.openSeq - b.openSeq);
    this.refreshFocusScope();
  }

  private refreshFocusScope(): void {
    let scope: MountedSurface | null = null;
    for (const entry of this.stack) {
      if (FOCUS_BANDS.has(entry.surface.band)) scope = entry;
    }
    const scopeId = scope?.surface.id ?? null;
    if (scopeId === this.focusScopeId) return;
    this.focusScopeId = scopeId;
    this.focused = null;
    this.focusVisible = false;
    this.keysStruckForRing.clear();
    this.ringWasUp = false;
  }

  private isSurfaceOpen(surfaceId: string): boolean {
    return this.stack.some((entry) => entry.surface.id === surfaceId);
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  /**
   * Renders every open surface bottom to top inside one `ctx.scale(uiScale)`,
   * rebuilding the hit registry as they go, then freezes it for input.
   */
  frame(ctx: CanvasRenderingContext2D): void {
    const now = this.clock();
    this.viewportState = resolveViewport(this.options.viewport());
    this.refreshStack();
    const viewport = this.viewportState;
    noteFrameInputMode(viewport.density, this);
    const theme = resolveTheme(viewport.density);
    const hovered = this.mousePos === null ? [] : this.hoveredAt(this.mousePos.x, this.mousePos.y);
    const building: HitRegion[] = [];
    const renderedSurfaces = new Set<string>();
    const layers = new Map<string, { depth: number; onEscape: (() => void) | null }>();
    const overlays: QueuedOverlay[] = [];

    ctx.save();
    try {
      ctx.scale(viewport.uiScale, viewport.uiScale);
      for (const [stackIndex, entry] of this.stack.entries()) {
        const context = new SurfaceContext(this, entry, stackIndex, {
          ctx,
          theme,
          viewport,
          now,
          hovered,
          mousePos: this.mousePos,
          building,
          layers,
          overlays,
          store: this.store,
        });
        if (SCRIM_BANDS.has(entry.surface.band)) {
          context.registerBlock(SCRIM_WIDGET_ID, viewport.screen);
        }
        // A surface that throws loses only its own drawing; those above it still render and register.
        paintIsolated(ctx, `surface ${entry.surface.id}`, () => {
          entry.surface.render(context);
        });
        paintIsolated(ctx, `surface ${entry.surface.id} deferred`, () => {
          context.flushDeferred();
        });
        renderedSurfaces.add(entry.surface.id);
      }
      const scrimIndices = this.stack
        .map((entry, index) => (SCRIM_BANDS.has(entry.surface.band) ? index : -1))
        .filter((index) => index >= 0);
      const topScrimIndex = Math.max(-1, ...scrimIndices);
      for (const queued of overlays) {
        if (queued.context.stackIndex < topScrimIndex) continue;
        paintIsolated(ctx, `surface ${queued.context.surfaceId} overlay`, () => {
          queued.context.paintOverlay(queued);
        });
      }
    } finally {
      ctx.restore();
      this.frozen = building;
      this.frozenSurfaces = renderedSurfaces;
      this.frozenLayers = layers;
    }
    const ringIsUp = this.focusRing().length > 0;
    if (ringIsUp && !this.ringWasUp) this.keysStruckForRing.clear();
    this.ringWasUp = ringIsUp;
  }

  private topLayer(surfaceId: string): number {
    return this.frozenLayers.get(surfaceId)?.depth ?? 0;
  }

  /** @internal Called by surface contexts. */
  regionState(ref: RegionRef, rect: Rect, hoveredRefs: readonly RegionRef[]): HitState {
    const hovered = hoveredRefs.some((hoveredRef) => sameRef(hoveredRef, ref));
    let pressed = false;
    for (const gesture of this.gestures.values()) {
      if (gesture.owner.kind !== 'region' || !sameRef(gesture.owner, ref) || gesture.dragging) {
        continue;
      }
      if (contains(inset(rect, -TAP_SLOP), gesture.x, gesture.y)) pressed = true;
    }
    const focused = this.focusVisible && this.focused !== null && sameRef(this.focused, ref);
    return hovered || pressed || focused ? { hovered, pressed, focused } : NO_HIT;
  }

  /** @internal Called by surface contexts. */
  focusRegion(surfaceId: string, regionId: string): void {
    if (surfaceId !== this.focusScopeId) return;
    this.focused = { regionId, occurrence: 0 };
    this.focusVisible = true;
  }

  /** @internal Called by surface contexts for duplicate-id warnings. */
  warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warn(message);
  }

  /** @internal */
  play(id: SoundId | null): void {
    if (id === null) return;
    this.options.audio?.play(id);
  }

  // ── Hit testing ─────────────────────────────────────────────────────────

  /**
   * The band index at and below which everything is covered by a modal or
   * system surface that opened after the last frame, or -1. Such a surface
   * hasn't registered its scrim yet, but must already block what's under it.
   */
  private pendingCoverBand(): number {
    let cover = -1;
    for (const entry of this.stack) {
      if (!SCRIM_BANDS.has(entry.surface.band)) continue;
      if (this.frozenSurfaces.has(entry.surface.id)) continue;
      cover = Math.max(cover, bandIndexOf(entry));
    }
    return cover;
  }

  /**
   * The topmost live region containing the point, honouring pending covers.
   * Hover-only regions are passed over unless `withHoverOnly` is set.
   */
  private targetAt(x: number, y: number, withHoverOnly = false): HitTarget | null {
    const index = this.topIndexAt(x, y, withHoverOnly);
    if (index !== null) {
      return { kind: 'region', region: this.frozen[index], index };
    }
    return this.pendingCoverBand() >= 0 ? { kind: 'pending' } : null;
  }

  private topIndexAt(x: number, y: number, withHoverOnly = false): number | null {
    const cover = this.pendingCoverBand();
    for (let index = this.frozen.length - 1; index >= 0; index--) {
      const region = this.frozen[index];
      if (region.hoverOnly && !withHoverOnly) continue;
      if (BAND_INDEX[region.band] <= cover) continue;
      if (!this.isSurfaceOpen(region.surfaceId)) continue;
      if (contains(region.rect, x, y)) return index;
    }
    return null;
  }

  /**
   * What the mouse at the point hovers: the topmost region input would reach,
   * plus the topmost hover-only region above it, since passing input through
   * must not take the hover look from what lies beneath.
   */
  private hoveredAt(x: number, y: number): RegionRef[] {
    const refs: RegionRef[] = [];
    const reached = this.topIndexAt(x, y);
    if (reached !== null) refs.push(this.refAt(reached));
    const overlay = this.topIndexAt(x, y, true);
    if (overlay !== null && overlay !== reached) refs.push(this.refAt(overlay));
    return refs;
  }

  /** The reference that picks the registration at `index` out of a later frame. */
  private refAt(index: number): RegionRef {
    const regionId = this.frozen[index].id;
    let occurrence = 0;
    for (let earlier = 0; earlier < index; earlier++) {
      if (this.frozen[earlier].id === regionId) occurrence++;
    }
    return { regionId, occurrence };
  }

  private findRegion(ref: RegionRef): IndexedRegion | null {
    let seen = 0;
    for (let index = 0; index < this.frozen.length; index++) {
      const region = this.frozen[index];
      if (region.id !== ref.regionId) continue;
      if (seen === ref.occurrence) {
        return this.isSurfaceOpen(region.surfaceId) ? { region, index } : null;
      }
      seen++;
    }
    return null;
  }

  /**
   * Whether a release at the point may tap the referenced region: it is still
   * registered, the point is within it plus `TAP_SLOP`, and nothing registered
   * above it covers the point.
   */
  private canTap(ref: RegionRef, x: number, y: number): HitRegion | null {
    const found = this.findRegion(ref);
    if (found === null) return null;
    if (!contains(inset(found.region.rect, -found.region.dragSlop), x, y)) return null;
    if (BAND_INDEX[found.region.band] <= this.pendingCoverBand()) return null;
    const top = this.topIndexAt(x, y);
    if (top !== null && top > found.index) return null;
    return found.region;
  }

  // ── Pointer ─────────────────────────────────────────────────────────────

  /** Feeds one gesture from `PointerInput`. */
  pointer(gesture: PointerGesture): void {
    this.refreshStack();
    // A mouse cancel comes from the cursor leaving or the window losing focus,
    // so its point is where the cursor was, not where it is.
    if (gesture.source === 'mouse' && gesture.kind !== 'cancel') {
      this.mousePos = { x: gesture.x, y: gesture.y };
    }
    switch (gesture.kind) {
      case 'down':
        this.pointerDown(gesture);
        break;
      case 'move':
        this.pointerMove(gesture);
        break;
      case 'up':
        this.pointerUp(gesture);
        break;
      case 'cancel':
        this.pointerCancel(gesture);
        break;
      case 'wheel':
        this.pointerWheel(gesture);
        break;
    }
  }

  /** The mouse left the canvas: nothing is hovered any more. */
  pointerLeft(): void {
    this.mousePos = null;
  }

  private toWorld(gesture: PointerGesture, tap: boolean): void {
    this.options.handleWorldPointer?.({ ...gesture, tap });
  }

  private dragPoint(active: ActiveGesture): DragPoint {
    return {
      pointerId: active.pointerId,
      x: active.x,
      y: active.y,
      startX: active.startX,
      startY: active.startY,
      dx: active.x - active.startX,
      dy: active.y - active.startY,
    };
  }

  private pointerDown(gesture: PointerGesture): void {
    if (this.gestures.has(gesture.pointerId)) return;
    this.focusVisible = false;
    const target = this.targetAt(gesture.x, gesture.y);
    const owner: GestureOwner =
      target === null
        ? { kind: 'world' }
        : target.kind === 'pending'
          ? { kind: 'none' }
          : { kind: 'region', ...this.refAt(target.index) };
    const isPrimary = gesture.button === PRIMARY_BUTTON;
    const downRegion =
      isPrimary && target?.kind === 'region' && !target.region.disabled ? target.region : null;
    const active: ActiveGesture = {
      pointerId: gesture.pointerId,
      source: gesture.source,
      button: gesture.button,
      startX: gesture.x,
      startY: gesture.y,
      x: gesture.x,
      y: gesture.y,
      owner,
      dragging: false,
      pressed: false,
      release: downRegion?.onRelease ?? null,
      timeStamp: gesture.timeStamp,
      openCounterAtDown: this.openCounter,
    };
    this.gestures.set(gesture.pointerId, active);
    for (const region of this.frozen) {
      if (region.onOutsideDown === undefined || contains(region.rect, gesture.x, gesture.y))
        continue;
      if (this.isSurfaceOpen(region.surfaceId)) region.onOutsideDown();
    }
    if (owner.kind === 'world') {
      this.toWorld(gesture, false);
      return;
    }
    if (downRegion === null) return;
    const downEvent: TapEvent = {
      x: gesture.x,
      y: gesture.y,
      button: gesture.button,
      source: gesture.source,
      timeStamp: gesture.timeStamp,
      pointerId: gesture.pointerId,
    };
    downRegion.onDown?.(downEvent);
    if (downRegion.onPress !== undefined) {
      active.pressed = true;
      downRegion.onPress(downEvent);
      this.play(downRegion.sound);
    }
  }

  /** Fires the down region's `onRelease`, if it had one. */
  private released(active: ActiveGesture, gesture: PointerGesture, cancelled: boolean): void {
    active.release?.(
      {
        x: gesture.x,
        y: gesture.y,
        button: active.button,
        source: active.source,
        timeStamp: gesture.timeStamp,
        pointerId: active.pointerId,
      },
      {
        dragged: active.dragging,
        cancelled,
        covered: this.openedOverSince(gesture.x, gesture.y, active.openCounterAtDown),
      },
    );
  }

  /**
   * The registered region beneath `ownerId` in the same surface, under the
   * gesture's start point, that accepts drags; so dragging on a list row
   * scrolls the list the row sits in.
   */
  private dragDelegate(owner: IndexedRegion, x: number, y: number): IndexedRegion | null {
    for (let index = owner.index - 1; index >= 0; index--) {
      const region = this.frozen[index];
      if (region.surfaceId !== owner.region.surfaceId) continue;
      if (region.layer < owner.region.layer) break;
      if (region.onDrag === undefined || region.disabled) continue;
      if (contains(region.rect, x, y)) return { region, index };
    }
    return null;
  }

  private pointerMove(gesture: PointerGesture): void {
    const active = this.gestures.get(gesture.pointerId);
    if (active === undefined) return;
    active.x = gesture.x;
    active.y = gesture.y;
    if (active.owner.kind === 'world') {
      this.toWorld(gesture, false);
      return;
    }
    if (active.owner.kind !== 'region' || active.pressed) return;
    if (active.button !== PRIMARY_BUTTON) return;
    const owner = this.findRegion(active.owner);
    if (owner === null) return;
    if (active.dragging) {
      owner.region.onDrag?.onMove(this.dragPoint(active));
      return;
    }
    const travelled = Math.hypot(active.x - active.startX, active.y - active.startY);
    if (travelled <= owner.region.dragSlop) return;
    const dragger =
      owner.region.onDrag !== undefined && !owner.region.disabled
        ? owner
        : this.dragDelegate(owner, active.startX, active.startY);
    if (dragger === null) return;
    active.owner = { kind: 'region', ...this.refAt(dragger.index) };
    active.dragging = true;
    const point = this.dragPoint(active);
    dragger.region.onDrag?.onStart?.(point);
    dragger.region.onDrag?.onMove(point);
  }

  private pointerUp(gesture: PointerGesture): void {
    const active = this.gestures.get(gesture.pointerId);
    if (active === undefined) return;
    this.gestures.delete(gesture.pointerId);
    active.x = gesture.x;
    active.y = gesture.y;
    if (active.owner.kind === 'world') {
      // Something opened over the point since the down (a level-up during a
      // touch): the world keeps its gesture but must not act on the release.
      if (this.openedOverSince(gesture.x, gesture.y, active.openCounterAtDown)) {
        this.toWorld({ ...gesture, kind: 'cancel' }, false);
        return;
      }
      const travelled = Math.hypot(active.x - active.startX, active.y - active.startY);
      this.toWorld(gesture, travelled <= TAP_SLOP);
      return;
    }
    this.released(active, gesture, false);
    if (active.owner.kind !== 'region' || active.pressed) return;
    if (active.dragging) {
      this.findRegion(active.owner)?.region.onDrag?.onEnd?.(this.dragPoint(active), false);
      return;
    }
    const region = this.canTap(active.owner, gesture.x, gesture.y);
    if (region === null) return;
    if (active.button !== PRIMARY_BUTTON) {
      region.onSecondaryTap?.({
        x: gesture.x,
        y: gesture.y,
        button: active.button,
        source: active.source,
        timeStamp: gesture.timeStamp,
        pointerId: active.pointerId,
      });
      return;
    }
    if (region.disabled) {
      this.play(UI_ERROR_SOUND);
      return;
    }
    if (region.onTap === undefined) return;
    region.onTap({
      x: gesture.x,
      y: gesture.y,
      button: active.button,
      source: active.source,
      timeStamp: gesture.timeStamp,
      pointerId: active.pointerId,
    });
    this.play(region.sound);
  }

  /** Whether a surface that opened after `openCounter` now covers the point. */
  private openedOverSince(x: number, y: number, openCounter: number): boolean {
    const target = this.targetAt(x, y);
    if (target === null) return false;
    if (target.kind === 'pending') return true;
    const owner = this.stack.find((entry) => entry.surface.id === target.region.surfaceId);
    return owner !== undefined && owner.openSeq > openCounter;
  }

  private pointerCancel(gesture: PointerGesture): void {
    const active = this.gestures.get(gesture.pointerId);
    if (active === undefined) return;
    this.gestures.delete(gesture.pointerId);
    if (active.owner.kind === 'world') {
      this.toWorld(gesture, false);
      return;
    }
    this.released(active, gesture, true);
    if (active.owner.kind === 'region' && active.dragging) {
      this.findRegion(active.owner)?.region.onDrag?.onEnd?.(this.dragPoint(active), true);
    }
  }

  private pointerWheel(gesture: PointerGesture): void {
    const target = this.targetAt(gesture.x, gesture.y);
    if (target === null) {
      this.toWorld(gesture, false);
      return;
    }
    if (target.kind === 'pending') return;
    for (let index = target.index; index >= 0; index--) {
      const region = this.frozen[index];
      if (region.surfaceId !== target.region.surfaceId) continue;
      if (region.layer < target.region.layer) return;
      if (region.onWheel === undefined || !contains(region.rect, gesture.x, gesture.y)) continue;
      region.onWheel(gesture.deltaY);
      return;
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  /**
   * Routes one keydown: the key hooks, then the topmost surface's `onKey` (down to the first
   * panel/modal/system surface that halts the world or locks the keyboard), then focus
   * navigation and activation, then Escape.
   */
  key(key: string, mods: KeyModifiers = {}): KeyOutcome {
    this.refreshStack();
    if (mods.repeat !== true) this.keysStruckForRing.add(key);
    const typingText = this.mounted.some(
      (entry) => entry.surface.takesText === true && entry.surface.isOpen(),
    );
    if (!typingText) {
      for (const hook of this.keyHooks) {
        if (hook(key, mods)) return 'consumed';
      }
    }
    for (let index = this.stack.length - 1; index >= 0; index--) {
      const entry = this.stack[index];
      const surface = entry.surface;
      if (surface.onKey?.(key, mods) === true) return 'consumed';
      // A menu that floats over live play (an achievement card) keeps only the
      // keys it took; the rest reach whatever menu it floats over.
      const floats = !surface.haltsWorld && surface.locksKeyboard !== true;
      if (FOCUS_BANDS.has(surface.band) && !floats) break;
    }
    if (this.focusKey(key, mods)) return 'consumed';
    if (key === 'Escape') {
      // A held Escape closes one surface, not one per auto-repeat.
      if (mods.repeat === true) return 'gameplay';
      return this.escape() ? 'consumed' : 'gameplay';
    }
    return this.keyboardLocked() ? 'blocked' : 'gameplay';
  }

  /**
   * Adds a hook that sees every key before any surface does, for world input
   * that must win over open menus (a timed press graded at its keydown). It is
   * skipped while a `takesText` surface is open. Returns a function that
   * removes it.
   */
  addKeyHook(hook: (key: string, mods: KeyModifiers) => boolean): () => void {
    this.keyHooks.push(hook);
    return () => {
      const index = this.keyHooks.indexOf(hook);
      if (index !== -1) this.keyHooks.splice(index, 1);
    };
  }

  /**
   * Closes the topmost open surface that has `close`. Returns true when the
   * key was spent: a surface closed, or a `blocksEscape` surface stopped it.
   * False means nothing claimed it and the scene should handle it (pause).
   */
  escape(): boolean {
    this.refreshStack();
    for (let index = this.stack.length - 1; index >= 0; index--) {
      const entry = this.stack[index];
      const layerEscape = this.frozenLayers.get(entry.surface.id)?.onEscape ?? null;
      if (layerEscape !== null) {
        layerEscape();
        this.frozenLayers.delete(entry.surface.id);
        return true;
      }
      if (entry.surface.blocksEscape === true) return true;
      if (entry.surface.close !== undefined && entry.surface.wantsEscape?.() !== false) {
        entry.surface.close();
        this.refreshStack();
        return true;
      }
    }
    return false;
  }

  /** The scope's focusable regions, in registration order. */
  private focusRing(): IndexedRegion[] {
    const scopeId = this.focusScopeId;
    if (scopeId === null) return [];
    const ring: IndexedRegion[] = [];
    const top = this.topLayer(scopeId);
    this.frozen.forEach((region, index) => {
      if (region.surfaceId !== scopeId || !region.focusable || region.layer < top) return;
      ring.push({ region, index });
    });
    return ring;
  }

  /** Whether the focus scope keeps the keyboard from play: it halts the world or locks the keys. */
  private scopeOwnsKeyboard(): boolean {
    const scope = this.stack.find((entry) => entry.surface.id === this.focusScopeId);
    if (scope === undefined) return false;
    return scope.surface.haltsWorld || scope.surface.locksKeyboard === true;
  }

  /** The focused entry if it is still in the ring, else null. */
  private liveFocus(ring: readonly IndexedRegion[]): IndexedRegion | null {
    const focused = this.focused;
    if (focused === null) return null;
    return ring.find((entry) => sameRef(this.refAt(entry.index), focused)) ?? null;
  }

  private focusKey(key: string, mods: KeyModifiers): boolean {
    const isTab = key === 'Tab';
    const direction = ARROW_DIRECTIONS[key];
    const isActivate = ACTIVATE_KEYS.has(key);
    if (!isActivate && !isTab && direction === undefined) return false;
    // While the keyboard belongs to play these are gameplay keys (Space attacks,
    // Tab switches crawler, Enter opens chat, arrows walk), so a surface that
    // leaves the keyboard to play never takes them. One that locks it would
    // only block them, so they drive its focus instead.
    if (!this.scopeOwnsKeyboard()) return false;
    const ring = this.focusRing();
    if (isActivate) return this.activateFocused(ring, mods);
    if (ring.length === 0) return false;
    if (mods.predatesSurface === true) return true;
    if (mods.repeat === true && !this.keysStruckForRing.has(key)) return true;
    if (!this.allowFocusStep(mods)) return true;
    const current = this.liveFocus(ring);
    let next: IndexedRegion | null;
    if (current === null) {
      next = ring.find((entry) => entry.region.primary) ?? ring[0];
    } else if (isTab) {
      next = ringStep(ring, current, mods.shift === true ? -1 : 1);
    } else if (direction === undefined) {
      next = null;
    } else {
      // A row that wraps (a conversation's choices) has nothing to the right of
      // its last button on the first line; ring order still reaches the rest.
      const ringOrderStep = direction === 'left' || direction === 'up' ? -1 : 1;
      next = nearestInDirection(current, ring, direction) ?? ringStep(ring, current, ringOrderStep);
    }
    if (next !== null) {
      this.focused = this.refAt(next.index);
      this.focusVisible = true;
    }
    return true;
  }

  private allowFocusStep(mods: KeyModifiers): boolean {
    const at = mods.timeStamp ?? this.clock();
    if (mods.repeat === true && at - this.lastFocusStepAtMs < FOCUS_REPEAT_INTERVAL_MS) {
      return false;
    }
    this.lastFocusStepAtMs = at;
    return true;
  }

  /** The scope's primary region, enabled or not: a disabled primary still answers Enter with the error cue. */
  private scopePrimary(): HitRegion | null {
    const scopeId = this.focusScopeId;
    if (scopeId === null) return null;
    const top = this.topLayer(scopeId);
    return (
      this.frozen.find(
        (region) => region.surfaceId === scopeId && region.primary && region.layer >= top,
      ) ?? null
    );
  }

  /**
   * Activates the focused control while the focus ring is showing; otherwise
   * (no keyboard navigation yet, or a pointer press since) the primary one.
   */
  private activateFocused(ring: readonly IndexedRegion[], mods: KeyModifiers): boolean {
    const focusedEntry = this.focusVisible ? this.liveFocus(ring) : null;
    const target = focusedEntry?.region ?? this.scopePrimary();
    if (target === null) return false;
    // One press, one activation: a held accept key, or one already down when
    // this surface appeared, is swallowed without acting.
    if (mods.repeat === true || mods.predatesSurface === true) return true;
    if (target.disabled) {
      this.play(UI_ERROR_SOUND);
      return true;
    }
    if (target.onTap === undefined) return false;
    const point = centre(target.rect);
    target.onTap({
      x: point.x,
      y: point.y,
      button: PRIMARY_BUTTON,
      source: 'keyboard',
      timeStamp: mods.timeStamp,
    });
    this.play(target.sound);
    return true;
  }
}

function sameRef(a: RegionRef, b: RegionRef): boolean {
  return a.regionId === b.regionId && a.occurrence === b.occurrence;
}

function ringStep(
  ring: readonly IndexedRegion[],
  from: IndexedRegion,
  step: 1 | -1,
): IndexedRegion | null {
  const position = ring.indexOf(from);
  return ring[(position + step + ring.length) % ring.length] ?? null;
}

function nearestInDirection(
  from: IndexedRegion,
  ring: readonly IndexedRegion[],
  direction: Direction,
): IndexedRegion | null {
  const origin = centre(from.region.rect);
  let best: IndexedRegion | null = null;
  let bestScore = Infinity;
  for (const candidate of ring) {
    if (candidate === from) continue;
    const point = centre(candidate.region.rect);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    let along: number;
    let across: number;
    switch (direction) {
      case 'up':
        along = -dy;
        across = dx;
        break;
      case 'down':
        along = dy;
        across = dx;
        break;
      case 'left':
        along = -dx;
        across = dy;
        break;
      case 'right':
        along = dx;
        across = dy;
        break;
    }
    if (along <= 0) continue;
    const score = along + CROSS_AXIS_WEIGHT * Math.abs(across);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

interface FrameShared {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: Theme;
  readonly viewport: UiViewport;
  readonly now: number;
  readonly hovered: readonly RegionRef[];
  readonly mousePos: { readonly x: number; readonly y: number } | null;
  readonly building: HitRegion[];
  readonly layers: Map<string, { depth: number; onEscape: (() => void) | null }>;
  readonly overlays: QueuedOverlay[];
  readonly store: UiStateStore;
}

/** An overlay draw waiting for every surface to finish. */
interface QueuedOverlay {
  readonly context: SurfaceContext;
  readonly draw: () => void;
}

/** The `Ui` one surface renders with for one frame. */
class SurfaceContext implements Ui {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: Theme;
  readonly viewport: Rect;
  readonly screen: Rect;
  readonly size: SizeClass;
  readonly density: Density;
  readonly uiScale: number;
  readonly now: number;
  readonly surfaceId: string;
  readonly openedAt: number;
  readonly pointer: { readonly x: number; readonly y: number } | null;
  private readonly band: Band;
  private readonly idsThisFrame = new Set<string>();
  /** How many regions each id has registered this frame: the next one's occurrence. */
  private readonly occurrences = new Map<string, number>();
  private blockCount = 0;
  private clipStack: (Rect | null)[];
  private deferred: (() => void)[] = [];
  private layerDepth = 0;
  private paintingOverlay = false;
  /** The transform the surface starts from; regions are mapped from the live transform back into it. */
  private readonly baseInverse: DOMMatrix;
  private readonly baseTransform: DOMMatrix;
  private readonly baseAlpha: number;

  constructor(
    private readonly root: UiRoot,
    entry: MountedSurface,
    /** @internal Position in the frame's bottom-to-top stack. */
    readonly stackIndex: number,
    private readonly shared: FrameShared,
  ) {
    this.ctx = shared.ctx;
    this.theme = shared.theme;
    this.viewport = shared.viewport.safe;
    this.screen = shared.viewport.screen;
    this.size = shared.viewport.size;
    this.density = shared.viewport.density;
    this.uiScale = shared.viewport.uiScale;
    this.now = shared.now;
    this.surfaceId = entry.surface.id;
    this.openedAt = entry.openedAt;
    this.band = entry.surface.band;
    this.pointer = shared.mousePos;
    this.clipStack = [shared.viewport.screen];
    this.baseTransform = shared.ctx.getTransform();
    this.baseInverse = this.baseTransform.inverse();
    this.baseAlpha = shared.ctx.globalAlpha;
  }

  /**
   * `rect` as drawn under the live transform, in the surface's own units. An
   * opening panel scales or slides its content; its hit rects have to be where
   * the player sees them, not where they will settle.
   */
  private toSurface(rect: Rect): Rect {
    const m = this.baseInverse.multiply(this.ctx.getTransform());
    const x1 = m.a * rect.x + m.c * rect.y + m.e;
    const y1 = m.b * rect.x + m.d * rect.y + m.f;
    const x2 = m.a * (rect.x + rect.w) + m.c * (rect.y + rect.h) + m.e;
    const y2 = m.b * (rect.x + rect.w) + m.d * (rect.y + rect.h) + m.f;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  get clipRect(): Rect | null {
    return this.clipStack[this.clipStack.length - 1] ?? null;
  }

  private register(widgetId: string, rect: Rect, handlers: HitHandlers): RegionRef | null {
    const id = `${this.surfaceId}/${widgetId}`;
    if (this.paintingOverlay) {
      this.root.warnOnce(
        `${id}#overlay`,
        `UiRoot: overlay in surface "${this.surfaceId}" tried to register "${widgetId}"; overlays take no input`,
      );
      return null;
    }
    if (this.idsThisFrame.has(id)) {
      this.root.warnOnce(
        id,
        `UiRoot: two regions in surface "${this.surfaceId}" share the id "${widgetId}"`,
      );
    }
    this.idsThisFrame.add(id);
    const clip = this.clipRect;
    const visible = clip === null ? null : intersect(this.toSurface(rect), clip);
    if (visible === null) return null;
    if (handlers.hoverOnly === true) return this.registerHoverOnly(id, visible);
    const disabled = handlers.disabled === true;
    this.shared.building.push({
      surfaceId: this.surfaceId,
      id,
      rect: visible,
      band: this.band,
      onTap: disabled ? undefined : handlers.onTap,
      onPress: disabled ? undefined : handlers.onPress,
      onDown: disabled ? undefined : handlers.onDown,
      onRelease: disabled ? undefined : handlers.onRelease,
      onSecondaryTap: disabled ? undefined : handlers.onSecondaryTap,
      onDrag: disabled ? undefined : handlers.onDrag,
      dragSlop: handlers.dragSlop ?? TAP_SLOP,
      onWheel: handlers.onWheel,
      onOutsideDown: handlers.onOutsideDown,
      focusable: handlers.focusable ?? (!disabled && handlers.onTap !== undefined),
      primary: handlers.primary === true,
      disabled,
      sound: handlers.sound === undefined ? UI_TAP_SOUND : handlers.sound,
      hoverOnly: false,
      layer: this.layerDepth,
    });
    return this.nextRef(id);
  }

  private registerHoverOnly(id: string, rect: Rect): RegionRef {
    this.shared.building.push({
      surfaceId: this.surfaceId,
      id,
      rect,
      band: this.band,
      dragSlop: TAP_SLOP,
      focusable: false,
      primary: false,
      disabled: false,
      sound: null,
      hoverOnly: true,
      layer: this.layerDepth,
    });
    return this.nextRef(id);
  }

  private nextRef(id: string): RegionRef {
    const occurrence = this.occurrences.get(id) ?? 0;
    this.occurrences.set(id, occurrence + 1);
    return { regionId: id, occurrence };
  }

  /** @internal The scrim block registered before a modal renders. */
  registerBlock(widgetId: string, rect: Rect): void {
    this.register(widgetId, rect, { focusable: false });
  }

  hit(id: string, rect: Rect, handlers: HitHandlers): HitState {
    const registered = this.register(id, rect, handlers);
    if (registered === null) return NO_HIT;
    return this.root.regionState(registered, this.toSurface(rect), this.shared.hovered);
  }

  block(rect: Rect): void {
    this.blockCount++;
    this.register(`__block${this.blockCount}`, rect, { focusable: false });
  }

  clip<T>(rect: Rect, draw: () => T): T {
    const outer = this.clipRect;
    const inner = outer === null ? null : intersect(outer, this.toSurface(rect));
    this.clipStack.push(inner);
    // The canvas clip is set in local units (it intersects nested clips itself); the stack holds surface units for hit tests.
    const drawn = inner === null ? { x: rect.x, y: rect.y, w: 0, h: 0 } : rect;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(drawn.x, drawn.y, drawn.w, drawn.h);
    this.ctx.clip();
    try {
      return draw();
    } finally {
      this.ctx.restore();
      this.clipStack.pop();
    }
  }

  state<T>(slot: UiStateSlot<T>, id: string, init?: () => T): T {
    return this.shared.store.get(this.surfaceId, slot, id, init);
  }

  setState<T>(slot: UiStateSlot<T>, id: string, value: T): void {
    this.shared.store.set(this.surfaceId, slot, id, value);
  }

  tween(id: string, target: number, opts: Partial<TweenOptions> = {}): number {
    return this.shared.store.tween(this.surfaceId, id, target, this.now, {
      ms: opts.ms ?? motion.base,
      from: opts.from,
    });
  }

  playSound(id: SoundId): void {
    this.root.play(id);
  }

  defer(draw: () => void): void {
    this.deferred.push(draw);
  }

  overlay(draw: () => void): void {
    this.shared.overlays.push({ context: this, draw });
  }

  layer(opts: { readonly onEscape?: () => void } = {}): void {
    this.layerDepth++;
    this.shared.layers.set(this.surfaceId, {
      depth: this.layerDepth,
      onEscape: opts.onEscape ?? null,
    });
  }

  focus(id: string): void {
    this.root.focusRegion(this.surfaceId, `${this.surfaceId}/${id}`);
  }

  /** @internal Runs the deferred draws in order; a deferred draw may defer again. */
  flushDeferred(): void {
    const outerClips = this.clipStack;
    this.clipStack = [this.shared.viewport.screen];
    // The array iterator re-reads the length each step, so draws deferred from a deferred draw still run.
    for (const draw of this.deferred) draw();
    this.deferred = [];
    this.clipStack = outerClips;
  }

  /** @internal Paints one queued overlay from the surface's starting canvas state, refusing any region it registers. */
  paintOverlay(queued: QueuedOverlay): void {
    this.ctx.setTransform(this.baseTransform);
    this.ctx.globalAlpha = this.baseAlpha;
    this.paintingOverlay = true;
    try {
      queued.draw();
      this.flushDeferred();
    } finally {
      this.paintingOverlay = false;
    }
  }
}
