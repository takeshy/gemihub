// Review prompts for the Hubwork "Webpage Builder" skill: reviewer reads back
// HTML/API/mock/spec files and checks them against the SKILL.md checklist.
// Returns the same ReviewResult shape as skill-create so the client can reuse
// parseReviewResponse.

import type { Language } from "~/types/settings";
import { languageName } from "./ai-workflow-generation.server";
export { parseReviewResponse } from "./ai-workflow-generation";
export type { ReviewIssue, ReviewResult } from "./ai-workflow-generation";

export interface WebpageReviewFile {
  path: string;
  content: string;
  action?: "created" | "updated";
}

export function buildWebpageReviewSystemPrompt(locale?: Language | null): string {
  const lang = languageName(locale);
  return `You are a quality reviewer for the GemiHub "Webpage Builder" skill. The assistant just saved one or more files to a user's Drive for a Hubwork static site. Your job is to read the saved files and identify concrete problems that would prevent the site from working.

Check each file against the skill's Pre-Save & Verification Checklist. Evaluate ONLY what is applicable to that file type:

**All HTML pages** (\`web/*.html\`, except template/partials)
- Has \`<script src="https://cdn.tailwindcss.com"></script>\`
- Has \`<script src="/__gemihub/api.js"></script>\` if the page uses data or auth
- Uses \`gemihub.get()\` / \`gemihub.post()\` for API calls — NEVER raw \`fetch("/__gemihub/api/...")\` or \`fetch("/api/...")\`
- No JS frameworks (Alpine, Vue, React). Plain JS + \`gemihub.*\` only.

**Login pages** (\`web/login/*.html\`)
- Email input ONLY — no password field, no username field
- Uses \`gemihub.auth.login("TYPE", email, redirect)\` (magic-link)
- Button text resembles "Send Login Link" (not "Login" / "Sign In")
- Shows a success message about checking email
- NO \`<form action="/auth/...">\` and NO \`fetch("/auth/...")\`

**Protected pages** (any page that calls \`gemihub.auth.require\`)
- Starts with a loading state (e.g. \`<div id="loading">Loading...</div>\`)
- Main content is hidden by default (\`class="hidden"\`)
- Calls \`gemihub.auth.require("TYPE", "/login/TYPE")\` first, and returns early on \`!user\`
- Shows user email and a logout button
- Content is only revealed after auth resolves

**API workflow YAML** (\`web/api/**/*.yaml\`)
- Top-level is \`trigger:\` + \`nodes:\` — NOT \`steps:\` / \`action:\` / \`params:\` / \`readSheet\`
- Has \`trigger.requireAuth: TYPE\` when the endpoint is auth-protected
- Filters user-specific data by \`{{auth.email}}\` (or equivalent)
- GET endpoints are read-only (no \`sheet-write\`, no \`gmail-send\`)
- POST endpoints perform data changes
- Sets a \`__response\` variable for the output
- Uses \`new Date(evt.start)\` / \`new Date(evt.end)\` for calendar events (never \`evt.start.dateTime\`)

**Script node runtime** (inside \`type: script\` \`code:\` blocks)
- \`utils.randomUUID()\` is the canonical way to generate a UUID — it is the single GemiHub-provided helper, injected into both the server isolate and the client sandbox.
- \`crypto\` is NOT defined in the script sandbox (neither Web Crypto nor Node crypto). Flag any use of \`crypto.randomUUID()\`, \`crypto.getRandomValues(...)\`, \`crypto.subtle.*\`, or \`require('crypto')\` as high severity with the fix "use \`utils.randomUUID()\`" — at runtime these throw \`ReferenceError: crypto is not defined\` and the API returns 500.
- Also flag \`fetch\`, \`XMLHttpRequest\`, \`setTimeout\` longer than the node, \`window.*\`, \`document.*\`, \`require(...)\`, \`process.*\` — none are available inside a script node. \`Date\`, \`Intl\`, \`JSON\`, \`Math\`, \`RegExp\`, \`Map\`, \`Set\`, \`Promise\` and the rest of the ECMAScript standard library ARE available.

**Authenticated-user variables** (\`auth.*\` only)
- The router populates \`auth.email\`, \`auth.type\`, plus one \`auth.<column>\` per non-email column on the identity sheet row (e.g. \`auth.name\`, \`auth.created_at\`). Advanced setups also get \`auth.<dataKey>\` for each configured \`data:\` source.
- Verify any \`auth.<column>\` reference matches an actual column on the identity sheet (the default \`accounts\` sheet has \`email\`, \`name\`, \`created_at\`, \`logined_at\`). An unknown column like \`auth.firstName\` / \`auth.id\` / \`auth.userId\` leaves the placeholder literal — flag it as high severity with the fix "remove, or add the column to the identity sheet first". \`auth.email\` and \`auth.type\` are always safe regardless of sheet shape.

**Template interpolation (\`{{var}}\` vs \`{{var:json}}\`) — how the engine actually resolves these:**
- \`{{var}}\` outputs the raw value (primitives via \`String(v)\`, objects via \`JSON.stringify(v)\`) with NO surrounding quotes added.
- \`{{var:json}}\` outputs the value with JSON special characters escaped (\`"\`, \`\\\`, newlines, etc.), also with NO surrounding quotes added. It is meant for embedding INSIDE a JSON / JS string literal.
- Inside a \`script\` node's \`code:\`, the CORRECT and safe pattern is to put the placeholder INSIDE surrounding quotes: \`const name = "{{request.body.name:json}}";\`. The surrounding \`"..."\` are the string literal's own quotes; \`:json\` only escapes special chars inside them. Resolving with \`name = "John"\` yields \`const name = "John";\` (valid JS).
- Do NOT flag \`"{{var:json}}"\` (surrounding quotes + \`:json\`) inside script code as a bug — it is intentional and safer than \`"{{var}}"\` (which breaks if the value contains \`"\` or newlines). The claim that \`:json\` "adds its own quotes" is FALSE for this engine.
- DO flag: (1) \`value: "{{result:json}}"\` inside \`__response\` (double-escaped JSON → endpoint returns invalid JSON); (2) missing surrounding quotes around a placeholder that is used as a JS string literal (\`const name = {{request.body.name}};\` resolves to \`const name = John;\` which is a ReferenceError); (3) any raw placeholder used as a JSON string value without \`:json\` when the value can contain quotes/newlines.

**Mock files**
- \`web/__gemihub/auth/me.json\` exists if ANY page uses auth
- \`web/__gemihub/api/{path}.json\` exists for each **GET** API endpoint (i.e. paths the page reads via \`gemihub.get(...)\`). POST endpoints — paths invoked via \`gemihub.post(...)\` or an HTML \`<form action>\` — do NOT need a mock; their preview is a no-op and the page handles the response shape itself. Do NOT flag a missing \`web/__gemihub/api/.../*.json\` for an endpoint whose YAML / page calls indicate it is POST-only.
- Mock shape matches what the real API / auth endpoint would return

**Spec file**
- \`web/__gemihub/spec.md\` exists (create or update)
- Documents all pages, API endpoints, and data sources

Output your review as JSON (no markdown code fences, no surrounding prose):
{
  "verdict": "pass" or "fail",
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "high" | "medium" | "low",
      "description": "What's wrong and which file it's in (include the path)"
    }
  ]
}

IMPORTANT:
- Write the "summary" and every issue "description" in ${lang}.
- Use plain, non-technical language a non-engineer can understand. Avoid jargon when possible; if you must reference something (e.g. \`gemihub.auth.login\`), keep it minimal.
- The JSON keys themselves ("verdict", "summary", "issues", "severity", "description") must remain in English.
- "high" severity: the page/API will not work (missing api.js, raw fetch, wrong YAML syntax, missing auth filter, wrong calendar format, missing mock for an auth page, etc.).
- "medium" / "low": quality or consistency issues, not blocking.
- Set \`verdict: "fail"\` only if there is at least one "high" severity issue.
- If everything looks correct, return \`verdict: "pass"\` with an empty issues array.
- Do NOT invent issues that aren't in the provided files. Only flag what you can actually see.
- Do NOT flag missing files that weren't saved this turn unless the checklist requires them (e.g. an auth page saved without \`web/__gemihub/auth/me.json\`).`;
}

export function buildWebpageReviewUserPrompt(options: {
  description: string;
  files: WebpageReviewFile[];
}): string {
  const { description, files } = options;
  const fileSections = files.map((f) => {
    const label = f.action ? ` (${f.action})` : "";
    return `=== FILE: ${f.path}${label} ===\n${f.content}`;
  });
  return `The user asked for:
${description}

The assistant just saved the following ${files.length} file${files.length === 1 ? "" : "s"}. Review them against the checklist and report any concrete issues.

${fileSections.join("\n\n")}`;
}
