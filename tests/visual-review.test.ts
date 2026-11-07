import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReviewedVisual, reviewRenderedVisual } from "../server/visual-review.ts";
import { createInitialTheme } from "../server/initial-theme.ts";
import { sample } from "../server/domain.ts";

test("visual review receives the rendered before/after pixels at both widths and uses the review model", async () => {
  const after = { ...structuredClone(sample), description: "The requested text" };
  const captured: string[] = [];
  const review = await reviewRenderedVisual({ before: sample, after, instruction: "Change the description", screen: "reserve", target: "description", images: [], renderImages: {}, messages: [{ role: "user", text: "Keep the colors" }] }, {
    capture: async input => {
      captured.push(input.config.description);
      assert.equal(input.screen, "reserve");
      return [1280, 390].map(width => ({ width, height: 1000, mimeType: "image/jpeg" as const, data: Buffer.from(`${input.config.description}:${width}`).toString("base64"), unavailableImages: [] }));
    },
    model: async input => {
      assert.equal(input.purpose, "review");
      const parts = input.contents[0].parts!;
      const images = parts.flatMap(part => part.inlineData ? [part.inlineData] : []);
      assert.equal(images.length, 4);
      assert.match(Buffer.from(images[2].data!, "base64").toString(), /The requested text:1280/);
      assert.match(Buffer.from(images[3].data!, "base64").toString(), /The requested text:390/);
      assert.match(parts[0].text!, /Keep the colors/);
      return JSON.stringify({ approved: true, issues: ["The mobile heading is clipped"] });
    },
  });
  assert.deepEqual(captured, [sample.description, after.description]);
  assert.equal(review.approved, false, "issues cannot be overridden by an approval flag");
});

test("rendered review repairs from the previous candidate and stops after two repairs", async () => {
  let generations = 0;
  const result = await generateReviewedVisual(async (feedback, previous) => {
    generations++;
    if (generations === 2) { assert.deepEqual(feedback, ["Unclip the heading"]); assert.equal(previous?.config.description, "clipped"); }
    return { config: { ...structuredClone(sample), description: feedback.length ? "fixed" : "clipped" } };
  }, async proposal => ({ approved: proposal.config.description === "fixed", issues: proposal.config.description === "fixed" ? [] : ["Unclip the heading"] }));
  assert.equal(result.config.description, "fixed");
  assert.deepEqual(result.visualReview, { approved: true, attempts: 2 });
  let rejected = 0;
  await assert.rejects(generateReviewedVisual(async () => { rejected++; return { config: sample }; }, async () => ({ approved: false, issues: ["Still clipped"] })), { status: 422 });
  assert.equal(rejected, 3);
});

test("initial theme corrections require rendered approval, use feedback to repair, and resume a failed capture", async () => {
  const theme = { headerHtml: '<header><slot name="title"></slot><slot name="navigation"></slot></header>', bodyHtml: '<main><slot name="content"></slot></main>', footerHtml: '<footer><slot name="content"></slot></footer>', css: 'header{padding:24px}' };
  const input = { config: structuredClone(sample), request: "Increase heading spacing", images: [] };
  let generated = 0, reviews = 0;
  const result = await createInitialTheme(input, { reviewRendered: async config => {
    reviews++; assert.equal(config.name, sample.name);
    return { approved: reviews > 1, issues: reviews > 1 ? [] : ["The mobile title is clipped"] };
  } }, async request => {
    if (request.purpose) return JSON.stringify({ approved: true, issues: [], imageUsage: [] });
    generated++; if (generated > 1) assert.match(JSON.stringify(request.contents), /mobile title is clipped/);
    return JSON.stringify(theme);
  });
  assert.equal(result.renderedReview?.approved, true); assert.equal(generated, 2); assert.equal(reviews, 2);
  let saved: typeof result | undefined;
  generated = 0;
  const model = async (request: { purpose?: "review" }) => { if (!request.purpose) generated++; return JSON.stringify(request.purpose ? { approved: true, issues: [], imageUsage: [] } : theme); };
  await assert.rejects(createInitialTheme(input, { save: async state => { saved = state; }, reviewRendered: async () => { throw new Error("capture failed"); } }, model), /capture failed/);
  const resumed = await createInitialTheme(input, { state: saved, reviewRendered: async () => ({ approved: true, issues: [] }) }, model);
  assert.equal(resumed.renderedReview?.approved, true); assert.equal(generated, 1, "a capture retry does not regenerate the saved candidate");
});
