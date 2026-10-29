import {
  drawSharkAttackSprite,
  drawSharkBloodPoolSprite,
  SHARK_ATTACK_FRAMES,
  SHARK_ATTACK_TAKEN_FRAME,
} from '../../sprites/sharkAttackSprite';
import type { DeathCause } from '../../ui/DeathExplanations';
import type { CutsceneSoundCue } from '../cutscene/cutsceneSteps';
import { SCRIPTED_DEATH_CUES } from './scriptedDeathCues';
import type { ScriptedDeathKind } from './scriptedDeathKinds';

/**
 * Paints one frame of a scripted death, or its decal `frame` ticks after it
 * appeared, centred on the screen point where the victim stood.
 */
export type ScriptedDeathPainter = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  screenX: number,
  screenY: number,
  tileSize: number,
) => void;

export interface ScriptedDeathDef {
  /** The animation played where the victim stood, a world tick per frame. */
  readonly animation: {
    readonly paint: ScriptedDeathPainter;
    readonly frames: number;
    /** The frame the victim is taken: they are not drawn from it on, and the decal starts. */
    readonly takenAtFrame: number;
  };
  /** What stays on the ground once the animation is over, painted under every body. */
  readonly decal: ScriptedDeathPainter;
  /** World ticks from the start until the victim dies and the death screen follows. */
  readonly deathDelayFrames: number;
  readonly cause: DeathCause;
  /** Played once as the animation starts, from where the victim stood. */
  readonly cue: CutsceneSoundCue;
}

/** Half a second after the breach settles, to see the pool spread before "You Died". */
const SHARK_POOL_LINGER_FRAMES = 30;
const SHARK_DEATH_DELAY_FRAMES = SHARK_ATTACK_FRAMES + SHARK_POOL_LINGER_FRAMES;

export const SCRIPTED_DEATHS = {
  shark_attack: {
    animation: {
      paint: drawSharkAttackSprite,
      frames: SHARK_ATTACK_FRAMES,
      takenAtFrame: SHARK_ATTACK_TAKEN_FRAME,
    },
    decal: drawSharkBloodPoolSprite,
    deathDelayFrames: SHARK_DEATH_DELAY_FRAMES,
    cause: 'sharkAttack',
    cue: SCRIPTED_DEATH_CUES.sharkBreachBite,
  },
} as const satisfies Record<ScriptedDeathKind, ScriptedDeathDef>;
