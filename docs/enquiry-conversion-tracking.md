# Enquiry conversion tracking

## Website hook

After `/api/enquiries` returns a successful HTTP response with `received: true`, the public form emits this local data-layer event once:

```js
{ event: 'sakan_enquiry_received', enquiry_id: '<random submission UUID>' }
```

Form opens, submit clicks, validation failures, failed verification and unconfirmed server responses do not emit it. The submission UUID remains the same during a retry. Duplicate submit clicks after receipt do not emit again. The event contains no name, email, phone, message, accommodation preference or form values. Measurement failures cannot change the saved enquiry's confirmation.

This is a local hook, not an active Google Ads conversion integration. No Google advertising script has been added, no conversion has been sent to Google, and no campaign or budget has been changed.

## Remaining Google setup

The connected Windsor Google Ads integration can read supported reporting fields, but returned no usable conversion configuration and provides no conversion-action creation action. Empty report rows do not prove the account has no conversion actions.

Obtain the website lead conversion's Google Ads event snippet, containing the verified conversion ID (`AW-…`) and conversion label. Do not substitute Google Ads customer ID 990-030-9058 for a conversion ID. Count confirmed enquiry receipt as the lead action, with one conversion per ad interaction and a deduplication identifier from the submission UUID. Do not fire on visits to `/enquire` or on submit-button clicks.

Once those identifiers are available, configure the Google tag and success event, apply the site's consent choices, verify with Tag Assistant using synthetic data, and confirm the conversion action in Google Ads. No enhanced conversions or uploads of visitor contact data are configured by this change.

## Prepared Google Ads adapter (8 November 2026)

The existing `/api/enquiries` GET response can expose `conversion_send_to` only when the Worker variable `GOOGLE_ADS_ENQUIRY_SEND_TO` contains a verified `AW-<conversion-id>/<conversion-label>` destination. The variable is not configured in production, so Google Ads measurement remains inactive.

When configured, the form dynamically imports `/enquiry-measurement.js` and offers an unchecked optional measurement choice. No Google advertising tag loads before opt-in. After opt-in, the adapter initializes consent defaults, disables personalised advertising and analytics storage, then grants advertising measurement for that page. A successful server-confirmed receipt sends a conversion with only `send_to` and the random submission UUID as `transaction_id`. Repeat calls with the same UUID are ignored. Declining or revoking consent prevents future conversion calls, and measurement failures cannot break enquiry submission.

Activation still requires the actual Google Ads conversion action destination and Tag Assistant verification. Use the existing direct `/enquire` advertising landing page; attribution across other landing pages needs a separate site-wide consent-aware setup. There is no enhanced-conversion contact-data upload or campaign/budget change.
