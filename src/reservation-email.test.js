import test from "node:test";
import assert from "node:assert/strict";
import { reservationEmail } from "./reservation-email.js";
const req = (body, headers = {}) =>
  new Request("https://sakanlodge.com/api/reservations/email", {
    method: "POST",
    headers: {
      Origin: "https://sakanlodge.com",
      Authorization: "Bearer staff-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const id = "10000000-0000-4000-8000-000000000001";
test("reservation email requires explicit review and same origin", async () => {
  assert.equal((await reservationEmail(req({ id }), {})).status, 400);
  assert.equal(
    (
      await reservationEmail(
        req(
          { id, confirmation: "SEND_REVIEWED_EMAIL" },
          { Origin: "https://evil.test" },
        ),
        {},
      )
    ).status,
    403,
  );
});
test("failed send leaves uncertain state and does not automatically retry", async () => {
  const original = globalThis.fetch;
  const actions = [];
  globalThis.fetch = async (url, opts) => {
    const input = JSON.parse(opts.body);
    actions.push(input.p_action);
    return new Response(
      JSON.stringify({
        id,
        recipient: "guest@example.test",
        payload: {
          subject: "Reviewed request",
          body: "Your request is under review.",
        },
      }),
    );
  };
  try {
    const response = await reservationEmail(
      req({ id, confirmation: "SEND_REVIEWED_EMAIL" }),
      { SUPABASE_URL: "https://database.test", SUPABASE_PUBLIC_KEY: "public" },
    );
    assert.equal(response.status, 502);
    assert.deepEqual(actions, ["claim", "uncertain"]);
  } finally {
    globalThis.fetch = original;
  }
});
test("claim rejection cannot reach Gmail or accept replacement recipient/body", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ message: "Already handled" }), {
      status: 409,
    });
  };
  try {
    const response = await reservationEmail(
      req({
        id,
        confirmation: "SEND_REVIEWED_EMAIL",
        recipient: "attacker@example.test",
        body: "replacement",
      }),
      { SUPABASE_URL: "https://database.test", SUPABASE_PUBLIC_KEY: "public" },
    );
    assert.equal(response.status, 409);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("reviewed notification sends only the immutable claimed recipient and records the Gmail ID", async () => {
  const original = globalThis.fetch;
  const actions = [];
  let gmailRaw = "";
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode("synthetic-refresh-token"),
  );
  const env = {
    SUPABASE_URL: "https://database.test",
    SUPABASE_PUBLIC_KEY: "public",
    GMAIL_CLIENT_ID: "test",
    GMAIL_CLIENT_SECRET: "test",
    GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.from(rawKey).toString("base64"),
    GMAIL_TOKEN_STORE: {
      get: async () => ({
        account: "sender@example.test",
        iv: [...iv],
        data: [...new Uint8Array(encrypted)],
      }),
    },
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/notification_action")) {
      const input = JSON.parse(options.body);
      actions.push(input.p_action);
      return new Response(
        JSON.stringify({
          id,
          recipient: "guest@example.test",
          payload: {
            subject: "Reviewed request",
            body: "Your request is under review.",
          },
        }),
      );
    }
    if (String(url).endsWith("/staff_notification_emails"))
      return new Response(
        JSON.stringify(["staff@example.test", "staff2@example.test"]),
      );
    if (String(url).endsWith("/auth/v1/user"))
      return new Response(
        JSON.stringify({
          email: "staff@example.test",
          email_confirmed_at: "2026-01-01",
        }),
      );
    if (String(url).includes("oauth2.googleapis.com"))
      return new Response(
        JSON.stringify({ access_token: "synthetic-access-token" }),
      );
    if (String(url).includes("gmail.googleapis.com")) {
      gmailRaw = Buffer.from(
        JSON.parse(options.body).raw,
        "base64url",
      ).toString();
      return new Response(JSON.stringify({ id: "testMessage123" }));
    }
    if (String(url).endsWith("/log_sent_email")) return new Response("null");
    throw new Error("Unexpected external call");
  };
  try {
    const response = await reservationEmail(
      req({
        id,
        confirmation: "SEND_REVIEWED_EMAIL",
        recipient: "attacker@example.test",
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(actions, ["claim", "sent"]);
    assert.ok(gmailRaw.includes("Bcc: guest@example.test"));
    assert.ok(!gmailRaw.includes("attacker@example.test"));
    assert.ok(!gmailRaw.includes("Cc:"));
  } finally {
    globalThis.fetch = original;
  }
});

test("provisional notice sends the exact private reviewed PDF from the lodge account", async () => {
  const original = globalThis.fetch;
  const actions = [];
  let gmailRaw = "";
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode("synthetic-refresh-token"),
  );
  const env = {
    SUPABASE_URL: "https://database.test",
    SUPABASE_PUBLIC_KEY: "public",
    GMAIL_CLIENT_ID: "test",
    GMAIL_CLIENT_SECRET: "test",
    GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.from(rawKey).toString("base64"),
    GMAIL_TOKEN_STORE: {
      get: async () => ({
        account: "sakanlodges@gmail.com",
        iv: [...iv],
        data: [...new Uint8Array(encrypted)],
      }),
    },
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/notification_action")) {
      const input = JSON.parse(options.body);
      actions.push(input.p_action);
      return new Response(
        JSON.stringify({
          id,
          recipient: "guest@example.test",
          kind: "provisional_offer",
          payload: {
            contract_id: "10000000-0000-4000-8000-000000000002",
            document_path: "contracts/synthetic/reviewed.pdf",
            subject: "Reviewed request",
            body: "Your request is under review.",
          },
        }),
      );
    }
    if (String(url).endsWith('/booking_contract_document')) return new Response(JSON.stringify({contract:{status:'approved',version:2,document_path:'contracts/synthetic/reviewed.pdf'}}));
    if (String(url).includes('/storage/v1/object/authenticated/')) return new Response('%PDF-synthetic-reviewed-attachment');
    if (String(url).endsWith("/staff_notification_emails"))
      return new Response(
        JSON.stringify(["staff@example.test", "staff2@example.test"]),
      );
    if (String(url).endsWith("/auth/v1/user"))
      return new Response(
        JSON.stringify({
          email: "staff@example.test",
          email_confirmed_at: "2026-01-01",
        }),
      );
    if (String(url).includes("oauth2.googleapis.com"))
      return new Response(
        JSON.stringify({ access_token: "synthetic-access-token" }),
      );
    if (String(url).includes("gmail.googleapis.com")) {
      gmailRaw = Buffer.from(
        JSON.parse(options.body).raw,
        "base64url",
      ).toString();
      return new Response(JSON.stringify({ id: "testMessage123" }));
    }
    if (String(url).endsWith("/log_sent_email")) return new Response("null");
    throw new Error("Unexpected external call");
  };
  try {
    const response = await reservationEmail(
      req({
        id,
        confirmation: "SEND_REVIEWED_EMAIL",
        recipient: "attacker@example.test",
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(actions, ["claim", "sent"]);
    assert.ok(gmailRaw.includes("Bcc: guest@example.test"));
    assert.ok(!gmailRaw.includes("attacker@example.test"));
    assert.ok(!gmailRaw.includes("Cc:"));
    assert.ok(gmailRaw.includes('From: Sakan Lodge <sakanlodges@gmail.com>'));
    assert.ok(gmailRaw.includes('multipart/mixed'));
    assert.ok(gmailRaw.includes('Content-Disposition: attachment; filename="SAKAN-agreement-v2.pdf"'));
    assert.ok(gmailRaw.includes(Buffer.from('%PDF-synthetic-reviewed-attachment').toString('base64')));
  } finally {
    globalThis.fetch = original;
  }
});
