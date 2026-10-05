/**
 * Keeps raw styling out of UI code: colours, fonts, direct canvas text and
 * per-panel phone branches all belong to the theme and the UI shell.
 *
 * `npm run lint` runs it with `--strict`, which exits 1 on any violation.
 * Without the flag it only reports.
 *
 * Usage:
 *   npm run check:ui-style                       exit 1 on any violation
 *   npx tsx scripts/check-ui-style.ts            report only
 *   npm run check:ui-style -- --verbose          list every line:column
 *   UI_STYLE_STRICT=1 npx tsx scripts/check-ui-style.ts
 *
 * The scan walks the TypeScript AST, so comments never count and only real
 * string literals, template segments, calls and property reads are judged.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.ts` file under these directories is scanned. */
const SCANNED_DIRECTORIES: readonly string[] = [
  'src/ui/',
  'src/dialog/',
  'src/dev/',
  'src/scenes/',
];

/** HUD, menu and panel owners that live outside `src/ui/`. */
const SCANNED_FILES: readonly string[] = [
  'src/ai/AIMessageDisplay.ts',
  'src/systems/AchievementUISystem.ts',
  'src/systems/ArenaSystem.ts',
  'src/systems/BossIntroSystem.ts',
  'src/systems/BuildingSystem.ts',
  'src/systems/ClubCasinoSystem.ts',
  'src/systems/ClubVipLoungeSystem.ts',
  'src/systems/DungeonIntroSystem.ts',
  'src/systems/GrateSpikesMenu.ts',
  'src/systems/KeyboardHeroSystem.ts',
  'src/systems/keyboardHeroLayout.ts',
  'src/systems/KnockoutRevive.ts',
  'src/systems/MercenaryGuildSystem.ts',
  'src/systems/MiniMapSystem.ts',
  'src/systems/ShopSystem.ts',
  'src/systems/SkillPointReminderSystem.ts',
  'src/systems/StairwellSystem.ts',
  'src/systems/SystemNoticeSystem.ts',
  'src/systems/TacticsNoticeSystem.ts',
  'src/systems/TowerStairSystem.ts',
  'src/systems/TutorialController.ts',
  'src/systems/kits/MenusKit.ts',
  'src/systems/market/vendorMenu.ts',
  'src/systems/briarHollow/QuestCounterHud.ts',
  'src/systems/briarHollow/ResourceHud.ts',
  'src/systems/briarHollow/blueprints/ScytheSwingBar.ts',
  'src/systems/briarHollow/blueprints/StationUpgrades.ts',
  'src/systems/worldEffects.ts',
  'src/systems/interiorMiniMap.ts',
  'src/systems/briarHollow/siegeHudEntry.ts',
  'src/systems/bagFullToasts.ts',
  'src/systems/kits/hudHotbar.ts',
  'src/systems/BossRoomSystem.ts',
  'src/systems/QuillConfrontationSystem.ts',
  'src/systems/LichBattleSystem.ts',
  'src/systems/DoomsdayEscapeSystem.ts',
  'src/systems/DefendQuestSystem.ts',
  'src/systems/SpiderQuestSystem.ts',
  'src/systems/MongoSystem.ts',
  'src/systems/BigTopMazeSystem.ts',
  'src/systems/RecallSystem.ts',
  'src/systems/AnchorInteriorSystem.ts',
  'src/systems/SafeRoomSystem.ts',
  'src/systems/SoulCrystalSystem.ts',
  'src/systems/PlayerChatSystem.ts',
  'src/systems/kits/ChatKit.ts',
  'src/systems/DynamiteSystem.ts',
  'src/systems/DesperadoClubSystem.ts',
  'src/systems/briarHollow/ConstructionKit.ts',
  'src/systems/briarHollow/VillageQuestGuide.ts',
  'src/systems/briarHollow/VillageAssaultSystem.ts',
  'src/systems/briarHollow/TrebuchetSystem.ts',
  'src/systems/briarHollow/blueprints/GrainHarvest.ts',
  'src/systems/briarHollow/blueprints/PastureFenceWork.ts',
  'src/systems/briarHollow/blueprints/BlueprintsStepMoments.ts',
  'src/systems/briarHollow/BlueprintsQuestSystem.ts',
  'src/systems/briarHollow/BriarHollowKit.ts',
  'src/systems/briarHollow/ConstructionSystem.ts',
  'src/systems/briarHollow/GatheringKit.ts',
  'src/systems/briarHollow/services/cookhouse.ts',
  'src/systems/briarHollow/services/forge.ts',
  'src/systems/briarHollow/services/infirmary.ts',
  'src/systems/briarHollow/services/serviceContext.ts',
  'src/systems/briarHollow/services/tradingPost.ts',
  'src/systems/briarHollow/services/VillageServices.ts',
  'src/systems/CircusQuestSystem.ts',
  'src/systems/CultHideoutSystem.ts',
  'src/systems/kits/hotbarActions.ts',
  'src/systems/market/MarketSystem.ts',
  'src/systems/MurderMysteryQuestSystem.ts',
  'src/systems/skillBookUse.ts',
  'src/systems/townApothecary.ts',
  'src/systems/townArmoury.ts',
  'src/systems/townDrillYard.ts',
  'src/systems/townHomesteads.ts',
  'src/systems/townInn.ts',
  'src/systems/townInnRooms.ts',
  'src/systems/townPub.ts',
  'src/systems/townSmithy.ts',
  'src/systems/townTattooParlor.ts',
  'src/systems/townTemple.ts',
];

/** Where styling literals are supposed to live, so they are never scanned. */
const STYLE_SOURCES: readonly string[] = [
  // The tokens and skins every other file reads its colours and fonts from.
  'src/ui/theme/',
  // Item and skill painters: small pictures, coloured like art, not chrome.
  'src/ui/icons/',
];

/**
 * Files inside a scanned directory that paint the game world rather than UI
 * chrome, each with the reason. Empty: world painters under `src/ui/` take
 * their colours from `theme/worldInk.ts` like everything else, so a file only
 * belongs here if it is pure art that cannot sensibly do the same.
 */
const WORLD_ART_EXEMPT: readonly string[] = [];

/**
 * The text primitives every other file sets type through. They are the only
 * sanctioned callers of `fillText`/`strokeText` and the only places that
 * build a font string; colour literals are still forbidden in them.
 */
const TEXT_PRIMITIVES: readonly string[] = [
  'src/ui/widgets/text.ts',
  // World labels (nameplates, combat numbers, captions over a tile) are set
  // here in the world font; every caller passes options, never a font string.
  'src/ui/world/worldText.ts',
];

/** Rules a text primitive is exempt from. */
const TEXT_PRIMITIVE_RULES: ReadonlySet<string> = new Set(['fontString', 'directCanvasText']);

/**
 * Modules that have been replaced and must not be imported again, as
 * repo-relative paths without an extension (e.g. `src/ui/InventoryPanel`).
 */
const DELETED_LEGACY_MODULES: readonly string[] = [
  'src/ui/InventoryPanel',
  'src/ui/GearPanel',
  'src/ui/InventoryInteraction',
  'src/ui/TutorialInventoryInteraction',
  'src/ui/ItemTooltip',
  'src/ui/equipmentLayout',
  'src/ui/SearchField',
  'src/systems/kits/InventoryPointer',
  'src/ui/QuantityPicker',
  'src/ui/ConstructionMenu',
  'src/ui/StructureMenu',
  'src/systems/FollowerMenu',
  'src/ui/PauseMenu',
  'src/ui/pause/AbilitiesTab',
  'src/ui/pause/AchievementsTab',
  'src/ui/pause/ControlsTab',
  'src/ui/pause/CraftsTab',
  'src/ui/pause/EquipmentTab',
  'src/ui/pause/GameTab',
  'src/ui/pause/InventoryTab',
  'src/ui/pause/JournalTab',
  'src/ui/pause/MainTab',
  'src/ui/pause/rebindCapture',
  'src/ui/pause/SettingsTab',
  'src/ui/pause/SkillsTab',
  'src/ui/pause/SpendTab',
  'src/ui/pause/StatsTab',
  'src/ui/pause/types',
  'src/ui/HowToPlayOverlay',
  'src/ui/CraftExplainers',
  'src/ui/ConstructionExplainer',
  'src/ui/ProcessingExplainer',
  'src/ui/ResourcingExplainer',
  'src/ui/MongoExplainer',
  'src/ui/canvasUtils',
  'src/ui/casino/BlackjackRulesOverlay',
  'src/ui/ConfirmModal',
  'src/ui/LevelCompleteScreen',
  'src/ui/RunCompleteScreen',
  'src/ui/ReadablePanel',
  'src/ui/NoticeBoardPanel',
  'src/ui/HUD',
  'src/systems/DungeonUIRenderer',
  'src/systems/MobileHUDSystem',
  'src/ui/HotbarToast',
  'src/ui/ToastStack',
  'src/scenes/interiorHudLayout',
  'src/ui/hudButtons/hudButtonLayout',
  'src/ui/hudButtons/hudMiniMap',
  'src/ui/hudButtons/hudViewState',
  'src/systems/briarHollow/siegeHudLayout',
  'src/systems/kits/OverlayClaims',
  'src/core/MobileTouchState',
  'src/ui/icons/satchelIcon',
  'src/ui/PricedMenuPanel',
  'src/ui/FortuneTellerPanel',
  'src/ui/TextBox',
  'src/ui/Box',
  'src/ui/Button',
  'src/ui/panelFit',
  'src/ui/core/legacySurface',
];

const RULES = {
  colourLiteral: 'hex or rgb/hsl colour literal',
  fontString: 'font string (px inside a string)',
  directCanvasText: 'direct fillText / strokeText call',
  mobileBranch: 'platform.isMobile / IS_MOBILE branch',
  legacyImport: 'import of a deleted legacy module',
} as const;

type RuleId = keyof typeof RULES;

const RULE_IDS = Object.keys(RULES).filter((rule): rule is RuleId => rule in RULES);

interface Violation {
  readonly rule: RuleId;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])/i;
const FUNCTIONAL_COLOUR = /\b(?:rgba?|hsla?)\(/i;
/**
 * A font shorthand's `px ` (after a digit, or opening a template segment that
 * follows `${size}`) followed by a family: the end of the segment (the family is
 * interpolated), a quoted name, or a generic family. Prose such as "24px tile"
 * is not a font.
 */
const FONT_SIZE_IN_STRING =
  /(?:^|\d)px\s+(?:$|["']|(?:monospace|sans-serif|serif|system-ui|cursive|fantasy|ui-\w+)\b)/;
const DIRECT_TEXT_METHODS: ReadonlySet<string> = new Set(['fillText', 'strokeText']);
const MOBILE_FLAG_IDENTIFIER = 'IS_MOBILE';
const PLATFORM_RECEIVER = 'platform';
const PLATFORM_MOBILE_PROPERTY = 'isMobile';
const TYPESCRIPT_EXTENSION = '.ts';
const COUNT_COLUMN_WIDTH = 5;
const RELATIVE_SPECIFIER = /^\.\.?\//;

function toRepoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join('/');
}

function isUnder(repoPath: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => repoPath === prefix || repoPath.startsWith(prefix));
}

function collectTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...collectTypeScriptFiles(full));
    else if (entry.endsWith(TYPESCRIPT_EXTENSION)) found.push(full);
  }
  return found;
}

function listedFilesThatAreGone(): string[] {
  return SCANNED_FILES.filter((file) => !existsSync(join(REPO_ROOT, file)));
}

function scannedFiles(): string[] {
  const fromDirectories = SCANNED_DIRECTORIES.flatMap((dir) =>
    collectTypeScriptFiles(join(REPO_ROOT, dir)),
  );
  const listed = SCANNED_FILES.map((file) => join(REPO_ROOT, file));
  const unique = [...new Set([...fromDirectories, ...listed])];
  return unique
    .filter((file) => !isUnder(toRepoPath(file), [...STYLE_SOURCES, ...WORLD_ART_EXEMPT]))
    .sort();
}

function stringSegments(node: ts.Node): string | null {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  return null;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  );
}

function isInsideImport(node: ts.Node): boolean {
  return ts.findAncestor(node, ts.isImportDeclaration) !== undefined;
}

function importedModule(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : null;
  }
  const isDynamicImport =
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (isDynamicImport) {
    if (node.arguments.length === 0) return null;
    const [specifier] = node.arguments;
    return ts.isStringLiteral(specifier) ? specifier.text : null;
  }
  return null;
}

function resolvesToDeletedModule(fromFile: string, specifier: string): boolean {
  if (!RELATIVE_SPECIFIER.test(specifier)) return false;
  const target = toRepoPath(resolve(dirname(fromFile), specifier));
  const targetModule = target.endsWith(TYPESCRIPT_EXTENSION)
    ? target.slice(0, -TYPESCRIPT_EXTENSION.length)
    : target;
  return DELETED_LEGACY_MODULES.includes(targetModule);
}

function scanFile(absolute: string): Violation[] {
  const file = toRepoPath(absolute);
  const source = ts.createSourceFile(
    absolute,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: Violation[] = [];
  const isTextPrimitive = isUnder(file, TEXT_PRIMITIVES);
  const report = (rule: RuleId, node: ts.Node): void => {
    if (isTextPrimitive && TEXT_PRIMITIVE_RULES.has(rule)) return;
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ rule, file, line: line + 1, column: character + 1 });
  };

  const visit = (node: ts.Node): void => {
    const text = stringSegments(node);
    if (text !== null && !isModuleSpecifier(node)) {
      if (HEX_COLOUR.test(text) || FUNCTIONAL_COLOUR.test(text)) report('colourLiteral', node);
      if (FONT_SIZE_IN_STRING.test(text)) report('fontString', node);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      DIRECT_TEXT_METHODS.has(node.expression.name.text)
    ) {
      report('directCanvasText', node);
    }

    const readsPlatformMobile =
      ts.isPropertyAccessExpression(node) &&
      node.name.text === PLATFORM_MOBILE_PROPERTY &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === PLATFORM_RECEIVER;
    const readsMobileFlag =
      ts.isIdentifier(node) && node.text === MOBILE_FLAG_IDENTIFIER && !isInsideImport(node);
    if (readsPlatformMobile || readsMobileFlag) report('mobileBranch', node);

    const specifier = importedModule(node);
    if (specifier !== null && resolvesToDeletedModule(absolute, specifier)) {
      report('legacyImport', node);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function printReport(violations: readonly Violation[], fileCount: number, verbose: boolean): void {
  const byRule = countBy(violations, (v) => v.rule);
  for (const rule of RULE_IDS) {
    const ruleViolations = byRule.get(rule) ?? [];
    console.log(`\n${RULES[rule]}: ${ruleViolations.length}`);
    const byFile = [...countBy(ruleViolations, (v) => v.file)].sort(
      ([, a], [, b]) => b.length - a.length,
    );
    for (const [file, fileViolations] of byFile) {
      console.log(`  ${String(fileViolations.length).padStart(COUNT_COLUMN_WIDTH)}  ${file}`);
      if (!verbose) continue;
      for (const v of fileViolations) console.log(`           ${v.file}:${v.line}:${v.column}`);
    }
  }
  const summary = RULE_IDS.map((rule) => `${rule}=${byRule.get(rule)?.length ?? 0}`).join(' ');
  console.log(
    `\ncheck:ui-style — ${violations.length} violations in ${fileCount} files (${summary})`,
  );
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const strict = args.has('--strict') || process.env.UI_STYLE_STRICT === '1';
  const gone = listedFilesThatAreGone();
  if (gone.length > 0) {
    console.error(
      `check:ui-style: SCANNED_FILES lists files that no longer exist:\n  ${gone.join('\n  ')}`,
    );
    process.exit(1);
  }
  const files = scannedFiles();
  const violations = files.flatMap(scanFile);
  printReport(violations, files.length, args.has('--verbose'));
  if (violations.length > 0 && strict) {
    console.error('check:ui-style failed: move these values into src/ui/theme/ or widgets.');
    process.exit(1);
  }
  if (violations.length > 0) console.log('(report mode: not failing)');
}

main();
