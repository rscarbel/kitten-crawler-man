/**
 * The tutorial's "Enemy Nearby!" card, raised when Carl first walks up to the
 * tutorial goblin. It floats over the world without a scrim; a fresh press
 * of the attack key puts it away. Escape passes beneath it to
 * the pause menu.
 */

import { keybindings } from '../../../core/Keybindings';
import type { Band, Surface } from '../../core/UiRoot';
import { keyLabel } from '../../core/inputMode';
import { drawNearGoblinCombat } from '../../icons/explainerArt/nearGoblinArt';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../widgets/pagedOverlay';
import { illustrationBand, framesIn } from './explainerPages';

/** What the card reads from, and drives on, `TutorialController`. */
export interface NearGoblinHintModel {
  readonly showNearGoblinDialog: boolean;
  dismissNearGoblinDialog(): void;
}

const ILLUSTRATION_HEIGHT = 90;
const TITLE = 'Enemy Nearby!';

function page(touch: boolean): PagedOverlayPage {
  return {
    title: TITLE,
    body: touch
      ? 'Walk right up to an enemy and tap to attack.'
      : `Walk right up to an enemy and press ${keyLabel('attack')} to attack.`,
    illustration: {
      height: ILLUSTRATION_HEIGHT,
      paint: (ctx, rect, _now, pageMs) =>
        drawNearGoblinCombat(ctx, illustrationBand(rect), framesIn(pageMs)),
    },
  };
}

const TOUCH_PAGES = [page(true)];

let pointerPages: { readonly key: string; readonly pages: readonly PagedOverlayPage[] } | null =
  null;

/** The pointer copy names the bound attack key, so a rebind rebuilds it. */
function pointerPagesForBindings(): readonly PagedOverlayPage[] {
  const key = keyLabel('attack');
  if (pointerPages?.key !== key) pointerPages = { key, pages: [page(false)] };
  return pointerPages.pages;
}

/**
 * With a mouse it sits in the system band over everything and a click
 * anywhere dismisses it. On a touch screen it is a panel that takes only its
 * own taps, so the HUD stays live beneath it and the scene's world tap
 * dismisses it. Either way the world is not halted by it.
 */
export function nearGoblinHintSurface(
  model: NearGoblinHintModel,
  id = 'tutorial-near-goblin',
): Surface {
  let touch = false;
  const dismiss = (): void => model.dismissNearGoblinDialog();
  const inner = pagedOverlaySurface({
    id,
    get pages(): readonly PagedOverlayPage[] {
      return touch ? TOUCH_PAGES : pointerPagesForBindings();
    },
    width: 'sm',
    closable: false,
    scrim: false,
    get advanceOnTapAnywhere(): boolean {
      return !touch;
    },
    onDone: dismiss,
    isOpen: () => model.showNearGoblinDialog,
    band: 'system',
    haltsWorld: false,
    arrowKeys: false,
  });
  return {
    ...inner,
    get band(): Band {
      return touch ? 'panel' : 'system';
    },
    blocksEscape: false,
    onKey: (key, mods) => {
      if (keybindings.actionFor(key) !== 'attack') return false;
      if (mods.repeat !== true && mods.predatesSurface !== true) dismiss();
      return true;
    },
    render: (ui) => {
      touch = ui.density === 'touch';
      inner.render(ui);
    },
  };
}
