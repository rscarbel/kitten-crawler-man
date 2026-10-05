/**
 * The scythe swing's timing bar: a dark strip with a gold "good" band and a
 * green "perfect" band, a white needle, and a verdict in its grade's colour.
 * Its own palette, because the bands have to read as a target at a glance
 * rather than as any of the HUD's meters.
 */

export type ScytheVerdictGrade = 'perfect' | 'good' | 'miss';

interface ScytheVerdictInk {
  readonly color: string;
  /** `r,g,b` of {@link color}, for the edge glow that fades to nothing. */
  readonly rgb: string;
}

export const scytheSwingInk = {
  panelFill: 'rgba(8,15,30,0.9)',
  panelBorder: '#475569',
  trackFill: '#0b1220',
  trackBorder: '#64748b',
  /** The part of the track the needle has already crossed. */
  elapsedFill: 'rgba(148,163,184,0.16)',
  goodBandFill: 'rgba(234,179,8,0.55)',
  goodBandEdge: '#facc15',
  perfectBandFill: 'rgba(34,197,94,0.9)',
  perfectBandEdge: '#bbf7d0',
  bandLabel: '#ffffff',
  /** A dark rim keeps a band's name legible over the gold, the green and a white flash alike. */
  bandLabelOutline: '#0b1220',
  needle: '#ffffff',
  needleOutline: '#0f172a',
  instruction: '#e2e8f0',
  hitFlash: '#ffffff',
  missFlash: '#ef4444',
  verdict: {
    perfect: { color: '#4ade80', rgb: '74,222,128' },
    good: { color: '#facc15', rgb: '250,204,21' },
    miss: { color: '#f87171', rgb: '239,68,68' },
  },
} as const satisfies {
  readonly verdict: Readonly<Record<ScytheVerdictGrade, ScytheVerdictInk>>;
} & Record<string, unknown>;

const ALPHA_DECIMALS = 3;

/**
 * The verdict's edge-glow colour at `alpha`. Fixed-point, because
 * node-canvas drops an rgba() whose alpha is written with an exponent.
 */
export function scytheEdgeGlowColor(grade: ScytheVerdictGrade, alpha: number): string {
  return `rgba(${scytheSwingInk.verdict[grade].rgb},${alpha.toFixed(ALPHA_DECIMALS)})`;
}
