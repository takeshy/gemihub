import type { Theme } from "../../shared/presentation";
export const exampleTheme: Theme = {
  headerHtml: '<header class="theme-masthead"><div class="theme-heading"><p class="theme-eyebrow">A SPACE FOR YOU</p><slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot></div><slot name="navigation"></slot></header>',
  bodyHtml: '<main class="theme-page"><div class="theme-rule" aria-hidden="true"></div><slot name="content"></slot></main>',
  footerHtml: '<footer class="theme-footer"><slot name="content"></slot></footer>',
  css: '',
  headerCss: '.theme-masthead{display:block;height:auto;padding:clamp(24px,6vw,84px);background:linear-gradient(135deg,var(--primary),var(--secondary));color:var(--on-primary)}.theme-heading{max-width:56rem}.theme-heading h1{font-size:clamp(36px,7vw,92px);line-height:1.1;letter-spacing:-.04em;margin:12px 0 24px}.theme-heading p{font-size:clamp(14px,2vw,19px);max-width:45rem}.theme-eyebrow{letter-spacing:.28em;font-size:11px!important}.theme-heading .salon-details{color:var(--on-primary)}.public-nav button,.public-nav a,.public-nav span{color:var(--on-primary);background:transparent;border:0}@media(max-width:600px){.theme-masthead{padding:28px 20px}}',
  bodyCss: '.theme-page{padding:clamp(16px,3vw,40px);background:var(--background);color:var(--text)}.theme-rule{height:4px;width:72px;background:var(--secondary);margin:0 0 24px}@media(max-width:600px){.theme-page{padding:16px}}',
  footerCss: '.theme-footer{height:auto;display:block;background:var(--primary);color:var(--on-primary);padding:24px 40px;text-align:center}.theme-footer p{margin:0}',
  styles: [
    {id:'base',component:'base',css:'.design-root{font-family:Georgia,serif;--primary:#70435c;--on-primary:#fff7ef;--secondary:#b67a62;--on-secondary:#261536;--background:#faf6f0;--surface:#fffdfb;--text:#2a1839;--muted-text:#715b75;--border:#d8cbbf;--primary-container:#f6edf2;--on-primary-container:#533049;--success:#34613e;--warning:#805400;--danger:#a52928}'},
    {id:'typography',component:'typography',css:'h2{font-size:clamp(24px,3vw,32px);line-height:1.3}p{line-height:1.8}a{color:var(--primary);text-decoration:underline;text-underline-offset:3px}'},
    {id:'buttons',component:'buttons',css:'button{border-radius:8px;padding:10px 18px;border:1px solid var(--primary);background:var(--surface);color:var(--on-primary-container)}button.primary{background:var(--primary);color:var(--on-primary)}button:hover{filter:brightness(.95)}button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}button:disabled{opacity:.5}@media(max-width:600px){button{min-height:44px}}'},
    {id:'cards',component:'cards',css:'.panel{border-radius:12px;border:1px solid var(--border);box-shadow:none;background:var(--surface);padding:20px}'},
    {id:'forms',component:'forms',css:'label{font-family:system-ui,sans-serif;font-size:14px}input,select,textarea{border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:10px;color:var(--text)}input:focus,select:focus,textarea:focus{outline:2px solid var(--focus);outline-offset:2px}input:disabled{background:var(--secondary-container)}'},
    {id:'icons',component:'icons',css:'.icon{color:var(--primary);stroke:currentColor;flex-shrink:0}'},
    {id:'notices',component:'notices',css:'.notice{border:1px solid var(--border);border-radius:8px;background:var(--primary-container);color:var(--on-primary-container);padding:12px}.alert{background:var(--danger-container);color:var(--danger);border:1px solid var(--danger);border-radius:8px;padding:12px}'},
    {id:'navigation',component:'navigation',css:'.public-nav{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:10px;margin-top:36px;background:transparent;border-top:1px solid #ffffff45;padding-top:20px}.public-nav button,.public-nav a,.public-nav span{font:14px system-ui;padding:8px 12px}@media(max-width:600px){.public-nav{gap:4px}.public-nav button,.public-nav a,.public-nav span{font-size:12px;padding:8px}}'},
  ],
};
export const contrastTheme: Theme = {
  ...exampleTheme,
  styles: exampleTheme.styles!.map(style => style.component === 'base' ? { ...style, css: style.css.replaceAll('#70435c', '#006d77').replaceAll('#b67a62', '#1a5261').replaceAll('#261536', '#102c40').replaceAll('#faf6f0', '#f0f7fa').replaceAll('#2a1839', '#102c40').replaceAll('#715b75', '#476575').replaceAll('#d8cbbf', '#acc7cd').replaceAll('#f6edf2', '#e0f4f4').replaceAll('#533049', '#102c40') } : style),
};
