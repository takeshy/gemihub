import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { tr } from "../shared/i18n.ts";

export type WebSource = { url: string; title: string; text: string };
const byteLimit = 1024 * 1024;
const timeLimit = 10000;
const fail = () => Object.assign(new Error(tr("参考URLを取得できませんでした。ログイン不要の公開ページを指定するか、内容をメモとして貼り付けてください。")), { status: 400 });

/** Only globally routable addresses may be used, including after redirects. */
export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6) return false;
  const [a, b = "0"] = address.toLowerCase().split(":");
  const first = parseInt(a, 16), second = parseInt(b || "0", 16);
  return (first & 0xe000) === 0x2000 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002 && !(first === 0x3fff && second < 0x1000);
}

export function sourceUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw fail(); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.port && url.port !== (url.protocol === "https:" ? "443" : "80") ||
    host === "localhost" || /\.(?:localhost|local|internal)\.?$/.test(host) || isIP(host) && !publicAddress(host)) throw fail();
  url.hash = "";
  return url;
}

export function referenceUrls(note: string) {
  const found = note.match(/https?:\/\/[^\s<>"'「」『』、。]+/gi) || [];
  const urls = [...new Set(found.map(value => {
    let text = value.replace(/[.,;!?\]}）]+$/, "");
    while (text.endsWith(")") && (text.match(/\)/g)?.length || 0) > (text.match(/\(/g)?.length || 0)) text = text.slice(0, -1);
    return sourceUrl(text).href;
  }))];
  if (urls.length > 3) throw Object.assign(new Error(tr("参考URLは3件まで指定してください。")), { status: 400 });
  return urls;
}

export function pageText(html: string, type = "text/html"): { title: string; text: string } {
  if (!type.includes("html")) return { title: "", text: html.trim().slice(0, 30000) };
  const document = parse(html), stack: Html.ChildNode[] = [...document.childNodes].reverse();
  const chunks: string[] = []; let title = "", size = 0;
  while (stack.length && size < 60000) {
    const node = stack.pop()!;
    if (node.nodeName === "#text" && "value" in node) { chunks.push(node.value); size += node.value.length; continue; }
    if (!("tagName" in node)) continue;
    if (node.tagName === "title") title = node.childNodes.filter(n => "value" in n).map(n => (n as Html.TextNode).value).join("").trim().slice(0, 200);
    if (["script", "style", "noscript", "svg", "iframe", "canvas", "template"].includes(node.tagName) || node.attrs.some(attr => attr.name === "hidden" || attr.name === "aria-hidden" && attr.value === "true")) continue;
    chunks.push("\n");
    stack.push(...[...node.childNodes].reverse());
  }
  return { title, text: chunks.join(" ").replace(/[ \t\r]+/g, " ").replace(/\n\s*\n/g, "\n").trim().slice(0, 30000) };
}

async function publicTarget(url: URL, deadline: number) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { address: host, family: isIP(host) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fail()), Math.min(timeLimit, Math.max(1, deadline - Date.now()))); }),
    ]);
    if (!results.length || results.some(result => !publicAddress(result.address))) throw fail();
    return results.find(result => result.family === 4) || results[0];
  } finally { clearTimeout(timer); }
}

async function download(url: URL, deadline: number): Promise<{ redirect?: string; data?: Buffer; type?: string }> {
  const target = await publicTarget(url, deadline);
  if (Date.now() >= deadline) throw fail();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false, family: target.family, maxHeaderSize: 16384,
      // Pin the checked DNS result: the HTTP client must not resolve the host again.
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
      headers: { Accept: "text/html, text/plain;q=0.9", "Accept-Encoding": "identity", "User-Agent": "gemihub/1.0 (owner-provided reference page)" },
    });
    const timer = setTimeout(() => request.destroy(fail()), Math.min(timeLimit, deadline - Date.now()));
    request.once("error", reject);
    request.once("close", () => clearTimeout(timer));
    request.once("response", (response: IncomingMessage) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const redirect = response.headers.location; response.destroy();
        if (redirect) resolve({ redirect }); else reject(fail());
        return;
      }
      const type = String(response.headers["content-type"] || "").toLowerCase();
      if (status < 200 || status >= 300 || !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/.test(type) || Number(response.headers["content-length"]) > byteLimit) {
        response.destroy(); reject(fail()); return;
      }
      const encoding = response.headers["content-encoding"];
      const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : undefined;
      if (encoding && encoding !== "identity" && !decoder) { response.destroy(); reject(fail()); return; }
      let received = 0, expanded = 0;
      response.on("data", chunk => { received += chunk.length; if (received > byteLimit) request.destroy(fail()); });
      response.once("error", reject);
      const stream = decoder ? response.pipe(decoder) : response;
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        expanded += chunk.length;
        if (expanded > byteLimit) { request.destroy(fail()); stream.destroy(fail()); return; }
        chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve({ data: Buffer.concat(chunks), type }));
    });
    request.end();
  });
}

export async function readWebSource(input: string): Promise<WebSource> {
  try {
    let url = sourceUrl(input);
    const deadline = Date.now() + 15000;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const result = await download(url, deadline);
      if (result.redirect) { url = sourceUrl(new URL(result.redirect, url).href); continue; }
      const data = result.data!;
      const charset = result.type?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || data.subarray(0, 8192).toString("latin1").match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8";
      const parsed = pageText(new TextDecoder(charset).decode(data), result.type);
      if (!parsed.text) throw fail();
      return { url: url.href, title: parsed.title || url.hostname, text: parsed.text };
    }
    throw fail();
  } catch { throw fail(); }
}
