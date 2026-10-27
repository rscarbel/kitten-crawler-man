/**
 * The contract record through a save, for `verify:construction-contracts`: a
 * half-done contract survives capture, JSON and restore unchanged and shares
 * no array with the live record; and a save with a missing, malformed or
 * unknown contract record is refused outright.
 */

import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
} from '../../src/core/quests/briarHollowState';
import { isRecord, ownEntry } from '../../src/core/util/guards';
import {
  completeContract,
  issueContract,
} from '../../src/systems/constructionContracts/contractGenerator';
import type { Check } from './shared';

const SAVE_SEED = 4242;
const UNKNOWN_SPOT_ID = 'no_such_spot';

/** A save as it comes back off disk: plain JSON, nothing shared with the live record. */
function throughJson(snapshot: object): unknown {
  const parsed: unknown = JSON.parse(JSON.stringify(snapshot));
  return parsed;
}

/**
 * A record mid-career: one contract already paid out (so the last site and
 * its set are remembered) and a second with every other spot done.
 */
function halfDoneState(): ReturnType<typeof createBriarHollowState> {
  const state = createBriarHollowState();
  state.blueprints.phase = 'complete';
  state.contracts.introSeen = true;
  const first = issueContract(state.contracts, () => true, SAVE_SEED);
  first?.spotsDone.fill(true);
  completeContract(state.contracts);
  const active = issueContract(state.contracts, () => true, SAVE_SEED);
  active?.spotsDone.forEach((_, index) => {
    active.spotsDone[index] = index % 2 === 0;
  });
  return state;
}

function verifyRoundTrip(check: Check): void {
  const state = halfDoneState();
  const active = state.contracts.active;
  check(active !== null, 'a half-done contract is held');
  if (active === null) return;
  const done = active.spotsDone.filter(Boolean).length;
  check(done > 0 && done < active.spotIds.length, `half done (${done}/${active.spotIds.length})`);
  const snapshot = captureBriarHollowState(state);
  check(snapshot.contracts !== state.contracts, 'capture copies the record');
  check(
    snapshot.contracts.active !== null &&
      snapshot.contracts.active.spotsDone !== active.spotsDone &&
      snapshot.contracts.active.spotIds !== active.spotIds,
    'capture shares no array with the live contract',
  );
  const parsed = parseBriarHollowStateSnapshot(throughJson(snapshot));
  check(parsed !== undefined, 'the save parses');
  if (parsed === undefined) return;
  const restored = createBriarHollowState();
  restoreBriarHollowState(restored, parsed);
  check(
    JSON.stringify(restored.contracts) === JSON.stringify(state.contracts),
    'capture → JSON → parse → restore gives the same contract record',
  );
  const lastSlug = state.contracts.lastSiteKey;
  check(lastSlug !== null, 'the paid-out site is remembered');
  const rememberedSet = (record: typeof state.contracts): readonly string[] | undefined =>
    lastSlug === null ? undefined : ownEntry(record.lastSpotSetBySite, lastSlug);
  const restoredActive = restored.contracts.active;
  check(
    restoredActive !== null &&
      restoredActive.spotsDone !== parsed.contracts.active?.spotsDone &&
      restoredActive.spotIds !== parsed.contracts.active?.spotIds &&
      rememberedSet(restored.contracts) !== undefined &&
      rememberedSet(restored.contracts) !== rememberedSet(parsed.contracts),
    'restore shares no array with the snapshot',
  );
  const before = JSON.stringify(snapshot.contracts);
  active.spotsDone.fill(true);
  if (lastSlug !== null) state.contracts.lastSpotSetBySite[lastSlug] = [];
  check(
    JSON.stringify(snapshot.contracts) === before,
    'working on after a save leaves the save alone',
  );
}

/** The snapshot as plain JSON with its `contracts` replaced (or removed, for `undefined`). */
function withContracts(contracts: unknown): unknown {
  const raw = throughJson(captureBriarHollowState(halfDoneState()));
  if (!isRecord(raw)) return raw;
  const { contracts: _saved, ...rest } = raw;
  return contracts === undefined ? rest : { ...rest, contracts };
}

function savedContracts(): Record<string, unknown> {
  const raw = throughJson(captureBriarHollowState(halfDoneState()).contracts);
  return isRecord(raw) ? raw : {};
}

function savedActive(): { spotIds: unknown[]; spotsDone: unknown[]; site: unknown } {
  const active = savedContracts().active;
  if (!isRecord(active) || !Array.isArray(active.spotIds) || !Array.isArray(active.spotsDone)) {
    return { spotIds: [], spotsDone: [], site: null };
  }
  const spotIds: unknown[] = active.spotIds;
  const spotsDone: unknown[] = active.spotsDone;
  return { spotIds: [...spotIds], spotsDone: [...spotsDone], site: active.site };
}

function verifyInvalidSavesRejected(check: Check): void {
  check(
    parseBriarHollowStateSnapshot(withContracts(undefined)) === undefined,
    'a save without contracts is refused',
  );

  const saved = savedActive();
  const withUnknown = { ...saved, spotIds: [...saved.spotIds], spotsDone: [...saved.spotsDone] };
  withUnknown.spotIds[1] = UNKNOWN_SPOT_ID;
  check(
    parseBriarHollowStateSnapshot(withContracts({ ...savedContracts(), active: withUnknown })) ===
      undefined,
    'a contract naming a spot the site does not have is refused',
  );

  const shortDone = { ...saved, spotsDone: saved.spotsDone.slice(1) };
  check(
    parseBriarHollowStateSnapshot(withContracts({ ...savedContracts(), active: shortDone })) ===
      undefined,
    'a contract whose done flags do not match its spots is refused',
  );

  const unknownBuilding = parseBriarHollowStateSnapshot(
    withContracts({
      ...savedContracts(),
      active: { ...saved, site: { town: 'taloncrest', buildingName: 'Town Center Tower' } },
    }),
  );
  check(unknownBuilding === undefined, 'a contract at a building that hosts none is refused');

  check(
    parseBriarHollowStateSnapshot(withContracts('not a record')) === undefined,
    'a malformed contracts field is refused',
  );
}

export const saveSections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [
  { name: 'Save round-trip with a half-done contract', run: verifyRoundTrip },
  { name: 'Invalid contract saves are refused', run: verifyInvalidSavesRejected },
];
