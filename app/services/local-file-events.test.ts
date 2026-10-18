import assert from "node:assert/strict";
import test from "node:test";
import { subscribeLocalFileChanges } from "./local-file-events.ts";

test("a widget opened before startup finishes refreshes when the tree becomes available", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = new EventTarget();
  let files: string[] = [];
  let displayed = files;
  const unsubscribe = subscribeLocalFileChanges(events, () => { displayed = files; });
  t.after(unsubscribe);

  assert.deepEqual(displayed, []);
  files = ["Secrets/account.encrypted", "Dashboards/Timeline/Timeline/day.md"];
  events.dispatchEvent(new Event("tree-cached"));
  t.mock.timers.tick(250);
  assert.deepEqual(displayed, files);
});

test("sync and tree notifications coalesce, while later local edits still refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = new EventTarget();
  let refreshes = 0;
  const unsubscribe = subscribeLocalFileChanges(events, () => { refreshes++; });
  t.after(unsubscribe);

  events.dispatchEvent(new Event("sync-complete"));
  t.mock.timers.tick(100);
  events.dispatchEvent(new Event("files-pulled"));
  events.dispatchEvent(new Event("tree-meta-updated"));
  events.dispatchEvent(new Event("tree-cached"));
  t.mock.timers.tick(249);
  assert.equal(refreshes, 0);
  t.mock.timers.tick(1);
  assert.equal(refreshes, 1);

  events.dispatchEvent(new Event("file-modified"));
  t.mock.timers.tick(250);
  assert.equal(refreshes, 2);
});

test("closing a widget cancels queued refreshes and detaches listeners", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = new EventTarget();
  let refreshes = 0;
  const unsubscribe = subscribeLocalFileChanges(events, () => { refreshes++; });
  events.dispatchEvent(new Event("tree-cached"));
  unsubscribe();
  t.mock.timers.tick(250);
  events.dispatchEvent(new Event("sync-complete"));
  events.dispatchEvent(new Event("tree-cached"));
  t.mock.timers.tick(250);
  assert.equal(refreshes, 0);
});
