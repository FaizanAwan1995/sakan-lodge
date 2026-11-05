import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handlePublicSite} from '../src/public-site.js';
import {MUSLIM_PATH} from '../src/muslim-friendly-accommodation.js';

const base = 'https://sakanlodge.com';

test('Muslim-friendly accommodation guide is public, canonical and contactable', async () => {
  const response = await handlePublicSite(new Request(base + MUSLIM_PATH), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const body = await response.text();
  assert.match(body, /<h1>Muslim-friendly accommodation in Adelaide<\/h1>/);
  assert.match(body, /<link rel="canonical" href="https:\/\/sakanlodge\.com\/muslim-friendly-accommodation-adelaide\/"/);
  assert.match(body, /<meta name="robots" content="index,follow/);
  assert.match(body, /halal-suitable/);
  assert.match(body, /from people of all backgrounds/);
  assert.match(body, /https:\/\/wa\.me\/61426721787\?/);
  assert.match(body, /mailto:sakanlodges@gmail\.com/);
  assert.match(body, /href="\/accommodation\/women\/"/);
  assert.match(body, /href="\/accommodation\/men\/"/);
  assert.match(body, /href="\/accommodation\/couples\/"/);
  assert.match(body, /\$185 per person/);
  assert.match(body, /\$255/);
  assert.match(body, /\$300/);
  assert.doesNotMatch(body, /Muslims only|Muslim-only household is guaranteed/i);
  assert.match(body, /"@type":"BreadcrumbList"/);
});

test('Guide redirects missing trailing slash and preserves search parameters', async () => {
  const response = await handlePublicSite(new Request(base + '/muslim-friendly-accommodation-adelaide?ref=search'), {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), base + MUSLIM_PATH + '?ref=search');
});

test('Guide does not accept unsafe write requests', async () => {
  const response = await handlePublicSite(new Request(base + MUSLIM_PATH, {method: 'POST'}), {});
  assert.equal(response.status, 405);
});

test('Homepage links to guide and uses descriptive search metadata', () => {
  const landing = readFileSync(new URL('../public/landing.html', import.meta.url), 'utf8');
  assert.match(landing, /<title>Rooms for Rent in Adelaide \| SAKAN Lodge<\/title>/);
  assert.match(landing, /href="\/muslim-friendly-accommodation-adelaide\/"/);
  assert.match(landing, /rel="icon" type="image\/png" sizes="540x540" href="\/sakan-logo-circle-main.png"/);
});

test('Public sitemap includes search guide and never includes private Ledger', () => {
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert.match(sitemap, /https:\/\/sakanlodge\.com\/muslim-friendly-accommodation-adelaide\//);
  assert.doesNotMatch(sitemap, /\/ledger\//);
});
