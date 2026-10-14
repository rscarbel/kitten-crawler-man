/**
 * A fake Web Audio graph and `<audio>` element, installed on `globalThis`, for
 * running a real `AudioManager` headless.
 *
 * It is faithful where a check needs it to be: every `AudioParam` keeps its
 * automation timeline and can be read at any time on it, nodes remember what
 * they are connected to, sources start, stop and end on the fake audio clock,
 * and the clock only runs while the context is `running`. Every way a voice
 * can fall silent — a source stopped, an element paused, a playing element
 * pointed at a new file — is logged with the level of the voice's own gain
 * at that instant, which is what tells a ramped stop from a click.
 *
 * Elements play on the audio clock too: a playing element's `currentTime`
 * runs while the context does, an element reports `playing` once it starts,
 * and one that reaches the end of its recording loops or ends as a browser's does.
 *
 * Nothing is ever heard: buffers carry a name and a length, never samples.
 */

/** How long a decoded fake buffer lasts unless the harness says otherwise, in seconds. */
const DEFAULT_BUFFER_DURATION_S = 30;
const MS_PER_SECOND = 1000;

type AutomationEvent =
  | { readonly kind: 'set'; readonly time: number; readonly value: number }
  | { readonly kind: 'linear'; readonly time: number; readonly value: number }
  | { readonly kind: 'exponential'; readonly time: number; readonly value: number }
  | {
      readonly kind: 'target';
      readonly time: number;
      readonly value: number;
      readonly timeConstant: number;
    }
  | {
      readonly kind: 'curve';
      readonly time: number;
      readonly curve: readonly number[];
      readonly duration: number;
    };

function curveEnd(event: AutomationEvent): number {
  return event.kind === 'curve' ? event.time + event.duration : event.time;
}

function curveValueAt(curve: readonly number[], fraction: number): number {
  const position = Math.min(1, Math.max(0, fraction)) * (curve.length - 1);
  const index = Math.floor(position);
  const next = Math.min(curve.length - 1, index + 1);
  const between = position - index;
  return curve[index] + (curve[next] - curve[index]) * between;
}

/** An `AudioParam` with a real automation timeline, evaluated on demand. */
export class FakeAudioParam {
  private events: AutomationEvent[] = [];

  constructor(
    private readonly clock: () => number,
    private readonly initialValue: number,
  ) {}

  get value(): number {
    return this.valueAt(this.clock());
  }

  set value(next: number) {
    this.setValueAtTime(next, this.clock());
  }

  /** The level the timeline gives at `timeS` on the audio clock. */
  valueAt(timeS: number): number {
    let value = this.initialValue;
    let previousTime = 0;
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      switch (event.kind) {
        case 'set':
          if (event.time > timeS) return value;
          value = event.value;
          previousTime = event.time;
          break;
        case 'linear':
          if (event.time <= timeS) {
            value = event.value;
            previousTime = event.time;
            break;
          }
          if (event.time === previousTime) return event.value;
          return (
            value + ((event.value - value) * (timeS - previousTime)) / (event.time - previousTime)
          );
        case 'exponential':
          if (event.time <= timeS) {
            value = event.value;
            previousTime = event.time;
            break;
          }
          if (event.time === previousTime || value <= 0) return event.value;
          return (
            value *
            Math.pow(event.value / value, (timeS - previousTime) / (event.time - previousTime))
          );
        case 'target': {
          if (event.time > timeS) return value;
          const nextTime = this.events[i + 1]?.time ?? Number.POSITIVE_INFINITY;
          const until = Math.min(timeS, nextTime);
          const settled =
            event.value +
            (value - event.value) * Math.exp(-(until - event.time) / event.timeConstant);
          if (nextTime > timeS) return settled;
          value = settled;
          previousTime = nextTime;
          break;
        }
        case 'curve': {
          if (event.time > timeS) return value;
          const end = event.time + event.duration;
          if (timeS < end) return curveValueAt(event.curve, (timeS - event.time) / event.duration);
          value = event.curve[event.curve.length - 1];
          previousTime = end;
          break;
        }
      }
    }
    return value;
  }

  private insert(event: AutomationEvent): void {
    const insideCurve = this.events.some(
      (existing) =>
        existing.kind === 'curve' && event.time > existing.time && event.time < curveEnd(existing),
    );
    if (insideCurve) {
      throw new Error('NotSupportedError: automation scheduled inside a value curve');
    }
    const at = this.events.findIndex((existing) => existing.time > event.time);
    if (at === -1) this.events.push(event);
    else this.events.splice(at, 0, event);
  }

  setValueAtTime(value: number, time: number): this {
    this.insert({ kind: 'set', time, value });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.insert({ kind: 'linear', time, value });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.insert({ kind: 'exponential', time, value });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.insert({ kind: 'target', time, value, timeConstant });
    return this;
  }

  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number): this {
    if (values.length < 2) throw new Error('InvalidStateError: a value curve needs two points');
    const end = time + duration;
    const overlaps = this.events.some(
      (existing) =>
        (existing.time > time && existing.time < end) ||
        (existing.kind === 'curve' && time >= existing.time && time < curveEnd(existing)),
    );
    if (overlaps) throw new Error('NotSupportedError: value curve overlaps scheduled automation');
    this.insert({ kind: 'curve', time, curve: Array.from(values), duration });
    return this;
  }

  /**
   * Drops every event at or after `time`, and any automation still running
   * across it; the level falls back to the last event left, as in a browser.
   */
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((event) => event.time < time && curveEnd(event) <= time);
    return this;
  }

  cancelAndHoldAtTime(time: number): this {
    const held = this.valueAt(time);
    this.cancelScheduledValues(time);
    this.insert({ kind: 'set', time, value: held });
    return this;
  }
}

/** Every node: it remembers what it feeds, and which of its own inputs are fed. */
export class FakeAudioNode {
  readonly outputs = new Set<FakeAudioNode>();
  /** The input indices something is connected to, so a merger's two sides can be checked. */
  readonly inputsFed = new Set<number>();
  channelCount = 2;
  channelCountMode: ChannelCountMode = 'max';
  channelInterpretation: ChannelInterpretation = 'speakers';

  constructor(readonly kind: string) {}

  connect<T extends FakeAudioNode>(destination: T, _output = 0, input = 0): T {
    this.outputs.add(destination);
    destination.inputsFed.add(input);
    return destination;
  }

  disconnect(destination?: FakeAudioNode): void {
    if (destination === undefined) this.outputs.clear();
    else this.outputs.delete(destination);
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam;
  constructor(clock: () => number) {
    super('gain');
    this.gain = new FakeAudioParam(clock, 1);
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan: FakeAudioParam;
  constructor(clock: () => number) {
    super('panner');
    this.pan = new FakeAudioParam(clock, 0);
  }
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  constructor(clock: () => number) {
    super('compressor');
    this.threshold = new FakeAudioParam(clock, 0);
    this.knee = new FakeAudioParam(clock, 0);
    this.ratio = new FakeAudioParam(clock, 1);
    this.attack = new FakeAudioParam(clock, 0);
    this.release = new FakeAudioParam(clock, 0);
  }
}

/** Takes one channel per input and lays them side by side as one many-channel output. */
export class FakeChannelMergerNode extends FakeAudioNode {
  constructor(readonly numberOfInputs: number) {
    super('merger');
  }
}

/** A decoded recording: its name (the path it was fetched from) and its length. */
export class FakeAudioBuffer {
  constructor(
    readonly label: string,
    readonly duration: number,
  ) {}
}

/** How a voice fell silent, and how loud its own gain was as it did. */
export interface SilenceRecord {
  readonly how: 'source-stop' | 'element-pause' | 'element-repoint';
  /** The file the voice was playing. */
  readonly label: string;
  /** The voice's own gain at the moment it stops sounding; null when it has none. */
  readonly gain: number | null;
  /**
   * The same gain {@link CLICK_WINDOW_S} earlier. A gain dropped to zero in a
   * single step reads zero at the stop but full just before it.
   */
  readonly gainJustBefore: number | null;
  /** The audio-clock time it stops sounding at. */
  readonly atS: number;
  /** Whether the context was rendering; a suspended context renders nothing, so nothing clicks. */
  readonly contextRunning: boolean;
}

/** How far before a stop {@link SilenceRecord.gainJustBefore} is read, in seconds. */
export const CLICK_WINDOW_S = 0.001;

/** A started buffer source. */
export interface SourceRecord {
  readonly label: string;
  readonly startedAtS: number;
  readonly offsetS: number;
  readonly loop: boolean;
  /** Where it was connected when it started, so a check can find its bus. */
  readonly firstOutput: FakeAudioNode | null;
  /** Whether it has been stopped, or has played to its end. */
  readonly isSilenced: () => boolean;
}

/** The first item `items` yields, or null when it yields none. */
export function firstOf<T>(items: Iterable<T>): T | null {
  for (const item of items) return item;
  return null;
}

/** The voice's own gain: the one gain node a source or element feeds. */
function ownGain(node: FakeAudioNode): FakeGainNode | null {
  if (node.outputs.size !== 1) return null;
  const [only] = node.outputs;
  return only instanceof FakeGainNode ? only : null;
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeAudioParam;
  onended: (() => void) | null = null;
  startedAtS: number | null = null;
  private offsetS = 0;
  stopAtS: number | null = null;
  ended = false;

  constructor(private readonly ctx: FakeAudioContext) {
    super('bufferSource');
    this.playbackRate = new FakeAudioParam(() => ctx.currentTime, 1);
  }

  start(when = 0, offset = 0): void {
    if (this.startedAtS !== null) throw new Error('InvalidStateError: source already started');
    this.startedAtS = Math.max(when, this.ctx.currentTime);
    this.offsetS = offset;
    this.ctx.harness.sources.push({
      label: this.buffer?.label ?? '(no buffer)',
      startedAtS: this.startedAtS,
      offsetS: offset,
      loop: this.loop,
      firstOutput: firstOf(this.outputs),
      isSilenced: () => this.stopAtS !== null || this.ended,
    });
    this.ctx.liveSources.add(this);
  }

  stop(when = 0): void {
    if (this.startedAtS === null) throw new Error('InvalidStateError: source never started');
    if (this.ended) return;
    const atS = Math.max(when, this.ctx.currentTime);
    this.stopAtS = atS;
    const gain = ownGain(this);
    this.ctx.harness.silences.push({
      how: 'source-stop',
      label: this.buffer?.label ?? '(no buffer)',
      gain: gain === null ? null : gain.gain.valueAt(atS),
      gainJustBefore: gain === null ? null : gain.gain.valueAt(atS - CLICK_WINDOW_S),
      atS,
      contextRunning: this.ctx.state === 'running',
    });
  }

  /** When the source falls silent on its own or by a scheduled stop; null while it runs on. */
  endTimeS(): number | null {
    if (this.startedAtS === null) return null;
    const rate = this.playbackRate.value;
    const naturalEnd =
      this.loop || this.buffer === null
        ? Number.POSITIVE_INFINITY
        : this.startedAtS + Math.max(0, this.buffer.duration - this.offsetS) / rate;
    const end = Math.min(naturalEnd, this.stopAtS ?? Number.POSITIVE_INFINITY);
    return Number.isFinite(end) ? end : null;
  }
}

class FakeMediaElementSourceNode extends FakeAudioNode {
  constructor(readonly mediaElement: FakeAudioElement) {
    super('mediaElementSource');
  }
}

/** The fake `<audio>` element. */
export class FakeAudioElement {
  private source = '';
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  onended: (() => void) | null = null;
  /** Set by `createMediaElementSource`. */
  graphNode: FakeMediaElementSourceNode | null = null;
  private readonly playingListeners = new Set<() => void>();

  constructor(src?: string) {
    if (src !== undefined) this.source = src;
    FakeAudioElement.created.push(this);
  }

  /** Every element made since the harness was installed. */
  static readonly created: FakeAudioElement[] = [];
  /** Where silences are logged and the clock read; set when the harness is installed. */
  static harness: AudioHarness | null = null;

  get src(): string {
    return this.source;
  }

  set src(next: string) {
    if (!this.paused) this.logSilence('element-repoint');
    this.source = next;
  }

  play(): Promise<void> {
    this.paused = false;
    // A browser reports `playing` once playback has really begun, after play() returns.
    queueMicrotask(() => {
      if (this.paused) return;
      for (const listener of this.playingListeners) listener();
    });
    return Promise.resolve();
  }

  /**
   * Runs the element on by `seconds` of the audio clock. At the end of its
   * recording it wraps when looping, and otherwise stops and fires `onended`.
   */
  runFor(seconds: number, durationS: number): void {
    if (this.paused) return;
    this.currentTime += seconds;
    if (this.currentTime < durationS) return;
    if (this.loop) {
      this.currentTime -= durationS;
      return;
    }
    this.currentTime = durationS;
    this.paused = true;
    this.onended?.();
  }

  pause(): void {
    if (this.paused) return;
    this.logSilence('element-pause');
    this.paused = true;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'playing') this.playingListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'playing') this.playingListeners.delete(listener);
  }

  removeAttribute(): void {
    return;
  }

  private logSilence(how: SilenceRecord['how']): void {
    const harness = FakeAudioElement.harness;
    if (harness === null) return;
    const node = this.graphNode;
    const gain = node === null ? null : ownGain(node);
    const atS = harness.audioTimeS();
    harness.silences.push({
      how,
      label: this.source,
      gain: gain === null ? null : gain.gain.valueAt(atS),
      gainJustBefore: gain === null ? null : gain.gain.valueAt(atS - CLICK_WINDOW_S),
      atS,
      contextRunning: harness.contextRunning(),
    });
  }
}

export class FakeAudioContext {
  private contextState: AudioContextState;
  onstatechange: (() => void) | null = null;
  readonly destination = new FakeAudioNode('destination');
  readonly outputLatency = 0;
  readonly baseLatency = 0;
  readonly liveSources = new Set<FakeAudioBufferSourceNode>();
  /** Every context made since the harness was installed, newest last. */
  static readonly created: FakeAudioContext[] = [];
  static harness: AudioHarness | null = null;
  private readonly clock = (): number => this.currentTime;

  constructor() {
    const harness = FakeAudioContext.harness;
    if (harness === null) throw new Error('installFakeAudio must run before an AudioContext');
    this.contextState = harness.initialState;
    FakeAudioContext.created.push(this);
  }

  get state(): AudioContextState {
    return this.contextState;
  }

  /** Moves the context to `next` and tells the game, as a browser fires `statechange`. */
  setState(next: AudioContextState): void {
    if (this.contextState === next) return;
    this.contextState = next;
    this.onstatechange?.();
  }

  get harness(): AudioHarness {
    const harness = FakeAudioContext.harness;
    if (harness === null) throw new Error('the audio harness was uninstalled');
    return harness;
  }

  get currentTime(): number {
    return this.harness.audioTimeS();
  }

  addEventListener(): void {
    return;
  }

  removeEventListener(): void {
    return;
  }

  createGain(): FakeGainNode {
    return new FakeGainNode(this.clock);
  }

  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode(this.clock);
  }

  createChannelMerger(inputs = 2): FakeChannelMergerNode {
    return new FakeChannelMergerNode(inputs);
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    return new FakeDynamicsCompressorNode(this.clock);
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode(this);
  }

  createMediaElementSource(element: FakeAudioElement): FakeMediaElementSourceNode {
    if (element.graphNode !== null) {
      throw new Error('InvalidStateError: element already wired into the graph');
    }
    const node = new FakeMediaElementSourceNode(element);
    element.graphNode = node;
    return node;
  }

  decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    const label = this.harness.fetchedLabels.get(data) ?? '(unknown)';
    return Promise.resolve(new FakeAudioBuffer(label, this.harness.durationOf(label)));
  }

  resume(): Promise<void> {
    if (this.state !== 'closed') this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    if (this.state !== 'closed') this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }
}

interface PendingTimer {
  readonly id: number;
  readonly dueMs: number;
  readonly run: () => void;
}

export interface AudioHarnessOptions {
  /** The state a new context starts in. `running` is a browser after its first gesture. */
  readonly initialState: AudioContextState;
  /** Serve every `fetch` with an empty body that decodes, so preloads succeed. */
  readonly decodesEverything?: boolean;
  /** Replace `window.setTimeout` with timers that run on {@link AudioHarness.advance}. */
  readonly fakeTimers?: boolean;
}

/** The handle a check drives the fake through. */
export interface AudioHarness {
  readonly initialState: AudioContextState;
  /** Every silence, in order. */
  readonly silences: SilenceRecord[];
  /** Every buffer source started, in order. */
  readonly sources: SourceRecord[];
  readonly fetchedLabels: WeakMap<ArrayBuffer, string>;
  /** The audio clock, which stands still while the newest context is not running. */
  audioTimeS(): number;
  /** Lets `ms` of wall time pass: timers fire, the audio clock runs, sources end. */
  advance(ms: number): void;
  /** Gives a file a length other than the default. */
  setDuration(label: string, seconds: number): void;
  durationOf(label: string): number;
  /** The newest context the game made. */
  context(): FakeAudioContext;
  /** Whether the newest context is rendering. */
  contextRunning(): boolean;
  /** Elements the game made, in order. */
  elements(): readonly FakeAudioElement[];
  /** Lets every pending promise settle. */
  flush(): Promise<void>;
}

/** The longest single step {@link AudioHarness.advance} takes, so ends and timers interleave in order. */
const ADVANCE_STEP_MS = 1;
/** Rounds of microtasks {@link AudioHarness.flush} waits through. */
const FLUSH_ROUNDS = 10;

/**
 * Installs the fake `AudioContext` and `Audio` on `globalThis`. Call before
 * the first `AudioManager` is constructed.
 */
export function installFakeAudio(options: AudioHarnessOptions): AudioHarness {
  let wallMs = 0;
  let audioS = 0;
  let nextTimerId = 1;
  let timers: PendingTimer[] = [];
  const durations = new Map<string, number>();

  const newestContext = (): FakeAudioContext | null =>
    FakeAudioContext.created[FakeAudioContext.created.length - 1] ?? null;

  const endDueSources = (): void => {
    const context = newestContext();
    if (context === null) return;
    for (const source of [...context.liveSources]) {
      const end = source.endTimeS();
      if (end === null || end > audioS) continue;
      context.liveSources.delete(source);
      source.ended = true;
      source.onended?.();
    }
  };

  const harness: AudioHarness = {
    initialState: options.initialState,
    silences: [],
    sources: [],
    fetchedLabels: new WeakMap(),
    audioTimeS: () => audioS,
    advance(ms: number) {
      let remaining = ms;
      while (remaining > 0) {
        const step = Math.min(ADVANCE_STEP_MS, remaining);
        remaining -= step;
        wallMs += step;
        const running = newestContext()?.state === 'running';
        if (running) {
          audioS += step / MS_PER_SECOND;
          for (const el of FakeAudioElement.created) {
            el.runFor(step / MS_PER_SECOND, harness.durationOf(el.src));
          }
        }
        endDueSources();
        const due = timers.filter((timer) => timer.dueMs <= wallMs);
        timers = timers.filter((timer) => timer.dueMs > wallMs);
        for (const timer of due) timer.run();
      }
    },
    setDuration(label, seconds) {
      durations.set(label, seconds);
    },
    durationOf: (label) => durations.get(label) ?? DEFAULT_BUFFER_DURATION_S,
    context() {
      const context = newestContext();
      if (context === null) throw new Error('no AudioContext was made');
      return context;
    },
    contextRunning: () => newestContext()?.state === 'running',
    elements: () => FakeAudioElement.created,
    async flush() {
      for (let round = 0; round < FLUSH_ROUNDS; round++) await Promise.resolve();
    },
  };

  FakeAudioContext.harness = harness;
  FakeAudioElement.harness = harness;
  Reflect.set(globalThis, 'AudioContext', FakeAudioContext);
  Reflect.set(globalThis, 'Audio', FakeAudioElement);

  if (options.decodesEverything === true) {
    Reflect.set(globalThis, 'fetch', (url: string) => {
      const body = new ArrayBuffer(0);
      harness.fetchedLabels.set(body, url);
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(body) });
    });
  }

  if (options.fakeTimers === true) {
    const setTimeoutFake = (run: () => void, delayMs = 0): number => {
      const id = nextTimerId++;
      timers.push({ id, dueMs: wallMs + delayMs, run });
      return id;
    };
    const clearTimeoutFake = (id: number): void => {
      timers = timers.filter((timer) => timer.id !== id);
    };
    const target: unknown = Reflect.get(globalThis, 'window');
    if (typeof target === 'object' && target !== null) {
      Reflect.set(target, 'setTimeout', setTimeoutFake);
      Reflect.set(target, 'clearTimeout', clearTimeoutFake);
    }
  }

  return harness;
}

/** FNV-1a offset basis and prime, for hashing a stream's name into its seed. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** mulberry32's constants. */
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_SHIFT_A = 15;
const MULBERRY_SHIFT_B = 7;
const MULBERRY_SHIFT_C = 14;
const MULBERRY_OR = 61;
const UINT32_RANGE = 4294967296;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> MULBERRY_SHIFT_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY_SHIFT_B), t | MULBERRY_OR);
    return ((t ^ (t >>> MULBERRY_SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * Independent seeded random streams, one per name. A check that draws on
 * chance runs across several streams rather than one seed, so a pass is not
 * a single lucky draw, and adding a draw to one stream never reshuffles another.
 */
export function seededStreams(seed: number): (name: string) => () => number {
  return (name) => {
    let hash = FNV_OFFSET_BASIS ^ seed;
    for (let i = 0; i < name.length; i++) {
      hash = Math.imul(hash ^ name.charCodeAt(i), FNV_PRIME);
    }
    return mulberry32(hash);
  };
}
