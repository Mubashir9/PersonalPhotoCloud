import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { HealthResponse, ServerStatus, MediaTypeFilter } from "@personal-photo-cloud/shared";
import { initDatabase } from "./db.js";
import { MediaRepository } from "./mediaRepository.js";
import { scanLibrary } from "./scanner.js";
import { getOrCreateThumbnail } from "./thumbnail.js";
import QRCode from "qrcode";

dotenv.config();

function getDiskFreeBytes(targetPath: string): number {
  try {
    if (fs.existsSync(targetPath)) {
      const stats = fs.statfsSync(targetPath);
      return stats.bavail * stats.bsize;
    }
  } catch {
    // Fall back to 0
  }
  return 0;
}

export function buildServer(options?: { dbPath?: string; libraryRoot?: string }) {
  const libraryRoot = options?.libraryRoot || process.env.LIBRARY_ROOT || "D:/Photos";
  const dbPath =
    options?.dbPath ||
    process.env.DATABASE_PATH ||
    path.join(libraryRoot, "library.sqlite");

  const db = initDatabase(dbPath);
  const mediaRepo = new MediaRepository(db);

  // Scan library on start
  scanLibrary(libraryRoot, mediaRepo);

  const app = Fastify({
    logger: false,
  });

  app.register(cors, {
    origin: true,
  });

  app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB max per upload in v1
    },
  });

  app.get("/api/v1/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      serverVersion: "0.1.0",
    };
  });

  app.get("/api/v1/status", async (): Promise<ServerStatus> => {
    // Incrementally scan library so any newly dropped files are indexed immediately
    scanLibrary(libraryRoot, mediaRepo);

    const { count, totalBytes } = mediaRepo.count();
    return {
      name: os.hostname() || "My Laptop",
      online: true,
      serverVersion: "0.1.0",
      library: {
        mediaCount: count,
        storageBytes: totalBytes,
      },
      disk: {
        freeBytes: getDiskFreeBytes(libraryRoot),
      },
    };
  });

  // Expose scan trigger endpoint
  app.post("/api/v1/library/scan", async () => {
    const result = scanLibrary(libraryRoot, mediaRepo);
    const { count, totalBytes } = mediaRepo.count();
    return {
      ...result,
      totalMediaCount: count,
      totalStorageBytes: totalBytes,
    };
  });

  // Phase 9: Pairing web page & QR Code endpoint
  app.get("/pair", async (req, reply) => {
    // Determine reachable LAN IP
    let lanIp = "127.0.0.1";
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          lanIp = net.address;
          break;
        }
      }
    }

    const host = req.headers.host || `${lanIp}:3000`;
    const port = host.includes(":") ? host.split(":")[1] : "3000";
    const serverUrl = `http://${lanIp}:${port}`;
    const pairData = JSON.stringify({
      name: os.hostname() || "Personal Photo Cloud",
      url: serverUrl,
      version: "0.1.0",
    });

    const qrDataUrl = await QRCode.toDataURL(pairData, { width: 320, margin: 2 });

    reply.type("text/html").send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Pair Personal Photo Cloud</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f4f5f8;
            color: #1c1c1e;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background: #ffffff;
            border-radius: 18px;
            padding: 32px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.08);
            max-width: 400px;
          }
          h1 { margin-top: 0; font-size: 24px; }
          p { color: #636366; font-size: 15px; margin-bottom: 24px; }
          .qr-img { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          .url-box {
            margin-top: 20px;
            padding: 10px;
            background: #f2f2f7;
            border-radius: 8px;
            font-family: monospace;
            font-size: 14px;
            color: #007aff;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>📸 Pair iPhone</h1>
          <p>Open <b>Personal Photo Cloud</b> on your iPhone, tap <b>📷 Scan QR</b>, and point at this code:</p>
          <img class="qr-img" src="${qrDataUrl}" alt="Pairing QR Code" width="300" height="300" />
          <div class="url-box">${serverUrl}</div>
        </div>
      </body>
      </html>
    `);
  });

  // List media endpoint
  app.get<{
    Querystring: { limit?: string; cursor?: string; mediaType?: MediaTypeFilter };
  }>("/api/v1/media", async (req) => {
    const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 50, 1), 200) : 50;
    const cursor = req.query.cursor;
    const mediaType = req.query.mediaType;
    return mediaRepo.list(limit, cursor, mediaType);
  });

  // Media detail endpoint
  app.get<{
    Params: { id: string };
  }>("/api/v1/media/:id", async (req, reply) => {
    const item = mediaRepo.findById(req.params.id);
    if (!item) {
      return reply.code(404).send({ error: "MEDIA_NOT_FOUND", message: "Media item not found" });
    }
    return {
      id: item.id,
      originalFilename: item.original_filename,
      storedFilename: item.stored_filename,
      relativePath: item.relative_path,
      mediaType: item.media_type,
      mimeType: item.mime_type,
      byteSize: item.byte_size,
      createdAt: item.created_at,
      importedAt: item.imported_at,
      width: item.width,
      height: item.height,
      durationMs: item.duration_ms,
      thumbnailUrl: `/api/v1/media/${item.id}/thumbnail`,
    };
  });

  // Serve thumbnail endpoint
  app.get<{
    Params: { id: string };
  }>("/api/v1/media/:id/thumbnail", async (req, reply) => {
    const item = mediaRepo.findById(req.params.id);
    if (!item) {
      return reply.code(404).send({ error: "MEDIA_NOT_FOUND", message: "Media not found" });
    }

    const sourcePath = path.join(libraryRoot, item.relative_path);
    const thumbDir = process.env.THUMBNAIL_ROOT || path.join(libraryRoot, ".thumbnails");

    const thumbPath = await getOrCreateThumbnail(sourcePath, thumbDir, item.id);
    if (!thumbPath || !fs.existsSync(thumbPath)) {
      // Fallback: If thumbnail generation is unsupported (e.g. video), fall back to original if photo or 404
      if (item.media_type === "photo" && fs.existsSync(sourcePath)) {
        reply.header("Content-Type", item.mime_type);
        return reply.send(fs.createReadStream(sourcePath));
      }
      return reply.code(404).send({ error: "THUMBNAIL_NOT_AVAILABLE" });
    }

    reply.header("Content-Type", "image/webp");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(thumbPath));
  });

  // Helper to serve files with HTTP Range (RFC 7233) support for seeking & video streaming
  const streamFileWithRange = (
    req: any,
    reply: any,
    filePath: string,
    mimeType: string,
    fileSize: number,
    attachmentFilename?: string
  ) => {
    reply.header("Accept-Ranges", "bytes");
    if (attachmentFilename) {
      reply.header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(attachmentFilename)}"`
      );
    }

    const rangeHeader = req.headers.range;
    if (!rangeHeader) {
      reply.header("Content-Type", mimeType);
      reply.header("Content-Length", fileSize);
      return reply.send(fs.createReadStream(filePath));
    }

    // Parse bytes=start-end
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || (parts[1] && end >= fileSize) || start > end) {
      reply.header("Content-Range", `bytes */${fileSize}`);
      return reply.code(416).send({ error: "RANGE_NOT_SATISFIABLE" });
    }

    const chunkSize = end - start + 1;
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    reply.header("Content-Length", chunkSize);
    reply.header("Content-Type", mimeType);

    const stream = fs.createReadStream(filePath, { start, end });
    return reply.send(stream);
  };

  // Serve full-resolution original media content with range request support
  app.get<{
    Params: { id: string };
  }>("/api/v1/media/:id/content", async (req, reply) => {
    const item = mediaRepo.findById(req.params.id);
    if (!item) {
      return reply.code(404).send({ error: "MEDIA_NOT_FOUND", message: "Media not found" });
    }
    const fullPath = path.join(libraryRoot, item.relative_path);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: "FILE_NOT_FOUND", message: "Original file missing" });
    }
    return streamFileWithRange(req, reply, fullPath, item.mime_type, item.byte_size);
  });

  // Dedicated download endpoint with Content-Disposition & range support
  app.get<{
    Params: { id: string };
  }>("/api/v1/media/:id/original", async (req, reply) => {
    const item = mediaRepo.findById(req.params.id);
    if (!item) {
      return reply.code(404).send({ error: "MEDIA_NOT_FOUND", message: "Media not found" });
    }
    const fullPath = path.join(libraryRoot, item.relative_path);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: "FILE_NOT_FOUND", message: "Original file missing" });
    }
    return streamFileWithRange(
      req,
      reply,
      fullPath,
      item.mime_type,
      item.byte_size,
      item.original_filename
    );
  });

  // Sync planning endpoint: compares manifest with existing DB records
  app.post<{
    Body: { items: any[] };
  }>("/api/v1/sync/plan", async (req) => {
    const candidates = req.body?.items || [];
    const newItems: any[] = [];
    let alreadyPresentCount = 0;
    let totalBytesToUpload = 0;

    for (const candidate of candidates) {
      const match = mediaRepo.findByCandidate({
        sourceAssetId: candidate.sourceAssetId,
        originalFilename: candidate.originalFilename,
        byteSize: candidate.byteSize,
      });

      if (match) {
        alreadyPresentCount++;
      } else {
        newItems.push(candidate);
        totalBytesToUpload += candidate.byteSize || 0;
      }
    }

    return {
      newItems,
      alreadyPresentCount,
      totalBytesToUpload,
    };
  });

  // Single file upload endpoint (streaming multipart into library storage)
  app.post("/api/v1/uploads", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: "NO_FILE", message: "No file provided" });
    }

    const originalFilename = data.filename || "upload.bin";
    const sourceAssetId = (data.fields.sourceAssetId as any)?.value || null;
    const createdAt = (data.fields.createdAt as any)?.value || new Date().toISOString();
    const mediaType = data.mimetype.startsWith("video") ? "video" : "photo";

    const mediaId = crypto.randomUUID();
    const tempDir = path.join(libraryRoot, ".temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempFilePath = path.join(tempDir, `${mediaId}_${originalFilename}`);
    const writeStream = fs.createWriteStream(tempFilePath);

    await new Promise<void>((resolve, reject) => {
      data.file.pipe(writeStream);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", (err) => reject(err));
    });

    const fileStats = fs.statSync(tempFilePath);
    const destFilePath = path.join(libraryRoot, originalFilename);

    // Atomic rename/move to permanent storage
    fs.renameSync(tempFilePath, destFilePath);

    const relativePath = path
      .relative(libraryRoot, destFilePath)
      .replace(/\\/g, "/");

    mediaRepo.upsert({
      id: mediaId,
      originalFilename,
      storedFilename: originalFilename,
      relativePath,
      mediaType,
      mimeType: data.mimetype,
      byteSize: fileStats.size,
      createdAt,
      importedAt: new Date().toISOString(),
      sourceDeviceAssetId: sourceAssetId,
      sourceCreatedAt: createdAt,
    });

    return {
      status: "ok",
      id: mediaId,
      originalFilename,
      byteSize: fileStats.size,
    };
  });

  // Phase 7: Initialize Resumable Upload
  app.post<{
    Body: {
      sourceAssetId?: string;
      originalFilename: string;
      byteSize: number;
      totalChunks: number;
      mimeType: string;
      createdAt: string;
    };
  }>("/api/v1/uploads/init", async (req) => {
    const { sourceAssetId, originalFilename, byteSize, totalChunks, mimeType, createdAt } =
      req.body;

    const uploadId = crypto.randomUUID();
    const tempDir = path.join(libraryRoot, ".temp", uploadId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    db.prepare(`
      INSERT INTO uploads (
        id, original_filename, byte_size, total_chunks, mime_type,
        created_at, source_device_asset_id, status, created_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?)
    `).run(
      uploadId,
      originalFilename,
      byteSize,
      totalChunks,
      mimeType,
      createdAt,
      sourceAssetId || null,
      new Date().toISOString()
    );

    return {
      uploadId,
      receivedChunks: [],
      chunkSize: 5 * 1024 * 1024, // 5MB chunks recommended
    };
  });

  // Phase 7: Upload specific Chunk
  app.put<{
    Params: { id: string; index: string };
  }>("/api/v1/uploads/:id/chunks/:index", async (req, reply) => {
    const { id: uploadId, index } = req.params;
    const chunkIndex = parseInt(index, 10);

    const uploadRow = db
      .prepare(`SELECT * FROM uploads WHERE id = ?`)
      .get(uploadId) as any;

    if (!uploadRow) {
      return reply.code(404).send({ error: "UPLOAD_NOT_FOUND", message: "Upload session not found" });
    }

    const tempDir = path.join(libraryRoot, ".temp", uploadId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);
    const writeStream = fs.createWriteStream(chunkPath);

    await new Promise<void>((resolve, reject) => {
      req.raw.pipe(writeStream);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", (err) => reject(err));
    });

    // Check existing chunks
    const chunkFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith("chunk_"));
    const receivedChunkIndices = chunkFiles.map((f) => parseInt(f.replace("chunk_", ""), 10));

    // If all chunks received, assemble file
    if (chunkFiles.length >= uploadRow.total_chunks) {
      const destFilePath = path.join(libraryRoot, uploadRow.original_filename);
      const combinedStream = fs.createWriteStream(destFilePath);

      for (let i = 0; i < uploadRow.total_chunks; i++) {
        const cPath = path.join(tempDir, `chunk_${i}`);
        if (fs.existsSync(cPath)) {
          const chunkData = fs.readFileSync(cPath);
          combinedStream.write(chunkData);
        }
      }
      combinedStream.end();

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Update upload session to complete
      db.prepare(`UPDATE uploads SET status = 'complete' WHERE id = ?`).run(uploadId);

      const mediaType = uploadRow.mime_type.startsWith("video") ? "video" : "photo";
      const relativePath = path
        .relative(libraryRoot, destFilePath)
        .replace(/\\/g, "/");

      mediaRepo.upsert({
        id: uploadId,
        originalFilename: uploadRow.original_filename,
        storedFilename: uploadRow.original_filename,
        relativePath,
        mediaType,
        mimeType: uploadRow.mime_type,
        byteSize: uploadRow.byte_size,
        createdAt: uploadRow.created_at,
        importedAt: new Date().toISOString(),
        sourceDeviceAssetId: uploadRow.source_device_asset_id,
        sourceCreatedAt: uploadRow.created_at,
      });

      return {
        uploadId,
        chunkIndex,
        isComplete: true,
      };
    }

    return {
      uploadId,
      chunkIndex,
      isComplete: false,
      receivedChunks: receivedChunkIndices,
    };
  });

  // Phase 7: Query Upload Status (for Resuming)
  app.get<{
    Params: { id: string };
  }>("/api/v1/uploads/:id/status", async (req, reply) => {
    const { id: uploadId } = req.params;
    const uploadRow = db
      .prepare(`SELECT * FROM uploads WHERE id = ?`)
      .get(uploadId) as any;

    if (!uploadRow) {
      return reply.code(404).send({ error: "UPLOAD_NOT_FOUND" });
    }

    const tempDir = path.join(libraryRoot, ".temp", uploadId);
    let receivedChunks: number[] = [];
    if (fs.existsSync(tempDir)) {
      const chunkFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith("chunk_"));
      receivedChunks = chunkFiles.map((f) => parseInt(f.replace("chunk_", ""), 10));
    }

    return {
      uploadId,
      receivedChunks,
      totalChunks: uploadRow.total_chunks,
      isComplete: uploadRow.status === "complete",
    };
  });

  (app as any).db = db;

  return app;
}

import { fileURLToPath } from "node:url";

const isDirectRun = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("index.ts") ||
  process.argv[1].endsWith("index.js")
);

if (isDirectRun && process.env.NODE_ENV !== "test") {
  const server = buildServer();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "0.0.0.0";

  server.listen({ port: PORT, host: HOST }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
    console.log(`Pairing URL: ${address}/pair`);
  });
}

