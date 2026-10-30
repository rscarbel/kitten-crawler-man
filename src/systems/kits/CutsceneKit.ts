/**
 * CutsceneKit — the cutscene director, the surface that hands the party to it,
 * and the movement phase's half of a scripted walk. The dungeon and a building
 * interior each build one, mount its surfaces, and call `tickWorld` in place of
 * the player's own movement, so a script owns the party the same way in both.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import type { ConversationSurfaceOptions } from '../../dialog/Conversation';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import { screenFadeSurface } from '../../ui/ScreenFade';
import { applyMovement, type SouthCollisionAnchor } from '../GameLoopPhases';
import {
  CutsceneDirector,
  type CutsceneCueClock,
  type CutsceneDirectorDeps,
} from '../cutscene/CutsceneDirector';
import type { CutscenePoint } from '../cutscene/cutsceneCamera';
import type { CutsceneSoundCue, CutsceneWorldAction } from '../cutscene/cutsceneSteps';

/** The surface id, unique per scene. */
export const CUTSCENE_SURFACE_ID = 'cutscene';
/** The cutscene's full-screen fade's surface id, unique per scene. */
const CUTSCENE_FADE_SURFACE_ID = 'cutscene-fade';

/** The pause button's own cue, which a press on it through the cutscene keeps. */
const PAUSE_BUTTON_SOUND = 'menu_open' as const satisfies SoundId;

/** The HUD's pause button as last drawn, in UI units, and what pressing it does. */
export interface CutscenePauseButton {
  readonly rect: Rect;
  readonly press: () => void;
}

/** A scene's `playSound` dependency, played through its audio when it has any. */
export function cutsceneSoundPlayer(
  audio: AudioManager | null,
): (cue: CutsceneSoundCue, at: CutscenePoint | null) => void {
  return (cue, at) => {
    if (at === null) audio?.playRandom(cue.takes);
    else audio?.playRandomAt(cue.takes, at.x, at.y);
  };
}

/**
 * A scene's cue clock, played through its audio when it has any. A cue that
 * is not decoded this instant does not play at all rather than late, out of
 * step with the script timed to it.
 */
export function cutsceneCueClock(audio: AudioManager | null): CutsceneCueClock {
  return {
    start: (cue, fromS) => audio?.playNow(cue, { startOffset: fromS }) ?? null,
    nowS: () => (audio === null ? null : audio.clockSeconds),
  };
}

export interface CutsceneKitDeps<
  Action extends CutsceneWorldAction = never,
> extends CutsceneDirectorDeps<Action> {
  /** The one HUD control left live while a cutscene plays; null while it is not drawn. */
  readonly pauseButton: () => CutscenePauseButton | null;
}

/**
 * `Action` is the scene's own world-action union, run by `run` steps; `never`
 * for a scene with none. `ActorId` is the ids it registers actors under in
 * `director.actors`; `never` for a scene whose scripts move only the active
 * crawler.
 */
export class CutsceneKit<
  Action extends CutsceneWorldAction = never,
  ActorId extends string = never,
> {
  readonly director: CutsceneDirector<Action, ActorId>;
  private readonly fadeSurface = screenFadeSurface(CUTSCENE_FADE_SURFACE_ID, {
    alpha: () => this.director.fadeAlpha,
  });

  constructor(private readonly deps: CutsceneKitDeps<Action>) {
    this.director = new CutsceneDirector<Action, ActorId>(deps);
  }

  get isActive(): boolean {
    return this.director.isActive;
  }

  /**
   * The movement phase while a cutscene plays: walks the active crawler along
   * the script's path, or holds them still. Called on every world tick, since
   * it also advances the cutscene camera and a shake that outlives its script.
   *
   * @returns whether the cutscene owned this tick's movement, in which case
   *   the scene applies none of its own.
   */
  tickWorld(active: Player, map: GameMap, southAnchor: SouthCollisionAnchor): boolean {
    this.director.tickEffects();
    if (!this.director.isActive) return false;
    active.isMoving = false;
    const move = this.director.tickWorld(active, map);
    if (move !== null) applyMovement(active, move, map, southAnchor);
    return true;
  }

  /**
   * The cutscene's surface, the scene's conversation surface and the
   * cutscene's fade, to mount in this order and only through here. A talk the cutscene opens must stack
   * above the surface that holds the party, or that surface takes every key
   * and tap meant for the talk. Caroline's messages float in the same band as
   * it, and when the scene runs two catch-up updates before a frame is drawn
   * both open in the same stack refresh, where mount order decides which is on
   * top.
   */
  surfaces(conversation: ConversationSurfaceOptions): readonly Surface[] {
    return [this.cutsceneSurface(), this.deps.conversation.surface(conversation), this.fadeSurface];
  }

  /**
   * Takes every press, tap and gameplay key while a cutscene plays, short of
   * pause: Escape passes beneath it to the pause key, and the HUD's pause
   * button stays pressable through it. It draws nothing, so the HUD stays in
   * view, and the pause menu opens over it and hands the script back on close.
   */
  private cutsceneSurface(): Surface {
    return {
      id: CUTSCENE_SURFACE_ID,
      band: 'panel',
      haltsWorld: false,
      locksKeyboard: true,
      isOpen: () => this.director.isActive,
      render: (ui) => {
        ui.block(ui.screen);
        // A fade covering the screen swallows Escape and every tap, so a pause
        // cannot open mid-cut; offering the button under it would be a lie.
        const pause = this.fadeSurface.isOpen() ? null : this.deps.pauseButton();
        if (pause === null) return;
        ui.hit('pause', pause.rect, {
          onTap: () => pause.press(),
          keyboardShortcut: 'Escape',
          sound: PAUSE_BUTTON_SOUND,
        });
      },
    };
  }

  resetForCheckpoint(): void {
    this.director.resetForCheckpoint();
  }

  dispose(): void {
    this.director.dispose();
  }
}
