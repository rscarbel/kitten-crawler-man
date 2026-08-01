/*
 * Render-quality benchmark harness (browser-side, no build step).
 *
 * Loaded into a running game page and driven from the console or from browser
 * automation. It measures the real renderer at several backing-store scales
 * without modifying src/:
 *
 *   - the backing store is enlarged by `scale`
 *   - the canvas is pinned to its original CSS size
 *   - the 2D context carries a permanent `scale` transform
 *
 * The engine reads its viewport from `src/core/Viewport.ts` in CSS pixels, not
 * from `canvas.width`, so enlarging the backing store measures "more pixels"
 * rather than "more world" — no shadowing of the canvas attributes is needed,
 * and shadowing them would in fact break `SceneManager.applyViewportSize`,
 * which derives its context transform from the value it writes there.
 *
 * A window resize or a quality-preset change during a measurement lets
 * SceneManager re-apply its own scale and invalidates the sample. Do not touch
 * either while measuring.
 *
 * Usage from the page context:
 *   const bench = await import('/scripts/bench-render.js');
 *   await bench.run({ scales: [1, 1.5, 2], seconds: 6 });
 */

/** Frame budget for a 60 Hz display, in milliseconds. */
const FRAME_BUDGET_60HZ_MS = 1000 / 60;

/** Frames discarded at the start of each sample so cold caches don't skew p50. */
const WARMUP_FRAMES = 90;

/** Default measurement window per configuration, in seconds. */
const DEFAULT_SAMPLE_SECONDS = 6;

/** Identity transform components for a context with no scaling applied. */
const IDENTITY_SCALE = 1;

/** How long each held direction lasts before the walk driver turns, in ms. */
const WALK_LEG_MS = 900;

/** Scratch-canvas dimensions for the shadowBlur microbenchmark, in CSS pixels. */
const SHADOW_BENCH_CSS_WIDTH = 1372;
const SHADOW_BENCH_CSS_HEIGHT = 682;

/** Geometry of the blurred rects in the shadowBlur microbenchmark. */
const SHAPE_SIZE = 60;
const SHAPE_STRIDE_X = 137;
const SHAPE_STRIDE_Y = 91;

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return Number.NaN;
  const rank = Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length));
  return sortedValues[rank];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const overBudget = sorted.filter((v) => v > FRAME_BUDGET_60HZ_MS).length;
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length === 0 ? Number.NaN : sorted[sorted.length - 1],
    pctOver16_7: (overBudget / Math.max(1, sorted.length)) * 100,
  };
}

/**
 * Wraps requestAnimationFrame so every callback the game schedules is timed.
 * The measured span covers the engine's update() + render() main-thread work;
 * it deliberately excludes GPU rasterization, which is why `intervalMs` is
 * recorded alongside it.
 */
function installFrameProbe(flushContext) {
  const state = { work: [], flushed: [], interval: [], recording: false, lastStart: 0 };
  const originalRAF = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = (callback) =>
    originalRAF((timestamp) => {
      const start = performance.now();
      callback(timestamp);
      const recorded = performance.now();
      // A 1x1 readback blocks until the canvas' queued draw commands have
      // actually been rasterized, which is the only way to observe GPU-side
      // cost from script. It adds a fixed readback overhead, so the useful
      // signal is the delta between scales rather than the absolute value.
      if (flushContext !== null) flushContext.getImageData(0, 0, 1, 1);
      const flushedEnd = performance.now();
      if (state.recording) {
        state.work.push(recorded - start);
        // Only when a flush actually happened. Recording it regardless would
        // make the flushed column a copy of `work` whenever flushing is off,
        // which reads as "rasterization is free" rather than "not measured".
        if (flushContext !== null) state.flushed.push(flushedEnd - start);
        if (state.lastStart !== 0) state.interval.push(start - state.lastStart);
      }
      state.lastStart = start;
    });

  return {
    state,
    uninstall() {
      window.requestAnimationFrame = originalRAF;
    },
  };
}

/**
 * Repoints the game canvas at a larger backing store while keeping every
 * engine-visible dimension in CSS pixels. Returns a restore function.
 */
function applyBackingStoreScale(canvas, scale) {
  const cssWidth = canvas.clientWidth || window.innerWidth;
  const cssHeight = canvas.clientHeight || window.innerHeight;
  const ctx = canvas.getContext('2d');
  const previousScale = canvas.width / cssWidth || IDENTITY_SCALE;

  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  return function restore() {
    canvas.width = Math.round(cssWidth * previousScale);
    canvas.height = Math.round(cssHeight * previousScale);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(previousScale, 0, 0, previousScale, 0, 0);
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for a fixed number of animation frames so warm-up isn't timer-based. */
function waitFrames(count) {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Measures one backing-store scale.
 *
 * `flush` defaults off. Turning it on permanently demotes the canvas to a
 * software rasterizer — the readback it performs is not undone by ending the
 * measurement — so every number taken afterwards, in that page, is garbage.
 * @returns {Promise<{scale:number,backingStore:number[],work:object,interval:object}>}
 */
export async function measureScale(scale, seconds = DEFAULT_SAMPLE_SECONDS, flush = false) {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('no canvas on page');

  const restore = applyBackingStoreScale(canvas, scale);
  const probe = installFrameProbe(flush ? canvas.getContext('2d') : null);

  await waitFrames(WARMUP_FRAMES);
  probe.state.work.length = 0;
  probe.state.flushed.length = 0;
  probe.state.interval.length = 0;
  probe.state.recording = true;
  await sleep(seconds * 1000);
  probe.state.recording = false;

  const result = {
    scale,
    backingStore: [canvas.width, canvas.height],
    work: summarize(probe.state.work),
    flushed: summarize(probe.state.flushed),
    interval: summarize(probe.state.interval),
  };

  probe.uninstall();
  restore();
  return result;
}

/**
 * Holds movement keys down for the duration of a measurement so the camera pans
 * and the tile-chunk cache is forced to bake. Standing still measures a fully
 * warm cache and hides the worst frames real play produces.
 */
export function startWalking() {
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let index = 0;
  const press = (code, type) =>
    window.dispatchEvent(
      new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), bubbles: true }),
    );

  press(keys[index], 'keydown');
  const timer = setInterval(() => {
    press(keys[index], 'keyup');
    index = (index + 1) % keys.length;
    press(keys[index], 'keydown');
  }, WALK_LEG_MS);

  return function stop() {
    clearInterval(timer);
    for (const code of keys) press(code, 'keyup');
  };
}

/**
 * Isolates shadowBlur cost from everything else by redrawing a fixed set of
 * blurred rounded rects onto a scratch canvas, at the radii the UI actually
 * uses. Run at several `scale` values to see how blur cost tracks resolution.
 */
export function measureShadowBlur({ scale = 1, blur = 20, shapes = 200, iterations = 30 } = {}) {
  const width = Math.round(SHADOW_BENCH_CSS_WIDTH * scale);
  const height = Math.round(SHADOW_BENCH_CSS_HEIGHT * scale);
  const surface = new OffscreenCanvas(width, height);
  const sctx = surface.getContext('2d');
  sctx.setTransform(scale, 0, 0, scale, 0, 0);

  const drawPass = () => {
    sctx.clearRect(0, 0, SHADOW_BENCH_CSS_WIDTH, SHADOW_BENCH_CSS_HEIGHT);
    for (let i = 0; i < shapes; i++) {
      const x = (i * SHAPE_STRIDE_X) % (SHADOW_BENCH_CSS_WIDTH - SHAPE_SIZE);
      const y = (i * SHAPE_STRIDE_Y) % (SHADOW_BENCH_CSS_HEIGHT - SHAPE_SIZE);
      sctx.shadowBlur = blur;
      sctx.shadowColor = 'rgba(80,160,255,0.9)';
      sctx.fillStyle = '#1e293b';
      sctx.fillRect(x, y, SHAPE_SIZE, SHAPE_SIZE);
      sctx.shadowBlur = 0;
    }
  };

  drawPass();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    drawPass();
    samples.push(performance.now() - start);
  }
  return { scale, blur, shapes, pixels: width * height, ...summarize(samples) };
}

/** Runs the full sweep and returns one row per scale. */
export async function run({
  scales = [1, 2, 3],
  seconds = DEFAULT_SAMPLE_SECONDS,
  flush = false,
} = {}) {
  const rows = [];
  for (const scale of scales) {
    rows.push(await measureScale(scale, seconds, flush));
  }
  return {
    dpr: window.devicePixelRatio,
    viewportCss: [window.innerWidth, window.innerHeight],
    cores: navigator.hardwareConcurrency,
    rows,
  };
}
