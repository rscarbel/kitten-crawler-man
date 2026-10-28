/**
 * The choices that make the player's human crawler at character creation, as
 * plain data: no look, figure or art is reached from here, so a save can be
 * checked against them anywhere, the server included.
 */

export const CRAWLER_BODIES = ['male', 'female'] as const;
export type CrawlerBody = (typeof CRAWLER_BODIES)[number];

export const COMPLEXIONS = ['light', 'dark'] as const;
export type Complexion = (typeof COMPLEXIONS)[number];

export function isCrawlerBody(value: string): value is CrawlerBody {
  return CRAWLER_BODIES.some((body) => body === value);
}

export function isComplexion(value: string): value is Complexion {
  return COMPLEXIONS.some((complexion) => complexion === value);
}

/** The id of the look a body and complexion pair names. */
export type HumanCrawlerLookId = `${CrawlerBody}_${Complexion}`;

/** The look id a body and complexion name. */
export function lookIdOf<Body extends CrawlerBody, Tone extends Complexion>(choice: {
  readonly body: Body;
  readonly complexion: Tone;
}): `${Body}_${Tone}` {
  return `${choice.body}_${choice.complexion}`;
}
