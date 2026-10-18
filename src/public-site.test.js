import test from "node:test";
import assert from "node:assert/strict";
import {
  handlePublicSite,
  renderListing,
  limitedJson,
  bookingEnabled,
  databaseRpc,
} from "./public-site.js";
import worker from "./worker.js";
const cat = {
  properties: [
    {
      id: "p",
      name: "Verified house",
      slug: "house-1",
      suburb: "Fulham",
      description: "Approved description",
      photos: [],
      amenities: [],
    },
  ],
  rooms: [
    {
      id: "r",
      property_id: "p",
      slug: "room-1",
      title: "<script>room</script>",
      description: '<img onerror="alert(1)">',
      capacity: 2,
      photos: ["javascript:alert(1)", "https://example.test/photo.jpg"],
      amenities: ["Wi-Fi"],
      ready: true,
    },
  ],
};
test("server renders nested room with escaped content, accurate rate and disabled booking", async () => {
  const res = renderListing(
    { kind: "room", suburb: "fulham", property: "house-1", room: "room-1" },
    cat,
  );
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes("$185 per person/week"));
  assert.ok(text.includes("&lt;script&gt;room"));
  assert.ok(!text.includes("javascript:"));
  assert.ok(!text.includes("<img onerror="));
  assert.ok(
    text.includes("/locations/fulham/properties/house-1/rooms/room-1/"),
  );
  assert.ok(!text.includes('id="submit-request"'));
  assert.ok(!text.includes('name="full_name"'));
  assert.ok(text.includes("Online reservation requests are currently unavailable"));
  assert.ok(text.includes("Check availability"));
  assert.ok(text.includes('id="enquiry-next-step" hidden'));
  assert.ok(text.includes('id="email-reservation"'));
  assert.ok(text.includes('continue with a prefilled email request'));
});
test("unapproved or mismatched property/room yields real 404", () => {
  assert.equal(
    renderListing(
      { kind: "property", suburb: "fulham", property: "missing" },
      cat,
    ).status,
    404,
  );
  assert.equal(
    renderListing(
      { kind: "room", suburb: "fulham", property: "house-1", room: "missing" },
      cat,
    ).status,
    404,
  );
});
test("public POST fails closed without all activation prerequisites", async () => {
  assert.equal(bookingEnabled({ RESERVATION_REQUESTS_ENABLED: "true" }), false);
  const req = new Request("https://sakanlodge.com/api/reservations", {
    method: "POST",
    headers: { Origin: "https://sakanlodge.com" },
    body: "{}",
  });
  assert.equal((await handlePublicSite(req, {})).status, 503);
  const foreign = new Request(req, {
    headers: { Origin: "https://evil.test" },
  });
  assert.equal((await handlePublicSite(foreign, {})).status, 403);
});
test("unavailable database never invents inventory", async () => {
  const res = await handlePublicSite(
    new Request("https://sakanlodge.com/locations/fulham/"),
    {},
  );
  assert.equal(res.status, 503);
  assert.ok((await res.text()).includes("cannot verify"));
});
test("dynamic sitemap contains approved nested routes and excludes private ledger", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(cat));
  try {
    const res = await handlePublicSite(
      new Request("https://sakanlodge.com/sitemap.xml"),
      { SUPABASE_URL: "https://example.test", SUPABASE_PUBLIC_KEY: "public" },
    );
    const body = await res.text();
    assert.ok(body.includes("/properties/house-1/rooms/room-1/"));
    assert.ok(!body.includes("/ledger"));
  } finally {
    globalThis.fetch = original;
  }
});
test("oversized untrusted request bodies rejected even without content-length", async () => {
  await assert.rejects(
    () =>
      limitedJson(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ x: "x".repeat(13000) }),
        }),
      ),
    /too large/,
  );
});
test("public canonical redirect and private routes have noindex", async () => {
  const res = await handlePublicSite(
    new Request("https://sakanlodge.com/locations/fulham"),
    {},
  );
  assert.equal(res.status, 308);
  const ledger = await worker.fetch(
    new Request("https://sakanlodge.com/ledger/"),
    { ASSETS: { fetch: async () => new Response("private shell") } },
  );
  assert.equal(ledger.headers.get("X-Robots-Tag"), "noindex, nofollow");
});
test("availability response requires both database and Worker activation gates", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ spaces: 1, weekly_rate: 255, requests_enabled: true }),
    );
  try {
    const res = await handlePublicSite(
      new Request(
        "https://sakanlodge.com/api/availability?room=r&arrival=2027-01-01&departure=2027-03-01",
      ),
      { SUPABASE_URL: "https://example.test", SUPABASE_PUBLIC_KEY: "public" },
    );
    assert.equal((await res.json()).requests_enabled, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('configured request page retains protected form while unavailable pages omit applicant fields',async()=>{
 const env={RESERVATION_REQUESTS_ENABLED:'true',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret',TURNSTILE_SECRET_KEY:'synthetic-turnstile',TURNSTILE_SITE_KEY:'synthetic-public-site-key'};
 const text=await renderListing({kind:'room',suburb:'fulham',property:'house-1',room:'room-1'},cat,env).text();
 assert.ok(text.includes('name="full_name"'));
 assert.ok(text.includes('id="submit-request" type="submit" disabled'));
 assert.ok(text.includes('data-sitekey="synthetic-public-site-key"'));
 assert.ok(!text.includes('synthetic-secret'));
 assert.ok(!text.includes('synthetic-turnstile'));
});

test('database request gate off hides applicant fields even when Worker settings are on', async () => {
  const original = globalThis.fetch;
  const names = [];
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    names.push(name);
    if (name === 'public_catalog') return new Response(JSON.stringify(cat));
    if (name === 'customer_requests_enabled') return new Response(JSON.stringify(false));
    throw new Error('unexpected RPC: ' + name);
  };
  try {
    const response = await handlePublicSite(
      new Request('https://sakanlodge.com/locations/fulham/properties/house-1/rooms/room-1/'),
      {
        SUPABASE_URL: 'https://example.test', SUPABASE_PUBLIC_KEY: 'synthetic-anon',
        RESERVATION_REQUESTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-only',
        TURNSTILE_SECRET_KEY: 'synthetic-secret', TURNSTILE_SITE_KEY: 'synthetic-public',
      },
    );
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.ok(names.includes('customer_requests_enabled'));
    assert.ok(!body.includes('name="full_name"'));
    assert.ok(!body.includes('id="submit-request"'));
    assert.ok(body.includes('Online reservation requests are currently unavailable'));
    assert.ok(body.includes('mailto:sakanlodges@gmail.com'));
  } finally {
    globalThis.fetch = original;
  }
});

test('approved database gate renders actionable request flow without leaking server keys', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const name = String(url).split('/').pop();
    if (name === 'public_catalog') return new Response(JSON.stringify(cat));
    if (name === 'customer_requests_enabled') return new Response(JSON.stringify(true));
    throw new Error('unexpected RPC');
  };
  try {
    const response = await handlePublicSite(
      new Request('https://sakanlodge.com/locations/fulham/properties/house-1/rooms/room-1/'),
      {
        SUPABASE_URL: 'https://example.test', SUPABASE_PUBLIC_KEY: 'synthetic-anon',
        RESERVATION_REQUESTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-only',
        TURNSTILE_SECRET_KEY: 'synthetic-secret', TURNSTILE_SITE_KEY: 'synthetic-public',
      },
    );
    const body = await response.text();
    assert.ok(body.includes('id="submit-request"'));
    assert.ok(body.includes('name="full_name"'));
    assert.ok(!body.includes('synthetic-server-only'));
    assert.ok(!body.includes('synthetic-secret'));
  } finally {
    globalThis.fetch = original;
  }
});

test('modern Supabase secret key is used as an API key, never a bearer JWT', async () => {
  const original = globalThis.fetch;
  const records = [];
  globalThis.fetch = async (url, options) => {
    records.push({ url, headers: options.headers });
    return new Response(JSON.stringify({ ok: true }));
  };
  try {
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLIC_KEY: 'sb_publishable_synthetic',
      SUPABASE_SECRET_KEY: 'sb_secret_synthetic_server_only',
    };
    await databaseRpc(env, 'public_catalog');
    await databaseRpc(env, 'submit_reservation', { p_data: {} }, { admin: true });
    assert.equal(records.length, 2);
    assert.equal(records[0].headers.apikey, 'sb_publishable_synthetic');
    assert.equal(records[0].headers.Authorization, undefined);
    assert.equal(records[1].headers.apikey, 'sb_secret_synthetic_server_only');
    assert.equal(records[1].headers.Authorization, undefined);
    assert.equal(bookingEnabled({...env,RESERVATION_REQUESTS_ENABLED:'true',TURNSTILE_SITE_KEY:'synthetic-site',TURNSTILE_SECRET_KEY:'synthetic-secret'}),true);
  } finally {
    globalThis.fetch = original;
  }
});

test('legacy JWT service-role keys are retained only for compatibility',async()=>{
 const original=globalThis.fetch;
 let headers;
 globalThis.fetch=async(_url,options)=>{headers=options.headers;return new Response('{}');};
 try {
   const token='eyJlegacy-token-test';
   await databaseRpc(
      {SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLIC_KEY:'sb_publishable_synthetic',SUPABASE_SERVICE_ROLE_KEY:token},
      'submit_reservation', {}, {admin:true}
   );
   assert.equal(headers.apikey,token);
   assert.equal(headers.Authorization,'Bearer '+token);
   await assert.rejects(
     ()=>databaseRpc({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLIC_KEY:'sb_publishable_synthetic'},'submit_reservation',{}, {admin:true}),
     /credential unavailable/
   );
 }finally{globalThis.fetch=original;}
});
