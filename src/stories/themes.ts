import type { Theme } from "../../shared/presentation";
export const exampleTheme: Theme = {
  headerHtml: '<header class="theme-masthead"><div class="theme-heading"><p class="theme-eyebrow">A SPACE FOR YOU</p><slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot></div><slot name="navigation"></slot></header>',
  bodyHtml: '<main class="theme-page"><div class="theme-rule" aria-hidden="true"></div><slot name="content"></slot></main>',
  footerHtml: '<footer class="theme-footer"><slot name="content"></slot></footer>',
  css: '',
  headerCss: '.theme-masthead{display:block;height:auto;padding:clamp(24px,6vw,84px);background:linear-gradient(135deg,#261536,#573558);color:#fff7ef}.theme-heading{max-width:56rem}.theme-heading h1{font-size:clamp(36px,7vw,92px);line-height:1.1;letter-spacing:-.04em;margin:12px 0 24px}.theme-heading p{font-size:clamp(14px,2vw,19px);max-width:45rem}.theme-eyebrow{letter-spacing:.28em;font-size:11px!important}.theme-heading .salon-details{color:#eee0e8}.public-nav button,.public-nav a,.public-nav span{color:#fff7ef;background:transparent;border:0}@media(max-width:600px){.theme-masthead{padding:28px 20px}}',
  bodyCss: '.theme-page{padding:clamp(16px,3vw,40px);background:#faf6f0;color:#2a1839}.theme-rule{height:4px;width:72px;background:#b67a62;margin:0 0 24px}@media(max-width:600px){.theme-page{padding:16px}}',
  footerCss: '.theme-footer{height:auto;display:block;background:#261536;color:#fff7ef;padding:24px 40px;text-align:center}.theme-footer p{margin:0}',
  styles: [
    {id:'base',component:'base',css:'.design-root{font-family:Georgia,serif;--shop-accent:#70435c;--shop-line:#d8cbbf}'},
    {id:'typography',component:'typography',css:'h2{font-size:clamp(24px,3vw,32px);line-height:1.3}p{line-height:1.8}a{color:#70435c;text-decoration:underline;text-underline-offset:3px}'},
    {id:'buttons',component:'buttons',css:'button{border-radius:8px;padding:10px 18px;border:1px solid #70435c;background:#fff;color:#533049}button.primary{background:var(--shop-accent,#70435c);color:#fff}button:hover{filter:brightness(.95)}button:focus-visible{outline:3px solid #b67a62;outline-offset:3px}button:disabled{opacity:.5}@media(max-width:600px){button{min-height:44px}}'},
    {id:'cards',component:'cards',css:'.panel{border-radius:12px;border:1px solid #d8cbbf;box-shadow:none;background:#fffdfb;padding:20px}'},
    {id:'forms',component:'forms',css:'label{font-family:system-ui,sans-serif;font-size:14px}input,select,textarea{border:1px solid #bca8b5;border-radius:8px;background:#fff;padding:10px;color:#2a1839}input:focus,select:focus,textarea:focus{outline:2px solid #70435c;outline-offset:2px}input:disabled{background:#eee}'},
    {id:'icons',component:'icons',css:'.icon{color:#70435c;stroke:currentColor;flex-shrink:0}'},
    {id:'notices',component:'notices',css:'.notice{border:1px solid #d8cbbf;border-radius:8px;background:#f6edf2;color:#533049;padding:12px}.alert{background:#fff0ef;color:#a52928;border:1px solid #d79995;border-radius:8px;padding:12px}'},
    {id:'navigation',component:'navigation',css:'.public-nav{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:10px;margin-top:36px;background:transparent;border-top:1px solid #ffffff45;padding-top:20px}.public-nav button,.public-nav a,.public-nav span{font:14px system-ui;padding:8px 12px}@media(max-width:600px){.public-nav{gap:4px}.public-nav button,.public-nav a,.public-nav span{font-size:12px;padding:8px}}'},
  ],
};
export const contrastTheme: Theme = {
  ...exampleTheme,
  headerCss: exampleTheme.headerCss!.replaceAll('#261536','#102c40').replaceAll('#573558','#1a5261'),
  bodyCss: exampleTheme.bodyCss!.replaceAll('#faf6f0','#f0f7fa').replaceAll('#2a1839','#102c40'),
  footerCss: exampleTheme.footerCss!.replaceAll('#261536','#102c40'),
  styles: exampleTheme.styles!.map(style=>({...style,css:style.css.replaceAll('#70435c','#006d77').replaceAll('#533049','#102c40').replaceAll('#d8cbbf','#acc7cd').replaceAll('#f6edf2','#e0f4f4')})),
};
