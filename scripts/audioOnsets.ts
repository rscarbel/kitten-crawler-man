/**
 * Offline onset analysis for baking rhythm-game charts out of a music file.
 *
 * The pipeline is the standard spectral-flux one, with two wrinkles that matter
 * for note placement:
 *
 *  1. Peaks are picked on a long analysis window (good frequency resolution, so a
 *     melodic step registers) and then *refined* against a short window. A long window
 *     smears an attack across the ~93 ms it spans, so it starts registering the attack
 *     before the attack's own moment and reports it early. Labelling frames by centre
 *     time rather than start time removes most of that; the ~27 ms that survives is
 *     still enough to read as "the tiles are ahead of the music". The refinement search
 *     is asymmetric for that reason — the correction it applies runs forwards in time.
 *  2. The music body is located separately from the file length. Encoded tracks
 *     routinely carry seconds of near-silent reverb tail, and flux peaks found
 *     inside that tail are decay artefacts rather than notes.
 *
 * Requires `ffmpeg` on PATH for decoding. Only used by the offline generators,
 * never by the game.
 */

import { execFileSync } from 'node:child_process';

/** Analysis sample rate. Well above the melodic range we care about, and cheap. */
export const ANALYSIS_SAMPLE_RATE = 22_050;

/** Long window: locates onsets with enough frequency resolution to separate melody from drums. */
const COARSE_FFT_SIZE = 2048;
const COARSE_HOP = 64;

/** Short window: pins the attack down to a few ms once we know roughly where it is. */
const REFINE_FFT_SIZE = 256;
const REFINE_HOP = 16;

/** How far around a coarse onset the refinement pass searches for the true attack. */
const REFINE_SEARCH_BEFORE_SEC = 0.03;
const REFINE_SEARCH_AFTER_SEC = 0.09;

/**
 * Flux band. Below this the kick drum swamps everything; above it the hi-hats do.
 * This window is where a lead line's fundamental and low partials live.
 */
const MELODY_BAND_LOW_HZ = 250;
const MELODY_BAND_HIGH_HZ = 2500;

/** Pitch estimation looks for the dominant partial in this band. */
const PITCH_BAND_LOW_HZ = 200;
const PITCH_BAND_HIGH_HZ = 2200;

/** Pitch is measured over a short slice just after the attack, once the transient has passed. */
const PITCH_SLICE_START_SEC = 0.01;
const PITCH_SLICE_END_SEC = 0.09;

/** Compresses the magnitude spectrum so quiet melodic steps are not buried under loud percussion. */
const LOG_COMPRESSION_GAIN = 10;

/** Half-width of the moving-average window used as the adaptive peak threshold. */
const THRESHOLD_WINDOW_SEC = 1.0;

/** Added to the local mean, in units of the flux standard deviation, before a frame counts as a peak. */
const THRESHOLD_DELTA_RATIO = 0.5;

/** A peak must be the largest flux value in this neighbourhood. */
const PEAK_LOOKBACK_SEC = 0.06;
const PEAK_LOOKAHEAD_SEC = 0.02;

/** Two onsets closer than this are the same attack detected twice; the stronger one wins. */
const MIN_ONSET_SPACING_SEC = 0.15;

/** Window used for the RMS envelope that locates the end of the music body. */
const ENVELOPE_WINDOW_SEC = 0.02;

/**
 * Fraction of the loudest RMS below which the track counts as "over". Set well
 * above a reverb tail (which decays to a few percent) but below any real note.
 */
const MUSIC_END_RMS_RATIO = 0.2;

/** MIDI note 69 is A440; there are 12 semitones per octave. */
const MIDI_A440_NOTE = 69;
const A440_HZ = 440;
const SEMITONES_PER_OCTAVE = 12;

export interface OnsetAnalysis {
  /** Attack times in seconds, ascending. */
  timesSec: readonly number[];
  /** Peak flux at each onset, normalised so the strongest onset in the track is 1. */
  strengths: readonly number[];
  /** MIDI note number of the dominant partial just after each attack. */
  midiNotes: readonly number[];
  /** Where the music body stops, ignoring the decay tail. */
  musicEndSec: number;
}

/** Decode any ffmpeg-readable file to mono 32-bit float PCM at the analysis rate. */
export function decodeMonoPcm(filePath: string, sampleRate = ANALYSIS_SAMPLE_RATE): Float32Array {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    { maxBuffer: Number.MAX_SAFE_INTEGER },
  );
  // Copy rather than view: Buffer's underlying pool is not guaranteed to be 4-byte aligned.
  const samples = new Float32Array(raw.byteLength / Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = raw.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
  }
  return samples;
}

/** In-place iterative radix-2 complex FFT. `re`/`im` must have a power-of-two length. */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tmpRe = re[i];
      const tmpIm = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tmpRe;
      im[j] = tmpIm;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angleStep = (-2 * Math.PI) / len;
    const halfLen = len >> 1;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < halfLen; k++) {
        const angle = angleStep * k;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);
        const evenIdx = start + k;
        const oddIdx = evenIdx + halfLen;
        const oddRe = re[oddIdx] * wRe - im[oddIdx] * wIm;
        const oddIm = re[oddIdx] * wIm + im[oddIdx] * wRe;
        re[oddIdx] = re[evenIdx] - oddRe;
        im[oddIdx] = im[evenIdx] - oddIm;
        re[evenIdx] += oddRe;
        im[evenIdx] += oddIm;
      }
    }
  }
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

interface Spectrogram {
  /** `frames[f][bin]` — log-compressed magnitude. */
  frames: Float64Array[];
  /** Centre time of each frame in seconds. */
  frameTimesSec: Float64Array;
  binCount: number;
  binHz: number;
}

function computeSpectrogram(
  pcm: Float32Array,
  sampleRate: number,
  fftSize: number,
  hop: number,
): Spectrogram {
  const window = hannWindow(fftSize);
  const binCount = fftSize / 2 + 1;
  const frameCount = Math.max(0, 1 + Math.floor((pcm.length - fftSize) / hop));
  const frames: Float64Array[] = [];
  const frameTimesSec = new Float64Array(frameCount);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let f = 0; f < frameCount; f++) {
    const offset = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = pcm[offset + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const magnitudes = new Float64Array(binCount);
    for (let bin = 0; bin < binCount; bin++) {
      const magnitude = Math.hypot(re[bin], im[bin]);
      magnitudes[bin] = Math.log1p(magnitude * LOG_COMPRESSION_GAIN);
    }
    frames.push(magnitudes);
    // Centre time, not start time: the window's own centre is what the flux tracks.
    frameTimesSec[f] = (offset + fftSize / 2) / sampleRate;
  }

  return { frames, frameTimesSec, binCount, binHz: sampleRate / fftSize };
}

/** Half-wave-rectified spectral flux summed over a frequency band. */
function spectralFlux(spec: Spectrogram, lowHz: number, highHz: number): Float64Array {
  const firstBin = Math.max(1, Math.ceil(lowHz / spec.binHz));
  const lastBin = Math.min(spec.binCount - 1, Math.floor(highHz / spec.binHz));
  const flux = new Float64Array(spec.frames.length);

  for (let f = 1; f < spec.frames.length; f++) {
    const current = spec.frames[f];
    const previous = spec.frames[f - 1];
    let sum = 0;
    for (let bin = firstBin; bin <= lastBin; bin++) {
      const rise = current[bin] - previous[bin];
      if (rise > 0) sum += rise;
    }
    flux[f] = sum;
  }
  return flux;
}

function normalise(values: Float64Array): Float64Array {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max === 0) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / max;
  return out;
}

function standardDeviation(values: Float64Array): number {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  return Math.sqrt(variance / values.length);
}

/** Moving average with edge clamping, used as the adaptive peak threshold floor. */
function movingAverage(values: Float64Array, halfWidth: number): Float64Array {
  const out = new Float64Array(values.length);
  const clampIndex = (i: number): number => Math.min(values.length - 1, Math.max(0, i));
  let running = 0;
  for (let i = -halfWidth; i <= halfWidth; i++) running += values[clampIndex(i)];
  const windowSize = halfWidth * 2 + 1;
  for (let i = 0; i < values.length; i++) {
    out[i] = running / windowSize;
    running -= values[clampIndex(i - halfWidth)];
    running += values[clampIndex(i + halfWidth + 1)];
  }
  return out;
}

function pickPeaks(flux: Float64Array, framesPerSecond: number): number[] {
  const normalised = normalise(flux);
  const threshold = movingAverage(normalised, Math.round(THRESHOLD_WINDOW_SEC * framesPerSecond));
  const delta = THRESHOLD_DELTA_RATIO * standardDeviation(normalised);
  const lookback = Math.round(PEAK_LOOKBACK_SEC * framesPerSecond);
  const lookahead = Math.round(PEAK_LOOKAHEAD_SEC * framesPerSecond);
  const minSpacing = Math.round(MIN_ONSET_SPACING_SEC * framesPerSecond);

  const peaks: number[] = [];
  for (let f = 1; f < normalised.length - 1; f++) {
    if (normalised[f] < threshold[f] + delta) continue;

    let isLocalMax = true;
    const from = Math.max(0, f - lookback);
    const to = Math.min(normalised.length - 1, f + lookahead);
    for (let k = from; k <= to; k++) {
      if (normalised[k] > normalised[f]) {
        isLocalMax = false;
        break;
      }
    }
    if (!isLocalMax) continue;

    const previous = peaks[peaks.length - 1];
    if (previous !== undefined && f - previous < minSpacing) {
      if (normalised[f] > normalised[previous]) peaks[peaks.length - 1] = f;
      continue;
    }
    peaks.push(f);
  }
  return peaks;
}

/**
 * Move each coarse onset to the flux peak of a short-window spectrogram nearby.
 * This is what removes the long window's residual earliness, so the search is allowed
 * to reach much further forward than back.
 */
function refineOnsetTime(
  coarseTimeSec: number,
  refineFlux: Float64Array,
  refineTimesSec: Float64Array,
): number {
  const from = lowerBound(refineTimesSec, coarseTimeSec - REFINE_SEARCH_BEFORE_SEC);
  const to = lowerBound(refineTimesSec, coarseTimeSec + REFINE_SEARCH_AFTER_SEC);
  if (to <= from) return coarseTimeSec;

  let bestIndex = from;
  for (let f = from; f < to; f++) {
    if (refineFlux[f] > refineFlux[bestIndex]) bestIndex = f;
  }
  return refineTimesSec[bestIndex];
}

function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function estimateMidiNote(spec: Spectrogram, onsetTimeSec: number): number {
  const firstBin = Math.max(1, Math.ceil(PITCH_BAND_LOW_HZ / spec.binHz));
  const lastBin = Math.min(spec.binCount - 1, Math.floor(PITCH_BAND_HIGH_HZ / spec.binHz));
  const from = lowerBound(spec.frameTimesSec, onsetTimeSec + PITCH_SLICE_START_SEC);
  const to = Math.max(from + 1, lowerBound(spec.frameTimesSec, onsetTimeSec + PITCH_SLICE_END_SEC));

  let bestBin = firstBin;
  let bestEnergy = -Infinity;
  for (let bin = firstBin; bin <= lastBin; bin++) {
    let energy = 0;
    for (let f = from; f < to && f < spec.frames.length; f++) energy += spec.frames[f][bin];
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestBin = bin;
    }
  }

  const frequencyHz = bestBin * spec.binHz;
  return Math.round(MIDI_A440_NOTE + SEMITONES_PER_OCTAVE * Math.log2(frequencyHz / A440_HZ));
}

/** Last moment the track is still meaningfully loud, so a reverb tail is not mistaken for music. */
function findMusicEndSec(pcm: Float32Array, sampleRate: number): number {
  const windowSamples = Math.max(1, Math.round(ENVELOPE_WINDOW_SEC * sampleRate));
  let squareSum = 0;
  const envelope = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    squareSum += pcm[i] * pcm[i];
    if (i >= windowSamples) squareSum -= pcm[i - windowSamples] * pcm[i - windowSamples];
    envelope[i] = Math.sqrt(squareSum / Math.min(i + 1, windowSamples));
  }

  let peak = 0;
  for (const v of envelope) if (v > peak) peak = v;
  const cutoff = peak * MUSIC_END_RMS_RATIO;
  for (let i = envelope.length - 1; i >= 0; i--) {
    if (envelope[i] > cutoff) return i / sampleRate;
  }
  return pcm.length / sampleRate;
}

export function analyseOnsets(pcm: Float32Array, sampleRate = ANALYSIS_SAMPLE_RATE): OnsetAnalysis {
  const coarse = computeSpectrogram(pcm, sampleRate, COARSE_FFT_SIZE, COARSE_HOP);
  const refine = computeSpectrogram(pcm, sampleRate, REFINE_FFT_SIZE, REFINE_HOP);

  const coarseFlux = spectralFlux(coarse, MELODY_BAND_LOW_HZ, MELODY_BAND_HIGH_HZ);
  const refineFlux = spectralFlux(refine, MELODY_BAND_LOW_HZ, MELODY_BAND_HIGH_HZ);

  const peakFrames = pickPeaks(coarseFlux, sampleRate / COARSE_HOP);
  const normalisedCoarse = normalise(coarseFlux);

  const musicEndSec = findMusicEndSec(pcm, sampleRate);

  const timesSec: number[] = [];
  const strengths: number[] = [];
  const midiNotes: number[] = [];
  for (const frame of peakFrames) {
    const coarseTimeSec = coarse.frameTimesSec[frame];
    if (coarseTimeSec > musicEndSec) continue;
    const timeSec = refineOnsetTime(coarseTimeSec, refineFlux, refine.frameTimesSec);
    timesSec.push(timeSec);
    strengths.push(normalisedCoarse[frame]);
    midiNotes.push(estimateMidiNote(coarse, timeSec));
  }

  return { timesSec, strengths, midiNotes, musicEndSec };
}
