import { Link } from "react-router-dom";
import { supabase, isLocalMode } from "../../store.js";

export default function ReleaseListingButton({ person }) {
  if (isLocalMode || !supabase || !person.room_id || !person.end_date) return null;
  return <p>Website availability follows the ledger checkout date automatically
    for approved, ready listings. <Link to="/reservations">Manage listing readiness</Link></p>;
}
