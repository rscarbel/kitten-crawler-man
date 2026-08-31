/**
 * KeyboardHeroSystem — Guitar Hero-style mini-game for the "hacking the computer"
 * sequence in the Spider Quest.
 *
 * Four columns map to arrow keys / WASD. Notes fall from the top of the playing
 * field toward a receptor row near the bottom. Hit a note as it reaches its
 * receptor to score. One mistake is forgiven (a firewall pip shatters); a second
 * mistake ends the game after a short delay.
 *
 * Notes come from a baked chart (`keyboardHeroChart.ts`) rather than a random
 * spawner: each entry is an attack in the music, and a note reaches the hit line
 * exactly when that attack sounds. Positions are derived from the track's own
 * playback clock, not from a frame counter, so a dropped frame slides the note
 * rather than desyncing it from the melody. The game ends once the last charted
 * note has resolved — the audio is left to finish its tail on its own (do NOT
 * stop it on success).
 *
 * Everything visible splits three ways:
 *
 * - **Judged state** (`_notes`, `_missCount`, `_failed`) is scored against the
 *   song clock and nothing else. It is the mini-game.
 * - **Feedback state** (streaks, judgement floats, sparks, shakes, flashes) is
 *   cosmetic and runs on a monotonic wall clock, so a stalled song cannot leave
 *   an effect stuck on screen and a fast/slow frame cannot stretch it.
 * - **Layout** comes from `computeKeyboardHeroLayout`, which both `render` and
 *   `handleTouchAt` call, so what is drawn and what is tappable can never drift.
 */

import { platform } from '../core/Platform';
import { keybindings } from '../core/Keybindings';
import { drawText } from '../ui/TextBox';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { KEYBOARD_HERO_CHART, KEYBOARD_HERO_CHART_END_MS } from './keyboardHeroChart';
import type { KeyboardHeroColumn } from './keyboardHeroChart';
import {
  FADE_IN_END_IMG_Y,
  FALL_SPEED_IMG_PX_PER_MS,
  HIT_WINDOW_MS,
  HIT_ZONE_IMG_CENTER,
  MAX_PLAYABLE_GAP_MS,
  NOTE_SPAWN_IMG_Y,
  NOTE_TRAVEL_MS,
} from './keyboardHeroGeometry';
import {
  computeKeyboardHeroLayout,
  laneAtPoint,
  noteImgYToScreenY,
  LANE_INDICES,
  LANE_PALETTES,
  type KeyboardHeroLayout,
  type LaneIndex,
  type LanePalette,
} from './keyboardHeroLayout';
import { releaseKeyboardHeroArt } from './keyboardHeroArtCache';
import {
  clipToLanes,
  drawBoardBase,
  drawFirewallPip,
  drawLaneHighlight,
  drawNoteKeycap,
  drawReceptor,
  drawTouchButton,
  PIP_INTACT_BORDER,
  type NoteArtState,
} from './keyboardHeroBoardArt';

/** Milliseconds per second. */
const MS_PER_SECOND = 1_000;

const SECONDS_PER_MINUTE = 60;

/** Frames per second, used only by the fallback clock when no audio is available. */
const FPS = 60;

/** MS added per frame when no audio clock is available to drive the chart. */
const MS_PER_FRAME = MS_PER_SECOND / FPS;

/**
 * A song-clock jump larger than this means the mini-game stopped updating while the
 * track kept rolling — the pause menu skips this system entirely, and a backgrounded
 * tab stops rAF, while `pauseAmbience` deliberately leaves the track playing behind a
 * muted bus. The run cannot be picked back up in time with the music, and carrying on
 * regardless would let a player win by simply waiting the song out, so the attempt is
 * abandoned and the existing retry dialog is offered.
 *
 * The line is the widest gap a run can still be judged fairly across.
 */
const SUSPENSION_ABANDON_MS = MAX_PLAYABLE_GAP_MS;

/** How long a lane stays lit red after a forgiven mistake. */
const ERROR_FLASH_MS = 1_000;

/** How long the board holds after the fatal mistake before the fail callback fires. */
const FAIL_DELAY_MS = 2_000;

/** Flash duration for a successfully-struck note. */
const HIT_FLASH_MS = 250;

/** How long a note that fell past its window stays on the board as a red stamp. */
const MISS_STAMP_MS = 520;

/** Scrim alpha over the world behind the board. */
const SCRIM_ALPHA = 0.86;

/** Two mistakes end the run, so the firewall has two pips to lose. */
const FIREWALL_PIPS = 2;

/** Mistakes that end the attempt. */
const FATAL_MISS_COUNT = 2;

// ── Feedback tuning ─────────────────────────────────────────────────────────

/**
 * How long a press keeps its receptor lit. The system is only told about key
 * *downs* — there is no keyup path from `SpiderQuestSystem` — so "held" is
 * approximated by a decay window just long enough to read as a deliberate press.
 */
const PRESS_HIGHLIGHT_MS = 130;

/** How long a receptor stays white-hot after the note it caught. */
const RECEPTOR_FLASH_MS = 170;

/**
 * A hit this close to the perfect moment is graded PERFECT rather than HIT.
 * Cosmetic only — both grades score identically, which is what keeps the frozen
 * hit window frozen.
 */
const PERFECT_WINDOW_MS = 70;

const JUDGEMENT_LIFE_MS = 430;
/** How far a judgement float rises over its life, in board-space pixels. */
const JUDGEMENT_RISE_IMG = 46;
/** Board-space gap between a receptor's top edge and the judgement text. */
const JUDGEMENT_GAP_IMG = 18;
const JUDGEMENT_SIZE_IMG = 30;
const JUDGEMENT_GLOW_BLUR = 14;

const SPARKS_PER_HIT = 14;
const SPARK_LIFE_MIN_MS = 220;
const SPARK_LIFE_SPAN_MS = 200;
/** Board-space pixels a spark travels per millisecond at full speed. */
const SPARK_SPEED_IMG_PER_MS = 0.28;
const SPARK_SPEED_MIN_FRACTION = 0.35;
/** Board-space downward pull applied to a spark, per millisecond squared. */
const SPARK_GRAVITY_IMG_PER_MS2 = 0.00045;
const SPARK_RADIUS_IMG = 3.4;
/** Half a hit's sparks take the lane's lighter shade, so the spray is not one flat colour. */
const SPARK_LIGHT_SHADE_CHANCE = 0.5;
/** Sparks are cheap but not free; a stuck run must not accumulate them forever. */
const MAX_SPARKS = 240;

/** A missed note shoves the board this far, in board-space pixels. */
const BOARD_SHAKE_IMG = 4;
const BOARD_SHAKE_MS = 180;
/**
 * Whole oscillations the shake makes over its life. Both axes run at this one
 * frequency — 1.5 cycles in 180 ms is 8.3 Hz, comfortably under the 30 Hz a
 * 60 fps sampler can resolve. A faster shake does not read as more violent, it
 * aliases: the board appears to drift somewhere arbitrary and snap back.
 */
const BOARD_SHAKE_OSCILLATIONS = 1.5;
/** Quarter-cycle lead on the vertical axis, so the jolt traces a figure rather than a line. */
const BOARD_SHAKE_VERTICAL_PHASE = Math.PI / 2;
/** The vertical component throws half as far as the horizontal. */
const BOARD_SHAKE_VERTICAL_FRACTION = 0.5;

/** How long the scanline glitch bars flicker over the board after a miss. */
const GLITCH_MS = 120;
const GLITCH_BAR_COUNT = 5;
/** Board-space height of one glitch bar. */
const GLITCH_BAR_IMG_H = 10;
/** Board-space horizontal throw of a glitch bar. */
const GLITCH_BAR_IMG_OFFSET = 9;
const GLITCH_BAR_ALPHA = 0.34;

/** How long the streak readout stays punched up after an increment. */
const STREAK_PUNCH_MS = 220;
/** Extra scale a freshly-incremented streak readout gets. */
const STREAK_PUNCH_SCALE = 0.55;
/** Streak thresholds and the colour each one promotes the readout to. */
const STREAK_COLOR_RAMP: ReadonlyArray<{ readonly atLeast: number; readonly color: string }> = [
  { atLeast: 30, color: '#ffffff' },
  { atLeast: 20, color: '#ffa726' },
  { atLeast: 10, color: '#4fc3f7' },
  { atLeast: 0, color: '#94a3b8' },
];

/**
 * The lane beds and the hit line breathe on the song's quarter note. The chart's
 * grid is ~173 ms sixteenths, so a quarter is four of those — 1.45 Hz, far below
 * anything 60 fps sampling could alias into a stutter.
 */
const BEAT_PERIOD_MS = 690;
const BEAT_PULSE_AMPLITUDE = 0.14;

/** Labels shown before the first note lands, spread evenly across the song's intro. */
const COUNTDOWN_LABELS: readonly string[] = ['3', '2', '1', 'HACK'];
/** How long the final countdown label lingers after its slot ends. */
const COUNTDOWN_LINGER_MS = 420;
const COUNTDOWN_SIZE_IMG = 96;
/** Fraction of its slot a countdown label spends scaling in. */
const COUNTDOWN_POP_FRACTION = 0.28;
const COUNTDOWN_POP_SCALE = 0.4;

/** How long the ACCESS GRANTED flourish holds before the cutscene takes over. */
const SUCCESS_FLOURISH_MS = 1_100;
/** Stagger between lane flares in the success sweep. */
const SUCCESS_LANE_STAGGER_MS = 90;
const SUCCESS_LANE_FLARE_MS = 320;
/** Peak strength of a lane's win flare, on the same scale a press highlight uses. */
const SUCCESS_FLARE_STRENGTH = 1;
const SUCCESS_STAMP_SIZE_IMG = 62;
/** Fraction of the flourish the stamp spends scaling in. */
const SUCCESS_STAMP_POP_FRACTION = 0.22;
const SUCCESS_STAMP_POP_SCALE = 0.9;
const SUCCESS_SPARKS_PER_LANE = 18;

// ── HUD tuning (board-space sizes; the layout scales them) ───────────────────

const HUD_LABEL_SIZE_IMG = 15;
const HUD_VALUE_SIZE_IMG = 19;
const HUD_HINT_SIZE_IMG = 16;
const HUD_PIP_GAP_IMG = 6;
/** Board-space gap between a HUD label and the thing it labels. */
const HUD_LABEL_GAP_IMG = 4;
const HUD_PIP_LABEL_SIZE_IMG = 11;
const HUD_MUTED_COLOR = '#7c8ba1';
const HUD_VALUE_COLOR = '#dbeafe';
/** How long a shattering pip throws its shards. */
const PIP_SHATTER_MS = 520;
const PIP_SHARD_COUNT = 9;
/** Board-space pixels a pip shard travels over its life. */
const PIP_SHARD_TRAVEL_IMG = 38;
const PIP_SHARD_SIZE_IMG = 3;

const DANGER_COLOR = '#ef4444';
const SUCCESS_COLOR = '#4ade80';

/** Extra scale a struck note pops to before it fades out. */
const NOTE_HIT_POP_SCALE = 0.55;
/** How much of its size a missed note has shrunk away by the end of its stamp. */
const NOTE_MISS_SHRINK = 0.3;

// Column indices as constants
const COL_LEFT = 0;
const COL_UP = 1;
const COL_DOWN = 2;
const COL_RIGHT = 3;

type ColumnIndex = KeyboardHeroColumn;

interface Note {
  column: ColumnIndex;
  /** Song time at which this note is perfectly centred on the hit line. */
  hitTimeMs: number;
  state: 'falling' | 'hit' | 'missed';
  /** Song time the player struck it, or the moment its window closed. */
  hitAtMs: number;
  /** Wall-clock time the note left the `falling` state, driving its fade. */
  resolvedAtMs: number;
}

interface LaneFeedback {
  /** Wall-clock time the lane's red error flash ends; 0 = no error. */
  errorEndsAtMs: number;
  /** Wall-clock time the lane's press highlight ends. */
  pressEndsAtMs: number;
  /** Wall-clock time the receptor's white-hot flash ends. */
  flashEndsAtMs: number;
}

interface Judgement {
  lane: LaneIndex;
  text: string;
  color: string;
  startedAtMs: number;
}

interface Spark {
  /** The lane whose receptor threw this spark; its rect is the launch point. */
  lane: LaneIndex;
  /** Board-space velocity, so the layout scales the flight. */
  vx: number;
  vy: number;
  bornAtMs: number;
  lifeMs: number;
  color: string;
}

function isColumnIndex(n: number): n is ColumnIndex {
  return n === COL_LEFT || n === COL_UP || n === COL_DOWN || n === COL_RIGHT;
}

/** A point-in-time copy of a mini-game attempt's scoring state. */
export interface KeyboardHeroCheckpoint {
  hitCount: number;
  missCount: number;
  failed: boolean;
  completed: boolean;
  nextChartIndex: number;
}

export class KeyboardHeroSystem {
  isActive = false;

  /**
   * Cues raised by the board and drained by its owner into the scene's audio.
   * The board never reaches `AudioManager` itself — it is constructed without
   * one, the same way every other quest sub-system here is.
   */
  hitTickPending = false;
  firewallPipShatterPending = false;
  accessGrantedPending = false;

  // Callbacks
  private _onComplete: (() => void) | null = null;
  private _onFail: (() => void) | null = null;
  /** Called immediately when the player misses (before the delay). Use to play the error sound. */
  private _onFailImmediate: (() => void) | null = null;

  // State
  private _songTimeMs = 0;
  private _notes: Note[] = [];
  private _hitCount = 0;
  private _missCount = 0;
  private _failed = false;
  private _completed = false;
  /** Wall-clock time `_onFail` fires; 0 when no fail is pending. */
  private _failAtMs = 0;
  /** Wall-clock time the success flourish ends and `_onComplete` fires; 0 when none. */
  private _successEndsAtMs = 0;
  /** Wall-clock time the success flourish began, driving the stamp and lane sweep. */
  private _successStartedAtMs = 0;

  /** Index of the next chart entry that has yet to enter the field. */
  private _nextChartIndex = 0;

  // Feedback state — cosmetic, wall-clocked, and reset with every attempt.
  private _lanes: readonly [LaneFeedback, LaneFeedback, LaneFeedback, LaneFeedback] =
    createLaneFeedback();
  private _judgements: Judgement[] = [];
  private _sparks: Spark[] = [];
  private _streak = 0;
  private _streakPunchedAtMs = 0;
  private _shakeStartedAtMs = 0;
  private _glitchStartedAtMs = 0;
  /** Wall-clock time each firewall pip shattered, indexed by pip; 0 = still intact. */
  private _pipShatteredAtMs: number[] = [];

  start(onComplete: () => void, onFail: () => void, onFailImmediate?: () => void): void {
    this._onComplete = onComplete;
    this._onFail = onFail;
    this._onFailImmediate = onFailImmediate ?? null;
    this._songTimeMs = 0;
    this._notes = [];
    this._hitCount = 0;
    this._missCount = 0;
    this._failed = false;
    this._completed = false;
    this._failAtMs = 0;
    this._successEndsAtMs = 0;
    this._successStartedAtMs = 0;
    this._nextChartIndex = 0;
    this._resetFeedback();
    this.isActive = true;
  }

  private _resetFeedback(): void {
    this._lanes = createLaneFeedback();
    this._judgements = [];
    this._sparks = [];
    this._streak = 0;
    this._streakPunchedAtMs = 0;
    this._shakeStartedAtMs = 0;
    this._glitchStartedAtMs = 0;
    this._pipShatteredAtMs = new Array<number>(FIREWALL_PIPS).fill(0);
    this.hitTickPending = false;
    this.firewallPipShatterPending = false;
    this.accessGrantedPending = false;
  }

  /**
   * Snapshots the attempt's scoring state so a death rewinds a hack the player
   * completed after checking in.
   *
   * Only the run's verdict is stored. The live field (`_notes`, the lane
   * feedback, `_songTimeMs`, the fail delay) belongs to an attempt that is driven
   * by the track's own clock, and `start` rebuilds all of it from scratch —
   * restoring a half-played field against a song that is no longer playing would
   * resume a run mid-air with no way to judge it.
   */
  captureCheckpoint(): KeyboardHeroCheckpoint {
    return {
      hitCount: this._hitCount,
      missCount: this._missCount,
      failed: this._failed,
      completed: this._completed,
      nextChartIndex: this._nextChartIndex,
    };
  }

  restoreCheckpoint(snapshot: KeyboardHeroCheckpoint): void {
    this._hitCount = snapshot.hitCount;
    this._missCount = snapshot.missCount;
    this._failed = snapshot.failed;
    this._completed = snapshot.completed;
    this._nextChartIndex = snapshot.nextChartIndex;
  }

  /**
   * Drops the board's painted art as well as the run: the pieces are painted on
   * demand and cost nothing to lose, so nothing about a console the player has
   * walked away from stays resident.
   */
  stop(): void {
    this.isActive = false;
    this._onComplete = null;
    this._onFail = null;
    this._onFailImmediate = null;
    releaseKeyboardHeroArt();
  }

  /**
   * Effects, the fail delay and the success flourish run on this clock rather
   * than on the song's, so a stopped track cannot freeze a flash half-drawn and
   * a catch-up double-update cannot spend two frames' worth of a timer in one
   * callback.
   */
  private _nowMs(): number {
    return performance.now();
  }

  /**
   * @param songTimeMs - playback position of the keyboard-hero track, or null when
   *   the track isn't running (no audio, or still starting). Falls back to a frame
   *   counter so the mini-game stays playable without sound.
   */
  update(songTimeMs: number | null): void {
    if (!this.isActive) return;

    const nowMs = this._nowMs();
    this._expireFeedback(nowMs);

    if (this._successEndsAtMs > 0) {
      if (nowMs >= this._successEndsAtMs) {
        this._successEndsAtMs = 0;
        this.isActive = false;
        this._onComplete?.();
      }
      return;
    }

    if (this._completed) return;

    // While waiting for the fail-delay to expire, only tick timers then bail.
    if (this._failed) {
      if (this._failAtMs > 0 && nowMs >= this._failAtMs) {
        this._failAtMs = 0;
        this.isActive = false;
        this._onFail?.();
      }
      return;
    }

    const previousSongTimeMs = this._songTimeMs;
    this._songTimeMs = songTimeMs ?? previousSongTimeMs + MS_PER_FRAME;
    const frameGapMs = this._songTimeMs - previousSongTimeMs;

    if (frameGapMs > SUSPENSION_ABANDON_MS) {
      this._abandonRun();
      return;
    }

    this._admitDueChartNotes();

    // Misses are judged here rather than being held back for input that a stall may
    // still have queued. The HTML event loop runs tasks — which is how a discrete
    // keydown is dispatched — before the rendering steps that run this callback, so a
    // press made during a stall has already been scored, against its own timestamp, by
    // the time we get here. Deferring instead was tried and is worse: any rule strong
    // enough to survive `Scene.loop`'s same-callback catch-up update also refuses to
    // expire notes at a steady low frame rate, which makes the run unloseable.
    if (this._resolveExpiredNotes(nowMs)) return;

    this._notes = this._notes.filter((n) => !this._isNoteFadeFinished(n, nowMs));

    // Reaching the end of the track is not enough on its own — every charted note
    // must actually have been played, so a run that skipped ahead cannot pass.
    const chartExhausted = this._nextChartIndex >= KEYBOARD_HERO_CHART.length;
    if (this._songTimeMs >= KEYBOARD_HERO_CHART_END_MS && chartExhausted) {
      this._completed = true;
      this.accessGrantedPending = true;
      // The firewall held. A red lane still burning down from the forgiven
      // mistake would sit under ACCESS GRANTED contradicting it.
      for (const lane of this._lanes) lane.errorEndsAtMs = 0;
      this._successStartedAtMs = nowMs;
      this._successEndsAtMs = nowMs + SUCCESS_FLOURISH_MS;
      this._spawnSuccessSparks(nowMs);
    }
  }

  /** End the attempt without a red-column flash: nothing the player did caused it. */
  private _abandonRun(): void {
    this._failed = true;
    this._failAtMs = 0;
    this.isActive = false;
    this._onFail?.();
  }

  /** Put every chart note whose fall has begun onto the field. */
  private _admitDueChartNotes(): void {
    while (this._nextChartIndex < KEYBOARD_HERO_CHART.length) {
      const entry = KEYBOARD_HERO_CHART[this._nextChartIndex];
      if (entry.timeMs - NOTE_TRAVEL_MS > this._songTimeMs) break;
      this._notes.push({
        column: entry.column,
        hitTimeMs: entry.timeMs,
        state: 'falling',
        hitAtMs: 0,
        resolvedAtMs: 0,
      });
      this._nextChartIndex++;
    }
  }

  /**
   * Drop notes that have fallen past their hit window, counting each as a miss.
   * Returns true if that triggered a hard fail (the caller must stop updating).
   */
  private _resolveExpiredNotes(nowMs: number): boolean {
    let hardFailed = false;

    for (const note of this._notes) {
      const windowClosesAtMs = note.hitTimeMs + HIT_WINDOW_MS;
      if (hardFailed || note.state !== 'falling' || this._songTimeMs <= windowClosesAtMs) continue;

      note.state = 'missed';
      note.hitAtMs = windowClosesAtMs;
      note.resolvedAtMs = nowMs;
      hardFailed = this._recordMiss(note.column, nowMs);
    }

    return hardFailed;
  }

  private _isNoteFadeFinished(note: Note, nowMs: number): boolean {
    if (note.state === 'hit') return nowMs - note.resolvedAtMs >= HIT_FLASH_MS;
    if (note.state === 'missed') return nowMs - note.resolvedAtMs >= MISS_STAMP_MS;
    return false;
  }

  /** Note-space Y of a note's centre at the current song time. */
  private _noteImgY(note: Note): number {
    const referenceMs = note.state === 'falling' ? this._songTimeMs : note.hitAtMs;
    return HIT_ZONE_IMG_CENTER + (referenceMs - note.hitTimeMs) * FALL_SPEED_IMG_PX_PER_MS;
  }

  /** @param songTimeMs - the song clock *at the moment of the press*; see `_processColumnInput`. */
  handleKeyDown(key: string, songTimeMs: number | null): void {
    if (!this.isActive) return;

    const column = this._keyToColumn(key);
    if (column === null) return;
    this._processColumnInput(column, songTimeMs);
  }

  /** @param songTimeMs - the song clock *at the moment of the tap*; see `_processColumnInput`. */
  handleTouchAt(
    x: number,
    y: number,
    canvasW: number,
    canvasH: number,
    songTimeMs: number | null,
  ): void {
    if (!this.isActive) return;

    const layout = computeKeyboardHeroLayout(canvasW, canvasH, platform.isMobile);
    const lane = laneAtPoint(layout, x, y);
    if (lane === null) return;
    if (!isColumnIndex(lane)) return;

    this._processColumnInput(lane, songTimeMs);
  }

  /**
   * Columns follow the movement bindings rather than literal WASD/arrows, so a
   * crawler who plays on ESDF is not handed a minigame they cannot reach.
   */
  private _keyToColumn(key: string): ColumnIndex | null {
    const action = keybindings.actionFor(key);
    if (action === 'moveLeft') return COL_LEFT;
    if (action === 'moveUp') return COL_UP;
    if (action === 'moveDown') return COL_DOWN;
    if (action === 'moveRight') return COL_RIGHT;
    return null;
  }

  /**
   * Input arrives straight off the DOM event, not through the game loop, so it must be
   * judged against the song clock *now* rather than against `_songTimeMs` — which was
   * last written by the previous frame and after a stall is stale by the whole stall.
   * Scoring a press against that stale time turns a machine stutter into two misses and
   * an instant game over.
   *
   * @param songTimeMs - live song clock, or null when the track isn't running.
   */
  private _processColumnInput(column: ColumnIndex, songTimeMs: number | null): void {
    if (this._failed || this._completed) return;

    const pressTimeMs = songTimeMs ?? this._songTimeMs;
    // The press landed inside a suspension: keys still reach this system while the pause
    // menu is up. Swallow it — the next update() abandons the run rather than judging it.
    if (pressTimeMs - this._songTimeMs > SUSPENSION_ABANDON_MS) return;

    const nowMs = this._nowMs();
    this._lanes[column].pressEndsAtMs = nowMs + PRESS_HIGHLIGHT_MS;

    // Claim the *oldest* in-range note in this column, not the nearest one. A late press
    // must never consume a note behind it and strand the one it was aimed at, which would
    // turn one sloppy press into two misses.
    let hitNote: Note | undefined;
    for (const note of this._notes) {
      if (note.state !== 'falling' || note.column !== column) continue;
      if (Math.abs(pressTimeMs - note.hitTimeMs) > HIT_WINDOW_MS) continue;
      if (hitNote === undefined || note.hitTimeMs < hitNote.hitTimeMs) hitNote = note;
    }

    if (hitNote !== undefined) {
      hitNote.state = 'hit';
      hitNote.hitAtMs = pressTimeMs;
      hitNote.resolvedAtMs = nowMs;
      this._hitCount++;
      this._registerHitFeedback(column, pressTimeMs - hitNote.hitTimeMs, nowMs);
    } else {
      // MISS — first miss is forgiven with a flash; second miss ends the game
      this._recordMiss(column, nowMs);
    }
  }

  /** Returns true if this miss triggered a hard fail (second mistake). */
  private _recordMiss(failedColumn: ColumnIndex, nowMs: number): boolean {
    if (this._failed) return false;
    this._missCount++;
    // Always fire the immediate callback so the error sound plays for every mistake.
    this._onFailImmediate?.();
    this._registerMissFeedback(failedColumn, nowMs);

    if (this._missCount >= FATAL_MISS_COUNT) {
      // Second mistake — trigger the full fail sequence.
      this._failed = true;
      this._lanes[failedColumn].errorEndsAtMs = nowMs + FAIL_DELAY_MS;
      this._failAtMs = nowMs + FAIL_DELAY_MS;
      // _onFail fires after FAIL_DELAY_MS via update() — isActive stays true until then.
      return true;
    }

    // First mistake — flash the column red but let play continue.
    this._lanes[failedColumn].errorEndsAtMs = nowMs + ERROR_FLASH_MS;
    return false;
  }

  // ── Feedback bookkeeping ──────────────────────────────────────────────────

  private _registerHitFeedback(lane: ColumnIndex, offsetMs: number, nowMs: number): void {
    const palette = LANE_PALETTES[lane];
    this._lanes[lane].flashEndsAtMs = nowMs + RECEPTOR_FLASH_MS;

    const isPerfect = Math.abs(offsetMs) <= PERFECT_WINDOW_MS;
    this._judgements.push({
      lane,
      text: isPerfect ? 'PERFECT!' : 'HIT!',
      color: isPerfect ? palette.light : palette.hue,
      startedAtMs: nowMs,
    });

    this._spawnSparks(lane, SPARKS_PER_HIT, palette, nowMs);

    this._streak++;
    this._streakPunchedAtMs = nowMs;
    this.hitTickPending = true;
  }

  private _registerMissFeedback(lane: ColumnIndex, nowMs: number): void {
    this._streak = 0;
    this._shakeStartedAtMs = nowMs;
    this._glitchStartedAtMs = nowMs;
    this._judgements.push({ lane, text: 'MISS', color: DANGER_COLOR, startedAtMs: nowMs });

    // Pips shatter from the right, so the leftmost one is the last life left.
    const pipIndex = FIREWALL_PIPS - this._missCount;
    if (pipIndex >= 0 && pipIndex < this._pipShatteredAtMs.length) {
      this._pipShatteredAtMs[pipIndex] = nowMs;
      this.firewallPipShatterPending = true;
    }
  }

  private _spawnSparks(lane: LaneIndex, count: number, palette: LanePalette, nowMs: number): void {
    if (this._sparks.length >= MAX_SPARKS) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * Math.PI;
      const speed =
        SPARK_SPEED_IMG_PER_MS *
        (SPARK_SPEED_MIN_FRACTION + Math.random() * (1 - SPARK_SPEED_MIN_FRACTION));
      this._sparks.push({
        lane,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        bornAtMs: nowMs,
        lifeMs: SPARK_LIFE_MIN_MS + Math.random() * SPARK_LIFE_SPAN_MS,
        color: Math.random() < SPARK_LIGHT_SHADE_CHANCE ? palette.hue : palette.light,
      });
    }
  }

  private _spawnSuccessSparks(nowMs: number): void {
    for (const lane of LANE_INDICES) {
      this._spawnSparks(lane, SUCCESS_SPARKS_PER_LANE, LANE_PALETTES[lane], nowMs);
    }
  }

  private _expireFeedback(nowMs: number): void {
    this._judgements = this._judgements.filter((j) => nowMs - j.startedAtMs < JUDGEMENT_LIFE_MS);
    this._sparks = this._sparks.filter((s) => nowMs - s.bornAtMs < s.lifeMs);
    this._notes = this._notes.filter((n) => !this._isNoteFadeFinished(n, nowMs));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isActive && !this._failed && !this._completed) return;

    const layout = computeKeyboardHeroLayout(viewportWidth(), viewportHeight(), platform.isMobile);
    const nowMs = this._nowMs();

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${SCRIM_ALPHA})`;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    // Everything painted *on* the console rides the shake with it — the pips and
    // counters are printed on the header and footer strips, and a judgement is
    // pinned to its receptor. Leaving them behind detaches the readouts from the
    // hardware they belong to for the whole 180 ms.
    const shake = this._boardShakeOffset(layout, nowMs);
    ctx.save();
    ctx.translate(shake.x, shake.y);

    drawBoardBase(ctx, layout, () => this._laneBedAlpha(nowMs), this._hitLineAlphaScale(nowMs));
    this._drawLaneHighlights(ctx, layout, nowMs);
    this._drawNotes(ctx, layout, nowMs);
    this._drawReceptors(ctx, layout, nowMs);
    this._drawSparks(ctx, layout, nowMs);
    this._drawGlitchBars(ctx, layout, nowMs);
    this._drawHud(ctx, layout, nowMs);
    this._drawJudgements(ctx, layout, nowMs);
    ctx.restore();

    // The touch row sits below the housing, and the countdown and success stamp
    // float over it, so none of the three is part of the thing being shaken.
    this._drawTouchButtons(ctx, layout, nowMs);
    this._drawCountdown(ctx, layout);
    this._drawSuccessFlourish(ctx, layout, nowMs);

    ctx.restore();
  }

  /**
   * A miss jolts the board only. Shaking the camera instead would move the world
   * behind the scrim and the HUD along with it, and a rhythm player needs the
   * next note to stay exactly where they are looking.
   */
  private _boardShakeOffset(layout: KeyboardHeroLayout, nowMs: number): { x: number; y: number } {
    const elapsed = nowMs - this._shakeStartedAtMs;
    if (this._shakeStartedAtMs === 0 || elapsed >= BOARD_SHAKE_MS) return { x: 0, y: 0 };
    const progress = elapsed / BOARD_SHAKE_MS;
    const amplitude = BOARD_SHAKE_IMG * layout.scale * (1 - progress);
    const phase = progress * Math.PI * 2 * BOARD_SHAKE_OSCILLATIONS;
    return {
      x: Math.sin(phase) * amplitude,
      y: Math.sin(phase + BOARD_SHAKE_VERTICAL_PHASE) * amplitude * BOARD_SHAKE_VERTICAL_FRACTION,
    };
  }

  /**
   * 0..1 breathing value on the song's quarter note, phase-locked to the first
   * charted note. Anchoring to the track's zero instead would put the pulse
   * wherever the recording's lead-in happens to leave it, which is a board that
   * visibly breathes off the beat it is asking the player to play on.
   */
  private _beatPulse(): number {
    const beatsSinceFirstNote = (this._songTimeMs - KEYBOARD_HERO_CHART[0].timeMs) / BEAT_PERIOD_MS;
    const phase = beatsSinceFirstNote - Math.floor(beatsSinceFirstNote);
    // A cosine that peaks at the top of the beat and eases away from it.
    return (Math.cos(phase * Math.PI * 2) + 1) / 2;
  }

  /**
   * A lane bed's alpha this frame: the beat's breath, held at the top of the beat
   * through the win.
   *
   * The success sweep is deliberately *not* folded in here. A bed already sits at
   * 0.86 to 1.0 alpha, so adding a flare to it can brighten the lane by 0.14 at
   * the very best and by nothing at all at the top of a beat — and since the song
   * clock stops advancing the moment the run is won, which of those a player got
   * would come down to the phase the winning frame happened to land on. The sweep
   * is an additive highlight instead, where it has somewhere to go.
   */
  private _laneBedAlpha(nowMs: number): number {
    const pulse = this._successFlourishProgress(nowMs) > 0 ? 1 : this._beatPulse();
    return clamp01(1 - BEAT_PULSE_AMPLITUDE + BEAT_PULSE_AMPLITUDE * pulse);
  }

  /** The hit line breathes with the beds, and holds bright through the win. */
  private _hitLineAlphaScale(nowMs: number): number {
    const lineFlare = this._successFlourishProgress(nowMs) > 0 ? 1 : this._beatPulse();
    return 1 - BEAT_PULSE_AMPLITUDE + BEAT_PULSE_AMPLITUDE * lineFlare;
  }

  private _drawLaneHighlights(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    for (const lane of LANE_INDICES) {
      const feedback = this._lanes[lane];
      const errorStrength = remainingFraction(feedback.errorEndsAtMs, ERROR_FLASH_MS, nowMs);
      const pressStrength = remainingFraction(feedback.pressEndsAtMs, PRESS_HIGHLIGHT_MS, nowMs);
      // The win's staggered sweep rides the same additive highlight a press does:
      // it is the only layer with headroom above the lane bed's own brightness.
      const flareStrength = this._successLaneFlare(lane, nowMs) * SUCCESS_FLARE_STRENGTH;
      const strength = Math.max(errorStrength, pressStrength, flareStrength);
      if (strength <= 0) continue;

      // Red is claimed only when the error flash is the loudest thing in the lane
      // *and* actually running. Testing it against the press alone reads a lane
      // that is merely flaring as an error, because a dormant error and a dormant
      // press are both zero and zero is not less than zero.
      const isError = errorStrength > 0 && errorStrength >= Math.max(pressStrength, flareStrength);
      const color = isError ? DANGER_COLOR : LANE_PALETTES[lane].hue;
      drawLaneHighlight(ctx, layout, lane, color, strength);
    }
  }

  private _drawNotes(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    ctx.save();
    clipToLanes(ctx, layout);
    for (const note of this._notes) {
      this._drawNote(ctx, layout, note, nowMs);
    }
    ctx.restore();
  }

  private _drawNote(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    note: Note,
    nowMs: number,
  ): void {
    const imgY = this._noteImgY(note);
    const centerY = noteImgYToScreenY(layout, imgY);
    const laneRect = layout.lanes[note.column];
    const centerX = laneRect.x + laneRect.width / 2;

    let alpha = 1;
    let scale = 1;
    let artState: NoteArtState = 'normal';

    if (note.state === 'hit') {
      // The old alpha-only fade read as the note simply vanishing; popping it
      // outward as it goes reads as the receptor swallowing it.
      const progress = clamp01((nowMs - note.resolvedAtMs) / HIT_FLASH_MS);
      alpha = 1 - progress;
      scale = 1 + NOTE_HIT_POP_SCALE * progress;
      artState = 'hit';
    } else if (note.state === 'missed') {
      const progress = clamp01((nowMs - note.resolvedAtMs) / MISS_STAMP_MS);
      alpha = 1 - progress;
      scale = 1 - NOTE_MISS_SHRINK * progress;
      artState = 'missed';
    } else {
      const fadeSpan = FADE_IN_END_IMG_Y - NOTE_SPAWN_IMG_Y;
      alpha = clamp01((imgY - NOTE_SPAWN_IMG_Y) / fadeSpan);
    }

    const size = layout.noteSize * scale;
    drawNoteKeycap(ctx, note.column, centerX, centerY, size, artState, alpha);
  }

  private _drawReceptors(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    for (const lane of LANE_INDICES) {
      const feedback = this._lanes[lane];
      const flashing = feedback.flashEndsAtMs > nowMs;
      const pressed = feedback.pressEndsAtMs > nowMs;
      drawReceptor(ctx, layout, lane, flashing ? 'flash' : pressed ? 'pressed' : 'idle');
    }
  }

  private _drawSparks(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    if (this._sparks.length === 0) return;
    ctx.save();
    // A spark outstrips its own lane by more than the frame's rail is wide, so an
    // outer-lane hit would otherwise spray particles onto the bare scrim beyond
    // the console. The housing eats them instead.
    ctx.beginPath();
    ctx.rect(layout.board.x, layout.board.y, layout.board.width, layout.board.height);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const spark of this._sparks) {
      const age = nowMs - spark.bornAtMs;
      const life = clamp01(age / spark.lifeMs);
      const laneRect = layout.lanes[spark.lane];
      const dxImg = spark.vx * age;
      const dyImg = spark.vy * age + SPARK_GRAVITY_IMG_PER_MS2 * age * age;
      const x = laneRect.x + laneRect.width / 2 + dxImg * layout.scale;
      const y = layout.hitLineY + dyImg * layout.scale;
      ctx.globalAlpha = 1 - life;
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(x, y, SPARK_RADIUS_IMG * layout.scale * (1 - life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * A one-off scanline tear on a miss, sold as the terminal noticing the
   * intrusion. Kept short and thin: misses happen mid-play, and anything that
   * obscures the next note turns one mistake into two.
   */
  private _drawGlitchBars(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    const elapsed = nowMs - this._glitchStartedAtMs;
    if (this._glitchStartedAtMs === 0 || elapsed >= GLITCH_MS) return;
    const strength = 1 - elapsed / GLITCH_MS;

    ctx.save();
    clipToLanes(ctx, layout);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = DANGER_COLOR;
    const barH = GLITCH_BAR_IMG_H * layout.scale;
    for (let i = 0; i < GLITCH_BAR_COUNT; i++) {
      const t = (i + 1) / (GLITCH_BAR_COUNT + 1);
      const y = layout.laneArea.y + layout.laneArea.height * t;
      const offset = (i % 2 === 0 ? 1 : -1) * GLITCH_BAR_IMG_OFFSET * layout.scale * strength;
      ctx.globalAlpha = GLITCH_BAR_ALPHA * strength;
      ctx.fillRect(layout.laneArea.x + offset, y, layout.laneArea.width, barH);
    }
    ctx.restore();
  }

  private _drawJudgements(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    for (const judgement of this._judgements) {
      const progress = clamp01((nowMs - judgement.startedAtMs) / JUDGEMENT_LIFE_MS);
      const receptor = layout.receptors[judgement.lane];
      const size = JUDGEMENT_SIZE_IMG * layout.scale;
      const baseY = receptor.y - JUDGEMENT_GAP_IMG * layout.scale - size;
      drawText(ctx, judgement.text, {
        x: receptor.x + receptor.width / 2,
        y: baseY - JUDGEMENT_RISE_IMG * layout.scale * progress,
        size,
        bold: true,
        color: judgement.color,
        align: 'center',
        alpha: 1 - progress,
        glow: judgement.color,
        glowBlur: JUDGEMENT_GLOW_BLUR,
        outline: true,
      });
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private _drawHud(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout, nowMs: number): void {
    this._drawFirewallPips(ctx, layout, nowMs);
    this._drawProgress(ctx, layout);
    this._drawCounters(ctx, layout, nowMs);
    this._drawHint(ctx, layout);
  }

  /**
   * The two-strike rule used to be invisible until it killed you. Two pips, one
   * shattering per mistake, teach it without a word of tutorial.
   */
  private _drawFirewallPips(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    const labelSize = HUD_PIP_LABEL_SIZE_IMG * layout.scale;
    const anchor = layout.integrityAnchor;
    const pipSize = layout.integrityPipSize;
    const gap = HUD_PIP_GAP_IMG * layout.scale;
    const labelGap = HUD_LABEL_GAP_IMG * layout.scale;

    // The label and its pips are one stacked block, centred in the header strip:
    // hanging the label off the pips instead pushes it out through the top bezel.
    const blockTop =
      layout.header.y + (layout.header.height - (labelSize + labelGap + pipSize)) / 2;
    const pipsY = blockTop + labelSize + labelGap;

    drawText(ctx, 'FIREWALL', {
      x: anchor.x,
      y: blockTop,
      size: labelSize,
      bold: true,
      color: HUD_MUTED_COLOR,
    });

    for (let pip = 0; pip < FIREWALL_PIPS; pip++) {
      const x = anchor.x + pip * (pipSize + gap);
      const shatteredAtMs = this._pipShatteredAtMs[pip] ?? 0;
      const intact = shatteredAtMs === 0;
      drawFirewallPip(ctx, { x, y: pipsY, width: pipSize, height: pipSize }, intact);
      if (!intact)
        this._drawPipShards(
          ctx,
          layout,
          x + pipSize / 2,
          pipsY + pipSize / 2,
          shatteredAtMs,
          nowMs,
        );
    }
  }

  private _drawPipShards(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    centerX: number,
    centerY: number,
    shatteredAtMs: number,
    nowMs: number,
  ): void {
    const progress = clamp01((nowMs - shatteredAtMs) / PIP_SHATTER_MS);
    if (progress >= 1) return;
    ctx.save();
    // A shard outruns the header strip it was thrown from, so without this the
    // top of the burst lands on the bare scrim above the console.
    ctx.beginPath();
    ctx.rect(layout.board.x, layout.board.y, layout.board.width, layout.board.height);
    ctx.clip();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = PIP_INTACT_BORDER;
    const shardSize = PIP_SHARD_SIZE_IMG * layout.scale;
    for (let shard = 0; shard < PIP_SHARD_COUNT; shard++) {
      const angle = (shard / PIP_SHARD_COUNT) * Math.PI * 2;
      const distance = PIP_SHARD_TRAVEL_IMG * layout.scale * progress;
      ctx.fillRect(
        centerX + Math.cos(angle) * distance - shardSize / 2,
        centerY + Math.sin(angle) * distance - shardSize / 2,
        shardSize,
        shardSize,
      );
    }
    ctx.restore();
  }

  private _drawProgress(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
    const bar = layout.progressBar;
    drawProgressBar(ctx, {
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      value: this._songTimeMs / KEYBOARD_HERO_CHART_END_MS,
      ...PROGRESS_PRESETS.hack,
    });

    const labelSize = HUD_PIP_LABEL_SIZE_IMG * layout.scale;
    drawText(ctx, 'INTRUSION PROGRESS', {
      x: bar.x + bar.width / 2,
      y: bar.y - labelSize - HUD_LABEL_GAP_IMG * layout.scale,
      size: labelSize,
      bold: true,
      color: HUD_MUTED_COLOR,
      align: 'center',
    });

    const remainingMs = Math.max(0, KEYBOARD_HERO_CHART_END_MS - this._songTimeMs);
    const remainingSec = Math.ceil(remainingMs / MS_PER_SECOND);
    const mm = Math.floor(remainingSec / SECONDS_PER_MINUTE);
    const ss = remainingSec % SECONDS_PER_MINUTE;
    const size = HUD_LABEL_SIZE_IMG * layout.scale;
    drawText(ctx, `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`, {
      x: layout.timerAnchor.x,
      y: layout.timerAnchor.y - size / 2,
      size,
      bold: true,
      color: HUD_VALUE_COLOR,
      align: 'right',
    });
  }

  private _drawCounters(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    const size = HUD_LABEL_SIZE_IMG * layout.scale;
    drawText(ctx, `HITS ${this._hitCount}`, {
      x: layout.hitCountAnchor.x,
      y: layout.hitCountAnchor.y - size / 2,
      size,
      bold: true,
      color: HUD_MUTED_COLOR,
    });

    if (this._streak <= 0) return;

    const punch = remainingFraction(
      this._streakPunchedAtMs + STREAK_PUNCH_MS,
      STREAK_PUNCH_MS,
      nowMs,
    );
    const streakSize = HUD_VALUE_SIZE_IMG * layout.scale * (1 + STREAK_PUNCH_SCALE * punch);
    const color = streakColor(this._streak);
    drawText(ctx, `x${this._streak}`, {
      x: layout.streakAnchor.x,
      y: layout.streakAnchor.y - streakSize / 2,
      size: streakSize,
      bold: true,
      color,
      align: 'right',
      glow: color,
      glowBlur: JUDGEMENT_GLOW_BLUR * punch,
    });
  }

  private _drawHint(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
    // On mobile the buttons under the board are the hint; saying it again just
    // spends footer space the streak readout wants.
    if (layout.isMobile) return;
    const size = HUD_HINT_SIZE_IMG * layout.scale;
    drawText(ctx, 'WASD / ARROW KEYS', {
      x: layout.hintAnchor.x,
      y: layout.hintAnchor.y - size / 2,
      size,
      bold: true,
      color: HUD_MUTED_COLOR,
      align: 'center',
    });
  }

  private _drawTouchButtons(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    const buttons = layout.touchButtons;
    if (buttons === null) return;
    for (const lane of LANE_INDICES) {
      const pressed = this._lanes[lane].pressEndsAtMs > nowMs;
      drawTouchButton(ctx, buttons[lane], lane, pressed ? 'pressed' : 'idle');
    }
  }

  /**
   * The first note lands well over a second into the track. Counting the player
   * in over that gap is the difference between a run that starts on the beat and
   * one that starts with a miss.
   */
  private _drawCountdown(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
    if (this._failed || this._completed) return;
    const firstNote = KEYBOARD_HERO_CHART[0];
    const stepMs = firstNote.timeMs / COUNTDOWN_LABELS.length;
    const finalSlot = COUNTDOWN_LABELS.length - 1;
    if (this._songTimeMs >= firstNote.timeMs + COUNTDOWN_LINGER_MS) return;

    // Clamped at both ends, and the lower end is the one that matters: the song
    // clock is latency-corrected, so it reads negative for the first tens of
    // milliseconds of every attempt — the track has begun, but its opening sample
    // has not reached the player's ears yet. Floored, that is slot -1, and the
    // label it indexes does not exist. `drawText` then throws mid-render, the
    // scrim and the board's clip are never popped off the save stack, and every
    // later frame paints inside them: a dark, garbled screen over a floor the
    // player can still walk around, because only rendering died.
    const rawSlot = Math.floor(this._songTimeMs / stepMs);
    const slot = Math.max(0, Math.min(finalSlot, rawSlot));
    const label = COUNTDOWN_LABELS[slot];

    // HACK is held over the first few notes rather than cut at the downbeat: it
    // is the cue that the run has started, and a cue that vanishes exactly as the
    // first note lands is a cue nobody reads.
    const slotSpanMs = slot === finalSlot ? stepMs + COUNTDOWN_LINGER_MS : stepMs;
    const intoSlot = this._songTimeMs - slot * stepMs;
    const slotProgress = clamp01(intoSlot / slotSpanMs);
    const popProgress = clamp01(slotProgress / COUNTDOWN_POP_FRACTION);
    const size = COUNTDOWN_SIZE_IMG * layout.scale * (1 + COUNTDOWN_POP_SCALE * (1 - popProgress));
    const color = slot === finalSlot ? SUCCESS_COLOR : '#e2e8f0';

    drawText(ctx, label, {
      x: layout.boardCenter.x,
      y: layout.boardCenter.y - size / 2,
      size,
      bold: true,
      color,
      align: 'center',
      alpha: 1 - slotProgress * slotProgress,
      glow: color,
      glowBlur: JUDGEMENT_GLOW_BLUR * 2,
      outline: true,
    });
  }

  private _successFlourishProgress(nowMs: number): number {
    if (this._successStartedAtMs === 0) return 0;
    const elapsed = nowMs - this._successStartedAtMs;
    if (elapsed >= SUCCESS_FLOURISH_MS) return 0;
    return clamp01(elapsed / SUCCESS_FLOURISH_MS);
  }

  private _successLaneFlare(lane: LaneIndex, nowMs: number): number {
    if (this._successStartedAtMs === 0) return 0;
    const elapsed = nowMs - this._successStartedAtMs - lane * SUCCESS_LANE_STAGGER_MS;
    if (elapsed < 0 || elapsed >= SUCCESS_LANE_FLARE_MS) return 0;
    return 1 - elapsed / SUCCESS_LANE_FLARE_MS;
  }

  private _drawSuccessFlourish(
    ctx: CanvasRenderingContext2D,
    layout: KeyboardHeroLayout,
    nowMs: number,
  ): void {
    const progress = this._successFlourishProgress(nowMs);
    if (progress <= 0) return;

    const popProgress = clamp01(progress / SUCCESS_STAMP_POP_FRACTION);
    const size =
      SUCCESS_STAMP_SIZE_IMG * layout.scale * (1 + SUCCESS_STAMP_POP_SCALE * (1 - popProgress));
    drawText(ctx, 'ACCESS GRANTED', {
      x: layout.boardCenter.x,
      y: layout.boardCenter.y - size / 2,
      size,
      bold: true,
      color: SUCCESS_COLOR,
      align: 'center',
      glow: SUCCESS_COLOR,
      glowBlur: JUDGEMENT_GLOW_BLUR * 2,
      outline: true,
    });
  }
}

function createLaneFeedback(): readonly [LaneFeedback, LaneFeedback, LaneFeedback, LaneFeedback] {
  const blank = (): LaneFeedback => ({ errorEndsAtMs: 0, pressEndsAtMs: 0, flashEndsAtMs: 0 });
  return [blank(), blank(), blank(), blank()];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** How much of a timer that ends at `endsAtMs` and ran for `spanMs` is left, as 0..1. */
function remainingFraction(endsAtMs: number, spanMs: number, nowMs: number): number {
  if (endsAtMs <= nowMs) return 0;
  return clamp01((endsAtMs - nowMs) / spanMs);
}

function streakColor(streak: number): string {
  for (const step of STREAK_COLOR_RAMP) {
    if (streak >= step.atLeast) return step.color;
  }
  return HUD_MUTED_COLOR;
}
