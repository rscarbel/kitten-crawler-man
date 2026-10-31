import type { AudioManager } from '../audio/AudioManager';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';
import type { LevelId } from '../levels/levelIds';
import { byInputMode } from '../ui/core/inputMode';
import type { Band, KeyModifiers, Surface, Ui } from '../ui/core/UiRoot';
import {
  floorIntroView,
  paintFloorIntro,
  type FloorIntroView,
  type IntroPaintTarget,
} from '../ui/screens/floorIntro/floorIntroScreen';
import { introSoundCues, type IntroSoundCue } from '../ui/screens/floorIntro/floorIntroTimeline';
import { IntroFadeLayer } from '../ui/screens/floorIntro/introFadeLayer';
import { IntroKeyGlows } from '../ui/screens/floorIntro/introKeyGlows';
import { skinsFor } from '../ui/theme/skins';
import { text } from '../ui/widgets/text';

const MS_PER_SECOND = 1000;
const MS_PER_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;
const FADE_OUT_FRAMES = 80;

/**
 * How far through the fade-out the intro is "mostly faded": the floor is
 * handed to the player there, rather than at the last frame, so the tail of
 * the fade plays over a world that has already started.
 */
const ARRIVAL_SETTLES_AT_FADE_FRACTION = 0.75;
const ARRIVAL_SETTLES_INTO_FADE_FRAMES = Math.round(
  FADE_OUT_FRAMES * ARRIVAL_SETTLES_AT_FADE_FRACTION,
);

/** Where the "begin" hint's line sits, as a fraction of the screen's height from the top. */
const BEGIN_HINT_Y_FRACTION = 0.78;

/**
 * How long the intro waits for the audio to start before it begins
 * anyway, silent. A browser that never lets the AudioContext run, and a
 * player who never touches the screen, must still be handed the floor.
 */
const BEGIN_FALLBACK_MS = 5000;

/** What started a waiting intro: a press or key the intro took, or the timeout with neither audio nor input. */
export type BeginCause = 'gesture' | 'fallback';

/**
 * Where the intro's sounds go: the scene's audio, or nowhere for a silent
 * start. A cue whose recording is not decoded yet is dropped rather than
 * played late, over a later beat or over play.
 */
export type IntroSoundSink = Pick<AudioManager, 'play' | 'clockSeconds' | 'decodedDurationS'>;

interface PendingBegin {
  readonly begin: (cause: BeginCause) => void;
  readonly armedAtMs: number;
}

export const ARRIVAL_BANNER_SURFACE_ID = 'arrival-banner';

/**
 * The "Find the Key" intro a floor opens with, and the floor's arrival gate.
 *
 * Until the arrival has settled (the intro is mostly faded, or was skipped)
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
  private readonly view: FloorIntroView;
  private readonly sounds: readonly IntroSoundCue[];
  private sink: IntroSoundSink | null = null;
  /** How many of {@link sounds} have been played. */
  private soundsPlayed = 0;
  /** The audio-clock second the last of the cues played so far finishes ringing. */
  private soundsEndAtS = 0;
  private readonly fadeLayer = new IntroFadeLayer();
  private readonly keyGlows = new IntroKeyGlows();
  /** The floor's card holds this long, fitted to its swell, before fading. */
  private readonly holdFrames: number;
  private readonly totalFrames: number;
  private readonly settledFrame: number;

  constructor(levelId: LevelId) {
    this.view = floorIntroView(levelId);
    this.sounds = introSoundCues(this.view.theme.swell, this.view.timing);
    this.holdFrames = Math.ceil(this.view.timing.holdMs / MS_PER_FRAME);
    this.totalFrames = this.holdFrames + FADE_OUT_FRAMES;
    this.settledFrame = this.holdFrames + ARRIVAL_SETTLES_INTO_FADE_FRAMES;
  }

  get isActive(): boolean {
    return this.frame < this.totalFrames;
  }

  /** True once the intro is mostly faded or was never shown: the floor is the player's. */
  get arrivalSettled(): boolean {
    return this.frame >= this.settledFrame;
  }

  /** Ends the intro immediately, settling the arrival: a floor already introduced, or one that never shows it. */
  skip(): void {
    this.frame = this.totalFrames;
    this.sink = null;
    this.dispose();
  }

  /** Gives back the off-screen pixels the intro paints with; it reallocates them if drawn again. */
  dispose(): void {
    this.fadeLayer.release();
    this.keyGlows.release();
  }

  /**
   * The intro's clock starts here, once its sounds can be heard with it. With
   * a `sink` the intro plays its swell, knocks and slam on their beats; with
   * none it plays silent, for a start so late that sound would trail the
   * picture.
   */
  start(sink: IntroSoundSink | null): void {
    this.started = true;
    this.pendingBegin = null;
    this.sink = sink;
  }

  /**
   * Whether the intro's sounds are still to come or still ringing, measured
   * against each recording's real length: a swell's tail can ring on well past
   * the picture, and the floor's music waits for it rather than talking over
   * it. False for a silent or skipped intro, whose floor music starts at once.
   */
  get soundsRinging(): boolean {
    const sink = this.sink;
    if (sink === null) return false;
    if (this.soundsPlayed < this.sounds.length) return true;
    return sink.clockSeconds < this.soundsEndAtS;
  }

  /**
   * While the floor waits on the audio, `begin` runs on the first press or key
   * the intro receives, or after {@link BEGIN_FALLBACK_MS}, whichever comes
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
    if (!this.started || !this.isActive) return;
    this.playSoundsBefore((this.frame + 1) * MS_PER_FRAME);
    this.frame++;
    if (this.frame >= this.totalFrames) this.dispose();
  }

  private playSoundsBefore(ms: number): void {
    while (this.soundsPlayed < this.sounds.length) {
      const next = this.sounds[this.soundsPlayed];
      if (next.atMs >= ms) return;
      const sink = this.sink;
      if (sink !== null) {
        sink.play(next.id);
        const lengthS = sink.decodedDurationS(next.id) ?? 0;
        this.soundsEndAtS = Math.max(this.soundsEndAtS, sink.clockSeconds + lengthS);
      }
      this.soundsPlayed++;
    }
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
  // is being announced; once settled the intro floats and takes nothing.
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
    this.drawIntro(ui);
    if (!this.started) this.drawBeginHint(ui);
    if (this.pendingBegin !== null) {
      ui.hit('begin', ui.screen, {
        onTap: () => this.requestBegin('gesture'),
        focusable: false,
        sound: null,
      });
    }
  }

  /** Shown while the intro waits on the AudioContext, which a phone only starts on a gesture. */
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

  private drawIntro(ui: Ui): void {
    const ms = this.frame * MS_PER_FRAME;
    if (this.frame < this.holdFrames) {
      paintFloorIntro(ui, this.view, ms, this.keyGlows);
      return;
    }
    const fadeAlpha = 1 - (this.frame - this.holdFrames) / FADE_OUT_FRAMES;
    this.fadeLayer.paintFaded(ui.ctx, fadeAlpha, (layer) =>
      paintFloorIntro({ ...introTarget(ui), ctx: layer }, this.view, ms, this.keyGlows),
    );
  }
}

function introTarget(ui: Ui): IntroPaintTarget {
  return { ctx: ui.ctx, theme: ui.theme, viewport: ui.viewport, screen: ui.screen, size: ui.size };
}
