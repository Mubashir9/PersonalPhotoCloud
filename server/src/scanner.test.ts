import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase } from "./db.js";
import { MediaRepository } from "./mediaRepository.js";
import { scanLibrary } from "./scanner.js";
import { buildServer } from "./index.js";

test("Database initialization and schema", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-test-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = initDatabase(dbPath);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  assert.ok(tableNames.includes("media"));
  assert.ok(tableNames.includes("migrations"));

  db.close();
  fs.rmSync(tempDir, { recursive: true });
});

test("Library scanner indexes files and ignores invalid/temporary files idempotently", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-test-scan-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = initDatabase(dbPath);
  const repo = new MediaRepository(db);

  // Create test files
  fs.writeFileSync(path.join(tempDir, "photo1.jpg"), "fake jpg content");
  fs.writeFileSync(path.join(tempDir, "photo2.png"), "fake png content");
  fs.writeFileSync(path.join(tempDir, "video1.mp4"), "fake mp4 content");
  fs.writeFileSync(path.join(tempDir, "ignore.txt"), "fake text");
  fs.writeFileSync(path.join(tempDir, ".hidden.jpg"), "hidden image");

  // First scan
  const res1 = scanLibrary(tempDir, repo);
  assert.equal(res1.indexedCount, 3);
  assert.equal(res1.skippedCount, 1);

  const { count, totalBytes } = repo.count();
  assert.equal(count, 3);
  assert.ok(totalBytes > 0);

  // Second scan should be idempotent
  const res2 = scanLibrary(tempDir, repo);
  assert.equal(res2.indexedCount, 3); // upserted, no duplicates
  const { count: count2 } = repo.count();
  assert.equal(count2, 3);

  db.close();
  fs.rmSync(tempDir, { recursive: true });
});

test("Server status reflects indexed media", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-test-server-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  fs.writeFileSync(path.join(tempDir, "sample.jpg"), "sample data");

  const app = buildServer({ dbPath, libraryRoot: tempDir });
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/status",
  });

  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.library.mediaCount, 1);
  assert.ok(data.library.storageBytes > 0);

  (app as any).db.close();
  fs.rmSync(tempDir, { recursive: true });
});
