import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildServer } from "./index.js";
import { MediaRepository } from "./mediaRepository.js";

function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-cloud-album-test-"));
  const dbPath = path.join(tmpDir, "test.sqlite");
  return { tmpDir, dbPath };
}

test("GET /api/v1/albums returns default albums", async () => {
  const { tmpDir, dbPath } = setupTestEnv();
  const app = buildServer({ dbPath, libraryRoot: tmpDir });

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/albums",
  });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.ok(Array.isArray(json.albums));
  assert.ok(json.albums.length >= 4);

  const albumNames = json.albums.map((a: any) => a.name);
  assert.ok(albumNames.includes("All Videos"));
  assert.ok(albumNames.includes("Phone Backups"));
  assert.ok(albumNames.includes("Direct Imports"));
  assert.ok(albumNames.includes("Favorites"));

  (app as any).db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Album lifecycle: create manual album, add items, retrieve media, remove item, and non-destructive delete", async () => {
  const { tmpDir, dbPath } = setupTestEnv();
  const app = buildServer({ dbPath, libraryRoot: tmpDir });
  const db = (app as any).db;
  const mediaRepo = new MediaRepository(db);

  // Seed sample media items
  mediaRepo.upsert({
    id: "media-1",
    originalFilename: "photo1.jpg",
    storedFilename: "photo1.jpg",
    relativePath: "photo1.jpg",
    mediaType: "photo",
    mimeType: "image/jpeg",
    byteSize: 1024,
    createdAt: "2026-10-01T12:00:00Z",
    importedAt: "2026-10-01T12:00:00Z",
  });

  mediaRepo.upsert({
    id: "media-2",
    originalFilename: "photo2.jpg",
    storedFilename: "photo2.jpg",
    relativePath: "photo2.jpg",
    mediaType: "photo",
    mimeType: "image/jpeg",
    byteSize: 2048,
    createdAt: "2026-10-02T12:00:00Z",
    importedAt: "2026-10-02T12:00:00Z",
  });

  // 1. Create a new manual album
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/albums",
    payload: {
      name: "Trip to Tokyo",
      description: "Memories from Japan",
      mediaIds: ["media-1"],
    },
  });

  assert.equal(createRes.statusCode, 201);
  const createdAlbum = createRes.json();
  assert.equal(createdAlbum.name, "Trip to Tokyo");
  assert.equal(createdAlbum.type, "manual");
  assert.equal(createdAlbum.itemCount, 1);
  const albumId = createdAlbum.id;

  // 2. Add another item
  const addRes = await app.inject({
    method: "POST",
    url: `/api/v1/albums/${albumId}/items`,
    payload: {
      mediaIds: ["media-2"],
    },
  });
  assert.equal(addRes.statusCode, 200);
  assert.equal(addRes.json().addedCount, 1);

  // 3. Get album media
  const mediaRes = await app.inject({
    method: "GET",
    url: `/api/v1/albums/${albumId}/media`,
  });
  assert.equal(mediaRes.statusCode, 200);
  const mediaJson = mediaRes.json();
  assert.equal(mediaJson.items.length, 2);

  // 4. Remove one item from album
  const removeRes = await app.inject({
    method: "DELETE",
    url: `/api/v1/albums/${albumId}/items/media-1`,
  });
  assert.equal(removeRes.statusCode, 200);

  // Verify item is removed from album
  const mediaAfterRemove = await app.inject({
    method: "GET",
    url: `/api/v1/albums/${albumId}/media`,
  });
  assert.equal(mediaAfterRemove.json().items.length, 1);
  assert.equal(mediaAfterRemove.json().items[0].id, "media-2");

  // Verify media-1 still exists in the library! (Non-destructive)
  const libRes = await app.inject({
    method: "GET",
    url: `/api/v1/media/media-1`,
  });
  assert.equal(libRes.statusCode, 200);

  // 5. Delete album
  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/v1/albums/${albumId}`,
  });
  assert.equal(deleteRes.statusCode, 200);

  // Verify album is deleted
  const getDeletedAlbum = await app.inject({
    method: "GET",
    url: `/api/v1/albums/${albumId}`,
  });
  assert.equal(getDeletedAlbum.statusCode, 404);

  // Verify media-2 still exists in the library!
  const libRes2 = await app.inject({
    method: "GET",
    url: `/api/v1/media/media-2`,
  });
  assert.equal(libRes2.statusCode, 200);

  // 6. Verify default album cannot be deleted
  const deleteDefaultRes = await app.inject({
    method: "DELETE",
    url: "/api/v1/albums/smart-videos",
  });
  assert.equal(deleteDefaultRes.statusCode, 400);

  (app as any).db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
