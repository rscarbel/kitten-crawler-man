/**
 * A count of render frames, advanced once per frame by the scene manager.
 *
 * What a cache needs to tell "drawn this frame" from "drawn a while ago"
 * without each one hooking the frame boundary itself. A harness that renders
 * without the scene manager never advances it, so every entry it draws stays
 * "drawn this frame" and nothing keyed on it is ever let go.
 */
let frame = 0;

/**
 * Render frames during which nothing held the idle clock; see
 * {@link holdIdleClock}.
 */
let idleFrame = 0;
let idleClockHolds = 0;

export function beginRenderFrame(): void {
  frame += 1;
  if (idleClockHolds === 0) idleFrame += 1;
}

export function renderFrameNumber(): number {
  return frame;
}

/**
 * The frame count a cache's idle release measures age by: render frames,
 * less those spent while something held the clock. Art not drawn while the
 * world is covered, or while the party is inside a building with the floor
 * outside waiting for it, is waiting rather than abandoned.
 */
export function idleFrameNumber(): number {
  return idleFrame;
}

/**
 * Stops the idle clock until a matching {@link releaseIdleClock}. Holds
 * nest, so a loading screen inside a building releases only its own.
 */
export function holdIdleClock(): void {
  idleClockHolds += 1;
}

export function releaseIdleClock(): void {
  idleClockHolds = Math.max(0, idleClockHolds - 1);
}
