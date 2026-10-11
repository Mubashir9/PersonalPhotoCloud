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
}

