# Calendar and booking Worker

The static site is hosted by GitHub Pages at <https://mmt.lt>. The Cloudflare
Worker fetches the Booking.com and Airbnb iCal feeds (which browsers cannot
reliably read cross-origin), combines their unavailable dates, rechecks new
booking requests against current availability, and sends valid requests to a
private Telegram chat.

The Worker currently handles **Smolensko 35 only**. The frontend's Kavoliuko 14
tab is a disabled placeholder, not a second configured property.

## Important: rotate exposed calendar links

The original iCal URLs were included in a public GitHub commit. Treat those feed
links as exposed: regenerate the Booking.com and Airbnb links, then replace the
Worker Secrets. Do not reuse the old URLs or add replacements to source control,
documentation, screenshots, or chat.

## Secrets and account setup

In Cloudflare, open **Workers & Pages → smolensko-calendar-api → Settings →
Variables and Secrets**. Configure these as **Secrets**, not plaintext
configuration:

- `BOOKING_ICAL_URL` — regenerated Booking.com iCal feed URL.
- `AIRBNB_ICAL_URL` — regenerated Airbnb iCal feed URL.
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

Returns JSON with `unavailableDates` (sorted `YYYY-MM-DD` strings) and
`updatedAt`. The response is cached for five minutes. Both feeds must load and
parse successfully; on provider failure the Worker returns an error rather than
assuming dates are available.

### `POST /api/booking`

Accepts JSON with the guest's `name`, `email`, `phone`, `checkin`, `checkout`,
`adults`, `children`, `message`, and honeypot `website` fields. The current
frontend also sends `guests` (the adults-plus-children total) for compatibility
with older Worker deployments. The Worker accepts either `adults` or legacy
`guests`; missing `children` defaults to zero.

The Worker validates guest details, dates, a maximum of four guests total, and
the 300-character optional-message limit. It re-fetches both iCal feeds before
accepting the request, then sends a Telegram message containing adult, child,
and total guest counts. A successful response means a request notification was
delivered; it is not an approval or booking confirmation.

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

Do not merely enable the Kavoliuko 14 tab. The Worker must first map each known
property ID to a fixed pair of secrets; never accept arbitrary feed URLs from a
browser. Make the selected property explicit in both calendar and booking
requests, return only that property's availability, recheck bookings against
that property's feeds, and include the property's name in Telegram
notifications. Keep all secrets in Cloudflare and test each property's feeds
and booking behavior independently before enabling the tab.
