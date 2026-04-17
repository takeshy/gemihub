import assert from "node:assert/strict";
import test from "node:test";
import { provisionHubworkSkillFiles } from "./hubwork-skill-provisioner-core.ts";
import { pickOldestSpreadsheet } from "./hubwork-skill-provisioner-core.ts";

test("provisionHubworkSkillFiles with force overwrites existing skill files", async () => {
  const originalFetch = globalThis.fetch;
  const rootFolderId = "root-1";
  const syncMetaId = "sync-meta-id";
  const skillFiles = new Map<string, { id: string; mimeType: string; content: string }>([
    ["skills/webpage-builder/SKILL.md", { id: "skill-1", mimeType: "text/markdown", content: "old-skill" }],
    ["skills/webpage-builder/references/api-reference.md", { id: "skill-2", mimeType: "text/markdown", content: "old-api" }],
    ["skills/webpage-builder/references/page-patterns.md", { id: "skill-3", mimeType: "text/markdown", content: "old-patterns" }],
    ["skills/webpage-builder/workflows/save-page.yaml", { id: "skill-4", mimeType: "text/plain", content: "old-page" }],
    ["skills/webpage-builder/workflows/save-api.yaml", { id: "skill-5", mimeType: "text/plain", content: "old-api-workflow" }],
  ]);
  let syncMetaContent = "";
  const patchIds: string[] = [];

  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const href = String(url);

    if (href.startsWith("https://www.googleapis.com/drive/v3/files?q=") && method === "GET") {
      const parsed = new URL(href);
      const query = decodeURIComponent(parsed.searchParams.get("q") ?? "");
      const nameMatch = query.match(/name='([^']+)'/);
      const name = nameMatch?.[1]?.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (name === "_sync-meta.json") {
        return Response.json(syncMetaContent ? { files: [{ id: syncMetaId, name, mimeType: "application/json", modifiedTime: "2026-03-29T00:00:00.000Z", md5Checksum: "meta-md5" }] } : { files: [] });
      }
      if (name && skillFiles.has(name)) {
        const file = skillFiles.get(name)!;
        return Response.json({ files: [{ id: file.id, name, mimeType: file.mimeType, modifiedTime: "2026-03-29T00:00:00.000Z", md5Checksum: `${file.id}-md5` }] });
      }
      return Response.json({ files: [] });
    }

    if (href === `https://www.googleapis.com/drive/v3/files/${syncMetaId}?alt=media` && method === "GET") {
      return new Response(syncMetaContent, { status: 200 });
    }

    if (href.startsWith("https://www.googleapis.com/upload/drive/v3/files/") && method === "PATCH") {
      const fileId = href.match(/files\/([^?]+)/)?.[1];
      const body = String(options.body ?? "");
      patchIds.push(fileId ?? "");
      if (fileId === syncMetaId) {
        syncMetaContent = body;
        return Response.json({ id: syncMetaId, name: "_sync-meta.json", mimeType: "application/json", modifiedTime: "2026-03-29T00:00:01.000Z", md5Checksum: "meta-md5" });
      }
      const entry = [...skillFiles.entries()].find(([, file]) => file.id === fileId);
      assert.ok(entry, `unexpected file patch for ${fileId}`);
      const [name, file] = entry;
      file.content = body;
      return Response.json({ id: file.id, name, mimeType: file.mimeType, modifiedTime: "2026-03-29T00:00:01.000Z", md5Checksum: `${file.id}-md5-next` });
    }

    if (href.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart") && method === "POST") {
      const body = String(options.body ?? "");
      assert.match(body, /"_sync-meta\.json"|_sync-meta\.json/);
      syncMetaContent = body.includes("\r\n\r\n{\n")
        ? body.slice(body.indexOf("\r\n\r\n{\n") + 4, body.lastIndexOf("\r\n--"))
        : body;
      return Response.json({ id: syncMetaId, name: "_sync-meta.json", mimeType: "application/json", modifiedTime: "2026-03-29T00:00:00.000Z", md5Checksum: "meta-md5" });
    }

    throw new Error(`Unhandled fetch: ${method} ${href}`);
  };

  try {
    const result = await provisionHubworkSkillFiles("token", rootFolderId, [
      { path: "skills/webpage-builder/SKILL.md", content: "# new skill", mimeType: "text/markdown" },
      { path: "skills/webpage-builder/references/api-reference.md", content: "# api", mimeType: "text/markdown" },
      { path: "skills/webpage-builder/references/page-patterns.md", content: "# patterns", mimeType: "text/markdown" },
      { path: "skills/webpage-builder/workflows/save-page.yaml", content: "name: save-page", mimeType: "text/plain" },
      { path: "skills/webpage-builder/workflows/save-api.yaml", content: "name: save-api", mimeType: "text/plain" },
    ], true);
    const { files, isFirstProvision } = result;

    assert.equal(isFirstProvision, false);
    assert.equal(files.length, 5);
    assert.deepEqual(
      patchIds.filter((id) => id !== syncMetaId).sort(),
      ["skill-1", "skill-2", "skill-3", "skill-4", "skill-5"],
    );
    assert.match(syncMetaContent, /skills\/webpage-builder\/SKILL\.md/);
    assert.equal(skillFiles.get("skills/webpage-builder/SKILL.md")?.content, files[0]?.content);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provisionHubworkSkillFiles consolidates duplicate skill files on access", async () => {
  const originalFetch = globalThis.fetch;
  const rootFolderId = "root-1";
  const syncMetaId = "sync-meta-id";
  // Each skill file has two copies in Drive (race from concurrent first-provision calls).
  // The newer modifiedTime should win, the older should be deleted.
  const skillFileDuplicates = new Map<string, Array<{ id: string; mimeType: string; modifiedTime: string; md5Checksum: string }>>([
    ["skills/webpage-builder/SKILL.md", [
      { id: "skill-1-old", mimeType: "text/markdown", modifiedTime: "2026-04-17T08:00:00.000Z", md5Checksum: "old-1" },
      { id: "skill-1-new", mimeType: "text/markdown", modifiedTime: "2026-04-17T08:00:01.000Z", md5Checksum: "new-1" },
    ]],
    ["skills/webpage-builder/references/api-reference.md", [
      { id: "skill-2-old", mimeType: "text/markdown", modifiedTime: "2026-04-17T08:00:00.000Z", md5Checksum: "old-2" },
      { id: "skill-2-new", mimeType: "text/markdown", modifiedTime: "2026-04-17T08:00:01.000Z", md5Checksum: "new-2" },
    ]],
  ]);
  // Meta starts containing both duplicates for every file — this mirrors what happens
  // when two provision calls race: both write every id they created back into meta.
  const initialMetaFiles: Record<string, { name: string; mimeType: string; md5Checksum: string; modifiedTime: string }> = {};
  for (const [name, copies] of skillFileDuplicates) {
    for (const copy of copies) {
      initialMetaFiles[copy.id] = { name, mimeType: copy.mimeType, md5Checksum: copy.md5Checksum, modifiedTime: copy.modifiedTime };
    }
  }
  let syncMetaContent = JSON.stringify({ lastUpdatedAt: "2026-04-17T08:00:01.000Z", files: initialMetaFiles }, null, 2);
  const deletedIds: string[] = [];

  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const href = String(url);

    if (href.startsWith("https://www.googleapis.com/drive/v3/files?q=") && method === "GET") {
      const parsed = new URL(href);
      const query = decodeURIComponent(parsed.searchParams.get("q") ?? "");
      const nameMatch = query.match(/name='([^']+)'/);
      const name = nameMatch?.[1]?.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (name === "_sync-meta.json") {
        return Response.json({ files: [{ id: syncMetaId, name, mimeType: "application/json", modifiedTime: "2026-04-17T08:00:01.000Z", md5Checksum: "meta-md5" }] });
      }
      if (name && skillFileDuplicates.has(name)) {
        const copies = skillFileDuplicates.get(name)!;
        return Response.json({ files: copies.map((c) => ({ id: c.id, name, mimeType: c.mimeType, modifiedTime: c.modifiedTime, md5Checksum: c.md5Checksum })) });
      }
      return Response.json({ files: [] });
    }

    if (href === `https://www.googleapis.com/drive/v3/files/${syncMetaId}?alt=media` && method === "GET") {
      return new Response(syncMetaContent, { status: 200 });
    }

    const readMatch = href.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media$/);
    if (readMatch && method === "GET") {
      return new Response(`content-of-${readMatch[1]}`, { status: 200 });
    }

    if (href.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)$/) && method === "DELETE") {
      const fileId = href.match(/files\/([^?]+)/)?.[1];
      deletedIds.push(fileId ?? "");
      // Reflect deletion in the backing store so subsequent lists don't re-return it.
      for (const [name, copies] of skillFileDuplicates) {
        skillFileDuplicates.set(name, copies.filter((c) => c.id !== fileId));
      }
      return new Response("", { status: 200 });
    }

    if (href.startsWith("https://www.googleapis.com/upload/drive/v3/files/") && method === "PATCH") {
      const fileId = href.match(/files\/([^?]+)/)?.[1];
      const body = String(options.body ?? "");
      if (fileId === syncMetaId) {
        syncMetaContent = body;
      }
      return Response.json({ id: fileId, name: "_sync-meta.json", mimeType: "application/json", modifiedTime: "2026-04-17T08:00:02.000Z", md5Checksum: "meta-md5-next" });
    }

    if (href.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart") && method === "POST") {
      return Response.json({ id: syncMetaId, name: "_sync-meta.json", mimeType: "application/json", modifiedTime: "2026-04-17T08:00:02.000Z", md5Checksum: "meta-md5" });
    }

    throw new Error(`Unhandled fetch: ${method} ${href}`);
  };

  try {
    const result = await provisionHubworkSkillFiles("token", rootFolderId, [
      { path: "skills/webpage-builder/SKILL.md", content: "# skill", mimeType: "text/markdown" },
      { path: "skills/webpage-builder/references/api-reference.md", content: "# api", mimeType: "text/markdown" },
    ], false);

    assert.equal(result.files.length, 2);
    // Keeps only the newer copy for each file path
    assert.equal(result.files[0]?.id, "skill-1-new");
    assert.equal(result.files[1]?.id, "skill-2-new");
    // Older duplicates permanently deleted
    assert.deepEqual(deletedIds.sort(), ["skill-1-old", "skill-2-old"]);
    // Meta no longer references the deleted ids
    const finalMeta = JSON.parse(syncMetaContent) as { files: Record<string, unknown> };
    assert.equal(finalMeta.files["skill-1-old"], undefined);
    assert.equal(finalMeta.files["skill-2-old"], undefined);
    assert.ok(finalMeta.files["skill-1-new"]);
    assert.ok(finalMeta.files["skill-2-new"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pickOldestSpreadsheet keeps the earliest createdTime and breaks ties by id", () => {
  const a = { id: "id-b", name: "webpage_builder", mimeType: "x", createdTime: "2026-04-17T08:00:00.000Z" };
  const b = { id: "id-c", name: "webpage_builder", mimeType: "x", createdTime: "2026-04-17T08:00:01.000Z" };
  const c = { id: "id-a", name: "webpage_builder", mimeType: "x", createdTime: "2026-04-17T08:00:00.000Z" };
  const { keep, discard } = pickOldestSpreadsheet([a, b, c]);
  // Tie between a and c on createdTime: id-a wins by lexicographic id order.
  assert.equal(keep.id, "id-a");
  assert.deepEqual(discard.map((d) => d.id).sort(), ["id-b", "id-c"]);
});

test("pickOldestSpreadsheet returns the sole file untouched", () => {
  const a = { id: "only", name: "webpage_builder", mimeType: "x", createdTime: "2026-04-17T08:00:00.000Z" };
  const { keep, discard } = pickOldestSpreadsheet([a]);
  assert.equal(keep.id, "only");
  assert.equal(discard.length, 0);
});

