import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/booking.js',import.meta.url),'utf8');
function setup({submit=null,spaces=1,enabled=false,fails=false}={}) {
 const formEvents={},checkEvents={},calls=[];
 const field=value=>({value,reportValidity:()=>true});
 const form={dataset:{room:'synthetic-room'},elements:{arrival_date:field('2030-01-01'),departure_date:field('2030-03-01'),spaces_requested:field('1')},addEventListener:(n,f)=>{formEvents[n]=f;}};
 const result={textContent:''},message={},check={addEventListener:(n,f)=>{checkEvents[n]=f;}};
 const elements={'#reservation-form':form,'#availability-result':result,'#request-result':message,'#check-availability':check,'#submit-request':submit};
 vm.runInNewContext(source,{document:{querySelector:s=>elements[s]},Intl,Date,crypto,URLSearchParams,fetch:async(url)=>{calls.push(url);return {ok:!fails,json:async()=>fails?{error:'Unable to verify availability'}:{spaces,weekly_rate:255,requests_enabled:enabled}};}});
 return {formEvents,checkEvents,calls,result,check,submit};
}
test('availability-only page checks dates with no submit button or personal-data form',async()=>{
 const c=setup();await c.checkEvents.click();assert.equal(c.calls.length,1);assert.ok(c.calls[0].startsWith('/api/availability?'));assert.match(c.result.textContent,/1 space\(s\) available/);assert.match(c.result.textContent,/Online requests are currently unavailable/);assert.equal(c.check.disabled,false);
 let prevented=false;c.formEvents.submit({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(c.calls.length,1);
});
test('request button stays disabled when the database request gate is off',async()=>{
 const c=setup({submit:{disabled:true}});await c.checkEvents.click();assert.equal(c.submit.disabled,true);assert.match(c.result.textContent,/currently unavailable/);
});
test('request button requires enabled requests and sufficient checked capacity',async()=>{
 const c=setup({submit:{disabled:true},enabled:true});await c.checkEvents.click();assert.equal(c.submit.disabled,false);
 const full=setup({submit:{disabled:true},enabled:true,spaces:0});await full.checkEvents.click();assert.equal(full.submit.disabled,true);
 const failure=setup({submit:{disabled:true},enabled:true,fails:true});await failure.checkEvents.click();assert.equal(failure.submit.disabled,true);assert.match(failure.result.textContent,/Unable to verify/);
});
