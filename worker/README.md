# Calendar and booking Worker

The static site is hosted by GitHub Pages at <https://mmt.lt>. The Cloudflare
Worker fetches the Booking.com and Airbnb iCal feeds (which browsers cannot
reliably read cross-origin), combines their unavailable dates, retrieves
Smolensko 35's nightly Booking.com rates, rechecks new booking requests against
current availability, and sends valid requests to a private Telegram chat.

The Worker supports **Smolensko 35** and **Kavoliuko 14**. Each property has a
fixed pair of calendar secrets selected by a stable property ID.

## Important: rotate exposed calendar links

The original Smolensko 35 iCal URLs were included in a public GitHub commit.
Treat those links as exposed: regenerate its Booking.com and Airbnb feeds, then
replace `BOOKING_ICAL_URL` and `AIRBNB_ICAL_URL`. Do not reuse the old URLs or
add replacements to source control, documentation, screenshots, or chat.

## Secrets and account setup

In Cloudflare, open **Workers & Pages → smolensko-calendar-api → Settings →
Variables and Secrets**. Configure these as **Secrets**, not plaintext
configuration:

- `BOOKING_ICAL_URL` — Smolensko 35 Booking.com iCal feed URL.
- `AIRBNB_ICAL_URL` — Smolensko 35 Airbnb iCal feed URL.
- `KAVOL_BOOK_ICAL_URL` — Kavoliuko 14 Booking.com iCal feed URL.
- `KAVOL_AIRBNB_ICAL_URL` — Kavoliuko 14 Airbnb iCal feed URL.
- `TELEGRAM_BOT_TOKEN` — private bot token from Telegram's `@BotFather`.
- `TELEGRAM_CHAT_ID` — numeric private chat ID for the notification destination.

Never put secret values in frontend code, `wrangler.toml`, commits, or chat. The
Worker validates calendar URL hosts (`ical.booking.com` and `www.airbnb.com`).

To create a Telegram bot, use `@BotFather`, start the bot from the receiving
account, and privately obtain its chat ID. Avoid sharing or screenshotting a
bot-token URL while retrieving updates.

## Deploy and update

The Worker is named `smolensko-calendar-api` and is configured in
[`wrangler.toml`](./wrangler.toml). From the repository root:

```powershell
npx.cmd wrangler login
npx.cmd wrangler deploy --config worker/wrangler.toml
```

Ask the project owner before deploying or otherwise changing Cloudflare
resources, unless the owner has explicitly approved that particular deployment.
Deploying source does not configure or reveal Worker Secrets.

The account-wide `workers.dev` subdomain is `vilnius-mmt`. The live Worker URL
is <https://smolensko-calendar-api.vilnius-mmt.workers.dev>. This account
setting also changes the URLs of other Workers in the same Cloudflare account.

## API

### `GET /api/calendar`

Accepts `propertyId=smolensko-35` or `propertyId=kavoliuko-14` and returns that
property's `unavailableDates` (sorted `YYYY-MM-DD` strings), `propertyId`, and
`updatedAt`. If omitted, `propertyId` defaults to `smolensko-35` for
compatibility. The response is cached for five minutes. Both selected feeds
must load and parse successfully; on provider failure the Worker returns an
error rather than assuming dates are available.

### `GET /api/prices`

Accepts `propertyId=smolensko-35` or `propertyId=kavoliuko-14`. Smolensko 35
returns available Booking.com nightly prices in EUR for one guest for the
current month and next three months. The response includes `propertyId`,
`pricingSupported`, base `prices` (keyed by `YYYY-MM-DD`), `pricingConfig`, and
`updatedAt`. Kavoliuko 14 returns an empty price map because it has no
configured Booking.com rate source. The Worker requests Booking.com in date
chunks of at most 61 days; upstream errors return an error response and do not
affect calendar availability.

### Pricing configuration

Edit [`src/pricing-config.json`](./src/pricing-config.json) to set Smolensko
35's calculation rules, then deploy the Worker:

- `baseGuests`: guests covered by the Booking.com base price (currently one).
- `additionalGuestPerNightEUR`: added per guest above `baseGuests`, per night
  (currently €5; children count as guests too).
- `discountPercent`: percentage discount applied to the nightly price after
  additional-guest fees.
- `weeklyDiscountPercent`: percentage discount applied to the stay total when
  the stay is at least `weeklyDiscountMinimumNights` nights.
- `weeklyDiscountMinimumNights`: minimum stay length for the weekly discount
  (currently six nights).
- `oneNightSurchargePercent`: percentage surcharge applied to a one-night
  stay total.

Discounts and surcharges default to zero. The calendar reflects the selected
guest count; weekly discounts and one-night surcharges are shown in the
selected-stay estimate.

### `POST /api/booking`

Accepts JSON with the guest's `propertyId`, `name`, `email`, `phone`, `checkin`,
`checkout`, `adults`, `children`, `message`, and honeypot `website` fields. The
Worker only accepts known property IDs and defaults a missing `propertyId` to
`smolensko-35` for compatibility. The frontend also sends `guests` (the
adults-plus-children total) for compatibility with older Worker deployments.
The Worker accepts either `adults` or legacy `guests`; missing `children`
defaults to zero.

The Worker validates guest details, dates, a maximum of four guests total, and
the 300-character optional-message limit. It re-fetches both iCal feeds before
accepting the request, then sends a Telegram message identifying the selected
property and containing adult, child, and total guest counts. For Smolensko,
the frontend also sends an optional price estimate; the Worker validates its
stay length, guest count, and arithmetic, then appends the itemized estimate
rounded to whole euros. The website displays the same total on the request
button. A successful response means a request notification was delivered; it
is not an approval or booking confirmation.

Booking requests are limited to three per IP per minute using the
`BOOKING_RATE_LIMITER` binding in `wrangler.toml`. A hidden honeypot field is
also checked. Booking responses are not cached.

The current three-month selection window is enforced by the frontend, not the
Worker. If API clients should also be restricted to that window, add and test a
matching server-side rule before relying on it as a security/business rule.

## CORS origins

`worker/src/index.js` currently allows:

- `https://antanas-sukevicius.github.io`
- `https://mmt.lt`
- `https://www.mmt.lt`
- `http://localhost:5500`
- `http://127.0.0.1:5500`

Add a future production website origin to `ALLOWED_ORIGINS` and deploy the
Worker. Do not use wildcard origins for booking requests.

## Adding another property

The current fixed mapping is `smolensko-35` → `BOOKING_ICAL_URL` and
`AIRBNB_ICAL_URL`, and `kavoliuko-14` → `KAVOL_BOOK_ICAL_URL` and
`KAVOL_AIRBNB_ICAL_URL`. Never accept arbitrary feed URLs from a browser. When
adding another property, extend the fixed mapping, make the property explicit
in calendar and booking requests, return only its availability, and identify it
in Telegram notifications. Keep all feed URLs in Cloudflare Secrets.
