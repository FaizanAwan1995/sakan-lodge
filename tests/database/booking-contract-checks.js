import assert from "node:assert/strict";
export async function verifyBookingContracts({
  t,
  sql,
  rpc,
  STAFF,
  OTHER,
  assertSingleAllocation,
  applyMigration,
}) {
  await applyMigration();
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
  const prop = crypto.randomUUID(),
    room = crypto.randomUUID();
  let r, c, offer;
  const d = (
    await sql(
      "select ((now() at time zone 'Australia/Adelaide')::date+1)::text arrival,((now() at time zone 'Australia/Adelaide')::date+interval '3 months')::date::text departure,(now() at time zone 'Australia/Adelaide')::date::text today",
    )
  ).rows[0];
  await sql(
    "insert into properties(id,name,lease_rent,lease_anchor) values($1,'Booking synthetic',500,$2)",
    [prop, d.today],
  );
  await sql(
    "insert into rooms(id,property_id,label,capacity) values($1,$2,'Room 9',1)",
    [room, prop],
  );
  await rpc("save_listing", [
    "property",
    prop,
    {
      slug: "booking-synthetic",
      public_name: "Synthetic House",
      suburb: "Fulham",
      description: "Isolated synthetic property.",
      published: true,
    },
  ]);
  await rpc("save_listing", [
    "room",
    room,
    {
      slug: "room-9",
      title: "Synthetic private room",
      description: "Isolated synthetic private room.",
      ready: true,
      published: true,
    },
  ]);
  const template = await rpc("approve_agreement_template", [
    {
      title: "Synthetic source",
      terms:
        "Reviewed synthetic terms. Utilities are included without additional charges. Rent paid fortnightly in advance.",
      proprietor: {
        name: "Synthetic Proprietor",
        address: "1 Synthetic Road, Adelaide",
        phone: "0400000000",
      },
      confirmation: "APPROVE_REUSABLE_TEMPLATE",
    },
  ]);
  const made = await rpc("create_staff_reservation", [
    {
      room_id: room,
      full_name: "Original Applicant",
      email: "original@example.test",
      phone: "0400000000",
      arrival_date: d.arrival,
      departure_date: d.departure,
    },
    crypto.randomUUID(),
  ]);
  r = (
    await sql("select * from reservations where reservation_code=$1", [
      made.code,
    ])
  ).rows[0];
  await t.test(
    "admin verifies prefilled details and creates immutable applicant contract snapshot",
    async () => {
      const out = await rpc("generate_booking_contract", [
        r.id,
        r.revision,
        {
          full_name: "Verified Applicant",
          email: "verified@example.test",
          phone: "0400000001",
          arrival_date: d.arrival,
          departure_date: d.departure,
          room_id: room,
          template_id: template.id,
          premises_address: "2 Synthetic Road, Adelaide",
          term_description: "Agreed dates",
          resident_names: ["Verified Applicant"],
          first_rent_due: d.arrival,
          bond: 510,
        },
      ]);
      r = out.reservation;
      c = out.contract;
      assert.equal(c.fields.full_name, "Verified Applicant");
      assert.equal(c.fields.phone, "0400000001");
      assert.equal(c.fields.bond, 510);
      assert.equal(c.fields.weekly_rate, 255);
      await assert.rejects(
        () => rpc("generate_booking_contract", [r.id, r.revision - 1, {}]),
        /changed/,
      );
    },
  );
  await t.test(
    "PDF registration and provisional notice require private stored current document",
    async () => {
      await assert.rejects(
        () => rpc("prepare_booking_offer", [r.id, r.revision, c.id]),
        /generated PDF/,
      );
      const path = `contracts/${r.id}/${c.id}/synthetic.pdf`;
      await assert.rejects(
        () => rpc("booking_contract_document", [c.id, path]),
        /Store/,
      );
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",
        [path],
      );
      await rpc("booking_contract_document", [c.id, path]);
      await assert.rejects(
        () => rpc("booking_contract_document", [c.id, path]),
        /immutable/,
      );
      offer = await rpc("prepare_booking_offer", [r.id, r.revision, c.id]);
      assert.equal(offer.recipient, "verified@example.test");
      assert.ok(offer.payload.body.includes("0426721787"));
      assert.ok(
        offer.payload.body.includes("Remaining rent can be paid on arrival"),
      );
      assert.equal(offer.payload.document_path, path);
      assert.equal(
        (await rpc("prepare_booking_offer", [r.id, r.revision, c.id])).id,
        offer.id,
      );
    },
  );
  await t.test(
    "bond and all required signatures block confirmation shortcuts",
    async () => {
      await assert.rejects(
        () => rpc("manage_reservation", [r.id, r.revision, "confirm", {}]),
        /Verify bond/,
      );
      await assert.rejects(
        () => rpc("confirm_paid_booking", [r.id, r.revision, {}]),
        /signed contract/,
      );
      const path = `contracts/${r.id}/signed.pdf`;
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",
        [path],
      );
      await rpc("manage_contract", [
        r.id,
        "signed",
        {
          id: c.id,
          signed_by: "Verified Applicant",
          signature_verified: true,
          signed_document_path: path,
        },
      ]);
      await assert.rejects(
        () =>
          rpc("confirm_paid_booking", [
            r.id,
            r.revision,
            {
              amount: 500,
              payment_verified: true,
              received_date: d.today,
              reference: "test",
            },
          ]),
        /exact bond/,
      );
      await assert.rejects(
        () =>
          rpc("confirm_paid_booking", [
            r.id,
            r.revision,
            {
              amount: 510,
              payment_verified: true,
              received_date: d.today,
              reference: "test",
              receipt_path: "receipts/other/fake.pdf",
            },
          ]),
        /evidence/,
      );
    },
  );
  await t.test(
    "verified final confirmation assigns future tenant, records bond once and hides full room",
    async () => {
      const receipt = `receipts/${r.id}/payment.pdf`;
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-receipts',$1)",
        [receipt],
      );
      const old = r;
      r = await rpc("confirm_paid_booking", [
        r.id,
        r.revision,
        {
          amount: 510,
          payment_verified: true,
          received_date: d.today,
          reference: "synthetic-bank-ref",
          receipt_path: receipt,
        },
      ]);
      assert.equal(r.status, "assigned");
      assert.equal(r.assigned_people.length, 1);
      const p = (
        await sql("select * from people where id=$1", [r.checked_in_person_id])
      ).rows[0];
      assert.equal(p.name, "Verified Applicant");
      assert.equal(
        new Date(p.start_date).toISOString().slice(0, 10),
        d.arrival,
      );
      assert.equal(p.bond_status, "paid");
      assert.equal(Number(p.weekly_rate), 255);
      const payments = (
        await sql("select * from payments where person_id=$1", [p.id])
      ).rows;
      assert.equal(payments.length, 1);
      assert.equal(payments[0].kind, "bond");
      assert.equal(Number(payments[0].amount), 510);
      assert.ok(
        !(await rpc("public_catalog", [])).rooms.some((x) => x.id === room),
      );
      assert.equal(
        (
          await sql("select sakan_private.free_spaces($1,$2,$3) n", [
            room,
            d.arrival,
            d.departure,
          ])
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        () => rpc("confirm_paid_booking", [old.id, old.revision, {}]),
        /changed/,
      );
    },
  );
  await t.test(
    "two final confirmations cannot take the same room across PostgreSQL sessions",
    { skip: !process.env.SAKAN_TEST_DATABASE_URL },
    async () => {
      const raceRoom = crypto.randomUUID();
      await sql(
        "insert into rooms(id,property_id,label,capacity) values($1,$2,'Race room',1)",
        [raceRoom, prop],
      );
      await rpc("save_listing", [
        "room",
        raceRoom,
        {
          slug: "race-room",
          title: "Race room",
          description: "Synthetic concurrency room profile.",
          published: true,
          ready: true,
        },
      ]);
      const args = [];
      for (let i = 0; i < 2; i++) {
        const made = await rpc("create_staff_reservation", [
          {
            room_id: raceRoom,
            full_name: "Race Guest " + i,
            email: "race" + i + "@example.test",
            phone: "0400000000",
            arrival_date: d.arrival,
            departure_date: d.departure,
          },
          crypto.randomUUID(),
        ]);
        const r = (
          await sql("select * from reservations where reservation_code=$1", [
            made.code,
          ])
        ).rows[0];
        const out = await rpc("generate_booking_contract", [
          r.id,
          r.revision,
          {
            full_name: r.full_name,
            email: r.email,
            phone: r.phone,
            room_id: raceRoom,
            template_id: template.id,
            premises_address: "2 Synthetic Road",
            term_description: "Agreed dates",
            resident_names: [r.full_name],
            first_rent_due: d.arrival,
            bond: 510,
          },
        ]);
        await rpc("manage_contract", [
          r.id,
          "approve",
          { id: out.contract.id },
        ]);
        const signed = `contracts/${r.id}/signed.pdf`,
          receipt = `receipts/${r.id}/proof.pdf`;
        await sql(
          "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1),('reservation-receipts',$2)",
          [signed, receipt],
        );
        await rpc("manage_contract", [
          r.id,
          "signed",
          {
            id: out.contract.id,
            signed_by: r.full_name,
            signature_verified: true,
            signed_document_path: signed,
          },
        ]);
        args.push({
          sql: "select public.confirm_paid_booking($1,$2,$3)",
          args: [
            r.id,
            out.reservation.revision,
            JSON.stringify({
              amount: 510,
              payment_verified: true,
              received_date: d.today,
              reference: "race-payment",
              receipt_path: receipt,
            }),
          ],
        });
      }
      await assertSingleAllocation(args);
      assert.equal(
        (
          await sql("select count(*)::int n from people where room_id=$1", [
            raceRoom,
          ])
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "nonstaff and anonymous cannot generate contracts, read defaults or confirm paid bookings",
    async () => {
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
      await sql("set role authenticated");
      try {
        await assert.rejects(
          () => rpc("booking_contract_document", [c.id]),
          /Staff access/,
        );
        assert.equal(
          (await sql("select count(*)::int n from contract_defaults")).rows[0]
            .n,
          0,
        );
      } finally {
        await sql("reset role");
      }
      await sql("set role anon");
      try {
        await assert.rejects(
          () => rpc("confirm_paid_booking", [r.id, r.revision, {}]),
          /permission denied/,
        );
      } finally {
        await sql("reset role");
      }
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
    },
  );
}
