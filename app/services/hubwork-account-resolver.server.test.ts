import assert from "node:assert/strict";
import test from "node:test";
import { extractAllowedSlugHost } from "./hubwork-account-resolver.server.ts";

test("extractAllowedSlugHost only accepts *.gemihub.net and *.localhost", () => {
  assert.equal(extractAllowedSlugHost("acme.gemihub.net"), "acme");
  assert.equal(extractAllowedSlugHost("acme.localhost"), "acme");

  assert.equal(extractAllowedSlugHost("gemihub.net"), null);
  assert.equal(extractAllowedSlugHost("www.gemihub.net"), "www");
  assert.equal(extractAllowedSlugHost("localhost"), null);
  assert.equal(extractAllowedSlugHost("acme.example.com"), null);
  // Legacy gemihub.online traffic is 301-redirected at the express layer
  // (server.js) before reaching the resolver, so it is intentionally rejected.
  assert.equal(extractAllowedSlugHost("acme.gemihub.online"), null);
});
