import assert from "node:assert/strict";
export async function verifyManualBooking({
  t,
  sql,
  rpc,
  STAFF,
  OTHER,
  applyMigration,
  assertSingleAllocation,
}) {
  await applyMigration();
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
  const prop = crypto.randomUUID(),
    room = crypto.randomUUID();
  const d = (
    await sql(
      "select ((now() at time zone 'Australia/Adelaide')::date+5)::text arrival,((now() at time zone 'Australia/Adelaide')::date+95)::text departure",
    )
  ).rows[0];
  await sql(
    "insert into properties(id,name,lease_rent,lease_anchor) values($1,'Manual synthetic',500,$2)",
    [prop, d.arrival],
  );
  await sql(
    "insert into rooms(id,property_id,label,capacity) values($1,$2,'Manual 1',1)",
    [room, prop],
  );
  await rpc("save_listing", [
    "property",
    prop,
    {
      slug: "manual-synthetic",
      public_name: "Synthetic House",
      suburb: "Fulham",
      description: "Synthetic test property",
      published: true,
    },
  ]);
  await rpc("save_listing", [
    "room",
    room,
    {
      slug: "manual-1",
      title: "Synthetic room",
      description: "Synthetic private room",
      ready: true,
      published: true,
    },
  ]);
  const template = await rpc("approve_agreement_template", [
    {
      title: "Manual synthetic",
      terms:
        "Reviewed synthetic agreement. Utilities included without extra charges.",
      proprietor: {
        name: "Synthetic Owner",
        address: "1 Synthetic Road",
        phone: "0400000000",
      },
      confirmation: "APPROVE_REUSABLE_TEMPLATE",
    },
  ]);
  async function make() {
    const made = await rpc("create_staff_reservation", [
      {
        room_id: room,
        full_name: "Manual Resident",
        email: "manual@example.test",
        phone: "0400000000",
        arrival_date: d.arrival,
        departure_date: d.departure,
      },
      crypto.randomUUID(),
    ]);
    let r = (
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
        room_id: room,
        arrival_date: d.arrival,
        departure_date: d.departure,
        template_id: template.id,
        premises_address: "1 Synthetic Road",
        term_description: "Fixed term agreed dates",
        resident_names: [r.full_name],
        first_rent_due: d.arrival,
        bond: 510,
      },
    ]);
    return out;
  }
  await sql(
    "insert into contract_defaults(property_id,premises_address,proprietor) values($1,'1 Synthetic Road',$2)",
    [
      prop,
      JSON.stringify({
        signature_name: "Synthetic Owner",
        signature_png: "synthetic-private-artwork",
      }),
    ],
  );
  const one = await make(),
    two = await make();
  assert.equal(
    one.contract.fields.proprietor_signature.signature_name,
    "Synthetic Owner",
  );
  assert.equal(
    one.contract.fields.proprietor_signature.signature_png,
    "synthetic-private-artwork",
  );
  assert.match(
    one.contract.fields.proprietor_signature_date,
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await t.test(
    "manual confirmation requires generated current PDF and staff permission",
    async () => {
      await assert.rejects(
        () =>
          rpc("confirm_manual_booking", [
            one.reservation.id,
            one.reservation.revision,
            one.contract.id,
          ]),
        /PDF/,
      );
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
      await assert.rejects(
        () =>
          rpc("confirm_manual_booking", [
            one.reservation.id,
            one.reservation.revision,
            one.contract.id,
          ]),
        /Staff/,
      );
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [STAFF]);
    },
  );
  for (const out of [one, two]) {
    const path = `contracts/${out.reservation.id}/${out.contract.id}/synthetic.pdf`;
    await sql(
      "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",
      [path],
    );
    await rpc("booking_contract_document", [out.contract.id, path]);
  }
  await t.test(
    "manual confirmation assigns tenant with unpaid bond and no invented payment or signed receipt",
    async () => {
      const before = (await sql("select count(*)::int n from payments")).rows[0]
        .n;
      const r = await rpc("confirm_manual_booking", [
        one.reservation.id,
        one.reservation.revision,
        one.contract.id,
      ]);
      assert.equal(r.status, "assigned");
      assert.equal(r.bond_verified_at, null);
      const p = (
        await sql("select * from people where id=$1", [r.checked_in_person_id])
      ).rows[0];
      assert.equal(p.bond_status, "not_paid");
      assert.equal(p.name, "Manual Resident");
      assert.equal(
        (await sql("select count(*)::int n from payments")).rows[0].n,
        before,
      );
      assert.equal(
        (
          await sql("select status from contracts where id=$1", [
            one.contract.id,
          ])
        ).rows[0].status,
        "draft",
      );
      await assert.rejects(
        () =>
          rpc("confirm_manual_booking", [
            one.reservation.id,
            one.reservation.revision,
            one.contract.id,
          ]),
        /changed|again/,
      );
      await assert.rejects(
        () =>
          rpc("confirm_manual_booking", [
            two.reservation.id,
            two.reservation.revision,
            two.contract.id,
          ]),
        /available|capacity/,
      );
    },
  );
  await t.test(
    "simultaneous manual confirmations serialize room assignment",
    { skip: !process.env.SAKAN_TEST_DATABASE_URL },
    async () => {
      await sql("update people set start_date=start_date-2,end_date=start_date-1 where room_id=$1", [
        room,
      ]);
      const three = await make();
      const path = `contracts/${three.reservation.id}/${three.contract.id}/synthetic.pdf`;
      await sql(
        "insert into storage.objects(bucket_id,name) values('reservation-contracts',$1)",
        [path],
      );
      await rpc("booking_contract_document", [three.contract.id, path]);
      await assertSingleAllocation(
        [two, three].map((out) => ({
          sql: "select public.confirm_manual_booking($1,$2,$3)",
          args: [out.reservation.id, out.reservation.revision, out.contract.id],
        })),
      );
    },
  );
}
