# Suburb guides and direct room browsing

Owner instruction, 18 October 2026: each suburb page includes its supplied map, verified area highlights and facility icons. Show room cards directly when one public property is visible; show property selection when several are visible. Preserve nested room and property URLs.

Public house names: Noor House (Fulham), Sukoon House (Clapham), Aman House (Oaklands Park). Room display names use the matching house theme and existing room number. Ledger labels, identifiers, contracts and rates remain unchanged. Do not rename URL slugs.

Map mapping: IMG_8205 is Clapham, IMG_8206 Fulham, IMG_8207 Oaklands Park. Originals remain unchanged. WebP derivatives resize to 800px wide, strip metadata and preserve the full map content. Label these as suburb overviews, never property locations. These historical image assets are retained; the current public map experience is described below.

Area facts checked 18 October 2026 against the official links in src/suburb-guides.js. Facilities include the surrounding area, with no promised walking distance, travel time, opening hours or halal certification. Guides stay visible even when there are no advertised rooms. Facility links expose current operator information. New facts or images require verification before publication.


## Interactive satellite suburb maps

Homepage cards and suburb guides use the Google Maps JavaScript API with a website-restricted browser key in the Cloudflare secret `GOOGLE_MAPS_BROWSER_KEY`. `/api/public/maps-config` exposes only that browser key. It is intentionally browser-visible; no private server credentials belong in this binding. Enable Maps JavaScript API, Places API (New), and Routes API in the same Google project. Restrict referrers to https://sakanlodge.com/* and https://www.sakanlodge.com/*, and restrict the allowed APIs to these three. Configure Google Cloud quotas separately; billing budget alerts do not cap spending.

The SDK loads once, on visibility. Raster hybrid maps start at zoom 14 around fixed suburb-centre coordinates, avoiding ambiguous search geocoding. Maps support pinch zoom, single-finger drag, and mouse controls without an activation gate. Category buttons use Places Nearby Search within 2.5 km, rendering real markers and an accessible list on the existing map. Requests are deduplicated and reused only within the current page session, never persisted. Routes are computed only on request, with distance/time, a polyline and Google warnings on the existing map. Map and Places attribution remains visible. Responses from superseded clicks cannot replace the currently requested view.

Loading, empty, timeout and authentication states are explicit. Never claim results have loaded before an API response. Failed requests can be retried; existing maps remain available on a category failure. No map iframe reloads, automatic Places searches, per-pan searches or automatic route requests. Suburb titles precede each map; room links remain crawlable and separate. Floating contact controls hide while map panels are visible.

Validate all three API operations in production after enabling the restricted key; unit tests use injected adapters and do not prove that Google billing/API configuration is valid.
