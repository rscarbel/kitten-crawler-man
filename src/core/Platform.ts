/**
 * Platform adapter — strategy pattern replacing scattered IS_MOBILE checks.
 *
 * Import `platform` (the singleton) instead of `IS_MOBILE` to get
 * platform-specific labels, layout values, and feature flags.
 */

import { IS_MOBILE } from './MobileDetect';
import {
  keybindings,
  MAX_KEYS_PER_ACTION,
  UNBOUND_ACTION_LABEL,
  type GameAction,
} from './Keybindings';

/** Reading order of the movement keys in a hint line — up, left, down, right. */
const MOVEMENT_HINT_ORDER: readonly GameAction[] = ['moveUp', 'moveLeft', 'moveDown', 'moveRight'];

/** The stock secondary movement set, which reads better by name than as glyphs. */
const ARROW_KEY_CLUSTER = '↑←↓→';
const ARROW_KEY_CLUSTER_LABEL = 'Arrows';

/**
 * The movement half of the HUD hint, built from whatever is actually bound.
 *
 * Each binding slot becomes one cluster, so the stock keymap still reads as the
 * familiar `WASD/↑←↓→` while a rebound one stays truthful instead of promising
 * keys that no longer walk.
 */
function movementHintLabel(): string {
  const clusters: string[] = [];
  for (let slot = 0; slot < MAX_KEYS_PER_ACTION; slot++) {
    const labels: string[] = [];
    for (const action of MOVEMENT_HINT_ORDER) {
      const keys = keybindings.keysFor(action);
      if (slot < keys.length) labels.push(keybindings.labelForKey(keys[slot]));
    }
    if (labels.length === 0) continue;
    const isCompleteDirectionSet = labels.length === MOVEMENT_HINT_ORDER.length;
    const cluster = labels.join(isCompleteDirectionSet ? '' : '/');
    clusters.push(cluster === ARROW_KEY_CLUSTER ? ARROW_KEY_CLUSTER_LABEL : cluster);
  }
  if (clusters.length === 0) return UNBOUND_ACTION_LABEL;
  return clusters.join('/');
}

/** Desktop/mobile panel width in pixels. */
const GEAR_PANEL_WIDTH_PX = 340;

/** Canvas padding for mobile gear panel. */
const MOBILE_CANVAS_PADDING = 16;

/** Desktop gear panel X offset. */
const DESKTOP_GEAR_PANEL_OFFSET = -180;

export interface PlatformAdapter {
  readonly isMobile: boolean;

  readonly pauseButtonLabel: string;
  readonly resumeButtonLabel: string;
  readonly skillPointBanner: string;
  controlHints(atkLabel: string): [string, string];
  miniMapHint(expanded: boolean): string;

  readonly initialHudCollapsed: boolean;
  gearPanelWidth(canvasWidth: number): number;
  readonly gearPanelXOffset: number;

  readonly showEntityTooltip: boolean;
  readonly showDesktopToggleButtons: boolean;
  readonly showHudCollapseToggle: boolean;
}

class DesktopPlatform implements PlatformAdapter {
  readonly isMobile = false;
  readonly pauseButtonLabel = 'Pause (Esc)';
  readonly resumeButtonLabel = 'Resume Game  (Esc)';
  readonly skillPointBanner = 'Click to spend';

  controlHints(atkLabel: string): [string, string] {
    return [
      `${movementHintLabel()}: Move  |  ${keybindings.labelFor('switchCharacter')}: Switch`,
      `${keybindings.labelFor('attack')}: ${atkLabel}  |  ${keybindings.labelFor('usePotion')}: Potion`,
    ];
  }

  miniMapHint(expanded: boolean): string {
    const key = keybindings.labelFor('toggleMiniMap');
    return expanded ? `${key}: collapse  |  drag to scroll` : `${key}: expand`;
  }

  readonly initialHudCollapsed = false;
  gearPanelWidth(): number {
    return GEAR_PANEL_WIDTH_PX;
  }
  readonly gearPanelXOffset = DESKTOP_GEAR_PANEL_OFFSET;

  readonly showEntityTooltip = true;
  readonly showDesktopToggleButtons = true;
  readonly showHudCollapseToggle = false;
}

class MobilePlatform implements PlatformAdapter {
  readonly isMobile = true;
  readonly pauseButtonLabel = 'Pause';
  readonly resumeButtonLabel = 'Resume Game';
  readonly skillPointBanner = 'Tap to spend';

  controlHints(): [string, string] {
    return ['Hold: Move  |  Tap: Attack', 'Buttons: Switch / Follow'];
  }

  miniMapHint(expanded: boolean): string {
    return expanded ? 'drag to scroll  |  tap: collapse' : 'Tap: expand';
  }

  readonly initialHudCollapsed = true;
  gearPanelWidth(canvasWidth: number): number {
    return Math.min(GEAR_PANEL_WIDTH_PX, canvasWidth - MOBILE_CANVAS_PADDING);
  }
  readonly gearPanelXOffset = 0;

  readonly showEntityTooltip = false;
  readonly showDesktopToggleButtons = false;
  readonly showHudCollapseToggle = true;
}

export const platform: PlatformAdapter = IS_MOBILE ? new MobilePlatform() : new DesktopPlatform();
