/**
 * Mounts a `Conversation` on a headless `UiRoot` sized to the live viewport,
 * so a script drives it the way a scene does: frames, keys, and mouse
 * gestures given in canvas CSS pixels.
 */

import { viewportHeight, viewportWidth } from '../src/core/Viewport';
import type { Conversation, ConversationSurfaceOptions } from '../src/dialog/Conversation';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON, type GestureKind } from '../src/ui/core/pointer';
import { UiRoot, type KeyModifiers, type KeyOutcome } from '../src/ui/core/UiRoot';
import type { UiSize } from '../src/core/Settings';
import { NO_INSETS } from '../src/ui/core/viewport';

const FRAME_MS = 16;

/** The id the harness mounts the conversation under. */
export const CONVERSATION_RIG_SURFACE_ID = 'conversation';

export interface ConversationRig {
  readonly root: UiRoot;
  /** Draws one frame of the stack, which is when the conversation lays out and registers its regions. */
  frame(): void;
  key(key: string, mods?: KeyModifiers): KeyOutcome;
  /** Rests the mouse on a canvas point, or takes it off the canvas with `null`. */
  pointAt(point: { readonly x: number; readonly y: number } | null): void;
  /** A mouse click at a canvas point. */
  tap(x: number, y: number): void;
  /** How many regions the conversation put in the keyboard focus ring last frame. */
  focusRingSize(): number;
}

export function mountConversation(
  conversation: Conversation,
  ctx: CanvasRenderingContext2D,
  opts: ConversationSurfaceOptions & { readonly uiSize?: UiSize } = {},
): ConversationRig {
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: viewportWidth(),
      cssHeight: viewportHeight(),
      density: 'pointer',
      uiSize: opts.uiSize ?? 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  root.mount(conversation.surface({ ...opts, id: CONVERSATION_RIG_SURFACE_ID }));
  const gesture = (kind: GestureKind, x: number, y: number): void =>
    root.pointer({
      kind,
      pointerId: MOUSE_POINTER_ID,
      source: 'mouse',
      x: x / root.uiScale,
      y: y / root.uiScale,
      cssX: x,
      cssY: y,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  return {
    root,
    frame: () => {
      clock += FRAME_MS;
      root.frame(ctx);
    },
    key: (key, mods = {}) => root.key(key, mods),
    pointAt: (point) => {
      if (point === null) root.pointerLeft();
      else gesture('move', point.x, point.y);
    },
    tap: (x, y) => {
      gesture('down', x, y);
      gesture('up', x, y);
    },
    focusRingSize: () =>
      root
        .regions()
        .filter((region) => region.surfaceId === CONVERSATION_RIG_SURFACE_ID && region.focusable)
        .length,
  };
}
