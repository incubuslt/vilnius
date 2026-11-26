"use strict";

const properties = new Map([
  ["smolensko-35", { name: "Smolensko 35", pricingSupported: true }],
  ["kavoliuko-14", { name: "Kavoliuko 14" }]
]);
const calendarApiUrl = "https://smolensko-calendar-api.vilnius-mmt.workers.dev/api/calendar";
const pricesApiUrl = "https://smolensko-calendar-api.vilnius-mmt.workers.dev/api/prices";
const bookingApiUrl = "https://smolensko-calendar-api.vilnius-mmt.workers.dev/api/booking";

const state = {
  propertyId: "smolensko-35",
  unavailableDates: null,
  prices: null,
  pricingConfig: null,
  pricingSupported: true,
  pricingLoading: true,
  pricingError: "",
  calendarLoading: true,
  calendarError: "",
  calendarRequestId: 0,
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  checkin: "",
  checkout: ""
};

document.documentElement.dataset.property = state.propertyId;

const elements = {
  propertyTabs: [...document.querySelectorAll("[data-property-id]")],
  bookingPanel: document.getElementById("booking-panel"),
  calendarHeading: document.getElementById("calendar-heading"),
  calendarDays: document.getElementById("calendar-days"),
  calendarStatus: document.getElementById("calendar-status"),
  calendarPriceNote: document.getElementById("calendar-price-note"),
  monthTitle: document.getElementById("month-title"),
  previousMonth: document.getElementById("previous-month"),
  nextMonth: document.getElementById("next-month"),
  checkinSummary: document.getElementById("checkin-summary"),
  checkoutSummary: document.getElementById("checkout-summary"),
  priceSummary: document.getElementById("price-summary"),
  priceTotal: document.getElementById("price-total"),
  priceMeta: document.getElementById("price-meta"),
  priceDetails: document.getElementById("price-details"),
  checkinInput: document.getElementById("checkin-input"),
  checkoutInput: document.getElementById("checkout-input"),
  adultCount: document.getElementById("adult-count"),
  childCount: document.getElementById("child-count"),
  message: document.getElementById("guest-message"),
  messageCharacterCount: document.getElementById("message-character-count"),
  form: document.getElementById("booking-form"),
  feedback: document.getElementById("form-feedback")
};

async function loadPrices(propertyId, requestId) {
  const property = properties.get(propertyId);
  state.pricingSupported = Boolean(property.pricingSupported);
  state.prices = property.pricingSupported ? null : {};
  state.pricingConfig = null;
  state.pricingLoading = Boolean(property.pricingSupported);
  state.pricingError = "";
  renderCalendar();
  if (!property.pricingSupported) return;

  try {
    const url = new URL(pricesApiUrl);
    url.searchParams.set("propertyId", propertyId);
    url.searchParams.set("v", "3");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Price service returned HTTP ${response.status}`);
    const result = await response.json();
    const prices = result.prices;
    const config = result.pricingConfig;
    if (result.propertyId !== propertyId ||
        result.pricingSupported !== true ||
        !prices ||
        typeof prices !== "object" ||
        Array.isArray(prices) ||
        !isValidPricingConfig(config) ||
        !Object.entries(prices).every(([date, price]) =>
          /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0
        )) {
      throw new Error("Price service returned invalid pricing data");
    }
    if (requestId !== state.calendarRequestId) return;
    state.prices = prices;
    state.pricingConfig = config;
  } catch (error) {
    if (requestId !== state.calendarRequestId) return;
    console.error(`Unable to load Booking.com prices for ${property.name}:`, error);
    state.prices = {};
    state.pricingConfig = null;
    state.pricingError = "Booking.com prices could not be loaded. Rates are temporarily unavailable.";
  } finally {
    if (requestId === state.calendarRequestId) {
      state.pricingLoading = false;
      renderCalendar();
    }
  }
}

function isValidPricingConfig(config) {
  return Boolean(config) &&
    Number.isInteger(config.baseGuests) &&
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

// Use local calendar dates for the visible booking dates, avoiding UTC date drift.
function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value) {
  if (!value) return "Select a date";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(parseDateKey(value));
}

function getGuestCount() {
  const selectedAdults = Number(elements.adultCount.value);
  const adults = Number.isInteger(selectedAdults) && selectedAdults >= 1
    ? selectedAdults
    : state.pricingConfig?.baseGuests || 1;
  return adults + Number(elements.childCount.value || 0);
}

function formatCurrency(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getNightlyPrice(basePrice, guestCount) {
  if (!state.pricingConfig) return basePrice;
  const extraGuests = Math.max(0, guestCount - state.pricingConfig.baseGuests);
  const priceWithGuestFees =
    basePrice + extraGuests * state.pricingConfig.additionalGuestPerNightEUR;
  return roundCurrency(
    priceWithGuestFees * (1 - state.pricingConfig.discountPercent / 100)
  );
}

function calculateStayPrice(checkin, checkout, guestCount) {
  if (!state.prices || !state.pricingConfig || !checkin || !checkout) return null;

  const cursor = parseDateKey(checkin);
  const end = parseDateKey(checkout);
  let baseTotal = 0;
  let discountedNightlyTotal = 0;
  let nights = 0;
  const extraGuests = Math.max(0, guestCount - state.pricingConfig.baseGuests);
  while (cursor < end) {
    const basePrice = state.prices[toDateKey(cursor)];
    if (!Number.isFinite(basePrice) || basePrice <= 0) return null;
    baseTotal += basePrice;
    discountedNightlyTotal += getNightlyPrice(basePrice, guestCount);
    nights += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  const extraGuestTotal = roundCurrency(
    extraGuests * state.pricingConfig.additionalGuestPerNightEUR * nights
  );
  const standardDiscountTotal = roundCurrency(
    baseTotal + extraGuestTotal - discountedNightlyTotal
  );
  let weeklyDiscountTotal = 0;
  let oneNightSurchargeTotal = 0;
  if (nights === 1) {
    oneNightSurchargeTotal = roundCurrency(
      discountedNightlyTotal * state.pricingConfig.oneNightSurchargePercent / 100
    );
  } else if (nights >= state.pricingConfig.weeklyDiscountMinimumNights) {
    weeklyDiscountTotal = roundCurrency(
      discountedNightlyTotal * state.pricingConfig.weeklyDiscountPercent / 100
    );
  }

  const total = roundCurrency(
    discountedNightlyTotal - weeklyDiscountTotal + oneNightSurchargeTotal
  );
  return {
    nights,
    extraGuests,
    baseTotal: roundCurrency(baseTotal),
    extraGuestTotal,
    standardDiscountTotal,
    weeklyDiscountTotal,
    oneNightSurchargeTotal,
    total
  };
}

function getBookingWindow() {
  const today = new Date();
  const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const lastDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
  const lastCheckin = new Date(lastDate);
  lastCheckin.setDate(lastCheckin.getDate() - 1);

  return {
    firstMonth,
    lastMonth,
    lastDateKey: toDateKey(lastDate),
    lastCheckinKey: toDateKey(lastCheckin)
  };
}

async function loadCalendar() {
  const requestId = ++state.calendarRequestId;
  const propertyId = state.propertyId;
  state.calendarLoading = true;
  state.calendarError = "";
  void loadPrices(propertyId, requestId);
  renderCalendar();
  try {
    const url = new URL(calendarApiUrl);
    url.searchParams.set("propertyId", propertyId);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Calendar service returned HTTP ${response.status}`);
    const calendar = await response.json();
    if (requestId !== state.calendarRequestId) return;
    if (calendar.propertyId !== propertyId ||
        !Array.isArray(calendar.unavailableDates) ||
        !calendar.unavailableDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error("Calendar service returned invalid availability data");
    }
    state.unavailableDates = new Set(calendar.unavailableDates);
  } catch (error) {
    if (requestId !== state.calendarRequestId) return;
    console.error(`Unable to load all availability calendars for ${properties.get(propertyId).name}:`, error);
    state.calendarError = "Availability could not be loaded. Please try again later.";
  } finally {
    if (requestId === state.calendarRequestId) {
      state.calendarLoading = false;
      renderCalendar();
    }
  }
}

function isPast(dateKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateKey(dateKey) < today;
}

function rangeHasUnavailableNight(checkin, checkout, unavailable) {
  const cursor = new Date(parseDateKey(checkin));
  while (toDateKey(cursor) < checkout) {
    if (unavailable.has(toDateKey(cursor))) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

function renderCalendar() {
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  const bookingWindow = getBookingWindow();
  const todayKey = toDateKey(new Date());
  elements.monthTitle.textContent = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(state.month);
  elements.previousMonth.disabled = state.month <= bookingWindow.firstMonth;
  elements.nextMonth.disabled = state.month >= bookingWindow.lastMonth;

  const unavailable = state.unavailableDates;
  if (state.calendarError) {
    elements.calendarStatus.textContent = state.calendarError;
    elements.calendarStatus.className = "calendar-status error";
  } else if (state.calendarLoading || !unavailable) {
    elements.calendarStatus.textContent = "Loading availability. Dates stay disabled until the calendar is checked.";
    elements.calendarStatus.className = "calendar-status";
  } else {
    const unavailableCount = [...unavailable].filter((date) =>
      date >= todayKey && date <= bookingWindow.lastDateKey
    ).length;
    elements.calendarStatus.textContent =
      `${unavailableCount} unavailable date${unavailableCount === 1 ? "" : "s"} synced from both calendars. ` +
      `Requests through ${formatDate(bookingWindow.lastDateKey)}.`;
    elements.calendarStatus.className = "calendar-status success";
  }

  elements.calendarPriceNote.hidden = !state.pricingSupported;
  if (state.pricingError) {
    elements.calendarPriceNote.textContent = state.pricingError;
  } else if (state.pricingLoading) {
    elements.calendarPriceNote.textContent = "Loading Booking.com rates…";
  } else if (state.pricingSupported) {
    const guestCount = getGuestCount();
    const extraGuestPrice = state.pricingConfig.additionalGuestPerNightEUR;
    elements.calendarPriceNote.textContent =
      `Rates shown for ${guestCount} guest${guestCount === 1 ? "" : "s"}; ` +
      `${formatCurrency(extraGuestPrice)} per extra guest/night. Stay adjustments appear in the estimate.`;
  } else {
    elements.calendarPriceNote.textContent = "";
  }

  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  let html = "";

  for (let index = 0; index < cellCount; index += 1) {
    const dayNumber = index - mondayOffset + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      html += '<span class="day outside" aria-hidden="true"></span>';
      continue;
    }
    const date = new Date(year, month, dayNumber);
    const key = toDateKey(date);
    const booked = unavailable ? unavailable.has(key) : false;
    const past = isPast(key);
    const outsideWindow = key > bookingWindow.lastDateKey;
    const selected = key === state.checkin || key === state.checkout;
    const inRange = state.checkin && state.checkout && key > state.checkin && key < state.checkout;
    const unknown = !unavailable;
    const startsNewSelection = !state.checkin || Boolean(state.checkout) || key <= state.checkin;
    const checkoutOnly = key === bookingWindow.lastDateKey && startsNewSelection;
    const disabled = past || booked || unknown || outsideWindow || checkoutOnly;
    const basePrice = state.prices && state.prices[key];
    const price = Number.isFinite(basePrice) && state.pricingConfig
      ? getNightlyPrice(basePrice, getGuestCount())
      : basePrice;
    const priceText = Number.isFinite(price) && price > 0
      ? formatCurrency(price, 0)
      : "";
    const classes = ["day"];
    if (booked) classes.push("booked");
    if (past) classes.push("past");
    if (outsideWindow || checkoutOnly) classes.push("outside-window");
    if (selected) classes.push("selected");
    else if (inRange) classes.push("in-range");
    if (unknown && !past) classes.push("unknown");
    const availabilityLabel = booked
      ? "booked"
      : past
        ? "past"
        : outsideWindow
          ? "outside the booking window"
          : checkoutOnly
            ? "available for check-out only"
            : unknown
              ? "availability not loaded"
              : "available";
    const priceLabel = priceText
      ? `, ${priceText} per night for ${getGuestCount()} guest${getGuestCount() === 1 ? "" : "s"}`
      : "";
    const label = `${formatDate(key)}, ${availabilityLabel}${priceLabel}`;
    html += `<button class="${classes.join(" ")}" type="button" data-date="${key}" aria-label="${label}"${disabled ? " disabled" : ""}${selected ? ' aria-pressed="true"' : ""}><span class="day-number">${dayNumber}</span>${priceText ? `<span class="day-price">${priceText}</span>` : ""}</button>`;
  }
  elements.calendarDays.innerHTML = html;
  elements.calendarDays.querySelectorAll("[data-date]:not(:disabled)").forEach((button) => {
    button.addEventListener("click", () => selectDate(button.dataset.date));
  });
  elements.checkinSummary.textContent = formatDate(state.checkin);
  elements.checkoutSummary.textContent = formatDate(state.checkout);
  renderPriceSummary();
  elements.checkinInput.value = state.checkin;
  elements.checkoutInput.value = state.checkout;
  elements.checkinInput.min = todayKey;
  elements.checkinInput.max = bookingWindow.lastCheckinKey;
  elements.checkoutInput.min = state.checkin || todayKey;
  elements.checkoutInput.max = bookingWindow.lastDateKey;
}

function renderPriceSummary() {
  elements.priceSummary.hidden = !state.pricingSupported;
  if (!state.pricingSupported) return;

  if (!state.checkin || !state.checkout) {
    elements.priceTotal.textContent = "Select dates";
    elements.priceMeta.textContent = "Choose check-in and check-out to see your estimate.";
    elements.priceDetails.replaceChildren();
    return;
  }

  if (state.pricingLoading) {
    elements.priceTotal.textContent = "Loading…";
    elements.priceMeta.textContent = "Fetching nightly rates.";
    elements.priceDetails.replaceChildren();
    return;
  }
  if (state.pricingError || !state.pricingConfig) {
    elements.priceTotal.textContent = "Temporarily unavailable";
    elements.priceMeta.textContent = "Booking.com rates could not be loaded.";
    elements.priceDetails.replaceChildren();
    return;
  }

  const guestCount = getGuestCount();
  const estimate = calculateStayPrice(state.checkin, state.checkout, guestCount);
  if (!estimate) {
    elements.priceTotal.textContent = "Price unavailable";
    elements.priceMeta.textContent = "A Booking.com rate is missing for one or more selected nights.";
    elements.priceDetails.replaceChildren();
    return;
  }

  elements.priceTotal.textContent = formatCurrency(estimate.total, 0);
  elements.priceMeta.textContent =
    `${estimate.nights} night${estimate.nights === 1 ? "" : "s"} · ` +
    `${guestCount} guest${guestCount === 1 ? "" : "s"}`;
  const rows = [{
    label: `Booking.com base rate (${state.pricingConfig.baseGuests} guest${state.pricingConfig.baseGuests === 1 ? "" : "s"})`,
    amount: estimate.baseTotal
  }];
  if (estimate.extraGuestTotal > 0) {
    rows.push({
      label: `Extra guests (${estimate.extraGuests} × ${formatCurrency(state.pricingConfig.additionalGuestPerNightEUR)} × ${estimate.nights} night${estimate.nights === 1 ? "" : "s"})`,
      amount: estimate.extraGuestTotal,
      prefix: "+"
    });
  }
  if (estimate.standardDiscountTotal > 0) {
    rows.push({
      label: `Direct booking discount (${state.pricingConfig.discountPercent}%)`,
      amount: estimate.standardDiscountTotal,
      prefix: "−"
    });
  }
  if (estimate.weeklyDiscountTotal > 0) {
    rows.push({
      label: `Weekly discount (${state.pricingConfig.weeklyDiscountPercent}%)`,
      amount: estimate.weeklyDiscountTotal,
      prefix: "−"
    });
  }
  if (estimate.oneNightSurchargeTotal > 0) {
    rows.push({
      label: `One-night surcharge (${state.pricingConfig.oneNightSurchargePercent}%)`,
      amount: estimate.oneNightSurchargeTotal,
      prefix: "+"
    });
  }

  elements.priceDetails.replaceChildren();
  for (const rowData of rows) {
    const row = document.createElement("div");
    row.className = "price-detail-row";
    const label = document.createElement("span");
    label.textContent = rowData.label;
    const amount = document.createElement("span");
    amount.textContent = `${rowData.prefix || ""}${formatCurrency(rowData.amount, 0)}`;
    row.append(label, amount);
    elements.priceDetails.appendChild(row);
  }
}

function selectDate(dateKey) {
  const unavailable = state.unavailableDates;
  const bookingWindow = getBookingWindow();
  if (!unavailable || unavailable.has(dateKey) || isPast(dateKey) || dateKey > bookingWindow.lastDateKey) return;

  const startsNewSelection = !state.checkin || Boolean(state.checkout) || dateKey <= state.checkin;
  if (startsNewSelection && dateKey > bookingWindow.lastCheckinKey) return;

  if (startsNewSelection) {
    state.checkin = dateKey;
    state.checkout = "";
  } else {
    if (rangeHasUnavailableNight(state.checkin, dateKey, unavailable)) {
      state.checkin = dateKey;
      state.checkout = "";
    } else {
      state.checkout = dateKey;
    }
  }
  elements.feedback.classList.remove("visible");
  renderCalendar();
}

function changeMonth(offset) {
  const bookingWindow = getBookingWindow();
  const nextMonth = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1);
  if (nextMonth < bookingWindow.firstMonth || nextMonth > bookingWindow.lastMonth) return;

  state.month = nextMonth;
  renderCalendar();
}

function setActiveProperty(propertyId) {
  const property = properties.get(propertyId);
  if (!property || propertyId === state.propertyId) return;

  state.propertyId = propertyId;
  document.documentElement.dataset.property = propertyId;
  state.unavailableDates = null;
  state.prices = null;
  state.pricingConfig = null;
  state.pricingSupported = Boolean(property.pricingSupported);
  state.pricingLoading = Boolean(property.pricingSupported);
  state.pricingError = "";
  state.calendarError = "";
  state.checkin = "";
  state.checkout = "";
  elements.calendarHeading.textContent = `${property.name} availability`;
  elements.bookingPanel.setAttribute(
    "aria-labelledby",
    elements.propertyTabs.find((tab) => tab.dataset.propertyId === propertyId).id
  );
  elements.propertyTabs.forEach((tab) => {
    const selected = tab.dataset.propertyId === propertyId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.title = `${property.name} | Stay in Vilnius`;
  elements.feedback.classList.remove("visible");
  loadCalendar();
}

function validateGuestCounts() {
  const adults = Number(elements.adultCount.value);
  elements.adultCount.classList.toggle("has-selection", Boolean(elements.adultCount.value));
  const previousChildren = Number(elements.childCount.value || 0);
  const maximumChildren = 4 - adults;
  const allowedChildren = maximumChildren >= 0 ? maximumChildren : 0;

  const currentChildren = previousChildren <= allowedChildren ? previousChildren : 0;
  elements.childCount.innerHTML = "";

  for (let count = 0; count <= allowedChildren; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = count === 0 ? "No children" : `${count} ${count === 1 ? "child" : "children"}`;
    option.selected = count === currentChildren;
    elements.childCount.appendChild(option);
  }

  elements.childCount.disabled = allowedChildren === 0;
  const children = Number(elements.childCount.value);
  const valid = Number.isInteger(adults) && adults >= 1 && adults <= 4 &&
    Number.isInteger(children) && children >= 0 && children <= 3 &&
    adults + children <= 4;
  const message = valid ? "" : "The total number of adults and children cannot exceed 4.";
  elements.adultCount.setCustomValidity(message);
  elements.childCount.setCustomValidity(message);
}

async function submitBooking(event) {
  event.preventDefault();
  const propertyId = state.propertyId;
  const formData = new FormData(elements.form);
  const checkin = String(formData.get("checkin") || "");
  const checkout = String(formData.get("checkout") || "");
  const adults = Number(formData.get("adults"));
  const children = Number(formData.get("children"));
  const message = String(formData.get("message") || "");
  const unavailable = state.unavailableDates;
  const bookingWindow = getBookingWindow();

  if (message.length > 300) {
    showFormMessage("Please keep your message to 300 characters or fewer.", true);
    return;
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 4 ||
      !Number.isInteger(children) || children < 0 || children > 3 ||
      adults + children > 4) {
    showFormMessage("The total number of adults and children cannot exceed 4.", true);
    return;
  }
  if (!unavailable) {
    showFormMessage("Availability is not loaded, so we can’t verify the selected dates yet. Please try again later.", true);
    return;
  }
  if (!checkin || !checkout || checkout <= checkin) {
    showFormMessage("Please select a valid check-in and a later check-out date.", true);
    return;
  }
  if (checkin > bookingWindow.lastCheckinKey || checkout > bookingWindow.lastDateKey) {
    showFormMessage(`Please choose dates within the current booking window, through ${formatDate(bookingWindow.lastDateKey)}.`, true);
    return;
  }
  if (rangeHasUnavailableNight(checkin, checkout, unavailable)) {
    showFormMessage("Those dates include an unavailable night. Please choose another date range.", true);
    return;
  }

  const submitButton = elements.form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  elements.propertyTabs.forEach((tab) => {
    tab.disabled = true;
  });
  showFormMessage("Sending your request securely…");

  try {
    const response = await fetch(bookingApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(formData.entries()),
        propertyId,
        guests: adults + children
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We could not send your request. Please try again.");

    elements.form.reset();
    state.checkin = "";
    state.checkout = "";
    renderCalendar();
    showFormMessage(result.message || "Your request was sent. We’ll contact you soon.");
  } catch (error) {
    console.error("Unable to submit booking request:", error);
    showFormMessage(error.message || "We could not send your request. Please try again later.", true);
  } finally {
    submitButton.disabled = false;
    elements.propertyTabs.forEach((tab) => {
      tab.disabled = false;
    });
  }
}

function showFormMessage(message, isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.classList.add("visible");
  elements.feedback.style.color = isError ? "#963c3c" : "";
  elements.feedback.style.background = isError ? "var(--red-soft)" : "";
}

elements.previousMonth.addEventListener("click", () => changeMonth(-1));
elements.nextMonth.addEventListener("click", () => changeMonth(1));
elements.form.addEventListener("submit", submitBooking);
elements.propertyTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveProperty(tab.dataset.propertyId));
  tab.addEventListener("keydown", (event) => {
    const currentIndex = elements.propertyTabs.indexOf(tab);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % elements.propertyTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + elements.propertyTabs.length) % elements.propertyTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = elements.propertyTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = elements.propertyTabs[nextIndex];
    nextTab.focus();
    setActiveProperty(nextTab.dataset.propertyId);
  });
});
elements.adultCount.addEventListener("change", () => {
  validateGuestCounts();
  renderCalendar();
});
elements.childCount.addEventListener("change", () => {
  validateGuestCounts();
  renderCalendar();
});
elements.message.addEventListener("input", () => {
  if (elements.message.value.length > 300) {
    elements.message.value = elements.message.value.slice(0, 300);
  }
  elements.messageCharacterCount.textContent = `${elements.message.value.length} / 300`;
});

for (const input of [elements.checkinInput, elements.checkoutInput]) {
  input.addEventListener("change", () => {
    const { checkin, checkout } = elements.form.elements;
    const unavailable = state.unavailableDates;
    if (!unavailable) {
      showFormMessage("Availability is not loaded. Please try again later.", true);
      input.value = "";
      return;
    }
    const bookingWindow = getBookingWindow();
    if (input.value && (
      input.value > bookingWindow.lastDateKey ||
      (input === elements.checkinInput && input.value > bookingWindow.lastCheckinKey)
    )) {
      showFormMessage(`Please choose dates within the current booking window, through ${formatDate(bookingWindow.lastDateKey)}.`, true);
      input.value = "";
      return;
    }
    if (input.value && (unavailable.has(input.value) || isPast(input.value))) {
      showFormMessage("That date is unavailable. Please choose a green date from the calendar.", true);
      input.value = "";
      return;
    }
    if (checkin.value && checkout.value && checkout.value <= checkin.value) {
      showFormMessage("Check-out must be later than check-in.", true);
      if (input === elements.checkoutInput) elements.checkoutInput.value = "";
      else elements.checkinInput.value = "";
      return;
    }
    if (checkin.value && checkout.value && rangeHasUnavailableNight(checkin.value, checkout.value, unavailable)) {
      showFormMessage("Your date range includes an unavailable night. Please choose different dates.", true);
      if (input === elements.checkoutInput) elements.checkoutInput.value = "";
      else elements.checkinInput.value = "";
      return;
    }
    state.checkin = checkin.value;
    state.checkout = checkout.value;
    renderCalendar();
  });
}

renderCalendar();
loadCalendar();
validateGuestCounts();
