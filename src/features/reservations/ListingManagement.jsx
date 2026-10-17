import { useEffect, useState } from "react";
import { supabase } from "../../store.js";
import { publicPath } from "../../public-routes.js";
const parseLines = (value) =>
  value
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
export default function ListingManagement({ db }) {
  const [properties, setProperties] = useState([]),
    [rooms, setRooms] = useState([]),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setError("");
    try {
      const [p, r] = await Promise.all([
        supabase.from("property_profiles").select("*"),
        supabase.from("room_profiles").select("*"),
      ]);
      if (p.error || r.error) throw p.error || r.error;
      setProperties(p.data || []);
      setRooms(r.data || []);
    } catch (e) {
      setError(e.message || "Unable to load listings");
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  const set = (key, value) =>
    setEditing((x) => ({
      ...x,
      [key]: value,
      ...(key === "reviewed" ? {} : { reviewed: false }),
    }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = {
        ...editing,
        photos: parseLines(editing.photoText),
        amenities: parseLines(editing.amenityText),
      };
      if (data.published && !editing.reviewed)
        throw new Error(
          "Review the public details and explicitly approve before publishing.",
        );
      const { error: e } = await supabase.rpc("save_listing", {
        p_kind: editing.kind,
        p_id: editing.id,
        p_data: data,
      });
      if (e) throw e;
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e.message || "Unable to save listing");
    } finally {
      setBusy(false);
    }
  }
  function open(kind, id, profile = {}) {
    setEditing({
      kind,
      id,
      slug: "",
      public_name: "",
      suburb: "Fulham",
      title: "",
      description: "",
      published: false,
      ready: false,
      ...profile,
      photoText: (profile.photos || []).join("\n"),
      amenityText: (profile.amenities || []).join("\n"),
      reviewed: false,
    });
  }
  return (
    <section aria-label="Public listing management">
      <h2>Public listings</h2>
      <p>
        Only approved profiles appear publicly. Public descriptions and photos
        must not reveal private street addresses or resident details. Existing
        ledger labels and rates are unchanged.
      </p>
      <button onClick={refresh}>Refresh listings</button>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {editing ? (
        <form className="card" onSubmit={save}>
          <h3>
            {editing.kind === "room" ? "Room" : "Property"} public profile
          </h3>
          <label>
            URL slug
            <input
              value={editing.slug || ""}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={90}
              required
              onChange={(e) => set("slug", e.target.value)}
            />
          </label>
          {editing.kind === "property" ? (
            <>
              <label>
                Public property name
                <input
                  value={editing.public_name || ""}
                  maxLength={120}
                  required
                  onChange={(e) => set("public_name", e.target.value)}
                />
              </label>
              <label>
                Suburb
                <select
                  value={editing.suburb || "Fulham"}
                  onChange={(e) => set("suburb", e.target.value)}
                >
                  {["Fulham", "Clapham", "Oaklands Park"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Public room title
                <input
                  value={editing.title || ""}
                  maxLength={120}
                  required
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <p>
                Offer type comes from ledger capacity:{" "}
                {(db.rooms.find((r) => r.id === editing.id)?.capacity || 1) > 1
                  ? "shared, long-term only"
                  : "private"}
                .
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={editing.ready}
                  onChange={(e) => set("ready", e.target.checked)}
                />{" "}
                Room is ready for occupancy
              </label>
            </>
          )}
          <label>
            Description
            <textarea
              value={editing.description || ""}
              maxLength={6000}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label>
            Verified photo HTTPS URLs (one per line)
            <textarea
              value={editing.photoText}
              onChange={(e) => set("photoText", e.target.value)}
            />
          </label>
          <label>
            Verified amenities (one per line)
            <textarea
              value={editing.amenityText}
              onChange={(e) => set("amenityText", e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={editing.published}
              onChange={(e) => set("published", e.target.checked)}
            />{" "}
            Publish profile
          </label>
          {editing.published && (
            <label>
              <input
                type="checkbox"
                checked={editing.reviewed}
                onChange={(e) => set("reviewed", e.target.checked)}
              />{" "}
              I verified the room/property information, photos and amenities and
              approve this public listing.
            </label>
          )}
          <button disabled={busy} className="primary">
            {busy ? "Saving…" : "Save profile"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            Cancel
          </button>
        </form>
      ) : (
        db.properties.map((p) => {
          const profile = properties.find((x) => x.property_id === p.id);
          return (
            <article key={p.id} className="card">
              <h3>
                {p.name} —{" "}
                {profile?.published ? "Published" : "Draft / not public"}
              </h3>
              <button onClick={() => open("property", p.id, profile)}>
                Edit public property
              </button>
              {profile?.published && (
                <a
                  href={publicPath({
                    suburb: profile.suburb.toLowerCase().replaceAll(" ", "-"),
                    property: profile.slug,
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  View public property
                </a>
              )}
              <ul>
                {db.rooms
                  .filter((r) => r.property_id === p.id)
                  .map((r) => {
                    const rp = rooms.find((x) => x.room_id === r.id);
                    return (
                      <li key={r.id} style={{ margin: "12px 0" }}>
                        {r.label} · capacity {r.capacity} ·{" "}
                        {rp?.published ? "Published" : "Draft"} ·{" "}
                        {rp?.ready ? "Ready" : "Not ready"}{" "}
                        <button
                          className="small"
                          onClick={() => open("room", r.id, rp)}
                        >
                          Edit public room
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </article>
          );
        })
      )}
    </section>
  );
}
