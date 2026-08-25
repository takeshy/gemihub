import assert from "node:assert/strict";
import test from "node:test";
import { hasPdfHeader } from "./media-utils.ts";

test("hasPdfHeader accepts a PDF signature near the beginning", () => {
  assert.equal(hasPdfHeader(new TextEncoder().encode("%PDF-1.7\n")), true);
  assert.equal(hasPdfHeader(new TextEncoder().encode("\n\u0000%PDF-2.0\n")), true);
});

test("hasPdfHeader rejects truncated or non-PDF cache content", () => {
  assert.equal(hasPdfHeader(new TextEncoder().encode("%PDF")), false);
  assert.equal(hasPdfHeader(new TextEncoder().encode("not a pdf")), false);
});
