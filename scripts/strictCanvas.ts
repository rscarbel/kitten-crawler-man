/**
 * A 2D context that holds painters to what a browser's canvas holds them to,
 * and to a little more.
 *
 * `node-canvas` is more forgiving than Chrome in the places that bite: Chrome
 * throws `IndexSizeError` on a negative radius to `ellipse`, `arcTo`,
 * `roundRect` or `createRadialGradient`, where node-canvas draws or ignores
 * it. Chrome silently skips a call with a `NaN` or infinite coordinate, which
 * is never what the painter meant. And a painter that throws halfway leaves
 * whatever it `save`d on the stack. This wraps one context so a harness sees
 * all three:
 *
 *  - a negative radius throws, as it does in Chrome;
 *  - a non-finite numeric argument to a drawing call is recorded;
 *  - `save`/`restore` depth is tracked, so a harness can assert it balances.
 */

/** Calls whose arguments at these indices are radii. */
const RADIUS_ARGUMENTS: Readonly<Record<string, readonly number[]>> = {
  arc: [2],
  ellipse: [2, 3],
  arcTo: [4],
  roundRect: [4],
  createRadialGradient: [2, 5],
};

/** Calls whose numeric arguments must all be finite to draw what was meant. */
const GEOMETRY_CALLS = [
  'arc',
  'arcTo',
  'ellipse',
  'roundRect',
  'rect',
  'fillRect',
  'strokeRect',
  'clearRect',
  'moveTo',
  'lineTo',
  'quadraticCurveTo',
  'bezierCurveTo',
  'fillText',
  'strokeText',
  'drawImage',
  'translate',
  'scale',
  'rotate',
  'setTransform',
  'transform',
  'createLinearGradient',
  'createRadialGradient',
] as const;

export interface StrictCanvasReport {
  /** Every non-finite argument or negative radius seen, as `call(args)`. */
  readonly violations: string[];
  /** `save` calls minus `restore` calls so far. */
  readonly saveDepth: () => number;
  /** Deepest the save stack has been. */
  readonly maxSaveDepth: () => number;
  /** Forgets what has been recorded, keeping the depth count. */
  readonly clear: () => void;
}

function describe(name: string, args: readonly unknown[]): string {
  const shown = args.map((arg) => (typeof arg === 'number' ? String(arg) : typeof arg));
  return `${name}(${shown.join(', ')})`;
}

function negativeRadius(name: string, args: readonly unknown[]): boolean {
  const indices = RADIUS_ARGUMENTS[name] ?? [];
  return indices.some((index) => {
    const value = args[index];
    if (typeof value === 'number') return value < 0;
    if (Array.isArray(value))
      return value.some((radius) => typeof radius === 'number' && radius < 0);
    return false;
  });
}

/** Wraps `ctx` in place and returns what it records. */
export function watchCanvas(ctx: CanvasRenderingContext2D): StrictCanvasReport {
  const violations: string[] = [];
  let depth = 0;
  let deepest = 0;

  for (const name of GEOMETRY_CALLS) {
    const original: unknown = Reflect.get(ctx, name);
    if (typeof original !== 'function') continue;
    Reflect.set(ctx, name, (...args: unknown[]) => {
      if (negativeRadius(name, args)) {
        violations.push(`negative radius: ${describe(name, args)}`);
        throw new RangeError(`IndexSizeError: negative radius in ${describe(name, args)}`);
      }
      if (args.some((arg) => typeof arg === 'number' && !Number.isFinite(arg))) {
        violations.push(`non-finite argument: ${describe(name, args)}`);
      }
      const result: unknown = Reflect.apply(original, ctx, args);
      return result;
    });
  }

  const save: unknown = Reflect.get(ctx, 'save');
  const restore: unknown = Reflect.get(ctx, 'restore');
  if (typeof save === 'function' && typeof restore === 'function') {
    Reflect.set(ctx, 'save', () => {
      depth++;
      deepest = Math.max(deepest, depth);
      Reflect.apply(save, ctx, []);
    });
    Reflect.set(ctx, 'restore', () => {
      depth = Math.max(0, depth - 1);
      Reflect.apply(restore, ctx, []);
    });
  }

  return {
    violations,
    saveDepth: () => depth,
    maxSaveDepth: () => deepest,
    clear: () => {
      violations.length = 0;
    },
  };
}
