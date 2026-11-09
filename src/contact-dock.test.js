import test from 'node:test';
import assert from 'node:assert/strict';
import {clampDock,validDockPreference} from '../public/contact-dock.js';
test('dragged tools remain reachable at every viewport edge, including a zoomed viewport',()=>{
 const size={width:340,height:56};
 assert.deepEqual(clampDock({x:-400,y:2000},{width:375,height:700},size),{x:12,y:632});
 assert.deepEqual(clampDock({x:999,y:-50},{left:100,top:60,width:390,height:600},size),{x:138,y:72});
 assert.deepEqual(clampDock({x:100,y:100},{width:320,height:48},size),{x:12,y:12});
});
test('only finite normalized position preferences are restored after navigation or resize',()=>{
 for(const p of [{x:0,y:1},{x:.5,y:.25}])assert.ok(validDockPreference(p));
 for(const p of [null,{},[],{x:NaN,y:0},{x:1,y:Infinity},{x:'0',y:1},{x:-.1,y:1},{x:0,y:1.1}])assert.ok(!validDockPreference(p));
});
