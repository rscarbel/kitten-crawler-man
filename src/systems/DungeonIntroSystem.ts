import { byInputMode } from '../ui/core/inputMode';
import { getSpriteDefByKey } from '../core/spriteAssets/SpriteLoader';
import type { Band, KeyModifiers, Surface, Ui } from '../ui/core/UiRoot';
import { skinsFor } from '../ui/theme/skins';
import { screenShade } from '../ui/widgets/panel';
import { text } from '../ui/widgets/text';

const HOLD_FRAMES = 125;
const FADE_OUT_FRAMES = 80;
const TOTAL_FRAMES = HOLD_FRAMES + FADE_OUT_FRAMES;

/**
 * How far through the fade-out the banner is "mostly faded": the floor is
 * handed to the player there, rather than at the last frame, so the tail of
 * the fade plays over a world that has already started.
 */
const ARRIVAL_SETTLES_AT_FADE_FRACTION = 0.75;
const ARRIVAL_SETTLED_FRAME =
  HOLD_FRAMES + Math.round(FADE_OUT_FRAMES * ARRIVAL_SETTLES_AT_FADE_FRACTION);

/** Where the "begin" hint's line sits, as a fraction of the screen's height from the top. */
const BEGIN_HINT_Y_FRACTION = 0.78;

/**
 * How long the banner waits for the audio to start before it begins
 * anyway, silent. A browser that never lets the AudioContext run, and a
 * player who never touches the screen, must still be handed the floor.
 */
const BEGIN_FALLBACK_MS = 5000;

/** What started a waiting banner: a press or key the banner took, or the timeout with neither audio nor input. */
export type BeginCause = 'gesture' | 'fallback';

interface PendingBegin {
  readonly begin: (cause: BeginCause) => void;
  readonly armedAtMs: number;
}

export const ARRIVAL_BANNER_SURFACE_ID = 'arrival-banner';

/**
 * The "find the stairwell" banner a floor opens with, and the floor's arrival
 * gate.
 *
 * Until the arrival has settled (the banner is mostly faded, or was skipped)
 * its surface halts the world, so nothing a floor's frame runs can begin
 * early: the player cannot move or act, and Dave's arrival, the story's
 * opening, the arrival save, the floor clock, spawns and aggro all wait,
 * because every one of them runs only on a live world frame. A new arrival
 * trigger needs nothing of its own to wait its turn.
 */
export class DungeonIntroSystem implements Surface {
  readonly id = ARRIVAL_BANNER_SURFACE_ID;
  private frame = 0;
  private started = false;
  private pendingBegin: PendingBegin | null = null;

  get isActive(): boolean {
    return this.frame < TOTAL_FRAMES;
  }

  /** True once the banner is mostly faded or was never shown: the floor is the player's. */
  get arrivalSettled(): boolean {
    return this.frame >= ARRIVAL_SETTLED_FRAME;
  }

  /** Ends the banner immediately, settling the arrival: a floor already introduced, or one that never shows it. */
  skip(): void {
    this.frame = TOTAL_FRAMES;
  }

  /** The banner's clock starts here, once the floor's sting can be heard with it. */
  start(): void {
    this.started = true;
    this.pendingBegin = null;
  }

  /**
   * While the floor waits on the audio, `begin` runs on the first press or key
   * the banner receives, or after {@link BEGIN_FALLBACK_MS}, whichever comes
   * first, so the world is never held with no way forward. `begin` is
   * expected to call {@link start}.
   */
  awaitBegin(begin: (cause: BeginCause) => void): void {
    this.pendingBegin = { begin, armedAtMs: performance.now() };
  }

  tick(): void {
    const pending = this.pendingBegin;
    if (pending !== null && performance.now() - pending.armedAtMs >= BEGIN_FALLBACK_MS) {
      this.requestBegin('fallback');
    }
    if (this.started && this.isActive) this.frame++;
  }

  onKey(_key: string, mods: KeyModifiers): boolean {
    if (this.pendingBegin === null || mods.predatesSurface === true) return false;
    this.requestBegin('gesture');
    return true;
  }

  private requestBegin(cause: BeginCause): void {
    const pending = this.pendingBegin;
    if (pending === null) return;
    this.pendingBegin = null;
    pending.begin(cause);
  }

  // A modal covers the screen, so no press reaches the world while the floor
  // is being announced; once settled the banner floats and takes nothing.
  get band(): Band {
    return this.arrivalSettled ? 'panel' : 'modal';
  }

  get haltsWorld(): boolean {
    return !this.arrivalSettled;
  }

  isOpen(): boolean {
    return this.isActive;
  }

  render(ui: Ui): void {
    this.drawBanner(ui);
    if (!this.started) this.drawBeginHint(ui);
    if (this.pendingBegin !== null) {
      ui.hit('begin', ui.screen, {
        onTap: () => this.requestBegin('gesture'),
        focusable: false,
        sound: null,
      });
    }
  }

  /** Shown while the banner waits on the AudioContext, which a phone only starts on a gesture. */
  private drawBeginHint(ui: Ui): void {
    const { screen } = ui;
    const skin = skinsFor(ui.theme).arrivalBanner;
    const hint = byInputMode(ui.density, {
      touch: 'Tap to begin',
      pointer: 'Press any key to begin',
    });
    const lineHeight = skin.prompt.style.lineHeight;
    const lineCentreY = screen.y + screen.h * BEGIN_HINT_Y_FRACTION;
    text(
      ui,
      { x: screen.x, y: lineCentreY - lineHeight / 2, w: screen.w, h: lineHeight },
      {
        text: hint,
        style: skin.prompt.style,
        color: skin.prompt.color,
        align: 'center',
        valign: 'middle',
        halo: skin.promptHalo,
      },
    );
  }

  private drawBanner(ui: Ui): void {
    const { ctx, screen } = ui;
    // Undefined until SpriteLoader's `core` group has loaded it, in which case
    // this frame (and maybe the next couple) just shows no banner, the same as
    // any other sprite miss.
    const img = getSpriteDefByKey('find-the-stairwell')?.img;
    // `img` only ever reaches `_defs` (and so is only ever returned here) after
    // `ensureLoading`'s onload finished populating it — the low-end-device
    // downscale, if it ran, is drawn synchronously before that point too — so
    // by the time this getter returns something, it is always ready to draw.
    // The width check alone (rather than `<img>`-only `.complete`/
    // `.naturalWidth`, which the downscale's `<canvas>` output doesn't have)
    // guards the one degenerate case: a 0×0 source, which `drawImage` would
    // otherwise throw on.
    if (img === undefined || img.width === 0) return;

    const alpha = this.frame < HOLD_FRAMES ? 1 : 1 - (this.frame - HOLD_FRAMES) / FADE_OUT_FRAMES;

    const skin = skinsFor(ui.theme).arrivalBanner;
    screenShade(ui, { color: skin.shade, opacity: alpha * skin.shadeOpacity });

    const aspectRatio = img.height / img.width;
    const widthCappedH = Math.round(screen.w * aspectRatio);
    const imgW = widthCappedH <= screen.h ? screen.w : Math.round(screen.h / aspectRatio);
    const imgH = Math.round(imgW * aspectRatio);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      img,
      Math.round(screen.x + (screen.w - imgW) / 2),
      Math.round(screen.y + (screen.h - imgH) / 2),
      imgW,
      imgH,
    );
    ctx.restore();
  }
}
