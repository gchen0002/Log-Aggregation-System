import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(file: string): Database.Database {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode=WAL');
  db.pragma('synchronous=FULL');
  db.pragma('busy_timeout=10000');
  db.pragma('cache_size=-32768');
  db.pragma('wal_autocheckpoint=4096');
  return db;
}
