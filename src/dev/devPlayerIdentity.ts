/**
 * Who the human crawler is on dev routes and in harness scripts, which start
 * a run without the creation screen.
 */

import { parsePlayerName, type PlayerName } from '../core/naming/playerName';
import { type PlayerIdentity, setPlayerIdentity } from '../characters/playerIdentity';

const DEV_PLAYER_NAME_TEXT = 'Ryan';

function devPlayerName(): PlayerName {
  const name = parsePlayerName(DEV_PLAYER_NAME_TEXT);
  if (name === null)
    throw new Error(`The dev player name "${DEV_PLAYER_NAME_TEXT}" fails the name rules`);
  return name;
}

export const DEV_PLAYER_IDENTITY: PlayerIdentity = {
  name: devPlayerName(),
  body: 'male',
  complexion: 'light',
};

/** Makes {@link DEV_PLAYER_IDENTITY} the run's, before a dev route or harness builds anything that names or paints the human. */
export function useDevPlayerIdentity(): void {
  setPlayerIdentity(DEV_PLAYER_IDENTITY);
}
