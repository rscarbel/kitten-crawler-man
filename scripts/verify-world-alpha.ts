/**
 * World painters that draw inside a faded parent keep the parent's fade:
 * `worldText` and `worldBar` set `globalAlpha` outright, so a caller that has
 * multiplied a fade into the context must hand that alpha on.
 *
 *  - an item icon drawn at a quarter alpha draws its stack-count badge at a
 *    quarter alpha too, not at full strength over a ghosted icon;
 *  - Mongo's health bar on the explainer's health page fades with him as he
 *    is recalled.
 *
 *   npm run verify:world-alpha
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';

installCanvasGlobals();

const { drawItemIcon } = await import('../src/ui/icons/drawItemIcon.js');
const { ITEM_DEF } = await import('../src/core/ItemDefs.js');
const { drawHealthPage } = await import('../src/ui/icons/explainerArt/mongoArt.js');
const { WORLD_BAR } = await import('../src/ui/theme/worldInk.js');

const CANVAS_SIZE = 400;
const ICON_SIZE = 64;
const ICON_ALPHA = 0.25;
const STACK_QUANTITY = 5;
/** Comfortably past the explainer's health-page loop. */
const HEALTH_PAGE_FRAMES = 600;
const ALPHA_TOLERANCE = 1e-6;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

interface Recorded {
  readonly call: string;
  readonly alpha: number;
  readonly fill: string;
  readonly text: string | null;
}

/** A real context that records the alpha and fill colour each fill and fillText ran with. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Recorded[] } {
  const real = gameContext(CANVAS_SIZE, CANVAS_SIZE);
  const calls: Recorded[] = [];
  const ctx = new Proxy(real, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        if (prop === 'fill' || prop === 'fillRect' || prop === 'fillText') {
          const style = target.fillStyle;
          const [first] = args;
          calls.push({
            call: prop,
            alpha: target.globalAlpha,
            fill: typeof style === 'string' ? style.toLowerCase() : '',
            text: prop === 'fillText' && typeof first === 'string' ? first : null,
          });
        }
        return Reflect.apply(value, target, args);
      };
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  return { ctx, calls };
}

console.log('\n── an item icon’s stack badge keeps the icon’s alpha');
{
  const { ctx, calls } = recordingContext();
  const stack = { ...ITEM_DEF.health_potion, quantity: STACK_QUANTITY };
  drawItemIcon(ctx, { x: 0, y: 0, w: ICON_SIZE, h: ICON_SIZE }, stack, ICON_ALPHA);
  const badge = calls.filter((c) => c.text === String(STACK_QUANTITY));
  check(badge.length > 0, 'the badge is drawn');
  check(
    badge.every((c) => Math.abs(c.alpha - ICON_ALPHA) <= ALPHA_TOLERANCE),
    `at the icon's alpha ${ICON_ALPHA} (drew at ${badge.map((c) => c.alpha).join(', ')})`,
  );
}

console.log('\n── Mongo’s health bar fades with him');
{
  const { ctx, calls } = recordingContext();
  // The bar's fill is empty while he is down, so its track is what shows the fade.
  ctx.fillStyle = WORLD_BAR.hp.track;
  const trackFill = ctx.fillStyle;
  const trackColour = typeof trackFill === 'string' ? trackFill.toLowerCase() : '';
  for (let frame = 0; frame < HEALTH_PAGE_FRAMES; frame++) {
    drawHealthPage(ctx, 'juvenile', frame, CANVAS_SIZE);
  }
  const translucentBar = calls.some(
    (c) => c.call !== 'fillText' && c.fill === trackColour && c.alpha > 0 && c.alpha < 1,
  );
  check(translucentBar, 'some frame of the recall draws the bar part-faded');
}

if (failures > 0) {
  console.log(`\n${failures} world alpha check(s) failed.`);
  process.exit(1);
}
console.log('\nAll world alpha checks passed.');
