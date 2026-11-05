import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const english=JSON.parse(fs.readFileSync('shared/en.json','utf8'));
const placeholders=value=>[...value.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort((a,b)=>Number(a)-Number(b));
for(const [source,target] of Object.entries(english)){
  assert.equal(typeof target,'string',source);
  assert.deepEqual(placeholders(target),placeholders(source),`Interpolation mismatch: ${source}`);
}
const missing=[];
const files=['src','server'].flatMap(dir=>fs.readdirSync(dir,{recursive:true}).filter(file=>/\.tsx?$/.test(file)).map(file=>`${dir}/${file}`));
files.push('shared/shop-infographic.ts');
let used=0;
for(const file of files){const text=fs.readFileSync(file,'utf8');const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);function visit(n){
 if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='tr'){
  const arg=n.arguments[0];if(arg&&ts.isStringLiteral(arg)){used++;if(!(arg.text in english))missing.push(`${file}:${source.getLineAndCharacterOfPosition(arg.pos).line+1}: ${arg.text}`);}
 }
 if(file.endsWith('.stories.tsx')&&ts.isStringLiteral(n)&&ts.isPropertyAssignment(n.parent)&&['title','name'].includes(n.parent.name.getText(source))){
  for(const label of n.text.split('/'))if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(label)&&!(label in english))missing.push(`${file}: Storybook label: ${label}`);
 }
 ts.forEachChild(n,visit);
}visit(source);}
assert.deepEqual(missing,[],'Missing English translations');
console.log(`Checked ${Object.keys(english).length} translations, placeholders, and ${used} source references.`);
// Find untranslated source copy too, rather than checking only existing tr calls.
const raw=[];
const sourceConstants=new Set(['initialFeatureQuestion','additionalPagesQuestion','finalDetailsQuestion','shopNameQuestion','logoQuestion','logoUploadQuestion','adaptiveQuestionInstruction','requestImageInstruction']);
for(const file of files.filter(file=>!file.endsWith('.stories.tsx'))){
 const text=fs.readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function visit(n){
  let value;
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n))value=n.text;
  if(ts.isTemplateExpression(n))value=n.head.text+n.templateSpans.map((span,i)=>`{${i}}`+span.literal.text).join('');
  if(value&&/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value)){
   const parent=n.parent;
   const translated=ts.isCallExpression(parent)&&ts.isIdentifier(parent.expression)&&parent.expression.text==='tr'&&parent.arguments[0]===n;
   const name=ts.isPropertyAssignment(parent)&&parent.name===n||ts.isLiteralTypeNode(parent);
   const constant=ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name)&&sourceConstants.has(parent.name.text);
   const dictation=file==='src/dictation.ts'&&value==='以上';
   const switcher=file==='src/LanguageSwitcher.tsx'&&['日本語','Language / 言語'].includes(value);
   let stopWords=false;
   if(file==='server/chat-context.ts'){let p=n.parent;while(p){if(ts.isVariableDeclaration(p)&&p.name.getText(source)==='ignored')stopWords=true;p=p.parent;}}
   if(constant)assert.ok(value in english,`Missing constant translation: ${file}`);
   if(!translated&&!name&&!constant&&!dictation&&!switcher&&!stopWords)raw.push(`${file}:${source.getLineAndCharacterOfPosition(n.pos).line+1}: ${value.slice(0,100)}`);
  }
  ts.forEachChild(n,visit);
 }
 visit(source);
}
assert.deepEqual(raw,[],'Untranslated Japanese literals (data, identifiers, parser regexes, and language names require explicit handling)');
console.log('No untranslated application literals outside documented language/parser constants.');
