(() => {
  const form = document.querySelector("#reservation-form");
  if (!form) return;
  const result = document.querySelector("#availability-result"),
    message = document.querySelector("#request-result"),
    check = document.querySelector("#check-availability"),
    submit = document.querySelector("#submit-request"),
    enquiryNextStep = document.querySelector("#enquiry-next-step"),
    emailReservation = document.querySelector("#email-reservation");
  const couples=form.dataset.couples==='true';
  const verificationContainer=form.querySelector?.('.reservation-verification');
  const verification=verificationContainer&&window.SakanReservationVerification?.create(verificationContainer);
  const bed = form.elements.bed_number;
  if(bed)bed.addEventListener('change',()=>{if(bed.value)form.elements.spaces_requested.value='1';});
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Adelaide",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  form.elements.arrival_date.min = today;
  let verified = "",
    requestKey = SakanEnquiryContext.requestId(),
    sending = false;
  const fingerprint = () =>
    JSON.stringify([...new FormData(form)].filter(([key])=>key!=="cf-turnstile-response").map(([k,v])=>[k,typeof v==='string'?v:[v.name,v.size,v.lastModified]]));
  const dates = () =>
    [
      form.elements.arrival_date.value,
      form.elements.departure_date.value,
      form.elements.spaces_requested.value,
      bed?.value || '',
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
      requestKey = SakanEnquiryContext.requestId();
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
    if(bed?.value && Number(spaces.value)!==1){result.textContent='Choose one bed space when selecting a specific bed.';return false;}
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
      const selectedBedAvailable = !bed?.value || !Array.isArray(data.beds) || data.beds.includes(Number(bed.value));
      if(bed && Array.isArray(data.beds))for(const option of bed.options){if(option.value)option.disabled=!data.beds.includes(Number(option.value));}
      const hasSpaces = selectedBedAvailable && Number.isFinite(Number(data.spaces)) &&
        Number(data.spaces) >= Number(spaces.value);
      result.textContent =
        (couples ? (hasSpaces ? "Granny flat available for both occupants. AUD $" : "Granny flat unavailable for these dates. AUD $") : data.spaces + " bed space(s) available for these dates. AUD $") +
        (couples ? data.weekly_rate*2 : data.weekly_rate) +
        "/week" +
        (couples ? " per couple" : data.offer_type === "shared" ? " per person" : "") +
        (!hasSpaces
          ? ". The selected bed or number of spaces is unavailable for your dates."
          : data.requests_enabled
            ? ". Requests require administrator confirmation."
            : ". Online requests are currently unavailable. Send an enquiry below for our team to confirm.");
      // When online processing has not been activated, let customers progress
      // with the checked room and dates in the website enquiry form.
      // No booking is recorded or held until staff confirms it.
      if (!submit && enquiryNextStep && emailReservation && hasSpaces) {
        emailReservation.href = SakanEnquiryContext.link({
          room: form.dataset.room,
          room_title: form.dataset.roomTitle,
          location: form.dataset.location,
          offer: Number(form.dataset.capacity) > 1 ? 'shared' : 'private',
          arrival: arrival.value,
          departure: departure.value,
          occupants: spaces.value,
          bed: bed?.value || '',
        });
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
      const fields=new FormData(form);
      if(verification){message.textContent='Completing the security check…';fields.set('cf-turnstile-response',await verification.getToken());}
      if(!fields.get('cf-turnstile-response')) {
        message.textContent='Please complete the verification challenge and try again.';
        return;
      }
      verified=fingerprint();
      message.textContent=couples?'Uploading both photo IDs and preparing your application…':'Submitting request…';
      let response;
      if(couples) {
        fields.set('room_id',form.dataset.room);
        response=await fetch('/api/reservations/couples',{method:'POST',headers:{'Idempotency-Key':requestKey},body:fields,signal:AbortSignal.timeout(90000)});
      } else {
        const data=Object.fromEntries(fields);
        data.room_id=form.dataset.room;
        data.spaces_requested=Number(data.spaces_requested);
        data.turnstile_token=data['cf-turnstile-response'];
        delete data['cf-turnstile-response'];
        response=await fetch('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
      }
      const output = await response.json().catch(()=>{throw new Error("Receipt could not be confirmed. Please retry with the same details; your form has been kept.");});
      if (!response.ok) throw new Error(output.error);
      message.textContent =
        "Request received. Reference: " +
        output.code +
        (couples ? ". Both occupants’ details and photo IDs have been saved privately. Your draft agreement has been prepared for admin review. Our team will send your signing link after review. Your booking is not yet confirmed." : ". This is not a confirmed booking. Our team will review your request.");
      completed = true;
      verification?.complete();
      const securityCheck = form.querySelector?.(".cf-turnstile");
      if (securityCheck) securityCheck.hidden = true;
      form
        .querySelectorAll("input,textarea,button")
        .forEach((el) => (el.disabled = true));
    } catch (e) {
      message.textContent =
        (e.name === "TimeoutError" || e.name === "AbortError") ? "Receipt could not be confirmed in time. Please retry with the same details." : e.message ||
        "Unable to confirm receipt. Please retry with the same details.";
      if(verification)verification.reset();else window.turnstile?.reset();
    } finally {
      if (!completed) submit.disabled = false;
      sending = false;
    }
  });
  // Enable only after the submission handler has been attached. A missing
  // script must never fall back to a native GET form that leaks applicant data.
  submit.disabled = false;
})();
