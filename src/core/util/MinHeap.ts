/**
 * A binary min-heap of integer values ordered by a numeric priority.
 *
 * Built for A*: values are packed tile indices and priorities are f-scores, so
 * both live in typed arrays and no node objects are allocated. A heap may hold
 * the same value more than once (the standard "lazy deletion" A* form) — the
 * search discards a popped entry whose recorded cost has since improved.
 */
export class MinHeap {
  private values: Int32Array;
  private priorities: Float64Array;
  private count = 0;

  constructor(initialCapacity: number) {
    const capacity = Math.max(MIN_HEAP_CAPACITY, initialCapacity);
    this.values = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Empties the heap without releasing its backing arrays, so it can be reused. */
  clear(): void {
    this.count = 0;
  }

  push(value: number, priority: number): void {
    if (this.count === this.values.length) this.grow();
    let child = this.count;
    this.values[child] = value;
    this.priorities[child] = priority;
    this.count++;

    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[child]) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  /** Removes and returns the lowest-priority value, or -1 when the heap is empty. */
  pop(): number {
    if (this.count === 0) return HEAP_EMPTY;
    const top = this.values[0];
    this.count--;
    if (this.count > 0) {
      this.values[0] = this.values[this.count];
      this.priorities[0] = this.priorities[this.count];
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.count && this.priorities[left] < this.priorities[smallest]) smallest = left;
      if (right < this.count && this.priorities[right] < this.priorities[smallest])
        smallest = right;
      if (smallest === parent) return;
      this.swap(parent, smallest);
      parent = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const value = this.values[a];
    this.values[a] = this.values[b];
    this.values[b] = value;
    const priority = this.priorities[a];
    this.priorities[a] = this.priorities[b];
    this.priorities[b] = priority;
  }

  private grow(): void {
    const grownValues = new Int32Array(this.values.length * HEAP_GROWTH_FACTOR);
    grownValues.set(this.values);
    this.values = grownValues;
    const grownPriorities = new Float64Array(this.priorities.length * HEAP_GROWTH_FACTOR);
    grownPriorities.set(this.priorities);
    this.priorities = grownPriorities;
  }
}

/** Returned by `pop` on an empty heap. A* values are non-negative tile indices. */
export const HEAP_EMPTY = -1;

/** Capacity multiplier when the heap outgrows its backing arrays. */
const HEAP_GROWTH_FACTOR = 2;

/** Smallest backing-array size, so growth by doubling always makes progress. */
const MIN_HEAP_CAPACITY = 16;
