import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase } from "./db.js";
import { MediaRepository } from "./mediaRepository.js";
import { AlbumRepository } from "./albumRepository.js";
import {
  importSnapchatMemories,
  parseSnapchatDate,
} from "./importers/snapchatImporter.js";

test("Snapchat date parsing converts UTC format to ISO string", () => {
  const parsed = parseSnapchatDate("2021-08-14 18:22:04 UTC");
  assert.equal(parsed, "2021-08-14T18:22:04.000Z");

  const iso = "2023-01-01T12:00:00.000Z";
  assert.equal(parseSnapchatDate(iso), iso);
});

test("Snapchat Memories importer indexes files, preserves captions, and populates smart-snapchat album", () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "snapchat-test-"));
  const exportDir = path.join(tempBase, "snapchat_export");
  const libraryRoot = path.join(tempBase, "library");
  const dbPath = path.join(tempBase, "test.sqlite");

  fs.mkdirSync(path.join(exportDir, "json"), { recursive: true });
  fs.mkdirSync(libraryRoot, { recursive: true });

  // 1. Create mock memories_history.json
  const memoriesJson = {
    "Saved Media": [
      {
        Date: "2022-06-15 14:30:00 UTC",
        "Media Type": "PHOTO",
        Caption: "Summer beach trip!",
        Location: "Latitude, Longitude: 34.0195, -118.4912",
      },
      {
        Date: "2022-07-20 21:15:30 UTC",
        "Media Type": "VIDEO",
        Caption: "Fireworks celebration",
      },
    ],
  };

  fs.writeFileSync(
    path.join(exportDir, "json", "memories_history.json"),
    JSON.stringify(memoriesJson, null, 2)
  );

  // 2. Create mock media files
  const photoPath = path.join(exportDir, "2022-06-15_14-30-00.jpg");
  const videoPath = path.join(exportDir, "2022-07-20_21-15-30.mp4");
  const unmatchedPath = path.join(exportDir, "extra_memory_photo.png");

  fs.writeFileSync(photoPath, Buffer.from("fake-jpeg-content-1"));
  fs.writeFileSync(videoPath, Buffer.from("fake-mp4-content-2"));
  fs.writeFileSync(unmatchedPath, Buffer.from("fake-png-content-3"));

  // 3. Init DB and Repositories
  const db = initDatabase(dbPath);
  const mediaRepo = new MediaRepository(db);
  const albumRepo = new AlbumRepository(db);

  // 4. Run Importer
  const result = importSnapchatMemories(exportDir, libraryRoot, mediaRepo);

  assert.equal(result.totalFilesFound, 3);
  assert.equal(result.recordsParsed, 2);
  assert.equal(result.importedCount, 3);
  assert.equal(result.skippedDuplicates, 0);

  // 5. Verify physical files were stored in library
  const storedFolder = path.join(libraryRoot, "Snapchat Memories");
  assert.ok(fs.existsSync(storedFolder));
  assert.ok(fs.existsSync(path.join(storedFolder, "2022-06-15_14-30-00.jpg")));
  assert.ok(fs.existsSync(path.join(storedFolder, "2022-07-20_21-15-30.mp4")));

  // 6. Verify database records and metadata preservation
  const photoMedia = mediaRepo.findByRelativePath("Snapchat Memories/2022-06-15_14-30-00.jpg");
  assert.ok(photoMedia);
  assert.equal(photoMedia.source, "snapchat_memory");
  assert.equal(photoMedia.caption, "Summer beach trip!");
  assert.equal(photoMedia.location, "Latitude, Longitude: 34.0195, -118.4912");
  assert.equal(photoMedia.created_at, "2022-06-15T14:30:00.000Z");

  const videoMedia = mediaRepo.findByRelativePath("Snapchat Memories/2022-07-20_21-15-30.mp4");
  assert.ok(videoMedia);
  assert.equal(videoMedia.source, "snapchat_memory");
  assert.equal(videoMedia.caption, "Fireworks celebration");
  assert.equal(videoMedia.created_at, "2022-07-20T21:15:30.000Z");

  // 7. Verify smart-snapchat album automatically groups these memories
  const snapchatAlbumMedia = albumRepo.getMedia("smart-snapchat", 10);
  assert.equal(snapchatAlbumMedia.items.length, 3);

  const albumList = albumRepo.list();
  const snapAlbum = albumList.find((a) => a.id === "smart-snapchat");
  assert.ok(snapAlbum);
  assert.equal(snapAlbum.name, "Snapchat Memories");
  assert.equal(snapAlbum.itemCount, 3);

  // 8. Test Deduplication: Re-running importer should skip all duplicates idempotently
  const rerunResult = importSnapchatMemories(exportDir, libraryRoot, mediaRepo);
  assert.equal(rerunResult.importedCount, 0);
  assert.equal(rerunResult.skippedDuplicates, 3);

  // Cleanup
  db.close();
  fs.rmSync(tempBase, { recursive: true, force: true });
});
