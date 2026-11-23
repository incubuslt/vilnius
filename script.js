"use strict";

// Both feeds belong to this apartment; dates booked on either feed are unavailable.
const property = {
  name: "Smolensko 35"
};
const calendarApiUrl = "https://smolensko-calendar-api.antanas-sukevicius.workers.dev/api/calendar";
const bookingApiUrl = "https://smolensko-calendar-api.antanas-sukevicius.workers.dev/api/booking";

const state = {
  unavailableDates: null,
  calendarLoading: true,
  calendarError: "",
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  checkin: "",
  checkout: ""
};

const elements = {
  calendarDays: document.getElementById("calendar-days"),
  calendarStatus: document.getElementById("calendar-status"),
  monthTitle: document.getElementById("month-title"),
  previousMonth: document.getElementById("previous-month"),
  nextMonth: document.getElementById("next-month"),
  checkinSummary: document.getElementById("checkin-summary"),
  checkoutSummary: document.getElementById("checkout-summary"),
  checkinInput: document.getElementById("checkin-input"),
  checkoutInput: document.getElementById("checkout-input"),
  adultCount: document.getElementById("adult-count"),
  childCount: document.getElementById("child-count"),
  message: document.getElementById("guest-message"),
  messageCharacterCount: document.getElementById("message-character-count"),
  form: document.getElementById("booking-form"),
  feedback: document.getElementById("form-feedback")
};

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
  state.calendarLoading = true;
  state.calendarError = "";
  renderCalendar();
  try {
    const response = await fetch(calendarApiUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Calendar service returned HTTP ${response.status}`);
    const calendar = await response.json();
    if (!Array.isArray(calendar.unavailableDates) ||
        !calendar.unavailableDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error("Calendar service returned invalid availability data");
    }
    state.unavailableDates = new Set(calendar.unavailableDates);
  } catch (error) {
    console.error(`Unable to load all availability calendars for ${property.name}:`, error);
    state.calendarError = "Availability could not be loaded. Please try again later.";
  } finally {
    state.calendarLoading = false;
    renderCalendar();
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
    const label = `${formatDate(key)}, ${availabilityLabel}`;
    html += `<button class="${classes.join(" ")}" type="button" data-date="${key}" aria-label="${label}"${disabled ? " disabled" : ""}${selected ? ' aria-pressed="true"' : ""}>${dayNumber}</button>`;
  }
  elements.calendarDays.innerHTML = html;
  elements.calendarDays.querySelectorAll("[data-date]:not(:disabled)").forEach((button) => {
    button.addEventListener("click", () => selectDate(button.dataset.date));
  });
  elements.checkinSummary.textContent = formatDate(state.checkin);
  elements.checkoutSummary.textContent = formatDate(state.checkout);
  elements.checkinInput.value = state.checkin;
  elements.checkoutInput.value = state.checkout;
  elements.checkinInput.min = todayKey;
  elements.checkinInput.max = bookingWindow.lastCheckinKey;
  elements.checkoutInput.min = state.checkin || todayKey;
  elements.checkoutInput.max = bookingWindow.lastDateKey;
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
  showFormMessage("Sending your request securely…");

  try {
    const response = await fetch(bookingApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(formData.entries()),
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
elements.adultCount.addEventListener("change", validateGuestCounts);
elements.childCount.addEventListener("change", validateGuestCounts);
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
