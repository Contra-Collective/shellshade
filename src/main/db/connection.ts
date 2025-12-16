import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

const MIGRATIONS = [
  `
  -- Core theme storage
  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    author TEXT,
    source_url TEXT,
    source_format TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    is_builtin INTEGER DEFAULT 0,
    UNIQUE(name, author)
  );

  -- Theme color data (normalized for flexibility)
  CREATE TABLE IF NOT EXISTS theme_colors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    color_key TEXT NOT NULL,
    hex_value TEXT NOT NULL,
    UNIQUE(theme_id, color_key)
  );

  -- Theme metadata (font, cursor, etc.)
  CREATE TABLE IF NOT EXISTS theme_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    UNIQUE(theme_id, setting_key)
  );

  -- User-defined categories/tags
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS theme_tags (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (theme_id, tag_id)
  );

  -- Export history
  CREATE TABLE IF NOT EXISTS export_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    format TEXT NOT NULL,
    export_path TEXT NOT NULL,
    exported_at INTEGER NOT NULL
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_themes_favorite ON themes(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_themes_updated ON themes(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_theme_colors_theme ON theme_colors(theme_id);
  `,
];

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  const dbPath = path.join(dbDir, 'themes.db');

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Open database
  db = new Database(dbPath);

  // Enable foreign keys and WAL mode for better performance
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Run migrations
  for (const migration of MIGRATIONS) {
    db.exec(migration);
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
