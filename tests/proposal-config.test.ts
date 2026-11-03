import {test} from "node:test";
import assert from "node:assert/strict";
import {sample} from "../server/domain.ts";
import {proposalConfig} from "../server/proposal-config.ts";

test("partial refund proposals preserve payment enablement and all unrelated saved fields",()=>{
  const current={...structuredClone(sample),header:{...sample.header,title:"Saved title"},rules:{...sample.rules,payment:{enabled:true,refundTiers:[{hoursBefore:72,percent:100},{hoursBefore:24,percent:50},{hoursBefore:0,percent:0}]}}};
  const tiers=[{hoursBefore:72,percent:100},{hoursBefore:0,percent:0}];
  const result=proposalConfig({rules:{payment:{refundTiers:tiers}}},current);
  assert.deepEqual(result,{...current,rules:{...current.rules,payment:{...current.rules.payment,refundTiers:tiers}}});
  assert.equal(current.rules.payment.refundTiers.length,3);
});
test("incomplete array replacements, invalid payment tiers and unsafe keys stay rejected",()=>{
  for(const patch of [{menus:[{name:"Missing price"}]},{rules:{payment:{enabled:true,refundTiers:[{hoursBefore:24,percent:100}]}}},JSON.parse('{"rules":{"__proto__":{"polluted":true}}}')])assert.throws(()=>proposalConfig(patch,sample));
  assert.equal(({} as any).polluted,undefined);
});
test("complete proposals keep existing deletion semantics",()=>{
  const full=structuredClone(sample);full.appearance=undefined;
  assert.deepEqual(proposalConfig(full,sample),full);
});
