import type { Surface, Ui } from './core/UiRoot';
import { drawBackdrop } from './screens/dialogs/endScreenParts';

/** Below this the screen counts as clear: the fade registers nothing and takes no input. */
const VISIBLE_ALPHA_THRESHOLD = 0.001;

/** What a fade reads each frame: how dark the screen is, 0 clear to 1 black. */
export interface ScreenFadeSource {
  /** Owned by the caller, who eases it however its own sequence wants. */
  alpha(): number;
}

/**
 * A full-screen fade to black, as a surface over the HUD.
 *
 * The darkness is not animated here: the system that runs the sequence owns
 * the alpha and steps it on its own clock, so a fade can hold, reverse or
 * stop on the frame its script says. While any of it shows, the fade covers
 * the screen (a `modal` surface claims every press under it), keeps keys from
 * gameplay and swallows Escape, so a pause menu cannot open over a scene that
 * is mid-cut. It never halts the world: the system driving the alpha has to
 * keep running to bring it back.
 */
export function screenFadeSurface(id: string, source: ScreenFadeSource): Surface {
  const showing = (): boolean => source.alpha() > VISIBLE_ALPHA_THRESHOLD;
  return {
    id,
    band: 'modal',
    haltsWorld: false,
    get locksKeyboard() {
      return showing();
    },
    get blocksEscape() {
      return showing();
    },
    isOpen: showing,
    render: (ui: Ui) => {
      drawBackdrop(ui, Math.min(1, source.alpha()));
    },
  };
}
