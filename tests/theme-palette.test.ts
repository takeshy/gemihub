import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedThemeCss, splitThemeStyles } from "../shared/theme-styles.ts";
import { themePart, compilePresentation, themeSchema } from "../shared/presentation.ts";
import { standardTheme } from "../shared/theme-editing.ts";
import { usesThemePalette } from "../shared/theme-palette.ts";

test("legacy CSS stays byte-for-byte intact, while semantic palette defaults stay out of saved modules", () => {
  const legacy = { ...standardTheme, css: '.panel{background:#fff} /* --primary: red */' };
  assert.equal(sharedThemeCss(legacy), legacy.css);
  assert.equal(usesThemePalette('.x{content:"--primary: red"}'), false);
  const authored = ':root{--primary:#70435c;--surface:#fffdfb}.panel{background:gold}';
  const theme = { ...standardTheme, css: authored };
  const split = splitThemeStyles(theme);
  assert.equal(theme.css, authored);
  assert.equal(split.styles!.map(style => style.css).join("\n").includes("--success:"), false);
  for (const value of [theme, split]) {
    const css = sharedThemeCss(value);
    assert.ok(css.indexOf("--success:") < css.indexOf("--primary:#70435c"));
    assert.ok(css.endsWith(".panel{background:gold}"), "authored overrides follow the defaults");
    assert.equal(themeSchema.safeParse(value).success, true);
  }
});

test("header, body and footer share the palette and all default selectors remain inside their design boundary", () => {
  const theme = { ...standardTheme, css: '.design-root{--primary:#006d77;--secondary:#745a28}' };
  for (const part of ["header", "body", "footer"] as const) {
    const design = themePart(theme, part)!;
    const compiled = compilePresentation(design);
    assert.match(compiled.css, /--primary:#006d77/);
    assert.match(compiled.css, /payment-refund-status/);
    assert.match(compiled.css, new RegExp(`\\.${compiled.id} :is\\(\\.primary\\)`));
    assert.equal(design.css, sharedThemeCss(theme));
  }
});
