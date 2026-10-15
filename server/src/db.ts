import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function initDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create tables and migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'video')),
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      sha256 TEXT,
      thumbnail_path TEXT,
      source_device_asset_id TEXT,
      source_created_at TEXT,
      source TEXT DEFAULT 'library',
      caption TEXT,
      location TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_type_created_at ON media(media_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_relative_path ON media(relative_path);
    CREATE INDEX IF NOT EXISTS idx_media_sha256 ON media(sha256);

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_device_asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'uploading',
      created_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('manual', 'smart', 'source')),
      cover_media_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS album_items (
      album_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (album_id, media_id),
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_album_items_album ON album_items(album_id, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_album_items_media ON album_items(media_id);

    CREATE TABLE IF NOT EXISTS smart_album_rules (
      album_id TEXT PRIMARY KEY,
      rule_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
    );
  `);

  // Safe column migrations for existing media table
  const tableInfo = db.prepare("PRAGMA table_info(media)").all() as Array<{ name: string }>;
  const columnNames = new Set(tableInfo.map((col) => col.name));

  if (!columnNames.has("source")) {
    db.exec("ALTER TABLE media ADD COLUMN source TEXT DEFAULT 'library'");
  }
  if (!columnNames.has("caption")) {
    db.exec("ALTER TABLE media ADD COLUMN caption TEXT");
  }
  if (!columnNames.has("location")) {
    db.exec("ALTER TABLE media ADD COLUMN location TEXT");
  }
  if (!columnNames.has("metadata_json")) {
    db.exec("ALTER TABLE media ADD COLUMN metadata_json TEXT");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_media_source ON media(source);");

  return db;
}

