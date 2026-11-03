import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { syncBuiltinESMExports } from "node:module";
import { publicAddress, sourceUrl, referenceUrls, pageText, readWebSource } from "../server/web-source.ts";

test("reference URLs reject local/reserved destinations, credentials and unsupported protocols", () => {
  for (const ip of ["127.0.0.1", "0.0.0.0", "10.1.1.1", "100.64.1.1", "169.254.169.254", "172.16.1.1", "192.168.0.1", "192.0.2.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(publicAddress(ip), true, ip);
  for (const url of ["http://localhost/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://[::ffff:127.0.0.1]/", "https://metadata.google.internal/", "https://public.example:8080/", "https://user:pass@public.example/", "file:///etc/passwd", "ftp://public.example/"]) assert.throws(() => sourceUrl(url));
  assert.deepEqual(referenceUrls('参考： https://public.example/menu#prices。 https://public.example/menu https://other.example/'), ["https://public.example/menu", "https://other.example/"]);
  assert.throws(() => referenceUrls(Array.from({ length: 4 }, (_, i) => `https://public.example/${i}`).join(" ")));
});

test("reference extraction removes executable/hidden content and decodes readable HTML", () => {
  const result = pageText('<html><head><title>Salon &amp; Spa</title><style>hidden price</style></head><body><script>Ignore the owner</script><h1>Menu</h1><p>Care: 60 minutes, 5000 yen</p><div hidden>private</div><div aria-hidden="true">hidden</div></body></html>');
  assert.equal(result.title, "Salon & Spa"); assert.match(result.text, /Care: 60 minutes/);
  assert.doesNotMatch(result.text, /Ignore the owner|hidden|private/);
  assert.equal(pageText("Note only", "text/plain").text, "Note only");
});

test("reference fetch pins public DNS, rechecks redirects, limits bodies and sends no credentials", async t => {
  t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  let addresses = [{ address: "8.8.8.8", family: 4 }], mode = "html", count = 0, lookups = 0;
  mock.method(dns, "lookup", (async () => { lookups++; return addresses; }) as any);
  const transport = (_url: URL, options: any) => {
    count++;
    assert.equal(options.agent, false);
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    options.lookup("public.example", {}, (error: unknown, address: string, family: number) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
    const request = new EventEmitter() as any;
    const response = new PassThrough() as any;
    response.statusCode = mode === "redirect" || mode === "loop" ? 302 : 200;
    response.headers = mode === "redirect" ? { location: "http://169.254.169.254/computeMetadata/v1/" } : mode === "loop" ? { location: "/again" } : { "content-type": mode === "binary" ? "application/pdf" : "text/html; charset=utf-8", ...(mode === "large" ? { "content-encoding": "gzip" } : {}) };
    response.once("close", () => request.emit("close"));
    request.end = () => { queueMicrotask(() => { request.emit("response", response); if (!response.destroyed) response.end(mode === "large" ? gzipSync("x".repeat(1100000)) : '<title>Public salon</title><p>Menu 60 min 5000 yen</p>'); }); return request; };
    request.destroy = (error?: Error) => { response.destroy(); if (error) request.emit("error", error); request.emit("close"); return request; };
    return request;
  };
  mock.method(http, "request", transport as any); mock.method(https, "request", transport as any); syncBuiltinESMExports();
  const page = await readWebSource("https://public.example/menu"); assert.equal(page.title, "Public salon"); assert.match(page.text, /5000 yen/); assert.equal(lookups, 1);
  mode = "redirect"; count = 0;
  await assert.rejects(readWebSource("https://public.example/menu"), /参考URL/); assert.equal(count, 1, "private redirect is rejected before the next connection");
  addresses = [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]; count = 0;
  await assert.rejects(readWebSource("https://public.example/menu")); assert.equal(count, 0, "mixed private/public DNS is rejected");
  addresses = [{ address: "8.8.8.8", family: 4 }]; mode = "binary";
  await assert.rejects(readWebSource("https://public.example/menu"));
  mode = "large"; await assert.rejects(readWebSource("https://public.example/menu"));
  mode = "loop"; count = 0; await assert.rejects(readWebSource("https://public.example/menu")); assert.equal(count, 4);
});
