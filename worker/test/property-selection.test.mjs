import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const pricingConfig = JSON.parse(
  await readFile(new URL("../src/pricing-config.json", import.meta.url), "utf8")
);
const bundledSource = source.replace(
  'import pricingConfig from "./pricing-config.json";',
  `const pricingConfig = ${JSON.stringify(pricingConfig)};`
);
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundledSource).toString("base64")}`
);

function makeCalendar(start, end) {
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function makeEnv() {
  return {
    BOOKING_ICAL_URL: "https://ical.booking.com/smolensko.ics",
    AIRBNB_ICAL_URL: "https://www.airbnb.com/calendar/smolensko.ics",
    KAVOL_BOOK_ICAL_URL: "https://ical.booking.com/kavoliuko.ics",
    KAVOL_AIRBNB_ICAL_URL: "https://www.airbnb.com/calendar/kavoliuko.ics",
    TELEGRAM_BOT_TOKEN: "123:test-token",
    TELEGRAM_CHAT_ID: "12345",
    BOOKING_RATE_LIMITER: {
      limit: async () => ({ success: true })
    }
  };
}

function makeRequest(path, { method = "GET", body, origin = "https://mmt.lt" } = {}) {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: {
      Origin: origin,
      "CF-Connecting-IP": "203.0.113.1",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function withMockedFetch(t, mockFetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("calendar requests use only the selected property's two feeds", async (t) => {
  const requestedUrls = [];
  await withMockedFetch(t, async (input) => {
    const url = new URL(input);
    requestedUrls.push(url.href);
    if (url.pathname.includes("smolensko")) {
      return new Response(makeCalendar("20300101", "20300102"));
    }
    return new Response(makeCalendar("20400101", "20400102"));
  });

  const env = makeEnv();
  const smolensko = await worker.fetch(makeRequest("/api/calendar"), env);
  const smolenskoBody = await smolensko.json();
  assert.equal(smolensko.status, 200);
  assert.equal(smolenskoBody.propertyId, "smolensko-35");
  assert.deepEqual(smolenskoBody.unavailableDates, ["2030-01-01"]);

  requestedUrls.length = 0;
  const kavoliuko = await worker.fetch(
    makeRequest("/api/calendar?propertyId=kavoliuko-14"),
    env
  );
  const kavoliukoBody = await kavoliuko.json();
  assert.equal(kavoliuko.status, 200);
  assert.equal(kavoliukoBody.propertyId, "kavoliuko-14");
  assert.deepEqual(kavoliukoBody.unavailableDates, ["2040-01-01"]);
  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls.every((url) => url.includes("kavoliuko.ics")));
});

test("price requests return only available positive nightly rates for Smolensko", async (t) => {
  const requests = [];
  await withMockedFetch(t, async (input, init) => {
    const url = new URL(input);
    assert.equal(url.hostname, "www.booking.com");
    const payload = JSON.parse(init.body);
    const { startDate, amountOfDays } = payload.variables.input.searchConfig.searchConfigDate;
    requests.push({ url, payload, startDate, amountOfDays });

    const nextDate = new Date(`${startDate}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateKey = nextDate.toISOString().slice(0, 10);
    return new Response(JSON.stringify({
      data: {
        availabilityCalendar: {
          hotelId: 17547944,
          days: [
            { checkin: startDate, available: true, avgPriceFormatted: "€\u00a094" },
            { checkin: nextDateKey, available: false, avgPriceFormatted: "€\u00a0100" },
            { checkin: nextDateKey, available: true, avgPriceFormatted: "€\u00a00" }
          ]
        }
      }
    }));
  });

  const response = await worker.fetch(
    makeRequest("/api/prices?propertyId=smolensko-35"),
    makeEnv()
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.propertyId, "smolensko-35");
  assert.equal(body.pricingSupported, true);
  assert.deepEqual(body.pricingConfig, pricingConfig);
  assert.ok(requests.length >= 2 && requests.length <= 3);
  assert.ok(requests.every(({ url, payload, amountOfDays }) =>
    payload.variables.input.searchConfig.nbAdults === 1 &&
    url.searchParams.get("group_adults") === "1" &&
    amountOfDays > 0 &&
    amountOfDays <= 61
  ));
  for (const { startDate } of requests) {
    assert.equal(body.prices[startDate], 94);
    const nextDate = new Date(`${startDate}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    assert.equal(body.prices[nextDate.toISOString().slice(0, 10)], undefined);
  }
});

test("Kavoliuko booking notifications identify the selected apartment", async (t) => {
  const requestedUrls = [];
  let telegramMessage = "";
  await withMockedFetch(t, async (input, init) => {
    const url = new URL(input);
    requestedUrls.push(url.href);
    if (url.hostname === "api.telegram.org") {
      telegramMessage = JSON.parse(init.body).text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
  });

  const booking = {
    propertyId: "kavoliuko-14",
    name: "Test Guest",
    email: "guest@example.com",
    phone: "+37060000000",
    checkin: "2099-01-01",
    checkout: "2099-01-02",
    adults: 2,
    children: 0,
    message: "",
    website: ""
  };
  const response = await worker.fetch(
    makeRequest("/api/booking", { method: "POST", body: booking }),
    makeEnv()
  );

  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(requestedUrls.some((url) => url.includes("kavoliuko.ics")));
  assert.ok(requestedUrls.every((url) => !url.includes("smolensko.ics")));
  assert.match(telegramMessage, /New booking request — Kavoliuko 14/);
  assert.match(telegramMessage, /Property: Kavoliuko 14/);
});

test("unknown property IDs are rejected without fetching feeds", async (t) => {
  let fetchCount = 0;
  await withMockedFetch(t, async () => {
    fetchCount += 1;
    throw new Error("Unexpected external request");
  });

  const response = await worker.fetch(
    makeRequest("/api/calendar?propertyId=unknown-property"),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.equal(fetchCount, 0);

  const bookingResponse = await worker.fetch(
    makeRequest("/api/booking", {
      method: "POST",
      body: { propertyId: "unknown-property", website: "" }
    }),
    makeEnv()
  );
  assert.equal(bookingResponse.status, 400);
  assert.equal(fetchCount, 0);
});
