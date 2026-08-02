/**
 * Stands in for `devBoot.ts` in a release build.
 *
 * The swap happens at resolve time (`scripts/build.js`), which is the point:
 * a runtime guard would still leave the preview scenes and playtest presets
 * sitting in the shipped bundle for a player to find. Replacing the module
 * means the shipped game has no import edge to any of it.
 */
export function devBootScene(): boolean {
  return false;
}
