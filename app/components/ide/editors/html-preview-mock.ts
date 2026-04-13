/** Build an inline <script> that provides window.gemihub with mock data from IndexedDB cache. */
export function buildMockGemihubScript(mockData: Record<string, string>): string {
  const escaped = JSON.stringify(mockData).replace(/</g, "\\u003c");
  return [
    "<script>",
    "(function(){",
    "var _m=" + escaped + ";",
    "function _r(p,path,e){",
    "path=path.split('?')[0].split('#')[0];",
    "var x=_m[p+path+e];if(x)return JSON.parse(x);",
    "var i=path.lastIndexOf('/'),d=i>=0?path.slice(0,i):'',pr=d?d+'/':'';",
    "for(var k in _m){if(k.indexOf(p+pr)!==0)continue;",
    "var b=k.slice((p+pr).length);",
    "if(/^\\[[^\\]]+\\]\\.json$/.test(b)&&b.indexOf('/')<0)return JSON.parse(_m[k]);}",
    "return null;}",
    "window.gemihub={",
    "get:function(p){var d=_r('web/__gemihub/api/',p,'.json');if(d!==null)return Promise.resolve(d);return Promise.reject(Object.assign(new Error('Not found'),{status:404}));},",
    "post:function(p){var d=_r('web/__gemihub/api/',p,'.json');if(d!==null)return Promise.resolve(d);return Promise.reject(Object.assign(new Error('Not found'),{status:404}));},",
    "auth:{",
    "me:function(t){var f=_m['web/__gemihub/auth/me.json'];if(!f)return Promise.resolve(null);try{var d=JSON.parse(f);",
    "if(!d||typeof d!=='object')return Promise.resolve(null);",
    "if(d.accountType&&d.accountType!==t)return Promise.resolve(null);",
    "var u={};for(var k in d)if(k!=='accountType')u[k]=d[k];u.type=t;return Promise.resolve(u);}catch(e){return Promise.resolve(null);}},",
    "login:function(){return Promise.resolve({ok:true});},",
    "logout:function(){return Promise.resolve({ok:true});},",
    "require:function(t,lp){return this.me(t).then(function(u){if(!u){location.href=(lp||'/login')+'?redirect='+encodeURIComponent(location.pathname+location.search);return new Promise(function(){});}return u;});}",
    "}};",
    "})();",
    "</" + "script>",
  ].join("");
}

export function buildHtmlPreviewSrcDoc(content: string, mockScript: string): string {
  const touchScript = `<script>
var _sx,_sy,_st;
document.addEventListener('touchstart',function(e){var t=e.touches[0];_sx=t.clientX;_sy=t.clientY;_st=Date.now();});
document.addEventListener('touchend',function(e){var t=e.changedTouches[0];
parent.postMessage({type:'gemihub-iframe-touch',sx:_sx,sy:_sy,st:_st,ex:t.clientX,ey:t.clientY,et:Date.now()},'*');});
${"<"}/script>`;
  let html = content;
  const apiJsPattern = /<script[^>]*src\s*=\s*["'][^"']*\/__gemihub\/api\.js["'][^>]*>\s*<\/script>/i;
  if (apiJsPattern.test(html)) {
    html = html.replace(apiJsPattern, "");
    if (mockScript) {
      const headPattern = /(<head[^>]*>)/i;
      if (headPattern.test(html)) {
        html = html.replace(headPattern, `$1${mockScript}`);
      } else {
        html = mockScript + html;
      }
    }
  }
  return html + touchScript;
}
