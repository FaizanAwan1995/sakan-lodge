# Suburb guides and direct room browsing

Owner instruction, 18 October 2026: each suburb page includes its supplied map, verified area highlights and facility icons. Show room cards directly when one public property is visible; show property selection when several are visible. Preserve nested room and property URLs.

Public house names: Noor House (Fulham), Sukoon House (Clapham), Aman House (Oaklands Park). Room display names use the matching house theme and existing room number. Ledger labels, identifiers, contracts and rates remain unchanged. Do not rename URL slugs.

Map mapping: IMG_8205 is Clapham, IMG_8206 Fulham, IMG_8207 Oaklands Park. Originals remain unchanged. WebP derivatives resize to 800px wide, strip metadata and preserve the full map content. Label these as suburb overviews, never property locations. These historical image assets are retained; the current public map experience is described below.

Area facts checked 18 October 2026 against the official links in src/suburb-guides.js. Facilities include the surrounding area, with no promised walking distance, travel time, opening hours or halal certification. Guides stay visible even when there are no advertised rooms. Facility links expose current operator information. New facts or images require verification before publication.


## Interactive satellite suburb maps

Homepage location cards and suburb guides now use live Google Maps embeds rather than screenshot images. Maps query the named South Australian suburb only, at an area-level zoom. Suburb headings precede the widget, and room availability remains a separate crawlable CTA.

Map frames load lazily and are interactive immediately, with no Explore map activation gate, inert iframe or pointer-blocking state. Google controls touch gestures: pinch to zoom and two-finger panning are available directly. Overview, Transport, Groceries, Parks and CBD route options navigate the named iframe, keeping the website open even without JavaScript. Each view requests satellite imagery. The script adds active-option styling and an accessible status. Directions start from the suburb centre, never a private property address. Current routes and distances are provided by Google rather than hard-coded.

Floating contact controls are hidden only while a map panel is visible, then restored automatically so they cannot obstruct touch controls or attribution. No application code claims to override Google's iframe gesture policy or provider-owned links. The standard Google Maps embed does not require a separately provisioned JavaScript API key. Privacy information explains third-party map loading and on-site searches. Original screenshot assets are retained for historical/social references but are not used as public location maps.
