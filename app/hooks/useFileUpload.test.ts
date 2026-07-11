import assert from "node:assert/strict";
import test from "node:test";
import { buildUploadFormData, getUploadFileName, type UploadFile } from "./useFileUpload";
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
