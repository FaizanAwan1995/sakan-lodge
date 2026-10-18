import { useState } from "react";
import { supabase } from "../../store.js";
export default function FinalBooking({
  reservation,
  contracts,
  busy,
  run,
  onReservation,
  reload,
}) {
  const c = contracts.find((c) => c.status === "signed");
  const [form, setForm] = useState({
    amount: "",
    received_date: new Date().toLocaleDateString("en-CA", {
      timeZone: "Australia/Adelaide",
    }),
    reference: "",
    receipt_path: "",
    payment_verified: false,
  });
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  if (!["pending", "review", "held"].includes(reservation.status))
    return reservation.status === "assigned" ? (
      <p>
        Booking confirmed. Tenant assigned to the ledger room from{" "}
        {reservation.arrival_date}. Bond recorded separately from rent.
      </p>
    ) : null;
  return (
    <div className="card">
      <h3>3. Verify bond and confirm booking</h3>
      <p>
        Required bond: AUD $
        {c
          ? Number(c.fields.bond * reservation.spaces_requested).toFixed(2)
          : "—"}
        . First verify and upload the signed contract in the contract version
        below.
      </p>
      <label>
        Bond amount actually received
        <input
          type="number"
          min="0"
          step=".01"
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
        />
      </label>
      <label>
        Date received
        <input
          type="date"
          value={form.received_date}
          onChange={(e) => set("received_date", e.target.value)}
        />
      </label>
      <label>
        Bank / payment reference
        <input
          value={form.reference}
          onChange={(e) => set("reference", e.target.value)}
        />
      </label>
      <label>
        Payment receipt (private PDF, PNG or JPEG)
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            run(async () => {
              if (file.size > 10485760)
                throw Error("Receipt must be under 10 MB");
              const ext = {
                "application/pdf": "pdf",
                "image/png": "png",
                "image/jpeg": "jpg",
              }[file.type];
              if (!ext) throw Error("Choose PDF, PNG or JPEG");
              const path = `receipts/${reservation.id}/${crypto.randomUUID()}.${ext}`;
              const { error } = await supabase.storage
                .from("reservation-receipts")
                .upload(path, file, { upsert: false, contentType: file.type });
              if (error) throw error;
              set("receipt_path", path);
            });
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.payment_verified}
          onChange={(e) => set("payment_verified", e.target.checked)}
        />{" "}
        I checked the bank transaction and verified the bond was received. A
        receipt image alone is not proof of cleared payment.
      </label>
      <button
        disabled={
          busy ||
          !c ||
          !form.payment_verified ||
          !form.receipt_path ||
          form.amount === ""
        }
        onClick={() =>
          run(async () => {
            if (
              !confirm(
                "Confirm booking, record this actual bond payment and assign the tenant(s) to the ledger room?",
              )
            )
              return;
            const { data, error } = await supabase.rpc("confirm_paid_booking", {
              p_id: reservation.id,
              p_revision: reservation.revision,
              p_data: form,
            });
            if (error) throw error;
            onReservation(data);
            reload?.();
          })
        }
      >
        Confirm paid booking and assign tenant
      </button>
    </div>
  );
}
