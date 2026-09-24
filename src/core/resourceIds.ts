/** Raw and refined materials the village economy trades in. */
export type ResourceId = 'wood' | 'stone' | 'wood_board' | 'rope';

/** Every {@link ResourceId}, for code that needs to iterate the set. */
export const RESOURCE_IDS: readonly ResourceId[] = ['wood', 'stone', 'wood_board', 'rope'];
