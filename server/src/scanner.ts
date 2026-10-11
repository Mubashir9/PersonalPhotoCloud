import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mime from "mime-types";
import { MediaRepository } from "./mediaRepository.js";

const SUPPORTED_EXTENSIONS = new Set([
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".webp",
  ".gif",
  // Videos
  ".mp4",
  ".mov",
  ".m4v",
]);

function shouldIgnore(name: string): boolean {
  if (name.startsWith(".") || name === "Thumbs.db") return true;
  if (name.endsWith(".sqlite") || name.endsWith(".sqlite-wal") || name.endsWith(".sqlite-shm")) return true;
  return false;
}

export function scanLibrary(
  libraryRoot: string,
  mediaRepo: MediaRepository
): { indexedCount: number; skippedCount: number } {
  if (!fs.existsSync(libraryRoot)) {
    fs.mkdirSync(libraryRoot, { recursive: true });
    return { indexedCount: 0, skippedCount: 0 };
  }

  let indexedCount = 0;
  let skippedCount = 0;

  function traverse(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
          skippedCount++;
          continue;
        }

        const relativePath = path
          .relative(libraryRoot, fullPath)
          .replace(/\\/g, "/");

        const stats = fs.statSync(fullPath);
        const mimeType = mime.lookup(ext) || (ext === ".heic" ? "image/heic" : "application/octet-stream");
        const mediaType = mimeType.startsWith("video") ? "video" : "photo";

        const existing = mediaRepo.findByRelativePath(relativePath);
        const id = existing ? existing.id : crypto.randomUUID();

        mediaRepo.upsert({
          id,
          originalFilename: entry.name,
          storedFilename: entry.name,
          relativePath,
          mediaType,
          mimeType,
          byteSize: stats.size,
          createdAt: stats.birthtime.toISOString(),
          importedAt: stats.mtime.toISOString(),
        });

        indexedCount++;
      }
    }
  }

  traverse(libraryRoot);
  return { indexedCount, skippedCount };
}
