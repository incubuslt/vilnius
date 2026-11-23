# Apartment Smolensko

Static apartment rental website published with GitHub Pages.

- `index.html` — page content
- `styles.css` — responsive styling
- `script.js` — calendar display and booking request form
- `worker/` — Cloudflare Worker that combines the Booking.com and Airbnb calendars

## Calendar proxy setup

GitHub Pages cannot read the iCal feeds directly because their providers block
browser cross-origin requests. The Cloudflare Worker handles calendar requests
and sends booking requests to Telegram. Follow [the Worker deployment guide](worker/README.md)
to configure the private calendar URLs and Telegram bot secrets.

The form sends a booking request notification; it does not automatically
approve a stay or take payment.

## Current live setup

- Website: <https://antanas-sukevicius.github.io/apartments/>
- Calendar and booking Worker: <https://smolensko-calendar-api.antanas-sukevicius.workers.dev>
- The current Worker combines one Booking.com and one Airbnb iCal feed for Apartment Smolensko.
- `/api/calendar` returns merged unavailable dates. `/api/booking` re-fetches both feeds, checks the requested nights, and sends valid requests to the configured Telegram chat.
- The Worker secrets are `BOOKING_ICAL_URL`, `AIRBNB_ICAL_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. Secret values belong only in Cloudflare, never in the repository or chat.
- The booking endpoint is limited to 3 requests per IP per minute, validates input and current availability, and has a honeypot field.
- Successful Telegram delivery means the request was received, not that the stay was approved. There is no email sending, admin approval workflow, or payment processing.

## Adding another apartment

The current app is intentionally configured for one apartment. When adding a
second one, extend the property data and both sides of the API together:

1. Add the new apartment's name, description, images, and stable property ID to
   the frontend. Add a property selector and show the selected property's
   calendar and request details.
2. Do not put iCal URLs in `script.js`. Add new Worker secrets for that
   apartment's calendar feeds, for example `SECOND_BOOKING_ICAL_URL` and
   `SECOND_AIRBNB_ICAL_URL`.
3. Update the Worker to map each known property ID to its own pair of secrets.
   The Worker must choose from this fixed map; never accept an arbitrary feed
   URL from the browser.
4. Make `/api/calendar` identify the selected property and return only that
   property's merged availability. Include the same property ID in the booking
   request; the Worker must re-fetch and validate dates against that property's
   calendars before sending the Telegram notification, and include the property
   name in the message.
5. Keep calendar tokens and Telegram credentials as Cloudflare Secrets. Deploy
   Worker changes with `npx.cmd wrangler deploy --config worker/wrangler.toml`.
6. Publish frontend changes by committing and pushing to `main`. If changing
   the HTML's asset references does not load the latest version, increment the
   `?v=` query on the CSS or JavaScript URL to bypass browser/CDN cache.
7. Test both properties: each calendar should show only its own unavailable
   dates; a request overlapping a booked night should be rejected; an available
   request should notify Telegram with the correct property name.

The implementation and secret setup details are in [worker/README.md](worker/README.md).
