/**
 * The Keyboard Hero board while the spider lab's hack song plays. It owns the
 * screen and every key but Escape, which stays the pause key: pausing mid-song
 * abandons the run, as anywhere else on the floor.
 */

import type { HitHandlers, Surface } from '../../core/UiRoot';
import { MENU_TAP_MAX_DISTANCE } from '../../core/pointer';
import type { PaintTarget } from '../../widgets/paint';
import {
  computeKeyboardHeroLayout,
  LANE_INDICES,
  type KeyboardHeroLayout,
  type LaneIndex,
} from '../../../systems/keyboardHeroLayout';

/** What the board surface reads and drives; `SpiderQuestSystem` provides all of it. */
export interface KeyboardHeroSource {
  readonly isKeyboardHeroPlaying: boolean;
  paintKeyboardHero(
    target: PaintTarget,
    layout: KeyboardHeroLayout,
    viewportW: number,
    viewportH: number,
  ): void;
  tapKeyboardHeroLane(lane: LaneIndex, eventTimeStampMs?: number): void;
  handleKeyDown(key: string, eventTimeStampMs?: number): void;
}

/** Modal and halting; lanes and the touch row take taps, scored by the tap's own event time. */
export function keyboardHeroSurface(id: string, source: KeyboardHeroSource): Surface {
  return {
    id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => source.isKeyboardHeroPlaying,
    render: (ui) => {
      const layout = computeKeyboardHeroLayout(ui.screen.w, ui.screen.h, ui.density === 'touch');
      source.paintKeyboardHero(ui, layout, ui.screen.w, ui.screen.h);
      const laneHandlers = (lane: LaneIndex): HitHandlers => ({
        onTap: (e) => source.tapKeyboardHeroLane(lane, e.timeStamp),
        focusable: false,
        sound: null,
        // A lane tap made mid-song slides; it still counts within a menu tap's reach.
        dragSlop: MENU_TAP_MAX_DISTANCE / ui.uiScale,
      });
      for (const lane of LANE_INDICES) {
        ui.hit(`lane-${lane}`, layout.lanes[lane], laneHandlers(lane));
      }
      const buttons = layout.touchButtons;
      if (buttons === null) return;
      for (const lane of LANE_INDICES) {
        ui.hit(`touch-${lane}`, buttons[lane], laneHandlers(lane));
      }
    },
    onKey: (key, mods) => {
      if (key === 'Escape') return false;
      source.handleKeyDown(key, mods.timeStamp);
      return true;
    },
  };
}
