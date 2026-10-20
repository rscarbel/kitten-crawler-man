/**
 * The ES256 key the game server signs AI player tokens with. The private half
 * never leaves this process: the browser only ever sees signed tokens, and the
 * AI server verifies them against the public half published as a JWKS.
 *
 * The key comes from `AI_SIGNING_KEY_PEM` (a PKCS#8 P-256 private key) when it
 * is set, otherwise from a file in `AI_SIGNING_KEY_DIR` (default `.keys/` at
 * the repo root, gitignored), generated there on first run.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEY_DIR = '.keys';
const KEY_FILE_NAME = 'ai-player-token-es256.pem';
/** Owner-only: the key directory and file are never readable by other local users. */
const KEY_DIR_MODE = 0o700;
const KEY_FILE_MODE = 0o600;

export const AI_TOKEN_ALGORITHM = 'ES256';

export interface PublicJwk {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
  readonly kid: string;
  readonly alg: typeof AI_TOKEN_ALGORITHM;
  readonly use: 'sig';
}

export interface AiSigningKey {
  readonly privateKey: KeyObject;
  readonly kid: string;
  readonly jwk: PublicJwk;
}

function loadOrCreatePrivateKey(): KeyObject {
  const fromEnv = process.env.AI_SIGNING_KEY_PEM;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return createPrivateKey(fromEnv.replace(/\\n/g, '\n'));
  }
  const keyDir = path.resolve(REPO_ROOT, process.env.AI_SIGNING_KEY_DIR ?? DEFAULT_KEY_DIR);
  const keyFile = path.join(keyDir, KEY_FILE_NAME);
  if (existsSync(keyFile)) return createPrivateKey(readFileSync(keyFile, 'utf8'));

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  mkdirSync(keyDir, { recursive: true, mode: KEY_DIR_MODE });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  writeFileSync(keyFile, pem, { mode: KEY_FILE_MODE });
  console.log(`Generated a new AI player-token signing key at ${keyFile}`);
  return privateKey;
}

/** RFC 7638 thumbprint: stable for the key, so a verifier's cached JWKS stays valid across restarts. */
function thumbprint(x: string, y: string): string {
  const canonical = JSON.stringify({ crv: 'P-256', kty: 'EC', x, y });
  return createHash('sha256').update(canonical).digest('base64url');
}

function describeKey(privateKey: KeyObject): AiSigningKey {
  const exported = createPublicKey(privateKey).export({ format: 'jwk' });
  const { kty, crv, x, y } = exported;
  if (kty !== 'EC' || crv !== 'P-256' || x === undefined || y === undefined) {
    throw new Error('The AI signing key must be an EC P-256 key');
  }
  const kid = thumbprint(x, y);
  return {
    privateKey,
    kid,
    jwk: { kty, crv, x, y, kid, alg: AI_TOKEN_ALGORITHM, use: 'sig' },
  };
}

let cached: AiSigningKey | null = null;

/** The signing key, loaded (or generated) on first use. */
export function aiSigningKey(): AiSigningKey {
  cached ??= describeKey(loadOrCreatePrivateKey());
  return cached;
}
