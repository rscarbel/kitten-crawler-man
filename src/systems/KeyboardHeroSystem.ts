/**
 * KeyboardHeroSystem — Guitar Hero-style mini-game for the "hacking the computer"
 * sequence in the Spider Quest.
 *
 * Four columns map to arrow keys / WASD. Notes fall from the top of the playing
 * field toward a green hit zone near the bottom. Hit a note while it's in the
 * zone to score. One mistake is forgiven (red flash only); a second mistake ends
 * the game after a short delay.
 *
 * Notes come from a baked chart (`keyboardHeroChart.ts`) rather than a random
 * spawner: each entry is an attack in the music, and a note reaches the centre of
 * the green zone exactly when that attack sounds. Positions are derived from the
 * track's own playback clock, not from a frame counter, so a dropped frame slides
 * the note rather than desyncing it from the melody. The game ends once the last
 * charted note has resolved — the audio is left to finish its tail on its own (do
 * NOT stop it on success).
 */

import { getSpriteDef } from '../core/SpriteLoader';
import { platform } from '../core/Platform';
import { keybindings } from '../core/Keybindings';
import { drawText } from '../ui/TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { KEYBOARD_HERO_CHART, KEYBOARD_HERO_CHART_END_MS } from './keyboardHeroChart';
import type { KeyboardHeroColumn } from './keyboardHeroChart';
import {
  FADE_IN_END_IMG_Y,
  FALL_SPEED_IMG_PX_PER_MS,
  FIELD_IMG_H,
  FIELD_IMG_W,
  HIT_WINDOW_MS,
  HIT_ZONE_IMG_BOTTOM,
  HIT_ZONE_IMG_CENTER,
  HIT_ZONE_IMG_TOP,
  MAX_PLAYABLE_GAP_MS,
  NOTE_SPAWN_IMG_Y,
  NOTE_TRAVEL_MS,
} from './keyboardHeroGeometry';

/** Frames per second, used only by the timers that are not tied to the music. */
const FPS = 60;

/** Milliseconds per second. */
const MS_PER_SECOND = 1_000;

const SECONDS_PER_MINUTE = 60;

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

/** Error overlay duration in frames (normal column flash on miss). */
const ERROR_TIMER_FRAMES = 60;

/** How long the failed column stays red after a miss before the fail callback fires (2 s). */
const FAIL_DELAY_FRAMES = 120;

/** Flash duration for a successfully-clicked note. */
const HIT_FLASH_MS = 250;

// Render constants
const RENDER_OVERLAY_ALPHA = 0.82;
const RENDER_FIELD_HEIGHT_RATIO = 0.85;
const RENDER_FIELD_WIDTH_RATIO = 0.9;
const RENDER_HIT_ZONE_ALPHA = 0.18;
const RENDER_COLUMN_COUNT = 4;
const RENDER_MOBILE_BOTTOM_OFFSET = 28;
const RENDER_TIMER_Y_OFFSET = 8;

// Column indices as constants
const COL_LEFT = 0;
const COL_UP = 1;
const COL_DOWN = 2;
const COL_RIGHT = 3;

type ColumnIndex = KeyboardHeroColumn;

interface Note {
  column: ColumnIndex;
  /** Song time at which this note is perfectly centred in the hit zone. */
  hitTimeMs: number;
  state: 'falling' | 'hit';
  /** Song time the player struck it; only meaningful once state is 'hit'. */
  hitAtMs: number;
}

interface ColumnState {
  /** Counts down from ERROR_TIMER_FRAMES on a miss; 0 = no error active. */
  errorTimer: number;
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

  // Callbacks
  private _onComplete: (() => void) | null = null;
  private _onFail: (() => void) | null = null;
  /** Called immediately when the player misses (before the delay). Use to play the error sound. */
  private _onFailImmediate: (() => void) | null = null;

  // State
  private _songTimeMs = 0;
  private _notes: Note[] = [];
  private _columns: readonly [ColumnState, ColumnState, ColumnState, ColumnState] = [
    { errorTimer: 0 },
    { errorTimer: 0 },
    { errorTimer: 0 },
    { errorTimer: 0 },
  ];
  private _hitCount = 0;
  private _missCount = 0;
  private _failed = false;
  private _completed = false;
  /** Counts down after a miss; _onFail fires when it reaches 0. */
  private _failDelayTimer = 0;

  /** Index of the next chart entry that has yet to enter the field. */
  private _nextChartIndex = 0;

  start(onComplete: () => void, onFail: () => void, onFailImmediate?: () => void): void {
    this._onComplete = onComplete;
    this._onFail = onFail;
    this._onFailImmediate = onFailImmediate ?? null;
    this._songTimeMs = 0;
    this._notes = [];
    this._columns = [{ errorTimer: 0 }, { errorTimer: 0 }, { errorTimer: 0 }, { errorTimer: 0 }];
    this._hitCount = 0;
    this._missCount = 0;
    this._failed = false;
    this._completed = false;
    this._failDelayTimer = 0;
    this._nextChartIndex = 0;
    this.isActive = true;
  }

  /**
   * Snapshots the attempt's scoring state so a death rewinds a hack the player
   * completed after checking in.
   *
   * Only the run's verdict is stored. The live field (`_notes`, `_columns`,
   * `_songTimeMs`, the fail delay) belongs to an attempt that is driven by the
   * track's own clock, and `start` rebuilds all of it from scratch — restoring a
   * half-played field against a song that is no longer playing would resume a
   * run mid-air with no way to judge it.
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

  stop(): void {
    this.isActive = false;
    this._onComplete = null;
    this._onFail = null;
    this._onFailImmediate = null;
  }

  /**
   * @param songTimeMs - playback position of the keyboard-hero track, or null when
   *   the track isn't running (no audio, or still starting). Falls back to a frame
   *   counter so the mini-game stays playable without sound.
   */
  update(songTimeMs: number | null): void {
    if (!this.isActive) return;
    if (this._completed) return;

    // While waiting for the fail-delay to expire, only tick timers then bail.
    if (this._failed) {
      if (this._failDelayTimer > 0) {
        this._failDelayTimer--;
        for (const col of this._columns) {
          if (col.errorTimer > 0) col.errorTimer--;
        }
        if (this._failDelayTimer <= 0) {
          this.isActive = false;
          this._onFail?.();
        }
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

    for (const col of this._columns) {
      if (col.errorTimer > 0) {
        col.errorTimer--;
      }
    }

    this._admitDueChartNotes();

    // Misses are judged here rather than being held back for input that a stall may
    // still have queued. The HTML event loop runs tasks — which is how a discrete
    // keydown is dispatched — before the rendering steps that run this callback, so a
    // press made during a stall has already been scored, against its own timestamp, by
    // the time we get here. Deferring instead was tried and is worse: any rule strong
    // enough to survive `Scene.loop`'s same-callback catch-up update also refuses to
    // expire notes at a steady low frame rate, which makes the run unloseable.
    if (this._resolveExpiredNotes()) return;

    this._notes = this._notes.filter((n) => !this._isHitFlashFinished(n));

    // Reaching the end of the track is not enough on its own — every charted note
    // must actually have been played, so a run that skipped ahead cannot pass.
    const chartExhausted = this._nextChartIndex >= KEYBOARD_HERO_CHART.length;
    if (this._songTimeMs >= KEYBOARD_HERO_CHART_END_MS && chartExhausted) {
      this._completed = true;
      this.isActive = false;
      this._onComplete?.();
    }
  }

  /** End the attempt without a red-column flash: nothing the player did caused it. */
  private _abandonRun(): void {
    this._failed = true;
    this._failDelayTimer = 0;
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
      });
      this._nextChartIndex++;
    }
  }

  /**
   * Drop notes that have fallen past their hit window, counting each as a miss.
   * Returns true if that triggered a hard fail (the caller must stop updating).
   */
  private _resolveExpiredNotes(): boolean {
    const stillLive: Note[] = [];
    let hardFailed = false;

    for (const note of this._notes) {
      const windowClosesAtMs = note.hitTimeMs + HIT_WINDOW_MS;
      if (hardFailed || note.state !== 'falling' || this._songTimeMs <= windowClosesAtMs) {
        stillLive.push(note);
        continue;
      }

      hardFailed = this._recordMiss(note.column);
    }

    this._notes = stillLive;
    return hardFailed;
  }

  private _isHitFlashFinished(note: Note): boolean {
    return note.state === 'hit' && this._songTimeMs - note.hitAtMs >= HIT_FLASH_MS;
  }

  /** Image-Y of a note's centre at the current song time. */
  private _noteImgY(note: Note): number {
    const referenceMs = note.state === 'hit' ? note.hitAtMs : this._songTimeMs;
    return HIT_ZONE_IMG_CENTER + (referenceMs - note.hitTimeMs) * FALL_SPEED_IMG_PX_PER_MS;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isActive && !this._failed && !this._completed) return;

    // 1. Semi-transparent black overlay over entire canvas
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${RENDER_OVERLAY_ALPHA})`;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    // 2. Calculate display dimensions
    const scaleH = (viewportHeight() * RENDER_FIELD_HEIGHT_RATIO) / FIELD_IMG_H;
    const scaleW = (viewportWidth() * RENDER_FIELD_WIDTH_RATIO) / FIELD_IMG_W;
    const scale = Math.min(scaleH, scaleW);
    const dw = FIELD_IMG_W * scale;
    const dh = FIELD_IMG_H * scale;
    const dx = (viewportWidth() - dw) / 2;
    const dy = (viewportHeight() - dh) / 2;

    // 3. Draw base playing field
    this._drawFieldSprite(ctx, 'base_container', dx, dy, dw, dh, 1);

    // 4. Draw column error overlays
    const columnErrorStateNames: readonly [string, string, string, string] = [
      'column_1_error',
      'column_2_error',
      'column_3_error',
      'column_4_error',
    ];
    const allColumnIndices: readonly ColumnIndex[] = [COL_LEFT, COL_UP, COL_DOWN, COL_RIGHT];
    for (const col of allColumnIndices) {
      const colState = this._columns[col];
      if (colState.errorTimer > 0) {
        // Fade out the overlay as the timer decreases
        const alpha = colState.errorTimer / ERROR_TIMER_FRAMES;
        this._drawFieldSprite(ctx, columnErrorStateNames[col], dx, dy, dw, dh, alpha);
      }
    }

    // 5. Draw green hit zone tint
    const hitZoneScreenTop = dy + HIT_ZONE_IMG_TOP * scale;
    const hitZoneScreenH = (HIT_ZONE_IMG_BOTTOM - HIT_ZONE_IMG_TOP) * scale;
    ctx.save();
    ctx.globalAlpha = RENDER_HIT_ZONE_ALPHA;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(dx, hitZoneScreenTop, dw, hitZoneScreenH);
    ctx.restore();

    // 6. Draw notes
    for (const note of this._notes) {
      this._drawNote(ctx, note, dx, dy, dw, scale);
    }

    // 7. Song timer overlay
    const remainingMs = Math.max(0, KEYBOARD_HERO_CHART_END_MS - this._songTimeMs);
    const remainingSec = Math.floor(remainingMs / MS_PER_SECOND);
    const mm = Math.floor(remainingSec / SECONDS_PER_MINUTE);
    const ss = remainingSec % SECONDS_PER_MINUTE;
    const timeStr = `Song: ${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')} remaining`;
    drawText(ctx, timeStr, {
      x: dx + dw / 2,
      y: dy + RENDER_TIMER_Y_OFFSET,
      size: 13,
      bold: true,
      color: '#e2e8f0',
      align: 'center',
      outline: true,
    });

    // Mobile hint
    if (platform.isMobile) {
      drawText(ctx, 'Tap each column to hit notes!', {
        x: dx + dw / 2,
        y: dy + dh - RENDER_MOBILE_BOTTOM_OFFSET,
        size: 10,
        color: '#94a3b8',
        align: 'center',
        outline: true,
      });
    } else {
      drawText(ctx, 'WASD / Arrow Keys', {
        x: dx + dw / 2,
        y: dy + dh - RENDER_MOBILE_BOTTOM_OFFSET,
        size: 10,
        color: '#94a3b8',
        align: 'center',
        outline: true,
      });
    }

    ctx.restore();
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

    // Recalculate display bounds (same as render)
    const scaleH = (canvasH * RENDER_FIELD_HEIGHT_RATIO) / FIELD_IMG_H;
    const scaleW = (canvasW * RENDER_FIELD_WIDTH_RATIO) / FIELD_IMG_W;
    const scale = Math.min(scaleH, scaleW);
    const dw = FIELD_IMG_W * scale;
    const dh = FIELD_IMG_H * scale;
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;

    // Must be within the field image bounds
    if (x < dx || x > dx + dw) return;
    if (y < dy || y > dy + dh) return;

    // Determine column from x position
    const relX = x - dx;
    const colWidth = dw / RENDER_COLUMN_COUNT;
    const colIndex = Math.floor(relX / colWidth);
    if (!isColumnIndex(colIndex)) return;

    this._processColumnInput(colIndex, songTimeMs);
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
      this._hitCount++;
    } else {
      // MISS — first miss is forgiven with a flash; second miss ends the game
      this._recordMiss(column);
    }
  }

  /** Returns true if this miss triggered a hard fail (second mistake). */
  private _recordMiss(failedColumn: ColumnIndex): boolean {
    if (this._failed) return false;
    this._missCount++;
    // Always fire the immediate callback so the error sound plays for every mistake.
    this._onFailImmediate?.();

    if (this._missCount >= 2) {
      // Second mistake — trigger the full fail sequence.
      this._failed = true;
      this._columns[failedColumn].errorTimer = FAIL_DELAY_FRAMES;
      this._failDelayTimer = FAIL_DELAY_FRAMES;
      // _onFail fires after FAIL_DELAY_FRAMES via update() — isActive stays true until then.
      return true;
    } else {
      // First mistake — flash the column red but let play continue.
      this._columns[failedColumn].errorTimer = ERROR_TIMER_FRAMES;
      return false;
    }
  }

  /**
   * Draw a sprite from the keyboard_hero_playing_field sheet.
   * State name must be a valid state key in that sprite's manifest entry.
   */
  private _drawFieldSprite(
    ctx: CanvasRenderingContext2D,
    stateName: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    alpha: number,
  ): void {
    const def = getSpriteDef('keyboard_hero_playing_field');
    if (def === undefined) return;

    const state = def.states.get(stateName);
    if (state === undefined) return;

    const colOff = state.colOffset ?? 0;
    const srcX = colOff * def.frameWidth;
    const srcY = state.row * def.frameHeight;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(def.img, srcX, srcY, def.frameWidth, def.frameHeight, dx, dy, dw, dh);
    ctx.restore();
  }

  /**
   * Draw a single note button sprite.
   */
  private _drawNote(
    ctx: CanvasRenderingContext2D,
    note: Note,
    fieldDx: number,
    fieldDy: number,
    fieldDw: number,
    scale: number,
  ): void {
    const def = getSpriteDef('keyboard_hero_buttons');
    if (def === undefined) return;

    const buttonStateName = this._noteButtonStateName(note);
    const state = def.states.get(buttonStateName);
    if (state === undefined) return;

    const colOff = state.colOffset ?? 0;
    const srcX = colOff * def.frameWidth;
    const srcY = state.row * def.frameHeight;

    // Screen position: center the button sprite at the note's image-Y
    const imgY = this._noteImgY(note);
    const screenY = fieldDy + imgY * scale - (def.frameHeight * scale) / 2;

    // Column center x in screen coords
    const colWidth = fieldDw / RENDER_COLUMN_COUNT;
    const colCenterX = fieldDx + note.column * colWidth + colWidth / 2;
    const buttonW = def.frameWidth * scale;
    const buttonH = def.frameHeight * scale;
    const screenX = colCenterX - buttonW / 2;

    ctx.save();

    if (note.state === 'hit') {
      const flashProgress = (this._songTimeMs - note.hitAtMs) / HIT_FLASH_MS;
      ctx.globalAlpha = Math.max(0, 1 - flashProgress);
    } else {
      // Fade in from the top of the field to FADE_IN_END_IMG_Y
      const fadeSpan = FADE_IN_END_IMG_Y - NOTE_SPAWN_IMG_Y;
      ctx.globalAlpha = Math.min(1, Math.max(0, (imgY - NOTE_SPAWN_IMG_Y) / fadeSpan));
    }

    ctx.drawImage(
      def.img,
      srcX,
      srcY,
      def.frameWidth,
      def.frameHeight,
      screenX,
      screenY,
      buttonW,
      buttonH,
    );
    ctx.restore();
  }

  private _noteButtonStateName(note: Note): string {
    if (note.state === 'hit') return 'successfully_clicked';

    // Map column index to arrow direction
    switch (note.column) {
      case COL_LEFT:
        return 'left_arrow';
      case COL_UP:
        return 'up_arrow';
      case COL_DOWN:
        return 'down_arrow';
      case COL_RIGHT:
        return 'right_arrow';
    }
  }
}
