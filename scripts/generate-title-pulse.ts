#!/usr/bin/env tsx
/**
 * Writes the title music's energy envelope to
 * `src/scenes/title/titlePulse.generated.ts`: one level per 50 ms frame of
 * `welcome_to_the_dungeon`, which the title samples at the track's playback
 * time to breathe its light and glow with the music.
 *
 * Each frame mixes how loud the track is with how sharply its low end just
 * rose (the kick and the bass hits), held and let go over a short release so
 * a beat reads as a swell rather than a one-frame flash.
 *
 * Needs ffmpeg: on PATH, at `$FFMPEG`, or at the Homebrew path.
 *
 *   npm run generate:title-pulse
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';

const TRACK_PATH = 'src/audio/music/welcome_to_the_dungeon.mp3';
const OUT_PATH = 'src/scenes/title/titlePulse.generated.ts';
const HOMEBREW_BIN = '/opt/homebrew/bin';

/** Low enough to be cheap, high enough that a 50 ms frame holds hundreds of samples. */
const SAMPLE_RATE_HZ = 11025;
const FRAME_MS = 50;
const MS_PER_SECOND = 1000;
/** Below this the kick and the bass live; the onset is read from this band alone. */
const LOW_BAND_HZ = 160;
const FLOAT_BYTES = 4;
/** Room for the whole decoded track: about 200 s of mono floats at this rate is under 10 MB. */
const DECODE_BUFFER_BYTES = 67108864;

/** The frames before this one that an onset is measured against. */
const ONSET_HISTORY_FRAMES = 6;
/** Loudness and onset are each scaled so this share of frames sits below full. */
const LEVEL_PERCENTILE = 0.95;
const ONSET_PERCENTILE = 0.98;
/** How much of a frame's pulse is its loudness, the rest being its onset. */
const LEVEL_SHARE = 0.35;
/** How quickly a hit lets go once the music stops pushing it. */
const RELEASE_MS = 240;

/** One base-36 digit per frame: 36 steps are finer than a light this subtle can show. */
const LEVEL_RADIX = 36;
const LEVEL_STEPS = LEVEL_RADIX - 1;
/** Envelope characters per line of the generated file. */
const CHARS_PER_LINE = 96;

function findFfmpeg(): string {
  const candidates = [process.env.FFMPEG, 'ffmpeg', join(HOMEBREW_BIN, 'ffmpeg')].filter(
    (candidate): candidate is string => candidate !== undefined && candidate !== '',
  );
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      continue;
    }
  }
  console.error('generate:title-pulse needs ffmpeg (tried $FFMPEG, PATH and Homebrew).');
  process.exit(1);
}

/** The track as mono samples, through `filter` when one is given. */
function decode(ffmpeg: string, filter: string | null): Float32Array {
  const args = ['-v', 'error', '-i', TRACK_PATH, '-ac', '1', '-ar', String(SAMPLE_RATE_HZ)];
  if (filter !== null) args.push('-af', filter);
  args.push('-f', 'f32le', '-');
  const raw = execFileSync(ffmpeg, args, { maxBuffer: DECODE_BUFFER_BYTES });
  const samples = new Float32Array(raw.length / FLOAT_BYTES);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = raw.readFloatLE(index * FLOAT_BYTES);
  }
  return samples;
}

function frameRms(samples: Float32Array, samplesPerFrame: number): number[] {
  const frames = Math.floor(samples.length / samplesPerFrame);
  const rms: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let offset = 0; offset < samplesPerFrame; offset++) {
      const sample = samples[frame * samplesPerFrame + offset];
      sum += sample * sample;
    }
    rms.push(Math.sqrt(sum / samplesPerFrame));
  }
  return rms;
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

function normalised(values: readonly number[], share: number): number[] {
  const top = Math.max(Number.EPSILON, percentile(values, share));
  return values.map((value) => Math.min(1, value / top));
}

function onsets(low: readonly number[]): number[] {
  return low.map((value, frame) => {
    const from = Math.max(0, frame - ONSET_HISTORY_FRAMES);
    const history = low.slice(from, frame);
    if (history.length === 0) return 0;
    const mean = history.reduce((sum, past) => sum + past, 0) / history.length;
    return Math.max(0, value - mean);
  });
}

function released(raw: readonly number[]): number[] {
  const keep = Math.exp(-FRAME_MS / RELEASE_MS);
  const held: number[] = [];
  let previous = 0;
  for (const value of raw) {
    previous = Math.max(value, previous * keep);
    held.push(previous);
  }
  return held;
}

function encode(levels: readonly number[]): string[] {
  const digits = levels
    .map((level) => Math.round(Math.min(1, Math.max(0, level)) * LEVEL_STEPS).toString(LEVEL_RADIX))
    .join('');
  const lines: string[] = [];
  for (let start = 0; start < digits.length; start += CHARS_PER_LINE) {
    lines.push(digits.slice(start, start + CHARS_PER_LINE));
  }
  return lines;
}

async function main(): Promise<void> {
  const ffmpeg = findFfmpeg();
  const samplesPerFrame = Math.round((SAMPLE_RATE_HZ * FRAME_MS) / MS_PER_SECOND);
  const full = decode(ffmpeg, null);
  const low = decode(ffmpeg, `lowpass=f=${LOW_BAND_HZ}`);
  const level = normalised(frameRms(full, samplesPerFrame), LEVEL_PERCENTILE);
  const onset = normalised(onsets(frameRms(low, samplesPerFrame)), ONSET_PERCENTILE);
  const frameCount = Math.min(level.length, onset.length);
  const raw = Array.from(
    { length: frameCount },
    (_, frame) => LEVEL_SHARE * level[frame] + (1 - LEVEL_SHARE) * onset[frame],
  );
  const lines = encode(released(raw));
  const trackMs = Math.round((full.length / SAMPLE_RATE_HZ) * MS_PER_SECOND);

  const source = [
    '// Generated by `npm run generate:title-pulse`; do not edit by hand.',
    '',
    '/** How much of the title track each envelope level covers. */',
    `export const TITLE_PULSE_FRAME_MS = ${FRAME_MS};`,
    '',
    '/** The title track’s length, the period the envelope repeats on as the track loops. */',
    `export const TITLE_PULSE_TRACK_MS = ${trackMs};`,
    '',
    '/** The radix each level is written in; a digit divided by `radix - 1` is the level, 0 to 1. */',
    `export const TITLE_PULSE_RADIX = ${LEVEL_RADIX};`,
    '',
    '/** One digit per frame, in playback order, split into lines only for the file’s sake. */',
    'export const TITLE_PULSE_ENVELOPE = [',
    ...lines.map((line) => `  '${line}',`),
    "].join('');",
    '',
  ].join('\n');
  const prettierConfig = (await resolveConfig(OUT_PATH)) ?? {};
  writeFileSync(OUT_PATH, await format(source, { ...prettierConfig, filepath: OUT_PATH }));
  console.log(`wrote ${OUT_PATH}: ${frameCount} frames over ${trackMs} ms`);
}

await main();
