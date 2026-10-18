import { hasUnfilledPlaceholders, isValidTenantEmail } from './features/communications/email-utils.js';
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const validEmail = value => typeof value === 'string' && value.length < 255 && isValidTenantEmail(value);
function encode64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(binary);
}
function encodedSubject(value) {
  const parts = []; let part = '';
  for (const char of value) {
    if (new TextEncoder().encode(part + char).length > 42) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts.map(text => '=?UTF-8?B?' + encode64(text) + '?=').join('\r\n ');
}
export async function gmailSend(request, env, trustedNotification = false) {
  if (request.method !== "POST")
    return reply({ error: "Method not allowed" }, 405);
  if (request.headers.get("Origin") !== "https://sakanlodge.com")
    return reply({ error: "Invalid origin" }, 403);
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLIC_KEY ||
    !env.GMAIL_TOKEN_STORE ||
    !env.GMAIL_TOKEN_ENCRYPTION_KEY ||
    !env.GMAIL_CLIENT_ID ||
    !env.GMAIL_CLIENT_SECRET
  )
    return reply({ error: "Gmail is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer \S+$/.test(authorization))
    return reply({ error: "Sign in required" }, 401);
  try {
    const base = env.SUPABASE_URL.replace(/\/$/, "");
    const dbHeaders = {
      Authorization: authorization,
      apikey: env.SUPABASE_PUBLIC_KEY,
      "Content-Type": "application/json",
    };
    const identity = await fetch(base + "/auth/v1/user", {
      headers: dbHeaders,
    });
    if (!identity.ok) return reply({ error: "Session expired" }, 401);
    const user = await identity.json();
    if (!user.email_confirmed_at)
      return reply({ error: "Administrator access required" }, 403);
    const staffResponse = await fetch(
      base + "/rest/v1/rpc/staff_notification_emails",
      { method: "POST", headers: dbHeaders, body: "{}" },
    );
    if (!staffResponse.ok)
      return reply({ error: "Administrator access required" }, 403);
    const administrators = await staffResponse.json();
    if (
      !Array.isArray(administrators) ||
      administrators.length === 0 ||
      administrators.some((x) => !validEmail(x))
    )
      return reply(
        { error: "Staff notification configuration unavailable" },
        503,
      );
    let data = await request.json();
    const previewing = new URL(request.url).pathname === '/api/gmail/preview';
    let reviewStub;
    if (!trustedNotification && !previewing) {
      if (data.confirmation !== 'SEND_REVIEWED_EMAIL' || !/^[a-f0-9]{32}$/.test(data.reviewId || ''))
        return reply({ error: 'Preview this email before sending' }, 400);
      if (!env.GMAIL_OAUTH_STATE) return reply({ error: 'Email review storage unavailable' }, 503);
      reviewStub = env.GMAIL_OAUTH_STATE.get(env.GMAIL_OAUTH_STATE.idFromName('email-review:' + data.reviewId));
      const claimed = await reviewStub.fetch(new Request('https://state/email-review', {
        method: 'POST', body: JSON.stringify({ owner: user.id }),
      }));
      if (!claimed.ok) return reply({ error: 'Review expired or already attempted. Check Sent Mail before creating another review.' }, 409);
      data = (await claimed.json()).message;
    }
    const { recipients, subject, body } = data || {};
    if (
      !Array.isArray(recipients) ||
      recipients.length < 1 ||
      recipients.length > 100 ||
      typeof subject !== "string" ||
      !subject.trim() ||
      subject.length > 250 ||
      typeof body !== "string" ||
      !body.trim() ||
      body.length > 60000 ||
      /[\r\n]/.test(subject) ||
      hasUnfilledPlaceholders(subject) || hasUnfilledPlaceholders(body)
    )
      return reply({ error: "Review all recipients and message details" }, 400);
    const addresses = [
      ...new Set(recipients.map((x) => String(x).trim().toLowerCase())),
    ];
    if (addresses.some((x) => !validEmail(x)))
      return reply({ error: "Invalid recipient" }, 400);
    const stored = await env.GMAIL_TOKEN_STORE.get(
      "gmail:sender:encrypted-refresh-token",
      "json",
    );
    if (!stored || !validEmail(stored.account))
      return reply({ error: "Reconnect Gmail in settings" }, 409);
    const sender = stored.account;
    if (addresses.includes(sender.toLowerCase())) return reply({ error: "Invalid recipient" }, 400);
    const cc = trustedNotification ? [] : [...new Set(administrators.map(x => x.toLowerCase()))].sort();
    if (!trustedNotification && !previewing && (data.sender !== sender || JSON.stringify(data.cc) !== JSON.stringify(cc)))
      return reply({ error: 'Sender or staff recipients changed. Create a new preview.' }, 409);
    if (previewing) {
      if (!env.GMAIL_OAUTH_STATE || !user.id) return reply({ error: 'Email review storage unavailable' }, 503);
      const reviewId = crypto.randomUUID().replaceAll('-', '');
      const message = { recipients: addresses, subject: subject.trim(), body: body.trim(), sender, cc };
      const stub = env.GMAIL_OAUTH_STATE.get(env.GMAIL_OAUTH_STATE.idFromName('email-review:' + reviewId));
      const storedReview = await stub.fetch(new Request('https://state/email-review', {
        method: 'PUT', body: JSON.stringify({ owner: user.id, expires: Date.now() + 15 * 60_000, message }),
      }));
      if (!storedReview.ok) return reply({ error: 'Unable to prepare review' }, 503);
      return reply({ reviewId, ...message });
    }
    if (addresses.includes(sender.toLowerCase()))
      return reply({ error: "Invalid recipient" }, 400);
    const keyBytes = Uint8Array.from(
      atob(env.GMAIL_TOKEN_ENCRYPTION_KEY),
      (x) => x.charCodeAt(0),
    );
    if (keyBytes.length !== 32)
      return reply({ error: "Invalid encryption configuration" }, 503);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const refreshToken = new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(stored.iv) },
        key,
        new Uint8Array(stored.data),
      ),
    );
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID,
        client_secret: env.GMAIL_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResponse.ok)
      return reply(
        { error: "Gmail authorization expired. Reconnect Gmail." },
        409,
      );
    const token = await tokenResponse.json();
    if (!token.access_token)
      return reply({ error: "Gmail access unavailable" }, 502);
    const lines = [
      "From: Sakan Lodge <" + sender + ">",
      "To: " + sender,
      ...(cc.length ? ["Cc: " + cc.join(",\r\n ")] : []),
      "Bcc: " + addresses.join(",\r\n "),
      "Subject: " + encodedSubject(subject.trim()),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encode64(body).match(/.{1,76}/g).join("\r\n"),
    ];
    const encoded = encode64(lines.join("\r\n"))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token.access_token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      },
    );
    if (!result.ok)
      return reply(
        {
          error:
            "Gmail did not confirm sending. Check Sent Mail before retrying.",
        },
        502,
      );
    const sent = await result.json();
    if (!sent.id)
      return reply(
        { error: "Sending confirmation missing. Check Sent Mail." },
        502,
      );
    let logged = false;
    try {
    const auditResponse = await fetch(base + "/rest/v1/rpc/log_sent_email", {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        p_subject: subject.trim(),
        p_count: addresses.length,
        p_message_id: sent.id,
      }),
    });
    logged = auditResponse.ok;
    } catch { /* Delivery is already confirmed; audit failure must not invite another send. */ }
    return reply({
      sent: true,
      recipientCount: addresses.length,
      messageId: sent.id,
      logged,
    });
  } catch {
    return reply(
      { error: "Unable to confirm sending. Check Sent Mail before retrying." },
      503,
    );
  }
}
