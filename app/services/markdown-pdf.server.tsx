import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMarkdownToPrintableHtml(markdown: string, title: string): string {
  const rendered = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {markdown}
    </ReactMarkdown>
  );

  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      @page { size: A4; margin: 20mm 16mm; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #111827;
        font-size: 12pt;
        line-height: 1.6;
        word-break: break-word;
      }
      h1, h2, h3, h4, h5, h6 {
        line-height: 1.3;
        margin: 1.1em 0 0.5em;
      }
      h1 { font-size: 2em; }
      h2 { font-size: 1.5em; }
      h3 { font-size: 1.25em; }
      p, ul, ol, blockquote, pre, table {
        margin: 0.7em 0;
      }
      ul, ol { padding-left: 1.4em; }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.95em;
        background: #f3f4f6;
        padding: 0.1em 0.35em;
        border-radius: 4px;
      }
      pre {
        background: #f3f4f6;
        border-radius: 6px;
        padding: 0.8em;
        overflow-x: auto;
      }
      pre code {
        background: transparent;
        padding: 0;
      }
      blockquote {
        border-left: 3px solid #d1d5db;
        padding-left: 0.9em;
        color: #374151;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #d1d5db;
        padding: 0.45em 0.6em;
      }
      th {
        background: #f9fafb;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      hr {
        border: 0;
        border-top: 1px solid #e5e7eb;
        margin: 1.2em 0;
      }
    </style>
  </head>
  <body>
    ${rendered}
  </body>
</html>`;
}

export function renderHtmlToPrintableHtml(html: string, title: string): string {
  if (/<html[\s>]/i.test(html)) {
    return html;
  }
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}
