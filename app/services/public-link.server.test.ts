import assert from "node:assert/strict";
import test from "node:test";
import {
  isActivePublicExtension,
  publicFilePath,
  signPublicFileId,
  verifyPublicFileSignature,
} from "./public-link.server.ts";

test("a signature verifies only for the file it was minted for", () => {
  const sig = signPublicFileId("file-abc");
  assert.equal(verifyPublicFileSignature("file-abc", sig), true);
  assert.equal(verifyPublicFileSignature("file-xyz", sig), false);
});

test("missing or tampered signatures are refused", () => {
  const sig = signPublicFileId("file-abc");
  assert.equal(verifyPublicFileSignature("file-abc", null), false);
  assert.equal(verifyPublicFileSignature("file-abc", ""), false);
  assert.equal(verifyPublicFileSignature("file-abc", sig.slice(0, -1) + "0"), false);
  assert.equal(verifyPublicFileSignature("file-abc", sig + "a"), false);
});

test("script-capable extensions are the ones that require a signature", () => {
  for (const name of ["page.html", "index.htm", "app.js", "mod.mjs", "logo.svg", "PAGE.HTML"]) {
    assert.equal(isActivePublicExtension(name), true, name);
  }
  for (const name of ["photo.png", "doc.pdf", "notes.md", "data.json", "style.css"]) {
    assert.equal(isActivePublicExtension(name), false, name);
  }
});

test("publicFilePath emits a signed, basename-only link", () => {
  const path = publicFilePath("file-abc", "notes/日報 2026.md");
  assert.ok(path.startsWith("/public/file/file-abc/"));
  assert.ok(!path.includes("notes/"));
  const sig = new URL(path, "https://example.test").searchParams.get("s");
  assert.equal(verifyPublicFileSignature("file-abc", sig), true);
});

// The route refuses unsigned script-capable content before touching the
// network, so this branch is exercised without a Drive round trip.
test("the public route refuses unsigned script-capable requests", async () => {
  const { loader } = await import("../routes/public.file.$fileId.$fileName.tsx");
  const call = (fileName: string, search = "") =>
    loader({
      params: { fileId: "file-abc", fileName },
      request: new Request(`https://app.test/public/file/file-abc/${fileName}${search}`),
    } as unknown as Parameters<typeof loader>[0]);

  const refused = await call("evil.html");
  assert.equal(refused.status, 403);

  const refusedSvg = await call("evil.svg", "?s=not-a-signature");
  assert.equal(refusedSvg.status, 403);
});
