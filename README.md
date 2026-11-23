# MMT Stays

Static, single-page apartment availability and booking-request site for Vilnius.
The frontend uses only vanilla HTML, CSS, and JavaScript and is published with
GitHub Pages.

## Project files

- `index.html` — property tabs, calendar, and guest booking-request form.
- `styles.css` — responsive layout and calendar/form styling.
- `script.js` — calendar rendering, date selection, client-side validation, and API calls.
- `worker/src/index.js` — Cloudflare Worker for iCal availability and Telegram notifications.
- `worker/wrangler.toml` — Worker name, entry point, runtime date, and rate-limit binding.
- `worker/README.md` — Worker secrets, account setup, and deployment instructions.
- `CNAME` — GitHub Pages custom domain (`mmt.lt`).

## Current live setup

- Repository: `incubuslt/vilnius`, branch `main`, GitHub Pages publishes from the repository root.
- Website: <https://mmt.lt>
- Alternate website hostname: <https://www.mmt.lt>
- Cloudflare Worker: <https://smolensko-calendar-api.vilnius-mmt.workers.dev>
- The account-wide `workers.dev` subdomain is `vilnius-mmt`; URLs for other Workers in this account use it too.
- API endpoints: `/api/calendar` and `/api/booking`.
- The Worker currently supports one property, **Smolensko 35**, using one Booking.com and one Airbnb iCal feed.
- The UI also shows **Kavoliuko 14** as a disabled “Coming soon” tab. It is not connected to a calendar or booking service yet; selecting it cannot switch properties.

GitHub Pages and the Worker are separate deployments. Push frontend/documentation changes
to `main` for Pages. Worker code changes require a separate Wrangler deployment; ask
before changing Cloudflare resources or deploying unless deployment has already been
explicitly approved for that change.

## Frontend behavior

- The calendar merges unavailable nights from both feeds through `/api/calendar`.
- The page starts at the current month and allows navigation through the current month
  plus the next three full calendar months.
- Check-in must be before the final day of the booking window; the last day is
  available for check-out only. The client also checks selected ranges against
  unavailable nights.
- Date fields, guest counts, and message length are validated in the browser.
- The booking form requests full name, email, internationally formatted phone,
  adults, children aged 16 and under, dates, and an optional message.
- Adult count must be 1–4. The child selector allows at most `4 - adults`
  children. Four adults disables the child selector.
- The optional message is limited to 300 characters and has a live counter.
- The host's private contact details are intentionally not displayed in the frontend.
- Submitting the form sends a request to the Worker. It is not a reservation
  confirmation, approval, or payment. The Worker re-fetches calendars and sends a
  valid request to Telegram.
- No email sending, admin approval workflow, or payment processing exists.

The booking-window limit is currently enforced by the frontend. The Worker independently
validates dates, past check-in, guest counts, and fresh calendar availability, but does
not currently enforce the same three-month booking-window limit.

## Security and operational notes

- Never put calendar feed URLs, Telegram bot credentials, or chat IDs in frontend
  files, documentation, Git history, or chat. Keep them only in Cloudflare Worker
  Secrets: `BOOKING_ICAL_URL`, `AIRBNB_ICAL_URL`, `TELEGRAM_BOT_TOKEN`, and
  `TELEGRAM_CHAT_ID`.
- The iCal URLs in an original public Git commit were exposed. Regenerate the
  Booking.com and Airbnb feed URLs and replace the Worker Secrets; do not reuse
  exposed URLs. See [the Worker guide](worker/README.md).
- The Worker allowlist includes the GitHub Pages origin, `https://mmt.lt`,
  `https://www.mmt.lt`, and local development origins on port 5500.
- Booking requests are limited to 3 per IP per minute, include a honeypot, and
  are checked against freshly fetched calendars before Telegram delivery.
- Availability errors fail closed: the Worker does not treat provider failures as
  open dates.
- Current frontend assets use `?v=` cache-busting query parameters. Increment them
  when necessary if GitHub Pages serves stale assets.

## Local development and checks

No build step or frontend dependencies are required. Run a static server from the
repository root, for example:

```powershell
python -m http.server 5500
```

Open <http://127.0.0.1:5500>. The page calls the live Worker for calendar availability.
Do not submit a real booking as a local smoke test; successful submission sends a real
Telegram notification.

Syntax checks:

```powershell
node --check script.js
node --check worker/src/index.js
```

There is no configured automated test suite or package manifest at present.

## Future work: add Kavoliuko 14

The disabled tab is only a placeholder. To make it functional:

1. Assign a stable property ID and add property-specific labels and booking details.
2. Add separate Booking.com and Airbnb feed secrets in Cloudflare. Never accept
   arbitrary calendar URLs from the browser.
3. Change the Worker to map known property IDs to their own fixed calendar secrets.
   `/api/calendar` must return only the chosen property's merged dates.
4. Include the property ID in each booking request. The Worker must select the
   corresponding feeds from its fixed map, recheck availability, and identify the
   property in the Telegram message.
5. Test each property's availability and booking path independently. Deploy Worker
   changes only with approval; publish frontend changes by pushing to `main`.

Do not enable the second tab until both frontend and Worker support it end to end.
