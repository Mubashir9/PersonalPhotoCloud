import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./index.js";

test("GET /api/v1/health returns 200 ok", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/health",
  });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.equal(json.status, "ok");
  assert.equal(json.serverVersion, "0.1.0");
});

test("GET /api/v1/status returns valid ServerStatus schema", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/status",
  });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.equal(typeof json.name, "string");
  assert.equal(json.online, true);
  assert.equal(typeof json.library.mediaCount, "number");
  assert.equal(typeof json.disk.freeBytes, "number");
});

test("GET /api/v1/media returns list of media items", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/media?limit=10",
  });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.ok(Array.isArray(json.items));
});

test("GET /api/v1/media/:id returns 404 for nonexistent id", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/media/non-existent-id",
  });

  assert.equal(res.statusCode, 404);
});

test("GET /api/v1/media/:id/thumbnail returns 404 for nonexistent id", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/media/non-existent-id/thumbnail",
  });

  assert.equal(res.statusCode, 404);
});

test("GET /api/v1/media/:id/original returns 404 for nonexistent id", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/media/non-existent-id/original",
  });

  assert.equal(res.statusCode, 404);
});

test("POST /api/v1/sync/plan calculates new vs existing items", async () => {
  const app = buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/sync/plan",
    payload: {
      items: [
        {
          sourceAssetId: "test-device-id-1",
          originalFilename: "new-photo.jpg",
          mediaType: "photo",
          mimeType: "image/jpeg",
          byteSize: 12345,
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.newItems.length, 1);
  assert.equal(data.alreadyPresentCount, 0);
  assert.equal(data.totalBytesToUpload, 12345);
});

test("Resumable upload session init and chunk tracking", async () => {
  const app = buildServer();
  const initRes = await app.inject({
    method: "POST",
    url: "/api/v1/uploads/init",
    payload: {
      originalFilename: "chunked-test.jpg",
      byteSize: 1000,
      totalChunks: 2,
      mimeType: "image/jpeg",
      createdAt: new Date().toISOString(),
    },
  });

  assert.equal(initRes.statusCode, 200);
  const initData = initRes.json();
  assert.ok(initData.uploadId);

  const statusRes = await app.inject({
    method: "GET",
    url: `/api/v1/uploads/${initData.uploadId}/status`,
  });

  assert.equal(statusRes.statusCode, 200);
  const statusData = statusRes.json();
  assert.equal(statusData.totalChunks, 2);
  assert.equal(statusData.isComplete, false);
});

test("GET /api/v1/media/:id/content supports HTTP Range requests for video streaming", async () => {
  const app = buildServer();
  const listRes = await app.inject({
    method: "GET",
    url: "/api/v1/media?limit=1",
  });
  const list = listRes.json();
  if (list.items && list.items.length > 0) {
    const item = list.items[0];

    // Range request for first 100 bytes
    const rangeRes = await app.inject({
      method: "GET",
      url: `/api/v1/media/${item.id}/content`,
      headers: {
        range: "bytes=0-99",
      },
    });

    assert.equal(rangeRes.statusCode, 206);
    assert.equal(rangeRes.headers["accept-ranges"], "bytes");
    const contentRange = rangeRes.headers["content-range"] as string;
    assert.ok(contentRange && contentRange.startsWith("bytes 0-99/"));
    assert.equal(rangeRes.headers["content-length"], "100");
  }
});

test("GET /pair returns HTML page with pairing QR code", async () => {
  const app = buildServer();
  const pairRes = await app.inject({
    method: "GET",
    url: "/pair",
  });

  assert.equal(pairRes.statusCode, 200);
  assert.ok(pairRes.headers["content-type"]?.includes("text/html"));
  assert.ok(pairRes.body.includes("data:image/png;base64,"));
  assert.ok(pairRes.body.includes("Pair iPhone"));
});


