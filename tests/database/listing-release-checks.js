import assert from "node:assert/strict";

export async function verifyListingReleases({ t, sql, rpc, STAFF, OTHER, assertSingleAllocation }) {
  const PROP = "10000000-0000-4000-8000-000000000001";
  const PRIVATE = "10000000-0000-4000-8000-000000000002";
  const SHARED = "10000000-0000-4000-8000-000000000003";
  const FUTURE = "10000000-0000-4000-8000-000000000004";
  const sourceIds = [5, 6, 7, 8, 9].map((n) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0"));
  const [privateSource, sharedSource, secondSource, currentResident, futureResident] = sourceIds;
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
  const dates = (await sql("select (now() at time zone 'Australia/Adelaide')::date::text today,((now() at time zone 'Australia/Adelaide')::date-30)::text past,((now() at time zone 'Australia/Adelaide')::date-1)::text checkout,((now() at time zone 'Australia/Adelaide')::date+1)::text tomorrow,((now() at time zone 'Australia/Adelaide')::date+interval '3 months')::date::text finish")).rows[0];
  const roomProfile = (slug) => ({ slug, title: "Verified released test room", description: "Verified synthetic room details for an isolated test.", photos: ["https://example.test/verified.jpg"], ready: false, published: false });
  async function approve(room, changes = {}) {
    const p = (await sql("select * from room_profiles where room_id=$1", [room])).rows[0];
    return rpc("save_listing", ["room", room, { ...p, ready: true, published: true, ...changes }]);
  }
  const available = (room = SHARED) => rpc("room_availability", [room, dates.today, dates.finish]);
  const catalogue = () => rpc("public_catalog", []);
  async function request(spaces = 1) {
    const created = await rpc("submit_reservation", [{ room_id: SHARED, full_name: "Synthetic Released Guest", email: "released@example.test", phone: "0400000000", arrival_date: dates.today, departure_date: dates.finish, spaces_requested: spaces }, crypto.randomUUID()]);
    return (await sql("select * from reservations where reservation_code=$1", [created.code])).rows[0];
  }
  const manage = (r, action, data = {}) => rpc("manage_reservation", [r.id, r.revision, action, data]);
  const expiry = () => new Date(Date.now() + 3600000).toISOString();
  let held;
  let releasePrivate;
  let sharedRelease;

  await t.test("migration withdraws public visibility from approved rooms without a ledger release", async () => {
    assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
    await sql("insert into properties(id,name,lease_rent,lease_anchor) values($1,'Release Test',1000,$2)", [PROP, dates.today]);
    for (const [room, capacity, slug] of [[PRIVATE, 1, "private"], [SHARED, 3, "shared"], [FUTURE, 1, "future"]]) {
      await sql("insert into rooms(id,property_id,label,capacity) values($1,$2,$3,$4)", [room, PROP, slug, capacity]);
      await rpc("save_listing", ["room", room, roomProfile(slug)]);
    }
    await rpc("save_listing", ["property", PROP, { slug: "release-test", public_name: "Release Test Property", suburb: "Fulham", description: "Synthetic verified property for ledger release checks.", published: true }]);
    for (const [id, room, start, end] of [[privateSource, PRIVATE, dates.past, dates.checkout], [sharedSource, SHARED, dates.past, dates.checkout], [secondSource, SHARED, dates.past, dates.checkout], [currentResident, SHARED, dates.past, null], [futureResident, FUTURE, dates.today, dates.tomorrow]])
      await sql("insert into people(id,name,property_id,room_id,start_date,end_date,weekly_rate,bond) values($1,'Private Synthetic Resident',$2,$3,$4,$5,175,350)", [id, PROP, room, start, end]);
    await assert.rejects(() => available(PRIVATE), /Listing unavailable/);
  });
  await t.test("an active or future-departing resident cannot release public inventory", async () => {
    await assert.rejects(() => rpc("release_room_listing", [currentResident]), /actual checkout/);
    await assert.rejects(() => rpc("release_room_listing", [futureResident]), /actual checkout/);
    await assert.rejects(() => approve(PRIVATE), /Release a checked-out space/);
    assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
  });
  await t.test("checkout release still needs readiness and fresh publication approval", async () => {
    releasePrivate = await rpc("release_room_listing", [privateSource]);
    assert.equal(releasePrivate.status, "released_for_review");
    assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
    await assert.rejects(() => approve(PRIVATE, { ready: false }), /verify readiness/);
    await approve(PRIVATE);
    assert.equal((await catalogue()).rooms.length, 1);
    assert.equal((await available(PRIVATE)).spaces, 1);
    const cat = JSON.stringify(await catalogue());
    assert.ok(!cat.includes("Private Synthetic Resident"));
    assert.ok(!cat.includes(privateSource));
    const before = (await sql("select revision from room_profiles where room_id=$1", [PRIVATE])).rows[0].revision;
    assert.equal((await rpc("release_room_listing", [privateSource])).id, releasePrivate.id);
    assert.equal((await sql("select revision from room_profiles where room_id=$1", [PRIVATE])).rows[0].revision, before);
  });
  await t.test("one released bed does not advertise other unreleased vacancies", async () => {
    sharedRelease = await rpc("release_room_listing", [sharedSource]);
    await approve(SHARED);
    assert.equal((await available()).spaces, 1);
    await sql("update booking_settings set requests_enabled=true");
    await assert.rejects(() => request(2), /insufficient availability/);
    assert.equal((await request()).status, "pending");
  });
  await t.test("each additional ledger release returns the room to readiness and approval review", async () => {
    await rpc("release_room_listing", [secondSource]);
    assert.ok(!(await catalogue()).rooms.some((r) => r.id === SHARED));
    await assert.rejects(() => available(), /Listing unavailable/);
    await approve(SHARED);
    assert.equal((await available()).spaces, 2);
  });
  await t.test("holds consume released capacity and cancellation returns it without publishing extra beds", async () => {
    held = await manage(await request(), "hold", { expires_at: expiry() });
    assert.equal((await available()).spaces, 1);
    let second = await manage(await request(), "hold", { expires_at: expiry() });
    assert.equal((await available()).spaces, 0);
    assert.ok(!(await catalogue()).rooms.some((r) => r.id === SHARED));
    await assert.rejects(() => request(), /insufficient availability/);
    second = await manage(second, "cancel");
    assert.equal(second.status, "cancelled");
    assert.equal((await available()).spaces, 1);
    held = await manage(held, "cancel");
    assert.equal((await available()).spaces, 2);
  });
  await t.test("maintenance and expired holds still obey physical room capacity", async () => {
    const block = (await sql("insert into room_blocks(room_id,starts_on,ends_on,spaces,reason) values($1,$2,$3,1,'Synthetic maintenance') returning id", [SHARED, dates.today, dates.finish])).rows[0];
    assert.equal((await available()).spaces, 1);
    await sql("delete from room_blocks where id=$1", [block.id]);
    let r = await manage(await request(), "hold", { expires_at: expiry() });
    await sql("update reservations set hold_expires_at=now()-interval '1 second',status='review' where id=$1", [r.id]);
    assert.equal((await available()).spaces, 2);
  });
  await t.test("signed reservation check-in consumes one release without rewriting existing rates or bonds", async () => {
    let r = await manage(await request(), "hold", { expires_at: expiry() });
    let c = await rpc("manage_contract", [r.id, "draft", { terms: "Synthetic approved agreement terms. Fortnightly rent in advance and all utilities included.", template_reference: "synthetic-release-test" }]);
    c = await rpc("manage_contract", [r.id, "approve", { id: c.id }]);
    const path = "contracts/isolated-release-test/signed.pdf";
    await sql("insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)", [path]);
    await rpc("manage_contract", [r.id, "signed", { id: c.id, signature_verified: true, signed_by: r.full_name, signed_document_path: path }]);
    r = await manage(r, "confirm");
    r = await manage(r, "check_in", { bond: 370 });
    assert.equal(r.status, "checked_in");
    assert.equal((await available()).spaces, 1);
    const legacy = (await sql("select weekly_rate::text,bond::text from people where id=$1", [sharedSource])).rows[0];
    assert.equal(Number(legacy.weekly_rate), 175);
    assert.equal(Number(legacy.bond), 350);
    const before = (await sql("select count(*)::int n from room_listing_releases where room_id=$1 and consumed_at is not null", [SHARED])).rows[0].n;
    await sql("update people set phone='0400000001' where id=$1", [r.checked_in_person_id]);
    assert.equal((await sql("select count(*)::int n from room_listing_releases where room_id=$1 and consumed_at is not null", [SHARED])).rows[0].n, before);
    const consumed = (await sql("select checkout_person_id from room_listing_releases where consumed_by_person_id=$1", [r.checked_in_person_id])).rows[0];
    await assert.rejects(() => rpc("release_room_listing", [consumed.checkout_person_id]), /already been used/);
  });
  await t.test("withdrawing a release hides the space from public catalogue and direct availability", async () => {
    const remaining = (await sql("select id from room_listing_releases where room_id=$1 and consumed_at is null and revoked_at is null", [SHARED])).rows[0];
    await rpc("withdraw_room_listing_release", [remaining.id]);
    assert.ok(!(await catalogue()).rooms.some((r) => r.id === SHARED));
    await assert.rejects(() => available(), /Listing unavailable/);
  });
  await t.test("correcting or reversing a checkout revokes its public release", async () => {
    await sql("update people set end_date=null where id=$1", [privateSource]);
    assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
    await sql("update people set end_date=$1 where id=$2", [dates.checkout, privateSource]);
    await assert.rejects(() => available(PRIVATE), /Listing unavailable/);
    await rpc("release_room_listing", [privateSource]);
    await approve(PRIVATE);
    assert.equal((await available(PRIVATE)).spaces, 1);
  });
  await t.test("capacity changes invalidate releases and fresh approval is required", async () => {
    await sql("update rooms set capacity=2 where id=$1", [PRIVATE]);
    assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
    await assert.rejects(() => approve(PRIVATE), /Release a checked-out space/);
  });
  await t.test("public and non-staff users cannot release, read or withdraw private ledger release records", async () => {
    await sql("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
    await sql("set role authenticated");
    try {
      await assert.rejects(() => rpc("release_room_listing", [sharedSource]), /Staff access/);
      await assert.rejects(() => rpc("withdraw_room_listing_release", [sharedRelease.id]), /Staff access/);
      assert.equal((await sql("select count(*)::int n from room_listing_releases")).rows[0].n, 0);
      await assert.rejects(() => sql("insert into room_listing_releases(room_id,checkout_person_id,checkout_date,released_by) values($1,$2,$3,$4)", [SHARED, sharedSource, dates.checkout, OTHER]), /permission denied/);
    } finally { await sql("reset role"); }
    await sql("set role anon");
    try {
      await assert.rejects(() => sql("select * from room_listing_releases"), /permission denied/);
      await assert.rejects(() => rpc("release_room_listing", [sharedSource]), /permission denied/);
      assert.deepEqual(await catalogue(), { properties: [], rooms: [] });
    } finally { await sql("reset role"); }
    await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
    assert.ok((await sql("select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='room_listing_releases'")).rows.length);
  });
  const RACE = "10000000-0000-4000-8000-000000000020";
  const raceSources = ["10000000-0000-4000-8000-000000000021", "10000000-0000-4000-8000-000000000022"];
  await t.test("two ledger releases cannot advertise the same single vacant bed across PostgreSQL sessions", { skip: !process.env.SAKAN_TEST_DATABASE_URL }, async () => {
    await sql("insert into rooms(id,property_id,label,capacity) values($1,$2,'Release race',1)", [RACE, PROP]);
    await rpc("save_listing", ["room", RACE, roomProfile("release-race")]);
    await sql("insert into people(id,name,property_id,room_id,start_date,end_date) values($1,'Earlier Checkout',$3,$4,$5::date-30,$5::date-20),($2,'Later Checkout',$3,$4,$5::date-20,$5::date-10)", [...raceSources, PROP, RACE, dates.today]);
    await assertSingleAllocation(raceSources.map((source) => ({ sql: "select public.release_room_listing($1)", args: [source] })));
    assert.equal((await sql("select count(*)::int n from room_listing_releases where room_id=$1", [RACE])).rows[0].n, 1);
  });
  await t.test("released inventory remains atomic when a reservation races a ledger check-in", { skip: !process.env.SAKAN_TEST_DATABASE_URL }, async () => {
    await approve(RACE);
    const created = await rpc("create_staff_reservation", [{ room_id: RACE, full_name: "Release Race Guest", email: "race@example.test", phone: "0400000000", arrival_date: dates.today, departure_date: dates.finish }, crypto.randomUUID()]);
    const r = (await sql("select * from reservations where reservation_code=$1", [created.code])).rows[0];
    await assertSingleAllocation([
      { sql: "select public.manage_reservation($1,$2,'hold',$3)", args: [r.id, r.revision, JSON.stringify({ expires_at: expiry() })] },
      { sql: "insert into people(name,property_id,room_id,start_date,end_date) values('Release Race Resident',$1,$2,$3,$4)", args: [PROP, RACE, dates.today, dates.finish] },
    ]);
    assert.ok(!(await catalogue()).rooms.some((room) => room.id === RACE));
  });
}
