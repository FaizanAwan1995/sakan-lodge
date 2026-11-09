import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

test('deployment guard allows current main, skips stale commits and fails closed on lookup failure',()=>{
 const root=mkdtempSync(join(tmpdir(),'sakan-deploy-'));
 try{
  const remote=join(root,'remote.git'),repo=join(root,'repo'),bin=join(root,'bin'),marker=join(root,'deployed');
  mkdirSync(repo);mkdirSync(bin);
  const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,stdio:'pipe'});
  git(['init','--bare',remote]);git(['init','--initial-branch=main']);git(['remote','add','origin',remote]);
  const commit=()=>git(['-c','user.name=Synthetic test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','test']);
  commit();git(['push','origin','main']);
  writeFileSync(join(bin,'npx'),'#!/bin/sh\ntouch "$SAKAN_TEST_MARKER"\n',{mode:0o755});
  const run=()=>spawnSync(process.execPath,[resolve('scripts/deploy-current.mjs')],{cwd:repo,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,SAKAN_TEST_MARKER:marker}});
  assert.equal(run().status,0);assert.ok(existsSync(marker));rmSync(marker);
  commit();const stale=run();assert.equal(stale.status,0);assert.match(stale.stdout,/Skipping outdated build/);assert.equal(existsSync(marker),false);
  git(['remote','set-url','origin',join(root,'missing.git')]);assert.notEqual(run().status,0);assert.equal(existsSync(marker),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
