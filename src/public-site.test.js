import test from "node:test";
import assert from "node:assert/strict";
import {
  handlePublicSite,
  renderListing,
  limitedJson,
  bookingEnabled,
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
  assert.ok(text.includes('id="submit-request" type="submit" disabled'));
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
