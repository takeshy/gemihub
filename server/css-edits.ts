import postcss from "postcss";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import type { ShopConfig } from "./domain.ts";
import { compactGeneratedStyles } from "./generated-design.ts";
import { componentCssLimit, selectorComponent, themeCssLimit, themeStyleSchema, themeStylesSchema } from "../shared/theme-styles.ts";

// Declaration patches let small edits preserve accepted, potentially large styles.
export const cssEditsSchema = z.array(z.strictObject({
  field: z.enum(["css", "headerCss", "footerCss", "bodyCss", "style"]),
  styleId: z.string().max(80).optional(),
  selector: z.string().trim().min(1).max(1000).regex(/^[^{};]+$/),
  declarations: z.array(z.strictObject({
    property: z.string().max(100).regex(/^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/),
    value: z.string().trim().min(1).max(1000).regex(/^[^{};!]+$/),
    important: z.boolean().optional(),
  })).min(1).max(20),
})).min(1).max(24);

type CssEdit = z.infer<typeof cssEditsSchema>[number];
const editFailed = (message: string) => Object.assign(new Error(message), { status: 422 });
/** Patch every rule with exactly this selector; returns undefined when the stylesheet has none. */
function patchRules(css: string, edit: CssEdit) {
  const root = postcss.parse(css);
  let found = false;
  root.walkRules(rule => {
    if (rule.selector !== edit.selector) return;
    found = true;
    for (const declaration of edit.declarations) {
      let replaced = false;
      rule.each(decl => {
        if (decl.type !== "decl") return;
        const matches = declaration.property.startsWith("--") ? decl.prop === declaration.property : decl.prop.toLowerCase() === declaration.property.toLowerCase();
        if (!matches) return;
        decl.value = declaration.value;
        if (declaration.important !== undefined) decl.important = declaration.important;
        replaced = true;
      });
      if (!replaced) rule.append(postcss.decl({ prop: declaration.property, value: declaration.value, important: declaration.important }));
    }
  });
  return found ? root.toString() : undefined;
}
const newRule = (edit: CssEdit) => postcss.rule({ selector: edit.selector, nodes: edit.declarations.map(declaration => postcss.decl({ prop: declaration.property, value: declaration.value, important: declaration.important })) }).toString();

export function applyCssEdits(appearance: ShopConfig["appearance"], edits: z.infer<typeof cssEditsSchema>) {
  if (!appearance?.theme) throw editFailed(tr("変更対象を選び直してください"));
  const theme = { ...appearance.theme, styles: appearance.theme.styles && [...appearance.theme.styles] };
  for (const edit of edits) {
    if (edit.field === "headerCss" || edit.field === "footerCss" || edit.field === "bodyCss") {
      const css = theme[edit.field] || "";
      theme[edit.field] = patchRules(css, edit) ?? [css, newRule(edit)].filter(Boolean).join("\n");
      continue;
    }
    // Shared styles: theme.css comes first, then each module in order. Once split, theme.css is usually empty,
    // so a selector named for "css" (or a stale styleId) is patched where the rule actually lives.
    const styles = theme.styles || [];
    const named = edit.field === "style" ? styles.findIndex(style => style.id === edit.styleId) : -1;
    const patchedNamed = named >= 0 ? patchRules(styles[named].css, edit) : undefined;
    if (patchedNamed !== undefined) { styles[named] = { ...styles[named], css: patchedNamed }; continue; }
    let found = false;
    const sharedCss = patchRules(theme.css, edit);
    if (sharedCss !== undefined) { theme.css = sharedCss; found = true; }
    styles.forEach((style, index) => {
      const css = patchRules(style.css, edit);
      if (css !== undefined) { styles[index] = { ...style, css }; found = true; }
    });
    if (found) continue;
    // A new rule must come last so it is not overridden by later modules of the same specificity.
    if (!styles.length) { theme.css = [theme.css, newRule(edit)].filter(Boolean).join("\n"); continue; }
    const component = selectorComponent(edit.selector), last = styles.at(-1)!;
    if (last.component === component && last.css.length + newRule(edit).length + 1 <= componentCssLimit) styles[styles.length - 1] = { ...last, css: `${last.css}\n${newRule(edit)}` };
    else {
      const used = new Set(styles.map(style => style.id)); let sequence = 0, id: string;
      do { id = `edit-${++sequence}`; } while (used.has(id));
      styles.push({ id, component, css: newRule(edit) });
    }
    theme.styles = styles;
  }
  return checkedStyles({ ...appearance, theme: compactGeneratedStyles(theme) as typeof theme });
}
/** Edits are applied after the model's size repairs, so report overflow as a request the owner can narrow. */
function checkedStyles(appearance: NonNullable<ShopConfig["appearance"]>) {
  const theme = appearance.theme!;
  for (const field of ["headerCss", "footerCss", "bodyCss"] as const) if ((theme[field]?.length || 0) > componentCssLimit) throw editFailed(tr("修正後のCSSが上限を超えました。変更する範囲を絞ってもう一度お試しください。"));
  if (theme.css.length > themeCssLimit || theme.styles && !themeStylesSchema.safeParse(theme.styles).success) throw editFailed(tr("修正後のCSSが上限を超えました。変更する範囲を絞ってもう一度お試しください。"));
  return appearance;
}

export const styleEditsSchema = z.array(themeStyleSchema).max(32);
export function applyStyleEdits(appearance: ShopConfig["appearance"], edits: z.infer<typeof styleEditsSchema>) {
  if (!appearance?.theme) throw editFailed(tr("変更対象を選び直してください"));
  const styles = [...(appearance.theme.styles || [])];
  for (const edit of edits) {
    const index = styles.findIndex(style => style.id === edit.id);
    if (index < 0) styles.push(edit);
    else {
      if (styles[index].component !== edit.component) throw editFailed(tr("変更対象を選び直してください"));
      styles[index] = edit;
    }
  }
  return checkedStyles({ ...appearance, theme: { ...appearance.theme, styles } });
}
