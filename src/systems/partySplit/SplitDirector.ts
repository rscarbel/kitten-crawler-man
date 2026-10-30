import {
  PARTY_TOGETHER,
  formSplit,
  liveGroupOf,
  withCompanionJoining,
  withGroupAt,
  withLiveGroup,
  type CompanionRef,
  type FormSplitResult,
  type PartyGroupDraft,
  type PartyGroupId,
  type PartyLocation,
  type PartySplitState,
} from '../../core/party/partySplit';
import { sameMap, type ArrivalCard, type PartyTransferRequest } from './partyTransfer';
import type { SplitChapter } from './splitChapter';

/** What the director needs from the scene playing the live group. */
export interface SplitDirectorDeps {
  /** The run's split state, threaded by reference. */
  readonly state: PartySplitState;
  /** Where the steered crawler stands now, or null on a map no location kind can name. */
  readonly locateLiveGroup: () => PartyLocation | null;
  /**
   * Writes a save now, so a death returns to the start of the chapter that
   * follows, which begins at `chapterStart`. Called after the formation has
   * changed, when the steered crawler may still hold coordinates from another
   * map: the save places the party by `chapterStart`, never by where a crawler
   * stands.
   */
  readonly save: (chapterStart: PartyLocation) => void;
  /** Moves the party to a location behind a card; replaces the scene. */
  readonly transfer: (request: PartyTransferRequest) => void;
  /** Called after every change to the formation, so the steered crawler is always a live one. */
  readonly onFormationChanged: () => void;
}

/** What one step of {@link SplitDirector.runChapters} did. */
export type ChapterStep = 'playing' | 'handedOver' | 'allEnded';

/**
 * Runs a split party: forms the split, hands play from one group to another,
 * and puts the party back together. Knows nothing about any quest; a quest
 * gives it a chapter table and its own state.
 */
export class SplitDirector {
  constructor(private readonly deps: SplitDirectorDeps) {}

  get isSplit(): boolean {
    return this.deps.state.formation.kind === 'split';
  }

  /**
   * Splits the party into `groups` with `live` playing first. When the live
   * group starts on another map, the party is moved there behind `card`.
   */
  beginSplit(
    groups: Readonly<Record<PartyGroupId, PartyGroupDraft>>,
    live: PartyGroupId,
    card: ArrivalCard,
  ): FormSplitResult {
    const formed = formSplit(groups, live);
    if (!formed.ok) return formed;
    const here = this.deps.locateLiveGroup();
    this.deps.state.formation = formed.formation;
    this.deps.onFormationChanged();
    const start = liveGroupOf(formed.formation).at;
    this.deps.save(start);
    if (here === null || !sameMap(here, start)) this.deps.transfer({ to: start, card });
    return formed;
  }

  /**
   * Hands play to group `to`. The live group's place is recorded, `to` becomes
   * live (starting at `startAt` when its chapter names one), a save is written
   * holding the chapter about to start, and the scene is replaced with `to`'s
   * location behind `card`.
   */
  handOver(to: PartyGroupId, card: ArrivalCard, startAt: PartyLocation | null = null): void {
    const formation = this.deps.state.formation;
    if (formation.kind !== 'split') throw new Error('handOver needs a split party');
    if (formation.live === to) throw new Error(`group ${to} is already live`);
    const here = this.deps.locateLiveGroup();
    if (here === null) throw new Error('the live group stands nowhere a location can name');
    const recorded = withGroupAt(formation, formation.live, here);
    const started = startAt === null ? recorded : withGroupAt(recorded, to, startAt);
    const next = withLiveGroup(started, to);
    this.deps.state.formation = next;
    this.deps.onFormationChanged();
    // After the flip, so the save holds the chapter about to start: a death or
    // a reload in it comes back to its beginning, not to the end of the last.
    const chapterStart = liveGroupOf(next).at;
    this.deps.save(chapterStart);
    this.deps.transfer({ to: chapterStart, card });
  }

  /**
   * A companion met while the party is apart (a hire signed at a desk) joins
   * the live group, so it is present wherever that group plays. Nothing while
   * the party is together, when every companion already follows it.
   */
  joinLiveGroup(companion: CompanionRef): void {
    const formation = this.deps.state.formation;
    if (formation.kind !== 'split') return;
    this.deps.state.formation = withCompanionJoining(formation, formation.live, companion);
    this.deps.onFormationChanged();
  }

  /** Ends the split: everyone is present again, set down together at `at`. */
  regroup(at: PartyLocation, card: ArrivalCard | null): void {
    if (this.deps.state.formation.kind !== 'split') return;
    this.deps.state.formation = PARTY_TOGETHER;
    this.deps.onFormationChanged();
    this.deps.save(at);
    this.deps.transfer({ to: at, card });
  }

  /**
   * One step of a quest's chapter table: the first chapter whose `endsWhen`
   * is not yet true is the one being played, and when its group is not the
   * live one, play is handed over to it. The caller regroups once every
   * chapter has ended.
   */
  runChapters<QuestState>(
    chapters: readonly SplitChapter<QuestState>[],
    questState: QuestState,
  ): ChapterStep {
    const formation = this.deps.state.formation;
    const current = currentChapter(chapters, questState);
    if (current === null) return 'allEnded';
    if (formation.kind !== 'split' || formation.live === current.group) return 'playing';
    this.handOver(current.group, current.card, current.start);
    return 'handedOver';
  }
}

/** The chapter being played: the first whose end has not come. */
export function currentChapter<QuestState>(
  chapters: readonly SplitChapter<QuestState>[],
  questState: QuestState,
): SplitChapter<QuestState> | null {
  return chapters.find((chapter) => !chapter.endsWhen(questState)) ?? null;
}
