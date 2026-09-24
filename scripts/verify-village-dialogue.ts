#!/usr/bin/env tsx
/**
 * Checks the transcribed villager dialogue table against its source.
 *
 * The table in `src/systems/briarHollow/ratkinDialogue.ts` was generated once
 * from a JSON block quoted in the appendix. While that appendix still exists,
 * this gate re-parses the JSON block and asserts the table matches it
 * character for character: every villager, every circumstance, no extras, no
 * missing entries. Once the appendix is gone, the comparison is meaningless
 * (there is nothing left to transcribe against), so the gate skips it and
 * falls back to checks that must hold regardless of any source document: ids
 * are unique, and no line is ever empty.
 *
 * Run: npx tsx scripts/verify-village-dialogue.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import {
  VILLAGER_IDS,
  villagerEntry,
  type VillagerId,
} from '../src/systems/briarHollow/ratkinDialogue';

const APPENDIX_PATH = 'docs/briar-hollow-plan/appendix-b-source-data.md';

const NAMED_VILLAGER_COUNT = 17;

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SourceDialogueOption {
  readonly circumstance: string;
  readonly text: string;
}

interface SourceVillager {
  readonly name: string;
  readonly role: string;
  readonly backstory: string;
  readonly dialogueOptions: readonly SourceDialogueOption[];
}

function parseDialogueOption(value: unknown): SourceDialogueOption | undefined {
  if (!isRecord(value)) return undefined;
  const { circumstance, text } = value;
  if (typeof circumstance !== 'string' || typeof text !== 'string') return undefined;
  return { circumstance, text };
}

function parseVillager(value: unknown): SourceVillager | undefined {
  if (!isRecord(value)) return undefined;
  const { name, role, backstory, dialogue_options: dialogueOptionsRaw } = value;
  if (typeof name !== 'string' || typeof role !== 'string' || typeof backstory !== 'string') {
    return undefined;
  }
  if (!Array.isArray(dialogueOptionsRaw)) return undefined;
  const dialogueOptions: SourceDialogueOption[] = [];
  for (const item of dialogueOptionsRaw) {
    const option = parseDialogueOption(item);
    if (!option) return undefined;
    dialogueOptions.push(option);
  }
  return { name, role, backstory, dialogueOptions };
}

function parseVillagers(value: unknown): SourceVillager[] {
  if (!Array.isArray(value)) {
    throw new Error('the appendix villager block did not parse as a JSON array');
  }
  const villagers: SourceVillager[] = [];
  for (const item of value) {
    const villager = parseVillager(item);
    if (!villager) {
      throw new Error(
        `an appendix villager entry did not match the expected shape: ${JSON.stringify(item)}`,
      );
    }
    villagers.push(villager);
  }
  return villagers;
}

function extractVillagersJsonBlock(markdown: string): string {
  const sectionStart = markdown.indexOf('## Villagers');
  if (sectionStart === -1) {
    throw new Error('the appendix has no "## Villagers" section');
  }
  const fenceStart = markdown.indexOf('```json', sectionStart);
  if (fenceStart === -1) {
    throw new Error('the appendix "## Villagers" section has no ```json fence');
  }
  const jsonStart = markdown.indexOf('\n', fenceStart) + 1;
  const fenceEnd = markdown.indexOf('```', jsonStart);
  if (fenceEnd === -1) {
    throw new Error('the appendix villager JSON block is never closed');
  }
  return markdown.slice(jsonStart, fenceEnd);
}

const NAME_TO_ID: ReadonlyMap<string, VillagerId> = new Map([
  ['Mayor Bramblewick', 'bramblewick'],
  ['Merrit Roottail', 'merrit'],
  ['Pipkin Paws', 'pipkin'],
  ['Doctor Sella Morrowtail', 'sella'],
  ['Vetch Nibnose', 'vetch'],
  ['Oren Ironwhisker', 'oren'],
  ['Tikka Geargrinder', 'tikka'],
  ['Fenna Splintertail', 'fenna'],
  ['Garn Picknose', 'garn'],
  ['Sedge Quickclaw', 'sedge'],
  ['Hobb Greycloak', 'hobb'],
  ['Marta Redwhisker', 'marta'],
  ['Pru Bristleback', 'pru'],
  ['Nella Softstep', 'nella'],
  ['Cricket Mudwhisk', 'cricket'],
  ['Wicker Longtooth', 'wicker'],
  ['Midge Candleear', 'midge'],
]);

function verifyAgainstAppendix(): void {
  const markdown = readFileSync(APPENDIX_PATH, 'utf8');
  const jsonBlock = extractVillagersJsonBlock(markdown);
  const parsed: unknown = JSON.parse(jsonBlock);
  const sourceVillagers = parseVillagers(parsed);

  check(
    sourceVillagers.length === VILLAGER_IDS.length,
    `appendix has ${sourceVillagers.length} villagers, table has ${VILLAGER_IDS.length}`,
  );

  const seenIds = new Set<VillagerId>();
  for (const source of sourceVillagers) {
    const id = NAME_TO_ID.get(source.name);
    check(id !== undefined, `"${source.name}" maps to a known villager id`);
    if (id === undefined) continue;
    seenIds.add(id);

    const entry = villagerEntry(id);
    check(entry.name === source.name, `${id}: name matches ("${entry.name}" vs "${source.name}")`);
    check(entry.role === source.role, `${id}: role matches`);
    check(entry.backstory === source.backstory, `${id}: backstory matches character for character`);

    const tableCircumstances = new Set(entry.dialogueOptions.map((option) => option.circumstance));
    const sourceCircumstances = new Set(
      source.dialogueOptions.map((option) => option.circumstance),
    );
    check(
      tableCircumstances.size === sourceCircumstances.size,
      `${id}: has exactly the appendix's ${sourceCircumstances.size} circumstances (table has ${tableCircumstances.size})`,
    );

    for (const sourceOption of source.dialogueOptions) {
      const tableOption = entry.dialogueOptions.find(
        (option) => option.circumstance === sourceOption.circumstance,
      );
      check(tableOption !== undefined, `${id}: has a line for "${sourceOption.circumstance}"`);
      if (tableOption === undefined) continue;
      check(
        tableOption.text === sourceOption.text,
        `${id}: "${sourceOption.circumstance}" matches character for character`,
      );
    }

    for (const tableOption of entry.dialogueOptions) {
      const inSource = sourceCircumstances.has(tableOption.circumstance);
      check(
        inSource,
        `${id}: table has no extra circumstance "${tableOption.circumstance}" beyond the appendix`,
      );
    }
  }

  for (const id of VILLAGER_IDS) {
    check(seenIds.has(id), `table's "${id}" exists in the appendix`);
  }
}

function verifyStructuralInvariants(): void {
  check(
    VILLAGER_IDS.length === NAMED_VILLAGER_COUNT,
    `there are ${NAMED_VILLAGER_COUNT} villager ids (found ${VILLAGER_IDS.length})`,
  );
  check(new Set(VILLAGER_IDS).size === VILLAGER_IDS.length, 'villager ids are unique');

  for (const id of VILLAGER_IDS) {
    const entry = villagerEntry(id);
    check(entry.dialogueOptions.length > 0, `${id}: has at least one line`);
    for (const option of entry.dialogueOptions) {
      check(option.text.length > 0, `${id}: "${option.circumstance}" is a non-empty string`);
      check(option.circumstance.length > 0, `${id}: has no empty circumstance name`);
    }
  }
}

verifyStructuralInvariants();

if (existsSync(APPENDIX_PATH)) {
  verifyAgainstAppendix();
} else {
  console.log('appendix-b-source-data.md is gone; skipping the transcription comparison.');
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll village dialogue checks passed.\n');
