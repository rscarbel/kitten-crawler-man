/**
 * The species axis for Taloncrest's people — orthogonal to `TownRole`
 * (a job) and to `ResidentId` (a specific person). Both `Townsperson` and
 * `ResidentDef` carry a real `species` field of this type.
 *
 * What a person is drawn as is a separate question: only a
 * {@link CrowdSpecies} has an authored citizen cast, so only those can be
 * rolled into a crowd or wear a cast look. Anyone else needs a bespoke figure,
 * which `TownspersonFigureOptions`, `OccupantIdentity` and the resident look
 * table each refuse to compile without.
 */
export const CROWD_SPECIES = ['human', 'hawkfolk'] as const;

/** A species with an authored citizen cast: what a crowd may be rolled as. */
export type CrowdSpecies = (typeof CROWD_SPECIES)[number];

export type TownSpecies = CrowdSpecies | 'dwarf' | 'otter' | 'crocodilian';

/**
 * The species assumed for a `SpeciesBearer` that doesn't carry one — a
 * dialog target typed structurally rather than as a real `Townsperson`, for
 * instance — and for an unnamed occupant whose spec names none.
 */
export const DEFAULT_TOWN_SPECIES = 'human' as const satisfies CrowdSpecies;
