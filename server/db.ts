import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const DB_FILE_NAME = 'game.db';
/** Owner-only: the database holds password hashes. */
const DATA_DIR_MODE = 0o700;

/** Kept out of the repo root, which the static handler reads from. */
function databasePath(): string {
  const dataDir = path.resolve(REPO_ROOT, process.env.GAME_DATA_DIR ?? 'data');
  mkdirSync(dataDir, { recursive: true, mode: DATA_DIR_MODE });
  return path.join(dataDir, DB_FILE_NAME);
}

const db = new Database(databasePath());

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Saves live in a table named for this game, so a database that also holds
 * another game's `progress` rows never hands one of them to this game or has
 * one overwritten by it.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kcw_progress (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT    NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
