import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUploadFormData,
  getUploadFileName,
  uploadFileDirectToDrive,
  type UploadFile,
} from "./useFileUpload";
import { parallelProcess } from "~/utils/parallel";

test("parallel upload forms keep each client path paired with its own content", async () => {
  const specs = [
    { path: "docs/first.txt", content: "first-content", delay: 20 },
    { path: "docs/second.txt", content: "second-content", delay: 0 },
    { path: "images/third.txt", content: "third-content", delay: 10 },
  ];
  const files = specs.map(({ path, content }) => {
    const file = new File([content], path.split("/").pop()!, { type: "text/plain" }) as UploadFile;
    file.relativePathForUpload = path;
    return file;
  });

  const results = await parallelProcess(files, async (file) => {
    const clientName = getUploadFileName(file);
    const spec = specs.find(({ path }) => path === clientName)!;
    await new Promise((resolve) => setTimeout(resolve, spec.delay));
    const formData = buildUploadFormData(file, {
      folderId: "root",
      clientName,
      deferMeta: true,
    });
    const uploadedFile = formData.get("file");
    assert.ok(uploadedFile instanceof File);
    return {
      clientPath: formData.get("clientPath"),
      content: await uploadedFile.text(),
      deferMeta: formData.get("deferMeta"),
    };
  }, 3);

  assert.deepEqual(results, specs.map(({ path, content }) => ({
    clientPath: path,
    content,
    deferMeta: "true",
  })));
});

test("direct upload sends only session metadata through the app and file bytes to Drive", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ input: url, init });
    if (url === "/api/drive/upload-resumable") {
      return Response.json({ uploadUrl: "https://drive.example/upload/session" });
    }
    return Response.json({
      id: "drive-id",
      name: "book.epub",
      mimeType: "application/epub+zip",
      md5Checksum: "checksum",
    });
  };

  try {
    const file = new File(["epub-content"], "book.epub", { type: "application/epub+zip" });
    const uploaded = await uploadFileDirectToDrive(file, {
      folderId: "root",
      clientName: "books/book.epub",
    });

    assert.equal(uploaded.id, "drive-id");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].input, "/api/drive/upload-resumable");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      intent: "create-session",
      folderId: "root",
      clientPath: "books/book.epub",
      fileName: "book.epub",
      mimeType: "application/epub+zip",
      size: file.size,
    });
    assert.equal(calls[1].input, "https://drive.example/upload/session");
    assert.equal(calls[1].init?.method, "PUT");
    assert.equal(calls[1].init?.body, file);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
