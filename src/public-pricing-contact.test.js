import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../public/landing.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/site-ui.css", import.meta.url), "utf8");
const concierge = readFileSync(new URL("../public/room-guide.js", import.meta.url), "utf8");

test("all four published rates are consistently carded and carry accessible enquiry actions", () => {
  const section = html.split('<section class="section rates-section"')[1]?.split('</section>')[0];
  assert.ok(section, "weekly rates section exists");
  assert.equal((section.match(/class="rate-card(?: featured| rate-card-couples)?"/g) || []).length, 4);
  for (const price of ["$185", "$255", "$300", "$500"]) assert.ok(section.includes(price));
  assert.equal((section.match(/class="rate-cta"/g) || []).length, 4);
  assert.match(section, /electricity · water · gas · internet/);
  assert.match(css, /rate-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(min-width:1180px\)/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /rate-card\{[^}]*display:flex;flex-direction:column/);
});

test("concierge uses allowlisted safe clickable URLs, never model-authored HTML", () => {
  assert.match(concierge, /CONTACT_URLS = \[/);
  assert.match(concierge, /https:\/\/sakanlodge\.com\/enquire/);
  assert.match(concierge, /https:\/\/wa\.me\/61426721787/);
  assert.match(concierge, /https:\/\/m\.me\/SakanLodge/);
  assert.match(concierge, /document\.createTextNode\(part\)/);
  assert.match(concierge, /link\.rel = "noopener noreferrer"/);
  assert.doesNotMatch(concierge, /el\.innerHTML = text/);
});
