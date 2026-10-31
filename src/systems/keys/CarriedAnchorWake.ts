/**
 * The carried Wayfinder's Anchor waking on a new run's first arrival on floor
 * 3, just before its fragment's ceremony.
 *
 * A new game keeps the anchor and its quest's completion, so the key system
 * issues the anchor's fragment as a carried-in award the first time the
 * floor's ring is built. That ceremony must not open the moment the floor
 * does: once the floor has settled, the anchor pulses on the hotbar and its
 * wake sounds, and only when the wake has run does the ceremony open. The
 * scene's ceremony opener asks {@link CarriedAnchorWake.holdsCeremony}.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { playKeyCue } from '../../audio/keySoundCues';
import { WORLD_TICKS_PER_SECOND } from '../../core/constants';
import type { KeyMoment } from '../../core/keys/keyMoments';
import { ANCHOR_QUEST_ID } from '../AnchorQuestSystem';

/** The wake sound's length, which the hotbar pulse lasts and the ceremony waits out. */
const ANCHOR_WAKE_SECONDS = 1.85;
const ANCHOR_WAKE_FRAMES = Math.round(ANCHOR_WAKE_SECONDS * WORLD_TICKS_PER_SECOND);
/** Full brightness pulses this many times over the wake. */
const ANCHOR_WAKE_PULSES = 3;

/** Whether `moment` is the anchor's fragment, issued because a new game carried the repaired anchor in. */
export function isCarriedAnchorMoment(moment: KeyMoment | null): boolean {
  if (moment?.kind !== 'fragment' || moment.award !== 'carriedIn') return false;
  const { source } = moment.fragment;
  return source.kind === 'questCompleted' && source.questId === ANCHOR_QUEST_ID;
}

export class CarriedAnchorWake {
  private framesLeft = 0;
  private woken = false;

  constructor(
    private readonly nextMoment: () => KeyMoment | null,
    private readonly audio: Pick<AudioManager, 'play' | 'playAt'> | null,
  ) {}

  /** Whether the next ceremony owed is the anchor's, and the anchor has not finished waking for it. */
  holdsCeremony(): boolean {
    return isCarriedAnchorMoment(this.nextMoment()) && !this.woken;
  }

  /**
   * One frame of a settled floor: the world running, no intro or menu over
   * it. Starts the wake the first such frame its ceremony is owed, and runs it
   * out.
   */
  tickSettled(): void {
    if (!this.holdsCeremony()) return;
    if (this.framesLeft === 0) {
      this.framesLeft = ANCHOR_WAKE_FRAMES;
      playKeyCue(this.audio, 'anchorWake');
      return;
    }
    this.framesLeft--;
    if (this.framesLeft === 0) this.woken = true;
  }

  /**
   * Forgets any wake begun or run, for a floor rewound to a checkpoint: a death
   * that owes the anchor's ceremony again owes its wake again with it.
   */
  reset(): void {
    this.framesLeft = 0;
    this.woken = false;
  }

  /** How brightly the anchor's hotbar slot glows, 0 to 1; zero outside the wake. */
  get pulse(): number {
    if (this.framesLeft === 0) return 0;
    const progress = 1 - this.framesLeft / ANCHOR_WAKE_FRAMES;
    return Math.sin(progress * Math.PI * ANCHOR_WAKE_PULSES) ** 2;
  }
}
