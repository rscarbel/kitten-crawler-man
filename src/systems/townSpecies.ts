/**
 * The species axis for the Over City's people — orthogonal to `TownRole`
 * (a job) and to `ResidentId` (a specific person). Both `Townsperson` and
 * `ResidentDef` carry a real `species` field of this type.
 */
export const TOWN_SPECIES = ['human', 'skyfowl'] as const;

export type TownSpecies = (typeof TOWN_SPECIES)[number];

/**
 * The species assumed for a `SpeciesBearer` that doesn't carry one — a
 * dialog target typed structurally rather than as a real `Townsperson`, for
 * instance. `citizenSpecies` (`townDialog.ts`) is the one place this fallback
 * is read.
 */
export const DEFAULT_TOWN_SPECIES: TownSpecies = 'human';
