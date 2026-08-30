/**
 * Shared output routing for review/contact-sheet harnesses (`render-*.ts` and
 * similar). These scripts produce throwaway PNGs for a human to eyeball, as
 * opposed to `generate-*.ts` scripts, which bake real product art into
 * `src/images/`. Keeping review output in one gitignored directory stops it
 * from littering the repo root or getting mistaken for shipped art.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const PREVIEW_DIR = 'preview';

/**
 * Resolves an `--out` flag value (or a `preview/`-rooted default) to an
 * absolute path, creates its directory, writes the PNG, and returns the
 * resolved path. A caller-supplied `--out` is honored verbatim — only a
 * script's own default should live under `PREVIEW_DIR`.
 */
export function writePreviewPng(outFlagValue: string, buffer: Buffer): string {
  const resolvedPath = resolve(outFlagValue);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, buffer);
  return resolvedPath;
}
