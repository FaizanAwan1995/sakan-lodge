import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderListing} from '../src/public-site.js';
import {utilityPolicy} from '../src/utility-policy.js';

test('general contact links stay on the website and empty suburbs keep selected location',async()=>{
 const home=readFileSync(new URL('../public/landing.html',import.meta.url),'utf8');
 assert.ok(home.includes('href="/enquire">Contact</a>'));
 const page=await renderListing({kind:'location',suburb:'oaklands-park'},{properties:[],rooms:[]}).text();
 assert.ok(page.includes('href="/enquire">Contact</a>'));assert.ok(page.includes('href="/enquire?location=Oaklands%20Park">Enquire about availability'));
 assert.ok(!page.includes('mailto:sakanlodges@gmail.com">Contact</a>'));
});
test('each suburb shows its own allowance without another suburb policy',async()=>{
 for(const [slug,name,amount] of [['fulham','Fulham','$1,000'],['clapham','Clapham','$800'],['oaklands-park','Oaklands Park','$1,000']]){
  assert.ok(utilityPolicy(slug).includes(name+' electricity allowance: '+amount));
  const page=await renderListing({kind:'location',suburb:slug},{properties:[],rooms:[]}).text();
  assert.ok(page.includes(name+' electricity allowance: '+amount));
  assert.ok(!page.includes('At Fulham, the property electricity allowance'));
 }
});
