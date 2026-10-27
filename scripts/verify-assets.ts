#!/usr/bin/env tsx
/**
 * Cross-references every floor's declared sprite-group coverage against
 * every mob type that floor can actually produce, and fails loudly on
 * anything uncovered — a floor that can spawn a mob whose sprites aren't
 * declared for it will hit a missing-asset error at runtime instead of load.
 *
 * "Every mob a floor can produce" is two unioned sources:
 *
 * 1. The `LevelDef`'s own spawn tables (`roomMobs`, `hallwayMobs`,
 *    `extraSpawns`, `campSpawns`, `onMobKilledSpawns`, `bossRooms`).
 * 2. `SYSTEM_ASSET_REQUIREMENTS` (`src/core/spriteAssets/systemAssetRequirements.ts`) —
 *    creatures introduced by a bounty/quest/companion system that never
 *    touches the level def at all (`BountySystem`, `StarlightTentMazeSystem`,
 *    `SpiderQuestSystem`, `MongoSystem`, ...).
 *
 * Every creature's sprite needs come from `MOB_SPRITE_KEYS` and
 * `FRIENDLY_CREATURE_SPRITE_KEYS`, which are total over their kinds, so `tsc`
 * already guarantees each kind has an entry. This script reads the level defs'
 * actual field values (a def only ever contains what its author wrote) to
 * compute what each floor produces.
 *
 * A second, independent check runs first: every key in the composed sprite
 * manifest must belong to some `ASSET_GROUPS` entry. A key no group names is
 * shipped and precached but never preloaded, so it decodes mid-frame the first
 * time something draws it.
 *
 * Run: npx tsx scripts/verify-assets.ts
 */
import { tutorialLevel, level1, level2, level3 } from '../src/levels/index';
import type { LevelDef } from '../src/levels/types';
import { allMobKinds } from '../src/levels/mobKinds';
import {
  ASSET_GROUPS,
  FRIENDLY_CREATURE_SPRITE_KEYS,
  MOB_SPRITE_KEYS,
  type AssetGroup,
  type CreatureKind,
} from '../src/core/spriteAssets/assetGroups';
import { getManifestKeys, type SpriteKey } from '../src/core/spriteAssets/SpriteLoader';
import {
  SYSTEM_ASSET_REQUIREMENTS,
  requiredSpriteKeysForLevel,
} from '../src/core/spriteAssets/systemAssetRequirements';

const LEVELS: readonly LevelDef[] = [tutorialLevel, level1, level2, level3];

let failures = 0;

function fail(message: string): void {
  failures++;
  console.error(`[verify-assets] FAIL: ${message}`);
}

const CREATURE_SPRITE_KEYS: Readonly<Record<CreatureKind, readonly SpriteKey[]>> = {
  ...MOB_SPRITE_KEYS,
  ...FRIENDLY_CREATURE_SPRITE_KEYS,
};

/** Every mob type a `LevelDef`'s own fields can spawn (not system-introduced). */
function mobTypesFromLevelDef(def: LevelDef): Set<CreatureKind> {
  const types = new Set<CreatureKind>();
  const addRule = (rule: { type: CreatureKind }): void => {
    types.add(rule.type);
  };
  def.roomMobs.forEach(addRule);
  def.hallwayMobs.forEach(addRule);
  (def.extraSpawns ?? []).forEach(addRule);
  (def.onMobKilledSpawns ?? []).forEach(addRule);
  (def.bossRooms ?? []).forEach(addRule);
  if (def.campSpawns) {
    for (const roster of Object.values(def.campSpawns)) {
      roster?.forEach(addRule);
    }
  }
  return types;
}

function keysForGroups(groups: Iterable<AssetGroup>): Set<string> {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const key of ASSET_GROUPS[group]) keys.add(key);
  }
  return keys;
}

// Every manifest key must be reachable from some ASSET_GROUPS entry. Nothing
// else enforces this direction — `ASSET_GROUPS` is typed `readonly SpriteKey[]`,
// so tsc catches a group naming a key that does not exist, but a key no group
// names is invisible: the PNG ships, the service worker precaches it, the
// browser decodes it on first draw, and it pops in mid-frame because no
// `loadGroups` call ever asked for it. Three sheets shipped that way
// (`massive_clown`, `golem_rock`, `golem_rock_burst`) before this check existed.
const keysInSomeGroup = new Set<string>(Object.values(ASSET_GROUPS).flat());
for (const key of getManifestKeys()) {
  if (!keysInSomeGroup.has(key)) {
    fail(
      `Manifest key "${key}" belongs to no ASSET_GROUPS entry (src/core/spriteAssets/assetGroups.ts), so ` +
        `nothing ever preloads it — add it to the group of whatever draws it, or delete the ` +
        `sheet and its manifest entry if nothing does.`,
    );
  }
}

for (const def of LEVELS) {
  const mobTypes = mobTypesFromLevelDef(def);

  for (const req of SYSTEM_ASSET_REQUIREMENTS) {
    if (!req.levelIds.includes(def.id)) continue;
    for (const type of req.mobTypes) mobTypes.add(type);
  }

  for (const group of def.interiorSpriteGroups) {
    if (def.spriteGroups.includes(group)) {
      fail(
        `Floor "${def.id}" lists "${group}" in both spriteGroups and interiorSpriteGroups — ` +
          `an indoor-only group in spriteGroups is painted on arrival, which is what ` +
          `interiorSpriteGroups exists to avoid.`,
      );
    }
  }

  const declaredKeys = requiredSpriteKeysForLevel(def.id, def.spriteGroups);

  for (const type of mobTypes) {
    for (const key of CREATURE_SPRITE_KEYS[type]) {
      if (!declaredKeys.has(key)) {
        fail(
          `Floor "${def.id}" can produce mob type "${type}", which needs sprite key ` +
            `"${key}", but no group in its declared coverage (LevelDef.spriteGroups plus ` +
            `every SYSTEM_ASSET_REQUIREMENTS entry scoped to "${def.id}") includes it.`,
        );
      }
    }
  }
}

// Every SYSTEM_ASSET_REQUIREMENTS entry should also be internally consistent:
// its own requiredGroups should cover its own mobTypes, independent of which
// floor it is scoped to. Catches a system whose declared groups only happen
// to work because some level's own spriteGroups quietly filled the gap.
for (const req of SYSTEM_ASSET_REQUIREMENTS) {
  const declaredKeys = keysForGroups(req.requiredGroups);
  for (const type of req.mobTypes) {
    for (const key of CREATURE_SPRITE_KEYS[type]) {
      if (!declaredKeys.has(key)) {
        fail(
          `SYSTEM_ASSET_REQUIREMENTS entry "${req.id}" can produce mob type "${type}", ` +
            `which needs sprite key "${key}", but the entry's own requiredGroups ` +
            `(${req.requiredGroups.join(', ') || '<none>'}) don't include it.`,
        );
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n[verify-assets] ${failures} failure(s).`);
  process.exit(1);
}
console.log(
  `[verify-assets] OK — ${LEVELS.length} floors, ${SYSTEM_ASSET_REQUIREMENTS.length} system/quest/bounty entries, ${allMobKinds().length} registered mob types, ${getManifestKeys().length} manifest keys, all covered.`,
);
