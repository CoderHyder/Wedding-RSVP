import "./styles.css";
import { GUEST_LIST, findGuest, guestKey } from "./guestList.js";

const SESSION_COOKIE = "mq_wedding_session";
const SESSION_KEY = "mq-wedding-session";
const RESPONSES_KEY = "mq-wedding-responses";
const LEGACY_RSVP_KEY = "mq-wedding-rsvp";
const EVENT_START = new Date("2027-03-12T22:00:00Z");
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/17xmJPW92f4y7CPbhXUzC2HbGlLXKCte-qYB7eP1RPnk/edit";
const SHEETS_ENDPOINT = import.meta.env.VITE_GOOGLE_SCRIPT_URL || "";
const SHEET_URL = import.meta.env.VITE_GOOGLE_SHEET_URL || DEFAULT_SHEET_URL;

const gate = document.querySelector("#guestGate");
const gateForm = document.querySelector("#gateForm");
const gateFirstName = document.querySelector("#gateFirstName");
const gateLastName = document.querySelector("#gateLastName");
const gateMessage = document.querySelector("#gateMessage");
const siteShell = document.querySelector("#siteShell");
const adminSection = document.querySelector("#admin");
const guestNameDisplay = document.querySelector("#guestNameDisplay");
const changeGuest = document.querySelector("#changeGuest");
const rsvpForm = document.querySelector("#rsvpForm");
const rsvpName = document.querySelector("#rsvpName");
const rsvpMessage = document.querySelector("#rsvpMessage");
const rsvpSubmitButton = document.querySelector("#rsvpSubmitButton");
const rsvpConfirmation = document.querySelector("#rsvpConfirmation");
const rsvpSummary = document.querySelector("#rsvpSummary");
const editRsvpButton = document.querySelector("#editRsvpButton");
const formEditRsvpButton = document.querySelector("#formEditRsvpButton");
const rsvpUpdateNote = document.querySelector("#rsvpUpdateNote");
const calendarButton = document.querySelector("#calendarButton");
const guestCountInput = document.querySelector("#guestCount");
const addGuestButton = document.querySelector("#addGuestButton");
const attendeeSection = document.querySelector("#attendeeSection");
const attendeeList = document.querySelector("#attendeeList");
const guestTableBody = document.querySelector("#guestTableBody");
const adminStats = document.querySelector("#adminStats");
const adminSheetStatus = document.querySelector("#adminSheetStatus");
const adminSheetLink = document.querySelector("#adminSheetLink");
const guestSearch = document.querySelector("#guestSearch");
const exportGuests = document.querySelector("#exportGuests");

let currentSession = null;
let responses = loadResponses();
let remoteResponses = {};
let adminSnapshotRequest = null;
let currentResponse = null;
const MAX_GUEST_COUNT = 10;

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function titleCase(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fullName(firstName, lastName) {
  return normalizeName(`${titleCase(firstName)} ${titleCase(lastName)}`);
}

function isAdminLogin(firstName, lastName) {
  return firstName.trim().toLowerCase() === "admin" && lastName.trim().toLowerCase() === "admin";
}

function isFullName(value) {
  return normalizeName(value).split(" ").filter(Boolean).length >= 2;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadResponses() {
  const savedResponses = readJson(RESPONSES_KEY);
  if (savedResponses && typeof savedResponses === "object") {
    return savedResponses;
  }

  const legacyRsvp = readJson(LEGACY_RSVP_KEY);
  if (!legacyRsvp?.name) {
    return {};
  }

  const key = guestKey(legacyRsvp.name);
  const migrated = {
    [key]: {
      id: key,
      ...legacyRsvp,
      updatedAt: legacyRsvp.submittedAt || new Date().toISOString(),
    },
  };
  writeJson(RESPONSES_KEY, migrated);
  return migrated;
}

function encodeCookieValue(value) {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

function decodeCookieValue(value) {
  try {
    return JSON.parse(decodeURIComponent(atob(value)));
  } catch {
    return null;
  }
}

function setCookie(name, value, days = 30) {
  document.cookie = `${name}=${encodeCookieValue(value)}; max-age=${days * 86400}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie ? decodeCookieValue(cookie.split("=").slice(1).join("=")) : null;
}

function clearCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
}

function saveSession(session) {
  setCookie(SESSION_COOKIE, session, 30);
  writeJson(SESSION_KEY, session);
}

function loadSession() {
  return getCookie(SESSION_COOKIE) || readJson(SESSION_KEY);
}

function clearSession() {
  clearCookie(SESSION_COOKIE);
  localStorage.removeItem(SESSION_KEY);
}

function createSession(firstName, lastName) {
  const admin = isAdminLogin(firstName, lastName);
  const name = admin ? "Admin Admin" : fullName(firstName, lastName);
  const matchedGuest = admin ? null : findGuestForSession(firstName, lastName, name);

  return {
    firstName: admin ? "Admin" : titleCase(firstName),
    lastName: admin ? "Admin" : titleCase(lastName),
    name,
    role: admin ? "admin" : "guest",
    guestListId: matchedGuest?.id || "",
    guestListName: matchedGuest?.name || "",
  };
}

function findGuestForSession(firstName, lastName, name) {
  return (
    findGuest(name) ||
    GUEST_LIST.find((guest) => guestKey(guest.name) === guestKey(firstName)) ||
    GUEST_LIST.find((guest) => guestKey(guest.name).startsWith(guestKey(firstName))) ||
    GUEST_LIST.find((guest) => guestKey(name).startsWith(guestKey(guest.name)))
  );
}

function responseIdForSession(session) {
  return session.guestListId || guestKey(session.name);
}

function responseForGuest(guest) {
  return (
    responses[guest.id] ||
    responses[guestKey(guest.name)] ||
    remoteResponses[guest.id] ||
    remoteResponses[guestKey(guest.name)] ||
    null
  );
}

function showGate(message = "") {
  gate.hidden = false;
  siteShell.hidden = true;
  adminSection.hidden = true;
  gateMessage.textContent = message;
  window.setTimeout(() => gateFirstName.focus(), 60);
}

function unlockSite(session) {
  currentSession = session;
  currentResponse = responses[responseIdForSession(session)] || null;
  saveSession(session);

  gate.hidden = true;
  siteShell.hidden = false;
  guestNameDisplay.textContent = session.role === "admin" ? "Admin" : session.name;
  adminSection.hidden = session.role !== "admin";

  if (currentResponse) {
    hydrateRsvp(currentResponse);
  } else {
    resetRsvpForm(session.name);
  }

  if (session.role === "admin") {
    renderAdmin();
  }

  updateCountdown();
}

function resetRsvpForm(name) {
  rsvpForm.reset();
  rsvpName.value = name;
  rsvpMessage.textContent = "";
  rsvpSubmitButton.textContent = "Submit RSVP";
  rsvpForm.classList.remove("is-preview");
  rsvpConfirmation.classList.remove("has-response");
  rsvpConfirmation.querySelector("h3").textContent = "Awaiting RSVP";
  rsvpSummary.textContent = "Your response will appear here after submission.";
  editRsvpButton.hidden = true;
  rsvpUpdateNote.hidden = true;
  guestCountInput.value = "1";
  setAttendeeControls(true);
  renderAttendeeFields([{ name, dietary: "" }]);
}

function hydrateRsvp(rsvp) {
  rsvpName.value = rsvp.name || currentSession.name;
  rsvpForm.guestCount.value = rsvp.guestCount || 1;
  setCheckedValue("attendance", rsvp.attendance);

  const isAttending = rsvp.attendance !== "Unable to attend";
  setAttendeeControls(isAttending);
  renderAttendeeFields(isAttending ? attendeesForRsvp(rsvp) : []);
  rsvpSubmitButton.textContent = "Update RSVP";
  renderConfirmation(rsvp);
}

function setCheckedValue(name, value) {
  if (!value) {
    return;
  }

  const input = rsvpForm.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

function getFormData() {
  const data = new FormData(rsvpForm);
  const now = new Date().toISOString();
  const attendance = String(data.get("attendance") || "");
  const isAttending = attendance === "Attending";
  const attendees = isAttending
    ? Array.from(attendeeList.querySelectorAll(".attendee-card")).map((card) => ({
        name: normalizeName(card.querySelector("[data-attendee-name]").value),
        dietary: normalizeName(card.querySelector("[data-attendee-dietary]").value),
      }))
    : [];
  const guestCount = isAttending ? attendees.length : 0;
  guestCountInput.value = String(guestCount);

  return {
    id: responseIdForSession(currentSession),
    name: currentSession.name,
    rsvpOwner: currentSession.name,
    firstName: currentSession.firstName,
    lastName: currentSession.lastName,
    guestListId: currentSession.guestListId,
    guestListName: currentSession.guestListName,
    attendance,
    guestCount,
    attendees,
    submittedAt: currentResponse?.submittedAt || now,
    updatedAt: now,
  };
}

function validateRsvp(rsvp) {
  if (!isFullName(rsvp.name)) {
    return "Please enter your first and last name.";
  }

  if (!rsvp.attendance) {
    return "Please select your attendance.";
  }

  if (rsvp.attendance === "Attending" && (rsvp.guestCount < 1 || rsvp.guestCount > MAX_GUEST_COUNT)) {
    return "Please enter a party size between 1 and 10.";
  }

  if (rsvp.attendance === "Attending") {
    if (rsvp.attendees.length !== rsvp.guestCount) {
      return "Please add details for every guest in your party.";
    }

    if (rsvp.attendees.some((attendee) => !isFullName(attendee.name))) {
      return "Please enter each attendee's full name.";
    }
  }

  return "";
}

function saveResponse(rsvp) {
  responses = {
    ...responses,
    [rsvp.id]: rsvp,
  };
  writeJson(RESPONSES_KEY, responses);
  currentResponse = rsvp;
}

function setRsvpMessage(message, type = "info") {
  rsvpMessage.textContent = message;
  rsvpMessage.classList.toggle("is-success", type === "success");
  rsvpMessage.classList.toggle("is-error", type === "error");
}

function renderConfirmation(rsvp) {
  const isAttending = rsvp.attendance === "Attending";
  const names = attendeesForRsvp(rsvp).map((attendee) => attendee.name).filter(Boolean);

  rsvpConfirmation.querySelector("h3").textContent = isAttending
    ? "RSVP saved"
    : "Response saved";
  rsvpSummary.textContent = isAttending
    ? rsvp.guestCount === 1
      ? `${names[0] || rsvp.name} is attending.`
      : `${rsvp.guestCount} attendees confirmed: ${names.join(", ")}.`
    : `${rsvp.name} is unable to attend.`;
  rsvpForm.classList.add("is-preview");
  rsvpConfirmation.classList.add("has-response");
  editRsvpButton.hidden = false;
  rsvpUpdateNote.hidden = false;
  rsvpSubmitButton.textContent = "Update RSVP";
}

function attendeesForRsvp(rsvp) {
  if (Array.isArray(rsvp.attendees) && rsvp.attendees.length) {
    return rsvp.attendees.map((attendee) => ({
      name: normalizeName(attendee.name || ""),
      dietary: normalizeName(attendee.dietary || ""),
    }));
  }

  if (rsvp.attendance === "Attending") {
    return [{ name: rsvp.name || currentSession?.name || "", dietary: normalizeName(rsvp.dietary || "") }];
  }

  return [];
}

function fieldCountFromGuestCount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(numericValue), 1), MAX_GUEST_COUNT);
}

function setAttendeeControls(enabled) {
  attendeeSection.hidden = !enabled;
  guestCountInput.disabled = !enabled;
  guestCountInput.required = enabled;
  addGuestButton.disabled = !enabled;

  if (!enabled) {
    guestCountInput.value = "0";
    attendeeList.innerHTML = "";
    updateAttendeeControls();
    return;
  }

  if (Number(guestCountInput.value) < 1) {
    guestCountInput.value = "1";
  }
  updateAttendeeControls();
}

function readCurrentAttendees() {
  return Array.from(attendeeList.querySelectorAll(".attendee-card")).map((card) => ({
    name: normalizeName(card.querySelector("[data-attendee-name]").value),
    dietary: normalizeName(card.querySelector("[data-attendee-dietary]").value),
  }));
}

function renderAttendeeFields(existingAttendees = readCurrentAttendees()) {
  const count = fieldCountFromGuestCount(existingAttendees.length || guestCountInput.value || 1);
  const numericValue = Number(guestCountInput.value);
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    guestCountInput.value = String(count);
  }
  attendeeList.innerHTML = "";

  for (let index = 0; index < count; index += 1) {
    const attendee = existingAttendees[index] || { name: index === 0 ? currentSession?.name || "" : "", dietary: "" };
    const card = document.createElement("div");
    card.className = "attendee-card";
    card.innerHTML = `
      <div class="attendee-card__title">
        <span>${index === 0 ? "You / Guest 1" : `Guest ${index + 1}`}</span>
        ${index === 0 ? "" : `<button class="attendee-remove" type="button" data-remove-attendee aria-label="Remove guest ${index + 1}">Remove</button>`}
      </div>
      <label class="field" for="attendeeName${index}">
        <span>Full Name</span>
        <input id="attendeeName${index}" name="attendeeName${index}" type="text" autocomplete="name" data-attendee-name required />
      </label>
      <label class="field" for="attendeeDietary${index}">
        <span>Dietary notes</span>
        <textarea id="attendeeDietary${index}" name="attendeeDietary${index}" rows="2" data-attendee-dietary></textarea>
      </label>
    `;
    card.querySelector("[data-attendee-name]").value = attendee.name;
    card.querySelector("[data-attendee-dietary]").value = attendee.dietary;
    attendeeList.append(card);
  }

  updateAttendeeControls();
}

function updateAttendeeControls() {
  const count = attendeeList.querySelectorAll(".attendee-card").length;
  guestCountInput.value = attendeeSection.hidden ? "0" : String(count || 1);
  addGuestButton.disabled = attendeeSection.hidden || count >= MAX_GUEST_COUNT;
  addGuestButton.textContent = count >= MAX_GUEST_COUNT ? "Guest limit reached" : "+ Add Guest";
}

function updateCountdown() {
  const diff = Math.max(EVENT_START.getTime() - Date.now(), 0);
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  document.querySelector("#daysCount").textContent = String(days);
  document.querySelector("#hoursCount").textContent = String(hours);
  document.querySelector("#minutesCount").textContent = String(minutes);
}

function downloadBlob(contents, filename, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function calendarFile() {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Qasim Raza Wedding RSVP//EN",
    "BEGIN:VEVENT",
    "UID:moksha-shah-qasim-raza-wedding-20270313@wedding-rsvp",
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    "DTSTART:20270312T220000Z",
    "DTEND:20270313T120000Z",
    "SUMMARY:Wedding of Moksha Shah and Qasim Raza",
    "LOCATION:The Calyx, Sydney Botanic Gardens, Sydney NSW",
    "DESCRIPTION:Hindu Ceremony, Lunch, Nikkah Ceremony, Reception Dinner.",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function syncToGoogleSheets(rsvp) {
  if (!SHEETS_ENDPOINT) {
    return "local";
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);

  await fetch(SHEETS_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    signal: controller.signal,
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "upsertRsvp",
      response: rsvp,
    }),
  }).finally(() => window.clearTimeout(timeout));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    try {
      const snapshot = await fetchSheetsSnapshot(4000);
      if (snapshot?.ok && sheetSnapshotHasRsvp(snapshot, rsvp)) {
        return "sent";
      }
    } catch {
      // no-cors POSTs cannot be inspected directly, so verification is best-effort.
    }
  }

  return "unverified";
}

function sheetSnapshotHasRsvp(snapshot, rsvp) {
  const synced = snapshot.responses?.[rsvp.id] || snapshot.responses?.[guestKey(rsvp.name)];
  if (!synced || synced.attendance !== rsvp.attendance) {
    return false;
  }

  if (rsvp.attendance === "Unable to attend") {
    return synced.guestCount === 0;
  }

  const syncedAttendees = attendeesForRsvp(synced);
  if (synced.guestCount !== rsvp.guestCount || syncedAttendees.length !== rsvp.attendees.length) {
    return false;
  }

  const syncedNames = syncedAttendees.map((attendee) => guestKey(attendee.name)).sort();
  const localNames = rsvp.attendees.map((attendee) => guestKey(attendee.name)).sort();
  return localNames.every((name, index) => name === syncedNames[index]);
}

function fetchSheetsSnapshot(timeoutMs = 10000) {
  if (!SHEETS_ENDPOINT) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const callbackName = `mqWeddingSnapshot${Date.now()}${Math.round(Math.random() * 1000)}`;
    const script = document.createElement("script");
    const url = new URL(SHEETS_ENDPOINT);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Sheet snapshot timed out."));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.addEventListener("error", () => {
      cleanup();
      reject(new Error("Sheet snapshot could not load."));
    });

    url.searchParams.set("action", "snapshot");
    url.searchParams.set("callback", callbackName);
    script.src = url.toString();
    document.body.append(script);
  });
}

function renderAdminSheetLink(statusText = "") {
  if (SHEET_URL) {
    adminSheetLink.href = SHEET_URL;
    adminSheetLink.hidden = false;
    adminSheetStatus.textContent = statusText || "Open the shared Google Sheet for the full tracker and responses.";
    return;
  }

  adminSheetLink.hidden = true;
  adminSheetStatus.textContent =
    statusText ||
    (SHEETS_ENDPOINT
      ? "Sheet sync is configured. Add VITE_GOOGLE_SHEET_URL to show a fixed admin Sheet link here."
      : "Sheet sync is not connected yet. Deploy the Apps Script, then add the Web App URL to .env.");
}

async function refreshAdminSnapshot() {
  if (!SHEETS_ENDPOINT || adminSnapshotRequest) {
    return adminSnapshotRequest;
  }

  renderAdminSheetLink("Loading latest synced RSVPs from Google Sheets...");
  adminSnapshotRequest = fetchSheetsSnapshot()
    .then((snapshot) => {
      if (!snapshot?.ok) {
        throw new Error(snapshot?.error || "Sheet snapshot failed.");
      }

      remoteResponses = snapshot.responses || {};
      renderAdminSheetLink(
        SHEET_URL
          ? "Showing local browser responses plus the latest synced Google Sheet responses."
          : "Showing synced Google Sheet responses. Add VITE_GOOGLE_SHEET_URL to show a fixed admin Sheet link here.",
      );
      renderAdminStats();
      renderGuestTable();
    })
    .catch(() => {
      renderAdminSheetLink("Google Sheets sync is configured, but the latest Sheet data could not be loaded right now.");
    })
    .finally(() => {
      adminSnapshotRequest = null;
    });

  return adminSnapshotRequest;
}

function getGuestResponseLabel(guest, response) {
  if (response?.attendance === "Attending") {
    return `Attending (${response.guestCount})`;
  }

  if (response?.attendance === "Unable to attend") {
    return "Declined";
  }

  return guest.seedResponse || "Awaiting";
}

function allResponses() {
  return {
    ...remoteResponses,
    ...responses,
  };
}

function allGuestRows() {
  return Object.values(allResponses())
    .flatMap((response) => {
      if (response.attendance === "Attending") {
        return attendeesForRsvp(response).map((attendee) => ({
          name: attendee.name,
          response: "Attending",
          dietary: attendee.dietary,
          updatedAt: response.updatedAt || "",
        }));
      }

      if (response.attendance === "Unable to attend") {
        return [{
          name: response.name || response.rsvpOwner || "Guest",
          response: "Declined",
          dietary: "",
          updatedAt: response.updatedAt || "",
        }];
      }

      return [];
    })
    .sort((a, b) => {
      if (a.response !== b.response) {
        return a.response === "Attending" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function renderAdmin() {
  renderAdminSheetLink();
  renderAdminStats();
  renderGuestTable();
  refreshAdminSnapshot();
}

function renderAdminStats() {
  const rows = allGuestRows();
  const attending = rows.filter((row) => row.response === "Attending").length;
  const declined = rows.filter((row) => row.response === "Declined").length;
  const dietaryNotes = rows.filter((row) => row.dietary).length;

  adminStats.innerHTML = "";
  [
    ["Rows", rows.length],
    ["Attending", attending],
    ["Declined", declined],
    ["Dietary notes", dietaryNotes],
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "admin-stat";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    adminStats.append(card);
  });
}

function renderGuestTable() {
  const query = guestSearch.value.trim().toLowerCase();
  const rows = allGuestRows().filter((row) => {
    const searchable = [row.name, row.response, row.dietary, row.updatedAt]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return !query || searchable.includes(query);
  });

  guestTableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.response = row.response.toLowerCase();

    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = row.name;
    nameCell.append(name);

    const responseCell = document.createElement("td");
    const responseStatus = document.createElement("span");
    responseStatus.className = "response-pill";
    responseStatus.textContent = row.response;
    responseCell.append(responseStatus);

    const dietaryCell = document.createElement("td");
    dietaryCell.textContent = row.dietary || "";

    const updatedCell = document.createElement("td");
    updatedCell.textContent = row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "";

    tr.append(nameCell, responseCell, dietaryCell, updatedCell);
    guestTableBody.append(tr);
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "No submitted RSVP rows yet.";
    tr.append(td);
    guestTableBody.append(tr);
  }
}

function guestRowsForExport() {
  return allGuestRows().map((row) => ({
    Name: row.name,
    Response: row.response,
    "Dietary notes": row.dietary,
    "Updated at": row.updatedAt,
  }));
}

function toCsv(rows) {
  if (!rows.length) {
    return "Name,Response,Dietary notes,Updated at";
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  return csvRows.join("\n");
}

gateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const firstName = normalizeName(gateFirstName.value);
  const lastName = normalizeName(gateLastName.value);

  if (!firstName || !lastName) {
    showGate("Please enter your first and last name.");
    return;
  }

  unlockSite(createSession(firstName, lastName));
});

changeGuest.addEventListener("click", () => {
  clearSession();
  gateFirstName.value = "";
  gateLastName.value = "";
  showGate();
});

rsvpForm.addEventListener("change", (event) => {
  if (event.target.name === "attendance") {
    const isAttending = event.target.value === "Attending";
    setAttendeeControls(isAttending);
    if (isAttending) {
      renderAttendeeFields(readCurrentAttendees().length ? readCurrentAttendees() : [{ name: currentSession.name, dietary: "" }]);
    }
  }
});

rsvpForm.addEventListener("input", (event) => {
  if (event.target.matches("[data-attendee-name], [data-attendee-dietary]")) {
    updateAttendeeControls();
  }
});

addGuestButton.addEventListener("click", () => {
  const attendees = readCurrentAttendees();
  if (attendees.length >= MAX_GUEST_COUNT) {
    setRsvpMessage("You can add up to 10 attendees.", "error");
    return;
  }

  renderAttendeeFields([...attendees, { name: "", dietary: "" }]);
  window.setTimeout(() => {
    attendeeList.querySelector(".attendee-card:last-child [data-attendee-name]")?.focus();
  }, 0);
});

attendeeList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-attendee]");
  if (!removeButton) {
    return;
  }

  const card = removeButton.closest(".attendee-card");
  const attendees = readCurrentAttendees();
  const index = Array.from(attendeeList.children).indexOf(card);
  attendees.splice(index, 1);
  renderAttendeeFields(attendees.length ? attendees : [{ name: currentSession.name, dietary: "" }]);
});

rsvpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rsvp = getFormData();
  const error = validateRsvp(rsvp);

  if (error) {
    setRsvpMessage(error, "error");
    return;
  }

  setRsvpMessage("Saving your RSVP...");
  saveResponse(rsvp);
  renderConfirmation(rsvp);

  try {
    const syncStatus = await syncToGoogleSheets(rsvp);
    setRsvpMessage(
      syncStatus === "sent"
        ? "✓ RSVP confirmed. Your response has been sent to the wedding sheet."
        : syncStatus === "unverified"
          ? "✓ RSVP confirmed on this device. Sheet sync could not be verified yet."
        : "✓ RSVP confirmed. You can come back anytime to edit your response.",
      "success",
    );
  } catch {
    setRsvpMessage("✓ RSVP confirmed on this device. Sheet sync could not be reached right now.", "success");
  }

  if (currentSession.role === "admin") {
    renderAdmin();
  }
});

function openRsvpForEditing() {
  rsvpForm.classList.remove("is-preview");
  const firstAttendeeName = attendeeList.querySelector("[data-attendee-name]");
  rsvpForm.scrollIntoView({ behavior: "smooth", block: "start" });
  firstAttendeeName?.focus({ preventScroll: true });
  window.setTimeout(() => {
    firstAttendeeName?.focus({ preventScroll: true });
  }, 420);
}

editRsvpButton.addEventListener("click", openRsvpForEditing);

formEditRsvpButton.addEventListener("click", () => {
  openRsvpForEditing();
});

calendarButton.addEventListener("click", () => {
  downloadBlob(calendarFile(), "moksha-qasim-wedding.ics", "text/calendar");
});

guestSearch.addEventListener("input", renderGuestTable);

exportGuests.addEventListener("click", () => {
  downloadBlob(toCsv(guestRowsForExport()), "wedding-guest-list.csv", "text/csv");
});

const savedSession = loadSession();

if (savedSession?.name && savedSession?.role) {
  unlockSite(savedSession);
} else {
  showGate();
}

setInterval(updateCountdown, 60000);
