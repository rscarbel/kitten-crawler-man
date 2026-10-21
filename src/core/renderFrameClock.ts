/**
 * A count of render frames, advanced once per frame by the scene manager.
 *
 * What a cache needs to tell "drawn this frame" from "drawn a while ago"
 * without each one hooking the frame boundary itself. A harness that renders
 * without the scene manager never advances it, so every entry it draws stays
 * "drawn this frame" and nothing keyed on it is ever let go.
 */
let frame = 0;

export function beginRenderFrame(): void {
  frame += 1;
}

export function renderFrameNumber(): number {
  return frame;
}
