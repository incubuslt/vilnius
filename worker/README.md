# Calendar and booking API deployment

The GitHub Pages site is static, so it cannot fetch the Booking.com and Airbnb
feeds directly from a browser. This Cloudflare Worker fetches both feeds,
combines their unavailable dates, and returns JSON to the site. It also checks
booking requests against fresh feed data and sends valid requests to your
private Telegram chat.

## Important: rotate the existing calendar links

The original iCal URLs were included in a public GitHub commit. Treat those
links as exposed: regenerate the calendar links in Booking.com and Airbnb, then
use the newly generated URLs as the Worker secrets below. Do not reuse the old
links or add the replacement links to source control.

## Deploy the Worker

1. Install Node.js if it is not already installed.
2. Sign in to Cloudflare and register a `workers.dev` subdomain in the
   [Workers onboarding page](https://dash.cloudflare.com/?to=/:account/workers/onboarding).
   This is required to publish a Worker at its default `workers.dev` address.
3. From the project root, authenticate Wrangler with your Cloudflare account:

   ```powershell
   npx.cmd wrangler login
   ```

4. Deploy the Worker:

   ```powershell
   npx.cmd wrangler deploy --config worker/wrangler.toml
   ```

   The deployed Worker URL is
   `https://smolensko-calendar-api.antanas-sukevicius.workers.dev`.

5. In Cloudflare, open **Workers & Pages**, select `smolensko-calendar-api`,
   then **Settings → Variables and Secrets**. Add these calendar URLs as **Secrets**:

   - `BOOKING_ICAL_URL` — the full Booking.com iCal URL
   - `AIRBNB_ICAL_URL` — the full Airbnb iCal URL

   Enter the feed URLs directly in Cloudflare. Do not put them in source files,
   commit them, or send them in chat.

6. Create a Telegram bot:

   - Open Telegram and message `@BotFather`.
   - Send `/newbot`, follow the prompts, and save the bot token privately.
   - Open the new bot and press **Start** (or send `/start`) so it can message you.
   - To find your private chat ID, open
     `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in a browser,
     replacing the placeholder with your token. Find `message.chat.id` in the
     response. The token is part of that URL: do not share or screenshot it.

7. In **Settings → Variables and Secrets** for `smolensko-calendar-api`, add
   these as **Secrets**:

   - `TELEGRAM_BOT_TOKEN` — the token from BotFather
   - `TELEGRAM_CHAT_ID` — the numeric ID of your private chat with the bot

   The bot API is free for these notifications. Telegram notifications require
   internet access; they are not SMS and are not a booking confirmation.

8. Push the updated `script.js` and `index.html` to GitHub so the Pages site
   sends requests to the Worker.
   The Worker already permits requests from the GitHub Pages origin for this
   repository. If you later add a custom website domain, add its origin to
   `ALLOWED_ORIGINS` in `worker/src/index.js` and redeploy.

9. Confirm availability by opening
   `https://smolensko-calendar-api.antanas-sukevicius.workers.dev/api/calendar`.
   A successful response contains `unavailableDates` and `updatedAt`.
   Then submit one test request on the website using a valid available date
   range and confirm it arrives in Telegram.

Booking requests are limited to three per IP per minute and include a hidden
honeypot field. Availability responses are cached for five minutes. If either
calendar provider is unavailable, the Worker rejects the request rather than
assuming the dates are free.

## Updating the service

After changing `worker/src/index.js`, deploy again with:

```powershell
npx.cmd wrangler deploy --config worker/wrangler.toml
```

Changing the iCal links does not require a code change; update the corresponding
secret with `wrangler secret put`.
