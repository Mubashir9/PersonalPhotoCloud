import test from "node:test";
import assert from "node:assert/strict";
import { HealthResponseSchema } from "./index.js";

test("HealthResponseSchema validates successfully", () => {
  const result = HealthResponseSchema.safeParse({
    status: "ok",
    serverVersion: "0.1.0"
  });
  assert.equal(result.success, true);
});

