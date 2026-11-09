/* Native links preserve audience and suburb, including opening in another tab. */
(() => {
  const page = document.querySelector('[data-stay-segment]');
  const trigger = document.getElementById('open-enquiry');
  if (page && trigger) trigger.href = '/enquire?audience=' + encodeURIComponent(page.dataset.staySegment);
})();
