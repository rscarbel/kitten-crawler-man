/**
 * The party's formation: together on one map, or split into groups on
 * different maps with exactly one group live.
 *
 * Data only, with no canvas and no creatures, so the save validator (which the
 * server also runs) can parse it. The live side of it, which crawlers a scene
 * places and which it leaves frozen, is `PlayerManager`'s; the moves between
 * groups are `SplitDirector`'s.
 */

import { CRAWLER_KINDS, type CrawlerKind } from '../skills/SkillManager';
import { MERCENARY_TEMPLATE_IDS, type MercenaryTemplateId } from './mercenaryTemplates';
import { isBuildingId, type BuildingId } from '../../map/buildingIds';
import type { TilePoint } from '../../map/town/townPlan';
import { isItemId, type ItemId } from '../items/defs/ItemDefs';
import { isRecord } from '../util/guards';

/** The slots a split can fill. Every split fills all of them. */
export const PARTY_GROUP_IDS = ['first', 'second'] as const;
export type PartyGroupId = (typeof PARTY_GROUP_IDS)[number];

/** Cat allies that can travel with a group, named by what they are, never by who. */
export const CAT_ALLY_IDS = ['tower_cattery_cellmate'] as const;
export type CatAllyId = (typeof CAT_ALLY_IDS)[number];

/** A party companion a group can take with it, named by its own id type. */
export type CompanionRef =
  | { readonly kind: 'mercenary'; readonly hire: MercenaryTemplateId }
  | { readonly kind: 'cat_ally'; readonly ally: CatAllyId };

/** Where a group stands. Every switch over it ends in a `never` check. */
export type PartyLocation =
  | { readonly kind: 'overworld'; readonly tile: TilePoint }
  | {
      readonly kind: 'interior';
      readonly building: BuildingId;
      readonly storey: number;
      readonly tile: TilePoint;
    };

/** A place inside a building, on one of its storeys. */
export type InteriorPartyLocation = Extract<PartyLocation, { readonly kind: 'interior' }>;

export interface PartyGroup {
  readonly id: PartyGroupId;
  readonly crawlers: readonly CrawlerKind[];
  readonly companions: readonly CompanionRef[];
  readonly at: PartyLocation;
}

/** A group as a caller describes it; its id comes from the slot it fills. */
export type PartyGroupDraft = Omit<PartyGroup, 'id'>;

const SPLIT_CHECKED: unique symbol = Symbol('splitChecked');

/**
 * A split that has passed {@link formSplit}. The mark cannot be written outside
 * this module, so a split that breaks the invariants cannot be built anywhere.
 */
export interface SplitFormation {
  readonly kind: 'split';
  readonly groups: Readonly<Record<PartyGroupId, PartyGroup>>;
  readonly live: PartyGroupId;
  readonly [SPLIT_CHECKED]: true;
}

export type PartyFormation = { readonly kind: 'together' } | SplitFormation;

export const PARTY_TOGETHER: PartyFormation = { kind: 'together' };

export type FormSplitResult =
  | { readonly ok: true; readonly formation: SplitFormation }
  | { readonly ok: false; readonly reason: string };

/** A companion's identity as one string, so two refs compare whatever their kind. */
function companionKey(ref: CompanionRef): string {
  switch (ref.kind) {
    case 'mercenary':
      return `${ref.kind}:${ref.hire}`;
    case 'cat_ally':
      return `${ref.kind}:${ref.ally}`;
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

function sameCompanion(a: CompanionRef, b: CompanionRef): boolean {
  return companionKey(a) === companionKey(b);
}

/**
 * The only way to build a split. Every crawler is in exactly one group, every
 * group holds at least one crawler, and no companion travels with two groups.
 */
export function formSplit(
  drafts: Readonly<Record<PartyGroupId, PartyGroupDraft>>,
  live: PartyGroupId,
): FormSplitResult {
  const seenCompanions: CompanionRef[] = [];
  for (const id of PARTY_GROUP_IDS) {
    const draft = drafts[id];
    if (draft.crawlers.length === 0) return { ok: false, reason: `group ${id} holds no crawler` };
    for (const companion of draft.companions) {
      if (seenCompanions.some((seen) => sameCompanion(seen, companion))) {
        return { ok: false, reason: `a ${companion.kind} companion travels with two groups` };
      }
      seenCompanions.push(companion);
    }
  }
  for (const crawler of CRAWLER_KINDS) {
    const holders = PARTY_GROUP_IDS.filter((id) => drafts[id].crawlers.includes(crawler));
    if (holders.length !== 1) {
      return { ok: false, reason: `the ${crawler} is in ${holders.length} groups, not one` };
    }
  }
  const groups: Record<PartyGroupId, PartyGroup> = {
    first: { id: 'first', ...drafts.first },
    second: { id: 'second', ...drafts.second },
  };
  return { ok: true, formation: { kind: 'split', groups, live, [SPLIT_CHECKED]: true } };
}

/** The same split with another group live. The invariants do not depend on which is. */
export function withLiveGroup(formation: SplitFormation, live: PartyGroupId): SplitFormation {
  return { ...formation, live };
}

/** The same split with one group standing somewhere else. */
export function withGroupAt(
  formation: SplitFormation,
  group: PartyGroupId,
  at: PartyLocation,
): SplitFormation {
  const groups = { ...formation.groups, [group]: { ...formation.groups[group], at } };
  return { ...formation, groups };
}

/**
 * The same split with `companion` travelling with `group`: a hire signed or
 * an ally met while the party is apart joins the group that met them. A
 * companion already with another group moves, so none travels with two.
 */
export function withCompanionJoining(
  formation: SplitFormation,
  group: PartyGroupId,
  companion: CompanionRef,
): SplitFormation {
  const groups: Record<PartyGroupId, PartyGroup> = {
    first: withoutCompanion(formation.groups.first, companion),
    second: withoutCompanion(formation.groups.second, companion),
  };
  const joined = groups[group];
  groups[group] = { ...joined, companions: [...joined.companions, companion] };
  return { ...formation, groups };
}

function withoutCompanion(group: PartyGroup, companion: CompanionRef): PartyGroup {
  return {
    ...group,
    companions: group.companions.filter((ref) => !sameCompanion(ref, companion)),
  };
}

export function liveGroupOf(formation: SplitFormation): PartyGroup {
  return formation.groups[formation.live];
}

/** Whether a crawler is on the map being played: always while together, and only in the live group while split. */
export function crawlerIsLive(formation: PartyFormation, crawler: CrawlerKind): boolean {
  if (formation.kind === 'together') return true;
  return liveGroupOf(formation).crawlers.includes(crawler);
}

/** Whether a companion is on the map being played: always while together, and only with the live group while split. */
export function companionIsLive(formation: PartyFormation, companion: CompanionRef): boolean {
  if (formation.kind === 'together') return true;
  return liveGroupOf(formation).companions.some((ref) => sameCompanion(ref, companion));
}

/** The group a companion travels with while split, or null while together or when no group took it. */
export function groupWithCompanion(
  formation: PartyFormation,
  companion: CompanionRef,
): PartyGroup | null {
  if (formation.kind === 'together') return null;
  for (const id of PARTY_GROUP_IDS) {
    const group = formation.groups[id];
    if (group.companions.some((ref) => sameCompanion(ref, companion))) return group;
  }
  return null;
}

/**
 * Answers who is on the map being played, for systems that must not hold the
 * whole `PlayerManager`. While the party is together every answer is yes.
 */
export interface PartyPresence {
  crawlerIsPresent(crawler: CrawlerKind): boolean;
  companionIsPresent(companion: CompanionRef): boolean;
  /**
   * The crawlers of the group a companion travels with while split, or null
   * while the party is together, when a companion follows whoever is steered.
   */
  crawlersWithCompanion(companion: CompanionRef): readonly CrawlerKind[] | null;
}

/** Presence for a party that is never split: a harness, or a scene that runs no split. */
export const WHOLE_PARTY_PRESENT: PartyPresence = {
  crawlerIsPresent: () => true,
  companionIsPresent: () => true,
  crawlersWithCompanion: () => null,
};

/** Presence read off a formation as it stands at each call. */
export function presenceOf(formation: () => PartyFormation): PartyPresence {
  return {
    crawlerIsPresent: (crawler) => crawlerIsLive(formation(), crawler),
    companionIsPresent: (companion) => companionIsLive(formation(), companion),
    crawlersWithCompanion: (companion) =>
      groupWithCompanion(formation(), companion)?.crawlers ?? null,
  };
}

declare const EXCHANGE_POINT: unique symbol;
/** A fixture one group leaves things at for another: a conveyor's end, a hatch. */
export type ExchangePointId = string & { readonly [EXCHANGE_POINT]: true };

declare const EXCHANGE_FLAG: unique symbol;
/** Something one group did that another group's location reads when it is built. */
export type ExchangeFlagId = string & { readonly [EXCHANGE_FLAG]: true };

const EXCHANGE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function isExchangeIdText(value: unknown): value is string {
  return typeof value === 'string' && EXCHANGE_ID_PATTERN.test(value);
}

function isExchangePointId(value: unknown): value is ExchangePointId {
  return isExchangeIdText(value);
}

function isExchangeFlagId(value: unknown): value is ExchangeFlagId {
  return isExchangeIdText(value);
}

/** Names an exchange point. Snake case, so a typo cannot quietly name a second one. */
export function exchangePoint(name: string): ExchangePointId {
  if (!isExchangePointId(name)) throw new Error(`exchange point "${name}" is not snake_case`);
  return name;
}

/** Names an exchange flag. Snake case, so a typo cannot quietly name a second one. */
export function exchangeFlag(name: string): ExchangeFlagId {
  if (!isExchangeFlagId(name)) throw new Error(`exchange flag "${name}" is not snake_case`);
  return name;
}

export interface ExchangeItem {
  readonly item: ItemId;
  readonly quantity: number;
  /** The point it waits at until a crawler there takes it. */
  readonly to: ExchangePointId;
}

/** What groups have left for each other: items in transit and things done. */
export interface SplitExchange {
  readonly items: readonly ExchangeItem[];
  readonly flags: readonly ExchangeFlagId[];
}

const EMPTY_SPLIT_EXCHANGE: SplitExchange = { items: [], flags: [] };

/**
 * The run's split state, threaded by reference through every scene like
 * `TownMemory`, so a door, a storey change or a hand-over keeps it.
 */
export interface PartySplitState {
  formation: PartyFormation;
  exchange: SplitExchange;
}

export function createPartySplitState(): PartySplitState {
  return { formation: PARTY_TOGETHER, exchange: EMPTY_SPLIT_EXCHANGE };
}

export interface PartySplitSnapshot {
  readonly formation: PartyFormation;
  readonly exchange: SplitExchange;
}

export function capturePartySplit(state: PartySplitState): PartySplitSnapshot {
  return { formation: state.formation, exchange: state.exchange };
}

export function restorePartySplit(state: PartySplitState, snapshot: PartySplitSnapshot): void {
  state.formation = snapshot.formation;
  state.exchange = snapshot.exchange;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseTile(value: unknown): TilePoint | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (!isNonNegativeInteger(x) || !isNonNegativeInteger(y)) return undefined;
  return { x, y };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

const LOCATION_KINDS = [
  'overworld',
  'interior',
] as const satisfies readonly PartyLocation['kind'][];

function parsePartyLocation(value: unknown): PartyLocation | undefined {
  if (!isRecord(value)) return undefined;
  const kind = oneOf(value.kind, LOCATION_KINDS);
  const tile = parseTile(value.tile);
  if (kind === undefined || tile === undefined) return undefined;
  switch (kind) {
    case 'overworld':
      return { kind, tile };
    case 'interior': {
      const { building, storey } = value;
      if (!isBuildingId(building) || !isNonNegativeInteger(storey)) return undefined;
      return { kind, building, storey, tile };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

const COMPANION_KINDS = [
  'mercenary',
  'cat_ally',
] as const satisfies readonly CompanionRef['kind'][];

function parseCompanionRef(value: unknown): CompanionRef | undefined {
  if (!isRecord(value)) return undefined;
  const kind = oneOf(value.kind, COMPANION_KINDS);
  if (kind === undefined) return undefined;
  switch (kind) {
    case 'mercenary': {
      const hire = oneOf(value.hire, MERCENARY_TEMPLATE_IDS);
      return hire === undefined ? undefined : { kind, hire };
    }
    case 'cat_ally': {
      const ally = oneOf(value.ally, CAT_ALLY_IDS);
      return ally === undefined ? undefined : { kind, ally };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function parseAll<T>(value: unknown, parse: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const entry of value) {
    const one = parse(entry);
    if (one === undefined) return undefined;
    parsed.push(one);
  }
  return parsed;
}

function parseGroupDraft(value: unknown): PartyGroupDraft | undefined {
  if (!isRecord(value)) return undefined;
  const crawlers = parseAll(value.crawlers, (entry) => oneOf(entry, CRAWLER_KINDS));
  const companions = parseAll(value.companions, parseCompanionRef);
  const at = parsePartyLocation(value.at);
  if (crawlers === undefined || companions === undefined || at === undefined) return undefined;
  return { crawlers, companions, at };
}

/** Parses a stored formation. A split is rebuilt through {@link formSplit}, so a save cannot smuggle in a broken one. */
function parsePartyFormation(value: unknown): PartyFormation | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'together') return PARTY_TOGETHER;
  if (value.kind !== 'split' || !isRecord(value.groups)) return undefined;
  const live = oneOf(value.live, PARTY_GROUP_IDS);
  const first = parseGroupDraft(value.groups.first);
  const second = parseGroupDraft(value.groups.second);
  if (live === undefined || first === undefined || second === undefined) return undefined;
  const formed = formSplit({ first, second }, live);
  return formed.ok ? formed.formation : undefined;
}

function parseExchangeItem(value: unknown): ExchangeItem | undefined {
  if (!isRecord(value)) return undefined;
  const { item, quantity, to } = value;
  if (typeof item !== 'string' || !isItemId(item)) return undefined;
  if (!isNonNegativeInteger(quantity) || quantity === 0 || !isExchangePointId(to)) return undefined;
  return { item, quantity, to };
}

function parseSplitExchange(value: unknown): SplitExchange | undefined {
  if (!isRecord(value)) return undefined;
  const items = parseAll(value.items, parseExchangeItem);
  const flags = parseAll(value.flags, (entry) => (isExchangeFlagId(entry) ? entry : undefined));
  if (items === undefined || flags === undefined) return undefined;
  return { items, flags };
}

export function parsePartySplitSnapshot(value: unknown): PartySplitSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const formation = parsePartyFormation(value.formation);
  const exchange = parseSplitExchange(value.exchange);
  if (formation === undefined || exchange === undefined) return undefined;
  return { formation, exchange };
}

/** Leaves an item at an exchange point for whichever group reaches it. */
export function leaveExchangeItem(state: PartySplitState, item: ExchangeItem): void {
  state.exchange = { ...state.exchange, items: [...state.exchange.items, item] };
}

/** Takes every item waiting at a point, leaving none behind there. */
export function takeExchangeItems(state: PartySplitState, at: ExchangePointId): ExchangeItem[] {
  const taken = state.exchange.items.filter((entry) => entry.to === at);
  if (taken.length === 0) return taken;
  const items = state.exchange.items.filter((entry) => entry.to !== at);
  state.exchange = { ...state.exchange, items };
  return taken;
}

/** Takes every load of `item` waiting at a point, leaving the rest there; the loads taken. */
export function takeExchangeItemsOf(
  state: PartySplitState,
  at: ExchangePointId,
  item: ItemId,
): ExchangeItem[] {
  const isLoad = (entry: ExchangeItem): boolean => entry.to === at && entry.item === item;
  const taken = state.exchange.items.filter(isLoad);
  if (taken.length === 0) return taken;
  const items = state.exchange.items.filter((entry) => !isLoad(entry));
  state.exchange = { ...state.exchange, items };
  return taken;
}

export function itemsWaitingAt(
  state: PartySplitState,
  at: ExchangePointId,
): readonly ExchangeItem[] {
  return state.exchange.items.filter((entry) => entry.to === at);
}

export function setExchangeFlag(state: PartySplitState, flag: ExchangeFlagId): void {
  if (state.exchange.flags.includes(flag)) return;
  state.exchange = { ...state.exchange, flags: [...state.exchange.flags, flag] };
}

/** Lowers a flag that was raised, so whoever reads it next finds it down. */
export function clearExchangeFlag(state: PartySplitState, flag: ExchangeFlagId): void {
  if (!state.exchange.flags.includes(flag)) return;
  state.exchange = {
    ...state.exchange,
    flags: state.exchange.flags.filter((raised) => raised !== flag),
  };
}

export function exchangeFlagSet(state: PartySplitState, flag: ExchangeFlagId): boolean {
  return state.exchange.flags.includes(flag);
}
