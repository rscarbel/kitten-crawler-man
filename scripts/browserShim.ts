/**
 * Just enough of a browser to construct the game's real `SceneManager` and run
 * real scenes headless: a `window` and `document` that record their listeners
 * (so a harness can both dispatch keys through them and count what is left
 * registered), a canvas element backed by `node-canvas`, a captured
 * `requestAnimationFrame` the harness ticks by hand, and an in-memory
 * `localStorage`.
 *
 * Install before the first game module is imported: several of them read
 * `window` or `document` at load time.
 */

import { Image, createCanvas } from 'canvas';

import './nodeUiFont.js';

/** One registered listener, kept in registration order as the DOM does. */
interface ListenerEntry {
  readonly type: string;
  readonly listener: unknown;
  readonly capture: boolean;
}

function captureFlag(options: unknown): boolean {
  if (typeof options === 'boolean') return options;
  if (typeof options === 'object' && options !== null)
    return Reflect.get(options, 'capture') === true;
  return false;
}

/**
 * An event target that remembers every listener, dispatches capture listeners
 * before bubble ones, and honours `stopPropagation` between them.
 */
export class RecordingEventTarget {
  private readonly entries: ListenerEntry[] = [];

  addEventListener(type: string, listener: unknown, options?: unknown): void {
    const capture = captureFlag(options);
    const exists = this.entries.some(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
    );
    if (!exists) this.entries.push({ type, listener, capture });
  }

  removeEventListener(type: string, listener: unknown, options?: unknown): void {
    const capture = captureFlag(options);
    const index = this.entries.findIndex(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
    );
    if (index !== -1) this.entries.splice(index, 1);
  }

  /** Listeners currently registered, by event type. */
  listenerCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entry of this.entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    return counts;
  }

  get listenerTotal(): number {
    return this.entries.length;
  }

  /** Delivers `event` to every listener for its type, capture phase first. */
  dispatch(event: ShimEvent): void {
    const matching = this.entries.filter((entry) => entry.type === event.type);
    const ordered = [
      ...matching.filter((entry) => entry.capture),
      ...matching.filter((entry) => !entry.capture),
    ];
    for (const entry of ordered) {
      if (event.propagationStopped) return;
      const listener = entry.listener;
      if (typeof listener === 'function') {
        Reflect.apply(listener, undefined, [event]);
      } else if (typeof listener === 'object' && listener !== null) {
        const handleEvent: unknown = Reflect.get(listener, 'handleEvent');
        if (typeof handleEvent === 'function') Reflect.apply(handleEvent, listener, [event]);
      }
    }
  }
}

/** One finger of a touch event: the fields the scenes' touch handlers read. */
export interface ShimTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** The fields the game's handlers read off a keyboard, mouse or touch event. */
/** Keyboard state a {@link ShimEvent} can carry beyond its `key`. */
export interface ShimKeyInit {
  /** The physical key; defaults to `key`. */
  readonly code?: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

export class ShimEvent {
  propagationStopped = false;
  defaultPrevented = false;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly code: string;
  readonly button = 0;
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY = 0;
  readonly touches: readonly ShimTouch[] = [];

  /**
   * @param changedTouches the fingers a touch event reports as having come
   *   down, moved or lifted; empty for keyboard and mouse events.
   */
  constructor(
    readonly type: string,
    readonly key: string,
    readonly timeStamp: number,
    position: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
    readonly changedTouches: readonly ShimTouch[] = [],
    keyInit: ShimKeyInit = {},
  ) {
    this.clientX = position.x;
    this.clientY = position.y;
    this.code = keyInit.code ?? key;
    this.repeat = keyInit.repeat ?? false;
    this.ctrlKey = keyInit.ctrlKey ?? false;
    this.metaKey = keyInit.metaKey ?? false;
    this.altKey = keyInit.altKey ?? false;
    this.shiftKey = keyInit.shiftKey ?? false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this.propagationStopped = true;
  }
}

/** A `<canvas>` element: a node canvas plus the element surface the game touches. */
function canvasElement(): unknown {
  const canvas = createCanvas(1, 1);
  const events = new RecordingEventTarget();
  return Object.assign(canvas, {
    style: {},
    tabIndex: 0,
    events,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      events.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      events.removeEventListener(type, listener, options),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: canvas.width, bottom: canvas.height }),
    focus: () => undefined,
    blur: () => undefined,
  });
}

function inertElement(): unknown {
  const events = new RecordingEventTarget();
  return {
    style: {},
    appendChild: () => undefined,
    removeChild: () => undefined,
    remove: () => undefined,
    focus: () => undefined,
    blur: () => undefined,
    setAttribute: () => undefined,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      events.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      events.removeEventListener(type, listener, options),
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

export interface BrowserShim {
  readonly window: RecordingEventTarget;
  readonly document: RecordingEventTarget;
  /** Runs the frame callback the game last armed, at `timeMs`. Returns false if none was armed. */
  runAnimationFrame(timeMs: number): boolean;
  /** Frame callbacks armed and not yet run. */
  readonly pendingAnimationFrames: () => number;
}

/**
 * Installs the shim on `globalThis` and returns the handles a harness drives
 * it through.
 */
const COARSE_POINTER_FEATURE = 'pointer: coarse';

function hasTouchNavigator(): boolean {
  const nav: unknown = Reflect.get(globalThis, 'navigator');
  if (typeof nav !== 'object' || nav === null) return false;
  const touchPoints: unknown = Reflect.get(nav, 'maxTouchPoints');
  return typeof touchPoints === 'number' && touchPoints > 0;
}

export function installBrowserShim(viewport: {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}): BrowserShim {
  const windowTarget = new RecordingEventTarget();
  const documentTarget = new RecordingEventTarget();
  let armed: Array<(time: number) => void> = [];
  let nextHandle = 1;

  const requestAnimationFrame = (callback: (time: number) => void): number => {
    armed.push(callback);
    return nextHandle++;
  };

  const documentShim = {
    hidden: false,
    visibilityState: 'visible',
    body: inertElement(),
    documentElement: inertElement(),
    activeElement: null,
    hasFocus: () => true,
    createElement: (tag: string) => (tag === 'canvas' ? canvasElement() : inertElement()),
    getElementById: () => inertElement(),
    querySelector: () => null,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      documentTarget.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      documentTarget.removeEventListener(type, listener, options),
  };

  const windowShim = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    devicePixelRatio: viewport.devicePixelRatio,
    location: { search: '', hostname: 'localhost', href: 'http://localhost/', pathname: '/' },
    // A harness that makes `navigator` look like a phone gets a phone's coarse
    // pointer too, so the UI picks touch density there as it would on the device.
    matchMedia: (query: string) => ({
      matches: query.includes(COARSE_POINTER_FEATURE) && hasTouchNavigator(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    requestAnimationFrame,
    cancelAnimationFrame: () => undefined,
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      windowTarget.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      windowTarget.removeEventListener(type, listener, options),
  };

  Object.assign(globalThis, {
    Image,
    HTMLImageElement: Image,
    window: windowShim,
    document: documentShim,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    requestAnimationFrame,
    cancelAnimationFrame: () => undefined,
    addEventListener: windowShim.addEventListener,
    removeEventListener: windowShim.removeEventListener,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    devicePixelRatio: viewport.devicePixelRatio,
  });

  return {
    window: windowTarget,
    document: documentTarget,
    runAnimationFrame(timeMs: number): boolean {
      const callbacks = armed;
      armed = [];
      for (const callback of callbacks) callback(timeMs);
      return callbacks.length > 0;
    },
    pendingAnimationFrames: () => armed.length,
  };
}
