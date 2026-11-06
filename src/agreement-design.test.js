import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementDesign } from './agreement-design.js';
test('old agreements retain default design and new options are bounded',()=>{
 assert.equal(agreementDesign().title,'ROOMING HOUSE AGREEMENT');
 assert.deepEqual(agreementDesign({title:'TENANCY',theme:'forest',fontSize:12,showLogo:false}),{title:'TENANCY',theme:'forest',fontSize:12,showLogo:false});
 for(const value of [{title:'x'.repeat(33)},{theme:'unknown'},{fontSize:99},{showLogo:'false'}])assert.throws(()=>agreementDesign(value));
});
