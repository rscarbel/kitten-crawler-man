/**
 * The tavern round. Talking to an innkeeper behind the bar buys a drink: a few
 * coins for a short pep in the step (a Speed Fizz buff), served on the spot rather
 * than sold as an item like the market stalls do. Pure data + line selection here;
 * `BuildingInteriorScene` owns the coin/buff/sound side and only calls in when the
 * player can actually be served, so an innkeeper still chats normally otherwise.
 */

const SERVE_LINES: ReadonlyArray<string> = [
  'A frothy ale for the road — that’s the tab. Drink deep, you’ll move quicker for it!',
  'House special, on the house rules: coin first. There — a spring in your step, that brew.',
  'Here, a hot cider to chase the ruins’ chill. Down it and mind how you go.',
];

/** Price of a served drink, in coins. */
export const PUB_DRINK_PRICE = 10;

/** A barkeep's serving line, rotated by how many times the player has talked to them. */
export function pubServeLine(turn: number): string {
  const index = ((turn % SERVE_LINES.length) + SERVE_LINES.length) % SERVE_LINES.length;
  return SERVE_LINES[index];
}
