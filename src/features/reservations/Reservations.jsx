import {parseBedNumbers,bedReference} from '../../bed-assignments.js';
import RemoveRequest from './RemoveRequest.jsx';
import { Link, useLocation } from 'react-router-dom';
import { reservationTenants, tenantReference, tenantStatus } from '../../tenant-model.js';
import { todayStr } from '../../ledger.js';
import FinalBooking from "./FinalBooking.jsx";
import AgreementBuilder from "./AgreementBuilder.jsx";
import { useEffect, useRef, useState } from "react";
import { supabase, isLocalMode } from "../../store.js";
import ListingManagement from "./ListingManagement.jsx";
import { escapeHtml } from "../../public-routes.js";
const STATES = [
  "pending",
  "review",
  "held",
  "confirmed",
  "assigned",
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
  const location = useLocation();
  const deepLink = useRef(null);
  const detailVersion = useRef(0);
  const refreshVersion = useRef(0);
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
    const version=++refreshVersion.current;
    try {
      let query=supabase.from("reservations").select("*,contract_signing_requests(id,status,expires_at)");
      query=filter==="archived"?query.eq("status","archived"):query.neq("status","archived");
      const { data, error: e } = await query
        .order("created_at", { ascending: false })
        .limit(200);
      if (e) throw e;
      if(version!==refreshVersion.current)return data||[];
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
    const [contracts,signing] = await Promise.all([
      supabase.from('contracts').select('*').eq('reservation_id',id).order('version',{ascending:false}),
      supabase.from('contract_signing_requests').select('*').eq('reservation_id',id).order('created_at',{ascending:false}),
    ]);
    if(contracts.error||signing.error)throw contracts.error||signing.error;
    if (requestVersion !== detailVersion.current) return;
    setDetail({reservationId:id,contracts:contracts.data||[],signingRequests:signing.data||[]});
  }
  useEffect(() => {
    refresh();
    if (!supabase) return;
    const workflowTables = new Set([
      "reservations",
      "reservation_events",
      "contracts",
      "notification_outbox",
      "contract_signing_requests",
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
  }, [filter]);
  useEffect(() => {
    const id=new URLSearchParams(location.search).get('reservation');
    if(!id||!supabase||deepLink.current===id)return;
    let active=true;
    supabase.from('reservations').select('*,contract_signing_requests(id,status,expires_at)').eq('id',id).maybeSingle().then(async({data,error})=>{if(!active)return;if(error||!data){setError('This request could not be opened. Refresh the inbox.');return;}deepLink.current=id;if(data.status==='archived')setFilter('archived');await open(data);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[location.search]);
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
      bed_numbers: (r.bed_numbers||[]).join(","),
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
  const acceptReservation = (r) => {
    selectedRef.current = r;
    setSelected(r);
    setStale(false);
  };
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
  const approvedNightly = detail.contracts.some(
    (c) =>
      c.status === "signed" &&
      c.fields.billing_type === "nightly" &&
      Number(c.fields.nightly_rate) > 0,
  );
  const needsNightlyRate =
    !approvedNightly &&
    selected &&
    (Date.parse(selected.departure_date + "T00:00:00Z") -
      Date.parse(selected.arrival_date + "T00:00:00Z")) /
      86400000 <
      7;
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
    <section
      className="reservation-workspace"
      aria-label="Reservation management"
    >
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
        Prepare an agreement, send its signing link, then review the returned signatures here. Only administrator approval allocates tenants to a room. Signing invitations require review before sending.
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
              <h2>{selected.full_name}</h2>
              {reservationTenants(selected, db.people).length > 0 && <section className="card"><h3>Linked tenant accounts</h3><p>Current tenant details and balances are managed in these accounts. This booking and its contracts retain the original application details.</p>{reservationTenants(selected, db.people).map(person => <p key={person.id}><Link to={`/rooms/${person.id}`}>{person.name} · {tenantStatus(person, todayStr())}</Link><small className="tenant-reference">Tenant ID {tenantReference(person)}</small></p>)}</section>}
              <p>
                Status: <strong>{selected.status}</strong>
              </p>
              {selected.status==="archived"&&<p role="status">Archived. This request has been removed from the active inbox; its documents and history are preserved.</p>}
              <p>
                {selected.email} · {selected.phone}
              </p>
              {selected.introduction && (
                <details>
                  <summary>Applicant message</summary>
                  <p>{selected.introduction}</p>
                </details>
              )}
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
              <details className="reservation-secondary">
                <summary>Edit dates, room or notes</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action("edit", {...draft,bed_numbers:parseBedNumbers(draft.bed_numbers)});
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
                  <label>Bed numbers (one per resident, e.g. 1 or 1,2)<input value={draft.bed_numbers || ''} onChange={e=>change('bed_numbers',e.target.value)} placeholder="Automatic assignment" pattern="[0-9, ]*" /></label>
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
                      [
                        "cancelled",
                        "archived",
                        "checked_in",
                        "assigned",
                      ].includes(selected.status)
                    }
                  >
                    Save changes for review
                  </button>
                </form>
              </details>
              {detail.reservationId===selected.id&&<RemoveRequest key={selected.id} reservation={selected} signingRequests={detail.signingRequests} busy={busy||stale} run={run} onReservation={acceptReservation}/>}
              {!["cancelled","archived"].includes(selected.status)&&<details className="reservation-secondary">
                <summary>Other reservation actions</summary>
                {detail.signingRequests?.some(s=>["awaiting_signature","processing","signed"].includes(s.status))&&<p>Online signing is in progress. Use the signing panel to review or reject a signed request. Place holds before sending a signing link; changing agreement details requires fresh signatures.</p>}
                {!detail.signingRequests?.some(s=>["awaiting_signature","processing","signed"].includes(s.status))&&["pending","review","held","confirmed"].includes(selected.status)&&<>
                {selected.status==="pending"&&<button
                  disabled={busy || selected.status !== "pending" || detail.signingRequests?.some(s=>["awaiting_signature","processing","signed"].includes(s.status))}
                  onClick={() => action("review")}
                >
                  Review request
                </button>}
                {["pending","review","held"].includes(selected.status)&&<>
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
                    detail.signingRequests?.some(s=>["awaiting_signature","processing","signed"].includes(s.status)) ||
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
                {!draft.expires_at&&<p>Choose a future expiry above to enable the hold action.</p>}
                </>}
                <button
                  disabled={
                    busy ||
                    detail.signingRequests?.some(s=>s.status==="signed") ||
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
                </>}
                {selected.status === "assigned" && (
                  <button disabled={busy} onClick={() => action("check_in")}>
                    Record actual arrival (tenant already assigned)
                  </button>
                )}
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
                      disabled={
                        busy ||
                        needsNightlyRate ||
                        draft.bond == null ||
                        draft.bond === ""
                      }
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
                    {needsNightlyRate && (
                      <p>
                        No approved nightly rate is recorded for this
                        reservation. Nightly check-in is unavailable.
                      </p>
                    )}
                  </>
                )}
              </details>}
              <div className="reservation-contract">
                <AgreementBuilder
                  key={selected.id}
                  reservation={selected}
                  busy={busy}
                  run={run}
                  contracts={detail.contracts}
                  roomLabel={
                    db.rooms.find((r) => r.id === selected.room_id)?.label
                  }
                  onReservation={acceptReservation}
                  signingRequests={detail.signingRequests}
                  reload={reload}
                />
              </div>
              <FinalBooking
                reservation={selected}
                contracts={detail.contracts}
                signingRequests={detail.signingRequests}
                busy={busy}
                run={run}
                onReservation={acceptReservation}
                reload={reload}
              />
              <p className="muted">
                Contract versions, email records and reservation history are in{" "}
                <a href="/ledger/activity">Activity</a>.
              </p>
            </article>
          ) : (
            <>
              <div className="screen-actions">
                {["all", "awaiting_signature", "signature_review", ...STATES].map((s) => (
                  <button
                    key={s}
                    className={filter === s ? "primary" : ""}
                    onClick={() => setFilter(s)}
                  >
                    {s==="all"?"Active requests":s==="archived"?"Archived":s.replaceAll("_"," ")}
                  </button>
                ))}
              </div>
              <p className="muted">
                Latest 200 requests. Refresh before editing; concurrent changes
                are checked by the database.
              </p>
              {rows
                .filter((r) => (filter === "all" ? r.status!=="archived" : r.status === filter || r.contract_signing_requests?.some(s => filter === "signature_review" ? s.status === "signed" : filter === "awaiting_signature" && ["awaiting_signature","processing"].includes(s.status))))
                .map((r) => (
                  <article key={r.id} className="card">
                    <h2>
                      {reservationTenants(r, db.people).map(person => person.name).join(', ') || r.full_name} · {r.status}
                    </h2>
                    <p>
                      {r.reservation_code} · {format(r.arrival_date)} –{" "}
                      {format(r.departure_date)}
                    </p>
                    <p>
                      {db.properties.find((p) => p.id === r.property_id)?.name}{" "}
                      · {db.rooms.find((x) => x.id === r.room_id)?.label} ·{" "}
                      {r.spaces_requested} space(s) · {(r.bed_numbers||[]).map(b=>bedReference(db.rooms.find(x=>x.id===r.room_id),b)).join(", ") || "Bed not assigned"}
                    </p>
                    {reservationTenants(r, db.people).map(person => <p key={person.id} className="tenant-reference"><Link to={`/rooms/${person.id}`}>Tenant ID {tenantReference(person)} · {tenantStatus(person, todayStr())}</Link></p>)}
                    {r.contract_signing_requests?.some(s=>s.status==='signed')&&<p><strong>Signed agreement awaiting administrator review</strong></p>}
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
    bed_numbers: "",
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
              bed_numbers: parseBedNumbers(form.bed_numbers),
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
      <label>Bed numbers (e.g. 1 or 1,2)<input value={form.bed_numbers||''} onChange={set('bed_numbers')} placeholder="Assign automatically" /></label>
      <button disabled={busy}>
        {busy ? "Creating…" : "Create pending request"}
      </button>
    </form>
  );
}
