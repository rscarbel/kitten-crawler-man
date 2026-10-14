import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Hex digits kept from the SHA-256: enough to catch a swapped file, short enough to read. */
const AUDIO_HASH_HEX_LENGTH = 16;

/** Content hash recorded per file by `measure:audio` and re-checked by `check:audio`. */
export function hashAudioFile(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
    .slice(0, AUDIO_HASH_HEX_LENGTH);
}
