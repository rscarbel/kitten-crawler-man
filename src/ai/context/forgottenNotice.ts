/**
 * The in-character line owed after a save wipe. A wipe always reloads the
 * page, so the line is kept in storage and said on the next connection.
 */

const FORGOTTEN_NOTICE_KEY = 'kcm-ai-forgotten-notice';

/** Marks that the characters were told to forget this player. */
export function rememberForgottenPlayer(line: string): void {
  try {
    localStorage.setItem(FORGOTTEN_NOTICE_KEY, line);
  } catch {
    // Without storage the line is simply not shown after the reload.
  }
}

/** The in-character line owed after a wipe, once; null when none is owed. */
export function takeForgottenPlayerNotice(): string | null {
  try {
    const line = localStorage.getItem(FORGOTTEN_NOTICE_KEY);
    if (line === null) return null;
    localStorage.removeItem(FORGOTTEN_NOTICE_KEY);
    return line;
  } catch {
    return null;
  }
}
