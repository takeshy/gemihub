import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApiResponse } from '../src/api-response.ts';
import { requestLocale } from '../server/i18n.ts';

test('plain upstream timeout responses become readable errors instead of JSON syntax errors', async()=>{
  for(const locale of ['ja','en'] as const)await requestLocale.run(locale,async()=>{
    await assert.rejects(readApiResponse(new Response('upstream request timeout',{status:504})),(error:Error&{status?:number})=>error.status===504&&!(error instanceof SyntaxError)&&/タイムアウト|timed out/.test(error.message));
    await assert.rejects(readApiResponse(new Response('<html>internal proxy details</html>',{status:502})),(error:Error&{status?:number})=>error.status===502&&error.message.includes('502')&&!error.message.includes('internal proxy'));
  });
});
test('JSON successes and application errors keep their existing meaning',async()=>{
  assert.deepEqual(await readApiResponse(new Response('{"ok":true}')),{ok:true});
  assert.equal(await readApiResponse(new Response('null')),null);
  await assert.rejects(readApiResponse(new Response('{"error":"State changed"}',{status:409})),{message:'State changed',status:409});
  await assert.rejects(readApiResponse(new Response('broken JSON')),(error:Error)=>!(error instanceof SyntaxError));
});
