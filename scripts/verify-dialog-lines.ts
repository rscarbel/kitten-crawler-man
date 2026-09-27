#!/usr/bin/env tsx
/**
 * Gate: no dialog line is written and then never spoken.
 *
 * Every property of every exported object under `src/dialog/scripts/` is a
 * line of dialog someone wrote on purpose. This walks the real TypeScript
 * project with the language service and asks, for each one, whether
 * anything outside its own declaration reads it — either by its own name
 * (`BRAMBLEWICK.firstMeeting`) or generically, through a role interface in
 * `src/dialog/roles.ts` it `satisfies` (a caller typed as `VillagerLines`
 * reading `.firstMeeting`). The same question is asked of every role
 * interface member itself: an interface nobody ever reads, generically or
 * through any one of its implementers, is exactly as dead.
 *
 * The self-test below measured this empirically rather than assuming it:
 * `findReferences` on a `satisfies`-checked object property's own name
 * *does* surface the matching interface member's declaration (and vice
 * versa) as one of its "references" — TypeScript's own go-to-definition
 * support for `satisfies`. That entry is not a use of the line, so both
 * declarations of every target (the property's own, and, when it has one,
 * the interface member's) are excluded from every count up front, rather
 * than only the one declaration a given query started from.
 *
 * Run: npm run verify:dialog-lines
 */

import * as ts from 'typescript';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// Declaration sites the gate can ask the language service "does anything
// outside your own declaration read you?"
// ---------------------------------------------------------------------------

interface Declaration {
  readonly fileName: string;
  readonly pos: number;
}

interface ScriptPropertyTarget extends Declaration {
  /** Dotted path from the exported object's own name, e.g. "BRAMBLEWICK.firstMeeting". */
  readonly path: string;
  /** A registry object's own top-level entry (`RESIDENT_LINES.old_hilda`) — its key, not the lines under it. */
  readonly isRegistryEntry: boolean;
}

interface InterfaceMemberTarget extends Declaration {
  readonly path: string;
}

// ---------------------------------------------------------------------------
// AST walking: find exported script objects and role interfaces.
// ---------------------------------------------------------------------------

/** Strips `as`/parenthesised wrappers down to the real expression. */
function unwrapInitializer(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

interface ExportedObject {
  readonly name: string;
  readonly objectExpr: ts.ObjectLiteralExpression;
  /** `true` for an `X satisfies Record<SomeId, SomeLines>` registry — see {@link isReadByComputedLookup}. */
  readonly isRegistry: boolean;
}

function isRecordTypeReference(typeNode: ts.TypeNode): boolean {
  return (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'Record'
  );
}

/** Whether `initializer` is `<expr> satisfies Record<SomeId, SomeLines>`, written before unwrapping strips the `satisfies`. */
function isRegistryDeclaration(initializer: ts.Expression): boolean {
  return ts.isSatisfiesExpression(initializer) && isRecordTypeReference(initializer.type);
}

function collectExportedObjects(sourceFile: ts.SourceFile): ExportedObject[] {
  const results: ExportedObject[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported =
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!isExported) continue;
    for (const decl of statement.declarationList.declarations) {
      if (decl.initializer === undefined || !ts.isIdentifier(decl.name)) continue;
      const expr = unwrapInitializer(decl.initializer);
      if (ts.isObjectLiteralExpression(expr)) {
        results.push({
          name: decl.name.text,
          objectExpr: expr,
          isRegistry: isRegistryDeclaration(decl.initializer),
        });
      }
    }
  }
  return results;
}

/** Whether `node` is a literal key (`'lit'` or `0`) rather than a genuinely dynamic one. */
function isLiteralKey(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node) || ts.isNumericLiteral(node);
}

/**
 * Whether `objectName` is ever read through a computed lookup with a
 * *dynamic* key (`REGISTRY[id]`) anywhere in the project. An id-keyed
 * registry read this way makes every one of its top-level entries reachable
 * through the id union it `satisfies`, even though no entry's own key is
 * ever written as a literal property access — the generic lookup this design
 * allows in place of one. A literal-keyed access (`REGISTRY['bramblewick']`,
 * `REGISTRY[0]`) is a reference to that one entry, not proof the whole
 * registry is read generically, so it does not count here. Text-name
 * matching rather than symbol resolution, since these registry names are
 * unique across the project by convention.
 */
/** Whether `node`, or anything under it, is a dynamic-keyed `objectName[...]` element access. */
function hasDynamicElementAccess(node: ts.Node, objectName: string): boolean {
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === objectName &&
    !isLiteralKey(node.argumentExpression)
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) =>
      hasDynamicElementAccess(child, objectName) ? true : undefined,
    ) === true
  );
}

function isReadByComputedLookup(
  program: ts.Program,
  fileNames: ReadonlyArray<string>,
  objectName: string,
): boolean {
  for (const fileName of fileNames) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile !== undefined && hasDynamicElementAccess(sourceFile, objectName)) return true;
  }
  return false;
}

/**
 * Recursively collects every named property of `objectExpr`, descending into
 * a property whose value is itself a plain object literal (a grouping of
 * related lines) but not into arrays — a pool or tuple's elements have no
 * name of their own for a reference check to be asked about, only the pool
 * property itself does.
 */
function collectPropertyTargets(
  objectExpr: ts.ObjectLiteralExpression,
  fileName: string,
  pathPrefix: string,
  out: ScriptPropertyTarget[],
  entriesAreRegistryKeys = false,
): void {
  for (const prop of objectExpr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameText(prop.name);
    if (name === null) continue;
    const path = `${pathPrefix}.${name}`;
    out.push({
      fileName,
      path,
      pos: prop.name.getStart(),
      isRegistryEntry: entriesAreRegistryKeys,
    });
    const inner = unwrapInitializer(prop.initializer);
    if (ts.isObjectLiteralExpression(inner)) {
      collectPropertyTargets(inner, fileName, path, out);
    }
  }
}

/** Every member declared directly on each interface in `sourceFile`, keyed by the interface's own name, then the member's. */
function collectInterfaceMembersByInterface(
  sourceFile: ts.SourceFile,
): Map<string, Map<string, InterfaceMemberTarget>> {
  const result = new Map<string, Map<string, InterfaceMemberTarget>>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    const own = new Map<string, InterfaceMemberTarget>();
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member)) continue;
      const memberName = propertyNameText(member.name);
      if (memberName === null) continue;
      own.set(memberName, {
        fileName: sourceFile.fileName,
        path: `${statement.name.text}.${memberName}`,
        pos: member.name.getStart(),
      });
    }
    result.set(statement.name.text, own);
  }
  return result;
}

/** `interfaceName`'s own base interfaces (`interface Derived extends Base {}`), by name. */
function collectInterfaceHeritage(sourceFile: ts.SourceFile): Map<string, string[]> {
  const heritage = new Map<string, string[]>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    const bases: string[] = [];
    for (const clause of statement.heritageClauses ?? []) {
      for (const type of clause.types) {
        if (ts.isIdentifier(type.expression)) bases.push(type.expression.text);
      }
    }
    heritage.set(statement.name.text, bases);
  }
  return heritage;
}

/**
 * The declaration of `memberName` as seen from `interfaceName`: its own, if
 * it declares one, otherwise the first base interface (via `extends`) that
 * does. `null` if neither `interfaceName` nor anything it extends declares it.
 */
function resolveMemberTarget(
  interfaceName: string,
  memberName: string,
  membersByInterface: ReadonlyMap<string, ReadonlyMap<string, InterfaceMemberTarget>>,
  heritage: ReadonlyMap<string, readonly string[]>,
  seen: Set<string> = new Set<string>(),
): InterfaceMemberTarget | null {
  if (seen.has(interfaceName)) return null;
  seen.add(interfaceName);
  const own = membersByInterface.get(interfaceName)?.get(memberName);
  if (own !== undefined) return own;
  for (const base of heritage.get(interfaceName) ?? []) {
    const found = resolveMemberTarget(base, memberName, membersByInterface, heritage, seen);
    if (found !== null) return found;
  }
  return null;
}

/** Every member name `interfaceName` carries, its own and every base's, via `extends`. */
function allMemberNames(
  interfaceName: string,
  membersByInterface: ReadonlyMap<string, ReadonlyMap<string, InterfaceMemberTarget>>,
  heritage: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const names = new Set<string>(membersByInterface.get(interfaceName)?.keys() ?? []);
  for (const base of heritage.get(interfaceName) ?? []) {
    for (const name of allMemberNames(base, membersByInterface, heritage)) names.add(name);
  }
  return names;
}

function flattenInterfaceMembers(
  membersByInterface: ReadonlyMap<string, ReadonlyMap<string, InterfaceMemberTarget>>,
): InterfaceMemberTarget[] {
  return [...membersByInterface.values()].flatMap((own) => [...own.values()]);
}

/** The second type argument's name in `Record<Id, SomeLines>`, when `initializer` is `expr satisfies Record<Id, SomeLines>`. */
function linesInterfaceNameFor(initializer: ts.Expression): string | null {
  if (!ts.isSatisfiesExpression(initializer)) return null;
  const typeNode = initializer.type;
  if (!ts.isTypeReferenceNode(typeNode)) return null;
  const arg = typeNode.typeArguments?.[1];
  return arg !== undefined && ts.isTypeReferenceNode(arg) && ts.isIdentifier(arg.typeName)
    ? arg.typeName.text
    : null;
}

/** Resolves `valueNode` (an identifier referring to an exported `const X = {...}`) to that object literal's own declaration, following an import alias if it is one. */
function resolveIdentifierObjectLiteral(
  checker: ts.TypeChecker,
  valueNode: ts.Expression,
): { readonly fileName: string; readonly objectExpr: ts.ObjectLiteralExpression } | null {
  if (!ts.isIdentifier(valueNode)) return null;
  const symbol = checker.getSymbolAtLocation(valueNode);
  if (symbol === undefined) return null;
  const resolved =
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const decl = resolved.declarations?.find(ts.isVariableDeclaration);
  if (decl?.initializer === undefined) return null;
  const expr = unwrapInitializer(decl.initializer);
  return ts.isObjectLiteralExpression(expr)
    ? { fileName: decl.getSourceFile().fileName, objectExpr: expr }
    : null;
}

/**
 * Every `{ id: IMPLEMENTER, … } satisfies Record<Id, SomeLines>` registry in
 * `sourceFile`, resolved into declaration-key pairs: an implementer's own
 * property, for every name `SomeLines` (or a base it `extends`) declares,
 * linked to that role member's own declaration. `verify:dialog-lines` treats
 * either side of a pair as a reference for the other — a generic read of the
 * role member counts for every implementer's like-named property, and a
 * direct read of an implementer's property counts for the member.
 */
function collectRegistryMemberLinks(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  membersByInterface: ReadonlyMap<string, ReadonlyMap<string, InterfaceMemberTarget>>,
  heritage: ReadonlyMap<string, readonly string[]>,
): Array<readonly [string, string]> {
  const links: Array<readonly [string, string]> = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (decl.initializer === undefined) continue;
      const interfaceName = linesInterfaceNameFor(decl.initializer);
      if (interfaceName === null) continue;
      const registryExpr = unwrapInitializer(decl.initializer);
      if (!ts.isObjectLiteralExpression(registryExpr)) continue;
      const memberNames = allMemberNames(interfaceName, membersByInterface, heritage);
      for (const entry of registryExpr.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;
        const implementer = resolveIdentifierObjectLiteral(checker, entry.initializer);
        if (implementer === null) continue;
        for (const implProp of implementer.objectExpr.properties) {
          if (!ts.isPropertyAssignment(implProp)) continue;
          const name = propertyNameText(implProp.name);
          if (name === null || !memberNames.has(name)) continue;
          const memberTarget = resolveMemberTarget(
            interfaceName,
            name,
            membersByInterface,
            heritage,
          );
          if (memberTarget === null) continue;
          links.push([
            declarationKey(implementer.fileName, implProp.name.getStart()),
            declarationKey(memberTarget.fileName, memberTarget.pos),
          ]);
        }
      }
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Language service plumbing.
// ---------------------------------------------------------------------------

function defaultLibFileName(options: ts.CompilerOptions): string {
  return require.resolve(`typescript/lib/${ts.getDefaultLibFileName(options)}`);
}

function createLanguageServiceHost(
  fileNames: ReadonlyArray<string>,
  options: ts.CompilerOptions,
): ts.LanguageServiceHost {
  const fileSet = new Set(fileNames);
  return {
    getScriptFileNames: () => [...fileSet],
    getScriptVersion: () => '0',
    getScriptSnapshot: (fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => options,
    getDefaultLibFileName: defaultLibFileName,
    fileExists: (fileName) => ts.sys.fileExists(fileName),
    readFile: (fileName, encoding) => ts.sys.readFile(fileName, encoding),
    readDirectory: (path, extensions, exclude, include, depth) =>
      ts.sys.readDirectory(path, extensions, exclude, include, depth),
    directoryExists: (directoryName) => ts.sys.directoryExists(directoryName),
    getDirectories: (path) => ts.sys.getDirectories(path),
  };
}

function declarationKey(fileName: string, pos: number): string {
  return `${fileName}::${pos}`;
}

/**
 * Whether the reference at (`fileName`, `pos`) lands on a property's own
 * name in an object literal (`{ guard: '…' }`'s `guard`), rather than a read
 * of it. `findReferences` sometimes links two unrelated object literals'
 * identically-named, identically-shaped properties to each other — the same
 * key in two different `Record<SameKeyUnion, string>` tables, say — and
 * reports each one's declaration as a "reference" of the other. A hit that
 * is itself someone else's declaration site is exactly that coincidence, not
 * a use, whether or not that other declaration happens to be one this run
 * already knows about.
 */
function isPropertyDeclarationSite(program: ts.Program, fileName: string, pos: number): boolean {
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return false;
  let node: ts.Node = sourceFile;
  for (;;) {
    const child = node
      .getChildren(sourceFile)
      .find((candidate) => pos >= candidate.getStart(sourceFile) && pos < candidate.getEnd());
    if (child === undefined) break;
    node = child;
  }
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  );
}

/**
 * Every reference to `target`'s declaration that is not itself one of the
 * program's known declaration sites — a target's own, or, for a property
 * linked to a role-interface member (or vice versa), the other side of that
 * link — and is not merely another, unrelated property's own declaration
 * that `findReferences` coincidentally grouped in with it (see
 * {@link isPropertyDeclarationSite}). Only what's left after removing both
 * is an actual use.
 */
function externalReferenceCount(
  service: ts.LanguageService,
  program: ts.Program,
  target: Declaration,
  knownDeclarations: ReadonlySet<string>,
): number {
  const referencedSymbols = service.findReferences(target.fileName, target.pos);
  if (referencedSymbols === undefined) return 0;
  let count = 0;
  for (const symbol of referencedSymbols) {
    for (const reference of symbol.references) {
      if (knownDeclarations.has(declarationKey(reference.fileName, reference.textSpan.start)))
        continue;
      if (isPropertyDeclarationSite(program, reference.fileName, reference.textSpan.start))
        continue;
      count++;
    }
  }
  return count;
}

interface EngineResult {
  readonly scriptPropertiesChecked: number;
  readonly scriptPropertiesUnreferenced: ReadonlyArray<string>;
  readonly interfaceMembersChecked: number;
  readonly interfaceMembersUnreferenced: ReadonlyArray<string>;
}

/** Builds the undirected adjacency `declarationKey -> declarationKey`s a registry-member link connects. */
function linkAdjacency(links: ReadonlyArray<readonly [string, string]>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string): void => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const [a, b] of links) {
    connect(a, b);
    connect(b, a);
  }
  return adjacency;
}

/** Whether `key`'s own reads, or any read reaching it through a chain of registry-member links, is nonzero. */
function isCoveredTransitively(
  key: string,
  ownRefCount: ReadonlyMap<string, number>,
  adjacency: ReadonlyMap<string, Set<string>>,
): boolean {
  const seen = new Set<string>([key]);
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if ((ownRefCount.get(current) ?? 0) > 0) return true;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return false;
}

function runEngine(
  service: ts.LanguageService,
  scriptFiles: ReadonlyArray<string>,
  rolesFile: string,
  registryFiles: ReadonlyArray<string>,
  projectFiles: ReadonlyArray<string>,
): EngineResult {
  const program = service.getProgram();
  if (program === undefined) throw new Error('language service produced no program');
  const checker = program.getTypeChecker();

  const scriptTargets: ScriptPropertyTarget[] = [];
  for (const file of scriptFiles) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) continue;
    for (const { name, objectExpr, isRegistry } of collectExportedObjects(sourceFile)) {
      const readGenerically = isRegistry && isReadByComputedLookup(program, projectFiles, name);
      collectPropertyTargets(objectExpr, file, name, scriptTargets, readGenerically);
    }
  }

  const rolesSource = program.getSourceFile(rolesFile);
  const membersByInterface =
    rolesSource === undefined
      ? new Map<string, Map<string, InterfaceMemberTarget>>()
      : collectInterfaceMembersByInterface(rolesSource);
  const heritage =
    rolesSource === undefined ? new Map<string, string[]>() : collectInterfaceHeritage(rolesSource);
  const interfaceMembers = flattenInterfaceMembers(membersByInterface);

  const links: Array<readonly [string, string]> = [];
  for (const file of registryFiles) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) continue;
    links.push(...collectRegistryMemberLinks(sourceFile, checker, membersByInterface, heritage));
  }
  const adjacency = linkAdjacency(links);

  const knownDeclarations = new Set<string>();
  for (const target of scriptTargets)
    knownDeclarations.add(declarationKey(target.fileName, target.pos));
  for (const member of interfaceMembers)
    knownDeclarations.add(declarationKey(member.fileName, member.pos));

  const checkedScriptTargets = scriptTargets.filter((target) => !target.isRegistryEntry);
  const ownRefCount = new Map<string, number>();
  for (const target of checkedScriptTargets) {
    ownRefCount.set(
      declarationKey(target.fileName, target.pos),
      externalReferenceCount(service, program, target, knownDeclarations),
    );
  }
  for (const member of interfaceMembers) {
    ownRefCount.set(
      declarationKey(member.fileName, member.pos),
      externalReferenceCount(service, program, member, knownDeclarations),
    );
  }

  const scriptPropertiesUnreferenced = checkedScriptTargets
    .filter(
      (target) =>
        !isCoveredTransitively(declarationKey(target.fileName, target.pos), ownRefCount, adjacency),
    )
    .map((target) => `${target.fileName}: ${target.path}`);

  const interfaceMembersUnreferenced = interfaceMembers
    .filter(
      (member) =>
        !isCoveredTransitively(declarationKey(member.fileName, member.pos), ownRefCount, adjacency),
    )
    .map((member) => member.path);

  return {
    scriptPropertiesChecked: checkedScriptTargets.length,
    scriptPropertiesUnreferenced,
    interfaceMembersChecked: interfaceMembers.length,
    interfaceMembersUnreferenced,
  };
}

// ---------------------------------------------------------------------------
// Self-tests: fixtures built fresh in a temp directory on every run, so the
// gate's own logic is exercised whether or not any real script exists yet.
// ---------------------------------------------------------------------------

const FIXTURE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  lib: ['lib.es2020.d.ts'],
};

interface Fixtures {
  readonly rolesFile: string;
  readonly scriptFiles: string[];
  readonly registryFiles: string[];
  readonly allFiles: string[];
}

function writeFixtures(dir: string): Fixtures {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, lines: string[]): string => {
    const filePath = join(dir, name);
    writeFileSync(filePath, `${lines.join('\n')}\n`);
    return filePath;
  };

  const rolesFile = write('roles.ts', [
    'export interface Foo {',
    '  readonly a: string;',
    '  readonly b: string;',
    '}',
    'export interface Foo2 {',
    '  readonly c: string;',
    '}',
    'export interface Foo3 {',
    '  readonly d: string;',
    '}',
    'export interface Base {',
    '  readonly e: string;',
    '}',
    'export interface Derived extends Base {}',
    'export interface VillagerLike {',
    '  readonly intro: string;',
    '}',
  ]);

  // Nothing anywhere reads OBJ.a or OBJ.b, directly or through Foo — both are dead.
  const unreferencedFile = write('unreferenced.ts', [
    "import type { Foo } from './roles';",
    "export const OBJ = { a: 'one', b: 'two' } satisfies Foo;",
  ]);

  // OBJ2.c is read directly by name, never through Foo2 — covered.
  const directFile = write('direct.ts', [
    "import type { Foo2 } from './roles';",
    "export const OBJ2 = { c: 'x' } satisfies Foo2;",
  ]);
  write('directReader.ts', ["import { OBJ2 } from './direct';", 'export const readC = OBJ2.c;']);

  // OBJ3.d is never read by name, only through a function generic over Foo3 — covered.
  const viaInterfaceFile = write('viaInterface.ts', [
    "import type { Foo3 } from './roles';",
    "export const OBJ3 = { d: 'y' } satisfies Foo3;",
  ]);
  write('genericReader.ts', [
    "import type { Foo3 } from './roles';",
    "import { OBJ3 } from './viaInterface';",
    'export function useD(f: Foo3): string {',
    '  return f.d;',
    '}',
    'useD(OBJ3);',
  ]);

  // OBJ4.e satisfies Derived, but "e" is declared on Base, which Derived only
  // extends — the generic read below is typed as Base, not Derived.
  const viaBaseFile = write('viaBase.ts', [
    "import type { Derived } from './roles';",
    "export const OBJ4 = { e: 'z' } satisfies Derived;",
  ]);
  write('genericBaseReader.ts', [
    "import type { Base } from './roles';",
    "import { OBJ4 } from './viaBase';",
    'export function useE(f: Base): string {',
    '  return f.e;',
    '}',
    'useE(OBJ4);',
  ]);

  // Two unrelated Record<'guard' | 'other', string> tables that happen to
  // share a key name. TABLE_TWO.guard is read directly; TABLE_ONE.guard never
  // is — if findReferences conflated the two same-named, same-shaped
  // properties' own declarations, TABLE_ONE.guard would wrongly look covered.
  const tableOneFile = write('tableOne.ts', [
    "export const TABLE_ONE = { guard: 'one', other: 'one-two' } as const satisfies Record<",
    "  'guard' | 'other',",
    '  string',
    '>;',
  ]);
  const tableTwoFile = write('tableTwo.ts', [
    "export const TABLE_TWO = { guard: 'two', other: 'two-two' } as const satisfies Record<",
    "  'guard' | 'other',",
    '  string',
    '>;',
  ]);
  write('tableReader.ts', [
    "import { TABLE_ONE } from './tableOne';",
    "import { TABLE_TWO } from './tableTwo';",
    'export const readOtherFromOne = TABLE_ONE.other;',
    'export const readBothFromTwo = TABLE_TWO.guard + TABLE_TWO.other;',
  ]);

  // A.intro and B.intro satisfy VillagerLike only through the REGISTRY below
  // (no per-object `satisfies`, matching the real villager scripts): the
  // registry-linking pass, not a `satisfies`-derived TS cross-reference, is
  // what has to connect them to a generic read. A.extra is a villager-
  // specific line nobody reads, direct or generic — the required negative case.
  const villagerAFile = write('villagerA.ts', [
    "export const A = { intro: 'hi', extra: 'nobody reads this' } as const;",
  ]);
  const villagerBFile = write('villagerB.ts', ["export const B = { intro: 'yo' } as const;"]);
  const registryFile = write('registry.ts', [
    "import { A } from './villagerA';",
    "import { B } from './villagerB';",
    "import type { VillagerLike } from './roles';",
    "export const REGISTRY: Record<'a' | 'b', VillagerLike> = { a: A, b: B } as const satisfies Record<",
    "  'a' | 'b',",
    '  VillagerLike',
    '>;',
  ]);
  write('genericIntroReader.ts', [
    "import type { VillagerLike } from './roles';",
    "import { REGISTRY } from './registry';",
    'export function useIntro(v: VillagerLike): string {',
    '  return v.intro;',
    '}',
    'useIntro(REGISTRY.a);',
    'useIntro(REGISTRY.b);',
  ]);

  // The older registry-entry exemption: an id-keyed Record<K, string>
  // read somewhere by a *dynamic* key makes its own top-level entries count
  // as covered, whatever their individual reference counts.
  const lookedUpRegistryFile = write('registryLookedUp.ts', [
    "export const REG_LOOKED_UP = { p: 'alpha', q: 'beta' } as const satisfies Record<'p' | 'q', string>;",
  ]);
  write('computedReader.ts', [
    "import { REG_LOOKED_UP } from './registryLookedUp';",
    "export function pick(key: 'p' | 'q'): string {",
    '  return REG_LOOKED_UP[key];',
    '}',
  ]);

  // The same shape, never read by a dynamic key anywhere — its entries get
  // no exemption, and neither is read by name, so both must fail.
  const neverLookedUpRegistryFile = write('registryNeverLookedUp.ts', [
    "export const REG_NEVER_LOOKED_UP = { m: 'gamma', n: 'delta' } as const satisfies Record<'m' | 'n', string>;",
  ]);

  // A *literal*-keyed element access is a reference to that one key, not
  // proof the whole table is read generically — REG_LITERAL.s, untouched by
  // anything, must still fail even though REG_LITERAL['r'] appears nearby.
  const literalRegistryFile = write('registryLiteralAccess.ts', [
    "export const REG_LITERAL = { r: 'epsilon', s: 'zeta' } as const satisfies Record<'r' | 's', string>;",
  ]);
  write('literalReader.ts', [
    "import { REG_LITERAL } from './registryLiteralAccess';",
    "export const readR = REG_LITERAL['r'];",
  ]);

  // A registry entry reached only by dynamic lookup is exempt itself, but a
  // *nested* property inside its value is a fresh object literal the
  // exemption never reaches — REG_NESTED.t.dead must still fail even though
  // REG_NESTED.t.live is read directly and REG_NESTED is looked up dynamically.
  const nestedRegistryFile = write('registryNested.ts', [
    'export const REG_NESTED = {',
    "  t: { live: 'used', dead: 'never read' },",
    "} as const satisfies Record<'t', { live: string; dead: string }>;",
  ]);
  write('nestedReader.ts', [
    "import { REG_NESTED } from './registryNested';",
    'export const readLive = REG_NESTED.t.live;',
    "export function pickNested(key: 't') {",
    '  return REG_NESTED[key];',
    '}',
  ]);

  const scriptFiles = [
    unreferencedFile,
    directFile,
    viaInterfaceFile,
    viaBaseFile,
    tableOneFile,
    tableTwoFile,
    villagerAFile,
    villagerBFile,
    lookedUpRegistryFile,
    neverLookedUpRegistryFile,
    literalRegistryFile,
    nestedRegistryFile,
  ];
  const registryFiles = [registryFile];
  const allFiles = [
    rolesFile,
    ...scriptFiles,
    ...registryFiles,
    join(dir, 'directReader.ts'),
    join(dir, 'genericReader.ts'),
    join(dir, 'genericBaseReader.ts'),
    join(dir, 'tableReader.ts'),
    join(dir, 'genericIntroReader.ts'),
    join(dir, 'computedReader.ts'),
    join(dir, 'literalReader.ts'),
    join(dir, 'nestedReader.ts'),
  ];
  return { rolesFile, scriptFiles, registryFiles, allFiles };
}

function runSelfTests(): void {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'verify-dialog-lines-'));
  try {
    const { rolesFile, scriptFiles, registryFiles, allFiles } = writeFixtures(fixtureDir);
    const host = createLanguageServiceHost(allFiles, FIXTURE_COMPILER_OPTIONS);
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    const program = service.getProgram();
    if (program === undefined) throw new Error('fixture program failed to build');

    // The empirical question the module doc comment answers: does
    // findReferences on a satisfies-checked property already surface a read
    // reached only through the matching interface member? Measured directly
    // against the "OBJ3.d" fixture, which has no direct reader at all.
    const viaInterfaceSource = program.getSourceFile(scriptFiles[2]);
    if (viaInterfaceSource === undefined) throw new Error('fixture viaInterface.ts did not parse');
    const viaInterfaceObjects = collectExportedObjects(viaInterfaceSource);
    if (viaInterfaceObjects.length === 0)
      throw new Error('fixture viaInterface.ts had no exported object');
    const viaInterfaceObject = viaInterfaceObjects[0];
    const dProperty = viaInterfaceObject.objectExpr.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && propertyNameText(p.name) === 'd',
    );
    if (dProperty === undefined) throw new Error('fixture viaInterface.ts had no property "d"');
    const rawReferences =
      service
        .findReferences(scriptFiles[2], dProperty.name.getStart())
        ?.flatMap((s) => s.references) ?? [];
    const linksToInterfaceDeclaration = rawReferences.some(
      (reference) => reference.fileName === rolesFile,
    );
    console.log(
      `\nempirical check: findReferences on a satisfies-checked property's own name ${
        linksToInterfaceDeclaration ? 'DOES' : 'does NOT'
      } surface the role interface member's declaration as one of its "references" — both declarations are excluded from every count regardless of the answer.`,
    );

    const result = runEngine(service, scriptFiles, rolesFile, registryFiles, allFiles);

    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('OBJ.a')),
      'self-test: an unreferenced script property (OBJ.a) is reported, naming it',
    );
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('OBJ.b')),
      'self-test: an unreferenced script property (OBJ.b) is reported, naming it',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('OBJ2.c')),
      'self-test: a directly-referenced script property (OBJ2.c) passes',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('OBJ3.d')),
      'self-test: a script property referenced only through its role interface (OBJ3.d) passes',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('OBJ4.e')),
      'self-test: a script property referenced only through a base interface it inherits (OBJ4.e) passes',
    );

    // (a) A bogus TypeScript cross-link between two unrelated tables' same-
    // named properties must not vacuously cover the dead one.
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('TABLE_ONE.guard')),
      'self-test: TABLE_ONE.guard is reported dead even though TABLE_TWO.guard, a same-named property of an unrelated table, is read',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('TABLE_TWO.guard')),
      'self-test: TABLE_TWO.guard, which really is read, passes',
    );

    // Item 5's registry-member linking: A.intro/B.intro have no `satisfies`
    // of their own — only the REGISTRY's `satisfies Record<'a'|'b', VillagerLike>`
    // links them to VillagerLike.intro, which a generic reader reads.
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('A.intro')),
      'self-test: A.intro, linked only through the registry, passes',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('B.intro')),
      'self-test: B.intro, linked only through the registry, passes',
    );
    check(
      !result.interfaceMembersUnreferenced.some((entry) => entry.endsWith('VillagerLike.intro')),
      'self-test: VillagerLike.intro, read generically, passes',
    );
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('A.extra')),
      'self-test: A.extra, a villager-specific line nobody reads, is reported dead, naming it',
    );

    // The older registry-entry exemption (a whole table read by a dynamic key).
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_LOOKED_UP.p')),
      'self-test: REG_LOOKED_UP.p, reached only by REG_LOOKED_UP[key], passes',
    );
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_LOOKED_UP.q')),
      'self-test: REG_LOOKED_UP.q, reached only by REG_LOOKED_UP[key], passes',
    );
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_NEVER_LOOKED_UP.m')),
      'self-test: REG_NEVER_LOOKED_UP.m, never looked up by a dynamic key nor read by name, is reported dead',
    );
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_NEVER_LOOKED_UP.n')),
      'self-test: REG_NEVER_LOOKED_UP.n, never looked up by a dynamic key nor read by name, is reported dead',
    );

    // A literal-keyed element access is a reference to one key, not a
    // blanket exemption for the whole table.
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_LITERAL.s')),
      "self-test: REG_LITERAL.s is reported dead — REG_LITERAL['r'] elsewhere does not exempt it",
    );

    // A registry read by a dynamic key exempts its own top-level entry, but
    // not a nested property inside that entry's own object literal.
    check(
      !result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_NESTED.t.live')),
      'self-test: REG_NESTED.t.live, read directly, passes',
    );
    check(
      result.scriptPropertiesUnreferenced.some((entry) => entry.endsWith('REG_NESTED.t.dead')),
      'self-test: REG_NESTED.t.dead, nested inside a dynamically-looked-up entry, is still reported dead',
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The real project.
// ---------------------------------------------------------------------------

function loadProjectFiles(tsconfigPath: string): {
  fileNames: string[];
  options: ts.CompilerOptions;
} {
  const configText = ts.sys.readFile(tsconfigPath);
  if (configText === undefined) throw new Error(`could not read ${tsconfigPath}`);
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  if (parsed.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  }
  const configParseResult = ts.parseJsonConfigFileContent(
    parsed.config,
    ts.sys,
    dirname(tsconfigPath),
  );
  return { fileNames: configParseResult.fileNames, options: configParseResult.options };
}

function runRealProjectCheck(): void {
  const repoRoot = resolve(__dirname, '..');
  const tsconfigPath = join(repoRoot, 'tsconfig.json');
  const { fileNames, options } = loadProjectFiles(tsconfigPath);

  const scriptsDir = join(repoRoot, 'src', 'dialog', 'scripts');
  const rolesFile = join(repoRoot, 'src', 'dialog', 'roles.ts');
  const scriptFiles = fileNames.filter((fileName) => resolve(fileName).startsWith(scriptsDir));
  // The registries that link a villager script's own properties to a role
  // interface's members live in src/dialog/ itself, deliberately outside
  // src/dialog/scripts/ — see villagerRegistry.ts's own doc comment.
  const dialogDir = join(repoRoot, 'src', 'dialog');
  const registryFiles = fileNames.filter(
    (fileName) =>
      resolve(fileName).startsWith(dialogDir) && !resolve(fileName).startsWith(scriptsDir),
  );

  if (scriptFiles.length === 0) {
    console.log(
      '\nreal project: no script files exist under src/dialog/scripts/ yet — nothing to check; role interface members are not checked either, since none of them has an implementer yet.',
    );
    return;
  }

  const host = createLanguageServiceHost(fileNames, options);
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  console.log(`\nreal project: ${scriptFiles.length} file(s) under src/dialog/scripts/`);

  const result = runEngine(service, scriptFiles, rolesFile, registryFiles, fileNames);
  console.log(
    `checked ${result.scriptPropertiesChecked} script propert${result.scriptPropertiesChecked === 1 ? 'y' : 'ies'} and ${result.interfaceMembersChecked} role interface member(s)`,
  );

  for (const entry of result.scriptPropertiesUnreferenced) {
    check(false, `unreferenced dialog line: ${entry}`);
  }
  for (const entry of result.interfaceMembersUnreferenced) {
    check(false, `unreferenced role interface member: ${entry}`);
  }
  if (
    result.scriptPropertiesUnreferenced.length === 0 &&
    result.interfaceMembersUnreferenced.length === 0
  ) {
    check(true, 'every script property and role interface member is referenced');
  }
}

// ---------------------------------------------------------------------------

function main(): void {
  runSelfTests();
  runRealProjectCheck();

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
