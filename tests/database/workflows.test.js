import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { verifyAutomaticAvailability } from "./automatic-availability-checks.js";
import { verifyListingReleases } from "./listing-release-checks.js";
import { verifyAgreements } from "./agreement-checks.js";
import { verifyReportingSnapshot } from "./reporting-checks.js";
const read = (p) => fs.readFile(new URL(p, import.meta.url), "utf8");
const STAFF = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROP = "00000000-0000-4000-8000-000000000003";
const ROOM = "00000000-0000-4000-8000-000000000004";
const SHARED = "00000000-0000-4000-8000-000000000005";
let db;
async function sql(q, args = []) {
  return db.query(q, args);
}
async function rpc(name, args) {
  return (
    await sql(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
      args.map((value) =>
        value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value,
      ),
    )
  ).rows[0].value;
}
async function rejected(q, args, pattern) {
  await assert.rejects(() => sql(q, args), pattern);
}
async function assertSingleAllocation(operations) {
  const clients = await Promise.all(
    operations.map(async () => {
      const client = new pg.Client({
        connectionString: process.env.SAKAN_TEST_DATABASE_URL,
      });
      await client.connect();
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
        STAFF,
      ]);
      return client;
    }),
  );
  const results = await Promise.allSettled(
    clients.map(async (client, index) => {
      try {
        await client.query(operations[index].sql, operations[index].args);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        await client.end();
      }
    }),
  );
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    results.find((x) => x.status === "rejected").reason.code,
    "23P01",
  );
}
await test("database workflows on isolated PostgreSQL", async (t) => {
  if (process.env.SAKAN_TEST_DATABASE_URL) {
    const testUrl = new URL(process.env.SAKAN_TEST_DATABASE_URL);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(testUrl.hostname) ||
      testUrl.pathname !== "/sakan_test"
    )
      throw new Error(
        "Database tests require a disposable local sakan_test database.",
      );
    const client = new pg.Client({
      connectionString: process.env.SAKAN_TEST_DATABASE_URL,
    });
    await client.connect();
    db = {
      query: (q, a) => client.query(q, a),
      exec: (q) => client.query(q),
      close: () => client.end(),
    };
  } else db = new PGlite();
  await db.exec(await read("./foundation.sql"));
  await db.exec(
    (await read("../../supabase/schema.sql")).split("-- Seed the portfolio")[0],
  );
  // Use actual staff migration except account seeding/expected-two assertion.
  await db.exec(
    `create table public.staff_access(user_id uuid primary key); alter table staff_access enable row level security; create function public.is_sakan_staff() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.staff_access where user_id=auth.uid())$$;`,
  );
  await db.exec(await read("./listing-foundation.sql"));
  await db.exec(
    `do $$declare t text;begin foreach t in array array['properties','rooms','people','charges','payments','expenses','maintenance'] loop execute format('drop policy team_all on %I',t);execute format('create policy staff_only on %I for all to authenticated using(public.is_sakan_staff()) with check(public.is_sakan_staff())',t);end loop;end$$;`,
  );
  await db.exec(
    await read(
      "../../supabase/migrations/20261017220346_reservation_inventory_workflows.sql",
    ),
  );
  await db.exec(
    await read("../../supabase/migrations/20261018174500_public_booking_gate_status.sql"),
  );
  await sql(
    `insert into staff_access values($1),('00000000-0000-4000-8000-000000000006');`,
    [STAFF],
  );
  await sql(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.test',now()),('00000000-0000-4000-8000-000000000006','staff2@example.test',now())",
    [STAFF],
  );
  await sql(
    `insert into properties(id,name,lease_rent,lease_anchor) values($1,'Synthetic',1000,'2026-01-01')`,
    [PROP],
  );
  await sql(
    `insert into rooms(id,property_id,label,capacity) values($1,$3,'Private',1),($2,$3,'Shared',3)`,
    [ROOM, SHARED, PROP],
  );
  await sql(`select set_config('request.jwt.claim.sub',$1,false)`, [STAFF]);
  await t.test(
    "public request status is read-only and reflects database gate",
    async () => {
      assert.equal(await rpc("customer_requests_enabled", []), false);
      await sql("update public.booking_settings set requests_enabled=true where id=true");
      assert.equal(await rpc("customer_requests_enabled", []), true);
      await sql("update public.booking_settings set requests_enabled=false where id=true");
      assert.equal(await rpc("customer_requests_enabled", []), false);
    },
  );
  await t.test(
    "default public catalogue empty and request gate off",
    async () => {
      assert.deepEqual(await rpc("public_catalog", []), {
        properties: [],
        rooms: [],
      });
      await rejected(
        `select public.submit_reservation('{}',gen_random_uuid())`,
        [],
        /not active/,
      );
    },
  );
  await t.test(
    "staff approval validates details and derives shared offering",
    async () => {
      await rpc("save_listing", [
        "property",
        PROP,
        {
          slug: "synthetic-house",
          public_name: "Synthetic House",
          suburb: "Fulham",
          description: "Synthetic verified test property description.",
          published: true,
        },
      ]);
      for (const [id, slug] of [
        [ROOM, "private"],
        [SHARED, "shared"],
      ])
        await rpc("save_listing", [
          "room",
          id,
          {
            slug,
            title: "Verified test room",
            description: "Synthetic verified test room description.",
            photos: ["https://example.test/room.jpg"],
            published: true,
            ready: true,
          },
        ]);
      const cat = await rpc("public_catalog", []);
      assert.equal(cat.rooms.length, 2);
      assert.equal(cat.rooms.find((r) => r.id === SHARED).offer_type, "shared");
    },
  );
  await t.test(
    "concurrent listing edits cannot overwrite a newer approval",
    async () => {
      const profile = (
        await sql("select * from property_profiles where property_id=$1", [
          PROP,
        ])
      ).rows[0];
      await rpc("save_listing", [
        "property",
        PROP,
        {
          ...profile,
          description: "A revised approved synthetic property description.",
        },
      ]);
      await assert.rejects(
        () => rpc("save_listing", ["property", PROP, profile]),
        /Listing changed/,
      );
    },
  );
  await t.test(
    "workflow tables are included in realtime without public table access",
    async () => {
      const tables = (
        await sql(
          "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'",
        )
      ).rows.map((x) => x.tablename);
      for (const table of [
        "reservations",
        "reservation_events",
        "room_blocks",
        "contracts",
        "notification_outbox",
        "property_profiles",
        "room_profiles",
      ])
        assert.ok(tables.includes(table));
    },
  );
  await t.test(
    "staff can record a request while public bookings are disabled",
    async () => {
      await sql("set role authenticated");
      try {
        const created = await rpc("create_staff_reservation", [
          {
            room_id: ROOM,
            full_name: "Staff Recorded Guest",
            email: "staff-recorded@example.test",
            phone: "0400000000",
            arrival_date: "2035-01-01",
            departure_date: "2035-03-01",
          },
          crypto.randomUUID(),
        ]);
        assert.equal(created.status, "pending");
      } finally {
        await sql("reset role");
      }
    },
  );
  await t.test(
    "calendar month pricing and invalid shared short stay",
    async () => {
      assert.equal(
        (await rpc("room_availability", [ROOM, "2027-12-31", "2028-02-29"]))
          .weekly_rate,
        255,
      );
      assert.equal(
        (await rpc("room_availability", [ROOM, "2027-12-31", "2028-02-28"]))
          .weekly_rate,
        300,
      );
      await assert.rejects(
        () => rpc("room_availability", [SHARED, "2027-01-01", "2027-02-01"]),
        /two calendar months/,
      );
    },
  );
  await t.test(
    "peak inventory permits sequential non-overlapping residents",
    async () => {
      await sql(
        `insert into people(name,property_id,room_id,start_date,end_date) values('Test A',$1,$2,'2027-01-01','2027-02-01'),('Test B',$1,$2,'2027-02-01','2027-03-01')`,
        [PROP, SHARED],
      );
      assert.equal(
        (await rpc("room_availability", [SHARED, "2027-01-01", "2027-03-01"]))
          .spaces,
        2,
      );
    },
  );
  let res;
  await t.test(
    "request idempotency and private data absent from public response",
    async () => {
      await sql("update booking_settings set requests_enabled=true");
      const key = "10000000-0000-4000-8000-000000000001";
      const data = {
        room_id: ROOM,
        full_name: "Synthetic Guest",
        phone: "0400000000",
        email: "guest@example.test",
        arrival_date: "2027-01-01",
        departure_date: "2027-03-01",
      };
      const a = await rpc("submit_reservation", [data, key]);
      assert.deepEqual(await rpc("submit_reservation", [data, key]), a);
      assert.equal(Object.keys(a).length, 2);
      res = (
        await sql("select * from reservations where request_key=$1", [key])
      ).rows[0];
      assert.equal(
        (
          await sql(
            "select count(*)::int n from notification_outbox where reservation_id=$1",
            [res.id],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await t.test(
    "expiring holds, duplicate capacity, stale updates and ledger bypass rejection",
    async () => {
      res = await rpc("manage_reservation", [
        res.id,
        res.revision,
        "hold",
        { expires_at: "2029-01-01T00:00:00Z" },
      ]);
      assert.equal(
        (await rpc("room_availability", [ROOM, "2027-01-01", "2027-03-01"]))
          .spaces,
        0,
      );
      await rejected(
        `insert into people(name,property_id,room_id,start_date,end_date) values('Conflict',$1,$2,'2027-01-01','2027-03-01')`,
        [PROP, ROOM],
        /insufficient/,
      );
      await assert.rejects(
        () => rpc("manage_reservation", [res.id, 1, "cancel", {}]),
        /changed/,
      );
      await rejected(
        `insert into room_blocks(room_id,starts_on,ends_on,reason) values($1,'2027-01-01','2027-02-01','test')`,
        [ROOM],
        /insufficient/,
      );
      await rejected(
        `update rooms set capacity=0 where id=$1`,
        [ROOM],
        /positive/,
      );
    },
  );
  await t.test(
    "signed current contract required; drafts retain full snapshots",
    async () => {
      await assert.rejects(
        () => rpc("manage_reservation", [res.id, res.revision, "confirm", {}]),
        /signed current agreement/,
      );
      let c = await rpc("manage_contract", [
        res.id,
        "draft",
        {
          terms:
            "Synthetic test agreement terms approved only for this isolated test.",
          template_reference: "TEST ONLY",
        },
      ]);
      c = await rpc("manage_contract", [res.id, "approve", { id: c.id }]);
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-contracts','contracts/test/signed.pdf')",
      );
      c = await rpc("manage_contract", [
        res.id,
        "signed",
        {
          id: c.id,
          signed_by: "Synthetic Guest",
          signed_document_path: "contracts/test/signed.pdf",
          signature_verified: true,
        },
      ]);
      assert.equal(c.status, "signed");
      res = await rpc("manage_reservation", [
        res.id,
        res.revision,
        "confirm",
        {},
      ]);
      assert.equal(res.status, "confirmed");
    },
  );
  await t.test(
    "cancel releases capacity and preserves event history",
    async () => {
      res = await rpc("manage_reservation", [
        res.id,
        res.revision,
        "cancel",
        {},
      ]);
      assert.equal(
        (await rpc("room_availability", [ROOM, "2027-01-01", "2027-03-01"]))
          .spaces,
        1,
      );
      assert.ok(
        (await sql("select count(*)::int n from reservation_events")).rows[0]
          .n >= 5,
      );
    },
  );
  await t.test(
    "new utility surcharges rejected without rewriting financial records",
    async () => {
      const person = (await sql("select id from people limit 1")).rows[0];
      await rejected(
        "insert into charges(person_id,kind,due_date,amount) values($1,'electricity','2027-01-01',10)",
        [person.id],
        /included/,
      );
      await assert.rejects(
        () =>
          rpc("post_electricity_bill", [
            PROP,
            "2027-01-01",
            "2026-10-01",
            "2026-12-31",
            900,
            [{ personId: person.id, amount: 100 }],
          ]),
        /surcharges/,
      );
      await rpc("post_electricity_bill", [
        PROP,
        "2027-01-01",
        "2026-10-01",
        "2026-12-31",
        900,
        [],
      ]);
      assert.equal(
        (await sql("select count(*)::int n from charges")).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "expired hold releases inventory without losing history",
    async () => {
      const existing = (
        await sql(
          "insert into reservations(reservation_code,property_id,room_id,full_name,email,phone,arrival_date,departure_date,status,hold_expires_at) values('TEST-EXPIRY',$1,$2,'Expiry Test','expiry@example.test','0400000000','2030-01-01','2030-03-01','held',clock_timestamp()+interval '200 milliseconds') returning id",
          [PROP, ROOM],
        )
      ).rows[0];
      assert.equal(
        (await rpc("room_availability", [ROOM, "2030-01-01", "2030-03-01"]))
          .spaces,
        0,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        (await rpc("room_availability", [ROOM, "2030-01-01", "2030-03-01"]))
          .spaces,
        1,
      );
      assert.equal(
        (
          await sql("select status from reservations where id=$1", [
            existing.id,
          ])
        ).rows[0].status,
        "held",
      );
    },
  );
  await t.test("manual notification claim cannot be repeated", async () => {
    const n = (
      await sql(
        "select id from notification_outbox where status='pending' limit 1",
      )
    ).rows[0];
    await rpc("notification_action", [n.id, "claim", null]);
    await assert.rejects(
      () => rpc("notification_action", [n.id, "claim", null]),
      /already handled/,
    );
    await rpc("notification_action", [n.id, "uncertain", null]);
  });
  await t.test(
    "competing holds cannot overbook a room across two PostgreSQL sessions",
    { skip: !process.env.SAKAN_TEST_DATABASE_URL },
    async () => {
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const data = {
          room_id: ROOM,
          full_name: "Race Guest " + i,
          phone: "0400000000",
          email: "race" + i + "@example.test",
          arrival_date: "2031-01-01",
          departure_date: "2031-03-01",
        };
        const req = await rpc("submit_reservation", [
          data,
          crypto.randomUUID(),
        ]);
        ids.push(
          (
            await sql(
              "select id,revision from reservations where reservation_code=$1",
              [req.code],
            )
          ).rows[0],
        );
      }
      const attempt = async (r) => {
        const c = new pg.Client({
          connectionString: process.env.SAKAN_TEST_DATABASE_URL,
        });
        await c.connect();
        try {
          await c.query("begin");
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
            STAFF,
          ]);
          await c.query("select public.manage_reservation($1,$2,'hold',$3)", [
            r.id,
            r.revision,
            { expires_at: "2032-01-01T00:00:00Z" },
          ]);
          await c.query("commit");
          return true;
        } catch (e) {
          await c.query("rollback");
          throw e;
        } finally {
          await c.end();
        }
      };
      const outcome = await Promise.allSettled(ids.map(attempt));
      assert.equal(outcome.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        outcome.find((x) => x.status === "rejected").reason.code,
        "23P01",
      );
    },
  );
  await t.test(
    "competing ledger check-ins cannot take the same private room",
    { skip: !process.env.SAKAN_TEST_DATABASE_URL },
    async () => {
      const statement =
        "insert into people(name,property_id,room_id,start_date,end_date) values($1,$2,$3,'2033-01-01','2033-03-01')";
      await assertSingleAllocation([
        { sql: statement, args: ["Race Resident A", PROP, ROOM] },
        { sql: statement, args: ["Race Resident B", PROP, ROOM] },
      ]);
    },
  );
  await t.test(
    "a reservation hold and ledger check-in share the same room lock",
    { skip: !process.env.SAKAN_TEST_DATABASE_URL },
    async () => {
      const data = {
        room_id: ROOM,
        full_name: "Mixed Race Guest",
        phone: "0400000000",
        email: "mixed@example.test",
        arrival_date: "2034-01-01",
        departure_date: "2034-03-01",
      };
      const request = await rpc("create_staff_reservation", [
        data,
        crypto.randomUUID(),
      ]);
      const reservation = (
        await sql(
          "select id,revision from reservations where reservation_code=$1",
          [request.code],
        )
      ).rows[0];
      await assertSingleAllocation([
        {
          sql: "select public.manage_reservation($1,$2,'hold',$3)",
          args: [
            reservation.id,
            reservation.revision,
            JSON.stringify({ expires_at: "2035-01-01T00:00:00Z" }),
          ],
        },
        {
          sql: "insert into people(name,property_id,room_id,start_date,end_date) values('Mixed Race Resident',$1,$2,'2034-01-01','2034-03-01')",
          args: [PROP, ROOM],
        },
      ]);
    },
  );
  await t.test(
    "multi-person check-in is atomic and existing residents stay unchanged",
    async () => {
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
      const before = (
        await sql(
          "select id,md5(to_jsonb(p)::text) hash from people p order by id",
        )
      ).rows;
      const dates = (
        await sql(
          "select (now() at time zone 'Australia/Adelaide')::date::text arrival, ((now() at time zone 'Australia/Adelaide')::date+interval '2 months')::date::text departure",
        )
      ).rows[0];
      const out = await rpc("submit_reservation", [
        {
          room_id: SHARED,
          full_name: "Checkin Test",
          email: "checkin@example.test",
          phone: "0400000000",
          arrival_date: dates.arrival,
          departure_date: dates.departure,
          spaces_requested: 2,
        },
        crypto.randomUUID(),
      ]);
      let r = (
        await sql("select * from reservations where reservation_code=$1", [
          out.code,
        ])
      ).rows[0];
      let c = await rpc("manage_contract", [
        r.id,
        "draft",
        {
          terms:
            "Synthetic approved test agreement with all occupants signing.",
          template_reference: "TEST",
        },
      ]);
      c = await rpc("manage_contract", [r.id, "approve", { id: c.id }]);
      const path = "contracts/test/" + c.id + ".pdf";
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",
        [path],
      );
      await rpc("manage_contract", [
        r.id,
        "signed",
        {
          id: c.id,
          signed_by: "Checkin A and Checkin B",
          signed_document_path: path,
          signature_verified: true,
        },
      ]);
      r = await rpc("manage_reservation", [r.id, r.revision, "confirm", {}]);
      const available = (
        await rpc("room_availability", [SHARED, dates.arrival, dates.departure])
      ).spaces;
      r = await rpc("manage_reservation", [
        r.id,
        r.revision,
        "check_in",
        {
          bond: 200,
          residents: [{ name: "Checkin A" }, { name: "Checkin B" }],
        },
      ]);
      assert.equal(r.status, "checked_in");
      assert.equal(
        (
          await rpc("room_availability", [
            SHARED,
            dates.arrival,
            dates.departure,
          ])
        ).spaces,
        available,
      );
      for (const old of before)
        assert.equal(
          (
            await sql(
              "select md5(to_jsonb(p)::text) hash from people p where id=$1",
              [old.id],
            )
          ).rows[0].hash,
          old.hash,
        );
      assert.equal(
        (
          await sql(
            "select count(*)::int n from people where name in ('Checkin A','Checkin B')",
          )
        ).rows[0].n,
        2,
      );
      await assert.rejects(
        () =>
          rpc("manage_reservation", [
            r.id,
            r.revision,
            "check_in",
            { bond: 200 },
          ]),
        /once/,
      );
    },
  );
  await t.test(
    "ledger checkout releases website space and an extension cannot override a future hold",
    async () => {
      const person = (await sql("select * from people where name='Checkin A'"))
        .rows[0];
      const dates = (
        await sql(
          "select (now() at time zone 'Australia/Adelaide')::date::text start,((now() at time zone 'Australia/Adelaide')::date+1)::text checkout,((now() at time zone 'Australia/Adelaide')::date+interval '3 months')::date::text finish",
        )
      ).rows[0];
      const before = (
        await rpc("room_availability", [SHARED, dates.checkout, dates.finish])
      ).spaces;
      await sql("update people set end_date=$1 where id=$2", [
        dates.checkout,
        person.id,
      ]);
      assert.equal(
        (await rpc("room_availability", [SHARED, dates.checkout, dates.finish]))
          .spaces,
        before + 1,
      );
      const data = {
        room_id: SHARED,
        full_name: "Future Reserved Guest",
        email: "future@example.test",
        phone: "0400000000",
        arrival_date: dates.checkout,
        departure_date: person.end_date,
        spaces_requested: 2,
      };
      // A shared request needs two calendar months. Extend the test interval accordingly.
      data.departure_date = (
        await sql(
          "select ($1::date+interval '2 months')::date::text end_date",
          [dates.checkout],
        )
      ).rows[0].end_date;
      const created = await rpc("create_staff_reservation", [
        data,
        crypto.randomUUID(),
      ]);
      let r = (
        await sql("select * from reservations where reservation_code=$1", [
          created.code,
        ])
      ).rows[0];
      r = await rpc("manage_reservation", [
        r.id,
        r.revision,
        "hold",
        { expires_at: "2032-01-01T00:00:00Z" },
      ]);
      await rejected(
        "update people set end_date=$1 where id=$2",
        [data.departure_date, person.id],
        /insufficient availability/,
      );
    },
  );
  await t.test(
    "non-staff denied privileged RPC; anon cannot read resident data or submit",
    async () => {
      await sql(`select set_config('request.jwt.claim.sub',$1,false)`, [OTHER]);
      await assert.rejects(
        () => rpc("manage_reservation", [res.id, res.revision, "archive", {}]),
        /Staff access/,
      );
      await sql("set role authenticated");
      assert.equal(
        (await sql("select count(*)::int n from people")).rows[0].n,
        0,
      );
      await rejected(
        "insert into reservations(reservation_code,full_name,email,phone,arrival_date) values('BAD','No','no@example.test','0400000000','2030-01-01')",
        [],
        /permission denied/,
      );
      await sql("reset role");
      await sql("set role anon");
      await rejected("select * from people", [], /permission denied/);
      await rejected(
        `select public.submit_reservation('{}',gen_random_uuid())`,
        [],
        /permission denied/,
      );
      assert.equal((await rpc("public_catalog", [])).rooms.length, 2);
      await sql("reset role");
    },
  );
  await db.exec(await read("../../supabase/migrations/20261017230413_ledger_listing_releases.sql"));
  await verifyListingReleases({ t, sql, rpc, STAFF, OTHER, assertSingleAllocation });
  await verifyReportingSnapshot({ t, sql, rpc, STAFF, OTHER,
    applyMigration: async () => db.exec(await read("../../supabase/migrations/20261017232242_reporting_property_budgets.sql")),
  });
  await verifyAgreements({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read("../../supabase/migrations/20261018035042_private_agreement_templates.sql"))});
  await verifyAutomaticAvailability({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read("../../supabase/migrations/20261018045755_automatic_ledger_availability.sql"))});
  await db.close();
});
