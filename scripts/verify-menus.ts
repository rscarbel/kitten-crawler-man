#!/usr/bin/env tsx
/**
 * Static checks on the promise every menu makes: that a keyboard alone can reach
 * its buttons.
 *
 * The runtime half of this lives in `auditOverlayFocus`, which compares an open
 * overlay's `focusContext` against the ring the frame actually declared and
 * complains in the console. That only fires for a menu somebody opens. These
 * checks fire for a menu nobody has opened yet, which is the harder half — a
 * panel that forgot `beginMenuFocus` looks perfectly correct on screen and with
 * a mouse, and is only broken for the player who put the mouse down.
 *
 * Four rules, none of them backed by a hand-maintained list of menus:
 *
 *  1. A ring that is opened is closed. `endMenuFocus` is not optional: a scene
 *     keeps drawing after its topmost dialog, and anything drawn while the ring
 *     is still open silently becomes tabbable from inside a modal it has nothing
 *     to do with.
 *  2. Every `focusContext` a scene promises is really declared by somebody —
 *     either exactly, or as the base of a namespaced id (`pause` covers
 *     `pause-journal`), which is how a menu re-keys its ring per tab.
 *  3. A file that paints a full-screen panel and puts buttons on it declares a
 *     ring. This is the rule that would have caught the exit-building menu: it
 *     drew an overlay, a box and two buttons, and answered nothing but a mouse
 *     for its entire life.
 *
 * Not checked here, because it is a compile error and a second check would only
 * ever be green: that every claim carries a `focusContext` at all. The field is
 * required by `OverlayInputClaim`, so a claim without one does not build.
 *
 * Run: npx tsx scripts/verify-menus.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = 'src';
const SCENE_FILES = ['src/scenes/DungeonScene.ts', 'src/scenes/BuildingInteriorScene.ts'];

/**
 * Preview scenes are developer harnesses reached by a URL parameter, not places
 * the game sends anybody. They render one creature and a few dev toggles.
 */
const PREVIEW_SCENE_SUFFIX = 'PreviewScene.ts';

/** Marks a surface that paints over the whole viewport rather than sitting in the HUD. */
const FULL_SCREEN_CALLS = ['drawOverlay(', 'drawModal('];
const BUTTON_CALLS = ['drawButton(', 'addButton('];
const FOCUS_DECLARATIONS = ['beginMenuFocus(', 'suppressMenuFocus('];

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function collectSources(dir: string, out: SourceFile[]): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectSources(path, out);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    out.push({ path, text: readFileSync(path, 'utf8') });
  }
  return out;
}

function matchAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const sources = collectSources(SRC_DIR, []);

// ---------------------------------------------------------------- rule 1

for (const { path, text } of sources) {
  const opens = text.split('beginMenuFocus(').length - 1;
  if (opens === 0) continue;
  // `suppressMenuFocus` is the one caller allowed to open without closing in the
  // same expression, because closing is exactly what it does next.
  if (path.endsWith('ui/Button.ts')) continue;
  check(
    text.includes('endMenuFocus('),
    `${path} opens a focus ring with beginMenuFocus but never closes it with endMenuFocus`,
  );
}

// ---------------------------------------------------------------- rule 2

const declaredIds = new Set<string>();
for (const { text } of sources) {
  for (const declaration of FOCUS_DECLARATIONS) {
    const escaped = declaration.replace('(', '\\(');
    for (const id of matchAll(text, new RegExp(`${escaped}'([^']+)'`, 'g'))) declaredIds.add(id);
  }
}
check(declaredIds.size > 0, 'no focus contexts found at all — the scan is measuring nothing');

const promisedIds = new Set<string>();
for (const path of SCENE_FILES) {
  const text = readFileSync(path, 'utf8');
  for (const id of matchAll(text, /focusContext: '([^']+)'/g)) promisedIds.add(id);
  // The claim helpers take the id positionally: `modal(isOpen, 'exit-building')`.
  for (const id of matchAll(text, /^\s*(?:modal|floatingDialog)\([^)]*, '([^']+)'\)/gm)) {
    promisedIds.add(id);
  }
}
check(
  promisedIds.size > 0,
  'no overlay claims promise a focus context — the scan is measuring nothing',
);

for (const promised of promisedIds) {
  const met = [...declaredIds].some((id) => id === promised || id.startsWith(`${promised}-`));
  check(
    met,
    `overlay claim promises focus context "${promised}", but nothing calls beginMenuFocus or suppressMenuFocus with it`,
  );
}

// ---------------------------------------------------------------- rule 3

for (const { path, text } of sources) {
  if (path.endsWith(PREVIEW_SCENE_SUFFIX)) continue;
  const isFullScreen = FULL_SCREEN_CALLS.some((call) => text.includes(call));
  const hasButtons = BUTTON_CALLS.some((call) => text.includes(call));
  if (!isFullScreen || !hasButtons) continue;
  check(
    FOCUS_DECLARATIONS.some((call) => text.includes(call)),
    `${path} paints a full-screen panel with buttons on it but declares no focus context, so only a mouse can answer it`,
  );
}

// ----------------------------------------------------------------- report

if (failures.length > 0) {
  console.error(`verify:menus — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(
  `verify:menus — all checks passed (${declaredIds.size} focus contexts declared, ${promisedIds.size} promised by overlay claims)`,
);
