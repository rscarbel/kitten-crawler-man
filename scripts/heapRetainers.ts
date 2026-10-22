#!/usr/bin/env tsx
/**
 * Finds what keeps an abandoned object alive, from a V8 heap snapshot.
 *
 * A harness stamps every object it has given up on with a label under one
 * property name (`ABANDONED_LABEL_PROPERTY` in `residencyRoutes.ts`) before it
 * writes the snapshot, so only those instances are searched for, not every
 * instance of their class. For each one still in the snapshot this prints the
 * shortest chain of strong references from the GC roots to it — the same
 * "distance" DevTools' retainers panel ranks by — so the last few links name
 * the listener, callback or module-level reference that holds it.
 *
 * Runs in its own process because a snapshot of a scene-heavy heap parses into
 * a few hundred megabytes of typed arrays, which would distort the heap the
 * report is measuring.
 *
 *   npx tsx scripts/heapRetainers.ts <file.heapsnapshot> [--label-property=<name>]
 *
 * Prints one JSON document: `{ targets: [{ label, node, path }] }`.
 */

import { readFileSync } from 'node:fs';

import { ABANDONED_LABEL_PROPERTY } from './residencyRoutes.js';

const UNREACHED = -1;
const SYNTHETIC_ROOT_INDEX = 0;
const ASCII_ZERO = 48;
const ASCII_NINE = 57;
const DECIMAL_BASE = 10;
const CLOSE_BRACKET = 93;
const MAX_UINT32 = 0xffffffff;
/** Characters of a string node's value shown in a path. */
const STRING_PREVIEW_CHARS = 40;

const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (fileArg === undefined) throw new Error('usage: heapRetainers.ts <file.heapsnapshot>');
const labelProperty =
  process.argv.find((arg) => arg.startsWith('--label-property='))?.split('=')[1] ??
  ABANDONED_LABEL_PROPERTY;

interface SnapshotMeta {
  readonly nodeFields: readonly string[];
  readonly nodeTypes: readonly string[];
  readonly edgeFields: readonly string[];
  readonly edgeTypes: readonly string[];
  readonly nodeCount: number;
  readonly edgeCount: number;
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value.map((item) => (typeof item === 'string' ? item : ''));
}

function objectField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) throw new Error(`no ${field}`);
  return Reflect.get(value, field);
}

function numberField(value: unknown, field: string): number {
  const found = objectField(value, field);
  if (typeof found !== 'number') throw new Error(`${field} is not a number`);
  return found;
}

function parseMeta(buffer: Buffer, nodesAt: number): SnapshotMeta {
  const header = buffer.subarray(0, nodesAt).toString('utf8').trim().replace(/,$/, '');
  const parsed: unknown = JSON.parse(`${header}}`);
  const snapshot = objectField(parsed, 'snapshot');
  const meta = objectField(snapshot, 'meta');
  const nodeTypes = objectField(meta, 'node_types');
  const edgeTypes = objectField(meta, 'edge_types');
  if (!Array.isArray(nodeTypes) || !Array.isArray(edgeTypes)) throw new Error('no type tables');
  return {
    nodeFields: stringArray(objectField(meta, 'node_fields'), 'node_fields'),
    nodeTypes: stringArray(nodeTypes[0], 'node_types[0]'),
    edgeFields: stringArray(objectField(meta, 'edge_fields'), 'edge_fields'),
    edgeTypes: stringArray(edgeTypes[0], 'edge_types[0]'),
    nodeCount: numberField(snapshot, 'node_count'),
    edgeCount: numberField(snapshot, 'edge_count'),
  };
}

/** Reads a flat array of non-negative integers starting just after `[` at `from`. */
function parseIntegers(buffer: Buffer, from: number, count: number): Uint32Array {
  const out = new Uint32Array(count);
  let filled = 0;
  let value = 0;
  let inNumber = false;
  for (let at = from; at < buffer.length; at++) {
    const byte = buffer[at];
    if (byte >= ASCII_ZERO && byte <= ASCII_NINE) {
      value = value * DECIMAL_BASE + (byte - ASCII_ZERO);
      inNumber = true;
      continue;
    }
    if (inNumber) {
      out[filled++] = Math.min(value, MAX_UINT32);
      value = 0;
      inNumber = false;
    }
    if (byte === CLOSE_BRACKET) break;
  }
  if (filled !== count) throw new Error(`expected ${count} integers, read ${filled}`);
  return out;
}

function sectionStart(buffer: Buffer, name: string): number {
  const marker = `"${name}":[`;
  const at = buffer.indexOf(marker);
  if (at < 0) throw new Error(`no ${name} section`);
  return at + marker.length;
}

const buffer = readFileSync(fileArg);
const nodesStart = sectionStart(buffer, 'nodes');
const meta = parseMeta(buffer, nodesStart - '"nodes":['.length);
const nodeFieldCount = meta.nodeFields.length;
const edgeFieldCount = meta.edgeFields.length;
const nodes = parseIntegers(buffer, nodesStart, meta.nodeCount * nodeFieldCount);
const edges = parseIntegers(buffer, sectionStart(buffer, 'edges'), meta.edgeCount * edgeFieldCount);
const stringsStart = sectionStart(buffer, 'strings') - 1;
const stringsEnd = buffer.lastIndexOf(']') + 1;
const strings = stringArray(
  JSON.parse(buffer.subarray(stringsStart, stringsEnd).toString('utf8')),
  'strings',
);

const NODE_TYPE = meta.nodeFields.indexOf('type');
const NODE_NAME = meta.nodeFields.indexOf('name');
const NODE_EDGE_COUNT = meta.nodeFields.indexOf('edge_count');
const EDGE_TYPE = meta.edgeFields.indexOf('type');
const EDGE_NAME = meta.edgeFields.indexOf('name_or_index');
const EDGE_TO = meta.edgeFields.indexOf('to_node');
const WEAK_EDGE = meta.edgeTypes.indexOf('weak');
const PROPERTY_EDGE = meta.edgeTypes.indexOf('property');
/** Edge types whose `name_or_index` is an index, not a string. */
const INDEXED_EDGE_TYPES = new Set([
  meta.edgeTypes.indexOf('element'),
  meta.edgeTypes.indexOf('hidden'),
]);
const STRING_NODE_TYPES = new Set([
  meta.nodeTypes.indexOf('string'),
  meta.nodeTypes.indexOf('concatenated string'),
  meta.nodeTypes.indexOf('sliced string'),
]);

const firstEdge = new Uint32Array(meta.nodeCount + 1);
for (let node = 0; node < meta.nodeCount; node++) {
  firstEdge[node + 1] = firstEdge[node] + nodes[node * nodeFieldCount + NODE_EDGE_COUNT];
}

function nodeName(node: number): string {
  return strings[nodes[node * nodeFieldCount + NODE_NAME]] ?? '?';
}

function describeNode(node: number): string {
  const type = meta.nodeTypes[nodes[node * nodeFieldCount + NODE_TYPE]] ?? '?';
  const name = nodeName(node);
  if (STRING_NODE_TYPES.has(nodes[node * nodeFieldCount + NODE_TYPE])) {
    return `${type} "${name.slice(0, STRING_PREVIEW_CHARS)}"`;
  }
  return `${type} ${name}`;
}

function describeEdge(edge: number): string {
  const type = edges[edge * edgeFieldCount + EDGE_TYPE];
  const nameOrIndex = edges[edge * edgeFieldCount + EDGE_NAME];
  const typeName = meta.edgeTypes[type] ?? '?';
  const name = INDEXED_EDGE_TYPES.has(type) ? `[${nameOrIndex}]` : (strings[nameOrIndex] ?? '?');
  return `${typeName} ${name}`;
}

function edgeTarget(edge: number): number {
  return edges[edge * edgeFieldCount + EDGE_TO] / nodeFieldCount;
}

const CONCATENATED_STRING = meta.nodeTypes.indexOf('concatenated string');

/**
 * A string node's value. A label built from a template is usually a
 * concatenated string in the heap, whose node name is only a placeholder: its
 * value is its `first` and `second` parts joined.
 */
function stringValue(node: number): string {
  if (nodes[node * nodeFieldCount + NODE_TYPE] !== CONCATENATED_STRING) return nodeName(node);
  let first = '';
  let second = '';
  for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
    const name = strings[edges[edge * edgeFieldCount + EDGE_NAME]];
    if (name === 'first') first = stringValue(edgeTarget(edge));
    if (name === 'second') second = stringValue(edgeTarget(edge));
  }
  return first + second;
}

interface LabelledTarget {
  readonly node: number;
  readonly label: string;
}

const targets: LabelledTarget[] = [];
for (let node = 0; node < meta.nodeCount; node++) {
  for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
    if (edges[edge * edgeFieldCount + EDGE_TYPE] !== PROPERTY_EDGE) continue;
    if (strings[edges[edge * edgeFieldCount + EDGE_NAME]] !== labelProperty) continue;
    targets.push({ node, label: stringValue(edgeTarget(edge)) });
  }
}

const parentNode = new Int32Array(meta.nodeCount).fill(UNREACHED);
const parentEdge = new Int32Array(meta.nodeCount).fill(UNREACHED);
const queue = new Uint32Array(meta.nodeCount);
let head = 0;
let tail = 0;
queue[tail++] = SYNTHETIC_ROOT_INDEX;
parentNode[SYNTHETIC_ROOT_INDEX] = SYNTHETIC_ROOT_INDEX;
while (head < tail) {
  const node = queue[head++];
  for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
    if (edges[edge * edgeFieldCount + EDGE_TYPE] === WEAK_EDGE) continue;
    const to = edgeTarget(edge);
    if (parentNode[to] !== UNREACHED) continue;
    parentNode[to] = node;
    parentEdge[to] = edge;
    queue[tail++] = to;
  }
}

interface TargetPath {
  readonly label: string;
  readonly node: string;
  /** Root first: each link is the node, then the edge that leads on from it. */
  readonly path: readonly string[];
}

function pathTo(node: number): string[] {
  const links: string[] = [];
  let at = node;
  while (at !== SYNTHETIC_ROOT_INDEX && parentNode[at] !== UNREACHED) {
    const from = parentNode[at];
    links.push(`${describeNode(from)} --${describeEdge(parentEdge[at])}-->`);
    at = from;
  }
  return links.reverse();
}

const report: TargetPath[] = targets.map((target) => ({
  label: target.label,
  node: describeNode(target.node),
  path: parentNode[target.node] === UNREACHED ? [] : pathTo(target.node),
}));

console.log(JSON.stringify({ targets: report }));
