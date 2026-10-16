/**
 * What the siege says when the clocktower is under attack and when a siege
 * is lost. Every line calls the tower the clocktower, the villagers' and the
 * Mayor's name for it, so the alarm and the dialog name the same thing.
 */

const PERCENT = 100;

/** How a siege ended badly. */
export type SiegeLoss = 'bell_fell' | 'abandoned';

export const SIEGE_LOSS_COPY: Readonly<Record<SiegeLoss, { headline: string; detail: string }>> = {
  bell_fell: {
    headline: 'The clocktower has fallen!',
    detail:
      'The dead destroyed the clocktower while it was undefended. Vordrick escaped with the life stone.',
  },
  abandoned: {
    headline: 'You left Briar Hollow to the dead. They withdraw…',
    detail: 'You strayed too far from Briar Hollow during the siege.',
  },
};

export const BELL_ALERT_HEADLINE = 'THE CLOCKTOWER IS UNDER ATTACK!';
export const BELL_ALERT_DETAIL =
  'Get back to the town square and defend it — if it falls, the siege is lost.';

/** The alert's detail when the bell's health has just crossed `threshold`. */
export function bellThresholdDetail(threshold: number): string {
  return `Clocktower at ${Math.round(threshold * PERCENT)}%! Get back to the square!`;
}
