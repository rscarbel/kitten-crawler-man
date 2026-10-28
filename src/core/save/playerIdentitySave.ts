import type { PlayerIdentity } from '../../characters/playerIdentity';
import { isComplexion, isCrawlerBody } from '../../characters/crawlerChoices';
import { parsePlayerName } from '../naming/playerName';
import { isRecord } from '../util/guards';

/**
 * A stored `playerIdentity`, or undefined when any part of it is not one this
 * build makes: a name {@link parsePlayerName} would not have given exactly as
 * stored, or a body or complexion it does not have.
 */
export function parseSavedPlayerIdentity(raw: unknown): PlayerIdentity | undefined {
  if (!isRecord(raw)) return undefined;
  const { name: storedName, body, complexion } = raw;
  if (
    typeof storedName !== 'string' ||
    typeof body !== 'string' ||
    typeof complexion !== 'string'
  ) {
    return undefined;
  }
  const name = parsePlayerName(storedName);
  if (name === null || name !== storedName) return undefined;
  if (!isCrawlerBody(body) || !isComplexion(complexion)) return undefined;
  return { name, body, complexion };
}
