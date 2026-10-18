import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, safeErrorDetails, errorMessage } from './error-handling.js';

test('maps database uniqueness errors to actionable safe messages',()=>{
 assert.equal(classifyError({code:'23505',message:'duplicate email alice@example.com'}).kind,'conflict');
 assert.doesNotMatch(classifyError({code:'23505',message:'alice@example.com'}).message,/alice@example.com/);
});
test('recognizes expired sessions and network failures',()=>{
 assert.equal(classifyError({status:401}).kind,'auth');
 assert.equal(classifyError({message:'Failed to fetch'}).kind,'network');
});
test('does not log raw private data',()=>{
 assert.deepEqual(safeErrorDetails({name:'Error',status:403,code:'42501',message:'secret tenant address'}),{name:'Error',status:403,code:'42501'});
});

test('inventory conflicts and stale updates have actionable messages without leaking data',()=>{
 assert.match(errorMessage({code:'23P01'}),/occupied, held or blocked/);
 assert.match(errorMessage({code:'40001'}),/Another session/);
});
