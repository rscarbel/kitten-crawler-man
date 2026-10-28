import { withoutDisplayIsolates } from '../../core/text/isolateName';
import { mapJsonObjectStrings, type JsonObject } from './json';

/**
 * `payload` ready to leave for the AI server. Item names, quest titles and
 * lines are often built for the screen with a right-to-left name isolated for
 * display; the model reads those isolates as stray characters, so every
 * string in a context, state or event payload loses them here, keys included.
 */
export function forTheServer(payload: JsonObject): JsonObject {
  return mapJsonObjectStrings(payload, withoutDisplayIsolates);
}

/** {@link forTheServer} for a single line, such as an action result's detail. */
export function textForTheServer(text: string): string {
  return withoutDisplayIsolates(text);
}
