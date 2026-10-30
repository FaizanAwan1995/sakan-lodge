(() => {
  const form = document.querySelector("#reservation-form");
  if (!form) return;
  const result = document.querySelector("#availability-result"),
    message = document.querySelector("#request-result"),
    check = document.querySelector("#check-availability"),
    submit = document.querySelector("#submit-request"),
    enquiryNextStep = document.querySelector("#enquiry-next-step"),
    emailReservation = document.querySelector("#email-reservation");
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
    JSON.stringify(Object.fromEntries([...new FormData(form)].filter(([key])=>key!=="cf-turnstile-response")));
  const dates = () =>
    [
      form.elements.arrival_date.value,
      form.elements.departure_date.value,
      form.elements.spaces_requested.value,
    ].join("|");
  let checkedDates = "";
  form.addEventListener("input", () => {
    if (dates() !== checkedDates) {
      checkedDates = "";
      if (enquiryNextStep) enquiryNextStep.hidden = true;
      result.textContent = submit
        ? "Availability will be checked when you submit, or you can check it now."
        : "Check availability to continue with your room enquiry.";
    }
    if (verified && verified !== fingerprint()) {
      requestKey = crypto.randomUUID();
      verified = "";
    }
  });
  // A customer can submit directly: this same validation runs automatically
  // before any personal information is sent. The server rechecks inventory.
  async function verifyAvailability() {
    const arrival = form.elements.arrival_date,
      departure = form.elements.departure_date,
      spaces = form.elements.spaces_requested;
    if (
      !arrival.reportValidity() ||
      !departure.reportValidity() ||
      !spaces.reportValidity()
    ) return false;
    const selected = dates();
    checkedDates = "";
    if (enquiryNextStep) enquiryNextStep.hidden = true;
    check.disabled = true;
    result.textContent = "Checking your full stay…";
    try {
      const res = await fetch(
        "/api/availability?" +
          new URLSearchParams({
            room: form.dataset.room,
            arrival: arrival.value,
            departure: departure.value,
          }),
        {signal:AbortSignal.timeout(15000)},
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Availability could not be verified.");
      if (selected !== dates()) {
        result.textContent = "Your dates changed. Please try again.";
        return false;
      }
      checkedDates = selected;
      const hasSpaces = Number.isFinite(Number(data.spaces)) &&
        Number(data.spaces) >= Number(spaces.value);
      result.textContent =
        data.spaces +
        " space(s) available for these dates. AUD $" +
        data.weekly_rate +
        "/week" +
        (data.offer_type === "shared" ? " per person" : "") +
        (!hasSpaces
          ? ". Not enough spaces for your request."
          : data.requests_enabled
            ? ". Requests require administrator confirmation."
            : ". Online requests are currently unavailable. Please email or call our team to enquire.");
      // When online processing has not been activated, let customers progress
      // with the checked room and dates rather than trapping them at this step.
      // The external email client is responsible for sending; no booking is
      // recorded or held until staff replies.
      if (!submit && enquiryNextStep && emailReservation && hasSpaces) {
        const subject = "Reservation request: " + (form.dataset.roomTitle || "SAKAN Lodge room");
        const body = [
          "Hello SAKAN Lodge,",
          "",
          "I would like to request the following accommodation:",
          "Room: " + (form.dataset.roomTitle || "SAKAN Lodge room"),
          "Room reference: " + form.dataset.room,
          "Arrival: " + arrival.value,
          "Departure (checkout day): " + departure.value,
          "People / spaces: " + spaces.value,
          "Advertised rate: AUD $" + data.weekly_rate +
            "/week" + (data.offer_type === "shared" ? " per person" : ""),
          "",
          "My name:",
          "My phone:",
          "My occupation (optional):",
          "A little about my stay (optional):",
          "",
          "Please let me know whether this room can be reserved.",
        ].join("\n");
        emailReservation.href = "mailto:sakanlodges@gmail.com?subject=" +
          encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
        enquiryNextStep.hidden = false;
        result.textContent += " Continue below to send your enquiry.";
      }
      return hasSpaces && data.requests_enabled === true;
    } catch (e) {
      result.textContent =
        (e.name === "TimeoutError" || e.name === "AbortError") ? "Availability check timed out. Please try again." : e.message || "Unable to verify availability. Please contact our team.";
      return false;
    } finally {
      check.disabled = false;
    }
  }
  check.addEventListener("click", () => verifyAvailability());
  // Availability-only pages must never submit or collect applicant details.
  if (!submit) {
    form.addEventListener("submit", (event) => event.preventDefault());
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      sending ||
      !form.reportValidity()
    )
      return;
    sending = true;
    submit.disabled = true;
    message.textContent = "Checking availability before submitting…";
    let completed = false;
    try {
      if (!await verifyAvailability()) {
        message.textContent = "Your request has not been sent. Review the availability message above, or contact our team.";
        return;
      }
      const data = Object.fromEntries(new FormData(form));
      if (!data["cf-turnstile-response"]) {
        message.textContent = "Please complete the verification challenge and try again.";
        return;
      }
      verified = fingerprint();
      message.textContent = "Submitting request…";
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
        signal: AbortSignal.timeout(20000),
      });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error);
      message.textContent =
        "Request received. Reference: " +
        output.code +
        ". This is not a confirmed booking. Our team will review your request.";
      completed = true;
      const securityCheck = form.querySelector?.(".cf-turnstile");
      if (securityCheck) securityCheck.hidden = true;
      form
        .querySelectorAll("input,textarea,button")
        .forEach((el) => (el.disabled = true));
    } catch (e) {
      message.textContent =
        (e.name === "TimeoutError" || e.name === "AbortError") ? "Receipt could not be confirmed in time. Please retry with the same details." : e.message ||
        "Unable to confirm receipt. Please retry with the same details.";
      window.turnstile?.reset();
    } finally {
      if (!completed) submit.disabled = false;
      sending = false;
    }
  });
  // Enable only after the submission handler has been attached. A missing
  // script must never fall back to a native GET form that leaks applicant data.
  submit.disabled = false;
})();
