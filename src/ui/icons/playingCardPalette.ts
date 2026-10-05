/**
 * The inks of the blackjack table's playing cards: an ivory face, the suits'
 * red and black, the court figures' robes, and the club's green-and-gold back.
 * These are picture colours, like an item icon's, not UI chrome; the card
 * painter in `src/ui/casino/PlayingCard.ts` is their only reader.
 */

export const PLAYING_CARD_PALETTE = {
  suitRed: '#b02a2a',
  suitBlack: '#1a1410',
  faceFill: '#f4ecd8',
  faceBorder: '#c8a840',
  courtRobe: '#7a2438',
  courtRobeLight: '#a8394f',
  courtTrim: '#c8a840',
  courtSkin: '#e8cba8',
  courtInk: '#2a1f10',
  /** Cool grey veil laid over a busted hand, so it desaturates rather than blacks out. */
  dimVeil: '#2a2a2e',
  backFelt: '#123a2c',
  backFeltEdge: '#0a241b',
  backLattice: 'rgba(200, 168, 64, 0.55)',
  backBorder: '#c8a840',
  backEmblem: '#e0c060',
  liftShadow: 'rgba(0, 0, 0, 0.55)',
} as const;
