/**
 * Which paths under the repo root the server may hand to a browser. The repo
 * root also holds the database directory, `.env`, `node_modules`, the server's
 * own source and old build output, so the static handler only ever sees a
 * request this allowlist accepted: the game's entry files and its art, audio
 * and fonts, matched case-sensitively on the decoded path.
 */
import type { NextFunction, Request, Response } from 'express';

/** The files the game loads by name (the same set `scripts/shipped-assets.js` ships). */
const PUBLIC_FILES: ReadonlySet<string> = new Set([
  '/',
  '/index.html',
  '/main.css',
  '/manifest.json',
  '/sw.js',
  '/dist/bundle.js',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/download/',
  '/download/index.html',
]);

/** Asset directories, each served only for the asset extensions below. */
const PUBLIC_ASSET_DIRS = ['/src/images/', '/src/audio/', '/src/fonts/'] as const;
const PUBLIC_ASSET_EXTENSION = /\.(png|jpe?g|ico|mp3|woff2|ttf|json|txt)$/;

function decodedPath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Whether a request path names a file the browser may fetch. */
export function isPublicPath(rawPath: string): boolean {
  const pathname = decodedPath(rawPath);
  if (pathname === null) return false;
  // No traversal, no hidden files, no backslashes or NULs for the filesystem to reinterpret.
  if (/(^|\/)\.|\\|\0/.test(pathname)) return false;
  if (PUBLIC_FILES.has(pathname)) return true;
  return (
    PUBLIC_ASSET_DIRS.some((dir) => pathname.startsWith(dir)) &&
    PUBLIC_ASSET_EXTENSION.test(pathname)
  );
}

/** Wraps a static handler so it only ever answers allowlisted paths. */
export function servePublicOnly(
  staticHandler: (req: Request, res: Response, next: NextFunction) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isPublicPath(req.path)) {
      next();
      return;
    }
    staticHandler(req, res, next);
  };
}
