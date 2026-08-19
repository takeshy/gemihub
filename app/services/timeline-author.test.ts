import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveTimelineAuthor,
  setActiveTimelineAuthor,
  timelineAuthorMetadata,
} from "./timeline-author";

test("timeline author metadata is single-line and omits empty values", () => {
  setActiveTimelineAuthor(" user-123\nextra ", " member@example.com ");
  try {
    assert.deepEqual(getActiveTimelineAuthor(), {
      id: "user-123 extra",
      email: "member@example.com",
    });
    assert.deepEqual(timelineAuthorMetadata(), [
      "author-id: user-123 extra",
      "author-email: member@example.com",
    ]);
  } finally {
    setActiveTimelineAuthor(null, null);
  }
});
