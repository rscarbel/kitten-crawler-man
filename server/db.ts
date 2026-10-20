import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const DB_FILE_NAME = 'game.db';
/** SQLite's write-ahead log and shared-memory files travel with the database. */
const DB_COMPANION_SUFFIXES = ['', '-wal', '-shm'] as const;
/** Owner-only: the database holds password hashes. */
const DATA_DIR_MODE = 0o700;

/**
 * Kept out of the repo root, which the static handler reads from. A database
 * left at the root by an older layout is moved here once, with its WAL files,
 * so existing accounts and saves carry over.
 */
function databasePath(): string {
  const dataDir = path.resolve(REPO_ROOT, process.env.GAME_DATA_DIR ?? 'data');
  const target = path.join(dataDir, DB_FILE_NAME);
  mkdirSync(dataDir, { recursive: true, mode: DATA_DIR_MODE });
  const legacy = path.join(REPO_ROOT, DB_FILE_NAME);
  if (!existsSync(target) && existsSync(legacy)) {
    for (const suffix of DB_COMPANION_SUFFIXES) {
      if (existsSync(legacy + suffix)) renameSync(legacy + suffix, target + suffix);
    }
    console.log(`Moved the game database to ${target}`);
  }
  return target;
}

const db = new Database(databasePath());

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT    NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
