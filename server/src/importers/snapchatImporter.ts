import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execSync } from "node:child_process";
import mime from "mime-types";
import { MediaRepository } from "../mediaRepository.js";

export interface SnapchatMemoryRecord {
  Date: string;
  "Media Type"?: string;
  "Download Link"?: string;
  Location?: string;
  Caption?: string;
  [key: string]: any;
}

export interface SnapchatImportResult {
  totalFilesFound: number;
  importedCount: number;
  skippedDuplicates: number;
  recordsParsed: number;
  errors: Array<{ file?: string; error: string }>;
}

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".mp4",
  ".mov",
  ".m4v",
  ".webp",
  ".heic",
]);

/**
 * Parse a Snapchat date string into a standard ISO 8601 string.
 * Example formats:
 * - "2021-08-14 18:22:04 UTC"
 * - "2021-08-14T18:22:04Z"
 * - "2021-08-14 18:22:04"
 */
export function parseSnapchatDate(dateStr: string): string {
  try {
    const trimmed = dateStr.trim();
    // Replace " UTC" with "Z" and space with "T"
    if (trimmed.endsWith(" UTC")) {
      const isoLike = trimmed.replace(" UTC", "Z").replace(" ", "T");
      const d = new Date(isoLike);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    // Fall back to current time if unparseable
  }
  return new Date().toISOString();
}

/**
 * Normalizes a date into a sortable filename token like "2021-08-14_18-22-04" or "2021-08-14"
 */
function getDateTokens(isoString: string): string[] {
  try {
    const d = new Date(isoString);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");

    return [
      `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`,
      `${yyyy}-${mm}-${dd}-${hh}-${min}-${ss}`,
      `${yyyy}${mm}${dd}_${hh}${min}${ss}`,
      `${yyyy}-${mm}-${dd}`,
    ];
  } catch {
    return [];
  }
}

/**
 * Recursively search a directory for all files matching an extension or specific filename.
 */
function findFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

export function importSnapchatMemories(
  exportPath: string,
  libraryRoot: string,
  mediaRepo: MediaRepository,
  options?: { copyFiles?: boolean; dryRun?: boolean }
): SnapchatImportResult {
  const result: SnapchatImportResult = {
    totalFilesFound: 0,
    importedCount: 0,
    skippedDuplicates: 0,
    recordsParsed: 0,
    errors: [],
  };

  if (!fs.existsSync(exportPath)) {
    throw new Error(`Export path does not exist: ${exportPath}`);
  }

  let workingDir = exportPath;
  let tempExtractDir: string | null = null;

  // Handle ZIP file
  if (fs.statSync(exportPath).isFile() && exportPath.toLowerCase().endsWith(".zip")) {
    tempExtractDir = path.join(os.tmpdir(), `snapchat-import-${Date.now()}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });
    try {
      execSync(`tar -xf "${exportPath}" -C "${tempExtractDir}"`);
      workingDir = tempExtractDir;
    } catch (err: any) {
      if (tempExtractDir && fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      throw new Error(`Failed to extract ZIP archive: ${err.message}`);
    }
  }

  try {
    const allFiles = findFilesRecursively(workingDir);

    // 1. Find memories_history.json
    let historyJsonPath: string | null = null;
    for (const f of allFiles) {
      const base = path.basename(f).toLowerCase();
      if (base === "memories_history.json") {
        historyJsonPath = f;
        break;
      }
    }

    const records: SnapchatMemoryRecord[] = [];
    if (historyJsonPath) {
      try {
        const rawJson = fs.readFileSync(historyJsonPath, "utf-8");
        const parsed = JSON.parse(rawJson);
        const list =
          Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed["Saved Media"])
            ? parsed["Saved Media"]
            : Array.isArray(parsed["memories_history"])
            ? parsed["memories_history"]
            : [];

        for (const item of list) {
          if (item && item.Date) {
            records.push(item);
          }
        }
        result.recordsParsed = records.length;
      } catch (err: any) {
        result.errors.push({
          file: historyJsonPath,
          error: `Failed to parse memories_history.json: ${err.message}`,
        });
      }
    }

    // 2. Identify media files
    const mediaFiles = allFiles.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXTENSIONS.has(ext);
    });
    result.totalFilesFound = mediaFiles.length;

    // 3. Prepare target destination inside libraryRoot
    const targetDir = path.join(libraryRoot, "Snapchat Memories");
    if (!options?.dryRun && !fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Track imported files to avoid duplicate pairings
    const assignedFiles = new Set<string>();

    // Pass A: Match records with media files by filename timestamp or index
    for (const record of records) {
      const isoDate = parseSnapchatDate(record.Date);
      const tokens = getDateTokens(isoDate);

      // Find any file that contains one of the date tokens in its filename
      const matchingFile = mediaFiles.find((f) => {
        if (assignedFiles.has(f)) return false;
        const fname = path.basename(f);
        return tokens.some((token) => fname.includes(token));
      });

      if (matchingFile) {
        assignedFiles.add(matchingFile);
        processFile(matchingFile, isoDate, record);
      }
    }

    // Pass B: Import remaining media files without exact JSON match
    for (const file of mediaFiles) {
      if (assignedFiles.has(file)) continue;

      // Try to infer date from filename, or file birthtime
      const stats = fs.statSync(file);
      let isoDate: string;
      const dateMatch = path.basename(file).match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
      if (dateMatch) {
        isoDate = parseSnapchatDate(dateMatch[1].replace(/_/g, "-"));
      } else {
        isoDate = stats.birthtime.toISOString();
      }

      processFile(file, isoDate, null);
    }

    function processFile(
      sourceFilePath: string,
      createdAtIso: string,
      record: SnapchatMemoryRecord | null
    ) {
      try {
        const stats = fs.statSync(sourceFilePath);
        const fileBuffer = fs.readFileSync(sourceFilePath);
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        // Deduplication check
        const existing = mediaRepo.findBySha256(sha256);
        if (existing) {
          result.skippedDuplicates++;
          // Update caption if previously missing
          if (record?.Caption && !existing.caption) {
            mediaRepo.upsert({
              id: existing.id,
              originalFilename: existing.original_filename,
              storedFilename: existing.stored_filename,
              relativePath: existing.relative_path,
              mediaType: existing.media_type,
              mimeType: existing.mime_type,
              byteSize: existing.byte_size,
              createdAt: existing.created_at,
              importedAt: existing.imported_at,
              sha256: existing.sha256,
              source: "snapchat_memory",
              caption: record.Caption,
              location: record.Location || existing.location,
            });
          }
          return;
        }

        if (options?.dryRun) {
          result.importedCount++;
          return;
        }

        const ext = path.extname(sourceFilePath).toLowerCase();
        const baseName = path.basename(sourceFilePath);
        let destFilename = baseName;
        let destPath = path.join(targetDir, destFilename);

        // Ensure unique filename in target folder
        let counter = 1;
        while (fs.existsSync(destPath)) {
          const nameWithoutExt = path.parse(baseName).name;
          destFilename = `${nameWithoutExt}_${counter}${ext}`;
          destPath = path.join(targetDir, destFilename);
          counter++;
        }

        // Copy or move file
        if (options?.copyFiles !== false) {
          fs.copyFileSync(sourceFilePath, destPath);
        }

        const relativePath = path.relative(libraryRoot, destPath).replace(/\\/g, "/");
        const mimeType =
          mime.lookup(ext) || (ext === ".heic" ? "image/heic" : "application/octet-stream");
        const mediaType = mimeType.startsWith("video") ? "video" : "photo";
        const id = crypto.randomUUID();

        mediaRepo.upsert({
          id,
          originalFilename: baseName,
          storedFilename: destFilename,
          relativePath,
          mediaType,
          mimeType,
          byteSize: stats.size,
          createdAt: createdAtIso,
          importedAt: new Date().toISOString(),
          sha256,
          source: "snapchat_memory",
          caption: record?.Caption || null,
          location: record?.Location || null,
          metadataJson: record ? JSON.stringify(record) : null,
        });

        result.importedCount++;
      } catch (err: any) {
        result.errors.push({
          file: sourceFilePath,
          error: err.message,
        });
      }
    }
  } finally {
    // Clean up temporary extract dir if created
    if (tempExtractDir && fs.existsSync(tempExtractDir)) {
      try {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return result;
}

