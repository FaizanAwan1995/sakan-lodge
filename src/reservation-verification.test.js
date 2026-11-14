import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/reservation-verification.js',import.meta.url),'utf8');
async function setup({blocked=false}={}) {
 let config,expired=false;const resets=[],elements=[],scriptEvents={};
 const script={addEventListener:(n,fn)=>{scriptEvents[n]=fn;},removeEventListener:()=>{},remove:()=>{}};
 const container={dataset:{sitekey:'synthetic'},after:()=>{},scrollIntoView:()=>{container.scrolled=true;}};
 const context={setTimeout,clearTimeout,Promise,Error,document:{createElement:()=>{const e={hidden:false,setAttribute:()=>{},addEventListener:(n,fn)=>{e[n]=fn;}};elements.push(e);return e;},querySelector:()=>script,head:{append:()=>{}}},window:{}};
 if(!blocked)context.window.turnstile={ready:()=>{throw Error('ready() is unsupported with async/defer; render after load instead');},render:(_container,c)=>{config=c;return 'reservation-widget';},reset:id=>{resets.push(id);expired=false;},isExpired:()=>expired};
 vm.runInNewContext(source,context);
 const manager=context.window.SakanReservationVerification.create(container);
 for(let i=0;i<8;i++)await Promise.resolve();
 return {manager,get config(){return config;},resets,container,elements,scriptEvents,expire:()=>{expired=true;config['expired-callback']();}};
}
test('reservation security widget stays visible and a current token submits without resetting',async()=>{
 const s=await setup();assert.equal(s.config.appearance,'always');assert.equal(s.config['refresh-expired'],'auto');
 s.config.callback('fresh-token');assert.equal(await s.manager.getToken(),'fresh-token');assert.deepEqual(s.resets,[]);
 s.manager.complete();assert.equal(s.container.hidden,true);
});
test('expired verification refreshes the specific reservation widget and resumes the pending submission',async()=>{
 const s=await setup();s.config.callback('old-token');s.expire();
 const waiting=s.manager.getToken();for(let i=0;i<8;i++)await Promise.resolve();
 assert.deepEqual(s.resets,['reservation-widget']);assert.equal(s.container.scrolled,true);
 s.config.callback('replacement-token');assert.equal(await waiting,'replacement-token');
});
test('verification failures display a retry action and never pass a missing token to submission',async()=>{
 const s=await setup();const waiting=s.manager.getToken();for(let i=0;i<8;i++)await Promise.resolve();
 s.config['error-callback']();await assert.rejects(waiting,/could not finish/);
 assert.equal(s.elements[1].hidden,false);assert.match(s.elements[0].textContent,/details and IDs are kept/);
});
test('blocked verification script reports a recoverable loading error',async()=>{
 const s=await setup({blocked:true});const waiting=s.manager.getToken();s.scriptEvents.error();
 await assert.rejects(waiting,/could not (load|start)/);assert.equal(s.elements[1].hidden,false);
});
