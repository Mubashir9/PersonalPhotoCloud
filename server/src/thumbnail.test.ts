import test from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyLimiter, videoThumbnailLimiter } from "./thumbnail.js";

test("ConcurrencyLimiter limits concurrent async operations to specified limit", async () => {
  const limiter = new ConcurrencyLimiter(2);
  let active = 0;
  let maxObservedActive = 0;

  const tasks = Array.from({ length: 6 }).map((_, i) =>
    limiter.run(async () => {
      active++;
      maxObservedActive = Math.max(maxObservedActive, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--;
      return i;
    })
  );

  const results = await Promise.all(tasks);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.ok(
    maxObservedActive <= 2,
    `Expected max active to be <= 2, observed ${maxObservedActive}`
  );
  assert.equal(limiter.activeCount, 0);
  assert.equal(limiter.pendingCount, 0);
});

test("videoThumbnailLimiter is configured with a concurrency limit of 2", () => {
  assert.equal(videoThumbnailLimiter.limit, 2);
  assert.equal(typeof videoThumbnailLimiter.run, "function");
});

