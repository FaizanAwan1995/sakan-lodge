import { useEffect, useState } from "react";
import { supabase } from "../../store.js";
export default function FinalBooking({
  reservation,
  contracts,
  signingRequests = [],
  busy,
  run,
  onReservation,
  reload,
}) {
  const [verified, setVerified] = useState(false);
  const current = contracts.find(
    (c) =>
      ["draft", "approved", "signed"].includes(c.status) &&
      c.document_path &&
      c.reservation_revision === reservation.revision,
  );
  useEffect(() => {
    setVerified(false);
  }, [reservation.id, reservation.revision, current?.id]);
  if (!["pending", "review", "held"].includes(reservation.status))
    return reservation.status === "assigned" ? (
      <p>
        Booking confirmed. Tenant assigned to the ledger room from{" "}
        {reservation.arrival_date}. Record payments separately in the ledger.
      </p>
    ) : null;
  if(signingRequests.some(s=>s.contract_id===current?.id&&['awaiting_signature','processing','signed'].includes(s.status)))return <p>Online agreement signing is in progress. Use the signing panel above to review and approve the signed agreement before allocating the room.</p>;
  return (
    <details className="card"><summary>Manual / offline signing fallback</summary>
      <h3>Confirm an offline-signed reservation</h3>
      <p>
        When you are ready, confirm this reservation and assign the tenant to
        the room. Use this manual option only for an agreement completed outside online signing. Verify the signed document and any payment separately. No payment will be recorded automatically.
      </p>
      <label>
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />{" "}
        I have completed my checks and approve this reservation.
      </label>
      {!current && (
        <p role="status">
          Generate or open the current contract PDF before confirming.
        </p>
      )}
      <button
        disabled={busy || !verified || !current}
        onClick={() =>
          run(async () => {
            if (
              !confirm(
                "Confirm this reservation and assign the tenant to the ledger room? No bond or rent payment will be recorded.",
              )
            )
              return;
            const { data, error } = await supabase.rpc(
              "confirm_manual_booking",
              {
                p_id: reservation.id,
                p_revision: reservation.revision,
                p_contract: current.id,
              },
            );
            if (error) throw error;
            onReservation(data);
            reload?.();
          })
        }
      >
        Confirm reservation and assign tenant
      </button>
    </details>
  );
}
