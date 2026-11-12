import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {findLowContrastText} from '../shared/contrast-check.ts';
import {captureVisualScreens} from '../server/visual-browser.ts';
import {checkInitialThemeContrast} from '../server/visual-review.ts';
import {createInitialTheme} from '../server/initial-theme.ts';
import {sample} from '../server/domain.ts';
import {standardTheme} from '../shared/theme-editing.ts';
process.env.CHROMIUM ||= '/usr/bin/chromium-browser';
await mkdir('tmp/theme-contrast',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--no-sandbox']});
try{
  const page=await browser.newPage();
  await page.setContent('<main id="test" style="background:#fff"><button style="background:#f4ede3;color:white">White on beige</button><button disabled style="background:#f4ede3;color:white">Disabled white on beige</button><button style="background:#f4ede3;color:#352d25">Readable beige</button><div style="opacity:.1"><button style="color:#000;background:#fff">Faded whole control</button></div><h2 style="color:transparent">Invisible heading</h2><button style="background:linear-gradient(black,white);color:white">Gradient requires pixel review</button></main>');
  const problems=await page.evaluate(findLowContrastText,'#test');
  assert.ok(problems.some(issue=>issue.text==='White on beige'&&issue.ratio<1.5));
  assert.ok(problems.some(issue=>issue.disabled&&issue.ratio<1.5));
  assert.ok(problems.some(issue=>issue.text==='Faded whole control'&&issue.ratio<1.5));
  assert.ok(problems.some(issue=>issue.text==='Invisible heading'&&issue.ratio===1));
  assert.ok(!problems.some(issue=>issue.text==='Readable beige'||issue.text.includes('Gradient')));
}finally{await browser.close();}

const colors='.design-root{--primary:#f4ede3;--on-primary:#ffffff;--secondary:#6b4e3b;--on-secondary:#fff;--background:#f4ede3;--surface:#fffaf3;--text:#352d25;--muted-text:#655c54}';
const bad={...standardTheme,css:colors+'.primary:disabled{opacity:.1}'};
const fixed={...bad,css:bad.css.replace('--primary:#f4ede3','--primary:#6b4e3b')};
const config=theme=>({...structuredClone(sample),menus:[],staff:[],ownerBooking:true,appearance:{accent:'sage',layout:'standard',imageUrl:'',theme}});
for(const [name,theme]of [['bad',bad],['fixed',fixed],['default',standardTheme],['dark',{...fixed,css:fixed.css.replace('--primary:#6b4e3b','--primary:#e7cdb4').replace('--on-primary:#ffffff','--on-primary:#352d25').replace('--secondary:#6b4e3b','--secondary:#b8cbbb').replace('--on-secondary:#fff','--on-secondary:#17221a').replace('--background:#f4ede3','--background:#171a20').replace('--surface:#fffaf3','--surface:#242932').replace('--text:#352d25','--text:#f8f0e6').replace('--muted-text:#655c54','--muted-text:#c9c3b9')}]]){
  const shots=await captureVisualScreens({config:config(theme),screen:'initial-theme',locale:'en',options:{},images:{}});
  for(const shot of shots){
    await writeFile(`tmp/theme-contrast/${name}-${shot.width}.jpg`,Buffer.from(shot.data,'base64'));
    if(name==='bad'){
      assert.ok(shot.contrastIssues.some(issue=>issue.element==='button.primary'&&!issue.disabled&&issue.ratio<1.5));
      assert.ok(shot.contrastIssues.some(issue=>issue.disabled&&issue.ratio<1.5));
    }else assert.deepEqual(shot.contrastIssues,[],`${name} ${shot.width}px`);
  }
}
let generations=0,reviews=0;
const result=await createInitialTheme({config:config(standardTheme),request:'Make the background beige',images:[]},{checkContrast:theme=>checkInitialThemeContrast(theme,[])},async request=>{
  if(request.purpose==='review'){reviews++;return JSON.stringify({approved:true,issues:[],imageUsage:[]});}
  generations++;if(generations===2)assert.match(JSON.stringify(request.contents),/4.5:1/);
  return JSON.stringify(generations===1?bad:fixed);
});
assert.equal(result.review.approved,true);assert.equal(generations,2);assert.equal(reviews,1,'bad contrast is rejected without a model review call');
console.log('Solid colors, transparency, nested opacity, disabled controls, gradients, beige/dark/default themes at 1280/390px and initial automatic repair passed.');
