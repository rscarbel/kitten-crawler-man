import { saveOutcomeCommitted, type SaveWriteOutcome } from './progressPersistence';

/**
 * Waits for a save to answer and only then makes it the respawn point, and
 * only while nothing newer has taken that place in the meantime. A refused
 * write leaves the previous respawn point standing, so a death cannot bring
 * back a moment the game has already undone, such as a wheel spin refunded
 * because storage would not record it.
 */
export async function adoptWhenCommitted(
  write: Promise<SaveWriteOutcome>,
  stillCurrent: () => boolean,
  adopt: () => void,
): Promise<SaveWriteOutcome> {
  const outcome = await write;
  if (saveOutcomeCommitted(outcome) && stillCurrent()) adopt();
  return outcome;
}
