/**
 * Draws that must land over the dungeon's darkness although they are made
 * from inside the Y-sorted entity pass: a mob's health bar, its tactics rank
 * mark, its aggro "!", status art, quest markers, spit in flight.
 *
 * A creature paints its body and its chrome in one `drawSelf`, and the
 * darkness has to fall between the two — over the body, under the
 * information. While the scene has deferral open, the chrome is queued here
 * instead of drawn, and the scene flushes the queue straight after the
 * darkness pass. With deferral closed (any scene without dungeon lighting)
 * every request draws at once.
 *
 * The queue's entries are pooled, and a creature defers a part of itself by
 * name rather than by a fresh closure, so a frame full of creatures costs no
 * allocation.
 */

/** The parts of a creature drawn over the darkness. */
export type ChromePart =
  | 'worldFeedback'
  | 'healthBar'
  | 'knockedOut'
  | 'mobHealthBar'
  | 'aggro'
  | 'acidSpits'
  | 'swineGroundTells'
  | 'swineStoppedWarning';

/** Something that can draw a named part of itself over the darkness. */
export interface AboveDarknessDrawer {
  drawAboveDarkness(
    ctx: CanvasRenderingContext2D,
    part: ChromePart,
    a: number,
    b: number,
    c: number,
  ): void;
}

type DeferredDraw = (ctx: CanvasRenderingContext2D) => void;

interface Entry {
  drawer: AboveDarknessDrawer | null;
  draw: DeferredDraw | null;
  part: ChromePart;
  a: number;
  b: number;
  c: number;
}

const queue: Entry[] = [];
let queued = 0;
let deferring = false;
/** How dark the world is at a point, while deferring; see {@link beginAboveDarkness}. */
const NO_DARKNESS = (): number => 0;
let darknessAt: (worldX: number, worldY: number) => number = NO_DARKNESS;

function nextEntry(): Entry {
  if (queued >= queue.length) {
    queue.push({ drawer: null, draw: null, part: 'healthBar', a: 0, b: 0, c: 0 });
  }
  const entry = queue[queued];
  queued++;
  return entry;
}

/**
 * Starts queueing chrome drawn from the entity pass, until
 * {@link flushAboveDarkness}. `darkness` says how dark the world is at a
 * point, for {@link deferChromeWhereDark}.
 */
export function beginAboveDarkness(darkness: (worldX: number, worldY: number) => number): void {
  closeAboveDarkness();
  deferring = true;
  darknessAt = darkness;
}

/**
 * Stops deferring and drops anything still queued, undrawn. The scene manager
 * calls this at every frame boundary: a painter that throws between
 * {@link beginAboveDarkness} and {@link flushAboveDarkness} skips the flush,
 * and the render loop survives the throw, so without it deferral would stay
 * open into the next scene — and a town, which never flushes, would queue
 * every health bar it drew and never show one.
 */
export function closeAboveDarkness(): void {
  deferring = false;
  darknessAt = NO_DARKNESS;
  for (let index = 0; index < queued; index++) {
    const entry = queue[index];
    entry.drawer = null;
    entry.draw = null;
  }
  queued = 0;
}

/**
 * {@link deferChrome} for floor tells, which belong under the body that casts
 * them: held back over the darkness only where the world at (`worldX`,
 * `worldY`) is actually darkened, so a lit room keeps its own draw order.
 */
export function deferChromeWhereDark(
  drawer: AboveDarknessDrawer,
  part: ChromePart,
  worldX: number,
  worldY: number,
  a: number,
  b: number,
  c = 0,
): boolean {
  if (!deferring || darknessAt(worldX, worldY) <= 0) return false;
  return deferChrome(drawer, part, a, b, c);
}

/**
 * Queues a part of `drawer` for after the darkness pass, or reports false
 * when nothing is deferring, in which case the caller draws at once.
 */
export function deferChrome(
  drawer: AboveDarknessDrawer,
  part: ChromePart,
  a: number,
  b: number,
  c = 0,
): boolean {
  if (!deferring) return false;
  const entry = nextEntry();
  entry.drawer = drawer;
  entry.draw = null;
  entry.part = part;
  entry.a = a;
  entry.b = b;
  entry.c = c;
  return true;
}

/**
 * Queues `draw` for after the darkness pass, or reports false when nothing is
 * deferring. For the rare free-standing draw — a quest marker —
 * that has no drawer of its own; a creature's parts go through
 * {@link deferChrome}.
 */
export function deferAboveDarkness(draw: DeferredDraw): boolean {
  if (!deferring) return false;
  const entry = nextEntry();
  entry.drawer = null;
  entry.draw = draw;
  return true;
}

/** Whether chrome is being queued right now. */
export function isDeferringAboveDarkness(): boolean {
  return deferring;
}

/** Draws everything queued since {@link beginAboveDarkness}, in order, and stops deferring. */
export function flushAboveDarkness(ctx: CanvasRenderingContext2D): void {
  deferring = false;
  for (let index = 0; index < queued; index++) {
    const entry = queue[index];
    if (entry.drawer !== null) {
      entry.drawer.drawAboveDarkness(ctx, entry.part, entry.a, entry.b, entry.c);
    } else {
      entry.draw?.(ctx);
    }
    entry.drawer = null;
    entry.draw = null;
  }
  queued = 0;
}
