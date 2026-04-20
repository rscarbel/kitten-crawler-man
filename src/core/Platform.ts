/**
 * Platform adapter — strategy pattern replacing scattered IS_MOBILE checks.
 *
 * Import `platform` (the singleton) instead of `IS_MOBILE` to get
 * platform-specific labels, layout values, and feature flags.
 */

import { IS_MOBILE } from './MobileDetect';

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
  readonly skillPointBanner = 'Skill points available! Open menu (Esc) to spend them.';

  controlHints(atkLabel: string): [string, string] {
    return ['WASD/Arrows: Move  |  Tab: Switch', `Space: ${atkLabel}  |  Q: Potion`];
  }

  miniMapHint(expanded: boolean): string {
    return expanded ? 'M: collapse' : 'M: expand';
  }

  readonly initialHudCollapsed = false;
  gearPanelWidth(): number {
    return 340;
  }
  readonly gearPanelXOffset = -180;

  readonly showEntityTooltip = true;
  readonly showDesktopToggleButtons = true;
  readonly showHudCollapseToggle = false;
}

class MobilePlatform implements PlatformAdapter {
  readonly isMobile = true;
  readonly pauseButtonLabel = 'Pause';
  readonly resumeButtonLabel = 'Resume Game';
  readonly skillPointBanner = 'Skill points available! Open Pause menu to spend them.';

  controlHints(): [string, string] {
    return ['Hold: Move  |  Tap: Attack', 'Buttons: Switch / Follow'];
  }

  miniMapHint(expanded: boolean): string {
    return expanded ? 'Tap: collapse' : 'Tap: expand';
  }

  readonly initialHudCollapsed = true;
  gearPanelWidth(canvasWidth: number): number {
    return Math.min(340, canvasWidth - 16);
  }
  readonly gearPanelXOffset = 0;

  readonly showEntityTooltip = false;
  readonly showDesktopToggleButtons = false;
  readonly showHudCollapseToggle = true;
}

export const platform: PlatformAdapter = IS_MOBILE ? new MobilePlatform() : new DesktopPlatform();
