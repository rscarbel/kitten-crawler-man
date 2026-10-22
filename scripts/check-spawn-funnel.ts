/**
 * Every hostile mob enters the game through `spawnMob` (`src/levels/spawnFunnel.ts`),
 * so that its look follows the variety tier, its first rows are warmed and its
 * kind is stamped. This check fails on any construction of a hostile class
 * anywhere in `src/` outside the kind registry, `src/levels/mobKinds.ts`.
 *
 * The hostile classes are read from the registry itself: every class its
 * factories construct. A new hostile kind is covered the moment it is
 * registered. A class extending a hostile class is hostile too, so a subclass
 * built outside the registry is caught whether or not it is registered.
 *
 * Constructions are resolved through the type checker, not by name, so an
 * aliased or namespace import, a parenthesised target, a local alias of the
 * class or a constructor passed as a value all resolve to the class they build.
 *
 * Every run first proves the detector on an in-memory fixture holding each
 * bypass form; a form it misses fails the check, so a detector that has
 * quietly stopped seeing constructions cannot pass as a clean tree.
 *
 * `npm run lint` and `npm run check` run it; it exits 1 on any violation.
 *
 * Usage:
 *   npm run check:spawn-funnel
 */
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(REPO_ROOT, 'src');
const REGISTRY_FILE = 'src/levels/mobKinds.ts';
const GAME_TSCONFIG = join(REPO_ROOT, 'tsconfig.json');
const startedAtMs = performance.now();

/**
 * One bypass of the funnel the detector must flag. Placed under `src/` so it
 * resolves the game's imports and counts as game source; never written to disk.
 */
interface BypassForm {
  readonly label: string;
  readonly code: string;
}

const FIXTURE_FILE = join(SOURCE_ROOT, '__spawnFunnelSelfCheck__.ts');
const FIXTURE_PREAMBLE = [
  "import { Goblin, Goblin as Grunt } from './creatures/Goblin';",
  "import * as GoblinModule from './creatures/Goblin';",
  'declare const args: ConstructorParameters<typeof Goblin>;',
  'class UnregisteredGoblin extends Goblin {}',
  'const LocalGoblin = Goblin;',
];
const BYPASS_FORMS: readonly BypassForm[] = [
  { label: 'plain `new Goblin`', code: 'new Goblin(...args);' },
  { label: 'aliased import', code: 'new Grunt(...args);' },
  { label: 'parenthesised target', code: 'new (Goblin)(...args);' },
  { label: 'namespace import', code: 'new GoblinModule.Goblin(...args);' },
  { label: 'local alias', code: 'new LocalGoblin(...args);' },
  { label: 'unregistered subclass', code: 'new UnregisteredGoblin(...args);' },
];
const FIXTURE_TEXT = [...FIXTURE_PREAMBLE, ...BYPASS_FORMS.map((form) => form.code)].join('\n');
/** The 1-based line each bypass form sits on in the fixture. */
function fixtureLineOf(formIndex: number): number {
  return FIXTURE_PREAMBLE.length + formIndex + 1;
}

function hostWithFixture(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  return {
    ...host,
    fileExists: (path) => path === FIXTURE_FILE || host.fileExists(path),
    readFile: (path) => (path === FIXTURE_FILE ? FIXTURE_TEXT : host.readFile(path)),
    getSourceFile: (path, languageVersion, ...rest) =>
      path === FIXTURE_FILE
        ? ts.createSourceFile(path, FIXTURE_TEXT, languageVersion, true)
        : getSourceFile(path, languageVersion, ...rest),
  };
}

function loadProgram(): ts.Program {
  const config = ts.readConfigFile(GAME_TSCONFIG, (path) => ts.sys.readFile(path));
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT);
  const options = { ...parsed.options, noEmit: true };
  return ts.createProgram({
    rootNames: [...parsed.fileNames, FIXTURE_FILE],
    options,
    host: hostWithFixture(options),
  });
}

const program = loadProgram();
const checker = program.getTypeChecker();

function isGameSource(node: ts.Node): boolean {
  return node.getSourceFile().fileName.startsWith(`${SOURCE_ROOT}/`);
}

function resolveAlias(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function classDeclarationOf(symbol: ts.Symbol | undefined): ts.ClassLikeDeclaration | undefined {
  return resolveAlias(symbol)?.declarations?.find(ts.isClassLike);
}

function unwrapTarget(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function namedTarget(expression: ts.Expression): ts.Node {
  const target = unwrapTarget(expression);
  return ts.isPropertyAccessExpression(target) ? target.name : target;
}

/**
 * The class a `new` expression builds. A target naming a class directly, under
 * any import alias, resolves through its symbol; anything else (a local alias,
 * a constructor parameter, a conditional) resolves through the signature the
 * checker picks, whose return type is the instance built. A target declared
 * only outside `src/` (`Map`, `Error`, typed arrays) cannot build a game class,
 * and skipping its signature keeps the check fast enough for `npm run check`.
 */
function constructedClass(node: ts.NewExpression): ts.ClassLikeDeclaration | undefined {
  const symbol = resolveAlias(checker.getSymbolAtLocation(namedTarget(node.expression)));
  const named = classDeclarationOf(symbol);
  if (named !== undefined) return named;
  const declarations = symbol?.declarations ?? [];
  const declaredOnlyOutsideGame = declarations.length > 0 && !declarations.some(isGameSource);
  if (declaredOnlyOutsideGame) return undefined;
  const signature = checker.getResolvedSignature(node);
  if (signature === undefined) return undefined;
  return classDeclarationOf(checker.getReturnTypeOfSignature(signature).getSymbol());
}

function baseClassesOf(declaration: ts.ClassLikeDeclaration): ts.ClassLikeDeclaration[] {
  const symbol =
    declaration.name === undefined ? undefined : checker.getSymbolAtLocation(declaration.name);
  if (symbol === undefined) return [];
  const instance = checker.getDeclaredTypeOfSymbol(symbol);
  if (!instance.isClassOrInterface()) return [];
  return (checker.getBaseTypes(instance) ?? []).flatMap((base) => {
    const baseDeclaration = classDeclarationOf(base.getSymbol());
    return baseDeclaration === undefined ? [] : [baseDeclaration];
  });
}

function constructionsIn(
  source: ts.SourceFile,
): { declaration: ts.ClassLikeDeclaration; line: number }[] {
  const found: { declaration: ts.ClassLikeDeclaration; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const declaration = constructedClass(node);
      if (declaration !== undefined && isGameSource(declaration)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ declaration, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const registrySource = program.getSourceFile(join(REPO_ROOT, REGISTRY_FILE));
if (registrySource === undefined) throw new Error(`${REGISTRY_FILE} is not in the game program`);
const registeredClasses = new Set(constructionsIn(registrySource).map((site) => site.declaration));

const hostility = new Map<ts.ClassLikeDeclaration, boolean>();
function isHostile(declaration: ts.ClassLikeDeclaration): boolean {
  const known = hostility.get(declaration);
  if (known !== undefined) return known;
  hostility.set(declaration, false);
  const hostile = registeredClasses.has(declaration) || baseClassesOf(declaration).some(isHostile);
  hostility.set(declaration, hostile);
  return hostile;
}

function className(declaration: ts.ClassLikeDeclaration): string {
  return declaration.name?.text ?? '<anonymous class>';
}

function missedBypassForms(): string[] {
  const fixture = program.getSourceFile(FIXTURE_FILE);
  if (fixture === undefined) return BYPASS_FORMS.map((form) => form.label);
  const flaggedLines = new Set(
    constructionsIn(fixture)
      .filter((site) => isHostile(site.declaration))
      .map((site) => site.line),
  );
  return BYPASS_FORMS.filter((_, index) => !flaggedLines.has(fixtureLineOf(index))).map(
    (form) => form.label,
  );
}

const problems: string[] = missedBypassForms().map(
  (label) => `self-check: the detector no longer flags the ${label} form`,
);
for (const source of program.getSourceFiles()) {
  if (!isGameSource(source) || source.isDeclarationFile) continue;
  if (source.fileName === FIXTURE_FILE) continue;
  const file = relative(REPO_ROOT, source.fileName);
  if (file === REGISTRY_FILE) continue;
  for (const site of constructionsIn(source)) {
    if (!isHostile(site.declaration)) continue;
    const name = className(site.declaration);
    const registered = registeredClasses.has(site.declaration);
    const what = registered ? `a hostile ${name}` : `${name}, a subclass of a hostile class,`;
    problems.push(
      `${file}:${site.line} builds ${what} with \`new\`; spawn it with ` +
        '`spawnMob` (src/levels/spawnFunnel.ts) instead.',
    );
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`check:spawn-funnel: ${problems.length} problem(s)`);
  process.exitCode = 1;
} else {
  const elapsedMs = Math.round(performance.now() - startedAtMs);
  console.log(
    `check:spawn-funnel: ${registeredClasses.size} hostile classes, all spawned through the funnel; ` +
      `${BYPASS_FORMS.length} bypass forms caught by the self-check (${elapsedMs} ms)`,
  );
}
