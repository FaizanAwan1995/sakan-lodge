import {verifyCouplesApplication} from './couples-application-checks.js';
import {verifyGuestCommunications} from './communications-checks.js';
import {verifyBeds} from './bed-assignment-checks.js';
import {verifySigning} from './signing-checks.js';
import {verifyBondReceipts} from './bond-receipt-checks.js';
import {verifyPastFortnights} from './past-fortnight-checks.js';
import {verifyGuidedSettlement} from './guided-settlement-checks.js';
import {verifyRoomPhotos} from './room-photo-checks.js';
import {verifyHistoricalReceipts} from './historical-receipt-checks.js';
import {verifyRentInvoices} from './rent-invoice-checks.js';
import {verifyStayHistory} from './stay-history-checks.js';
import {verifyTenantAccount} from './tenant-account-checks.js';
import {verifyRentCycle} from './rent-cycle-checks.js';
import {verifyTenantIdentity} from './tenant-identity-checks.js';
import {verifyAdminActions} from './admin-actions-checks.js';
import {verifyManualBooking} from './manual-booking-checks.js';
import {verifyBookingContracts} from './booking-contract-checks.js';
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
        spaces_requested: 1,
      };
      // Hold the single released bed for two calendar months; the original resident cannot extend into it.
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
  await verifyBookingContracts({t,sql,rpc,STAFF,OTHER,assertSingleAllocation,applyMigration:async()=>db.exec(await read("../../supabase/migrations/20261018095439_booking_contract_workflow.sql"))});
  await verifyManualBooking({t,sql,rpc,STAFF,OTHER,assertSingleAllocation,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261018104703_simplify_manual_booking.sql'))});
  await verifyAdminActions({t,sql,rpc,STAFF,OTHER,assertSingleAllocation,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261018124518_admin_checkout_adjustments.sql'))});
  await db.exec(await read('../../supabase/migrations/20261019015737_tenant_identity_and_audit.sql'));
  await verifyTenantIdentity({t,sql,rpc,STAFF,OTHER,PROP});
  await db.exec(await read('../../supabase/migrations/20261021233015_resident_checkin_rent_cycle.sql'));
  await verifyRentCycle({t,sql,rpc,STAFF,OTHER});
  await verifyTenantAccount({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261023080438_tenant_account_workflow.sql'))});
  await verifyStayHistory({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261026021823_stay_history_bond_settlement.sql'))});
  await verifyRentInvoices({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261026023326_automatic_rent_invoices.sql'))});
  await db.exec(await read('../../supabase/migrations/20261026032904_historical_rent_receipts.sql'));
  await verifyHistoricalReceipts({t,sql,rpc,STAFF,OTHER});
  await db.exec(await read('../../supabase/migrations/20261031080255_past_fortnight_invoices.sql'));
  await verifyPastFortnights({t,sql,rpc,STAFF,OTHER});
  await db.exec(await read('../../supabase/migrations/20261026082712_room_photo_upload.sql'));
  await verifyRoomPhotos({t,sql,rpc,STAFF,OTHER});
  await verifyGuidedSettlement({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261028225255_guided_bond_settlement.sql'))});
  await verifyBondReceipts({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261103_bond_payment_receipts.sql'))});
  await db.exec(await read('../../supabase/migrations/20261106000000_agreed_weekly_rent.sql'));
  await t.test('latest weekly rent override migration is installed',async()=>{
    const r=await sql("select pg_get_functiondef('sakan_private.booking_contract(uuid,integer,jsonb)'::regprocedure) definition");
    assert.match(r.rows[0].definition,/agreed_weekly_rate/);
  });
  await db.exec(await read('../../supabase/migrations/20261106022103_audit_fulham_utilities.sql'));
  await t.test('new Fulham contracts snapshot allowance and preserve earlier versions',async()=>{
    await sql('begin');
    try {
      const r=(await sql('select id,property_id,revision from reservations limit 1')).rows[0];
      await sql("update properties set name='Fulham' where id=$1",[r.property_id]);
      const prior=(await sql('select fields from contracts where reservation_id=$1 order by version',[r.id])).rows;
      const made=(await sql("insert into contracts(reservation_id,version,reservation_revision,fields) select $1,coalesce(max(version),0)+1,$2,$3::jsonb from contracts where reservation_id=$1 returning fields",[r.id,r.revision,JSON.stringify({terms:'Electricity and other utilities included.',full_name:'Synthetic'})])).rows[0].fields;
      assert.match(made.utilities,/\$1,000/);
      assert.match(made.terms,/takes precedence/);
      assert.equal(made.utility_policy_version,'fulham-1000-quarter-v1');
      const after=(await sql('select fields from contracts where reservation_id=$1 order by version limit $2',[r.id,prior.length])).rows;
      assert.deepEqual(after,prior);
    } finally { await sql('rollback'); }
  });
  await db.exec(await read('../../supabase/migrations/20261106022825_agreement_design_options.sql'));
  await t.test('agreement designs validate and are copied into the contract snapshot',async()=>{
    const design={title:'TENANCY AGREEMENT',theme:'forest',fontSize:12,showLogo:false};
    const template=await rpc('approve_agreement_template',[{title:'Design test',terms:'Synthetic agreement terms for isolated design testing only.',proprietor:{name:'Synthetic Owner',address:'Synthetic address',phone:'0400000000'},confirmation:'APPROVE_REUSABLE_TEMPLATE',design}]);
    assert.deepEqual(template.design,design);
    await assert.rejects(()=>rpc('approve_agreement_template',[{title:'Invalid design',terms:'Synthetic agreement terms for isolated design testing only.',proprietor:{name:'Synthetic Owner',address:'Synthetic address',phone:'0400000000'},confirmation:'APPROVE_REUSABLE_TEMPLATE',design:{theme:'bad'}}]));
    const c=(await sql('select id from contracts where document_path is null limit 1')).rows[0];
    await sql("update contracts set fields=fields || jsonb_build_object('template_id',$2::text) where id=$1",[c.id,template.id]);
    const snapshot=(await sql('select fields from contracts where id=$1',[c.id])).rows[0].fields;
    assert.deepEqual(snapshot.design,design);
    await sql("update agreement_templates set design='{}' where id=$1",[template.id]);
    assert.deepEqual((await sql('select fields from contracts where id=$1',[c.id])).rows[0].fields.design,design);
  });
  await db.exec(await read('../../supabase/migrations/20261106024252_agreement_critical_dates.sql'));
  await t.test('agreement rejects first rent due on or after checkout',async()=>{
    const r=(await sql('select * from reservations limit 1')).rows[0];
    const template=(await sql('select id from agreement_templates limit 1')).rows[0];
    await assert.rejects(()=>rpc('create_template_contract',[r.id,{revision:r.revision,template_id:template.id,resident_names:Array.from({length:r.spaces_requested},(_,i)=>'Synthetic '+i),premises_address:'Synthetic test property',term_description:'Synthetic fixed term',bond:200,first_rent_due:r.departure_date}]),/First rent due must be before departure/);
  });
  await db.exec(await read('../../supabase/migrations/20261107220715_property_electricity_allowances.sql'));
  await t.test('all property allowance snapshots preserve existing contract versions',async()=>{
    for(const [name,amount] of [['Fulham',1000],['Clapham',800],['Oaklands Park',1000]]){
      await sql('begin');
      try{
        const r=(await sql('select id,property_id,revision from reservations limit 1')).rows[0];
        await sql('update properties set name=$2,electricity_cap=1 where id=$1',[r.property_id,name]);
        const prior=(await sql('select id,status,fields from contracts order by id')).rows;
        await db.exec(await read('../../supabase/migrations/20261107220715_property_electricity_allowances.sql'));
        assert.equal(Number((await sql('select electricity_cap from properties where id=$1',[r.property_id])).rows[0].electricity_cap),amount);
        assert.deepEqual((await sql('select id,status,fields from contracts order by id')).rows,prior);
        const made=(await sql("insert into contracts(reservation_id,version,reservation_revision,fields) select $1,coalesce(max(version),0)+1,$2,$3::jsonb from contracts where reservation_id=$1 returning fields",[r.id,r.revision,JSON.stringify({terms:'Synthetic terms.',full_name:'Synthetic'})])).rows[0].fields;
        assert.ok(made.utilities.includes(name));assert.ok(made.utilities.includes('$'+amount.toLocaleString('en-AU')));assert.match(made.utilities,/per property per three months/);
      }finally{await sql('rollback');}
    }
  });
  await db.exec(await read('../../supabase/migrations/20261107221927_sync_recorded_bond_status.sql'));
  await t.test('bond status follows recorded receipts, refunds and expected amount without duplicate transactions',async()=>{
    await sql('begin');
    try{
      const person=(await sql("select id,property_id from people limit 1")).rows[0];
      const countBefore=Number((await sql('select count(*) n from payments where person_id=$1',[person.id])).rows[0].n);
      // Use a new resident to avoid the fixture's existing settlement history.
      const person2=(await sql("insert into people(property_id,name,stay_type,start_date,bond,bond_status) values($1,'Synthetic bond sync','long',current_date,500,'not_paid') returning id",[person.property_id])).rows[0];
      const status=async()=>(await sql('select bond_status from people where id=$1',[person2.id])).rows[0].bond_status;
      const pay=async(kind,amount)=>(await sql("insert into payments(person_id,property_id,date,kind,amount,method,received_by) values($1,$2,current_date,$3,$4,'cash','Faizan') returning id",[person2.id,person.property_id,kind,amount])).rows[0];
      await pay('bond',500);assert.equal(await status(),'paid');
      await sql("update people set bond_status='not_paid' where id=$1",[person2.id]);assert.equal(await status(),'paid');
      await sql('update people set bond=600 where id=$1',[person2.id]);assert.equal(await status(),'not_paid');
      await pay('bond',100);assert.equal(await status(),'paid');
      await pay('bond_refund',600);assert.equal(await status(),'refunded');
      assert.equal(Number((await sql('select count(*) n from payments where person_id=$1',[person2.id])).rows[0].n),3);
      assert.equal(Number((await sql('select count(*) n from payments where person_id=$1',[person.id])).rows[0].n),countBefore);
      const settled=(await sql("insert into people(property_id,name,stay_type,start_date,bond,bond_status) values($1,'Synthetic settled bond','long',current_date,300,'not_paid') returning id",[person.property_id])).rows[0];
      for(const [kind,amount] of [['bond',300],['bond_refund',215],['bond_deducted',85]])await sql("insert into payments(person_id,property_id,date,kind,amount,method,received_by) values($1,$2,current_date,$3,$4,'cash','Faizan')",[settled.id,person.property_id,kind,amount]);
      assert.equal((await sql('select bond_status from people where id=$1',[settled.id])).rows[0].bond_status,'deducted');
      for(const role of ['anon','authenticated']){
        assert.equal((await sql("select has_function_privilege($1,'sakan_private.recorded_bond_status(uuid,numeric,text)','execute') allowed",[role])).rows[0].allowed,false);
      }
      const legacy=(await sql("insert into people(property_id,name,stay_type,start_date,bond,bond_status) values($1,'Synthetic legacy bond','long',current_date,500,'paid') returning id",[person.property_id])).rows[0];
      await sql('update people set bond=550 where id=$1',[legacy.id]);
      assert.equal((await sql('select bond_status from people where id=$1',[legacy.id])).rows[0].bond_status,'paid');
    }finally{await sql('rollback');}
  });
  await verifySigning({t,sql,rpc,STAFF,OTHER,assertSingleAllocation,applyMigration:async()=>{await db.exec(await read('../../supabase/migrations/20261030215006_incoming_staff_alerts.sql'));await db.exec(await read('../../supabase/migrations/20261109093943_tenant_contract_signing.sql'));await db.exec(await read('../../supabase/migrations/20261109095409_complete_tenant_signing_journey.sql'));await db.exec(await read('../../supabase/migrations/20261109095847_guard_online_signing_actions.sql'));await db.exec(await read('../../supabase/migrations/20261109115712_readable_signing_emails.sql'));await db.exec(await read('../../supabase/migrations/20261109123836_archive_reservation_requests.sql'));}});
  await db.exec(await read('../../supabase/migrations/20261112052110_sync_room_capacity_listing.sql'));
  await t.test('capacity edits synchronise public listings without bypassing publication or inventory',async()=>{
    await sql('begin');
    try {
      const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Capacity test',1000,current_date) returning id")).rows[0].id;
      await sql("insert into property_profiles(property_id,slug,public_name,suburb,description,published,approved_by,approved_at) values($1,'capacity-test','Capacity test','Clapham','Synthetic property for capacity regression.',true,$2,now())",[prop,STAFF]);
      const room=(await sql("insert into rooms(property_id,label,capacity) values($1,'Capacity regression',1) returning id",[prop])).rows[0].id;
      const description='Private room for one person in Clapham. Long-term rent is $255 per week; short-term rent is $300 per week. Exactly two calendar months qualifies as long-term. Electricity, water, gas and internet are included without additional charges.';
      await sql("insert into room_profiles(room_id,slug,title,description,photos,offer_type,ready,published,approved_by,approved_at) values($1,'capacity-regression','Sukoon 05 · Private Room',$2,'[]','private',true,true,$3,now())",[room,description,STAFF]);
      const before=(await sql('select * from room_profiles where room_id=$1',[room])).rows[0];
      const profile=async()=>(await sql('select * from room_profiles where room_id=$1',[room])).rows[0];
      const listed=async()=>(await rpc('public_catalog',[])).rooms.find(r=>r.id===room);
      await sql('update rooms set capacity=2 where id=$1',[room]);
      let p=await profile(); assert.equal(p.published,true);assert.equal(p.ready,true);assert.equal(p.approved_by,before.approved_by);assert.deepEqual(p.approved_at,before.approved_at);assert.deepEqual(p.photos,before.photos);
      assert.equal(p.title,'Sukoon 05 · Shared Room');assert.match(p.description,/capacity for 2 people/);assert.ok(p.description.includes('$185'));assert.ok(!p.description.includes('$255'));
      assert.equal((await listed()).capacity,2);assert.equal((await rpc('room_availability',[room,'2090-01-01','2090-04-01'])).spaces,2);
      await sql('update rooms set capacity=3 where id=$1',[room]);assert.match((await profile()).description,/capacity for 3 people/);
      await sql('update rooms set capacity=1 where id=$1',[room]);assert.equal((await profile()).description,description);assert.equal((await listed()).offer_type,'private');
      await sql("update room_profiles set published=false,ready=false,title='Custom room',description='Custom approved description.' where room_id=$1",[room]);
      await sql('update rooms set capacity=2 where id=$1',[room]);p=await profile();assert.equal(p.published,false);assert.equal(p.ready,false);assert.equal(p.title,'Custom room');assert.equal(p.description,'Custom approved description.');assert.equal(await listed(),undefined);
      await assert.rejects(()=>sql('update rooms set capacity=0 where id=$1',[room]),/positive/);
    } finally {await sql('rollback');}
  });
  await verifyBeds({t,sql,rpc,STAFF,assertSingleAllocation,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261112062236_individual_bed_assignments.sql'))});
  await verifyGuestCommunications({t,sql,rpc,STAFF,OTHER,applyMigrations:async()=>{await db.exec(await read('../../supabase/migrations/20261112093842_checkout_thank_you_emails.sql'));await db.exec(await read('../../supabase/migrations/20261112094030_shared_enquiry_inbox.sql'));}});
  await verifyCouplesApplication({t,sql,rpc,STAFF,OTHER,applyMigration:async()=>db.exec(await read('../../supabase/migrations/20261114065444_couples_reservation_application.sql'))});
  await db.close();
});
