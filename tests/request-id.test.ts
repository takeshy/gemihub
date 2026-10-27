import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestId } from "../src/request-id.ts";

test("booking request IDs remain valid UUID v4 values without secure-context randomUUID", () => {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    const ids = new Set(Array.from({ length: 20 }, () => createRequestId()));
    assert.equal(ids.size, 20);
    for (const id of ids)
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  } finally {
    if (previous)
      Object.defineProperty(globalThis.crypto, "randomUUID", previous);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});
