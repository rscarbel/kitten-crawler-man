/**
 * CutsceneKit — the cutscene director, the surface that hands the party to it,
 * and the movement phase's half of a scripted walk. The dungeon and a building
 * interior each build one, mount its surface, and call `tickWorld` in place of
 * the player's own movement, so a script owns the party the same way in both.
 */

import type { SoundId } from '../../audio/sounds';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import { applyMovement, type SouthCollisionAnchor } from '../GameLoopPhases';
import { CutsceneDirector, type CutsceneDirectorDeps } from '../cutscene/CutsceneDirector';

/** The surface id, unique per scene. */
export const CUTSCENE_SURFACE_ID = 'cutscene';

/** The pause button's own cue, which a press on it through the cutscene keeps. */
const PAUSE_BUTTON_SOUND = 'menu_open' as const satisfies SoundId;

/** The HUD's pause button as last drawn, in UI units, and what pressing it does. */
export interface CutscenePauseButton {
  readonly rect: Rect;
  readonly press: () => void;
}

export interface CutsceneKitDeps extends CutsceneDirectorDeps {
  /** The one HUD control left live while a cutscene plays; null while it is not drawn. */
  readonly pauseButton: () => CutscenePauseButton | null;
}

export class CutsceneKit {
  readonly director: CutsceneDirector;

  constructor(private readonly deps: CutsceneKitDeps) {
    this.director = new CutsceneDirector(deps);
  }

  get isActive(): boolean {
    return this.director.isActive;
  }

  /**
   * The movement phase while a cutscene plays: walks the active crawler along
   * the script's path, or holds them still.
   *
   * @returns whether the cutscene owned this tick's movement, in which case
   *   the scene applies none of its own.
   */
  tickWorld(active: Player, map: GameMap, southAnchor: SouthCollisionAnchor): boolean {
    if (!this.director.isActive) return false;
    const move = this.director.tickWorld(active, map);
    if (move === null) active.isMoving = false;
    else applyMovement(active, move, map, southAnchor);
    return true;
  }

  /**
   * Takes every press, tap and gameplay key while a cutscene plays, short of
   * pause: Escape passes beneath it to the pause key, and the HUD's pause
   * button stays pressable through it. It draws nothing, so the HUD stays in
   * view, and the pause menu opens over it and hands the script back on close.
   */
  surface(): Surface {
    return {
      id: CUTSCENE_SURFACE_ID,
      band: 'panel',
      haltsWorld: false,
      locksKeyboard: true,
      isOpen: () => this.director.isActive,
      render: (ui) => {
        ui.block(ui.screen);
        const pause = this.deps.pauseButton();
        if (pause === null) return;
        ui.hit('pause', pause.rect, {
          onTap: () => pause.press(),
          keyboardShortcut: 'Escape',
          sound: PAUSE_BUTTON_SOUND,
        });
      },
    };
  }

  dispose(): void {
    this.director.dispose();
  }
}
