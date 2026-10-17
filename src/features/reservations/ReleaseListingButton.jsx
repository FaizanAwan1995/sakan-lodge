import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase, isLocalMode } from "../../store.js";
import { errorMessage } from "../../error-handling.js";

export default function ReleaseListingButton({ person }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (isLocalMode || !supabase || !person.room_id || !person.end_date) return null;
  async function release() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: problem } = await supabase.rpc("release_room_listing", {
        p_person: person.id,
      });
      if (problem) throw problem;
      setMessage("Space released for review. Verify readiness and approve the public profile in Listings.");
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="small" disabled={busy || !!message} onClick={release}>
        {busy ? "Releasing…" : "Release checked-out space for listing"}
      </button>
      {message && <p role="status">{message} <Link to="/reservations">Open listings management</Link></p>}
      {error && <p role="alert" className="err">{error}</p>}
    </div>
  );
}
