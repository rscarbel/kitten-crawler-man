import type { MobilityClass } from '../../map/mobility';
import type { CrawlerKind } from '../skills/SkillManager';

/**
 * Who may carry out an interaction: named crawlers, or anyone who moves as
 * one of the named mobility classes (a shelf top only a climber reaches).
 */
export type InteractionPerformer =
  | { readonly kind: 'anyone' }
  | { readonly kind: 'crawlers'; readonly crawlers: readonly CrawlerKind[] }
  | { readonly kind: 'mobility'; readonly classes: readonly MobilityClass[] };

export const ANYONE_PERFORMS: InteractionPerformer = { kind: 'anyone' };

/** The parts of a body an interaction's performer is judged by. */
export interface PerformerTraits {
  readonly crawlerKind: CrawlerKind;
  readonly mobility: MobilityClass;
}

export function canPerform(performer: InteractionPerformer, body: PerformerTraits): boolean {
  switch (performer.kind) {
    case 'anyone':
      return true;
    case 'crawlers':
      return performer.crawlers.includes(body.crawlerKind);
    case 'mobility':
      return performer.classes.includes(body.mobility);
    default: {
      const unreachable: never = performer;
      return unreachable;
    }
  }
}
