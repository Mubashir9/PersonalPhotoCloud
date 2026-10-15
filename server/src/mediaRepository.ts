import Database from "better-sqlite3";
import { MediaItem, MediaTypeFilter } from "@personal-photo-cloud/shared";

export interface MediaRow {
  id: string;
  original_filename: string;
  stored_filename: string;
  relative_path: string;
  media_type: "photo" | "video";
  mime_type: string;
  byte_size: number;
  created_at: string;
  imported_at: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string | null;
  thumbnail_path: string | null;
  source_device_asset_id: string | null;
  source_created_at: string | null;
  source: string | null;
  caption: string | null;
  location: string | null;
  metadata_json: string | null;
}

export class MediaRepository {
  constructor(private db: Database.Database) {}

  upsert(media: {
    id: string;
    originalFilename: string;
    storedFilename: string;
    relativePath: string;
    mediaType: "photo" | "video";
    mimeType: string;
    byteSize: number;
    createdAt: string;
    importedAt: string;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    sha256?: string | null;
    thumbnailPath?: string | null;
    sourceDeviceAssetId?: string | null;
    sourceCreatedAt?: string | null;
    source?: string | null;
    caption?: string | null;
    location?: string | null;
    metadataJson?: string | null;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO media (
        id, original_filename, stored_filename, relative_path, media_type,
        mime_type, byte_size, created_at, imported_at, width, height,
        duration_ms, sha256, thumbnail_path, source_device_asset_id, source_created_at,
        source, caption, location, metadata_json
      ) VALUES (
        @id, @originalFilename, @storedFilename, @relativePath, @mediaType,
        @mimeType, @byteSize, @createdAt, @importedAt, @width, @height,
        @durationMs, @sha256, @thumbnailPath, @sourceDeviceAssetId, @sourceCreatedAt,
        @source, @caption, @location, @metadataJson
      )
      ON CONFLICT(relative_path) DO UPDATE SET
        original_filename = excluded.original_filename,
        stored_filename = excluded.stored_filename,
        media_type = excluded.media_type,
        mime_type = excluded.mime_type,
        byte_size = excluded.byte_size,
        created_at = excluded.created_at,
        width = excluded.width,
        height = excluded.height,
        duration_ms = excluded.duration_ms,
        sha256 = excluded.sha256,
        thumbnail_path = excluded.thumbnail_path,
        source = excluded.source,
        caption = excluded.caption,
        location = excluded.location,
        metadata_json = excluded.metadata_json
    `);

    stmt.run({
      id: media.id,
      originalFilename: media.originalFilename,
      storedFilename: media.storedFilename,
      relativePath: media.relativePath,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      byteSize: media.byteSize,
      createdAt: media.createdAt,
      importedAt: media.importedAt,
      width: media.width ?? null,
      height: media.height ?? null,
      durationMs: media.durationMs ?? null,
      sha256: media.sha256 ?? null,
      thumbnailPath: media.thumbnailPath ?? null,
      sourceDeviceAssetId: media.sourceDeviceAssetId ?? null,
      sourceCreatedAt: media.sourceCreatedAt ?? null,
      source: media.source ?? "library",
      caption: media.caption ?? null,
      location: media.location ?? null,
      metadataJson: media.metadataJson ?? null,
    });
  }

  findByRelativePath(relativePath: string): MediaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM media WHERE relative_path = ?`)
      .get(relativePath) as MediaRow | undefined;
  }

  findById(id: string): MediaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM media WHERE id = ?`)
      .get(id) as MediaRow | undefined;
  }

  findBySha256(sha256: string): MediaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM media WHERE sha256 = ? LIMIT 1`)
      .get(sha256) as MediaRow | undefined;
  }

  findByCandidate(candidate: {
    sourceAssetId?: string;
    originalFilename: string;
    byteSize: number;
  }): MediaRow | undefined {
    if (candidate.sourceAssetId) {
      const match = this.db
        .prepare(`SELECT * FROM media WHERE source_device_asset_id = ?`)
        .get(candidate.sourceAssetId) as MediaRow | undefined;
      if (match) return match;
    }

    return this.db
      .prepare(
        `SELECT * FROM media WHERE original_filename = ? AND byte_size = ? LIMIT 1`
      )
      .get(candidate.originalFilename, candidate.byteSize) as MediaRow | undefined;
  }

  count(): { count: number; totalBytes: number } {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count, COALESCE(SUM(byte_size), 0) as totalBytes FROM media`)
      .get() as { count: number; totalBytes: number };
    return { count: row.count, totalBytes: row.totalBytes };
  }

  list(
    limit = 100,
    cursor?: string,
    mediaType?: MediaTypeFilter
  ): { items: MediaItem[]; nextCursor?: string } {
    const isFiltered = mediaType && mediaType !== "all";
    let rows: MediaRow[];

    if (cursor) {
      const cursorRow = this.findById(cursor);
      if (cursorRow) {
        if (isFiltered) {
          rows = this.db
            .prepare(
              `SELECT * FROM media 
               WHERE media_type = @mediaType
                 AND ((created_at < @createdAt) OR (created_at = @createdAt AND id < @id))
               ORDER BY created_at DESC, id DESC
               LIMIT @limit`
            )
            .all({
              mediaType,
              createdAt: cursorRow.created_at,
              id: cursorRow.id,
              limit: limit + 1,
            }) as MediaRow[];
        } else {
          rows = this.db
            .prepare(
              `SELECT * FROM media 
               WHERE (created_at < @createdAt) OR (created_at = @createdAt AND id < @id)
               ORDER BY created_at DESC, id DESC
               LIMIT @limit`
            )
            .all({
              createdAt: cursorRow.created_at,
              id: cursorRow.id,
              limit: limit + 1,
            }) as MediaRow[];
        }
      } else {
        rows = [];
      }
    } else {
      if (isFiltered) {
        rows = this.db
          .prepare(
            `SELECT * FROM media 
             WHERE media_type = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(mediaType, limit + 1) as MediaRow[];
      } else {
        rows = this.db
          .prepare(
            `SELECT * FROM media 
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(limit + 1) as MediaRow[];
      }
    }

    const hasMore = rows.length > limit;
    const returnRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? returnRows[returnRows.length - 1].id : undefined;

    const items: MediaItem[] = returnRows.map((r) => ({
      id: r.id,
      originalFilename: r.original_filename,
      mediaType: r.media_type,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      createdAt: r.created_at,
      importedAt: r.imported_at,
      width: r.width,
      height: r.height,
      durationMs: r.duration_ms,
      thumbnailUrl: `/api/v1/media/${r.id}/thumbnail`,
      source: r.source ?? undefined,
      caption: r.caption,
      location: r.location,
    }));

    return { items, nextCursor };
  }
}

