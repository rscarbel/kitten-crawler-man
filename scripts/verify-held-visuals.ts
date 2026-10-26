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
 * - every claw weapon, worn over the paw rather than held, is the cat's alone
 *   and looks as a garment of hers painted on her forelegs, which E5 of
 *   `gates:equipment` holds to her paws' envelope;
 * - every quest thing the cat carries in her jaws is a look made to be carried
 *   there, and every look she holds is held at its socket on every frame she
 *   plays holding it, on each of her looks;
 * - a held visual built outside its archetype's ranges throws, naming the item
 *   and the range it broke;
 * - no proving weapon (a `dev_*` item) has an entry in `GEAR_SOURCES`, so no
 *   loot table, shop or quest hands one out; the type already refuses one.
 */

import {
  catLookOf,
  clawStatsOf,
  ITEM_DEF,
  isItemId,
  wearerAllows,
  weaponStatsOf,
} from '../src/core/items/defs/ItemDefs.js';
import { wornGarmentOf } from '../src/sprites/garments/garments.js';
import type { CrawlerKind } from '../src/core/skills/SkillManager.js';
import { GEAR_SOURCES } from '../src/loot/gearPools.js';
import { CAT_ROWS } from '../src/sprites/art/catFigure.js';
import { catGripOf, catHeldSocketOf, catSocketsAt } from '../src/sprites/art/catSockets.js';
import { archetypeSpec } from '../src/sprites/held/gripArchetypes.js';
import { CAT_LOOKS } from './catLooks.js';
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
} from '../src/core/items/gathering/toolTiers.js';

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
  // Claws are worn over the paw rather than held, so only hand weapons have a held look.
  const weapon = weaponStatsOf(id);
  if (weapon === null || def.wearer === undefined) continue;
  const visual = HELD_VISUALS[weapon.heldVisual];
  const archetypeWearer = archetypeSpec(visual.archetype).wearer;
  const holders = CRAWLER_KINDS.filter((kind) => wearerAllows(def.wearer, kind));
  const unlooked = holders.filter((kind) => kind !== archetypeWearer);
  check(
    unlooked.length === 0,
    `${id} (wearer ${def.wearer}) is held as ${visual.id} (${visual.archetype}, a ${archetypeWearer} archetype)` +
      (unlooked.length > 0 ? `; no look for ${unlooked.join(', ')}` : ''),
  );
}

for (const id of Object.keys(ITEM_DEF).filter(isItemId)) {
  const claws = clawStatsOf(id);
  if (claws === null) continue;
  const def = ITEM_DEF[id];
  const look = catLookOf(def);
  const garment = look?.kind === 'garment' ? wornGarmentOf('cat', look.garment) : null;
  check(
    def.wearer === 'cat' && garment?.id === claws.garment && garment.region.includes('foreleg'),
    `${id} (wearer ${def.wearer ?? 'none'}) is worn by the cat as ${claws.garment}, painted on her forelegs` +
      (garment === null ? ' (shows as no garment)' : ` (region ${garment.region.join(', ')})`),
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

for (const id of Object.keys(ITEM_DEF).filter(isItemId)) {
  const carried = ITEM_DEF[id].carriedInJaws;
  if (carried === undefined) continue;
  const look = HELD_VISUALS[carried];
  check(
    catGripOf(look) === 'mouthCarry',
    `${id} is carried in the cat's jaws as ${look.id}, a ${look.archetype}`,
  );
}

/**
 * Every look made for the cat is held at its socket on every frame of every
 * row she plays holding it, on each cat: the sockets follow the look's body.
 */
for (const catLook of CAT_LOOKS) {
  for (const id of HELD_VISUAL_IDS) {
    const look = HELD_VISUALS[id];
    const grip = catGripOf(look);
    if (grip === null) continue;
    const holds = grip === 'mouthCarry' ? ['carry'] : ['chop', 'mine'];
    const rows = CAT_ROWS.filter((row) => row.hold !== undefined && holds.includes(row.hold));
    const unheld = rows.flatMap((row) =>
      Array.from({ length: row.frameCount }, (_unused, frame) => frame)
        .filter((frame) => {
          const frames = catSocketsAt(catLook, row.name, frame);
          return frames === null || catHeldSocketOf(look, frames) === null;
        })
        .map((frame) => `${row.name}[${frame}]`),
    );
    check(
      rows.length > 0 && unheld.length === 0,
      `${catLook.id} holds ${id} at her ${grip === 'mouthCarry' ? 'mouth' : 'forepaw'} on every frame of ${rows.length} rows` +
        (unheld.length > 0 ? `; not on ${unheld.join(', ')}` : ''),
    );
  }
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

const PROVING_ITEM_PREFIX = 'dev_';
const provingIds = Object.keys(ITEM_DEF).filter((id) => id.startsWith(PROVING_ITEM_PREFIX));
const sourcedProving = provingIds.filter((id) => id in GEAR_SOURCES);
check(
  provingIds.length > 0 && sourcedProving.length === 0,
  `no proving weapon has a gear source, so no loot table, shop or quest hands one out (${sourcedProving.join(', ') || 'none'})`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} held-visual check(s) failed`);
  process.exit(1);
}
console.log('\nheld visuals: every check passed');
