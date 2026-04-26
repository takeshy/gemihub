import assert from "node:assert/strict";
import test from "node:test";
import {
  renderEmailTemplate,
  substituteVariables,
} from "./hubwork-email-template.server";

test("substituteVariables HTML-escapes values by default", () => {
  const out = substituteVariables("Hello {{name}}", { name: "<script>" });
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(!out.includes("<script>"));
});

test("substituteVariables preserves raw with triple braces", () => {
  const out = substituteVariables("[go]({{{url}}})", { url: "https://example.com/a?b=1&c=2" });
  assert.equal(out, "[go](https://example.com/a?b=1&c=2)");
});

test("substituteVariables drops unknown variables to empty string", () => {
  const out = substituteVariables("Hello {{missing}}!", {});
  assert.equal(out, "Hello !");
});

test("renderEmailTemplate converts markdown and interpolates link variable", () => {
  const result = renderEmailTemplate(
    {
      subject: "Login to {{siteName}}",
      markdown: "# Welcome {{name}}\n\n[Login]({{{magicLink}}})",
    },
    {
      siteName: "acme.gemihub.net",
      name: "Alice",
      magicLink: "https://acme.gemihub.net/__gemihub/auth/verify/abc?redirect=/",
    },
  );

  assert.equal(result.subject, "Login to acme.gemihub.net");
  assert.match(result.html, /<h1[^>]*>Welcome Alice<\/h1>/);
  assert.match(
    result.html,
    /<a[^>]*href="https:\/\/acme\.gemihub\.net\/__gemihub\/auth\/verify\/abc\?redirect=\/"/,
  );
});

test("renderEmailTemplate applies inline styles to known tags", () => {
  const result = renderEmailTemplate(
    { subject: "x", markdown: "# Title\n\nBody text." },
    {},
  );
  assert.match(result.html, /<h1[^>]*style="[^"]+"/);
  assert.match(result.html, /<p[^>]*style="[^"]+"/);
});

test("renderEmailTemplate escapes XSS attempts in variable content", () => {
  const result = renderEmailTemplate(
    { subject: "s", markdown: "Hello {{name}}" },
    { name: '<img src=x onerror="alert(1)">' },
  );
  assert.ok(!result.html.includes("<img"));
  assert.ok(result.html.includes("&lt;img"));
});

test("renderEmailTemplate: {{{url}}} and {{url}} both produce valid hrefs (ReactMarkdown normalizes entities)", () => {
  // Double-brace HTML-escapes into the markdown string, but ReactMarkdown
  // decodes `&amp;` back to `&` before rendering, so both produce identical
  // output for URLs. Triple-brace is still the Mustache convention for trusted
  // values and makes intent explicit — but this locks in that either works.
  const withDouble = renderEmailTemplate(
    { subject: "s", markdown: "[go]({{url}})" },
    { url: "https://example.com/a?b=1&c=2" },
  );
  const withTriple = renderEmailTemplate(
    { subject: "s", markdown: "[go]({{{url}}})" },
    { url: "https://example.com/a?b=1&c=2" },
  );
  assert.match(withDouble.html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(withTriple.html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
});
