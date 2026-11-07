import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../public/general-enquiry.js',import.meta.url),'utf8');
function node(){return{events:{},textContent:'',disabled:false,addEventListener(type,fn){this.events[type]=fn;},setAttribute(){},before(){}};}
async function fixture(pathname='/enquire',trackingFails=false){
 const form=node(),dialog=node(),button=node(),open=node(),close=node(),created=[],calls=[];let widget,fail=false,resets=0,navigated;const events=[];
 form.reportValidity=()=>true;form.querySelector=()=>button;form.reset=()=>{form.resetCount=(form.resetCount||0)+1;};dialog.showModal=()=>{};dialog.close=()=>dialog.events.close?.();
 const ids={'general-enquiry':dialog,'general-enquiry-form':form,'open-enquiry':open,'close-enquiry':close};
 const document={getElementById:id=>ids[id],querySelector:()=>null,createElement:()=>{const n=node();created.push(n);return n;}};
 const fields={full_name:'Synthetic Guest',email:'guest@example.test',phone:'0400000000',location:'Fulham',accommodation:'Private room',occupants:'2',message:'Granny flat'};
 const context={document,window:{dataLayer:trackingFails?{push(){throw Error('Blocked measurement');}}:events,location:{pathname,assign(path){navigated=path;}},turnstile:{render(el,options){widget=options;return 1;},reset(){resets++;}}},crypto,AbortSignal,setTimeout,clearTimeout,FormData:class{get(key){return fields[key]||'';}[Symbol.iterator](){return Object.entries({...fields,'cf-turnstile-response':crypto.randomUUID()})[Symbol.iterator]();}},fetch:async(url,options)=>{
  if(!options?.method)return {ok:true,json:async()=>({enabled:true,site_key:'public'})};calls.push(options);if(fail)throw Error('Network timeout');return {ok:true,json:async()=>({received:true,reference:'ENQ-DEMO',message:'Received'})};
 }};
 vm.runInNewContext(script,context);await open.events.click({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 return {form,dialog,button,open,events,navigated:()=>navigated,widget:()=>widget,calls,status:created[0],setFail:value=>fail=value,resets:()=>resets,submit:()=>form.events.submit({preventDefault(){}})};
}
test('website enquiry confirms saved receipt once, retains retry identifier and resets after closing',async()=>{
 const c=await fixture();assert.equal(c.button.disabled,true);c.widget().callback('verified');assert.equal(c.button.disabled,false);
 c.setFail(true);await c.submit();assert.match(c.status.textContent,/Network timeout/);assert.equal(c.form.resetCount,undefined);assert.equal(c.resets(),1);assert.equal(c.events.length,0);
 c.setFail(false);c.widget().callback('verified-again');await c.submit();assert.equal(c.calls[0].headers['Idempotency-Key'],c.calls[1].headers['Idempotency-Key']);assert.match(c.status.textContent,/ENQ-DEMO/);assert.equal('cf-turnstile-response' in JSON.parse(c.calls[1].body),false);assert.equal(c.button.disabled,true);assert.equal(c.events.length,1);assert.equal(c.events[0].event,'sakan_enquiry_received');assert.deepEqual(Object.keys(c.events[0]).sort(),['enquiry_id','event']);
 await c.submit();assert.equal(c.events.length,1);assert.equal(c.calls.length,2);c.dialog.close();assert.equal(c.form.resetCount,1);await c.open.events.click({preventDefault(){}});assert.equal(c.resets(),2);
});

test('existing enquiry button navigates to the shared enquiry URL',async()=>{
 const c=await fixture('/');assert.equal(c.navigated(),'/enquire');assert.equal(c.widget(),undefined);
});

test('a blocked measurement hook cannot change a confirmed enquiry into a failure',async()=>{
 const c=await fixture('/enquire',true);c.widget().callback('verified');await c.submit();
 assert.equal(c.button.textContent,'Enquiry received');assert.match(c.status.textContent,/ENQ-DEMO/);assert.equal(c.calls.length,1);
});
