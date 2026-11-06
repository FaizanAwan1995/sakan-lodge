import test from 'node:test';
import assert from 'node:assert/strict';
import { validWeeklyRent } from './rent-input.js';
test('weekly rent accepts cents without floating point rejection',()=>{
 for(const value of ['300.10','255.01','185','10000.00']) assert.equal(validWeeklyRent(value),true,value);
 for(const value of ['300.101','0','-1','Infinity','NaN','','10000.01','1e2']) assert.equal(validWeeklyRent(value),false,value);
});
