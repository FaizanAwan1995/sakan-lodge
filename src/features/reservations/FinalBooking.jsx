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
  const [verified, setVerified] = useState(false);
  const current = contracts.find(
    (c) =>
      ["draft", "approved", "signed"].includes(c.status) &&
      c.document_path &&
      c.reservation_revision === reservation.revision,
  );
  if (!["pending", "review", "held"].includes(reservation.status))
    return reservation.status === "assigned" ? (
      <p>
        Booking confirmed. Tenant assigned to the ledger room from{" "}
        {reservation.arrival_date}. Record payments separately in the ledger.
      </p>
    ) : null;
  return (
    <div className="card">
      <h3>Confirm reservation manually</h3>
      <p>
        When you are ready, confirm this reservation and assign the tenant to
        the room. Payment and signed-document checks are handled by you outside
        this process. No payment will be recorded automatically.
      </p>
      <label>
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />{" "}
        I have completed my checks and approve this reservation.
      </label>
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
    </div>
  );
}
