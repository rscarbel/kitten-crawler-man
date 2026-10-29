/**
 * The lit explosives in the world, as published by the systems that own them.
 *
 * Published per frame by `MobUpdateLoop`, for the same reason marked ground is
 * (see {@link module:creatures/tactics/markedGround}): a mob has no reference
 * to the world it lives in. No mob reacts to explosives unless its own AI
 * asks here.
 */

import type {
  ExplosiveSource,
  ExplosiveVelocity,
  LiveExplosive,
  LiveStickId,
} from '../systems/ExplosiveSource';

const NO_SOURCES: readonly ExplosiveSource[] = [];
const NO_EXPLOSIVES: readonly LiveExplosive[] = [];

let sources: readonly ExplosiveSource[] = NO_SOURCES;

/**
 * Publish this frame's explosive owners. Pass an empty list when tearing a
 * scene down so a disposed system can never be asked about its explosives again.
 */
export function setExplosiveSources(published: readonly ExplosiveSource[]): void {
  sources = published;
}

/** Every explosive alight in the world this frame. */
export function liveExplosives(): readonly LiveExplosive[] {
  // Merged only when two sources both hold some, so the usual single source
  // hands back its own cached list without a copy.
  let found = NO_EXPLOSIVES;
  for (const source of sources) {
    const own = source.liveExplosives();
    if (own.length === 0) continue;
    found = found.length === 0 ? own : [...found, ...own];
  }
  return found;
}

/**
 * Relaunches the stick `id` at `velocity` with its fuse still burning, through
 * whichever source holds it. False when it has already gone off.
 */
export function kickExplosive(id: LiveStickId, velocity: ExplosiveVelocity): boolean {
  return sources.some((source) => source.kick(id, velocity));
}
