import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { oauth } from "../server/google.ts";
import { origin } from "../server/auth.ts";
import { productionOrigin, productionSiteDomain, serviceTitles } from "../shared/brand.ts";
import { localizeShell } from "../shared/html.ts";
import { requestLocale } from "../server/i18n.ts";

test("production configuration sends every Google OAuth scope to the registered gemihub.net callback", () => {
  const configured = parseEnv(readFileSync(".env.production.example", "utf8"));
  const previous = { origin: process.env.APP_ORIGIN, client: process.env.GOOGLE_CLIENT_ID };
  try {
    assert.equal(configured.APP_ORIGIN, productionOrigin);
    assert.equal(configured.SITE_DOMAIN, productionSiteDomain);
    assert.equal(configured.DEMO_MODE, "false");
    assert.equal(configured.FIRESTORE_DATABASE_ID, "gemihub");
    process.env.GOOGLE_CLIENT_ID = "configured-client.apps.googleusercontent.com";
    for (const value of [configured.APP_ORIGIN, configured.APP_ORIGIN + "/"]) {
      process.env.APP_ORIGIN = value;
      assert.equal(origin(), "https://gemihub.net");
      for (const scope of ["openid email profile", "openid email profile https://www.googleapis.com/auth/drive.file", "openid email profile https://www.googleapis.com/auth/calendar.freebusy"]) {
        const url = new URL(oauth().generateAuthUrl({ scope: scope.split(" ") }));
        assert.equal(url.searchParams.get("redirect_uri"), "https://gemihub.net/auth/google/callback");
        assert.equal(url.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);
      }
    }
  } finally {
    for (const [key, value] of [["APP_ORIGIN", previous.origin], ["GOOGLE_CLIENT_ID", previous.client]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("localized service titles preserve shop content and use gemihub language metadata", () => {
  const shell = `<html lang="ja"><head><title>${serviceTitles.ja}</title><meta name="gemihub-language" content="ja"></head><body><p>${serviceTitles.ja}</p></body></html>`;
  const english = requestLocale.run("en", () => localizeShell(shell));
  assert.ok(english.includes(`<title>${serviceTitles.en}</title>`));
  assert.ok(english.includes(`<p>${serviceTitles.ja}</p>`));
  assert.equal(english.match(/name="gemihub-language"/g)?.length, 1);
  assert.equal(requestLocale.run("ja", () => localizeShell(english)), requestLocale.run("ja", () => localizeShell(shell)));
});
