/**
 * Self-registration pages (user enters their own email + profile fields and
 * submits to a `register` API) are UNAUTHENTICATED — the user isn't logged
 * in yet when they land on the page. But the same `web/__gemihub/auth/me.json`
 * mock serves both register pages and protected pages during preview. If
 * the mock is populated (for protected-page previews to work), the register
 * page sees a logged-in user and either redirects to /mypage or (in
 * miswritten templates) wraps itself in `gemihub.auth.require()` — the
 * result in both cases is a blank preview.
 *
 * Break the tie by detecting register-page previews from the HTML content
 * (any page that POSTs to a `register` API endpoint) and forcing
 * `gemihub.auth.me()` to resolve to null regardless of the mock file, so
 * the page always previews in its unauthenticated state. `require()` then
 * redirects (the page shouldn't use `require()` to begin with, but at
 * least the detection surfaces that bug visibly via the /login redirect).
 *
 * Filename-based detection would miss arbitrary names (the template does
 * not dictate `register.html`), so we key off the behaviour instead.
 *
 * Match convention: any `gemihub.post("register")` / `gemihub.post("register/...")`
 * call, quoted with either " or '. A trailing non-path-separator char (e.g.
 * `register-xyz`) is rejected so an unrelated endpoint that happens to start
 * with "register" doesn't trip the heuristic.
 */
const REGISTER_POST_PATTERN = /gemihub\.post\s*\(\s*['"]register[/'"]/;

export function isRegisterPreviewPage(htmlContent?: string): boolean {
  if (!htmlContent) return false;
  return REGISTER_POST_PATTERN.test(htmlContent);
}

/** Build an inline <script> that provides window.gemihub with mock data from IndexedDB cache. */
export function buildMockGemihubScript(
  mockData: Record<string, string>,
  htmlContent?: string,
): string {
  const escaped = JSON.stringify(mockData).replace(/</g, "\\u003c");
  const meImpl = isRegisterPreviewPage(htmlContent)
    ? "me:function(){return Promise.resolve(null);},"
    : "me:function(t){var f=_m['web/__gemihub/auth/me.json'];if(!f)return Promise.resolve(null);try{var d=JSON.parse(f);" +
      "if(!d||typeof d!=='object')return Promise.resolve(null);" +
      "if(d.accountType&&d.accountType!==t)return Promise.resolve(null);" +
      "var u={};for(var k in d)if(k!=='accountType')u[k]=d[k];u.type=t;return Promise.resolve(u);}catch(e){return Promise.resolve(null);}},";
  return [
    "<script>",
    "(function(){",
    "var _m=" + escaped + ";",
    "function _r(p,path,e){",
    "path=path.split('?')[0].split('#')[0];",
    "var x=_m[p+path+e];if(x)return JSON.parse(x);",
    "var i=path.lastIndexOf('/'),d=i>=0?path.slice(0,i):'',pr=d?d+'/':'';",
    "for(var k in _m){if(k.indexOf(p+pr)!==0)continue;",
    "var b=k.slice((p+pr).length);",
    "if(/^\\[[^\\]]+\\]\\.json$/.test(b)&&b.indexOf('/')<0)return JSON.parse(_m[k]);}",
    "return null;}",
    "window.gemihub={",
    "get:function(p){var d=_r('web/__gemihub/api/',p,'.json');if(d!==null)return Promise.resolve(d);return Promise.reject(Object.assign(new Error('Not found'),{status:404}));},",
    "post:function(p){var d=_r('web/__gemihub/api/',p,'.json');if(d!==null)return Promise.resolve(d);return Promise.reject(Object.assign(new Error('Not found'),{status:404}));},",
    "auth:{",
    meImpl,
    "login:function(){return Promise.resolve({ok:true});},",
    "logout:function(){return Promise.resolve({ok:true});},",
    "require:function(t,lp){return this.me(t).then(function(u){if(!u){location.href=(lp||'/login')+'?redirect='+encodeURIComponent(location.pathname+location.search);return new Promise(function(){});}return u;});}",
    "}};",
    "})();",
    "</" + "script>",
  ].join("");
}

// --- Sibling asset inlining ---
//
// Sandboxed iframes (sandbox="allow-scripts" without allow-same-origin) run
// with an opaque origin and cannot fetch siblings over the network. So when
// an HTML file references a sibling .js/.css/image by relative path, we look
// up the cached content from IndexedDB and inline it into the srcDoc.

export interface SiblingAsset {
  kind: "script" | "style" | "image";
  content: string;     // text for script/style; base64 or raw text for image
  mime?: string;       // image only
  base64?: boolean;    // image only: true if content is already base64
}

export type SiblingAssetMap = Record<string, SiblingAsset>;

export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const LINK_TAG = /<link\b([^>]*)>/gi;
const IMG_TAG = /<img\b([^>]*)>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;
const HREF_ATTR = /\bhref\s*=\s*["']([^"']+)["']/i;
const REL_ATTR = /\brel\s*=\s*["']([^"']*)["']/i;

/** Resolve a relative ref against a sibling file's directory. Returns null for external/root-absolute URLs. */
export function resolveSiblingPath(currentDir: string, ref: string): string | null {
  if (!ref) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(ref)) return null; // http:, https:, data:, blob:, javascript:, ...
  if (ref.startsWith("//")) return null;                 // protocol-relative
  if (ref.startsWith("/")) return null;                  // root-relative (ambiguous without a site root)
  const clean = ref.split("?")[0].split("#")[0];
  if (!clean) return null;
  const parts = currentDir ? currentDir.split("/").filter(Boolean) : [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

export interface RelativeRef {
  kind: "script" | "style" | "image";
  ref: string;
}

/** Scan HTML for relative-path <script src>, <link rel="stylesheet" href>, <img src>. De-duplicated. */
export function collectRelativeRefs(html: string): RelativeRef[] {
  const out: RelativeRef[] = [];
  const seen = new Set<string>();
  const push = (kind: RelativeRef["kind"], ref: string) => {
    // Skip external/absolute URLs; they can't be resolved against the cache.
    if (resolveSiblingPath("", ref) === null) return;
    const key = kind + ":" + ref;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, ref });
  };

  for (const m of html.matchAll(SCRIPT_TAG)) {
    if (m[2].trim()) continue; // inline script with a body — leave it alone
    const s = SRC_ATTR.exec(m[1]);
    if (s) push("script", s[1]);
  }
  for (const m of html.matchAll(LINK_TAG)) {
    const rel = REL_ATTR.exec(m[1]);
    if (!rel || !/(^|\s)stylesheet(\s|$)/i.test(rel[1])) continue;
    const h = HREF_ATTR.exec(m[1]);
    if (h) push("style", h[1]);
  }
  for (const m of html.matchAll(IMG_TAG)) {
    const s = SRC_ATTR.exec(m[1]);
    if (s) push("image", s[1]);
  }
  return out;
}

function escapeScriptText(s: string): string {
  // Prevent premature </script> termination inside inlined content.
  return s.replace(/<\/(script)/gi, "<\\/$1");
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function inlineSiblingAssets(html: string, siblings: SiblingAssetMap): string {
  if (!Object.keys(siblings).length) return html;

  html = html.replace(SCRIPT_TAG, (match, attrs: string, body: string) => {
    if (body.trim()) return match;
    const s = SRC_ATTR.exec(attrs);
    if (!s) return match;
    const a = siblings[s[1]];
    if (!a || a.kind !== "script") return match;
    const cleanAttrs = attrs.replace(SRC_ATTR, "").replace(/\s+/g, " ").trim();
    const prefix = cleanAttrs ? " " + cleanAttrs : "";
    return `<script${prefix}>${escapeScriptText(a.content)}</script>`;
  });
  html = html.replace(LINK_TAG, (match, attrs: string) => {
    const rel = REL_ATTR.exec(attrs);
    if (!rel || !/(^|\s)stylesheet(\s|$)/i.test(rel[1])) return match;
    const h = HREF_ATTR.exec(attrs);
    if (!h) return match;
    const a = siblings[h[1]];
    if (!a || a.kind !== "style") return match;
    return `<style>${a.content}</style>`;
  });
  html = html.replace(IMG_TAG, (match, attrs: string) => {
    const s = SRC_ATTR.exec(attrs);
    if (!s) return match;
    const a = siblings[s[1]];
    if (!a || a.kind !== "image" || !a.mime) return match;
    const b64 = a.base64 ? a.content : utf8ToBase64(a.content);
    const dataUrl = `data:${a.mime};base64,${b64}`;
    const newAttrs = attrs.replace(SRC_ATTR, `src="${dataUrl}"`);
    return `<img${newAttrs}>`;
  });
  return html;
}

export function buildHtmlPreviewSrcDoc(
  content: string,
  mockScript: string,
  siblings: SiblingAssetMap = {}
): string {
  const touchScript = `<script>
var _sx,_sy,_st;
document.addEventListener('touchstart',function(e){var t=e.touches[0];_sx=t.clientX;_sy=t.clientY;_st=Date.now();});
document.addEventListener('touchend',function(e){var t=e.changedTouches[0];
parent.postMessage({type:'gemihub-iframe-touch',sx:_sx,sy:_sy,st:_st,ex:t.clientX,ey:t.clientY,et:Date.now()},'*');});
${"<"}/script>`;
  let html = content;
  const apiJsPattern = /<script[^>]*src\s*=\s*["'][^"']*\/__gemihub\/api\.js["'][^>]*>\s*<\/script>/i;
  if (apiJsPattern.test(html)) {
    html = html.replace(apiJsPattern, "");
    if (mockScript) {
      const headPattern = /(<head[^>]*>)/i;
      if (headPattern.test(html)) {
        html = html.replace(headPattern, `$1${mockScript}`);
      } else {
        html = mockScript + html;
      }
    }
  }
  html = inlineSiblingAssets(html, siblings);
  return html + touchScript;
}
