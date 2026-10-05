import type { AudioManager } from '../audio/AudioManager';

const ALPHA_VISIBILITY_THRESHOLD = 0.5;
const ALPHA_MAX = 0.82;
const ALPHA_INCREMENT_PER_FRAME = 0.018;
const TEXT_ALPHA_START_THRESHOLD = 0.45;
const TEXT_ALPHA_FADE_RANGE = 0.37;

/**
 * Where a death screen exit sends the player: the floor restart, or the last
 * save point — a safe room, entering town, or arriving on the floor.
 */
export type RespawnMode = 'floorRestart' | 'checkpoint';

/**
 * The "YOU DIED" overlay's state: whether it is up, its fade-in, and what it
 * says. The view advances the fade by calling tick() once per drawn frame.
 */
export class DeathScreen {
  private alpha = 0;
  private _active = false;
  private _explanation = '';
  private _mode: RespawnMode = 'floorRestart';
  audio: AudioManager | null = null;

  /** Activate the death screen — begins the fade-in from alpha 0. */
  activate(explanation: string, mode: RespawnMode = 'floorRestart'): void {
    this._active = true;
    this.alpha = 0;
    this._explanation = explanation;
    this._mode = mode;
    this.audio?.play('death_sequence');
  }

  /** Reset to inactive state (call on game restart). */
  reset(): void {
    this._active = false;
    this.alpha = 0;
    this._explanation = '';
    this._mode = 'floorRestart';
    this.audio?.stopSound('death_sequence');
  }

  get isActive(): boolean {
    return this._active;
  }

  /** The flavour line naming what killed the party; empty when there is none. */
  get explanation(): string {
    return this._explanation;
  }

  get respawnMode(): RespawnMode {
    return this._mode;
  }

  /** How dark the backdrop has faded in so far, from 0 up to its full opacity. */
  get fadeAlpha(): number {
    return this.alpha;
  }

  /** How far the headline, text and button have faded in: 0 until the backdrop is dark enough to hold them. */
  get contentAlpha(): number {
    if (!this._active) return 0;
    return Math.max(
      0,
      Math.min(1, (this.alpha - TEXT_ALPHA_START_THRESHOLD) / TEXT_ALPHA_FADE_RANGE),
    );
  }

  /** True once the overlay is opaque enough to show interactive elements. */
  get isVisible(): boolean {
    return this._active && this.alpha >= ALPHA_VISIBILITY_THRESHOLD;
  }

  /** Advance the fade-in alpha by one frame. */
  tick(): void {
    if (!this._active) return;
    if (this.alpha < ALPHA_MAX)
      this.alpha = Math.min(ALPHA_MAX, this.alpha + ALPHA_INCREMENT_PER_FRAME);
  }
}
