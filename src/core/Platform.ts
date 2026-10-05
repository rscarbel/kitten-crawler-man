/**
 * Platform adapter — strategy pattern replacing scattered IS_MOBILE checks.
 *
 * Import `platform` (the singleton) instead of `IS_MOBILE` to get
 * platform-specific labels, layout values, and feature flags.
 */

import { IS_MOBILE } from './MobileDetect';
import { keybindings } from './Keybindings';

export interface PlatformAdapter {
  readonly isMobile: boolean;

  readonly resumeButtonLabel: string;
  miniMapHint(expanded: boolean): string;

  readonly showEntityTooltip: boolean;
}

class DesktopPlatform implements PlatformAdapter {
  readonly isMobile = false;
  readonly resumeButtonLabel = 'Resume Game  (Esc)';

  miniMapHint(expanded: boolean): string {
    const key = keybindings.labelFor('toggleMiniMap');
    return expanded ? `${key}: collapse  |  drag to scroll` : `${key}: expand`;
  }

  readonly showEntityTooltip = true;
}

class MobilePlatform implements PlatformAdapter {
  readonly isMobile = true;
  readonly resumeButtonLabel = 'Resume Game';

  miniMapHint(expanded: boolean): string {
    return expanded ? 'drag to scroll  |  tap: collapse' : 'Tap: expand';
  }

  readonly showEntityTooltip = false;
}

export const platform: PlatformAdapter = IS_MOBILE ? new MobilePlatform() : new DesktopPlatform();
