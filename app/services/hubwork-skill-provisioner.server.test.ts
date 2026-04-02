import assert from "node:assert/strict";
import test from "node:test";
import { provisionHubworkSkillFiles } from "./hubwork-skill-provisioner-core.ts";

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
