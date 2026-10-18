import test from "node:test";
import assert from "node:assert/strict";
import { bookingContractApi } from "./booking-contract-api.js";
const request = (body, auth = "Bearer synthetic-staff") =>
  new Request("https://sakanlodge.com/api/reservations/contract-pdf", {
    method: "POST",
    headers: {
      Origin: "https://sakanlodge.com",
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("PDF generation requires a staff-authorised contract before storage", async () => {
  assert.equal(
    (await bookingContractApi(request({ id: "x" }, ""), {})).status,
    403,
  );
  const original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ message: "denied" }), { status: 403 });
  };
  try {
    assert.equal(
      (
        await bookingContractApi(request({ id: "x" }), {
          SUPABASE_URL: "https://synthetic.test",
          SUPABASE_PUBLIC_KEY: "public",
        })
      ).status,
      409,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("worker creates actual PDF bytes and registers only its private immutable storage path", async () => {
  const original = fetch;
  const paths = [];
  let uploaded;
  const c = {
    id: "00000000-0000-4000-8000-000000000001",
    reservation_id: "00000000-0000-4000-8000-000000000002",
    version: 1,
    status: "draft",
    fields: {
      proprietor: {
        name: "Synthetic Proprietor",
        address: "1 Synthetic Road",
        phone: "0400000000",
      },
      resident_names: ["Synthetic Resident"],
      full_name: "Synthetic Resident",
      email: "test@example.test",
      phone: "0400000000",
      premises_address: "2 Synthetic Road",
      terms: "Reviewed synthetic terms.",
      arrival_date: "2030-01-01",
      departure_date: "2030-04-01",
      first_rent_due: "2030-01-01",
      term_description: "Agreed dates",
      weekly_rate: 255,
      bond: 510,
      room_label: "Room 1",
    },
  };
  globalThis.fetch = async (url, options) => {
    paths.push(String(url));
    if (String(url).includes("/rest/v1/rpc/")) {
      assert.equal(options.headers.Authorization, "Bearer synthetic-staff");
      const args = JSON.parse(options.body);
      if (args.p_path) c.document_path = args.p_path;
      return new Response(JSON.stringify({ contract: c, code: "SYNTHETIC" }));
    }
    uploaded = options.body;
    assert.equal(options.headers.Authorization, "Bearer synthetic-staff");
    return new Response("{}");
  };
  try {
    const res = await bookingContractApi(
      request({ id: c.id, path: "attacker-path" }),
      { SUPABASE_URL: "https://synthetic.test", SUPABASE_PUBLIC_KEY: "public" },
    );
    assert.equal(res.status, 200);
    assert.equal(new TextDecoder().decode(uploaded.slice(0, 5)), "%PDF-");
    assert.ok(
      c.document_path.startsWith(`contracts/${c.reservation_id}/${c.id}/`),
    );
    assert.equal(paths.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
