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
    const sent = await gmailSend(internal, env);
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
