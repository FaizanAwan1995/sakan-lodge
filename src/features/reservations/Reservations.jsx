import { useEffect, useRef, useState } from "react";
import { supabase, isLocalMode } from "../../store.js";
import ListingManagement from "./ListingManagement.jsx";
import { escapeHtml } from "../../public-routes.js";
const STATES = [
  "pending",
  "review",
  "held",
  "confirmed",
  "checked_in",
  "cancelled",
  "archived",
];
const format = (v) =>
  v ? new Date(v + "T00:00:00").toLocaleDateString("en-AU") : "Not specified";
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export default function Reservations({ db, reload }) {
  const detailVersion = useRef(0);
  const selectedRef = useRef(null);
  const [stale, setStale] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rows, setRows] = useState([]),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [view, setView] = useState("reservations"),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState({ events: [], contracts: [], messages: [] }),
    [draft, setDraft] = useState({}),
    [notice, setNotice] = useState("");
  async function refresh() {
    if (!supabase) return;
    setError("");
    try {
      const { data, error: e } = await supabase
        .from("reservations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (e) throw e;
      setRows(data || []);
      const current = selectedRef.current;
      if (current) {
        const next = (data || []).find((r) => r.id === current.id);
        if (next && next.revision !== current.revision) setStale(true);
      }
      return data || [];
    } catch (e) {
      setError(e.message || "Unable to load reservations");
    }
  }
  async function loadDetail(id) {
    const requestVersion = ++detailVersion.current;
    const results = await Promise.all([
      supabase
        .from("reservation_events")
        .select("*")
        .eq("reservation_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contracts")
        .select("*")
        .eq("reservation_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("notification_outbox")
        .select("*")
        .eq("reservation_id", id)
        .order("created_at", { ascending: false }),
    ]);
    for (const r of results) if (r.error) throw r.error;
    if (requestVersion !== detailVersion.current) return;
    setDetail({
      events: results[0].data,
      contracts: results[1].data,
      messages: results[2].data,
    });
  }
  useEffect(() => {
    refresh();
    if (!supabase) return;
    const workflowTables = new Set([
      "reservations",
      "reservation_events",
      "contracts",
      "notification_outbox",
    ]);
    const sync = () => {
      void refresh();
      if (selectedRef.current)
        void loadDetail(selectedRef.current.id).catch((e) =>
          setError(e.message || "Unable to refresh details"),
        );
    };
    const channel = supabase
      .channel("reservations-inbox")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (workflowTables.has(payload.table)) sync();
      })
      .subscribe();
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
    };
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      if (selected) await loadDetail(selected.id);
      setNotice("Saved.");
    } catch (e) {
      setError(e.message || "Unable to complete action");
    } finally {
      setBusy(false);
    }
  }
  async function open(r) {
    if (!r) return;
    selectedRef.current = r;
    setStale(false);
    setSelected(r);
    setDraft({
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
      room_id: r.room_id,
      spaces_requested: r.spaces_requested,
      admin_notes: r.admin_notes || "",
      expires_at: "",
      terms: "",
      template_reference: "",
      signed_by: r.full_name,
      resident_names: r.full_name,
    });
    setError("");
    try {
      await loadDetail(r.id);
    } catch (e) {
      setError(e.message);
    }
  }
  const change = (key, value) => setDraft((x) => ({ ...x, [key]: value }));
  const action = (name, data = {}) =>
    run(async () => {
      if (stale)
        throw new Error("This reservation changed. Reload before saving.");
      const r = await rpc("manage_reservation", {
        p_id: selected.id,
        p_revision: selected.revision,
        p_action: name,
        p_data: data,
      });
      selectedRef.current = r;
      setStale(false);
      setSelected(r);
      if (name === "check_in") reload?.();
    });
  const contract = (name, data) =>
    run(() =>
      rpc("manage_contract", {
        p_res: selected.id,
        p_action: name,
        p_data: data,
      }),
    );
  async function send(n) {
    if (
      !confirm(
        "Send this reviewed message to " +
          n.recipient +
          "?\n\n" +
          n.payload.subject +
          "\n\n" +
          n.payload.body,
      )
    )
      return;
    await run(async () => {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/reservations/email", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + data.session.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: n.id, confirmation: "SEND_REVIEWED_EMAIL" }),
      });
      const output = await response.json();
      if (!response.ok)
        throw new Error(
          output.error || "Sending not confirmed. Check Sent Mail.",
        );
    });
  }
  function printContract(c) {
    const win = window.open("", "_blank");
    if (!win) {
      setError("Allow popups to print the contract");
      return;
    }
    win.opener = null;
    const f = c.fields;
    win.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Agreement ' +
        escapeHtml(selected.reservation_code) +
        "</title><style>body{font:14px/1.6 sans-serif;max-width:760px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;font:inherit}@media print{button{display:none}}</style></head><body><h1>SAKAN Lodge agreement</h1><p>" +
        escapeHtml(selected.reservation_code) +
        " · version " +
        c.version +
        " · " +
        escapeHtml(c.status) +
        "</p><p>" +
        escapeHtml(f.full_name) +
        " · " +
        escapeHtml(f.arrival_date) +
        " to " +
        escapeHtml(f.departure_date) +
        "</p><p>AUD $" +
        escapeHtml(f.weekly_rate) +
        "/week" +
        (selected.offer_type === "shared" ? " per person" : "") +
        "</p><p>" +
        escapeHtml(f.utilities) +
        "</p><pre>" +
        escapeHtml(f.terms) +
        "</pre><p>Resident signature: ____________________ Date: __________</p><p>Proprietor signature: ____________________ Date: __________</p></body></html>",
    );
    win.document.close();
    win.print();
  }
  const needsNightlyRate = selected && (Date.parse(selected.departure_date + 'T00:00:00Z') - Date.parse(selected.arrival_date + 'T00:00:00Z')) / 86400000 < 7;
  if (isLocalMode || !supabase)
    return (
      <section className="card">
        <h2>Reservations and public listings</h2>
        <p>
          Management requires the connected staff database. Browser-local
          preview cannot create public bookings.
        </p>
      </section>
    );
  return (
    <section aria-label="Reservation management">
      <button
        disabled={busy}
        onClick={() => {
          setCreating((x) => !x);
          setSelected(null);
          setView("reservations");
        }}
      >
        New staff reservation request
      </button>
      {creating && (
        <CreateRequest
          db={db}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}
      <div className="between">
        <h1>Reservations & listings</h1>
        <button disabled={busy} onClick={() => run(refresh)}>
          Refresh
        </button>
      </div>
      <p>
        Online customer requests remain disabled until deployment acceptance.
        Requests are unconfirmed; only active holds and confirmed stays allocate
        inventory. Emails require manual review and sending.
      </p>
      <div className="screen-actions">
        {["reservations", "listings", "blocks"].map((v) => (
          <button
            key={v}
            className={view === v ? "primary" : ""}
            onClick={() => {
              setView(v);
              setSelected(null);
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {view === "listings" ? (
        <ListingManagement db={db} />
      ) : view === "blocks" ? (
        <Blocks db={db} />
      ) : (
        <>
          {selected ? (
            <article className="card">
              <button
                onClick={() => {
                  selectedRef.current = null;
                  setSelected(null);
                  setStale(false);
                }}
              >
                Back to inbox
              </button>
              {stale && (
                <p role="alert" className="err">
                  Another session changed this reservation. Your unsaved fields
                  have been preserved. Reload before saving.
                </p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const latest = await refresh();
                    await open(latest?.find((r) => r.id === selected.id));
                  })
                }
              >
                Reload this reservation
              </button>
              <h2>
                {selected.full_name} · {selected.reservation_code}
              </h2>
              <p>
                Status: <strong>{selected.status}</strong> · revision{" "}
                {selected.revision}
              </p>
              <p>
                {selected.email} · {selected.phone}
              </p>
              {selected.introduction && <p>{selected.introduction}</p>}
              <p>
                Quote: ${selected.weekly_rate}/week
                {selected.offer_type === "shared" ? " per person" : ""}. No
                utility surcharge.
              </p>
              {selected.status === "held" && (
                <p>
                  Hold expires:{" "}
                  {new Date(selected.hold_expires_at).toLocaleString("en-AU", {
                    timeZone: "Australia/Adelaide",
                  })}{" "}
                  (Adelaide). Expired holds release availability automatically.
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action("edit", draft);
                }}
              >
                <h3>Modify request</h3>
                <p>
                  Saving changes returns the request to review and supersedes
                  earlier contracts and notification drafts.
                </p>
                <label>
                  Room
                  <select
                    value={draft.room_id}
                    onChange={(e) => change("room_id", e.target.value)}
                  >
                    {db.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {
                          db.properties.find((p) => p.id === r.property_id)
                            ?.name
                        }{" "}
                        · {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Arrival
                  <input
                    type="date"
                    required
                    value={draft.arrival_date || ""}
                    onChange={(e) => change("arrival_date", e.target.value)}
                  />
                </label>
                <label>
                  Departure
                  <input
                    type="date"
                    required
                    value={draft.departure_date || ""}
                    onChange={(e) => change("departure_date", e.target.value)}
                  />
                </label>
                <label>
                  Spaces
                  <input
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={draft.spaces_requested}
                    onChange={(e) =>
                      change("spaces_requested", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Private admin notes
                  <textarea
                    maxLength={4000}
                    value={draft.admin_notes || ""}
                    onChange={(e) => change("admin_notes", e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    ["cancelled", "archived", "checked_in"].includes(
                      selected.status,
                    )
                  }
                >
                  Save changes for review
                </button>
              </form>
              <div className="card">
                <h3>Manage reservation</h3>
                <button
                  disabled={busy || selected.status !== "pending"}
                  onClick={() => action("review")}
                >
                  Review request
                </button>
                <label>
                  Explicit hold expiry (your device local time)
                  <input
                    type="datetime-local"
                    value={draft.expires_at}
                    onChange={(e) => change("expires_at", e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !draft.expires_at ||
                    !["pending", "review", "held"].includes(selected.status)
                  }
                  onClick={() =>
                    action("hold", {
                      expires_at: new Date(draft.expires_at).toISOString(),
                    })
                  }
                >
                  Place / extend hold
                </button>
                <button
                  disabled={
                    busy ||
                    !["pending", "review", "held"].includes(selected.status)
                  }
                  onClick={() => action("confirm")}
                >
                  Confirm after signed agreement
                </button>
                <button
                  disabled={
                    busy ||
                    !["pending", "review", "held", "confirmed"].includes(
                      selected.status,
                    )
                  }
                  onClick={() => {
                    if (
                      confirm(
                        "Cancel this reservation and release its allocation?",
                      )
                    )
                      action("cancel");
                  }}
                >
                  Cancel reservation
                </button>
                <button
                  disabled={busy || selected.status !== "cancelled"}
                  onClick={() => action("archive")}
                >
                  Archive cancelled request
                </button>
                {selected.status === "confirmed" && (
                  <>
                    <label>
                      Resident names (one per bed space)
                      <textarea
                        value={draft.resident_names || ""}
                        onChange={(e) =>
                          change("resident_names", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Agreed bond amount per resident (no payment is recorded)
                      <input
                        type="number"
                        min="0"
                        step=".01"
                        value={draft.bond || ""}
                        onChange={(e) => change("bond", e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || needsNightlyRate || draft.bond == null || draft.bond === ""}
                      onClick={() => {
                        if (
                          confirm(
                            "Create a new ledger resident from this reservation? Existing records and payments will not change.",
                          )
                        )
                          action("check_in", {
                            bond: Number(draft.bond),
                            residents: (draft.resident_names || "")
                              .split("\n")
                              .map((name) => name.trim())
                              .filter(Boolean)
                              .map((name, i) => ({
                                name,
                                email: i === 0 ? selected.email : null,
                                phone: i === 0 ? selected.phone : null,
                              })),
                          });
                      }}
                    >
                      Check in to ledger
                    </button>
                    {needsNightlyRate && <p>No approved nightly rate is recorded for this reservation. Nightly check-in is unavailable.</p>}
                  </>
                )}
              </div>
              <div className="card">
                <h3>Contracts</h3>
                <p>
                  Paste the current approved agreement terms; no legal clauses
                  or bond conditions are invented. Print an approved version to
                  PDF, obtain signatures and retain the signed document
                  privately.
                </p>
                <label>
                  Template reference
                  <input
                    value={draft.template_reference || ""}
                    onChange={(e) =>
                      change("template_reference", e.target.value)
                    }
                  />
                </label>
                <label>
                  Agreement terms
                  <textarea
                    maxLength={30000}
                    value={draft.terms || ""}
                    onChange={(e) => change("terms", e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !draft.template_reference ||
                    draft.terms?.length < 40
                  }
                  onClick={() =>
                    contract("draft", {
                      terms: draft.terms,
                      template_reference: draft.template_reference,
                    })
                  }
                >
                  Create contract version
                </button>
                {detail.contracts.map((c) => (
                  <article key={c.id}>
                    <h4>
                      Version {c.version} · {c.status}
                    </h4>
                    <button onClick={() => printContract(c)}>
                      Print / save PDF
                    </button>
                    {c.status === "draft" && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Approve this complete agreement version for signature?",
                            )
                          )
                            contract("approve", { id: c.id });
                        }}
                      >
                        Approve reviewed agreement
                      </button>
                    )}
                    {c.status === "approved" && (
                      <>
                        <label>
                          Signer names
                          <input
                            value={draft.signed_by || ""}
                            onChange={(e) =>
                              change("signed_by", e.target.value)
                            }
                          />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={!!draft.signatures_verified}
                            onChange={(e) =>
                              change("signatures_verified", e.target.checked)
                            }
                          />{" "}
                          I verified all required resident and proprietor
                          signatures on this agreement version.
                        </label>
                        <label>
                          Signed PDF (stored privately)
                          <input
                            type="file"
                            accept="application/pdf"
                            disabled={busy || !draft.signatures_verified}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              run(async () => {
                                if (file.size > 10 * 1024 * 1024)
                                  throw new Error("PDF must be under 10 MB");
                                const path =
                                  "contracts/" +
                                  selected.id +
                                  "/" +
                                  c.id +
                                  "-" +
                                  crypto.randomUUID() +
                                  ".pdf";
                                const { error } = await supabase.storage
                                  .from("reservation-contracts")
                                  .upload(path, file, {
                                    contentType: "application/pdf",
                                    upsert: false,
                                  });
                                if (error) throw error;
                                await rpc("manage_contract", {
                                  p_res: selected.id,
                                  p_action: "signed",
                                  p_data: {
                                    id: c.id,
                                    signed_by: draft.signed_by,
                                    signed_document_path: path,
                                    signature_verified: true,
                                  },
                                });
                              });
                            }}
                          />
                        </label>
                      </>
                    )}
                    {c.status === "signed" && (
                      <p>
                        Signed by {c.signed_by} · received{" "}
                        {new Date(c.signed_at).toLocaleString("en-AU")}{" "}
                        <button
                          onClick={() =>
                            run(async () => {
                              const { data, error } = await supabase.storage
                                .from("reservation-contracts")
                                .download(c.signed_document_path);
                              if (error) throw error;
                              const url = URL.createObjectURL(data);
                              const link = document.createElement("a");
                              link.href = url;
                              link.download =
                                "signed-agreement-v" + c.version + ".pdf";
                              link.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            })
                          }
                        >
                          Download signed agreement
                        </button>
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <div className="card">
                <h3>Notification drafts</h3>
                <p>
                  No messages are sent automatically. “Uncertain” means review
                  Gmail Sent Mail; automatic retry is blocked.
                </p>
                {detail.messages.map((n) => (
                  <details key={n.id}>
                    <summary>
                      {n.recipient} · {n.kind} · {n.status}
                    </summary>
                    <p>{n.payload.subject}</p>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {n.payload.body}
                    </pre>
                    <button
                      disabled={busy || n.status !== "pending"}
                      onClick={() => send(n)}
                    >
                      Review and send this email
                    </button>
                    {["sending", "uncertain"].includes(n.status) && (
                      <>
                        <p>
                          Reconcile against Gmail Sent Mail before retrying.
                        </p>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const message = prompt(
                              "Enter the Gmail message ID after verifying this exact message was sent:",
                            );
                            if (message)
                              run(() =>
                                rpc("notification_action", {
                                  p_id: n.id,
                                  p_action: "reconcile_sent",
                                  p_message: message,
                                }),
                              );
                          }}
                        >
                          Record verified sent message
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "I checked Gmail Sent Mail and verified this exact message was NOT sent. Return it to the manual draft queue?",
                              )
                            )
                              run(() =>
                                rpc("notification_action", {
                                  p_id: n.id,
                                  p_action: "requeue",
                                  p_message: "CHECKED_SENT_MAIL_NOT_SENT",
                                }),
                              );
                          }}
                        >
                          Verified not sent — requeue
                        </button>
                      </>
                    )}
                    {n.message_id && <p>Gmail ID: {n.message_id}</p>}
                  </details>
                ))}
              </div>
              <div className="card">
                <h3>History</h3>
                <ul>
                  {detail.events.map((e) => (
                    <li key={e.id}>
                      {new Date(e.created_at).toLocaleString("en-AU")} ·{" "}
                      {e.action} · {e.actor} · {JSON.stringify(e.details)}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ) : (
            <>
              <div className="screen-actions">
                {["all", ...STATES].map((s) => (
                  <button
                    key={s}
                    className={filter === s ? "primary" : ""}
                    onClick={() => setFilter(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="muted">
                Latest 200 requests. Refresh before editing; concurrent changes
                are checked by the database.
              </p>
              {rows
                .filter((r) => filter === "all" || r.status === filter)
                .map((r) => (
                  <article key={r.id} className="card">
                    <h2>
                      {r.full_name} · {r.status}
                    </h2>
                    <p>
                      {r.reservation_code} · {format(r.arrival_date)} –{" "}
                      {format(r.departure_date)}
                    </p>
                    <p>
                      {db.properties.find((p) => p.id === r.property_id)?.name}{" "}
                      · {db.rooms.find((x) => x.id === r.room_id)?.label} ·{" "}
                      {r.spaces_requested} space(s)
                    </p>
                    <button onClick={() => open(r)}>Manage request</button>
                  </article>
                ))}
              {!rows.length && <p>No reservation requests yet.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
function Blocks({ db }) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      room_id: db.rooms[0]?.id || "",
      starts_on: "",
      ends_on: "",
      spaces: 1,
      reason: "",
    });
  async function refresh() {
    const { data, error } = await supabase
      .from("room_blocks")
      .select("*")
      .order("starts_on", { ascending: false });
    if (error) throw error;
    setRows(data || []);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <section>
      <h2>Room readiness blocks</h2>
      <p>
        Blocks reduce availability for the entire selected interval. Use full
        capacity to block the whole room.
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const { error } = await supabase
              .from("room_blocks")
              .insert({ ...form, spaces: Number(form.spaces) });
            if (error) throw error;
            await refresh();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Room
          <select value={form.room_id} onChange={set("room_id")}>
            {db.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {db.properties.find((p) => p.id === r.property_id)?.name} ·{" "}
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            required
            value={form.starts_on}
            onChange={set("starts_on")}
          />
        </label>
        <label>
          Until (exclusive)
          <input
            type="date"
            required
            value={form.ends_on}
            onChange={set("ends_on")}
          />
        </label>
        <label>
          Spaces blocked
          <input
            type="number"
            min="1"
            max="20"
            required
            value={form.spaces}
            onChange={set("spaces")}
          />
        </label>
        <label>
          Private reason
          <input
            required
            maxLength={1000}
            value={form.reason}
            onChange={set("reason")}
          />
        </label>
        <button disabled={busy}>Add block</button>
      </form>
      {rows.map((r) => (
        <article className="card" key={r.id}>
          <p>
            {db.rooms.find((x) => x.id === r.room_id)?.label} · {r.starts_on} –{" "}
            {r.ends_on} · {r.spaces} spaces · {r.reason}
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              if (!confirm("Remove this availability block?")) return;
              setBusy(true);
              try {
                const { error } = await supabase
                  .from("room_blocks")
                  .delete()
                  .eq("id", r.id);
                if (error) throw error;
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove block
          </button>
        </article>
      ))}
    </section>
  );
}

function CreateRequest({ db, onCreated }) {
  const [form, setForm] = useState({
    room_id: db.rooms[0]?.id || "",
    full_name: "",
    email: "",
    phone: "",
    arrival_date: "",
    departure_date: "",
    spaces_requested: 1,
    introduction: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    key.current = crypto.randomUUID();
  };
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await rpc("create_staff_reservation", {
            p_data: {
              ...form,
              spaces_requested: Number(form.spaces_requested),
            },
            p_key: key.current,
          });
          await onCreated();
        } catch (e) {
          setError(e.message || "Unable to create request");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>New staff reservation request</h2>
      <p>
        This creates a pending request, without holding inventory or sending
        email. Rates are derived from capacity and dates.
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        Room
        <select value={form.room_id} onChange={set("room_id")}>
          {db.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {db.properties.find((p) => p.id === r.property_id)?.name} ·{" "}
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {[
        ["full_name", "Full name", "text"],
        ["email", "Email", "email"],
        ["phone", "Phone", "tel"],
        ["arrival_date", "Arrival", "date"],
        ["departure_date", "Departure", "date"],
        ["spaces_requested", "People / spaces", "number"],
      ].map(([k, label, type]) => (
        <label key={k}>
          {label}
          <input
            required
            type={type}
            min={type === "number" ? "1" : undefined}
            max={type === "number" ? "20" : undefined}
            maxLength={type === "text" ? 120 : undefined}
            value={form[k]}
            onChange={set(k)}
          />
        </label>
      ))}
      <button disabled={busy}>
        {busy ? "Creating…" : "Create pending request"}
      </button>
    </form>
  );
}
