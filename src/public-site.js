import {STUDENT_PATH,STUDENT_TITLE,STUDENT_DESCRIPTION,studentAccommodationBody} from './student-accommodation.js';
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
/**
 * Supabase's modern sb_publishable_ / sb_secret_ keys are API keys, not
 * bearer JWTs. Use the server-only secret for privileged reservation writes.
 * Legacy JWT keys remain supported until they are rotated.
 */
export async function databaseRpc(env, name, data = {}, options = {}) {
  const { admin = false } = typeof options === "object" ? options : {};
  const staffAuthorization =
    typeof options === "string" ? options : options.authorization;
  if (staffAuthorization && !/^Bearer \S+$/.test(staffAuthorization))
    throw new Error("Invalid staff session");
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLIC_KEY)
    throw new Error("Database unavailable");
  const key = admin
    ? env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
    : env.SUPABASE_PUBLIC_KEY;
  if (!key) throw new Error("Database credential unavailable");
  const headers = { apikey: key, "content-type": "application/json" };
  if (staffAuthorization) headers.Authorization = staffAuthorization;
  else if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  const response = await fetch(
    env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name,
    {
      method: "POST",
      headers,
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
    !!(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) &&
    !!env.TURNSTILE_SECRET_KEY &&
    !!env.TURNSTILE_SITE_KEY
  );
}
function shell(
  title,
  description,
  path,
  body,
  { noindex = false, structured, image } = {},
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
    (noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">') +
    '<link rel="icon" type="image/png" sizes="540x540" href="/sakan-logo-circle-main.png"><link rel="apple-touch-icon" href="/sakan-logo-circle-main.png"><link rel="manifest" href="/manifest.webmanifest"><meta property="og:type" content="website"><meta property="og:title" content="' +
    h(title) +
    '"><meta property="og:description" content="' +
    h(description) +
    '"><meta property="og:url" content="' +
    h(canonical) +
    '"><link rel="stylesheet" href="/landing.css"><link rel="stylesheet" href="/catalog.css"><link rel="stylesheet" href="/site-ui.css?v=20261030-1">' +
    '<meta property="og:locale" content="en_AU"><meta property="og:site_name" content="SAKAN Lodge"><meta name="twitter:card" content="summary_large_image"><meta property="og:image" content="'+h(image && /^https:\/\//.test(image) ? image : ORIGIN+'/room-photos/shared-room-hero-balanced.webp')+'">' +
    schema +
    '</head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><a class="site-brand" href="/"><img src="/sakan-logo-circle-main.png" width="48" height="48" alt=""><span>SAKAN <strong>Lodge</strong></span></a><nav aria-label="Main navigation"><a href="/#locations">Locations</a><a href="/#rates">Rates</a><a href="/student-accommodation-adelaide/">Student rooms</a><a href="mailto:sakanlodges@gmail.com">Contact</a></nav></header><main id="main" class="catalog-main">' +
    body +
    '</main><footer class="site-footer"><p>SAKAN Lodge · Adelaide, South Australia</p><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="tel:+61426721787">0426 721 787</a><a href="https://www.facebook.com/share/1KGs4jyDqK/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer">Facebook</a></footer><script src="/suburb-maps.js?v=20261030-1" defer></script><script src="/contact-palette.js" defer></script><script src="/general-enquiry.js" defer></script></body></html>'
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
function photos(list, title, eager = false) {
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
          '" loading="'+(eager&&i===0?'eager':'lazy')+'"'+(eager&&i===0?' fetchpriority="high"':'')+' width="640" height="420">',
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
  '<section aria-label="Bills, appliances and household arrangements"><p>Electricity, water, gas and internet included without additional charges.</p><p>Heaters are provided, and air-conditioners are available on request. Contact our team to arrange heating or cooling for your stay. Other appliances with high electricity consumption require prior approval from SAKAN Lodge administrators.</p><details><summary>Household arrangements and halal suitability</summary><p>Most of our properties are men-only. Women applying individually and couples can also enquire. Placement depends on a suitable property, household arrangement, room capacity and availability; our team will confirm these details with you before a stay is agreed.</p><p>We offer a halal-suitable living environment. Please discuss your household preferences with our team so we can confirm a suitable placement for your stay.</p></details></section>';
function linkCard(title, path, desc, image = null) {
  return (
    '<article class="catalog-card">' + (image ? photos([image],title) : '') + '<h2><a href="' +
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
  const enquiry =
    '<p>Online reservation requests are currently unavailable. Check your dates below, then continue with a prefilled email request. Alternatively, <a href="mailto:sakanlodges@gmail.com?subject=' +
    h(encodeURIComponent("Room enquiry: " + room.title)) +
    '">Email our team about this room</a> or <a href="tel:+61426721787">call 0426 721 787</a>.</p>';
  const contactFields = enabled
    ? '<fieldset><legend>Contact details for your request</legend><label for="full-name">Full name</label><input id="full-name" name="full_name" autocomplete="name" minlength="2" maxlength="120" required><label for="email">Email</label><input id="email" name="email" autocomplete="email" type="email" maxlength="254" required><label for="phone">Phone</label><input id="phone" name="phone" autocomplete="tel" type="tel" minlength="6" maxlength="30" required><label for="occupation">Occupation (optional)</label><input id="occupation" name="occupation_type" maxlength="80"><label for="introduction">Tell us a little about your stay (optional)</label><textarea id="introduction" name="introduction" maxlength="2000"></textarea></fieldset><p>Spam protection: a successful security check does not confirm a booking.</p><div class="cf-turnstile" data-appearance="interaction-only" data-sitekey="' +
      h(env.TURNSTILE_SITE_KEY) +
      '"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><p>We use these details to review your request. Read our <a href="/privacy">privacy policy</a>.</p><button id="submit-request" type="submit" disabled>Submit reservation request</button><p id="request-result" role="status" aria-live="polite"></p>'
    : "";
  return (
    '<section class="catalog-card"><h2>' +
    (enabled ? "Check dates and request a stay" : "Check room availability") +
    "</h2>" +
    (enabled
      ? "<p>A request is not a confirmed booking and does not reserve a space. Check availability for your dates before submitting.</p>"
      : enquiry) +
    '<form id="reservation-form" data-room="' +
    h(room.id) +
    '" data-room-title="' +
    h(room.title) +
    '" data-capacity="' +
    room.capacity +
    '"><label for="arrival">Arrival</label><input id="arrival" name="arrival_date" type="date" required><label for="departure">Departure (checkout day)</label><input id="departure" name="departure_date" type="date" required><label for="spaces">' +
    (room.capacity > 1 ? "People / bed spaces" : "People") +
    '</label><input id="spaces" name="spaces_requested" type="number" min="1" max="' +
    room.capacity +
    '" value="1" required><button type="button" id="check-availability">Check availability</button><p id="availability-result" role="status" aria-live="polite"></p>' +
    (enabled
      ? ""
      : '<div class="enquiry-next-step" id="enquiry-next-step" hidden><a class="enquiry-next-action" id="email-reservation" href="mailto:sakanlodges@gmail.com">Continue reservation request by email ↗</a><p>Your selected room and dates will be added to an email draft. <strong>Send that email</strong> to lodge your enquiry. This does not reserve the room; our team must confirm availability.</p></div>') +
    contactFields +
    '</form><script src="/booking.js" defer></script></section>'
  );
}
export function renderListing(route, cat, env = {}) {
  const location = names[route.suburb];
  const base = publicPath({ suburb: route.suburb });
  const properties = cat.properties.filter((p) => p.suburb === location);
  if (route.kind === "location") {
    const title = "Rooms for rent in " + location + ", Adelaide SA";
    return html(
      shell(
        title,
        "Rooms for university students, working professionals and couples in " +
          location +
          ", Adelaide, South Australia. Private and shared options; utilities included. Confirm room capacity.",
        base,
        crumbs([{ name: location }]) +
          "<h1>" +
          h(title) +
          "</h1><p>Looking for a room while studying, working or moving as a couple? Explore accommodation in " + h(location) + ", Adelaide, South Australia for university students, working professionals and couples. Check your journey to your campus or workplace from the property.</p><p>Shared rooms: $185 per person/week, for two calendar months or longer. Private rooms: $255/week long-term, or $300/week for shorter stays. Couples should enquire for two occupants so our team can confirm a suitable room and sleeping arrangement. Single-occupancy private rooms are for one person.</p>" +
          included +
          '<section aria-labelledby="available-heading"><h2 id="available-heading">Available rooms in ' +
          h(location) +
          "</h2>" +
          (properties.length === 1
            ? '<p class="property-label">' +
              h(properties[0].name) +
              '</p><div class="catalog-grid">' +
              cat.rooms
                .filter((r) => r.property_id === properties[0].id)
                .map((r) =>
                  linkCard(
                    r.title,
                    publicPath({
                      suburb: route.suburb,
                      property: properties[0].slug,
                      room: r.slug,
                    }),
                    r.capacity > 1
                      ? "Shared accommodation · $185/person/week · long-term only"
                      : "Private room · $255/week long-term · $300/week short-term",
                r.photos?.[0],
                  ),
                )
                .join("") +
              "</div>"
            : '<div class="catalog-grid">' +
              properties
                .map((p) =>
                  linkCard(
                    p.name,
                    publicPath({ suburb: route.suburb, property: p.slug }),
                    p.description,
                  ),
                )
                .join("") +
              "</div>") +
          (properties.length
            ? ""
            : '<p>No rooms are currently advertised here. <a href="mailto:sakanlodges@gmail.com">Enquire about availability in ' +
              h(location) +
              "</a>.</p>") +
          "</section>" +
          renderSuburbGuide(route.suburb) + '<p><a href="/student-accommodation-adelaide/">Student accommodation guide: compare room costs, suburbs and move-in steps</a></p>',
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
                r.photos?.[0],
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
  const title = room.title + " — " + location + ", Adelaide | " + (room.capacity>1?"Shared room":"Private room");
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
        photos(room.photos, room.title, true) +
        '<p class="catalog-rate">' +
        (room.capacity > 1
          ? "Shared room · $185 per person/week · long-term only"
          : "Private room · $255/week long-term · $300/week short-term") +
        "</p><p>Two calendar months or longer is long-term. Availability is checked for your full stay.</p>" +
        included +
        amenities(room.amenities) +
        roomForm(room, env),
      {
        image: room.photos?.[0],
        structured: {
          "@context": "https://schema.org",
          "@graph": [{"@type":"Accommodation","@id":ORIGIN+roomUrl+'#room',"url":ORIGIN+roomUrl,"name":room.title,"description":room.description,"image":(room.photos||[]).filter(x=>typeof x==='string'&&/^https:\/\//.test(x)),"address":{"@type":"PostalAddress","addressLocality":location,"addressRegion":"SA","addressCountry":"AU"},"occupancy":{"@type":"QuantitativeValue","maxValue":room.capacity},"containedInPlace":{"@type":"LodgingBusiness","name":property.name,"url":ORIGIN+propertyUrl}}, {
          "@type": "BreadcrumbList",
          itemListElement: [
            { name: "Home", item: ORIGIN + "/" },
            { name: location, item: ORIGIN + base },
            { name: property.name, item: ORIGIN + propertyUrl },
            { name: room.title, item: ORIGIN + roomUrl },
          ].map((x, i) => ({ "@type": "ListItem", position: i + 1, ...x })),
        }],},
      },
    ),
  );
}
export async function handlePublicSite(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if(path==='/student-accommodation-adelaide'||path===STUDENT_PATH){
    if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
    if(path!==STUDENT_PATH)return new Response(null,{status:308,headers:{location:ORIGIN+STUDENT_PATH+url.search}});
    return html(shell(STUDENT_TITLE,STUDENT_DESCRIPTION,STUDENT_PATH,studentAccommodationBody,{structured:{'@context':'https://schema.org','@graph':[{'@type':'WebPage','@id':ORIGIN+STUDENT_PATH+'#page',url:ORIGIN+STUDENT_PATH,name:STUDENT_TITLE,description:STUDENT_DESCRIPTION,inLanguage:'en-AU',publisher:{'@id':ORIGIN+'/#business'}},{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:ORIGIN+'/'},{'@type':'ListItem',position:2,name:'Student accommodation',item:ORIGIN+STUDENT_PATH}]}]}}));
  }
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
        { admin: true },
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
        STUDENT_PATH,
        "/privacy",
        "/terms",
        ...LOCATION_SLUGS.map((suburb) => publicPath({ suburb })),
      ];
      const imageMap=new Map([['/',[ORIGIN+'/room-photos/shared-room-hero-balanced.webp']]]);
      for (const p of cat.properties) {
        const suburb = Object.keys(names).find((k) => names[k] === p.suburb);
        if (!suburb) continue;
        urls.push(publicPath({ suburb, property: p.slug }));
        for (const r of cat.rooms.filter((r) => r.property_id === p.id)){
          const roomPath=publicPath({ suburb, property: p.slug, room: r.slug });
          urls.push(roomPath);imageMap.set(roomPath,(r.photos||[]).filter(x=>typeof x==='string'&&/^https:\/\/[^\s<>]+$/.test(x)).slice(0,20));
        }
      }
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' +
          urls
            .map((p) => "<url><loc>" + h(ORIGIN + p) + "</loc>"+(imageMap.get(p)||[]).map(image=>'<image:image><image:loc>'+h(image)+'</image:loc></image:image>').join('')+"</url>")
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
        requestsOpen =
          (await databaseRpc(env, "customer_requests_enabled")) === true;
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
