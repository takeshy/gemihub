import assert from "node:assert/strict";
import test from "node:test";
import { extractAllowedSlugHost } from "./hubwork-account-resolver.server.ts";

test("extractAllowedSlugHost only accepts *.gemihub.online and *.localhost", () => {
  assert.equal(extractAllowedSlugHost("acme.gemihub.online"), "acme");
  assert.equal(extractAllowedSlugHost("acme.localhost"), "acme");

  assert.equal(extractAllowedSlugHost("gemihub.online"), null);
  assert.equal(extractAllowedSlugHost("www.gemihub.online"), "www");
  assert.equal(extractAllowedSlugHost("localhost"), null);
  assert.equal(extractAllowedSlugHost("acme.example.com"), null);
});
