# Suburb guides and direct room browsing

Owner instruction, 18 October 2026: each suburb page includes its supplied map, verified area highlights and facility icons. Show room cards directly when one public property is visible; show property selection when several are visible. Preserve nested room and property URLs.

Public house names: Noor House (Fulham), Sukoon House (Clapham), Aman House (Oaklands Park). Room display names use the matching house theme and existing room number. Ledger labels, identifiers, contracts and rates remain unchanged. Do not rename URL slugs.

Map mapping: IMG_8205 is Clapham, IMG_8206 Fulham, IMG_8207 Oaklands Park. Originals remain unchanged. WebP derivatives resize to 800px wide, strip metadata and preserve the full map content. Label these as suburb overviews, never property locations. Local assets and decorative inline SVG icons require no map SDK or third-party embeds.

Area facts checked 18 October 2026 against the official links in src/suburb-guides.js. Facilities include the surrounding area, with no promised walking distance, travel time, opening hours or halal certification. Guides stay visible even when there are no advertised rooms. Facility links expose current operator information. New facts or images require verification before publication.


## Interactive suburb maps

Homepage location cards and suburb guides now use live Google Maps embeds rather than screenshot images. Maps query the named South Australian suburb only, at an area-level zoom. Google Maps links provide CBD directions and nearby transport, groceries and parks; directions start from the suburb centre, never a private property address. Room availability remains a separate crawlable CTA.

Map frames load lazily. JavaScript initially disables pointer and keyboard interaction, with an Explore map button enabling one map at a time and Back to page restoring passive scrolling. External links remain usable if an embed cannot load or JavaScript is unavailable. The embed is the standard Google Maps interactive map, without a separately provisioned JavaScript API key; current route distances and times are obtained in Google Maps rather than hard-coded. Google attribution remains visible. Privacy information explains third-party map loading.
