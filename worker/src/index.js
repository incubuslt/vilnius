import pricingConfig from "./pricing-config.json";

const PROPERTIES = Object.freeze({
  "smolensko-35": Object.freeze({
    name: "Smolensko 35",
    bookingSecret: "BOOKING_ICAL_URL",
    airbnbSecret: "AIRBNB_ICAL_URL"
  }),
  "kavoliuko-14": Object.freeze({
    name: "Kavoliuko 14",
    bookingSecret: "KAVOL_BOOK_ICAL_URL",
    airbnbSecret: "KAVOL_AIRBNB_ICAL_URL"
  })
});

const BOOKING_PRICE_SOURCE = Object.freeze({
  hotelId: 17547944,
  blockId: "1754794401_447018270_3_0_0",
  pagename: "minutes-to-center",
  destinationId: "-2620663"
});
const BOOKING_PRICE_QUERY_HASH = "5db8c67304471b7e3544df89121e647ba91a78f871ece6a60872965400d27df8";
const BOOKING_PRICE_DAYS_PER_REQUEST = 61;
const PRICING_SUPPORTED_PROPERTY = "smolensko-35";

const ALLOWED_ORIGINS = new Set([
  "https://antanas-sukevicius.github.io",
  "https://mmt.lt",
  "https://www.mmt.lt",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300"
};

function corsHeaders(origin) {
  const headers = new Headers({ Vary: "Origin" });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return headers;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function jsonResponse(body, status, origin, noStore = false) {
  const headers = new Headers(JSON_HEADERS);
  if (noStore || status !== 200) headers.set("Cache-Control", "no-store");
  for (const [name, value] of corsHeaders(origin)) headers.set(name, value);

  return new Response(JSON.stringify(body), { status, headers });
}

function bookingResponse(body, status, origin) {
  return jsonResponse(body, status, origin, true);
}

function parseIcs(icsText) {
  if (!/BEGIN:VCALENDAR/i.test(icsText)) {
    throw new Error("Calendar response is not a valid iCalendar feed");
  }

  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const events = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const unavailable = new Set();

  function getDate(propertyLine) {
    if (!propertyLine) return null;
    const separator = propertyLine.indexOf(":");
    if (separator < 0) return null;

    const property = propertyLine.slice(0, separator);
    const value = propertyLine.slice(separator + 1).trim();
    const dateOnly = /(?:^|;)VALUE=DATE(?:;|$)/i.test(property) || /^\d{8}$/.test(value);
    const match = dateOnly
      ? value.match(/^(\d{4})(\d{2})(\d{2})$/)
      : value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);

    if (!match) return null;
    const date = `${match[1]}-${match[2]}-${match[3]}`;

    if (dateOnly || !match[7]) return date;

    const instant = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    ));
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vilnius",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  for (const event of events) {
    const lines = event.split(/\r?\n/);
    const startLine = lines.find((line) => /^DTSTART(?:;[^:]*)?:/i.test(line));
    const endLine = lines.find((line) => /^DTEND(?:;[^:]*)?:/i.test(line));
    const start = getDate(startLine);
    const end = getDate(endLine);
    if (!start || !end || end <= start) continue;

    const cursor = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    while (cursor < endDate) {
      unavailable.add(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return unavailable;
}

function validateCalendarUrl(value, expectedHost) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Calendar URL is missing or invalid");
  }

  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error(`Calendar URL must use https://${expectedHost}`);
  }

  return url;
}

async function fetchCalendar(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/calendar,text/plain,*/*" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Calendar host returned HTTP ${response.status}`);
  return parseIcs(await response.text());
}

async function getUnavailableDates(env, propertyId) {
  const property = PROPERTIES[propertyId];
  if (!property) throw new Error("Unknown property");

  const bookingUrl = validateCalendarUrl(env[property.bookingSecret], "ical.booking.com");
  const airbnbUrl = validateCalendarUrl(env[property.airbnbSecret], "www.airbnb.com");
  const calendars = await Promise.all([
    fetchCalendar(bookingUrl),
    fetchCalendar(airbnbUrl)
  ]);
  return [...new Set(calendars.flatMap((calendar) => [...calendar]))].sort();
}

function getPriceDateRange() {
  const [year, month] = dateInVilnius().split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month + 3, 0));
  return {
    start,
    end,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function parseBookingPrice(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^€[\s\u00a0]*([\d,]+(?:\.\d{1,2})?)$/);
  if (!match) return null;

  const price = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function getBookingPrices(propertyId) {
  const source = propertyId === PRICING_SUPPORTED_PROPERTY ? BOOKING_PRICE_SOURCE : null;
  if (!source) return {};

  const { start, end, startDate, endDate } = getPriceDateRange();
  const prices = {};
  const cursor = new Date(start);

  while (cursor <= end) {
    const chunkStart = cursor.toISOString().slice(0, 10);
    const remainingDays = Math.floor((end - cursor) / 86400000) + 1;
    const amountOfDays = Math.min(BOOKING_PRICE_DAYS_PER_REQUEST, remainingDays);
    const nextDay = new Date(cursor);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const url = new URL("https://www.booking.com/dml/graphql");
    url.searchParams.set("dest_id", source.destinationId);
    url.searchParams.set("dest_type", "city");
    url.searchParams.set("group_adults", String(pricingConfig.baseGuests));
    url.searchParams.set("no_rooms", "1");
    url.searchParams.set("group_children", "0");
    url.searchParams.set("all_sr_blocks", source.blockId);
    url.searchParams.set("highlighted_blocks", source.blockId);
    url.searchParams.set("matching_block_id", source.blockId);
    url.searchParams.set("checkin", chunkStart);
    url.searchParams.set("checkout", nextDay.toISOString().slice(0, 10));
    url.searchParams.set("lang", "en-gb");
    url.searchParams.set("selected_currency", "EUR");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.booking.com",
        Referer: "https://www.booking.com/"
      },
      body: JSON.stringify({
        operationName: "AvailabilityCalendar",
        variables: {
          input: {
            travelPurpose: 2,
            pagenameDetails: { countryCode: "lt", pagename: source.pagename },
            searchConfig: {
              searchConfigDate: { startDate: chunkStart, amountOfDays },
              nbAdults: pricingConfig.baseGuests,
              nbRooms: 1,
              nbChildren: 0,
              childrenAges: []
            }
          }
        },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: BOOKING_PRICE_QUERY_HASH }
        }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Booking.com returned HTTP ${response.status}`);

    const result = await response.json();
    const calendar = result?.data?.availabilityCalendar;
    if (calendar?.hotelId !== source.hotelId || !Array.isArray(calendar.days)) {
      throw new Error("Booking.com returned invalid price data");
    }

    for (const day of calendar.days) {
      if (day.available !== true ||
          typeof day.checkin !== "string" ||
          day.checkin < startDate ||
          day.checkin > endDate) {
        continue;
      }

      const price = parseBookingPrice(day.avgPriceFormatted);
      if (price !== null) prices[day.checkin] = price;
    }

    cursor.setUTCDate(cursor.getUTCDate() + amountOfDays);
  }

  return prices;
}

function validatePricingConfig(config) {
  return Number.isInteger(config.baseGuests) &&
    config.baseGuests >= 1 &&
    config.baseGuests <= 4 &&
    Number.isFinite(config.additionalGuestPerNightEUR) &&
    config.additionalGuestPerNightEUR >= 0 &&
    Number.isFinite(config.discountPercent) &&
    config.discountPercent >= 0 &&
    config.discountPercent <= 100 &&
    Number.isFinite(config.weeklyDiscountPercent) &&
    config.weeklyDiscountPercent >= 0 &&
    config.weeklyDiscountPercent <= 100 &&
    Number.isInteger(config.weeklyDiscountMinimumNights) &&
    config.weeklyDiscountMinimumNights >= 1 &&
    Number.isFinite(config.oneNightSurchargePercent) &&
    config.oneNightSurchargePercent >= 0;
}

function cleanField(value, maxLength) {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

function validatePriceEstimate(estimate, nights, guests) {
  if (!estimate || typeof estimate !== "object" || Array.isArray(estimate) ||
      estimate.nights !== nights || estimate.guests !== guests) {
    return false;
  }

  const amounts = [
    estimate.baseTotal,
    estimate.extraGuestTotal,
    estimate.directBookingDiscountTotal,
    estimate.weeklyDiscountTotal,
    estimate.oneNightSurchargeTotal,
    estimate.total
  ];
  if (!amounts.every((amount) =>
    Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000
  )) {
    return false;
  }

  const expectedTotal = Math.round((
    estimate.baseTotal +
    estimate.extraGuestTotal -
    estimate.directBookingDiscountTotal -
    estimate.weeklyDiscountTotal +
    estimate.oneNightSurchargeTotal +
    Number.EPSILON
  ) * 100) / 100;
  return Math.abs(estimate.total - expectedTotal) < 0.011;
}

function formatEstimateCurrency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatPriceEstimateLines(estimate) {
  const extraGuests = Math.max(0, estimate.guests - pricingConfig.baseGuests);
  const lines = [
    `Price estimate (${estimate.nights} night${estimate.nights === 1 ? "" : "s"} · ${estimate.guests} guest${estimate.guests === 1 ? "" : "s"}):`,
    `Booking.com base rate (${pricingConfig.baseGuests} guest${pricingConfig.baseGuests === 1 ? "" : "s"}): ${formatEstimateCurrency(estimate.baseTotal)}`
  ];

  if (estimate.extraGuestTotal > 0) {
    lines.push(
      `Extra guests (${extraGuests} × ${formatEstimateCurrency(pricingConfig.additionalGuestPerNightEUR)} × ${estimate.nights} night${estimate.nights === 1 ? "" : "s"}): +${formatEstimateCurrency(estimate.extraGuestTotal)}`
    );
  }
  if (estimate.directBookingDiscountTotal > 0) {
    lines.push(
      `Direct booking discount (${pricingConfig.discountPercent}%): −${formatEstimateCurrency(estimate.directBookingDiscountTotal)}`
    );
  }
  if (estimate.weeklyDiscountTotal > 0) {
    lines.push(
      `Weekly discount (${pricingConfig.weeklyDiscountPercent}%): −${formatEstimateCurrency(estimate.weeklyDiscountTotal)}`
    );
  }
  if (estimate.oneNightSurchargeTotal > 0) {
    lines.push(
      `One-night surcharge (${pricingConfig.oneNightSurchargePercent}%): +${formatEstimateCurrency(estimate.oneNightSurchargeTotal)}`
    );
  }

  lines.push(`Estimated stay total: ${formatEstimateCurrency(estimate.total)}`);
  return lines;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInVilnius() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hasUnavailableNight(checkin, checkout, unavailableDates) {
  const cursor = new Date(`${checkin}T00:00:00Z`);
  const end = new Date(`${checkout}T00:00:00Z`);
  while (cursor < end) {
    if (unavailableDates.has(cursor.toISOString().slice(0, 10))) return true;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

async function submitBooking(request, env, origin) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return bookingResponse({ error: "Could not verify request origin" }, 400, origin);
  if (!env.BOOKING_RATE_LIMITER) {
    console.error("Booking rate limiter binding is missing");
    return bookingResponse({ error: "Booking requests are temporarily unavailable" }, 503, origin);
  }

  try {
    const { success } = await env.BOOKING_RATE_LIMITER.limit({ key: ip });
    if (!success) return bookingResponse({ error: "Too many requests. Please try again in a minute." }, 429, origin);
  } catch (error) {
    console.error("Booking rate limiter failed:", error.message);
    return bookingResponse({ error: "Booking requests are temporarily unavailable" }, 503, origin);
  }

  if (Number(request.headers.get("Content-Length")) > 8192) {
    return bookingResponse({ error: "Booking request is too large" }, 413, origin);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return bookingResponse({ error: "Expected a JSON booking request" }, 415, origin);
  }

  let booking;
  try {
    const body = await request.text();
    if (body.length > 8192) {
      return bookingResponse({ error: "Booking request is too large" }, 413, origin);
    }
    booking = JSON.parse(body);
  } catch {
    return bookingResponse({ error: "Invalid booking request" }, 400, origin);
  }
  if (!booking || typeof booking !== "object" || Array.isArray(booking)) {
    return bookingResponse({ error: "Invalid booking request" }, 400, origin);
  }
  if (typeof booking.website === "string" && booking.website.trim()) {
    return bookingResponse({ ok: true }, 200, origin);
  }

  const propertyId = booking.propertyId === undefined ? "smolensko-35" : booking.propertyId;
  if (typeof propertyId !== "string" || !Object.prototype.hasOwnProperty.call(PROPERTIES, propertyId)) {
    return bookingResponse({ error: "Please choose a valid apartment." }, 400, origin);
  }
  const property = PROPERTIES[propertyId];

  const name = typeof booking.name === "string" ? cleanField(booking.name, 100) : "";
  const email = typeof booking.email === "string" ? cleanField(booking.email, 254) : "";
  const phone = typeof booking.phone === "string" ? cleanField(booking.phone, 40) : "";
  const checkin = typeof booking.checkin === "string" ? booking.checkin : "";
  const checkout = typeof booking.checkout === "string" ? booking.checkout : "";
  const adults = booking.adults !== undefined
    ? Number(booking.adults)
    : Number(booking.guests);
  const children = booking.children !== undefined
    ? Number(booking.children)
    : 0;
  const message = typeof booking.message === "string" ? cleanField(booking.message, 300) : "";

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 5 ||
      (typeof booking.message === "string" && booking.message.length > 300) ||
      !Number.isInteger(adults) || adults < 1 || adults > 4 ||
      !Number.isInteger(children) || children < 0 || children > 3 || adults + children > 4 ||
      !isValidDate(checkin) || !isValidDate(checkout) || checkout <= checkin) {
    return bookingResponse({ error: "Please check your name, email, phone, guest counts (maximum 4 total) and dates." }, 400, origin);
  }
  if (checkin < dateInVilnius()) {
    return bookingResponse({ error: "Check-in date must not be in the past." }, 400, origin);
  }

  const nights = (Date.parse(`${checkout}T00:00:00Z`) -
    Date.parse(`${checkin}T00:00:00Z`)) / 86400000;
  const hasPriceEstimate = booking.priceEstimate !== undefined &&
    booking.priceEstimate !== null;
  const priceEstimate = hasPriceEstimate ? booking.priceEstimate : null;
  if (hasPriceEstimate && (
    propertyId !== PRICING_SUPPORTED_PROPERTY ||
    !validatePriceEstimate(priceEstimate, nights, adults + children)
  )) {
    return bookingResponse({ error: "The price estimate is invalid. Please refresh the page and try again." }, 400, origin);
  }

  let unavailableDates;
  try {
    unavailableDates = new Set(await getUnavailableDates(env, propertyId));
  } catch (error) {
    console.error("Could not verify booking dates:", error.message);
    return bookingResponse({ error: "Availability could not be verified. Please try again shortly." }, 502, origin);
  }
  if (hasUnavailableNight(checkin, checkout, unavailableDates)) {
    return bookingResponse({ error: "Those dates are no longer available. Please choose another date range." }, 409, origin);
  }
  if (!env.TELEGRAM_BOT_TOKEN || !/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN) ||
      !env.TELEGRAM_CHAT_ID || !/^-?\d+$/.test(env.TELEGRAM_CHAT_ID)) {
    console.error("Telegram bot token or chat ID secret is missing or invalid");
    return bookingResponse({ error: "Booking notifications are not configured yet. Please try again later." }, 503, origin);
  }

  const telegramMessage = [
    `New booking request — ${property.name}`,
    `Property: ${property.name}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Check-in: ${checkin}`,
    `Check-out: ${checkout}`,
    `Adults: ${adults}`,
    `Children: ${children}`,
    `Total guests: ${adults + children}`,
    `Message: ${message || "(none)"}`,
    ...(priceEstimate ? ["", ...formatPriceEstimateLines(priceEstimate)] : [])
  ].join("\n");

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: telegramMessage }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await telegramResponse.json();
    if (!telegramResponse.ok || !result.ok) {
      console.error("Telegram rejected booking notification:", telegramResponse.status);
      return bookingResponse({ error: "We could not deliver your request. Please try again later." }, 502, origin);
    }
  } catch (error) {
    console.error("Telegram booking notification failed:", error.message);
    return bookingResponse({ error: "We could not deliver your request. Please try again later." }, 502, origin);
  }

  return bookingResponse({ ok: true, message: "Your request was sent. We’ll contact you soon." }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: "Origin is not allowed" }, 403, null);
    }
    if (url.pathname !== "/api/calendar" &&
        url.pathname !== "/api/prices" &&
        url.pathname !== "/api/booking") {
      return jsonResponse({ error: "Not found" }, 404, origin);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname === "/api/booking" && request.method === "POST") {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return jsonResponse({ error: "Origin is not allowed" }, 403, null);
      }
      return submitBooking(request, env, origin);
    }
    if ((url.pathname === "/api/calendar" || url.pathname === "/api/prices") &&
        request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    const propertyId = url.searchParams.get("propertyId") || "smolensko-35";
    if (!Object.prototype.hasOwnProperty.call(PROPERTIES, propertyId)) {
      return jsonResponse({ error: "Unknown property" }, 400, origin);
    }

    if (url.pathname === "/api/prices") {
      try {
        if (propertyId === PRICING_SUPPORTED_PROPERTY && !validatePricingConfig(pricingConfig)) {
          throw new Error("Pricing configuration is invalid");
        }
        const prices = await getBookingPrices(propertyId);
        const pricingSupported = propertyId === PRICING_SUPPORTED_PROPERTY;
        return jsonResponse({
          propertyId,
          pricingSupported,
          prices,
          pricingConfig: pricingSupported ? pricingConfig : null,
          updatedAt: new Date().toISOString()
        }, 200, origin);
      } catch (error) {
        console.error("Booking.com price request failed:", error.message);
        return jsonResponse({ error: "Could not load Booking.com prices." }, 502, origin);
      }
    }

    try {
      const unavailableDates = await getUnavailableDates(env, propertyId);
      return jsonResponse({
        propertyId,
        unavailableDates,
        updatedAt: new Date().toISOString()
      }, 200, origin);
    } catch (error) {
      console.error("Calendar availability request failed:", error.message);
      return jsonResponse({
        error: "Could not load both calendar feeds. Check the Worker secrets and calendar feed availability."
      }, 502, origin);
    }
  }
};
