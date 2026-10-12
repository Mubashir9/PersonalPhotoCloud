import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);

function extractVideoFrame(
  videoPath: string,
  outputPath: string,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const binPath: string | null = (ffmpegPath as any)?.default || ffmpegPath;
    if (!binPath || typeof binPath !== "string") {
      return reject(new Error("ffmpeg binary not available"));
    }

    // Extract frame at 1s mark (or 0s), scaled to width:height
    const args = [
      "-ss",
      "00:00:01",
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-y",
      outputPath,
    ];

    execFile(binPath, args, (error: any) => {
      if (error) {
        // Fallback: try frame at 00:00:00 if 1s fails
        const fallbackArgs = [
          "-ss",
          "00:00:00",
          "-i",
          videoPath,
          "-vframes",
          "1",
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          "-y",
          outputPath,
        ];
        execFile(binPath, fallbackArgs, (fallbackErr: any) => {
          if (fallbackErr) reject(fallbackErr);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

export class ConcurrencyLimiter {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(public readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export const videoThumbnailLimiter = new ConcurrencyLimiter(2);
export const photoThumbnailLimiter = new ConcurrencyLimiter(4);

export async function getOrCreateThumbnail(
  sourcePath: string,
  thumbnailCacheDir: string,
  mediaId: string,
  options: ThumbnailOptions = { width: 300, height: 300, quality: 80 }
): Promise<string | null> {
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  if (!fs.existsSync(thumbnailCacheDir)) {
    fs.mkdirSync(thumbnailCacheDir, { recursive: true });
  }

  const thumbPath = path.join(thumbnailCacheDir, `${mediaId}.webp`);

  // Return existing cache if available
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  const ext = path.extname(sourcePath).toLowerCase();
  const width = options.width || 300;
  const height = options.height || 300;

  if (VIDEO_EXTENSIONS.has(ext)) {
    return videoThumbnailLimiter.run(async () => {
      if (fs.existsSync(thumbPath)) {
        return thumbPath;
      }
      try {
        const tempFramePath = path.join(thumbnailCacheDir, `${mediaId}_frame.jpg`);
        await extractVideoFrame(sourcePath, tempFramePath, width, height);

        if (fs.existsSync(tempFramePath)) {
          await sharp(tempFramePath)
            .webp({ quality: options.quality || 80 })
            .toFile(thumbPath);
          fs.unlinkSync(tempFramePath);
          return thumbPath;
        }
        return null;
      } catch {
        return null;
      }
    });
  }

  return photoThumbnailLimiter.run(async () => {
    if (fs.existsSync(thumbPath)) {
      return thumbPath;
    }
    try {
      // Generate webp thumbnail for photos
      await sharp(sourcePath)
        .rotate() // Auto-orient based on EXIF
        .resize(width, height, {
          fit: "cover",
          position: "centre",
        })
        .webp({ quality: options.quality || 80 })
        .toFile(thumbPath);

      return thumbPath;
    } catch {
      return null;
    }
  });
}

