(() => {
  const form = document.querySelector("#reservation-form");
  if (!form) return;
  const result = document.querySelector("#availability-result"),
    message = document.querySelector("#request-result"),
    check = document.querySelector("#check-availability"),
    submit = document.querySelector("#submit-request");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Adelaide",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  form.elements.arrival_date.min = today;
  let verified = "",
    requestKey = crypto.randomUUID(),
    sending = false;
  const fingerprint = () =>
    JSON.stringify(Object.fromEntries(new FormData(form)));
  const dates = () =>
    [
      form.elements.arrival_date.value,
      form.elements.departure_date.value,
      form.elements.spaces_requested.value,
    ].join("|");
  let checkedDates = "";
  form.addEventListener("input", () => {
    if (dates() !== checkedDates) {
      if (submit) submit.disabled = true;
      result.textContent = "Check availability for the updated dates.";
    }
    if (verified && verified !== fingerprint()) {
      requestKey = crypto.randomUUID();
      verified = "";
    }
  });
  check.addEventListener("click", async () => {
    const arrival = form.elements.arrival_date,
      departure = form.elements.departure_date,
      spaces = form.elements.spaces_requested;
    if (
      !arrival.reportValidity() ||
      !departure.reportValidity() ||
      !spaces.reportValidity()
    )
      return;
    check.disabled = true;
    if (submit) submit.disabled = true;
    result.textContent = "Checking your full stay…";
    const selected = dates();
    try {
      const res = await fetch(
        "/api/availability?" +
          new URLSearchParams({
            room: form.dataset.room,
            arrival: arrival.value,
            departure: departure.value,
          }),
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (selected !== dates()) return;
      checkedDates = selected;
      result.textContent =
        data.spaces +
        " space(s) available for these dates. AUD $" +
        data.weekly_rate +
        "/week" +
        (data.offer_type === "shared" ? " per person" : "") +
        (data.requests_enabled
          ? ". Requests require administrator confirmation."
          : ". Online requests are currently unavailable. Please email or call our team to enquire.");
      if (submit) submit.disabled =
        !data.requests_enabled || data.spaces < Number(spaces.value);
    } catch (e) {
      result.textContent =
        e.message || "Unable to verify availability. Please contact our team.";
    } finally {
      check.disabled = false;
    }
  });
  // Availability-only pages must never submit or collect applicant details.
  if (!submit) {
    form.addEventListener("submit", (event) => event.preventDefault());
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      sending ||
      submit.disabled ||
      checkedDates !== dates() ||
      !form.reportValidity()
    )
      return;
    sending = true;
    if (submit) submit.disabled = true;
    message.textContent = "Submitting request…";
    verified = fingerprint();
    try {
      const data = Object.fromEntries(new FormData(form));
      data.room_id = form.dataset.room;
      data.spaces_requested = Number(data.spaces_requested);
      data.turnstile_token = data["cf-turnstile-response"];
      delete data["cf-turnstile-response"];
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify(data),
      });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error);
      message.textContent =
        "Request received. Reference: " +
        output.code +
        ". This is not a confirmed booking. Our team will review your request.";
      form
        .querySelectorAll("input,textarea,button")
        .forEach((el) => (el.disabled = true));
    } catch (e) {
      message.textContent =
        e.message ||
        "Unable to confirm receipt. Please retry with the same details.";
      submit.disabled = false;
      window.turnstile?.reset();
    } finally {
      sending = false;
    }
  });
})();
