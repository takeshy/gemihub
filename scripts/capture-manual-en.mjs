import fs from 'node:fs/promises';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Reuse the same interactions and screenshot names as the Japanese manual.
const catalog=JSON.parse(await fs.readFile('shared/en.json','utf8'));
const samples={
 '[[spec.md]]を参考に、この写真を使って秋のおすすめネイルを紹介してください。':'Refer to [[spec.md]] and use this photo to introduce our autumn nail designs.',
 '落ち着いたピンクを希望しています。':'I would like a soft, muted pink.',
 'この内容で予約する →':'Confirm booking →',
 'ご予約を承りました':'Your booking is confirmed',
 '山田 花子のお問い合わせを開く':'Open inquiry from Hanako Yamada',
 'もちろんです。当日、お好みやお仕事に合わせて一緒にお色を選びましょう。ご来店をお待ちしております。':"Of course. We can choose colors together to suit your preferences and work. We look forward to seeing you.",
 '水曜日も定休日にして、90分8,500円の「ご褒美ケアコース」を追加してください。':'Close on Wednesdays too, and add a 90-minute premium care service for 8,500 yen.',
 '水曜日も定休日に変更したいです。':"I'd like to close on Wednesdays too.",
 '初めてのお客様向けのFAQページを追加したいです。メニューには「よくある質問」と表示してください。':'Add a FAQ page for new customers, with Frequently asked questions as its navigation label.',
 '秋色ネイルで、季節を指先に。（お手入れのご案内を追加）':'Autumn colors at your fingertips (with care tips)',
 '保存して本番に反映しました':'Saved and applied to the live site',
 '施術の記録.png':'service-record.png',
 '山田':'Yamada',
 '落ち着いたピンクがお好み。次回は短めに整えます。':'Prefers muted pink. Keep the nails shorter next time.',
 'ファイル名（1）':'File name (1)',
 'ピンクの仕上がり.png':'pink-finish.png',
 'メモを投稿しました':'Note posted',
 'ショートボブ（前回）.png':'short-bob-previous.png',
 'ショートボブ（前回）.png を拡大表示':'Enlarge short-bob-previous.png',
 '1件目を編集':'Edit row 1',
 'データを保存しました':'Data saved',
 '季節の花の紹介画像.png':'seasonal-flowers.png',
 '明るい窓辺に季節の花を飾った、お店の紹介ページ向けの写真。やわらかな自然光で落ち着いた雰囲気にしてください。':'A shop introduction photo with seasonal flowers by a bright window. Use soft natural light and a calm atmosphere.',
 'お店の紹介.pngを選択':'Select shop-introduction.png',
 'AIで生成した画像を画像管理に保存しました':'The AI-generated image is saved to your library',
 '選んだ画像をよくある質問のページに使ってください。':'Use the selected image on the FAQ page.',
 '10:00':'10:00 AM',
};
const patterns={
 '/^AIに依頼する/':'/^Ask AI/',
 '/画像を添付$/':'/Attach image$/',
 '/お店のことを話す/':'/Tell us about your shop/',
 '/使いたいロゴはありますか/':'/Do you have a logo/',
 '/ほしい機能を次から選んでください。/':'/Choose the features/',
 '/予約一覧/':'/Bookings/',
 '/山田 花子 様/':'/Hanako Yamada/',
 '/秋色ネイルで/':'/Autumn colors/',
 '/^お客様一覧/':'/^Customers:/',
 '/様の画像一覧/':'/Images for/',
 '/のファイル名を変更$/':'/^Rename /',
 '/音声で依頼/':'/Request by voice/',
 '/文章で依頼/':'/Request in text/',
 '/AIとお店をつくる$/':'/Build your shop with AI$/',
};
let text=await fs.readFile('scripts/capture-manual.mjs','utf8');
const source=ts.createSourceFile('capture.mjs',text,ts.ScriptTarget.Latest,true),edits=[];
function visit(node){
 if(ts.isStringLiteral(node)){
  const value=samples[node.text]??catalog[node.text];
  if(value!==undefined)edits.push([node.getStart(source),node.end,JSON.stringify(value)]);
 }else if(node.kind===ts.SyntaxKind.RegularExpressionLiteral&&patterns[node.text])edits.push([node.getStart(source),node.end,patterns[node.text]]);
 ts.forEachChild(node,visit);
}
visit(source);
for(const [start,end,replacement] of edits.reverse())text=text.slice(0,start)+replacement+text.slice(end);
text=text.replace('await page.getByRole("heading", { name: ready, exact: true }).waitFor();','await page.getByRole("heading", { name: ready, exact: true }).first().waitFor();');
// Storybook's index keeps Japanese titles even when the rendered story is English.
text='import { readFileSync as readManualCatalog } from "node:fs";\nconst manualCatalog = JSON.parse(readManualCatalog("shared/en.json", "utf8"));\n'+text;
text=text.replace('entry.title === title', '(entry.title === title || manualCatalog[entry.title] === title)');
text=text.replace('locale: "ja-JP"','locale: "en-US"').replace('"public/manual"','"public/manual/en"').replace('&viewMode=story`','&viewMode=story&globals=locale:en`');
text=text.replace('  await capture("13-storage.jpg", ".data-overview");','  await capture("13-storage.jpg", ".data-overview");\n  await capture("21-system.jpg", ".shop-build-layout");');
text=text.replace('  assert.deepEqual(errors, []);', `
  await open("local-editor", "A little time for yourself.");
  await page.getByRole("button", { name: "Make changes", exact: true }).click();
  const canvas = page.getByLabel("Screen for circling the area to change");
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x+80,box.y+100); await page.mouse.down();
  for(let i=1;i<=30;i++){const a=i/30*Math.PI*2;await page.mouse.move(box.x+180+100*Math.cos(a),box.y+100+35*Math.sin(a));}
  await page.mouse.up();
  await page.getByLabel("How would you like to change this?").fill("Change this to Nails for every season");
  await capture("22-pen.jpg", ".annotation-canvas");
  assert.deepEqual(errors, []);`);
await fs.mkdir('tmp',{recursive:true});
const generated=resolve('tmp/capture-manual-en.generated.mjs');
await fs.writeFile(generated,text);
await import(pathToFileURL(generated).href);
