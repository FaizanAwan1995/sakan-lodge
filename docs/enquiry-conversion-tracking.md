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
