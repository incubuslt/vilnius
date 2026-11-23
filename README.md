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
- The Worker supports **Smolensko 35** and **Kavoliuko 14**, each with its own Booking.com and Airbnb iCal feeds.
- Selecting a property tab loads only that property's availability and sends booking requests for that property.

GitHub Pages and the Worker are separate deployments. Push frontend/documentation changes
to `main` for Pages. Worker code changes require a separate Wrangler deployment; ask
before changing Cloudflare resources or deploying unless deployment has already been
explicitly approved for that change.

## Frontend behavior

- The calendar merges unavailable nights from both feeds through `/api/calendar`.
- The property tabs switch between the Smolensko 35 and Kavoliuko 14 calendars;
  Kavoliuko uses warm yellow accents with warm-white available dates.
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
  Secrets: `BOOKING_ICAL_URL`, `AIRBNB_ICAL_URL`, `KAVOL_BOOK_ICAL_URL`,
  `KAVOL_AIRBNB_ICAL_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`.
- The original Smolensko iCal URLs in a public Git commit were exposed. Regenerate
  those feeds and replace their Worker Secrets; do not reuse the exposed URLs.
  See [the Worker guide](worker/README.md).
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

## Property API mapping

The frontend sends the selected stable property ID (`smolensko-35` or
`kavoliuko-14`) to the Worker. The Worker maps these IDs to fixed secret names;
it never accepts calendar URLs from the browser. Calendar requests return only
the selected property's merged availability, and booking requests are rechecked
against that same property's feeds before a property-labelled Telegram message
is sent.

When adding another apartment, extend the frontend and this fixed Worker mapping
together. Add its calendar URLs as Cloudflare Secrets and test the availability
and booking paths before enabling its tab.
