/**
 * The System AI's machine voice: the theme with the terminal face in place of
 * the UI face, for text the System types out (its title-screen lines, its
 * sponsor breaks). Built once per theme.
 */

import { TERMINAL_FONT_STACK } from './fonts';
import type { Theme } from './tokens';

const terminalThemes = new WeakMap<Theme, Theme>();

export function terminalTheme(theme: Theme): Theme {
  const cached = terminalThemes.get(theme);
  if (cached !== undefined) return cached;
  const built: Theme = { ...theme, fontFamily: TERMINAL_FONT_STACK };
  terminalThemes.set(theme, built);
  return built;
}
