import { renderSuburbGuide } from "./suburb-guides.js";
import {
  escapeHtml as h,
  parsePublicRoute,
  publicPath,
  LOCATION_SLUGS,
} from "./public-routes.js";
const ORIGIN = "https://sakanlodge.com";
const names = {
  fulham: "Fulham",
  clapham: "Clapham",
  "oaklands-park": "Oaklands Park",
};
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
export async function databaseRpc(env, name, data = {}, authorization) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLIC_KEY)
    throw new Error("Database unavailable");
  const response = await fetch(
    env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLIC_KEY,
        Authorization: authorization || "Bearer " + env.SUPABASE_PUBLIC_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    const error = new Error(e.message || "Database request failed");
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export async function limitedJson(request, max = 12000) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("Request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function bookingEnabled(env) {
  return (
    env.RESERVATION_REQUESTS_ENABLED === "true" &&
    !!env.SUPABASE_SERVICE_ROLE_KEY &&
    !!env.TURNSTILE_SECRET_KEY &&
    !!env.TURNSTILE_SITE_KEY
  );
}
function shell(
  title,
  description,
  path,
  body,
  { noindex = false, structured } = {},
) {
  const canonical = ORIGIN + path;
  const schema = structured
    ? '<script type="application/ld+json">' +
      JSON.stringify(structured).replace(/</g, "\\u003c") +
      "</script>"
    : "";
  return (
    '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    h(title) +
    ' | SAKAN Lodge</title><meta name="description" content="' +
    h(description) +
    '"><link rel="canonical" href="' +
    h(canonical) +
    '">' +
    (noindex ? '<meta name="robots" content="noindex,follow">' : "") +
    '<meta property="og:type" content="website"><meta property="og:title" content="' +
    h(title) +
    '"><meta property="og:description" content="' +
    h(description) +
    '"><meta property="og:url" content="' +
    h(canonical) +
    '"><link rel="stylesheet" href="/landing.css"><link rel="stylesheet" href="/catalog.css">' +
    schema +
    '</head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><a class="site-brand" href="/"><img src="/sakan-logo-circle-main.png" width="48" height="48" alt=""><span>SAKAN <strong>Lodge</strong></span></a><nav aria-label="Main navigation"><a href="/#locations">Locations</a><a href="/#rates">Rates</a><a href="mailto:sakanlodges@gmail.com">Contact</a></nav></header><main id="main" class="catalog-main">' +
    body +
    '</main><footer class="site-footer"><p>SAKAN Lodge · Adelaide, South Australia</p><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="tel:+61426721787">0426 721 787</a></footer></body></html>'
  );
}
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
function crumbs(parts) {
  return (
    '<nav class="breadcrumbs" aria-label="Breadcrumb">' +
    [{ name: "Home", url: "/" }, ...parts]
      .map((p, i) =>
        p.url
          ? '<a href="' + h(p.url) + '">' + h(p.name) + "</a>"
          : '<span aria-current="page">' + h(p.name) + "</span>",
      )
      .join(' <span aria-hidden="true">/</span> ') +
    "</nav>"
  );
}
function photos(list, title) {
  return (
    '<div class="catalog-photos">' +
    (Array.isArray(list) ? list : [])
      .filter((x) => typeof x === "string" && /^https:\/\/[^\s<>]+$/.test(x))
      .map(
        (url, i) =>
          '<img src="' +
          h(url) +
          '" alt="' +
          h(title) +
          " — photo " +
          (i + 1) +
          '" loading="lazy" width="640" height="420">',
      )
      .join("") +
    "</div>"
  );
}
function amenities(list) {
  return (
    '<ul class="amenities">' +
    (Array.isArray(list) ? list : [])
      .filter((x) => typeof x === "string")
      .map((x) => "<li>" + h(x) + "</li>")
      .join("") +
    "</ul>"
  );
}
const included =
  "<p>Electricity, water, gas and internet included without additional charges.</p>";
function linkCard(title, path, desc) {
  return (
    '<article class="catalog-card"><h2><a href="' +
    h(path) +
    '">' +
    h(title) +
    "</a></h2><p>" +
    h(desc) +
    "</p></article>"
  );
}
function roomForm(room, env) {
  const enabled = bookingEnabled(env);
  const enquiry = '<p>Online reservation requests are currently unavailable. <a href="mailto:sakanlodges@gmail.com?subject=' +
    h(encodeURIComponent('Room enquiry: ' + room.title)) + '">Email our team about this room</a> or <a href="tel:+61426721787">call 0426 721 787</a>.</p>';
  const contactFields = enabled
    ? '<fieldset><legend>Contact details for your request</legend><label for="full-name">Full name</label><input id="full-name" name="full_name" autocomplete="name" minlength="2" maxlength="120" required><label for="email">Email</label><input id="email" name="email" autocomplete="email" type="email" maxlength="254" required><label for="phone">Phone</label><input id="phone" name="phone" autocomplete="tel" type="tel" minlength="6" maxlength="30" required><label for="occupation">Occupation (optional)</label><input id="occupation" name="occupation_type" maxlength="80"><label for="introduction">Tell us a little about your stay (optional)</label><textarea id="introduction" name="introduction" maxlength="2000"></textarea></fieldset><div class="cf-turnstile" data-sitekey="' +
      h(env.TURNSTILE_SITE_KEY) + '"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><p>We use these details to review your request. Read our <a href="/privacy">privacy policy</a>.</p><button id="submit-request" type="submit" disabled>Submit reservation request</button><p id="request-result" role="status" aria-live="polite"></p>'
    : '';
  return '<section class="catalog-card"><h2>' +
    (enabled ? 'Check dates and request a stay' : 'Check room availability') + '</h2>' +
    (enabled ? '<p>A request is not a confirmed booking and does not reserve a space. Check availability for your dates before submitting.</p>' : enquiry) +
    '<form id="reservation-form" data-room="' + h(room.id) + '" data-capacity="' + room.capacity +
    '"><label for="arrival">Arrival</label><input id="arrival" name="arrival_date" type="date" required><label for="departure">Departure (checkout day)</label><input id="departure" name="departure_date" type="date" required><label for="spaces">' +
    (room.capacity > 1 ? 'People / bed spaces' : 'People') +
    '</label><input id="spaces" name="spaces_requested" type="number" min="1" max="' + room.capacity +
    '" value="1" required><button type="button" id="check-availability">Check availability</button><p id="availability-result" role="status" aria-live="polite"></p>' +
    contactFields + '</form><script src="/booking.js" defer></script></section>';
}
export function renderListing(route, cat, env = {}) {
  const location = names[route.suburb];
  const base = publicPath({ suburb: route.suburb });
  const properties = cat.properties.filter((p) => p.suburb === location);
  if (route.kind === "location") {
    const title = "Rooms for rent in " + location + ", Adelaide";
    return html(
      shell(
        title,
        "Explore private rooms and shared accommodation in " +
          location +
          ", Adelaide. Electricity, water, gas and internet included.",
        base,
        crumbs([{ name: location }]) +
          "<h1>" +
          h(title) +
          "</h1><p>Shared rooms: $185 per person/week, for two calendar months or longer. Private rooms: $255/week long-term, or $300/week for shorter stays.</p>" +
          included +
          '<section aria-labelledby="available-heading"><h2 id="available-heading">Available rooms in ' + h(location) + '</h2>' +
          (properties.length === 1
            ? '<p class="property-label">' + h(properties[0].name) + '</p><div class="catalog-grid">' +
              cat.rooms.filter(r => r.property_id === properties[0].id).map(r => linkCard(r.title,
                publicPath({suburb: route.suburb, property: properties[0].slug, room: r.slug}),
                r.capacity > 1 ? "Shared accommodation · $185/person/week · long-term only" : "Private room · $255/week long-term · $300/week short-term")).join('') + '</div>'
            : '<div class="catalog-grid">' + properties.map(p => linkCard(p.name,
                publicPath({suburb: route.suburb, property: p.slug}), p.description)).join('') + '</div>') +
          (properties.length ? '' : '<p>No rooms are currently advertised here. <a href="mailto:sakanlodges@gmail.com">Enquire about availability in ' + h(location) + '</a>.</p>') +
          '</section>' + renderSuburbGuide(route.suburb),
      ),
    );
  }
  const property = properties.find((p) => p.slug === route.property);
  if (!property)
    return html(
      shell(
        "Listing not found",
        "This listing is not available.",
        base,
        '<h1>Listing not found</h1><p><a href="' +
          base +
          '">Explore ' +
          h(location) +
          "</a></p>",
        { noindex: true },
      ),
      404,
    );
  const propertyUrl = publicPath({
    suburb: route.suburb,
    property: property.slug,
  });
  const rooms = cat.rooms.filter((r) => r.property_id === property.id);
  if (route.kind === "property")
    return html(
      shell(
        property.name + " — " + location,
        "Rooms at " +
          property.name +
          " in " +
          location +
          ", Adelaide. Utilities included.",
        propertyUrl,
        crumbs([{ name: location, url: base }, { name: property.name }]) +
          "<h1>" +
          h(property.name) +
          "</h1><p>" +
          h(property.description) +
          "</p>" +
          photos(property.photos, property.name) +
          amenities(property.amenities) +
          included +
          '<div class="catalog-grid">' +
          rooms
            .map((r) =>
              linkCard(
                r.title,
                publicPath({
                  suburb: route.suburb,
                  property: property.slug,
                  room: r.slug,
                }),
                r.capacity > 1
                  ? "Shared accommodation · $185/person/week · long-term only"
                  : "Private room · $255/week long-term · $300/week short-term",
              ),
            )
            .join("") +
          "</div>" +
          (rooms.length
            ? ""
            : "<p>No rooms are currently advertised at this property.</p>"),
      ),
    );
  const room = rooms.find((r) => r.slug === route.room);
  if (!room)
    return html(
      shell(
        "Room not found",
        "This room is not available.",
        propertyUrl,
        '<h1>Room not found</h1><a href="' +
          propertyUrl +
          '">View property</a>',
        { noindex: true },
      ),
      404,
    );
  const roomUrl = publicPath({
    suburb: route.suburb,
    property: property.slug,
    room: room.slug,
  });
  const title = room.title + " — " + location;
  return html(
    shell(
      title,
      "Explore " +
        (room.capacity > 1 ? "shared accommodation" : "a private room") +
        " at " +
        property.name +
        ", " +
        location +
        ". Utilities included. Check your stay dates.",
      roomUrl,
      crumbs([
        { name: location, url: base },
        { name: property.name, url: propertyUrl },
        { name: room.title },
      ]) +
        "<h1>" +
        h(room.title) +
        "</h1><p>" +
        h(room.description) +
        "</p>" +
        photos(room.photos, room.title) +
        '<p class="catalog-rate">' +
        (room.capacity > 1
          ? "Shared room · $185 per person/week · long-term only"
          : "Private room · $255/week long-term · $300/week short-term") +
        "</p><p>Two calendar months or longer is long-term. Availability is checked for your full stay.</p>" +
        included +
        amenities(room.amenities) +
        roomForm(room, env),
      {
        structured: {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { name: "Home", item: ORIGIN + "/" },
            { name: location, item: ORIGIN + base },
            { name: property.name, item: ORIGIN + propertyUrl },
            { name: room.title, item: ORIGIN + roomUrl },
          ].map((x, i) => ({ "@type": "ListItem", position: i + 1, ...x })),
        },
      },
    ),
  );
}
export async function handlePublicSite(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/availability") {
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405);
    try {
      const data = await databaseRpc(env, "room_availability", {
        p_room: url.searchParams.get("room"),
        p_arrival: url.searchParams.get("arrival"),
        p_departure: url.searchParams.get("departure"),
      });
      return json({
        ...data,
        requests_enabled: data.requests_enabled && bookingEnabled(env),
      });
    } catch (e) {
      return json(
        {
          error:
            e.status === 400
              ? "Check your dates and room selection. Shared stays require two calendar months."
              : "Availability cannot be verified. Please contact our team.",
        },
        e.status === 400 ? 400 : 503,
      );
    }
  }
  if (path === "/api/reservations") {
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (request.headers.get("Origin") !== ORIGIN)
      return json({ error: "Invalid origin" }, 403);
    if (!bookingEnabled(env))
      return json(
        { error: "Online requests are not active. Please contact our team." },
        503,
      );
    try {
      const input = await limitedJson(request);
      const key = request.headers.get("Idempotency-Key");
      if (!/^[a-f0-9-]{36}$/i.test(key || "") || !input.turnstile_token)
        return json({ error: "Verification required" }, 400);
      const verify = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET_KEY,
            response: input.turnstile_token,
            remoteip: request.headers.get("CF-Connecting-IP") || "",
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const verification = await verify.json();
      if (!verification.success || verification.hostname !== "sakanlodge.com")
        return json({ error: "Verification failed. Try again." }, 400);
      // Whitelist fields; the database derives status, offer type, rate and property.
      const data = Object.fromEntries(
        [
          "room_id",
          "full_name",
          "email",
          "phone",
          "arrival_date",
          "departure_date",
          "spaces_requested",
          "occupation_type",
          "introduction",
        ].map((k) => [k, input[k]]),
      );
      const result = await databaseRpc(
        env,
        "submit_reservation",
        { p_data: data, p_key: key },
        "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      );
      return json(result, 201);
    } catch (e) {
      return json(
        {
          error:
            e.status === 409
              ? "Availability changed. Check your dates again."
              : e.status === 400
                ? "Check your details and dates."
                : "We could not verify your request. Keep the same request identifier when retrying.",
        },
        e.status === 409 ? 409 : e.status === 400 ? 400 : 503,
      );
    }
  }
  const route = parsePublicRoute(path);
  if (!route && path !== "/sitemap.xml") return null;
  if (!["GET", "HEAD"].includes(request.method))
    return json({ error: "Method not allowed" }, 405);
  if (route && !path.endsWith("/"))
    return new Response(null, {
      status: 308,
      headers: { location: ORIGIN + path + "/" + url.search },
    });
  try {
    const cat = await databaseRpc(env, "public_catalog");
    if (path === "/sitemap.xml") {
      const urls = [
        "/",
        "/privacy",
        "/terms",
        ...LOCATION_SLUGS.map((suburb) => publicPath({ suburb })),
      ];
      for (const p of cat.properties) {
        const suburb = Object.keys(names).find((k) => names[k] === p.suburb);
        if (!suburb) continue;
        urls.push(publicPath({ suburb, property: p.slug }));
        for (const r of cat.rooms.filter((r) => r.property_id === p.id))
          urls.push(publicPath({ suburb, property: p.slug, room: r.slug }));
      }
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          urls
            .map((p) => "<url><loc>" + h(ORIGIN + p) + "</loc></url>")
            .join("") +
          "</urlset>",
        {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
    // The database is the final authority for whether customer requests are
    // open. A Worker flag alone must not render a misleading applicant form.
    let requestsOpen = false;
    if (route?.kind === "room" && bookingEnabled(env)) {
      try {
        requestsOpen = (await databaseRpc(env, "customer_requests_enabled")) === true;
      } catch {
        // Fail closed: room pages stay useful for availability and enquiries.
        requestsOpen = false;
      }
    }
    return renderListing(route, cat, {
      ...env,
      RESERVATION_REQUESTS_ENABLED: requestsOpen ? "true" : "false",
    });
  } catch {
    return html(
      shell(
        "Listings temporarily unavailable",
        "Please contact SAKAN Lodge to enquire about accommodation.",
        path,
        '<h1>We cannot verify listings right now</h1><p>Please <a href="mailto:sakanlodges@gmail.com">email our team</a> or try again later.</p>',
        { noindex: true },
      ),
      503,
    );
  }
}
