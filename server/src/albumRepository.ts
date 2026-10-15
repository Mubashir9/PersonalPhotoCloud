import Database from "better-sqlite3";
import crypto from "node:crypto";
import { Album, AlbumType, MediaItem } from "@personal-photo-cloud/shared";
import { MediaRow } from "./mediaRepository.js";

export interface AlbumRow {
  id: string;
  name: string;
  description: string | null;
  type: AlbumType;
  cover_media_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmartRule {
  mediaType?: "photo" | "video";
  source?: "phone" | "laptop" | "snapchat_memory";
}

export class AlbumRepository {
  constructor(private db: Database.Database) {
    this.initDefaultAlbums();
  }

  private mapMediaRow(row: MediaRow): MediaItem {
    return {
      id: row.id,
      originalFilename: row.original_filename,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      createdAt: row.created_at,
      importedAt: row.imported_at,
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      thumbnailUrl: `/api/v1/media/${row.id}/thumbnail`,
      source: row.source ?? undefined,
      caption: row.caption,
      location: row.location,
    };
  }

  private initDefaultAlbums(): void {
    const now = new Date().toISOString();

    const insertAlbum = this.db.prepare(`
      INSERT OR IGNORE INTO albums (id, name, description, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertRule = this.db.prepare(`
      INSERT OR IGNORE INTO smart_album_rules (album_id, rule_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    // Built-in Smart Album: Videos
    insertAlbum.run("smart-videos", "All Videos", "All video recordings in your library", "smart", now, now);
    insertRule.run("smart-videos", JSON.stringify({ mediaType: "video" }), now, now);

    // Built-in Smart Album: Snapchat Memories
    insertAlbum.run("smart-snapchat", "Snapchat Memories", "Saved Snapchat memories with original dates and captions", "smart", now, now);
    insertRule.run("smart-snapchat", JSON.stringify({ source: "snapchat_memory" }), now, now);

    // Built-in Source Album: Phone Backups
    insertAlbum.run("source-phone", "Phone Backups", "Items uploaded from your mobile phone", "source", now, now);
    insertRule.run("source-phone", JSON.stringify({ source: "phone" }), now, now);

    // Built-in Source Album: Laptop Imports
    insertAlbum.run("source-laptop", "Direct Imports", "Items indexed from your laptop disk", "source", now, now);
    insertRule.run("source-laptop", JSON.stringify({ source: "laptop" }), now, now);

    // Built-in Manual Album: Favorites
    insertAlbum.run("manual-favorites", "Favorites", "Your favorite photos and videos", "manual", now, now);
  }

  createManualAlbum(name: string, description?: string, mediaIds?: string[]): Album {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO albums (id, name, description, type, cover_media_id, created_at, updated_at)
      VALUES (?, ?, ?, 'manual', NULL, ?, ?)
    `).run(id, name, description || null, now, now);

    if (mediaIds && mediaIds.length > 0) {
      const insertItem = this.db.prepare(`
        INSERT OR IGNORE INTO album_items (album_id, media_id, added_at)
        VALUES (?, ?, ?)
      `);
      for (const mId of mediaIds) {
        insertItem.run(id, mId, now);
      }
    }

    return this.findById(id)!;
  }

  findById(id: string): Album | undefined {
    const albumRow = this.db.prepare(`SELECT * FROM albums WHERE id = ?`).get(id) as AlbumRow | undefined;
    if (!albumRow) return undefined;
    return this.decorateAlbum(albumRow);
  }

  list(): Album[] {
    const albumRows = this.db.prepare(`
      SELECT * FROM albums ORDER BY 
        CASE type 
          WHEN 'manual' THEN 1 
          WHEN 'smart' THEN 2 
          WHEN 'source' THEN 3 
          ELSE 4 
        END,
        created_at ASC
    `).all() as AlbumRow[];

    return albumRows.map((row) => this.decorateAlbum(row));
  }

  private getSmartRule(albumId: string): SmartRule | null {
    const ruleRow = this.db.prepare(`
      SELECT rule_json FROM smart_album_rules WHERE album_id = ?
    `).get(albumId) as { rule_json: string } | undefined;

    if (!ruleRow) return null;
    try {
      return JSON.parse(ruleRow.rule_json);
    } catch {
      return null;
    }
  }

  private decorateAlbum(row: AlbumRow): Album {
    let itemCount = 0;
    let coverMediaId: string | null = row.cover_media_id;

    if (row.type === "manual") {
      const countRow = this.db.prepare(`
        SELECT COUNT(*) as count FROM album_items WHERE album_id = ?
      `).get(row.id) as { count: number };
      itemCount = countRow.count;

      if (!coverMediaId) {
        const latestItem = this.db.prepare(`
          SELECT media_id FROM album_items WHERE album_id = ? ORDER BY added_at DESC LIMIT 1
        `).get(row.id) as { media_id: string } | undefined;
        coverMediaId = latestItem?.media_id || null;
      }
    } else {
      // Smart or Source album
      const rule = this.getSmartRule(row.id);
      let whereClause = "1=1";
      const params: any[] = [];

      if (rule?.mediaType) {
        whereClause += " AND media_type = ?";
        params.push(rule.mediaType);
      }
      if (rule?.source === "phone") {
        whereClause += " AND source_device_asset_id IS NOT NULL";
      } else if (rule?.source === "laptop") {
        whereClause += " AND source_device_asset_id IS NULL AND (source IS NULL OR source = 'library')";
      } else if (rule?.source === "snapchat_memory") {
        whereClause += " AND source = 'snapchat_memory'";
      }

      const countRow = this.db.prepare(`
        SELECT COUNT(*) as count FROM media WHERE ${whereClause}
      `).get(...params) as { count: number };
      itemCount = countRow.count;

      if (!coverMediaId) {
        const latestMedia = this.db.prepare(`
          SELECT id FROM media WHERE ${whereClause} ORDER BY created_at DESC LIMIT 1
        `).get(...params) as { id: string } | undefined;
        coverMediaId = latestMedia?.id || null;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      itemCount,
      coverMediaId,
      coverThumbnailUrl: coverMediaId ? `/api/v1/media/${coverMediaId}/thumbnail` : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getMedia(
    albumId: string,
    limit = 50,
    cursor?: string
  ): { items: MediaItem[]; nextCursor?: string } {
    const album = this.findById(albumId);
    if (!album) {
      throw new Error("ALBUM_NOT_FOUND");
    }

    let rows: MediaRow[] = [];

    if (album.type === "manual") {
      if (cursor) {
        const cursorRow = this.db.prepare(`
          SELECT added_at FROM album_items WHERE album_id = ? AND media_id = ?
        `).get(albumId, cursor) as { added_at: string } | undefined;

        if (cursorRow) {
          rows = this.db.prepare(`
            SELECT m.* FROM media m
            INNER JOIN album_items ai ON m.id = ai.media_id
            WHERE ai.album_id = ? AND (ai.added_at < ? OR (ai.added_at = ? AND m.id < ?))
            ORDER BY ai.added_at DESC, m.id DESC
            LIMIT ?
          `).all(albumId, cursorRow.added_at, cursorRow.added_at, cursor, limit + 1) as MediaRow[];
        } else {
          rows = this.db.prepare(`
            SELECT m.* FROM media m
            INNER JOIN album_items ai ON m.id = ai.media_id
            WHERE ai.album_id = ?
            ORDER BY ai.added_at DESC, m.id DESC
            LIMIT ?
          `).all(albumId, limit + 1) as MediaRow[];
        }
      } else {
        rows = this.db.prepare(`
          SELECT m.* FROM media m
          INNER JOIN album_items ai ON m.id = ai.media_id
          WHERE ai.album_id = ?
          ORDER BY ai.added_at DESC, m.id DESC
          LIMIT ?
        `).all(albumId, limit + 1) as MediaRow[];
      }
    } else {
      // Smart or Source album
      const rule = this.getSmartRule(albumId);
      let whereClause = "1=1";
      const params: any[] = [];

      if (rule?.mediaType) {
        whereClause += " AND media_type = ?";
        params.push(rule.mediaType);
      }
      if (rule?.source === "phone") {
        whereClause += " AND source_device_asset_id IS NOT NULL";
      } else if (rule?.source === "laptop") {
        whereClause += " AND source_device_asset_id IS NULL AND (source IS NULL OR source = 'library')";
      } else if (rule?.source === "snapchat_memory") {
        whereClause += " AND source = 'snapchat_memory'";
      }

      if (cursor) {
        const cursorRow = this.db.prepare(`SELECT created_at FROM media WHERE id = ?`).get(cursor) as
          | { created_at: string }
          | undefined;

        if (cursorRow) {
          rows = this.db.prepare(`
            SELECT * FROM media
            WHERE ${whereClause} AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          `).all(...params, cursorRow.created_at, cursorRow.created_at, cursor, limit + 1) as MediaRow[];
        } else {
          rows = this.db.prepare(`
            SELECT * FROM media
            WHERE ${whereClause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          `).all(...params, limit + 1) as MediaRow[];
        }
      } else {
        rows = this.db.prepare(`
          SELECT * FROM media
          WHERE ${whereClause}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(...params, limit + 1) as MediaRow[];
      }
    }

    let nextCursor: string | undefined = undefined;
    if (rows.length > limit) {
      rows.pop();
      nextCursor = rows[rows.length - 1].id;
    }

    return {
      items: rows.map((r) => this.mapMediaRow(r)),
      nextCursor,
    };
  }

  addItems(albumId: string, mediaIds: string[]): { addedCount: number } {
    const album = this.findById(albumId);
    if (!album) throw new Error("ALBUM_NOT_FOUND");
    if (album.type !== "manual") {
      throw new Error("CANNOT_MODIFY_SMART_ALBUM");
    }

    const now = new Date().toISOString();
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO album_items (album_id, media_id, added_at)
      VALUES (?, ?, ?)
    `);

    let addedCount = 0;
    const tx = this.db.transaction(() => {
      for (const mId of mediaIds) {
        const res = insertStmt.run(albumId, mId, now);
        if (res.changes > 0) addedCount++;
      }
      this.db.prepare(`UPDATE albums SET updated_at = ? WHERE id = ?`).run(now, albumId);
    });
    tx();

    return { addedCount };
  }

  removeItem(albumId: string, mediaId: string): void {
    const album = this.findById(albumId);
    if (!album) throw new Error("ALBUM_NOT_FOUND");
    if (album.type !== "manual") {
      throw new Error("CANNOT_MODIFY_SMART_ALBUM");
    }

    const now = new Date().toISOString();
    this.db.prepare(`DELETE FROM album_items WHERE album_id = ? AND media_id = ?`).run(albumId, mediaId);
    this.db.prepare(`UPDATE albums SET updated_at = ? WHERE id = ?`).run(now, albumId);
  }

  deleteAlbum(albumId: string): void {
    const album = this.findById(albumId);
    if (!album) throw new Error("ALBUM_NOT_FOUND");

    // Protect built-in default albums
    if (["smart-videos", "source-phone", "source-laptop", "manual-favorites", "smart-snapchat"].includes(albumId)) {
      throw new Error("CANNOT_DELETE_DEFAULT_ALBUM");
    }

    // Deleting album deletes album_items (CASCADE) - media records & files remain completely untouched!
    this.db.prepare(`DELETE FROM albums WHERE id = ?`).run(albumId);
  }
}

