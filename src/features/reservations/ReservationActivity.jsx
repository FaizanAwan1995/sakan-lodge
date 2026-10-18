import { useEffect, useState } from "react";
import { supabase, isLocalMode } from "../../store.js";
export default function ReservationActivity() {
  const [data, setData] = useState({ events: [], messages: [], contracts: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const results = await Promise.all([
      supabase
        .from("reservation_events")
        .select("*,reservations(full_name,reservation_code)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("notification_outbox")
        .select("*,reservations(full_name,reservation_code)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("contracts")
        .select(
          "id,reservation_id,version,status,created_at,document_path,signed_document_path,reservations(full_name,reservation_code)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    for (const r of results) if (r.error) throw r.error;
    setData({
      events: results[0].data,
      messages: results[1].data,
      contracts: results[2].data,
    });
  }
  useEffect(() => {
    if (!isLocalMode) load().catch((e) => setError(e.message));
  }, []);
  if (isLocalMode) return null;
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function action(n, kind, message) {
    const { error } = await supabase.rpc("notification_action", {
      p_id: n.id,
      p_action: kind,
      p_message: message,
    });
    if (error) throw error;
  }
  async function send(n) {
    if (
      !confirm(
        `Send to ${n.recipient}?\n\n${n.payload.subject}\n\n${n.payload.body}`,
      )
    )
      return;
    const { data } = await supabase.auth.getSession();
    const r = await fetch("/api/reservations/email", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + data.session.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: n.id, confirmation: "SEND_REVIEWED_EMAIL" }),
    });
    const out = await r.json();
    if (!r.ok)
      throw Error(out.error || "Sending not confirmed. Check Gmail Sent Mail.");
  }
  async function download(path) {
    const { data, error } = await supabase.storage
      .from("reservation-contracts")
      .download(path);
    if (error) throw error;
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SAKAN-agreement.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const name = (x) => x.reservations?.full_name || x.reservation_id;
  return (
    <section className="reservation-activity">
      <h2>Reservation activity</h2>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => run(load)}>
        Refresh activity
      </button>
      <details>
        <summary>
          Email queue and delivery records ({data.messages.length})
        </summary>
        <p>
          Uncertain delivery must be checked in Gmail Sent Mail before retrying.
        </p>
        {data.messages.map((n) => (
          <details key={n.id}>
            <summary>
              {name(n)} · {n.kind.replaceAll("_", " ")} · {n.status}
            </summary>
            <p>
              {n.recipient} · {n.payload.subject}
            </p>
            <pre style={{ whiteSpace: "pre-wrap" }}>{n.payload.body}</pre>
            {n.status === "pending" && (
              <button disabled={busy} onClick={() => run(() => send(n))}>
                Review and send email
              </button>
            )}
            {["sending", "uncertain"].includes(n.status) && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    const id = prompt(
                      "Verified Gmail message ID (check Sent Mail first)",
                    );
                    if (id) run(() => action(n, "reconcile_sent", id));
                  }}
                >
                  Record verified delivery
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "I checked Sent Mail and verified this message was NOT sent. Requeue it?",
                      )
                    )
                      run(() =>
                        action(n, "requeue", "CHECKED_SENT_MAIL_NOT_SENT"),
                      );
                  }}
                >
                  Verified not sent: requeue
                </button>
              </>
            )}
          </details>
        ))}
      </details>
      <details>
        <summary>Contract versions ({data.contracts.length})</summary>
        {data.contracts.map((c) => (
          <div key={c.id}>
            <p>
              {name(c)} · Version {c.version} · {c.status}
            </p>
            {c.document_path && (
              <button onClick={() => run(() => download(c.document_path))}>
                Download generated PDF
              </button>
            )}
            {c.signed_document_path && (
              <button
                onClick={() => run(() => download(c.signed_document_path))}
              >
                Download signed copy
              </button>
            )}
          </div>
        ))}
      </details>
      <details>
        <summary>Reservation event log ({data.events.length})</summary>
        {data.events.map((e) => (
          <div key={e.id}>
            <small>
              {new Date(e.created_at).toLocaleString("en-AU")} · {name(e)}
            </small>
            <p>{e.action.replaceAll("_", " ")}</p>
            <details>
              <summary>Event details</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(e.details, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </details>
    </section>
  );
}
