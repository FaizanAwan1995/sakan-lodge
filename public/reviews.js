(() => {
  const carousel = document.querySelector('[data-review-carousel]');
  if (carousel) {
    const slides = [...carousel.querySelectorAll('.review-slide')];
    const track = carousel.querySelector('.review-track');
    const toggle = carousel.querySelector('[data-review-toggle]');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0, playing = !reduced.matches, hovering = false, focused = false, timer;
    const position = carousel.querySelector('[data-review-position]');
    const announcement = carousel.querySelector('[data-review-announcement]');
    function show(next, manual = false) {
      if (!slides.length) return;
      index = (next + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      slides.forEach((slide, i) => slide.setAttribute('aria-hidden', String(i !== index)));
      position.textContent = `${index + 1} of ${slides.length}`;
      if (manual) announcement.textContent = `Review ${index + 1} of ${slides.length}`;
    }
    function sync() {
      clearInterval(timer);
      toggle.textContent = playing ? 'Pause' : 'Play';
      toggle.setAttribute('aria-label', playing ? 'Pause automatic review rotation' : 'Start automatic review rotation');
      if (playing && !hovering && !focused && !document.hidden && slides.length > 1) timer = setInterval(() => show(index + 1), 8000);
    }
    carousel.querySelector('[data-review-prev]').addEventListener('click', () => { show(index - 1, true); sync(); });
    carousel.querySelector('[data-review-next]').addEventListener('click', () => { show(index + 1, true); sync(); });
    toggle.addEventListener('click', () => { playing = !playing; sync(); });
    carousel.querySelector('.review-window').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); show(index + (e.key === 'ArrowLeft' ? -1 : 1), true); sync();
    });
    carousel.addEventListener('mouseenter', () => { hovering = true; sync(); });
    carousel.addEventListener('mouseleave', () => { hovering = false; sync(); });
    carousel.addEventListener('focusin', () => { focused = true; sync(); });
    carousel.addEventListener('focusout', e => { focused = carousel.contains(e.relatedTarget); sync(); });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', () => { if (reduced.matches) playing = false; sync(); });
    sync();
  }
  const form = document.getElementById('review-form');
  if (!form) return;
  const status = document.getElementById('review-status');
  const submit = form.querySelector('[type="submit"]');
  let token = '', busy = false, received = false, widget, key = crypto.randomUUID(), signature = '';
  const state = () => { submit.disabled = busy || !token || received; };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = () => {
    if (!window.turnstile) return;
    widget = window.turnstile.render('#review-verification', {
      sitekey: form.dataset.siteKey, action: 'review',
      callback: value => { token = value; state(); if (!busy && !received) status.textContent = 'Ready to submit when you have completed the form.'; },
      'expired-callback': () => { token = ''; state(); },
      'error-callback': () => { token = ''; state(); status.textContent = 'Verification could not load. Please retry or contact our team.'; }
    });
  };
  script.onerror = () => { status.textContent = 'Verification could not load. Refresh the page or contact our team.'; };
  document.head.append(script);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || received || !token || !form.reportValidity()) return;
    const fields = new FormData(form);
    const data = Object.fromEntries(fields);
    data.consent = fields.get('consent') === 'on'; data.rating = Number(data.rating);
    const nextSignature = JSON.stringify(data);
    if (signature && signature !== nextSignature) key = crypto.randomUUID();
    signature = nextSignature;
    busy = true; state(); status.textContent = 'Submitting your review…';
    try {
      const response = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type':'application/json', 'Idempotency-Key':key }, body: JSON.stringify({ ...data, turnstile_token:token }) });
      const result = await response.json();
      if (!response.ok || result.received !== true) throw Error(result.error || 'We could not confirm receipt. Keep your review and try again.');
      received = true; status.textContent = result.message; submit.textContent = 'Review received'; form.reset();
    } catch (error) {
      status.textContent = error.message || 'We could not confirm receipt. Keep your review and try again.';
      token = ''; if (window.turnstile && widget !== undefined) window.turnstile.reset(widget);
    } finally { busy = false; state(); }
  });
})();
