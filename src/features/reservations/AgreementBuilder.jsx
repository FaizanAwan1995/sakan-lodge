import { useEffect, useState } from "react";
import { supabase } from "../../store.js";
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export default function AgreementBuilder({
  reservation,
  busy,
  run,
  onReservation,
  contracts = [],
  roomLabel,
}) {
  const [templates, setTemplates] = useState([]),
    [error, setError] = useState(""),
    [pdf, setPdf] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [template, setTemplate] = useState({
    title: "SAKAN Lodge standard agreement",
    terms: "",
    proprietor: { name: "", address: "", phone: "" },
  });
  const [form, setForm] = useState({
    full_name: reservation.full_name,
    email: reservation.email,
    phone: reservation.phone,
    arrival_date: reservation.arrival_date,
    departure_date: reservation.departure_date,
    room_id: reservation.room_id,
    template_id: "",
    premises_address: "",
    term_description: `${reservation.arrival_date} to ${reservation.departure_date}`,
    resident_names: reservation.full_name,
    first_rent_due: reservation.arrival_date,
    bond: reservation.weekly_rate * 2,
    nightly_rate: "",
  });
  const update = (key, value) => {
    setForm((old) => ({ ...old, [key]: value }));
    setReviewed(false);
  };
  const current = contracts.find((c) =>
    ["draft", "approved", "signed"].includes(c.status),
  );
  useEffect(() => {
    let active = true;
    Promise.all([
      supabase
        .from("agreement_templates")
        .select("*")
        .order("approved_at", { ascending: false }),
      supabase
        .from("contract_defaults")
        .select("*")
        .eq("property_id", reservation.property_id)
        .maybeSingle(),
    ]).then(([t, d]) => {
      if (!active) return;
      if (t.error || d.error) {
        setError((t.error || d.error).message);
        return;
      }
      setTemplates(t.data || []);
      setForm((old) => ({
        ...old,
        template_id: t.data?.[0]?.id || "",
        premises_address: d.data?.premises_address || "",
      }));
      if (d.data)
        setTemplate((old) => ({
          ...old,
          terms: d.data.draft_terms,
          proprietor: d.data.proprietor,
        }));
    });
    return () => {
      active = false;
    };
  }, [reservation.id]);
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf);
    },
    [pdf],
  );
  async function call(path, data) {
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + s.session.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const out = await r.json();
    if (!r.ok) throw Error(out.error || "Unable to complete action");
    return out;
  }
  async function preview(c) {
    const { data, error } = await supabase.storage
      .from("reservation-contracts")
      .download(c.document_path);
    if (error) throw error;
    setPdf(URL.createObjectURL(data));
  }
  return (
    <div className="card">
      <h4>1. Verify details and generate contract</h4>
      <p>
        Review the applicant details below. Generate a private PDF, review it
        here, then send a provisional booking notice. The booking is confirmed
        only after bond and signatures are verified.
      </p>
      {error && <p role="alert">{error}</p>}
      {!templates.length && (
        <p role="alert">
          The supplied agreement is prefilled below. Review its terms, verify
          the details and generate. No JSON upload is needed.
        </p>
      )}
      <details>
        <summary>Agreement setup (once, or when terms change)</summary>
        <p>
          Review the supplied sample’s reusable terms and proprietor details.
          Old resident details and signatures are excluded. The sample’s
          obsolete electricity threshold and immediate-eviction penalty are
          excluded from this draft; review the complete wording before
          approving.
        </p>
        <label>
          Template name
          <input
            value={template.title}
            onChange={(e) =>
              setTemplate({ ...template, title: e.target.value })
            }
          />
        </label>
        {["name", "address", "phone"].map((k) => (
          <label key={k}>
            Proprietor {k}
            <input
              value={template.proprietor[k] || ""}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  proprietor: { ...template.proprietor, [k]: e.target.value },
                })
              }
            />
          </label>
        ))}
        <label>
          Reusable terms
          <textarea
            rows={14}
            value={template.terms}
            onChange={(e) =>
              setTemplate({ ...template, terms: e.target.value })
            }
          />
        </label>
        <button
          disabled={busy || template.terms.length < 40}
          onClick={() =>
            run(async () => {
              if (
                !confirm(
                  "Approve these reviewed reusable terms and proprietor details?",
                )
              )
                return;
              const t = await rpc("approve_agreement_template", {
                p_data: {
                  ...template,
                  confirmation: "APPROVE_REUSABLE_TEMPLATE",
                },
              });
              setTemplates([t, ...templates]);
              update("template_id", t.id);
            })
          }
        >
          Approve reusable agreement
        </button>
      </details>
      <label>
        Approved agreement
        <select
          value={form.template_id}
          onChange={(e) => update("template_id", e.target.value)}
        >
          <option value="">
            Supplied SAKAN agreement (review terms below)
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      {[
        ["full_name", "Applicant name", "text"],
        ["email", "Email", "email"],
        ["phone", "Contact phone", "tel"],
        ["arrival_date", "Arrival", "date"],
        ["departure_date", "Departure", "date"],
        ["premises_address", "Verified property address", "text"],
        ["first_rent_due", "First rent due", "date"],
        ["bond", "Bond per resident (AUD)", "number"],
      ].map(([k, label, type]) => (
        <label key={k}>
          {label}
          <input
            type={type}
            min={type === "number" ? 0 : undefined}
            step={type === "number" ? ".01" : undefined}
            value={form[k]}
            onChange={(e) => update(k, e.target.value)}
          />
        </label>
      ))}
      <p>
        Ledger room:{" "}
        {roomLabel ||
          contracts[0]?.fields?.room_label ||
          "Selected reservation room"}{" "}
        · Rent: AUD ${(reservation.weekly_rate * 2).toFixed(2)} per fortnight{" "}
        {reservation.offer_type === "shared" ? "per resident" : ""}. Changes to
        dates or room recalculate the quote before PDF generation.
      </p>
      <label>
        Agreement term
        <input
          value={form.term_description}
          onChange={(e) => update("term_description", e.target.value)}
        />
      </label>
      <label>
        All resident names (one per line)
        <textarea
          value={form.resident_names}
          onChange={(e) => update("resident_names", e.target.value)}
        />
      </label>
      {(Date.parse(form.departure_date) - Date.parse(form.arrival_date)) /
        86400000 <
        7 && (
        <label>
          Explicit agreed nightly rate
          <input
            type="number"
            min=".01"
            step=".01"
            value={form.nightly_rate}
            onChange={(e) => update("nightly_rate", e.target.value)}
          />
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I verified the applicant, dates, room, rent, bond and agreement terms.
      </label>
      <button
        disabled={
          busy ||
          !reviewed ||
          !form.premises_address ||
          (!form.template_id && template.terms.length < 40)
        }
        onClick={() =>
          run(async () => {
            const out = await rpc("generate_booking_contract", {
              p_id: reservation.id,
              p_revision: reservation.revision,
              p_data: {
                ...form,
                terms_confirmed: reviewed,
                template,
                resident_names: form.resident_names
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            });
            onReservation(out.reservation);
            const saved = await call("/api/reservations/contract-pdf", {
              id: out.contract.id,
            });
            await preview(saved.contract);
          })
        }
      >
        Generate contract PDF
      </button>
      {current && (
        <div>
          <h4>2. Review PDF and send provisional notice</h4>
          {current.document_path ? (
            <button disabled={busy} onClick={() => run(() => preview(current))}>
              Review generated PDF v{current.version}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const out = await call("/api/reservations/contract-pdf", {
                    id: current.id,
                  });
                  await preview(out.contract);
                })
              }
            >
              Generate stored PDF for this version
            </button>
          )}
          {pdf && (
            <>
              <p>
                <a href={pdf} target="_blank" rel="noopener noreferrer">
                  Open / download contract PDF
                </a>
              </p>
              <iframe
                title="Contract PDF review"
                src={pdf}
                style={{ width: "100%", height: 560, border: "1px solid #ccc" }}
              />
            </>
          )}
          <button
            disabled={
              busy ||
              !current.document_path ||
              !pdf ||
              !["draft", "approved"].includes(current.status)
            }
            onClick={() =>
              run(async () => {
                const n = await rpc("prepare_booking_offer", {
                  p_id: reservation.id,
                  p_revision: reservation.revision,
                  p_contract: current.id,
                });
                if (
                  !confirm(
                    "Send from sakanlodges@gmail.com to " +
                      n.recipient +
                      " with the reviewed PDF attached?\n\n" +
                      n.payload.subject +
                      "\n\n" +
                      n.payload.body,
                  )
                )
                  return;
                await call("/api/reservations/email", {
                  id: n.id,
                  confirmation: "SEND_REVIEWED_EMAIL",
                });
              })
            }
          >
            Approve PDF and send provisional booking email
          </button>
        </div>
      )}
    </div>
  );
}
