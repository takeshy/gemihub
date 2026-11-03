import {test} from "node:test";
import assert from "node:assert/strict";
import {sample,shopSchema,slots,hoursText,ownerStaffId} from "../server/domain.ts";
import {applySettingsFacts,settingsChanges} from "../server/settings-ai.ts";
import {requestLocale} from "../server/i18n.ts";

test("weekday opening hours apply to solo owner slots, closing boundaries and closed days",()=>{
  const config=shopSchema.parse({...structuredClone(sample),staff:[],ownerBooking:true,hours:{start:"09:00",end:"19:00",closedWeekdays:[3],holidays:[],weekdayHours:[{day:2,start:"09:00",end:"21:00"},{day:5,start:"09:00",end:"21:00"}]},rules:{...sample.rules,leadMinutes:0,advanceDays:30,sameDay:true}});
  const now=new Date("2026-11-01T00:00:00+09:00");
  for(const date of ["2026-11-03","2026-11-06"]){const choices=slots(config,[],date,"simple",undefined,now);assert.equal(choices[0].staffId,ownerStaffId);assert.equal(choices.at(-1)!.end,`${date}T12:00:00.000Z`);assert.ok(choices.some(slot=>slot.start===`${date}T11:00:00.000Z`));}
  for(const date of ["2026-11-02","2026-11-07"]){const choices=slots(config,[],date,"simple",undefined,now);assert.equal(choices.at(-1)!.end,`${date}T10:00:00.000Z`);assert.ok(!choices.some(slot=>Date.parse(slot.end)>Date.parse(`${date}T10:00:00Z`)));}
  config.hours.weekdayHours!.push({day:3,start:"09:00",end:"21:00"});assert.deepEqual(slots(config,[],"2026-11-04","simple",undefined,now),[],"regular closure wins over a weekday override");
  config.hours.holidays=["2026-11-06"];assert.deepEqual(slots(config,[],"2026-11-06","simple",undefined,now),[],"temporary closure wins over a weekday override");
  assert.match(requestLocale.run("ja",()=>hoursText(config)),/火曜 09:00 – 21:00/);
});

test("weekday hours validate unique days and time ranges; AI suggestions preserve structured hours",()=>{
  const config=structuredClone(sample);
  for(const weekdayHours of [[{day:2,start:"21:00",end:"19:00"}],[{day:2,start:"09:00",end:"21:00"},{day:2,start:"10:00",end:"19:00"}],[{day:7,start:"09:00",end:"21:00"}]])assert.equal(shopSchema.safeParse({...config,hours:{...config.hours,weekdayHours}}).success,false);
  const result=applySettingsFacts(config,"hours",{start:"09:00",end:"19:00",weekdayHours:[{day:2,start:"09:00",end:"21:00"},{day:5,start:"09:00",end:"21:00"}]});
  assert.equal(result.config.hours.weekdayHours!.length,2);assert.deepEqual(result.config.staff,config.staff);
  const differences=requestLocale.run("ja",()=>settingsChanges(config,result.config,"hours"));assert.ok(differences.some(change=>change.label==="曜日ごとの営業時間"&&change.after.includes("火 09:00–21:00")&&change.after.includes("金 09:00–21:00")));assert.ok(!JSON.stringify(differences).includes("[object Object]"));
});
