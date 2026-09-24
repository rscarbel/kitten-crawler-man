import { isRecord } from '../../core/guards';
import { FIRST_DARK_PHASE, LAST_LIGHT_PHASE, type LabLightPhase } from './spiderLabLighting';

/** A cocoon's life: hanging whole, woken and splitting, or torn open. */
export type CocoonState = 'intact' | 'hatching' | 'burst';
const COCOON_STATES: readonly CocoonState[] = ['intact', 'hatching', 'burst'];

/** What the lab has to put back after a death. */
export interface SpiderLabDressingCheckpoint {
  /** Tile keys of the lab's original webbing that are cut. */
  readonly clearedWebs: readonly number[];
  /** Each cocoon, in the room data's order. */
  readonly cocoons: ReadonlyArray<{ readonly hp: number; readonly state: CocoonState }>;
  readonly lightPhase: LabLightPhase;
  readonly lightsRestored: boolean;
  /** Tile keys of benches her slam has smashed the glassware on. */
  readonly brokenBenches: readonly number[];
}

function isCocoonState(value: unknown): value is CocoonState {
  return COCOON_STATES.some((state) => state === value);
}

const LIGHT_PHASES: readonly LabLightPhase[] = [1, FIRST_DARK_PHASE, LAST_LIGHT_PHASE];

function isLightPhase(value: unknown): value is LabLightPhase {
  return LIGHT_PHASES.some((phase) => phase === value);
}

function numberList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return undefined;
    numbers.push(entry);
  }
  return numbers;
}

/** Reads a saved lab checkpoint back from untrusted JSON; undefined when it is malformed. */
export function parseSpiderLabDressingCheckpoint(
  value: unknown,
): SpiderLabDressingCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const clearedWebs = numberList(value.clearedWebs);
  const brokenBenches = numberList(value.brokenBenches);
  const { lightPhase, lightsRestored } = value;
  if (clearedWebs === undefined || brokenBenches === undefined) return undefined;
  if (!isLightPhase(lightPhase) || typeof lightsRestored !== 'boolean') return undefined;
  if (!Array.isArray(value.cocoons)) return undefined;
  const cocoons: Array<{ hp: number; state: CocoonState }> = [];
  for (const entry of value.cocoons) {
    if (!isRecord(entry)) return undefined;
    const { hp, state } = entry;
    if (typeof hp !== 'number' || !isCocoonState(state)) return undefined;
    cocoons.push({ hp, state });
  }
  return { clearedWebs, cocoons, lightPhase, lightsRestored, brokenBenches };
}
