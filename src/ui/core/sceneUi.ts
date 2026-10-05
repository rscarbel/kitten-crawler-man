/**
 * What a scene needs to stand up its `UiRoot`, so the scenes that share this setup cannot
 * drift apart on it.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { UiRoot, type WorldGesture } from './UiRoot';
import { browserViewportInput } from './viewport';

export interface SceneUiOptions {
  readonly audio: AudioManager | null;
  /** Every gesture no surface claimed on down. */
  readonly handleWorldPointer: (gesture: WorldGesture) => void;
}

/** A `UiRoot` reading the live browser viewport, for a scene to mount its surfaces on. */
export function createSceneUi(options: SceneUiOptions): UiRoot {
  return new UiRoot({
    audio: options.audio,
    viewport: browserViewportInput,
    handleWorldPointer: options.handleWorldPointer,
  });
}

/** The mouse in canvas CSS pixels, or null while it is off the canvas. */
export function sceneMouse(ui: UiRoot): { x: number; y: number; down: boolean } | null {
  const mouse = ui.mouse;
  if (mouse === null) return null;
  const scale = ui.uiScale;
  return { x: mouse.x * scale, y: mouse.y * scale, down: mouse.down };
}
