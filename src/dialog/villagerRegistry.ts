/**
 * The role-typed registries generic Briar Hollow code reads a villager
 * through, keyed by id. Kept out of `src/dialog/scripts/` on purpose: that
 * directory is swept by `verify:dialog-lines` on the assumption that every
 * exported object literal in it is a line of dialogue someone wrote — these
 * are lookup tables built from lines already declared (and already checked)
 * in each villager's own script file, so sweeping them a second time would
 * only ever flag their own key names, which nothing ever spells out literally
 * (every reader indexes them by a variable).
 */

import type { ShopkeeperLines, SoldierLines, VillagerLines } from './roles';
import {
  BRAMBLEWICK,
  CRICKET,
  FENNA,
  GARN,
  HOBB,
  MARTA,
  MERRIT,
  MIDGE,
  NELLA,
  OREN,
  PIPKIN,
  PRU,
  SEDGE,
  SELLA,
  TIKKA,
  VETCH,
  WICKER,
  type ShopkeeperId,
  type SoldierId,
  type VillagerId,
} from './scripts/briarHollow';
import {
  CHILD_BURR,
  CHILD_NIB,
  ELDER_BRACKEN,
  ELDER_THISTLE,
  type UnnamedVillager,
  type UnnamedVillagerId,
} from './scripts/briarHollow/unnamed';

/**
 * Each villager's own file writes only `as const` — no `satisfies` against a
 * role interface — because that would be a fresh object literal checked
 * against the interface, and TypeScript's excess-property check would then
 * reject every property a villager's script carries beyond the role's own
 * (`BRAMBLEWICK.briefing`, `TIKKA.reportPlans`, …). Checking the role instead
 * happens once, here, against an object literal whose *values* are
 * identifiers (`BRAMBLEWICK`, `MERRIT`, …) rather than nested literals — the
 * excess-property check never looks past an identifier, so a villager's own
 * extra properties pass, while a required role member that is missing or
 * mistyped still fails right here, at the villager's own key.
 *
 * Annotated with the same `Record<VillagerId, VillagerLines>` `satisfies`
 * already confirms: without it, indexing by a variable id would see the
 * union of every villager's own richer type rather than the shared shape a
 * generic reader needs. The ladder that reads this registry is generic over
 * every villager, including ones that lack an optional member entirely
 * rather than declaring it `undefined`. Code about one villager in
 * particular reads that villager's own export (`BRAMBLEWICK.…`) instead,
 * which keeps its full type.
 */
export const VILLAGER_SCRIPTS: Record<VillagerId, VillagerLines> = {
  bramblewick: BRAMBLEWICK,
  merrit: MERRIT,
  pipkin: PIPKIN,
  sella: SELLA,
  vetch: VETCH,
  oren: OREN,
  tikka: TIKKA,
  fenna: FENNA,
  garn: GARN,
  sedge: SEDGE,
  hobb: HOBB,
  marta: MARTA,
  pru: PRU,
  nella: NELLA,
  cricket: CRICKET,
  wicker: WICKER,
  midge: MIDGE,
} as const satisfies Record<VillagerId, VillagerLines>;

/**
 * See {@link VILLAGER_SCRIPTS} on why this checks a `satisfies Record<...>`
 * of identifiers rather than each villager's own file. Annotated with the
 * same type `satisfies` already confirms, so a generic read — `SOLDIER_SCRIPTS[id].commandFollow`
 * — sees `SoldierLines`, not the union of every soldier's own richer type.
 */
export const SOLDIER_SCRIPTS: Record<SoldierId, SoldierLines> = {
  sedge: SEDGE,
  hobb: HOBB,
  marta: MARTA,
  pru: PRU,
} as const satisfies Record<SoldierId, SoldierLines>;

/** See {@link VILLAGER_SCRIPTS} on why this checks a `satisfies Record<...>` of identifiers rather than each villager's own file, and is annotated the same way {@link SOLDIER_SCRIPTS} is. */
export const SHOPKEEPER_SCRIPTS: Record<ShopkeeperId, ShopkeeperLines> = {
  pipkin: PIPKIN,
  sella: SELLA,
  vetch: VETCH,
  oren: OREN,
} as const satisfies Record<ShopkeeperId, ShopkeeperLines>;

/** See {@link VILLAGER_SCRIPTS} on why this lookup lives here rather than beside the four unnamed villagers' own lines. */
export const UNNAMED_VILLAGERS: Readonly<Record<UnnamedVillagerId, UnnamedVillager>> = {
  elder_bracken: ELDER_BRACKEN,
  elder_thistle: ELDER_THISTLE,
  child_nib: CHILD_NIB,
  child_burr: CHILD_BURR,
};
