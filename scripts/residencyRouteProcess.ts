/**
 * Runs one residency route in the calling process and hands back what it
 * measured, or spawns a fresh process to run it. Each route needs a process of
 * its own, so no cache one route warmed can flatter another; the world seed,
 * viewport and pixel ratio are pinned here for every caller.
 *
 * Free of game imports at load time: the browser shim is installed before any
 * route driver is imported.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RESIDENCY_FLOORS,
  routeResultSchema,
  type ResidencyFloor,
  type RouteResult,
} from './residencyRoutes.js';

/** A Retina display, as the game is played on: below 2 the figure cache bakes at half density. */
const RETINA_DEVICE_PIXEL_RATIO = 2;
const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: RETINA_DEVICE_PIXEL_RATIO } as const;
/** Seeds `Math.random` before any game module draws from it. */
const RANDOM_SEED = 1;

export interface ResidencyRouteOptions {
  readonly findRetainers: boolean;
  /** Interiors floor 3's tour visits; fewer than the full tour for a quick look. */
  readonly interiors?: number;
  /** The buildings floor 3's tour visits first, in order. */
  readonly firstBuildings?: readonly string[];
  readonly fault?: string;
}

/** Runs `route` of `floor` in this process. Call at most once per process. */
export async function runResidencyRouteHere(
  floor: ResidencyFloor,
  route: string,
  options: ResidencyRouteOptions,
): Promise<RouteResult> {
  const { installBrowserShim } = await import('./browserShim.js');
  const shim = installBrowserShim(VIEWPORT);
  const { mulberry32 } = await import('../src/sprites/person/rng.js');
  Math.random = mulberry32(RANDOM_SEED);
  const scratch = mkdtempSync(join(tmpdir(), 'residency-'));
  try {
    switch (floor) {
      case '3': {
        const floor3Route = RESIDENCY_FLOORS['3'].routes.find((known) => known === route);
        if (floor3Route === undefined) throw new Error(`floor 3 has no route ${route}`);
        const { runFloor3Route } = await import('./residencyFloor3.js');
        return await runFloor3Route(floor3Route, {
          shim,
          scratchDirectory: scratch,
          findRetainers: options.findRetainers,
          interiors: options.interiors,
          firstBuildings: options.firstBuildings,
          fault: options.fault,
        });
      }
      case 'scaled-city': {
        if (route !== 'walk' && route !== 'arrive')
          throw new Error(`the scaled city has no route ${route}`);
        const { runScaledCityRoute } = await import('./residencyScaledCity.js');
        return await runScaledCityRoute(route);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What a route run in its own process left: its result, or null if it failed, and everything it printed. */
export interface ChildRouteRun {
  readonly route: string;
  readonly result: RouteResult | null;
  readonly output: string;
}

/**
 * Runs `script` again in a fresh node process with the same flags as this
 * one, adding `--json=<file>` for the route's result, and resolves once it has
 * exited. Runs of several routes may overlap; with `echo` the child's output
 * is also passed through as it is printed.
 */
export function runRouteInChild(
  script: string,
  route: string,
  args: readonly string[],
  echo = false,
): Promise<ChildRouteRun> {
  const directory = mkdtempSync(join(tmpdir(), 'residency-route-'));
  const out = join(directory, `${route}.json`);
  const child = spawn(
    process.execPath,
    [...process.execArgv, script, `--route=${route}`, `--json=${out}`, ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString());
    if (echo) process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString());
    if (echo) process.stderr.write(chunk);
  });
  return new Promise((resolve) => {
    child.on('close', (status) => {
      const output = chunks.join('');
      try {
        const result =
          status === 0 ? routeResultSchema.parse(JSON.parse(readFileSync(out, 'utf8'))) : null;
        resolve({ route, result, output });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
}
