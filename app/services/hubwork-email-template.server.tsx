import yaml from "js-yaml";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readRemoteSyncMeta } from "./sync-meta.server";
import { readFile } from "./google-drive.server";

/**
 * Email template kinds. Additional kinds can be added here.
 */
export type EmailTemplateKind = "login" | "register";

const TEMPLATE_PREFIX = "emails/";
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export interface EmailTemplate {
  subject: string;
  markdown: string;
}

/**
 * Built-in fallback templates used when no .md is found on Drive.
 * Kept intentionally simple; customers override by placing .md files in emails/.
 */
const BUILT_IN_TEMPLATES: Record<EmailTemplateKind, EmailTemplate> = {
  login: {
    subject: "Login Link",
    markdown: [
      "# Login",
      "",
      "Click the link below to log in. This link expires in {{expiresInMinutes}} minutes.",
      "",
      // Mustache convention: triple-brace for URLs (trusted, raw). Double-brace
      // also works here because ReactMarkdown normalizes `&amp;` in href, but
      // `{{{ }}}` makes the "this is a URL, don't escape" intent explicit.
      "[Log In]({{{magicLink}}})",
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
  },
  register: {
    subject: "Confirm your registration",
    markdown: [
      "# Confirm your registration",
      "",
      "Hello {{email}},",
      "",
      "Click the link below to complete registration. This link expires in {{expiresInMinutes}} minutes.",
      "",
      "[Complete registration]({{{registerLink}}})",
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
  },
};

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const m = content.match(FM_RE);
  if (!m) return { data: {}, body: content };
  let data: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    return { data: {}, body: content };
  }
  return { data, body: content.slice(m[0].length) };
}

function findTemplateFileId(
  syncMeta: Awaited<ReturnType<typeof readRemoteSyncMeta>>,
  accountType: string,
  kind: EmailTemplateKind,
): string | null {
  if (!syncMeta) return null;
  const candidates = [
    `${TEMPLATE_PREFIX}${accountType}/${kind}.md`,
    `${TEMPLATE_PREFIX}${kind}.md`,
  ];
  for (const path of candidates) {
    for (const [fileId, meta] of Object.entries(syncMeta.files)) {
      if (meta.name === path) return fileId;
    }
  }
  return null;
}

/**
 * Load a template from Drive with fallbacks:
 *   emails/{accountType}/{kind}.md  →  emails/{kind}.md  →  built-in default
 */
export async function loadEmailTemplate(
  accessToken: string,
  rootFolderId: string,
  accountType: string,
  kind: EmailTemplateKind,
): Promise<EmailTemplate> {
  try {
    const syncMeta = await readRemoteSyncMeta(accessToken, rootFolderId);
    const fileId = findTemplateFileId(syncMeta, accountType, kind);
    if (fileId) {
      const raw = await readFile(accessToken, fileId);
      const { data, body } = parseFrontmatter(raw);
      const subject = typeof data.subject === "string" && data.subject.trim()
        ? data.subject.trim()
        : BUILT_IN_TEMPLATES[kind].subject;
      return { subject, markdown: body };
    }
  } catch (e) {
    console.warn(`[email-template] Failed to load ${kind} for ${accountType}:`, e);
  }
  return BUILT_IN_TEMPLATES[kind];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Mustache-style variable substitution.
 * `{{var}}` → HTML-escaped, `{{{var}}}` → raw (use only for trusted values like URLs).
 * Missing variables render as empty string to avoid leaking `{{foo}}` to the recipient.
 */
export function substituteVariables(
  text: string,
  variables: Record<string, string | number | undefined>,
): string {
  // Triple-brace raw first to avoid double-processing.
  const rawPass = text.replace(/\{\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\}/g, (_, name) => {
    const value = variables[name];
    return value == null ? "" : String(value);
  });
  return rawPass.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    const value = variables[name];
    return value == null ? "" : escapeHtml(String(value));
  });
}

function renderMarkdownToHtmlFragment(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>,
  );
}

/**
 * Inline CSS constants — kept here because email clients (especially Outlook) strip
 * <style> blocks or selectors. Every element reached by ReactMarkdown gets its style
 * re-applied via a small attribute-injecting post-process.
 */
const INLINE_STYLE_MAP: Record<string, string> = {
  body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;font-size:14px;line-height:1.6;max-width:480px;margin:0 auto;padding:16px;",
  h1: "font-size:20px;line-height:1.3;margin:0 0 12px 0;color:#111827;",
  h2: "font-size:17px;line-height:1.3;margin:16px 0 8px 0;color:#111827;",
  h3: "font-size:15px;line-height:1.3;margin:16px 0 6px 0;color:#111827;",
  p: "margin:0 0 12px 0;",
  a: "color:#2563eb;text-decoration:underline;",
  ul: "margin:0 0 12px 0;padding-left:20px;",
  ol: "margin:0 0 12px 0;padding-left:20px;",
  li: "margin:0 0 4px 0;",
  blockquote: "margin:0 0 12px 0;padding:8px 12px;border-left:3px solid #d1d5db;color:#374151;background:#f9fafb;",
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;background:#f3f4f6;padding:2px 4px;border-radius:3px;",
  pre: "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;background:#f3f4f6;padding:10px;border-radius:4px;overflow-x:auto;margin:0 0 12px 0;",
  hr: "border:0;border-top:1px solid #e5e7eb;margin:16px 0;",
  table: "border-collapse:collapse;width:100%;margin:0 0 12px 0;",
  th: "border:1px solid #d1d5db;padding:6px 10px;background:#f9fafb;text-align:left;",
  td: "border:1px solid #d1d5db;padding:6px 10px;",
};

/**
 * Add inline `style` attrs to known tags in an HTML fragment.
 * Uses a narrow regex — ReactMarkdown output is a known-safe subset of HTML
 * (no attributes on most tags besides `a[href]`), so this is sufficient.
 */
function addInlineStyles(htmlFragment: string): string {
  return htmlFragment.replace(/<(\w+)(\s[^>]*)?>/g, (match, tag: string, rest: string | undefined) => {
    const style = INLINE_STYLE_MAP[tag.toLowerCase()];
    if (!style) return match;
    const attrs = rest || "";
    if (/\sstyle\s*=/.test(attrs)) return match;
    return `<${tag}${attrs} style="${style}">`;
  });
}

/**
 * Render an email template to { subject, html } given variables.
 * Subject is plain-text (no HTML); body is Markdown → HTML with inline CSS.
 */
export function renderEmailTemplate(
  template: EmailTemplate,
  variables: Record<string, string | number | undefined>,
): { subject: string; html: string } {
  // For subject, bypass HTML escaping (headers are plain text).
  const subject = template.subject.replace(
    /\{\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}\}/g,
    (_, name: string) => {
      const v = variables[name];
      return v == null ? "" : String(v);
    },
  );

  const substituted = substituteVariables(template.markdown, variables);
  const fragment = renderMarkdownToHtmlFragment(substituted);
  const styled = addInlineStyles(fragment);

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="${INLINE_STYLE_MAP.body}">
${styled}
</body>
</html>`;

  return { subject, html };
}
