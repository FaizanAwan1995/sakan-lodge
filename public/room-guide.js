/* Public concierge. Contact details go only to the protected enquiry endpoint. */
(() => {
  const KEY = "sakan-chat-v2",
    TTL = 24 * 60 * 60 * 1000;
  const clean = (s) =>
    s
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
      .replace(/(?:\+?\d[\d ()-]{6,}\d)/g, "[phone removed]");
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY));
  } catch {}
  let messages =
    Array.isArray(saved?.messages) && Date.now() - saved.updated < TTL
      ? saved.messages
          .filter(
            (m) =>
              ["user", "assistant"].includes(m.role) &&
              typeof m.content === "string" &&
              m.content.length < 3001,
          )
          .slice(-40)
      : [];
  let preferences =
      messages.length &&
      saved?.preferences &&
      typeof saved.preferences === "object"
        ? {
            audience: ["women", "men", "couples"].includes(
              saved.preferences.audience,
            )
              ? saved.preferences.audience
              : undefined,
            location: ["Fulham", "Clapham", "Oaklands Park"].includes(
              saved.preferences.location,
            )
              ? saved.preferences.location
              : undefined,
          }
        : {},
    started = messages.length > 0,
    busy = false,
    leadKey = crypto.randomUUID(),
    leadSignature = "",
    token = "",
    widget,
    verificationReady = false;
  const persist = () => {
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          updated: Date.now(),
          messages: messages.slice(-40),
          preferences,
        }),
      );
    } catch {}
  };
  const launch = document.createElement("button");
  launch.className = "room-guide-launch";
  launch.type = "button";
  launch.innerHTML = '<span aria-hidden="true">✦</span> Ask Sakan';
  launch.setAttribute("aria-haspopup", "dialog");
  document.body.append(launch);
  const d = document.createElement("dialog");
  d.className = "sakan-chat";
  d.setAttribute("aria-labelledby", "sakan-chat-title");
  d.innerHTML = `<header class="chat-header"><span class="chat-avatar" aria-hidden="true">✦</span><div><h2 id="sakan-chat-title">Your Sakan concierge</h2><p>AI room guide · Adelaide</p></div><button type="button" class="chat-new" aria-label="Start a new chat">↻</button><button type="button" class="chat-close" aria-label="Close chat">×</button></header><section class="chat-welcome"><span class="chat-eyebrow">A LITTLE HELLO. A NEW PLACE TO CALL HOME.</span><h3>Let’s find your place <span aria-hidden="true">✨</span></h3><p>Rooms, photos, prices — ask away. Leave your details and our team can help with your next move.</p><form class="chat-intro"><label>Your name<input name="full_name" autocomplete="name" minlength="2" maxlength="120" required placeholder="What should we call you?"></label><div class="chat-fields"><label>Email<input name="email" autocomplete="email" type="email" maxlength="254" required placeholder="you@example.com"></label><label>Phone<input name="phone" autocomplete="tel" type="tel" minlength="6" maxlength="30" required placeholder="Your contact number"></label></div><label>I’m looking for<select name="audience"><option value="">Help me choose</option><option value="women">Women’s rooms</option><option value="men">Men’s rooms</option><option value="couples">A couples granny flat</option></select></label><label class="chat-consent"><input name="contact" type="checkbox" required> I agree Sakan can contact me about my accommodation enquiry.</label><label class="chat-consent"><input name="future" type="checkbox"> Also contact me about future room availability (optional).</label><p class="chat-privacy">Details go to the Sakan team, not the AI. <a href="/privacy">Privacy</a></p><div class="chat-verification"></div><p class="chat-lead-status" role="status"></p><button class="chat-primary" type="submit">Save details & start chatting →</button></form><button class="chat-skip" type="button">Just browsing? Explore without sharing details →</button></section><section class="chat-conversation" hidden><div class="chat-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions"></div><div class="chat-suggestions" aria-label="Suggested questions"></div><form class="chat-compose"><label class="chat-sr" for="sakan-message">Your message</label><textarea id="sakan-message" maxlength="600" rows="1" required placeholder="Tell me what you’re looking for…"></textarea><button type="submit" aria-label="Send message">↑</button></form><p class="chat-footnote">AI guidance · Team confirms availability. <a href="/enquire">Talk to our team ↗</a></p></section>`;
  document.body.append(d);
  const log = d.querySelector(".chat-messages"),
    intro = d.querySelector(".chat-intro"),
    compose = d.querySelector(".chat-compose"),
    input = compose.querySelector("textarea"),
    leadStatus = d.querySelector(".chat-lead-status");
  const cards = {
    women: {
      title: "A space of your own · Fulham",
      price: "Private rooms from $255/week long-term",
      image: "/property-photos/sakan-fulham-women-room-1.webp",
      href: "/accommodation/women/",
      note: "Women-only household transition in progress; team confirms readiness.",
    },
    men: {
      title: "Find your Adelaide base",
      price: "Shared from $185/person/week long-term",
      image: "/room-photos/shared-room-hero-balanced.webp",
      href: "/accommodation/men/",
      note: "Clapham & Oaklands Park · Ask about your dates.",
    },
    couples: {
      title: "Your own little retreat · Fulham",
      price: "$500/week for the couple · Bills included",
      image: "/property-photos/fulham-granny-bedroom-640.webp",
      href: "/accommodation/couples/",
      note: "Private kitchen, bathroom & entrance · $1,000 bond · Over 3 months.",
    },
  };
  function roomCard(key) {
    const c = cards[key];
    if (!c) return;
    const card = document.createElement("a");
    card.className = "chat-room-card";
    card.href = c.href;
    const img = document.createElement("img");
    img.src = c.image;
    img.alt = c.title;
    img.loading = "lazy";
    const body = document.createElement("div");
    for (const [tag, text] of [
      ["strong", c.title],
      ["span", c.price],
      ["small", c.note],
      ["b", "See room photos →"],
    ]) {
      const el = document.createElement(tag);
      el.textContent = text;
      body.append(el);
    }
    card.append(img, body);
    log.append(card);
  }
  function bubble(role, text, { temporary = false } = {}) {
    const el = document.createElement("div");
    el.className = "chat-bubble chat-" + role;
    el.textContent = text;
    log.append(el);
    if (!temporary) {
      messages.push({ role, content: clean(text) });
      messages = messages.slice(-40);
      persist();
    }
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function chips() {
    const box = d.querySelector(".chat-suggestions");
    box.replaceChildren();
    for (const label of preferences.audience
      ? [
          "Show me photos",
          "What’s the bond?",
          "Are bills included?",
          "Short stays?",
        ]
      : [
          "Women’s rooms",
          "Men’s rooms",
          "Couples granny flat",
          "Compare prices",
        ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.onclick = () => ask(label);
      box.append(b);
    }
  }
  function context(q) {
    if (/women|female|girls/i.test(q)) preferences.audience = "women";
    else if (/\bmen\b|\bmale\b|boys/i.test(q)) preferences.audience = "men";
    else if (/couple|granny/i.test(q)) preferences.audience = "couples";
    for (const suburb of ["Fulham", "Clapham", "Oaklands Park"])
      if (q.toLowerCase().includes(suburb.toLowerCase()))
        preferences.location = suburb;
    persist();
  }
  function begin() {
    started = true;
    d.querySelector(".chat-welcome").hidden = true;
    d.querySelector(".chat-conversation").hidden = false;
    log.replaceChildren();
    if (messages.length) {
      for (const m of messages) bubble(m.role, m.content, { temporary: true });
    } else
      bubble(
        "assistant",
        "Hi! I’m your Sakan room guide ✨ Tell me who the room is for and when you’d like to move. We can explore photos, suburbs and costs together.",
      );
    chips();
    input.focus();
    log.scrollTop = log.scrollHeight;
  }
  async function ask(q) {
    q = q.trim();
    if (busy || !q) return;
    busy = true;
    compose.querySelector("button").disabled = true;
    const history = messages
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));
    context(q);
    bubble("user", clean(q));
    input.value = "";
    const typing = bubble(
      "assistant",
      "Finding a little clarity for your next move…",
      { temporary: true },
    );
    typing.classList.add("chat-typing");
    try {
      const r = await fetch("/api/room-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: clean(q), history, preferences }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          r.status === 429
            ? "A few too many questions at once. Give me a minute, or contact our team."
            : "I’m having trouble connecting right now. Your chat is safe — try again or talk to our team.",
        );
      typing.remove();
      bubble("assistant", data.answer);
      if (
        preferences.audience &&
        /photo|room|flat|female|women|couple|\bmen\b/i.test(q)
      )
        roomCard(preferences.audience);
    } catch (e) {
      typing.remove();
      const el = bubble(
        "assistant",
        e.name === "TimeoutError"
          ? "That took longer than expected. Please try again — or our team can help."
          : e.message,
        { temporary: true },
      );
      if (e.name !== "TimeoutError") el.textContent = e.message;
      messages.pop();
      persist();
      input.value = q;
      const retry = document.createElement("button");
      retry.className = "chat-retry";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.onclick = () => {
        el.remove();
        retry.remove();
        ask(q);
      };
      log.append(retry);
    } finally {
      busy = false;
      compose.querySelector("button").disabled = false;
      chips();
      log.scrollTop = log.scrollHeight;
      input.focus();
    }
  }
  compose.onsubmit = (e) => {
    e.preventDefault();
    ask(input.value);
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input.value);
    }
  };
  async function verification() {
    if (verificationReady) return;
    verificationReady = true;
    leadStatus.textContent = "Preparing secure contact form…";
    try {
      const r = await fetch("/api/enquiries", {
          signal: AbortSignal.timeout(10000),
        }),
        cfg = await r.json();
      if (!cfg.enabled || !cfg.site_key)
        throw Error(
          "Contact capture is temporarily unavailable. You can still explore below.",
        );
      if (!window.turnstile)
        await new Promise((resolve, reject) => {
          let script = document.querySelector(
            'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
          );
          const timeout = setTimeout(
            () =>
              reject(
                Error(
                  "Verification could not load. You can still explore below.",
                ),
              ),
            15000,
          );
          const done = () => {
            clearTimeout(timeout);
            resolve();
          };
          if (!script) {
            script = document.createElement("script");
            script.src =
              "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            document.head.append(script);
          }
          script.addEventListener("load", done, { once: true });
          script.addEventListener(
            "error",
            () =>
              reject(
                Error("Verification unavailable. You can still explore below."),
              ),
            { once: true },
          );
          if (window.turnstile) done();
        });
      widget = window.turnstile.render(d.querySelector(".chat-verification"), {
        sitekey: cfg.site_key,
        action: "enquiry",
        size: "flexible",
        callback: (v) => {
          token = v;
          leadStatus.textContent = "";
        },
        "expired-callback": () => {
          token = "";
        },
        "error-callback": () => {
          token = "";
          leadStatus.textContent =
            "Verification needs another try. Close and reopen chat, or explore below.";
        },
      });
      leadStatus.textContent = "";
    } catch (e) {
      verificationReady = false;
      leadStatus.textContent = e.message;
    }
  }
  intro.onsubmit = async (e) => {
    e.preventDefault();
    if (!intro.reportValidity()) return;
    if (!token) {
      leadStatus.textContent = "Please complete the security check first.";
      return;
    }
    const b = intro.querySelector('[type="submit"]');
    b.disabled = true;
    leadStatus.textContent = "Saving your details securely…";
    const f = new FormData(intro),
      audience = f.get("audience");
    const signature = JSON.stringify([...f.entries()]);
    if (leadSignature && signature !== leadSignature)
      leadKey = crypto.randomUUID();
    leadSignature = signature;
    try {
      const r = await fetch("/api/enquiries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": leadKey,
        },
        body: JSON.stringify({
          full_name: f.get("full_name"),
          email: f.get("email"),
          phone: f.get("phone"),
          location: "Flexible / any location",
          accommodation: "Not sure",
          occupants: audience === "couples" ? "2" : "1",
          move_in: "",
          message:
            "AI concierge introduction. Interest: " +
            (audience || "Help choosing") +
            ". Consent: contact about this accommodation enquiry. Future room availability updates: " +
            (f.get("future") ? "OPTED IN" : "NOT opted in") +
            ". Consent recorded " +
            new Date().toISOString(),
          turnstile_token: token,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await r.json();
      if (!r.ok || !result.received)
        throw Error(
          result.error || "We could not confirm receipt. Please try again.",
        );
      if (audience) preferences.audience = audience;
      intro.reset();
      begin();
      bubble(
        "assistant",
        "Your details reached our team. Let’s find something that feels right for you.",
      );
    } catch (e) {
      leadStatus.textContent = e.message;
      token = "";
      if (window.turnstile && widget !== undefined)
        window.turnstile.reset(widget);
    } finally {
      b.disabled = false;
    }
  };
  launch.onclick = () => {
    d.showModal();
    if (started) begin();
    else verification();
  };
  d.querySelector(".chat-close").onclick = () => d.close();
  d.addEventListener("close", () => launch.focus());
  d.querySelector(".chat-skip").onclick = begin;
  d.querySelector(".chat-new").onclick = () => {
    if (busy) return;
    if (
      messages.length &&
      !window.confirm(
        "Start a fresh chat? This clears the conversation on this device.",
      )
    )
      return;
    messages = [];
    preferences = {};
    started = false;
    persist();
    log.replaceChildren();
    intro.reset();
    leadKey = crypto.randomUUID();
    d.querySelector(".chat-conversation").hidden = true;
    d.querySelector(".chat-welcome").hidden = false;
    if (widget !== undefined && window.turnstile) {
      token = "";
      window.turnstile.reset(widget);
    } else verification();
  };
})();
