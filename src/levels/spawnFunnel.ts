import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { onCanvasRecovery } from '../core/canvasRecovery';
import { varietyTier, type VarietyTier } from '../core/varietyTier';
import { isLookShared, resolveVariant, type MobVariantFamily } from '../core/mobVariantFamily';
import {
  MOB_KINDS,
  type KindOptionArgs,
  type MobKind,
  type MobKindEntry,
  type MobOf,
  type OptionsOf,
  type SpawnOptionArgs,
  type SpawnTile,
  type VariantOf,
} from './mobKinds';
import { ladderFor, lookTierFor, type EncounterId } from './encounters';
import { resolveLadderRoster, type ResolvedRoster, type Roster } from './ladder';

/**
 * What every hostile spawn is told about where it comes from.
 *
 * The same context can be handed to every spawn of an encounter, and to
 * {@link planEncounterRoster} before them, so the roster and the bodies agree
 * on the tier and draw from one random stream.
 */
export interface SpawnContext {
  readonly encounter: EncounterId;
  /** Live play passes `Math.random`; a harness passes a seeded stream. */
  readonly random: () => number;
  /** The variety tier to spawn at; the live tier when absent. */
  readonly tier?: VarietyTier;
}

/** A spawn context for one kind that may also ask for a particular look. */
type KindSpawnContext<K extends MobKind> = SpawnContext & {
  /**
   * A look chosen ahead of the spawn (a necromancer warms the clothes of the
   * body it is about to raise). Honoured only while the kind's looks are not
   * shared at the spawn's tier, so a look picked before a tier change cannot
   * bring back a figure the tier has retired.
   */
  readonly variant?: VariantOf<K>;
};

/** A context for live play's own spawns in `encounter`. */
export function liveSpawnContext(encounter: EncounterId): SpawnContext {
  return { encounter, random: Math.random };
}

function tierOf(context: SpawnContext): VarietyTier {
  return context.tier ?? varietyTier();
}

/**
 * A spawned mob whose kind has more than one look. It holds its mob weakly, so
 * the funnel never keeps a left floor's population alive.
 */
interface LiveLook {
  readonly kind: MobKind;
  readonly isGone: () => boolean;
  /**
   * Re-dresses a living mob in its kind's shared look when `tier` shares it;
   * returns whether its look changed.
   */
  readonly wearSharedLook: (tier: VarietyTier) => boolean;
}

/**
 * Every spawned mob with more than one look, wherever it is held: an active
 * scene's roster, or a dungeon floor set aside while the party is indoors.
 */
const liveLooks = new Set<LiveLook>();

/**
 * Size {@link liveLooks} may reach before the entries of collected mobs are
 * dropped. Doubled past each prune's survivors, so a long session pays for
 * pruning in proportion to its spawns.
 */
const LIVE_LOOK_PRUNE_FLOOR = 256;
const LIVE_LOOK_PRUNE_GROWTH = 2;
let liveLookPruneAt = LIVE_LOOK_PRUNE_FLOOR;

function pruneGoneLooks(): void {
  for (const live of liveLooks) if (live.isGone()) liveLooks.delete(live);
}

function trackLiveLook<M extends Mob, V>(
  kind: MobKind,
  mob: M,
  family: MobVariantFamily<V>,
  applyVariant: (mob: M, variant: V) => boolean,
): void {
  // Absent from browsers older than weak references; their mobs keep their looks.
  if (typeof WeakRef === 'undefined') return;
  const ref = new WeakRef(mob);
  liveLooks.add({
    kind,
    isGone: () => ref.deref() === undefined,
    wearSharedLook: (tier) => {
      const live = ref.deref();
      if (live === undefined || !live.isAlive || !isLookShared(family, tier)) return false;
      return applyVariant(live, family.canonical);
    },
  });
  if (liveLooks.size < liveLookPruneAt) return;
  pruneGoneLooks();
  liveLookPruneAt = Math.max(LIVE_LOOK_PRUNE_FLOOR, liveLooks.size * LIVE_LOOK_PRUNE_GROWTH);
}

/**
 * The one way a hostile mob enters the game: built as `kind` on `tile`,
 * wearing the look its family and the tier choose, bound to `map`, its first
 * rows warming, and stamped with its kind.
 *
 * Never substitutes one kind for another; an encounter with a ladder resolves
 * its roster first through {@link planEncounterRoster}.
 */
export function spawnMob<K extends MobKind>(
  kind: K,
  tile: SpawnTile,
  map: GameMap,
  context: KindSpawnContext<K>,
  ...options: SpawnOptionArgs<K>
): MobOf<K>;
export function spawnMob<K extends MobKind>(
  kind: K,
  tile: SpawnTile,
  map: GameMap,
  context: KindSpawnContext<K>,
  ...options: KindOptionArgs<OptionsOf<K>>
): MobOf<K> {
  const entry: MobKindEntry<MobOf<K>, VariantOf<K>, OptionsOf<K>> = MOB_KINDS[kind];
  const lookTier = lookTierFor(context.encounter, tierOf(context));
  const requested = context.variant;
  const resolved = resolveVariant(entry.family, lookTier, context.random);
  const variant =
    requested !== undefined && !isLookShared(entry.family, lookTier) ? requested : resolved;
  const mob = entry.create(tile, variant, context.random, ...options);
  mob.setMap(map);
  entry.prewarm?.(variant);
  if (entry.applyVariant !== null) trackLiveLook(kind, mob, entry.family, entry.applyVariant);
  mob.spawnTypeKey = kind;
  return mob;
}

/**
 * Re-dresses every living mob whose look `tier` shares in that shared look,
 * and warms the shared looks' rows of each kind where some mob changed look.
 * Kinds, stats and fights are untouched.
 */
function wearSharedLooks(tier: VarietyTier): void {
  const kindsRedressed = new Set<MobKind>();
  for (const live of liveLooks) {
    if (live.isGone()) liveLooks.delete(live);
    else if (live.wearSharedLook(tier)) kindsRedressed.add(live.kind);
  }
  for (const kind of kindsRedressed) MOB_KINDS[kind].warm(tier);
}

// A purge has just blanked the screen and every figure repaints, so it is the
// one moment a live mob can change look without being seen to. A tier step
// from lag alone never re-dresses anyone. This runs after the figure cache's
// own flush, which registers first because the mob kinds imported above
// import it, so the rows warmed here survive the recovery.
onCanvasRecovery((cause) => {
  if (cause === 'purged') wearSharedLooks(varietyTier());
});

/** `roster` as `context`'s encounter fields it at the context's tier, after its ladder. */
export function planEncounterRoster(roster: Roster, context: SpawnContext): ResolvedRoster {
  return resolveLadderRoster(ladderFor(context.encounter), roster, tierOf(context));
}
