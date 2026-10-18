import { databaseRpc, json, limitedJson } from "./public-site.js";
import { gmailSend } from "./gmail-send.js";
export async function reservationEmail(request, env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("Origin") !== "https://sakanlodge.com")
    return json({ error: "Invalid origin" }, 403);
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer \S+$/.test(authorization))
    return json({ error: "Sign in required" }, 401);
  let claimed = null;
  try {
    const data = await limitedJson(request, 2000);
    if (
      data.confirmation !== "SEND_REVIEWED_EMAIL" ||
      !/^[a-f0-9-]{36}$/i.test(data.id || "")
    )
      return json({ error: "Review this notification first" }, 400);
    claimed = await databaseRpc(
      env,
      "notification_action",
      { p_id: data.id, p_action: "claim" },
      authorization,
    );
    const options = {};
    if (claimed.kind === "provisional_offer") {
      const snapshot = await databaseRpc(
        env,
        "booking_contract_document",
        { p_id: claimed.payload.contract_id },
        authorization,
      );
      const c = snapshot.contract;
      if (
        c.status !== "approved" ||
        c.document_path !== claimed.payload.document_path
      )
        throw Error("Contract changed");
      const file = await fetch(
        env.SUPABASE_URL.replace(/\/$/, "") +
          "/storage/v1/object/authenticated/reservation-contracts/" +
          c.document_path,
        {
          headers: {
            Authorization: authorization,
            apikey: env.SUPABASE_PUBLIC_KEY,
          },
        },
      );
      if (!file.ok) throw Error("Contract PDF unavailable");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (
        bytes.length > 10485760 ||
        new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
      )
        throw Error("Invalid contract PDF");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.slice(i, i + 8192));
      options.attachments = [
        {
          filename: "SAKAN-agreement-v" + c.version + ".pdf",
          base64: btoa(binary),
        },
      ];
      options.expectedSender = "sakanlodges@gmail.com";
    }
    const internal = new Request("https://sakanlodge.com/api/gmail/send", {
      method: "POST",
      headers: {
        Origin: "https://sakanlodge.com",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipients: [claimed.recipient],
        subject: claimed.payload.subject,
        body: claimed.payload.body,
        confirmation: "SEND_REVIEWED_EMAIL",
        copyAdministrators: false,
      }),
    });
    const sent = await gmailSend(internal, env, true, options);
    const result = await sent.json();
    if (!sent.ok || !result.sent || !result.messageId) {
      await databaseRpc(
        env,
        "notification_action",
        { p_id: claimed.id, p_action: "uncertain" },
        authorization,
      );
      return json(
        {
          error:
            "Sending was not confirmed. Check Gmail Sent Mail before retrying.",
        },
        502,
      );
    }
    await databaseRpc(
      env,
      "notification_action",
      { p_id: claimed.id, p_action: "sent", p_message: result.messageId },
      authorization,
    );
    return json({ sent: true, messageId: result.messageId });
  } catch (e) {
    // A crash after claiming leaves sending/uncertain, never automatically retries.
    if (claimed)
      try {
        await databaseRpc(
          env,
          "notification_action",
          { p_id: claimed.id, p_action: "uncertain" },
          authorization,
        );
      } catch {
        /* Staff must reconcile Sent Mail. */
      }
    return json(
      {
        error: claimed
          ? "Check Gmail Sent Mail; sending could not be confirmed."
          : "Unable to claim notification. Refresh and verify staff access.",
      },
      claimed ? 503 : 409,
    );
  }
}
