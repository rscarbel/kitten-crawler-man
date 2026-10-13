import { Scene } from '../core/Scene';
import { createSceneUi } from '../ui/core/sceneUi';
import type { UiRoot } from '../ui/core/UiRoot';
import { drawBackdrop } from '../ui/screens/dialogs/endScreenParts';
import { WipeHold, type ProgressWipe } from '../ui/screens/dialogs/wipeHold';
import type { AudioManager } from '../audio/AudioManager';

const BACKDROP_SURFACE_ID = 'wipe-hold-backdrop';
const HOLD_SURFACE_ID = 'wipe-hold';
const FULLY_OPAQUE = 1;

/**
 * Boot's holding screen while a wipe a previous page left unfinished is
 * completed. Nothing else can run until it lands: the save it erases must
 * never be loaded, and the page reloads once it is gone.
 */
export class WipeHoldScene extends Scene {
  readonly ui: UiRoot;
  private readonly hold = new WipeHold();

  constructor(audio: AudioManager | null) {
    super();
    this.ui = createSceneUi({
      audio,
      handleWorldPointer: () => {
        // There is no world behind the hold to receive a press.
      },
    });
    this.ui.mount({
      id: BACKDROP_SURFACE_ID,
      band: 'hud',
      haltsWorld: false,
      isOpen: () => true,
      render: (ui) => drawBackdrop(ui, FULLY_OPAQUE),
    });
    this.ui.mount(this.hold.surface(HOLD_SURFACE_ID));
  }

  /** Shows the hold over `wipe`, which the caller has already started or is about to. */
  holdOn(wipe: ProgressWipe): void {
    this.hold.begin(wipe, () => undefined);
  }

  update(): void {
    // The hold is redrawn from the wipe's status every frame; there is nothing to advance.
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.ui.frame(ctx);
  }
}
