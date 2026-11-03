import { z } from "zod";
import { compilePresentation, type Theme } from "./presentation.ts";
import { tr } from "./i18n.ts";

// Built-in screens can be laid out in checked HTML/CSS. Their working parts (booking form,
// my page, inquiry form, settings-driven shop facts) stay app components inserted through slots,
// so owners design around them without replacing booking, sign-in or payment logic.
export const screenIds = ["about", "reserve", "mine", "contact"] as const;
export type ScreenId = typeof screenIds[number];
export const screenSlots: Record<ScreenId, { allowed: string[]; required: string[] }> = {
  about: { allowed: ["menus", "staff", "access", "hours"], required: [] },
  reserve: { allowed: ["booking"], required: ["booking"] },
  mine: { allowed: ["mypage", "news"], required: ["mypage"] },
  contact: { allowed: ["form"], required: ["form"] },
};
const designSchema = z.object({ html: z.string().min(1).max(20000), css: z.string().max(12000) });
export type ScreenDesign = z.infer<typeof designSchema>;
/** Checks a screen design and its slots; returns an error message, or undefined when valid. */
export function screenDesignError(id: ScreenId, design: ScreenDesign) {
  try {
    const slots = compilePresentation(design).slots;
    const { allowed, required } = screenSlots[id];
    const unknown = slots.filter(slot => !allowed.includes(slot));
    const missing = required.filter(slot => !slots.includes(slot));
    if (unknown.length || missing.length) return `Allowed slots: ${allowed.join(", ")}; required: ${required.join(", ") || "none"}${unknown.length ? `; unknown: ${unknown.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}.`;
    if (slots.length !== new Set(slots).size) return "Each slot may appear only once.";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
export const screensSchema = z.object(Object.fromEntries(screenIds.map(id => [id, designSchema.optional()])) as Record<ScreenId, z.ZodOptional<typeof designSchema>>).superRefine((screens, ctx) => {
  for (const id of screenIds) {
    const design = screens[id];
    const error = design && screenDesignError(id, design);
    if (error) ctx.addIssue({ code: "custom", path: [id], message: error });
  }
});
export type Screens = z.infer<typeof screensSchema>;

/** Starting points that already contain each screen's slots, in the viewer's language. */
export function screenStarter(id: ScreenId): ScreenDesign {
  return {
    about: { html: `<section class="about">\n  <h2>${tr("メニュー")}</h2>\n  <slot name="menus"></slot>\n  <h2>${tr("スタッフ")}</h2>\n  <slot name="staff"></slot>\n  <h2>${tr("アクセス")}</h2>\n  <slot name="access"></slot>\n  <h2>${tr("営業時間")}</h2>\n  <slot name="hours"></slot>\n</section>`, css: ".about { display: grid; gap: 12px; }" },
    reserve: { html: `<section class="reserve">\n  <h2>${tr("ご予約")}</h2>\n  <p>${tr("ご希望のメニューと日時をお選びください。")}</p>\n  <slot name="booking"></slot>\n</section>`, css: ".reserve { display: grid; gap: 12px; }" },
    mine: { html: '<section class="mine">\n  <slot name="news"></slot>\n  <slot name="mypage"></slot>\n</section>', css: ".mine { display: grid; gap: 16px; }" },
    contact: { html: `<section class="contact">\n  <h2>${tr("お問い合わせ")}</h2>\n  <p>${tr("お気軽にご相談ください。")}</p>\n  <slot name="form"></slot>\n</section>`, css: ".contact { display: grid; gap: 12px; }" },
  }[id];
}
export const themeStarter: Theme = {
  headerHtml: '<header class="site">\n  <div class="brand"><slot name="title"></slot><slot name="subtitle"></slot></div>\n  <slot name="navigation"></slot>\n</header>',
  bodyHtml: '<main class="frame"><slot name="content"></slot></main>',
  footerHtml: '<footer class="site-foot"><slot name="content"></slot></footer>',
  css: ".site { padding: 24px; display: grid; gap: 12px; }\n.frame { max-width: 960px; margin: 0 auto; padding: 16px; }\n.site-foot { padding: 24px; text-align: center; opacity: .8; }",
};
