import postcss from "postcss";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import type { ShopConfig } from "./domain.ts";
import { compactGeneratedStyles } from "./generated-design.ts";
import { themeStyleSchema } from "../shared/theme-styles.ts";

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

export function applyCssEdits(appearance: ShopConfig["appearance"], edits: z.infer<typeof cssEditsSchema>) {
  if (!appearance?.theme) throw new Error(tr("変更対象を選び直してください"));
  const theme = { ...appearance.theme };
  for (const edit of edits) {
    const module = edit.field === "style" ? theme.styles?.find(style => style.id === edit.styleId) : undefined;
    if (edit.field === "style" && !module) throw new Error(tr("変更対象を選び直してください"));
    const root = postcss.parse(module ? module.css : edit.field !== "style" ? theme[edit.field] || "" : "");
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
    if (!found) {
      const rule = postcss.rule({ selector: edit.selector });
      for (const declaration of edit.declarations) rule.append(postcss.decl({ prop: declaration.property, value: declaration.value, important: declaration.important }));
      root.append(rule);
    }
    if (module) theme.styles = theme.styles!.map(style => style.id === module.id ? { ...style, css: root.toString() } : style);
    else if (edit.field !== "style") theme[edit.field] = root.toString();
  }
  return { ...appearance, theme: compactGeneratedStyles(theme) };
}

export const styleEditsSchema = z.array(themeStyleSchema).max(32);
export function applyStyleEdits(appearance: ShopConfig["appearance"], edits: z.infer<typeof styleEditsSchema>) {
  if (!appearance?.theme) throw new Error(tr("変更対象を選び直してください"));
  const styles = [...(appearance.theme.styles || [])];
  for (const edit of edits) {
    const index = styles.findIndex(style => style.id === edit.id);
    if (index < 0) styles.push(edit);
    else {
      if (styles[index].component !== edit.component) throw new Error(tr("変更対象を選び直してください"));
      styles[index] = edit;
    }
  }
  return { ...appearance, theme: { ...appearance.theme, styles } };
}
