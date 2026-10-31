/**
 * Plays the key ceremonies the floor's {@link KeyFragmentSystem} owes, one at
 * a time, at the first calm moment: a fragment's ceremony, and the forge
 * straight after the fragment that made its key whole, with no world frame
 * between them.
 *
 * Rewards otherwise wait behind a HUD chip and never interrupt play. A
 * fragment is the one deliberate exception: it takes the whole screen. That
 * is safe only because it waits for calm, so nothing here opens while a
 * conversation, a cutscene, a boss intro or another halting screen is up,
 * while anything is still fighting the party or kill loot is still in the
 * air, or before a short settle after the deed (a boss's death plays out
 * before its fragment rises).
 *
 * While a ceremony is up the world's sound goes away: the music and the
 * ambience pause and the world's effects are hushed, so the ceremony's own
 * cues, played on the `ui` bus the hush leaves open, have the stage. Every
 * way out of a ceremony lets them go.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { idleFrameNumber } from '../../core/rendering/renderFrameClock';
import { playKeyCue } from '../../audio/keySoundCues';
import { keyKindDef, keyKindsMatch, type KeyOpens } from '../../core/keys/keyKinds';
import type { FragmentMoment, ForgeMoment } from '../../core/keys/keyMoments';
import { getLevelDef } from '../../levels';
import type { LevelExit } from '../../levels/types';
import type { Surface, UiMeasure } from '../../ui/core/UiRoot';
import {
  GoldenKeyForgeScreen,
  type ForgeHandOff,
} from '../../ui/screens/keys/GoldenKeyForgeScreen';
import { KeyFragmentScreen } from '../../ui/screens/keys/KeyFragmentScreen';
import type { KeyFragmentSystem } from './KeyFragmentSystem';

/**
 * Frames a newly owed ceremony waits after its deed before it may open: long
 * enough for the slowest boss death to play out and its loot to burst from
 * the body. Loot still in the air holds it longer, through `calm`.
 */
const KEY_MOMENT_SETTLE_FRAMES = 90;
const SILENCE_FADE_MS = 300;
/**
 * Baked art left undrawn is let go after a minute, so art warmed for a
 * ceremony still waiting on a long fight is looked at again every ten
 * seconds, which keeps it in the cache.
 */
const PREPARED_RECHECK_FRAMES = 600;
const SOUND_RETURN_MS = 1200;

export const KEY_FRAGMENT_SURFACE_ID = 'key-fragment-ceremony';
export const KEY_FORGE_SURFACE_ID = 'key-forge-ceremony';

interface KeyCeremonyDeps {
  readonly keys: KeyFragmentSystem;
  readonly audio: AudioManager | null;
  /**
   * Whether a ceremony may open now: no conversation, no cutscene, no boss
   * intro, no other surface halting the world, no quest reward screen up or
   * waiting (a quest's plaque comes before its fragment), no kill loot
   * still falling, and nothing still fighting the party.
   */
  readonly calm: () => boolean;
  /** Sends the forged key flying from where the forge showed it to the Keys button, in canvas CSS pixels. */
  readonly flyKey: (handOff: ForgeHandOff) => void;
}

/** What the forge says a key that opens a floor's stairwells will open, by how the floor is left. */
function stairwellSubline(exit: LevelExit): string {
  switch (exit.kind) {
    case 'descend':
      return 'The stairwells of this floor will open for you.';
    case 'runEnd':
      return 'The stairwell in the town square will open for you.';
    default: {
      const unhandled: never = exit;
      return unhandled;
    }
  }
}

/** The forge's subline for each thing a key can open. */
const FORGE_SUBLINES = {
  floorStairwells: (moment) => stairwellSubline(getLevelDef(moment.levelId).exit),
} as const satisfies Record<KeyOpens['kind'], (moment: ForgeMoment) => string>;

/** What the forge says the key it made will open. */
export function forgeSubline(moment: ForgeMoment): string {
  return FORGE_SUBLINES[keyKindDef(moment.keyKind).opens.kind](moment);
}

export class KeyCeremonySystem {
  private readonly fragment: KeyFragmentScreen;
  private readonly forge: GoldenKeyForgeScreen;
  /** Frames the next owed ceremony has waited with nothing on screen. */
  private waited = 0;
  private silenced = false;
  /** The owed ceremonies and viewport whose art is all baked, so a long wait for calm does no work. */
  private preparedFor: string | null = null;

  constructor(private readonly deps: KeyCeremonyDeps) {
    this.fragment = new KeyFragmentScreen(deps.audio, (moment) => this.fragmentDone(moment));
    this.forge = new GoldenKeyForgeScreen(deps.audio, (handOff) => this.forgeDone(handOff));
  }

  /** Both ceremonies' surfaces, mounted once on the scene's `UiRoot`. */
  surfaces(): readonly Surface[] {
    return [
      this.fragment.surface(KEY_FRAGMENT_SURFACE_ID),
      this.forge.surface(KEY_FORGE_SURFACE_ID),
    ];
  }

  /**
   * Bakes the key art of every owed ceremony a little, from what is left of
   * the frame's bake budget once the scene's surfaces (an open ceremony among
   * them) have drawn: so a ceremony opens on art already made rather than
   * stalling to make it. Call once a frame after the scene's `UiRoot` frame.
   */
  prepare(target: UiMeasure): void {
    if (!this.deps.keys.hasPendingMoment()) return;
    const view = target.viewport;
    const transform = target.ctx.getTransform();
    const recheck = Math.floor(idleFrameNumber() / PREPARED_RECHECK_FRAMES);
    const readyKey = `${this.deps.keys.momentsRevision}|${view.w}x${view.h}|${transform.a}|${recheck}`;
    if (readyKey === this.preparedFor) return;
    let ready = true;
    for (const moment of this.deps.keys.owedMoments()) {
      switch (moment.kind) {
        case 'fragment':
          ready = this.fragment.prepare(target, moment) && ready;
          break;
        case 'forge':
          ready = this.forge.prepare(target, { moment, subline: forgeSubline(moment) }) && ready;
          break;
        default: {
          const unhandled: never = moment;
          return unhandled;
        }
      }
    }
    if (ready) this.preparedFor = readyKey;
  }

  /** Whether a ceremony is on screen. */
  get isOpen(): boolean {
    return this.fragment.isOpen || this.forge.isOpen;
  }

  /**
   * Whether a ceremony is on screen or owed: what Caroline's messages and the
   * reward chip hold back for, so her word after a boss follows its fragment.
   */
  get holdsPresentations(): boolean {
    return this.isOpen || this.deps.keys.hasPendingMoment();
  }

  /** Once per update, halted or not: opens the next owed ceremony when it is clear to, and plays the one up. */
  update(): void {
    this.fragment.tick();
    this.forge.tick();
    if (this.isOpen) return;
    if (this.deps.keys.nextMoment() === null) {
      this.waited = 0;
      return;
    }
    if (this.waited < KEY_MOMENT_SETTLE_FRAMES) {
      this.waited++;
      return;
    }
    if (!this.deps.calm()) return;
    this.openNext();
  }

  private openNext(): void {
    const moment = this.deps.keys.beginMoment();
    if (moment === null) return;
    this.silence();
    switch (moment.kind) {
      case 'fragment':
        this.fragment.open(moment);
        return;
      case 'forge':
        this.openForge(moment);
        return;
      default: {
        const unhandled: never = moment;
        return unhandled;
      }
    }
  }

  private openForge(moment: ForgeMoment): void {
    this.forge.open({ moment, subline: forgeSubline(moment) });
  }

  private fragmentDone(moment: FragmentMoment): void {
    this.deps.keys.endMoment();
    const next = this.deps.keys.nextMoment();
    // Its key's forge follows with no world frame between, whatever was
    // queued when; the queue puts a forge behind its key's last fragment.
    if (next?.kind === 'forge' && keyKindsMatch(next.keyKind, moment.keyKind)) {
      this.openNext();
      return;
    }
    this.waited = 0;
    this.restoreSound();
  }

  private forgeDone(handOff: ForgeHandOff): void {
    this.deps.keys.endMoment();
    this.waited = 0;
    playKeyCue(this.deps.audio, 'forgeFlyToRing', null, 'ui');
    this.deps.flyKey(handOff);
    this.restoreSound();
  }

  private silence(): void {
    if (this.silenced) return;
    this.silenced = true;
    const audio = this.deps.audio;
    audio?.pauseMusic('key_ceremony', SILENCE_FADE_MS);
    audio?.pauseAmbience('key_ceremony');
    audio?.hushEffects('key_ceremony', SILENCE_FADE_MS);
  }

  /**
   * Lets go of everything the ceremony silenced. The audio manager outlives
   * the scene, so a reason left held here would mute the game for the rest
   * of the session.
   */
  private restoreSound(): void {
    if (!this.silenced) return;
    this.silenced = false;
    const audio = this.deps.audio;
    audio?.unhushEffects('key_ceremony', SOUND_RETURN_MS);
    audio?.resumeAmbience('key_ceremony');
    audio?.resumeMusic('key_ceremony', SOUND_RETURN_MS);
  }

  /**
   * Takes any ceremony down at once, as the scene under it is torn down or
   * rewound. The moment on screen is closed, so it is not owed again.
   */
  dismiss(): void {
    if (this.isOpen) this.deps.keys.endMoment();
    this.fragment.dismiss();
    this.forge.dismiss();
    this.waited = 0;
    this.restoreSound();
  }

  dispose(): void {
    this.dismiss();
    this.fragment.dispose();
  }
}
