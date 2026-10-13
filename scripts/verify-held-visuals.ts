/**
 * Checks the held-visual registry without rendering anything:
 *
 *   npm run verify:held-visuals
 *
 * - every held visual id is registered under its own id and fits its archetype;
 * - every working tool — each tier of axe and pick, and Merrit's scythe —
 *   names a two-handed held visual on its item;
 * - every weapon item names a held visual whose archetype belongs to every
 *   crawler the item allows — one look serves one wearer, so a weapon both
 *   crawlers may hold fails until it has a look for each;
 * - a held visual built outside its archetype's ranges throws, naming the item
 *   and the range it broke;
 * - the proving weapons are named nowhere in the game but their own item
 *   definitions and icons, so no loot table, shop or quest can hand them out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ITEM_DEF, isItemId, wearerAllows } from '../src/core/ItemDefs.js';
import type { CrawlerKind } from '../src/core/SkillManager.js';
import { archetypeSpec } from '../src/sprites/held/gripArchetypes.js';
import {
  defineHeldVisual,
  type HeldVisualDef,
  HeldVisualRangeError,
  heldVisualViolations,
} from '../src/sprites/held/heldVisualDef.js';
import { HELD_VISUAL_IDS } from '../src/sprites/held/heldVisualIds.js';
import { HELD_VISUALS, workingToolHeldVisual } from '../src/sprites/held/heldVisuals.js';
import {
  isToolTier,
  type ToolKind,
  TOOL_TIER_BASIC,
  TOOL_TIERS,
  type WorkingTool,
} from '../src/core/toolTiers.js';

const TOOL_KINDS = ['axe', 'pickaxe'] as const satisfies readonly ToolKind[];

function isWorkingTool(tool: { kind: WorkingTool['kind']; tier: number }): tool is WorkingTool {
  return isToolTier(tool.tier);
}

const CRAWLER_KINDS = ['human', 'cat'] as const satisfies readonly CrawlerKind[];

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

for (const id of HELD_VISUAL_IDS) {
  const def = HELD_VISUALS[id];
  const broken = heldVisualViolations(def);
  check(
    def.id === id && broken.length === 0,
    `${id} is registered as itself and fits ${def.archetype}${broken.length > 0 ? `: ${broken.join('; ')}` : ''}`,
  );
}

for (const id of Object.keys(ITEM_DEF).filter(isItemId)) {
  const def = ITEM_DEF[id];
  if (def.weapon === undefined) continue;
  const visual = HELD_VISUALS[def.weapon.heldVisual];
  const archetypeWearer = archetypeSpec(visual.archetype).wearer;
  const holders = CRAWLER_KINDS.filter((kind) => wearerAllows(def.wearer, kind));
  const unlooked = holders.filter((kind) => kind !== archetypeWearer);
  check(
    unlooked.length === 0,
    `${id} (wearer ${def.wearer}) is held as ${visual.id} (${visual.archetype}, a ${archetypeWearer} archetype)` +
      (unlooked.length > 0 ? `; no look for ${unlooked.join(', ')}` : ''),
  );
}

const workingTools: WorkingTool[] = [
  ...TOOL_KINDS.flatMap((kind) =>
    TOOL_TIERS[kind].map((_tier, tier) => ({ kind, tier })).filter(isWorkingTool),
  ),
  { kind: 'scythe', tier: TOOL_TIER_BASIC },
];
for (const tool of workingTools) {
  const look = workingToolHeldVisual(tool);
  check(
    look !== null && archetypeSpec(look.archetype).heldIn.length > 1,
    `the ${tool.kind} of tier ${tool.tier} names its look on its item, a two-handed haft` +
      (look === null ? ' (names none)' : ` (${look.id}, ${look.archetype})`),
  );
}

const OUT_OF_RANGE_NAME = 'Overlong test sword';
const OUT_OF_RANGE_HANDLE = 2;
const outOfRange: HeldVisualDef = {
  ...HELD_VISUALS.plain_arming_sword,
  name: OUT_OF_RANGE_NAME,
  handle: { length: OUT_OF_RANGE_HANDLE, radius: 'thin' },
};
let thrown: unknown = null;
try {
  defineHeldVisual(outOfRange);
} catch (error) {
  thrown = error;
}
const message = thrown instanceof HeldVisualRangeError ? thrown.message : '';
check(
  message.includes(OUT_OF_RANGE_NAME) && message.includes('handle.length'),
  `an out-of-range held visual throws naming the item and the range (${message || 'nothing thrown'})`,
);

const PROVING_ITEM_IDS = ['dev_plain_sword', 'dev_spiked_club', 'dev_felling_axe'] as const;
/** The only modules that may name a proving weapon: its definition and its icon. */
const PROVING_ITEM_HOMES: ReadonlySet<string> = new Set([
  'src/core/ItemDefs.ts',
  'src/ui/icons/itemIcons.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const strays: string[] = [];
for (const path of sourceFiles('src')) {
  const file = relative('.', path);
  if (PROVING_ITEM_HOMES.has(file)) continue;
  const text = readFileSync(path, 'utf8');
  for (const id of PROVING_ITEM_IDS) if (text.includes(id)) strays.push(`${id} in ${file}`);
}
check(
  strays.length === 0,
  `the proving weapons are named nowhere loot, shops or quests could reach (${strays.join(', ') || 'none'})`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} held-visual check(s) failed`);
  process.exit(1);
}
console.log('\nheld visuals: every check passed');
