/**
 * KeyboardHeroSystem — Guitar Hero-style mini-game for the "hacking the computer"
 * sequence in the Spider Quest.
 *
 * Four columns map to arrow keys / WASD. Notes fall from the top of the playing
 * field toward a green hit zone near the bottom. Hit a note while it's in the
 * zone to score. One mistake is forgiven (red flash only); a second mistake ends
 * the game after a short delay.
 *
 * Song duration: 71 758 ms. ~80 notes total.
 */

import { getSpriteDef } from '../core/SpriteLoader';
import { platform } from '../core/Platform';
import { drawText } from '../ui/TextBox';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Song length in milliseconds. */
const SONG_DURATION_MS = 71_758;

/** How many image-pixels per second a note falls. */
const FALL_SPEED_IMG_PX_PER_SEC = 480;

/** Frames per second (used for elapsedMs accumulation). */
const FPS = 60;

/** MS added per frame. */
const MS_PER_FRAME = 1_000 / FPS;

/** Playing-field image dimensions (from manifest). */
const FIELD_IMG_W = 426;
const FIELD_IMG_H = 586;

/** Green hit zone in image-Y coordinates: the visible green band in the playing field. */
const HIT_ZONE_IMG_TOP = 455;
const HIT_ZONE_IMG_BOTTOM = 555;

/** Height of each button image (99 px). */
const NOTE_IMG_HEIGHT = 99;
const NOTE_IMG_HALF_HEIGHT = NOTE_IMG_HEIGHT / 2;

/**
 * imgY is the CENTER of the note.
 * A note is hittable when it overlaps the green zone:
 *   bottom of note (imgY + half) >= HIT_ZONE_IMG_TOP  →  imgY >= HIT_ZONE_IMG_TOP - half
 *   top of note   (imgY - half) <= HIT_ZONE_IMG_BOTTOM →  imgY <= HIT_ZONE_IMG_BOTTOM + half
 */
const HIT_ZONE_CENTER_MIN = HIT_ZONE_IMG_TOP - NOTE_IMG_HALF_HEIGHT; // 455 - 49.5 = 405.5
const HIT_ZONE_CENTER_MAX = HIT_ZONE_IMG_BOTTOM + NOTE_IMG_HALF_HEIGHT; // 555 + 49.5 = 604.5

/** A note entering within this many img-px above the hittable zone is "approaching" — don't spawn another in the same column. */
const APPROACH_GUARD_IMG_PX = 200;

/** Error overlay duration in frames (normal column flash on miss). */
const ERROR_TIMER_FRAMES = 60;

/** How long the failed column stays red after a miss before the fail callback fires (2 s). */
const FAIL_DELAY_FRAMES = 120;

/** Flash duration for a successfully-clicked note. */
const HIT_FLASH_FRAMES = 15;

/** Notes fade in from fully transparent at the top to fully opaque here (image-Y). */
const FADE_IN_END_IMG_Y = 220;

/** Target total notes. */
const TARGET_NOTE_COUNT = 160;

/** Min/max ms between note spawns. */
const SPAWN_INTERVAL_MIN_MS = 250;
const SPAWN_INTERVAL_MAX_MS = 900;

/** Never more than this many notes alive across all columns simultaneously. */
const MAX_SIMULTANEOUS_NOTES = 4;

/** Stop spawning new notes this many ms before the song ends. */
const SPAWN_CUTOFF_MS = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnIndex = 0 | 1 | 2 | 3;

interface Note {
  column: ColumnIndex;
  /** Current Y position in image coordinates (0 = top of field, 586 = bottom). */
  imgY: number;
  state: 'falling' | 'hit' | 'missed';
  /** Counts down from HIT_FLASH_FRAMES after a hit, then note is removed. */
  hitFlashTimer: number;
}

interface ColumnState {
  /** Counts down from ERROR_TIMER_FRAMES on a miss; 0 = no error active. */
  errorTimer: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (xorshift32) — deterministic pseudo-random for note scheduling
// ---------------------------------------------------------------------------

function xorshift32(state: number): number {
  let s = state;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  // Ensure unsigned 32-bit
  return s >>> 0;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isColumnIndex(n: number): n is ColumnIndex {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

// ---------------------------------------------------------------------------
// KeyboardHeroSystem
// ---------------------------------------------------------------------------

export class KeyboardHeroSystem {
  isActive = false;

  // Callbacks
  private _onComplete: (() => void) | null = null;
  private _onFail: (() => void) | null = null;
  /** Called immediately when the player misses (before the delay). Use to play the error sound. */
  private _onFailImmediate: (() => void) | null = null;

  // State
  private _elapsedMs = 0;
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

  // Note scheduling
  private _rngState = 0x12345678;
  private _nextSpawnMs = 0;
  private _totalSpawned = 0;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start(onComplete: () => void, onFail: () => void, onFailImmediate?: () => void): void {
    this._onComplete = onComplete;
    this._onFail = onFail;
    this._onFailImmediate = onFailImmediate ?? null;
    this._elapsedMs = 0;
    this._notes = [];
    this._columns = [{ errorTimer: 0 }, { errorTimer: 0 }, { errorTimer: 0 }, { errorTimer: 0 }];
    this._hitCount = 0;
    this._missCount = 0;
    this._failed = false;
    this._completed = false;
    this._failDelayTimer = 0;
    this._rngState = 0x12345678;
    this._totalSpawned = 0;
    this._nextSpawnMs = this._nextSpawnInterval();
    this.isActive = true;
  }

  stop(): void {
    this.isActive = false;
    this._onComplete = null;
    this._onFail = null;
    this._onFailImmediate = null;
  }

  update(): void {
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

    this._elapsedMs += MS_PER_FRAME;

    // Tick column error timers
    for (const col of this._columns) {
      if (col.errorTimer > 0) {
        col.errorTimer--;
      }
    }

    // Move notes
    const imgPxPerFrame = FALL_SPEED_IMG_PX_PER_SEC / FPS;
    for (const note of this._notes) {
      if (note.state === 'falling') {
        note.imgY += imgPxPerFrame;
      }
      if (note.state === 'hit') {
        note.hitFlashTimer--;
      }
    }

    // Check for notes that have fallen past the hit zone (top of note past HIT_ZONE_IMG_BOTTOM)
    for (const note of this._notes) {
      if (note.state === 'falling' && note.imgY > HIT_ZONE_CENTER_MAX) {
        note.state = 'missed';
        const hardFail = this._recordMiss(note.column);
        if (hardFail) return;
      }
    }

    // Remove expired hit-flash notes and consumed missed notes
    this._notes = this._notes.filter(
      (n) => !(n.state === 'hit' && n.hitFlashTimer <= 0) && n.state !== 'missed',
    );

    // Spawn notes
    this._maybeSpawnNote();

    // Song complete
    if (this._elapsedMs >= SONG_DURATION_MS) {
      this._completed = true;
      this.isActive = false;
      this._onComplete?.();
    }
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.isActive && !this._failed && !this._completed) return;

    // 1. Semi-transparent black overlay over entire canvas
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Calculate display dimensions
    const scaleH = (canvas.height * 0.85) / FIELD_IMG_H;
    const scaleW = (canvas.width * 0.9) / FIELD_IMG_W;
    const scale = Math.min(scaleH, scaleW);
    const dw = FIELD_IMG_W * scale;
    const dh = FIELD_IMG_H * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    // 3. Draw base playing field
    this._drawFieldSprite(ctx, 'base_container', dx, dy, dw, dh, 1);

    // 4. Draw column error overlays
    const columnErrorStateNames: readonly [string, string, string, string] = [
      'column_1_error',
      'column_2_error',
      'column_3_error',
      'column_4_error',
    ];
    const allColumnIndices: readonly ColumnIndex[] = [0, 1, 2, 3];
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
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(dx, hitZoneScreenTop, dw, hitZoneScreenH);
    ctx.restore();

    // 6. Draw notes
    for (const note of this._notes) {
      this._drawNote(ctx, note, dx, dy, dw, scale);
    }

    // 7. Song timer overlay
    const remainingMs = Math.max(0, SONG_DURATION_MS - this._elapsedMs);
    const remainingSec = Math.floor(remainingMs / 1_000);
    const mm = Math.floor(remainingSec / 60);
    const ss = remainingSec % 60;
    const timeStr = `Song: ${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')} remaining`;
    drawText(ctx, timeStr, {
      x: dx + dw / 2,
      y: dy + 8,
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
        y: dy + dh - 28,
        size: 10,
        color: '#94a3b8',
        align: 'center',
        outline: true,
      });
    } else {
      drawText(ctx, 'WASD / Arrow Keys', {
        x: dx + dw / 2,
        y: dy + dh - 28,
        size: 10,
        color: '#94a3b8',
        align: 'center',
        outline: true,
      });
    }

    ctx.restore();
  }

  handleKeyDown(key: string): void {
    if (!this.isActive) return;

    const column = this._keyToColumn(key);
    if (column === null) return;
    this._processColumnInput(column);
  }

  handleTouchAt(x: number, y: number, canvasW: number, canvasH: number): void {
    if (!this.isActive) return;

    // Recalculate display bounds (same as render)
    const scaleH = (canvasH * 0.85) / FIELD_IMG_H;
    const scaleW = (canvasW * 0.9) / FIELD_IMG_W;
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
    const colWidth = dw / 4;
    const colIndex = Math.floor(relX / colWidth);
    if (!isColumnIndex(colIndex)) return;

    this._processColumnInput(colIndex);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _keyToColumn(key: string): ColumnIndex | null {
    const lower = key.toLowerCase();
    if (lower === 'arrowleft' || lower === 'a') return 0;
    if (lower === 'arrowup' || lower === 'w') return 1;
    if (lower === 'arrowdown' || lower === 's') return 2;
    if (lower === 'arrowright' || lower === 'd') return 3;
    return null;
  }

  private _processColumnInput(column: ColumnIndex): void {
    if (this._failed || this._completed) return;

    // Find a note whose extent overlaps the green hit zone
    const hitNote = this._notes.find(
      (n) =>
        n.state === 'falling' &&
        n.column === column &&
        n.imgY >= HIT_ZONE_CENTER_MIN &&
        n.imgY <= HIT_ZONE_CENTER_MAX,
    );

    if (hitNote !== undefined) {
      // HIT
      hitNote.state = 'hit';
      hitNote.hitFlashTimer = HIT_FLASH_FRAMES;
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

  private _maybeSpawnNote(): void {
    if (this._elapsedMs < this._nextSpawnMs) return;

    // Don't spawn if we've hit our target
    if (this._totalSpawned >= TARGET_NOTE_COUNT) return;

    // Don't spawn in the last second of the song
    if (this._elapsedMs >= SONG_DURATION_MS - SPAWN_CUTOFF_MS) return;

    // Don't spawn if max simultaneous notes reached
    const activeNotes = this._notes.filter((n) => n.state === 'falling').length;
    if (activeNotes >= MAX_SIMULTANEOUS_NOTES) {
      // Reschedule slightly later
      this._nextSpawnMs = this._elapsedMs + 100;
      return;
    }

    // Find eligible columns (no note near or in the zone for that column)
    const eligibleColumns: ColumnIndex[] = [];
    for (const colIdx of [0, 1, 2, 3] as const) {
      const blocked = this._notes.some(
        (n) =>
          n.state === 'falling' &&
          n.column === colIdx &&
          n.imgY >= HIT_ZONE_CENTER_MIN - APPROACH_GUARD_IMG_PX,
      );
      if (!blocked) {
        eligibleColumns.push(colIdx);
      }
    }

    if (eligibleColumns.length === 0) {
      this._nextSpawnMs = this._elapsedMs + 80;
      return;
    }

    // Pick a random eligible column
    this._rngState = xorshift32(this._rngState);
    const pick = this._rngState % eligibleColumns.length;
    // Iterate to the desired index — avoids unsafe array indexing
    let column: ColumnIndex | undefined;
    let idx = 0;
    for (const c of eligibleColumns) {
      if (idx === pick) {
        column = c;
        break;
      }
      idx++;
    }
    if (column === undefined) return;

    this._notes.push({
      column,
      imgY: 0,
      state: 'falling',
      hitFlashTimer: 0,
    });
    this._totalSpawned++;
    this._nextSpawnMs = this._elapsedMs + this._nextSpawnInterval();
  }

  private _nextSpawnInterval(): number {
    this._rngState = xorshift32(this._rngState);
    const range = SPAWN_INTERVAL_MAX_MS - SPAWN_INTERVAL_MIN_MS;
    // Use upper bits for better distribution
    const rand = (this._rngState >>> 8) / 0xffffff;
    return SPAWN_INTERVAL_MIN_MS + rand * range;
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

    // Screen position: center the 99px button sprite at the note's image-Y
    const screenY = fieldDy + note.imgY * scale - (def.frameHeight * scale) / 2;

    // Column center x in screen coords
    const colWidth = fieldDw / 4;
    const colCenterX = fieldDx + note.column * colWidth + colWidth / 2;
    const buttonW = def.frameWidth * scale;
    const buttonH = def.frameHeight * scale;
    const screenX = colCenterX - buttonW / 2;

    ctx.save();

    if (note.state === 'hit') {
      ctx.globalAlpha = note.hitFlashTimer / HIT_FLASH_FRAMES;
    } else {
      // Fade in from top: transparent at imgY=0, fully opaque at FADE_IN_END_IMG_Y
      ctx.globalAlpha = Math.min(1, note.imgY / FADE_IN_END_IMG_Y);
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
      case 0:
        return 'left_arrow';
      case 1:
        return 'up_arrow';
      case 2:
        return 'down_arrow';
      case 3:
        return 'right_arrow';
    }
  }
}
