import type { VarietyTier } from '../core/perf/varietyTier';
import { isProtectedKind, threatOf, type MobKind } from './mobKinds';

/**
 * How far apart two kinds' threats may be for one body of the first to stand
 * in for one body of the second. Past this the swap would change the fight,
 * so the count has to change with it.
 */
const ONE_FOR_ONE_THREAT_BAND = 1.5;

const MIN_BODIES_FOR_A_REPLACED_KIND = 1;

/** From `tier` on, `kind` spawns as `standIn`. */
export interface LadderRow {
  readonly tier: VarietyTier;
  readonly kind: MobKind;
  readonly standIn: MobKind;
}

/**
 * An encounter's kind substitutions, in the order its tiers take them. A
 * stand-in removed by a later row resolves through that row in turn.
 */
export type Ladder = readonly LadderRow[];

/** So many bodies of one kind. */
export interface RosterEntry {
  readonly kind: MobKind;
  readonly count: number;
}

export type Roster = readonly RosterEntry[];

/** One stand-in's share of a resolved roster: the bodies it replaced and how many it became. */
interface LadderSubstitution {
  readonly standIn: MobKind;
  readonly replaced: readonly MobKind[];
  readonly bodiesIn: number;
  readonly bodiesOut: number;
  /** The summed threat of every replaced body. */
  readonly threatIn: number;
}

export interface ResolvedRoster {
  readonly roster: Roster;
  readonly substitutions: readonly LadderSubstitution[];
}

/**
 * The kind `kind` spawns as at `tier`: itself, or the end of its chain of
 * stand-ins. Protected kinds are never substituted, whatever a ladder says.
 */
export function standInFor(ladder: Ladder, kind: MobKind, tier: VarietyTier): MobKind {
  if (isProtectedKind(kind)) return kind;
  const visited = new Set<MobKind>([kind]);
  let current = kind;
  for (;;) {
    const row = ladder.find((candidate) => candidate.kind === current && candidate.tier <= tier);
    if (row === undefined || visited.has(row.standIn)) return current;
    visited.add(row.standIn);
    current = row.standIn;
  }
}

/**
 * A roster as it spawns at `tier` under `ladder`.
 *
 * Substituted bodies are pooled per stand-in across the whole roster and
 * converted by threat, `threat(kind) / threat(standIn)` a body, rounded to the
 * nearest whole body once per stand-in, and never below one body while any
 * was replaced: a roster that brought a kind still brings something. Pooling
 * first is what lets a pack of light kinds become a few heavier bodies without
 * each one rounding away. Entries keep the order their kinds first appear in.
 */
export function resolveLadderRoster(
  ladder: Ladder,
  roster: Roster,
  tier: VarietyTier,
): ResolvedRoster {
  const order: MobKind[] = [];
  const kept = new Map<MobKind, number>();
  const pooled = new Map<MobKind, { replaced: MobKind[]; bodies: number; threat: number }>();
  const noteOrder = (kind: MobKind): void => {
    if (!order.includes(kind)) order.push(kind);
  };
  for (const { kind, count } of roster) {
    if (count <= 0) continue;
    const standIn = standInFor(ladder, kind, tier);
    noteOrder(standIn);
    if (standIn === kind) {
      kept.set(kind, (kept.get(kind) ?? 0) + count);
      continue;
    }
    const pool = pooled.get(standIn) ?? { replaced: [], bodies: 0, threat: 0 };
    if (!pool.replaced.includes(kind)) pool.replaced.push(kind);
    pool.bodies += count;
    pool.threat += count * threatOf(kind);
    pooled.set(standIn, pool);
  }
  const substitutions: LadderSubstitution[] = [];
  const resolved: RosterEntry[] = [];
  for (const kind of order) {
    const pool = pooled.get(kind);
    const bodiesOut =
      pool === undefined
        ? 0
        : Math.max(MIN_BODIES_FOR_A_REPLACED_KIND, Math.round(pool.threat / threatOf(kind)));
    if (pool !== undefined) {
      substitutions.push({
        standIn: kind,
        replaced: pool.replaced,
        bodiesIn: pool.bodies,
        bodiesOut,
        threatIn: pool.threat,
      });
    }
    const count = (kept.get(kind) ?? 0) + bodiesOut;
    if (count > 0) resolved.push({ kind, count });
  }
  return { roster: resolved, substitutions };
}

/** Whether two threats are close enough for one body to replace one body. */
function withinOneForOneBand(threatA: number, threatB: number): boolean {
  const ratio = threatA / threatB;
  return ratio <= ONE_FOR_ONE_THREAT_BAND && ratio >= 1 / ONE_FOR_ONE_THREAT_BAND;
}

/**
 * Whether a substitution is fair: it fields at least one body, and either it
 * changed the body count by pooling the replaced threat into the nearest
 * whole number of stand-ins, or the replaced bodies' average threat is within
 * {@link ONE_FOR_ONE_THREAT_BAND} of the stand-in's. A pool too small to round
 * to a body, kept at one by {@link resolveLadderRoster}, was not pooled, so
 * it is judged by the band.
 */
export function substitutionRespectsBand(substitution: LadderSubstitution): boolean {
  const { bodiesIn, bodiesOut, threatIn } = substitution;
  if (bodiesOut <= 0) return false;
  const standInThreat = threatOf(substitution.standIn);
  const pooledBodies = Math.round(threatIn / standInThreat);
  if (bodiesIn !== bodiesOut && bodiesOut === pooledBodies) return true;
  return withinOneForOneBand(threatIn / bodiesIn, standInThreat);
}

/** Every rule `ladder` breaks, as readable lines; empty when it is sound. */
export function validateLadder(ladder: Ladder): string[] {
  const problems: string[] = [];
  const seenKinds = new Set<MobKind>();
  for (const row of ladder) {
    const label = `tier ${row.tier}: ${row.kind} → ${row.standIn}`;
    if (isProtectedKind(row.kind)) problems.push(`${label} substitutes a protected kind`);
    if (isProtectedKind(row.standIn)) problems.push(`${label} stands in a protected kind`);
    // Substitution counts are threat ratios, so a kind rated 0 would vanish or divide by zero.
    if (threatOf(row.kind) <= 0) problems.push(`${label} substitutes a kind with no threat`);
    if (threatOf(row.standIn) <= 0) problems.push(`${label} stands in a kind with no threat`);
    if (seenKinds.has(row.kind)) problems.push(`${label} names a kind an earlier row already did`);
    seenKinds.add(row.kind);
    if (leadsBackTo(ladder, row.standIn, row.kind)) {
      problems.push(`${label} leads back to ${row.kind}`);
    }
  }
  return problems;
}

/** Whether following stand-ins from `start`, at any tier, ever reaches `target`. */
function leadsBackTo(ladder: Ladder, start: MobKind, target: MobKind): boolean {
  const visited = new Set<MobKind>();
  let current: MobKind | undefined = start;
  while (current !== undefined && !visited.has(current)) {
    if (current === target) return true;
    visited.add(current);
    const from: MobKind = current;
    current = ladder.find((candidate) => candidate.kind === from)?.standIn;
  }
  return false;
}
