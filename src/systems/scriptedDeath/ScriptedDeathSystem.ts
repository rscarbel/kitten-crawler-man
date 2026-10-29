import { TILE_SIZE } from '../../core/constants';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { NonEmpty } from '../../dialog/line';
import type { CutsceneDirector } from '../cutscene/CutsceneDirector';
import type { CutscenePoint } from '../cutscene/cutsceneCamera';
import type { CutsceneScript } from '../cutscene/cutsceneSteps';
import type { ScriptedDeathKind } from './scriptedDeathKinds';
import { SCRIPTED_DEATHS } from './scriptedDeaths';

/**
 * Invulnerability kept past the death's own frame, so the victim's timer
 * ticking down before this system's update cannot open a one-frame gap.
 */
const INVULNERABILITY_MARGIN_FRAMES = 1;

/** One crawler a death takes, and the world point (pixels) its animation is centred on. */
export interface ScriptedDeathVictim {
  readonly victim: HumanPlayer | CatPlayer;
  readonly at: CutscenePoint;
}

/** What the system needs from the scene it plays in. */
export interface ScriptedDeathDeps {
  readonly cutscenes: Pick<CutsceneDirector, 'play'>;
  /** Throws one heavy burst of blood from a world point (pixels) along a direction. */
  readonly spawnGore: (x: number, y: number, dx: number, dy: number) => void;
}

interface PlayingDeath {
  readonly kind: ScriptedDeathKind;
  readonly victim: HumanPlayer | CatPlayer;
  readonly at: CutscenePoint;
  /**
   * World ticks since its cutscene started, or null while that cutscene still
   * waits behind another one: the animation, the sound and the death all run
   * off the one clock, so none of them can play ahead of the others.
   */
  frame: number | null;
}

/**
 * Plays deaths a script shows rather than a blow deals: the scene's input is
 * held through a cutscene, the victim is taken by the animation and not drawn
 * again, a decal is left, and after the def's delay the victim dies through
 * {@link HumanPlayer.dieScripted}, which no dodge, ward or 9 Lives stops. The
 * scene's ordinary death check then raises the death screen with the def's
 * cause, and the run goes wherever the death screen sends that cause.
 *
 * Everything advances on world ticks only, so the whole death holds under the
 * pause menu. A death rewind calls {@link reset}.
 *
 * From the moment it is asked for until it lands, the victim cannot be harmed
 * by anything else, and the cutscene (queued or running) holds the input.
 */
export class ScriptedDeathSystem {
  private readonly playing: PlayingDeath[] = [];

  constructor(private readonly deps: ScriptedDeathDeps) {}

  /**
   * Plays `kind` on `victim` at `at`, the world point (pixels) where the
   * animation is centred: where the victim stands. A victim already being
   * taken is left to the death under way.
   */
  play(kind: ScriptedDeathKind, victim: HumanPlayer | CatPlayer, at: CutscenePoint): void {
    this.playTogether(kind, [{ victim, at }], null);
  }

  /**
   * Plays `kind` on every one of `victims` at once, in one cutscene, so they
   * swell, burst and die on the same ticks. `leadIn`, when given, is a
   * cutscene played first: the deaths start the moment it ends, and the
   * victims are already beyond harm while it plays. A victim already being
   * taken is left to the death under way.
   */
  playTogether(
    kind: ScriptedDeathKind,
    victims: NonEmpty<ScriptedDeathVictim>,
    leadIn: CutsceneScript | null,
  ): void {
    const deaths: PlayingDeath[] = [];
    for (const { victim, at } of victims) {
      if (this.playing.some((death) => death.victim === victim)) continue;
      const death: PlayingDeath = { kind, victim, at: { x: at.x, y: at.y }, frame: null };
      this.playing.push(death);
      this.holdOffOtherHarm(death);
      deaths.push(death);
    }
    if (deaths.length === 0) return;
    // Queued back to back, so nothing asked for meanwhile can play between them.
    if (leadIn !== null) this.deps.cutscenes.play(leadIn);
    const def = SCRIPTED_DEATHS[kind];
    this.deps.cutscenes.play(
      [
        { kind: 'wait', frames: def.cue.atFrame },
        { kind: 'sound', cue: def.cue.sound, at: null },
        { kind: 'wait', frames: def.deathDelayFrames - def.cue.atFrame },
      ],
      () => {
        for (const death of deaths) this.finish(death);
      },
      () => {
        for (const death of deaths) this.start(death);
      },
    );
  }

  /** Whether a death of `kind` has been asked for and not yet rewound or spared. */
  isPlaying(kind: ScriptedDeathKind): boolean {
    return this.playing.some((death) => death.kind === kind);
  }

  /** Whether `crawler` has been taken and must not be drawn. */
  hides(crawler: HumanPlayer | CatPlayer): boolean {
    return this.playing.some(
      (death) =>
        death.victim === crawler &&
        death.frame !== null &&
        death.frame >= SCRIPTED_DEATHS[death.kind].animation.takenAtFrame,
    );
  }

  update(): void {
    for (const death of this.playing) {
      if (death.frame !== null) death.frame++;
      this.holdOffOtherHarm(death);
      if (death.frame === SCRIPTED_DEATHS[death.kind].animation.takenAtFrame) {
        this.throwGore(death);
      }
    }
  }

  /** The decals, under every body. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const death of this.playing) {
      if (death.frame === null) continue;
      const def = SCRIPTED_DEATHS[death.kind];
      const decalAge = death.frame - def.animation.takenAtFrame;
      if (decalAge < 0) continue;
      def.decal(ctx, decalAge, death.at.x - camX, death.at.y - camY, TILE_SIZE);
    }
  }

  /** The animations, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const death of this.playing) {
      if (death.frame === null) continue;
      const animation = SCRIPTED_DEATHS[death.kind].animation;
      if (death.frame >= animation.frames) continue;
      animation.paint(ctx, death.frame, death.at.x - camX, death.at.y - camY, TILE_SIZE);
    }
  }

  /** The def's blood, thrown from the victim's body on the tick they are taken. */
  private throwGore(death: PlayingDeath): void {
    const gore = SCRIPTED_DEATHS[death.kind].gore;
    if (gore === null) return;
    const fromY = death.at.y - gore.riseTiles * TILE_SIZE;
    for (const burst of gore.bursts) {
      this.deps.spawnGore(death.at.x, fromY, burst.dx, burst.dy);
    }
  }

  /** A checkpoint restore: nothing of a death the run has rewound past stays on screen. */
  reset(): void {
    this.playing.length = 0;
  }

  /** Its cutscene has reached its first step: the animation's clock starts now. */
  private start(death: PlayingDeath): void {
    // Rewound past while its cutscene still waited behind another one.
    if (!this.playing.includes(death)) return;
    death.frame = 0;
  }

  /**
   * Keeps the victim's invulnerability running past the frame the death lands,
   * however long its cutscene queued: a death held behind another script must
   * not be beaten to the victim by a stray blow.
   */
  private holdOffOtherHarm(death: PlayingDeath): void {
    const delay = SCRIPTED_DEATHS[death.kind].deathDelayFrames;
    const framesUntilDeath = delay - (death.frame ?? 0);
    const covered = Math.max(0, framesUntilDeath) + INVULNERABILITY_MARGIN_FRAMES;
    death.victim.invulnerableFrames = Math.max(death.victim.invulnerableFrames, covered);
  }

  private finish(death: PlayingDeath): void {
    const index = this.playing.indexOf(death);
    // Rewound past while its cutscene still waited: the run it belonged to is gone.
    if (index < 0) return;
    if (death.victim.dieScripted(death.kind)) return;
    // Spared by god mode: they step back into view rather than staying gone.
    this.playing.splice(index, 1);
  }
}
