import postcss from "postcss";

/** Runtime defaults are inserted before authored CSS; they are never saved into a theme. */
export const themePaletteCss = `
.design-root {
  --primary: #284f43;
  --on-primary: #ffffff;
  --secondary: var(--primary);
  --on-secondary: var(--on-primary);
  --background: #f8f9f5;
  --surface: #ffffff;
  --text: #283c35;
  --muted-text: color-mix(in srgb, var(--text) 80%, var(--surface));
  --border: color-mix(in srgb, var(--text) 20%, var(--surface));
  --primary-container: color-mix(in srgb, var(--primary) 12%, var(--surface));
  --on-primary-container: var(--primary);
  --secondary-container: color-mix(in srgb, var(--secondary) 12%, var(--surface));
  --on-secondary-container: var(--secondary);
  --success: #286739;
  --warning: #805400;
  --danger: #b3261e;
  --info: var(--secondary);
  --success-container: color-mix(in srgb, var(--success) 12%, var(--surface));
  --warning-container: color-mix(in srgb, var(--warning) 12%, var(--surface));
  --danger-container: color-mix(in srgb, var(--danger) 12%, var(--surface));
  --info-container: color-mix(in srgb, var(--info) 12%, var(--surface));
  --focus: var(--primary);
  --green: var(--primary);
  --cream: var(--secondary-container);
  --line: var(--border);
  --muted: var(--muted-text);
  --selected-bg: var(--primary-container);
  --selected-border: var(--primary);
  --selected-ink: var(--on-primary-container);
  background: var(--background);
  color: var(--text);
  accent-color: var(--primary);
}
button, .button { background: var(--surface); color: var(--primary); border-color: var(--border); }
.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
.secondary { background: var(--secondary); color: var(--on-secondary); border-color: var(--secondary); }
button:hover, .button:hover { background: var(--secondary-container); }
.primary:hover { background: color-mix(in srgb, var(--primary) 90%, var(--text)); }
.secondary:hover { background: color-mix(in srgb, var(--secondary) 90%, var(--text)); }
.text-button { background: transparent; color: var(--primary); }
a, summary { color: var(--primary); }
input, select, textarea { background: var(--surface); color: var(--text); border-color: var(--border); }
input:focus, select:focus, textarea:focus, button:focus-visible, a:focus-visible { outline-color: var(--focus); }
input[type=checkbox], input[type=radio] { accent-color: var(--primary); }
.panel, .booking-summary, .booking-mobile-summary, .post-archive-card, .recent-post-list > a,
.payment-policy, .payment-details { background: var(--surface); color: var(--text); border-color: var(--border); }
.salon-hero { background: var(--primary-container); color: var(--text); }
.public-nav button, .public-nav a, .public-nav span { background: transparent; color: var(--primary); }
.post-archive-card:hover, .recent-post-list > a:hover { background: var(--secondary-container); border-color: var(--secondary); }
.muted, small, .menu-options small, .post-meta, .post-lead, .post-archive-card p,
.post-archive-card > .small, .salon-hero p, .salon-details, .eyebrow { color: var(--muted-text); }
.selected small { color: inherit; }
.icon, .hero-flower, .booking-summary .line-flower { color: var(--primary); }
.public-nav .active { border-color: var(--primary); }
.notice, .waitlist-request, .empty-slots, .post-markdown blockquote { background: var(--primary-container); color: var(--on-primary-container); border-color: var(--primary); }
.pill, .status, .status.cancelled, .status.no_show { background: var(--secondary-container); color: var(--on-secondary-container); }
.status.active, .success, .payment-refund-status[data-state=completed] { background: var(--success-container); color: var(--success); }
.status.transfer, .info, .preview-banner { background: var(--info-container); color: var(--info); border-color: var(--info); }
.warning, .payment-refund-status[data-state=pending], .payment-refund-status[data-state=retrying] { background: var(--warning-container); color: var(--warning); }
.alert, .danger, .payment-refund-status[data-state=awaiting_funds], .payment-refund-status[data-state=manual_review] { background: var(--danger-container); color: var(--danger); border-color: var(--danger); }
`;

/** Primary/secondary declarations opt in; unrelated legacy variables are left intact. */
const paletteUse = new Map<string, boolean>();
export function usesThemePalette(css: string) {
  // Rendering asks on every keystroke; the answer only depends on the stylesheet text.
  const known = paletteUse.get(css);
  if (known !== undefined) return known;
  if (paletteUse.size >= 64) paletteUse.clear();
  const enabled = parsesThemePalette(css);
  paletteUse.set(css, enabled);
  return enabled;
}
function parsesThemePalette(css: string) {
  try {
    let enabled = false;
    postcss.parse(css).walkDecls(decl => { if (["--primary", "--secondary"].includes(decl.prop)) enabled = true; });
    return enabled;
  } catch { return false; } // The existing safety/schema validation reports malformed CSS.
}

export const themePaletteInstruction = "Use the shared semantic palette for new themes: define --primary, --on-primary, --secondary, --on-secondary, --background, --surface, --text, --muted-text, --border, --success, --warning and --danger in ONE base module on .design-root (or :root, scoped to it). Defining --primary or --secondary enables the application's palette styles in live pages, previews and offline output. Buttons, inputs, links, cards, icons, selected services/times, news cards, booking-status badges and payment/refund messages already follow these roles; do not copy their colour declarations into every component. For soft surfaces optionally define --primary-container/--on-primary-container and --secondary-container/--on-secondary-container; otherwise they are derived from the main colours and surface. --success-container, --warning-container, --danger-container and --info-container are also derived; --info defaults to secondary and --focus to primary. Use at least 4.5:1 text contrast (3:1 for large headings) on every solid background, including primary/secondary buttons, hover states and disabled buttons. When changing only the background to beige or another light color, preserve readable button fills or pair light fills with dark text; never leave white text on beige or white. Set --on-primary and --on-secondary for the actual fills, not automatically to white. Never use opacity on an entire text-bearing button to show its disabled state; keep the text readable and distinguish the state with borders or other styling. Keep success/warning/danger distinguishable. For an existing semantic palette, change only these base variables, preserving component layouts, business data and unrelated local overrides. When explicitly converting a legacy theme to a shared palette, first derive the roles from its current colours and replace repeated hard-coded palette colours in its modules with role variables, preserving layouts and deliberate component exceptions. Do not merely add variables while leaving duplicated old colours in those modules. For one component's deliberate colour exception use its own CSS. Legacy --green/--cream/--line/--muted and --selected-bg/--selected-border/--selected-ink are bridged to the palette; do not redefine them for a new theme. Never define palette variables on .public-shop because that element is outside the scoped theme boundary.";
