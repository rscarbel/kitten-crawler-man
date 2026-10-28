import { isRecord } from '../../core/util/guards';

/** A mud or blood stain on the sand, as the dressing keeps and saves it. */
export interface GroundDecal {
  x: number;
  y: number;
  variant: number;
  life: number;
}

/** What the Iron Colosseum's dressing has to put back after a death. */
export interface ColosseumDressingCheckpoint {
  /** Indices of the cages whose doors have burst, in bearing order. */
  readonly openCages: readonly number[];
  readonly portcullisDown: boolean;
  readonly mudSplatter: readonly Readonly<GroundDecal>[];
  readonly bloodDecals: readonly Readonly<GroundDecal>[];
}

function parseDecals(value: unknown): GroundDecal[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decals: GroundDecal[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { x, y, variant, life } = entry;
    if (typeof x !== 'number' || typeof y !== 'number') return undefined;
    if (typeof variant !== 'number' || typeof life !== 'number') return undefined;
    decals.push({ x, y, variant, life });
  }
  return decals;
}

function parseCageIndices(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const indices: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number') return undefined;
    indices.push(entry);
  }
  return indices;
}

/**
 * Reads the colosseum's part of a saved checkpoint back from untrusted JSON. A
 * missing field or a field of the wrong shape rejects the whole snapshot.
 */
export function parseColosseumDressingCheckpoint(
  value: unknown,
): ColosseumDressingCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { openCages, portcullisDown, mudSplatter, bloodDecals } = value;
  const cages = parseCageIndices(openCages);
  const splatter = parseDecals(mudSplatter);
  const blood = parseDecals(bloodDecals);
  if (cages === undefined || splatter === undefined || blood === undefined) return undefined;
  if (typeof portcullisDown !== 'boolean') return undefined;
  return {
    openCages: cages,
    portcullisDown,
    mudSplatter: splatter,
    bloodDecals: blood,
  };
}
