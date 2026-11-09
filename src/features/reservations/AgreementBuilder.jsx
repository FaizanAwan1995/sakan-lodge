import {onlineSigningTerms} from '../../agreement-signing-terms.js';
import ContractSigning from './ContractSigning.jsx';
import { changeAgreementDetail, agreementDetailsError } from '../../agreement-details.js';
import { DEFAULT_AGREEMENT_DESIGN } from '../../agreement-design.js';
import { validWeeklyRent } from '../../rent-input.js';
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
  signingRequests = [],
  reload,
}) {
  const [templates, setTemplates] = useState([]),
    [error, setError] = useState(""),
    [pdf, setPdf] = useState(""),
    [pdfContractId, setPdfContractId] = useState(null),
    [generated, setGenerated] = useState(null),
    [reviewed, setReviewed] = useState(false);
  const [template, setTemplate] = useState({
    title: "SAKAN Lodge standard agreement",
    terms: "",
    design: {...DEFAULT_AGREEMENT_DESIGN},
    proprietor: { name: "", address: "", phone: "" },
  });
  const savedFields=contracts.find(c=>["draft","approved","signed"].includes(c.status))?.fields || {};
  const [form, setForm] = useState({
    full_name: reservation.full_name,
    email: reservation.email,
    phone: reservation.phone,
    arrival_date: reservation.arrival_date,
    departure_date: reservation.departure_date,
    room_id: reservation.room_id,
    template_id: "",
    premises_address: savedFields.premises_address || "",
    term_description: savedFields.term_description || `${reservation.arrival_date} to ${reservation.departure_date}`,
    resident_names: savedFields.resident_names?.join("\n") || reservation.full_name,
    first_rent_due: savedFields.first_rent_due || reservation.arrival_date,
    bond: savedFields.bond ?? reservation.weekly_rate * 2,
    weekly_rate: String(reservation.weekly_rate),
    nightly_rate: "",
  });
  const update = (key, value) => {
    setForm((old) => changeAgreementDetail(old,key,value));
    setReviewed(false);
  };
  function editTemplate(patch) {
    setTemplate(old=>({...old,...patch}));
    update("template_id", "");
  }
  const detailsError=agreementDetailsError(form);
  const current =
    (generated?.reservation_revision === reservation.revision
      ? generated
      : null) ||
    contracts.find((c) => ["draft", "approved", "signed"].includes(c.status));
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
        template_id: "",
        premises_address: old.premises_address || d.data?.premises_address || "",
      }));
      if (d.data)
        setTemplate((old) => ({
          ...old,
          terms: onlineSigningTerms(d.data.draft_terms),
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
    setGenerated(c);
    setPdfContractId(c.id);
  }
  return (
    <div className="contract-panel">
      <details className="contract-editor" open={!current}>
        <summary>
          {current
            ? "Edit details / generate a replacement contract"
            : "1. Verify details and generate contract"}
        </summary>
        <p>
          Review the applicant details below. Generate a private PDF, review it
          here, then send a signing link. Review the returned signatures before approving room allocation.
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
            Old resident details and resident signatures are excluded. The
            authorised proprietor signature is included in newly generated
            contracts. Review the complete wording and property utility allowance before approving.
          </p>
          <label>
            Template name
            <input
              value={template.title}
              onChange={(e) => editTemplate({title:e.target.value})}
            />
          </label>
          {["name", "address", "phone"].map((k) => (
            <label key={k}>
              Proprietor {k}
              <input
                value={template.proprietor[k] || ""}
                onChange={(e) =>
                  editTemplate({
                    proprietor: { ...template.proprietor, [k]: e.target.value },
                  })
                }
              />
            </label>
          ))}
          <fieldset><legend>Agreement design</legend>
            <label>Document title<input maxLength={32} value={template.design.title} onChange={e=>editTemplate({design:{...template.design,title:e.target.value}})}/></label>
            <label>Colour theme<select value={template.design.theme} onChange={e=>editTemplate({design:{...template.design,theme:e.target.value}})}><option value="navy">Navy & gold</option><option value="forest">Forest & gold</option><option value="plum">Plum & gold</option></select></label>
            <label>Body text size<select value={template.design.fontSize} onChange={e=>editTemplate({design:{...template.design,fontSize:Number(e.target.value)}})}>{[10,11,12].map(size=><option key={size} value={size}>{size} pt</option>)}</select></label>
            <label><input type="checkbox" checked={template.design.showLogo} onChange={e=>editTemplate({design:{...template.design,showLogo:e.target.checked}})}/> Show SAKAN logo</label>
            <p>Save a reusable version, then generate and open its PDF to preview the design.</p>
          </fieldset>
          <label>
            Reusable terms
            <textarea
              rows={14}
              value={template.terms}
              onChange={(e) =>
                editTemplate({terms:e.target.value})
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
            onChange={(e) => {
              const selected=templates.find(t=>t.id===e.target.value);
              if(selected)setTemplate({title:selected.title,terms:onlineSigningTerms(selected.terms),proprietor:selected.proprietor,design:{...DEFAULT_AGREEMENT_DESIGN,...selected.design}});
              update("template_id",e.target.value);
            }}
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
          ["arrival_date", "Check-in date", "date"],
          ["departure_date", "Departure / checkout date", "date"],
          ["premises_address", "Verified property address", "text"],
          ["first_rent_due", "First rent due", "date"],
          ["bond", "Bond per resident (AUD)", "number"],
          ["weekly_rate", "Agreed weekly rent per resident (AUD)", "number"],
        ].map(([k, label, type]) => (
          <label key={k}>
            {label}
            <input
              type={type}
              required
              min={type === "number" ? 0 : type === "date" ? "2000-01-01" : undefined}
              max={type === "date" ? "2100-12-31" : undefined}
              step={type === "number" ? ".01" : undefined}
              value={form[k]}
              onChange={(e) => update(k, e.target.value)}
            />
          </label>
        ))}
        <p role="status">Check-in: {form.arrival_date || 'Choose a date'} · Checkout: {form.departure_date || 'Choose a date'} · First rent due: {form.first_rent_due || 'Choose a date'}</p>
        <p>The checkout day is excluded from the stay. Date changes are checked against room availability when you generate the replacement agreement. Review its new PDF before sending.</p>
        {detailsError&&<p role="alert">{detailsError}</p>}
        <p>
          Ledger room:{" "}
          {roomLabel ||
            contracts[0]?.fields?.room_label ||
            "Selected reservation room"}{" "}
          · Rent: AUD ${(Number(form.weekly_rate) * 2).toFixed(2)} per fortnight{" "}
          {reservation.offer_type === "shared" ? "per resident" : ""}. Changes
          to dates or room recalculate the quote before PDF generation.
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
            !["pending", "review", "held"].includes(reservation.status) ||
            !reviewed ||
            Boolean(detailsError) ||
            !validWeeklyRent(form.weekly_rate) ||
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
                  weekly_rate: Number(form.weekly_rate),
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
      </details>
      {current && (
        <div>
          <h4>Review the original agreement PDF</h4>
          <p>
            Contract v{current.version}. Open the PDF to review it before
            sending.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const out = current.document_path
                  ? { contract: current }
                  : await call("/api/reservations/contract-pdf", {
                      id: current.id,
                    });
                await preview(out.contract);
              })
            }
          >
            Open contract PDF
          </button>
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
          {(!current.document_path || pdfContractId !== current.id) && (
            <p className="muted" role="status">
              Open the contract PDF above to enable sending.
            </p>
          )}
          <ContractSigning reservation={reservation} contract={current} requests={signingRequests}
            ready={Boolean(current.document_path && pdf && pdfContractId === current.id)}
            busy={busy} run={run} onReservation={onReservation} reload={reload}/>

        </div>
      )}
    </div>
  );
}
