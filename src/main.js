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
const adminNavLink = document.querySelector("#adminNavLink");
const adminSection = document.querySelector("#admin");
const guestNameDisplay = document.querySelector("#guestNameDisplay");
const changeGuest = document.querySelector("#changeGuest");
const rsvpForm = document.querySelector("#rsvpForm");
const rsvpName = document.querySelector("#rsvpName");
const rsvpMessage = document.querySelector("#rsvpMessage");
const rsvpSubmitButton = document.querySelector("#rsvpSubmitButton");
const rsvpConfirmation = document.querySelector("#rsvpConfirmation");
const rsvpSummary = document.querySelector("#rsvpSummary");
const downloadRsvp = document.querySelector("#downloadRsvp");
const calendarButton = document.querySelector("#calendarButton");
const eventGroup = document.querySelector("#eventGroup");
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
  adminNavLink.hidden = true;
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
  adminNavLink.hidden = session.role !== "admin";
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
  rsvpConfirmation.querySelector("h3").textContent = "Awaiting RSVP";
  rsvpSummary.textContent = "Your response will appear here after submission.";
  downloadRsvp.disabled = true;
  setEventControls(true);
}

function hydrateRsvp(rsvp) {
  rsvpName.value = rsvp.name || currentSession.name;
  rsvpForm.guestCount.value = rsvp.guestCount || 1;
  rsvpForm.dietary.value = rsvp.dietary || "";
  rsvpForm.message.value = rsvp.message || "";
  setCheckedValue("attendance", rsvp.attendance);

  const selectedEvents = new Set(rsvp.events || []);
  rsvpForm.querySelectorAll("input[name='events']").forEach((input) => {
    input.checked = selectedEvents.has(input.value);
  });

  setEventControls(rsvp.attendance !== "Unable to attend");
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
  return {
    id: responseIdForSession(currentSession),
    name: currentSession.name,
    firstName: currentSession.firstName,
    lastName: currentSession.lastName,
    guestListId: currentSession.guestListId,
    guestListName: currentSession.guestListName,
    attendance: String(data.get("attendance") || ""),
    guestCount: Number(data.get("guestCount") || 1),
    events: data.getAll("events").map(String),
    dietary: String(data.get("dietary") || "").trim(),
    message: String(data.get("message") || "").trim(),
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

  if (rsvp.attendance === "Attending" && rsvp.events.length === 0) {
    return "Please select at least one event.";
  }

  if (rsvp.guestCount < 1 || rsvp.guestCount > 10) {
    return "Please enter a party size between 1 and 10.";
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
  const events = rsvp.events.length ? rsvp.events.join(", ") : "No events selected";

  rsvpConfirmation.querySelector("h3").textContent = isAttending
    ? "RSVP saved"
    : "Response saved";
  rsvpSummary.textContent = isAttending
    ? `${rsvp.name} is attending with a party of ${rsvp.guestCount}. Events: ${events}.`
    : `${rsvp.name} is unable to attend.`;
  downloadRsvp.disabled = false;
  rsvpSubmitButton.textContent = "Update RSVP";
}

function setEventControls(enabled) {
  eventGroup.classList.toggle("is-disabled", !enabled);
  eventGroup.querySelectorAll("input").forEach((input) => {
    input.disabled = !enabled;
    if (!enabled) {
      input.checked = false;
    }
  });

  if (enabled && !eventGroup.querySelector("input:checked")) {
    eventGroup.querySelectorAll("input").forEach((input) => {
      input.checked = true;
    });
  }
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

function rsvpText(rsvp) {
  return [
    "Wedding RSVP: Moksha Shah & Qasim Raza",
    `Name: ${rsvp.name}`,
    `Attendance: ${rsvp.attendance}`,
    `Guests in party: ${rsvp.guestCount}`,
    `Events: ${rsvp.events.length ? rsvp.events.join(", ") : "None"}`,
    `Dietary notes: ${rsvp.dietary || "None"}`,
    `Note for Moksha & Qasim: ${rsvp.message || "None"}`,
    `Submitted: ${new Date(rsvp.submittedAt).toLocaleString()}`,
    `Last updated: ${new Date(rsvp.updatedAt).toLocaleString()}`,
  ].join("\n");
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

  await fetch(SHEETS_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "upsertRsvp",
      response: rsvp,
    }),
  });

  return "sent";
}

function fetchSheetsSnapshot() {
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
    }, 10000);

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

function renderAdmin() {
  renderAdminSheetLink();
  renderAdminStats();
  renderGuestTable();
  refreshAdminSnapshot();
}

function renderAdminStats() {
  const tableRows = GUEST_LIST.map((guest) => ({
    guest,
    response: responseForGuest(guest),
  }));
  const invited = GUEST_LIST.reduce(
    (sum, guest) => sum + (Number.isFinite(Number(guest.invitedCount)) ? Number(guest.invitedCount) : 0),
    0,
  );
  const attending = tableRows.reduce(
    (sum, row) => sum + (row.response?.attendance === "Attending" ? Number(row.response.guestCount) : 0),
    0,
  );
  const declined = tableRows.filter(
    (row) => row.response?.attendance === "Unable to attend" || row.guest.seedResponse === "Declined",
  ).length;
  const awaiting = tableRows.filter((row) => getGuestResponseLabel(row.guest, row.response) === "Awaiting").length;

  adminStats.innerHTML = "";
  [
    ["Guest rows", GUEST_LIST.length],
    ["Invited count", invited],
    ["Attending", attending],
    ["Declined", declined],
    ["Awaiting", awaiting],
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "admin-stat";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    adminStats.append(card);
  });
}

function renderGuestTable() {
  const query = guestSearch.value.trim().toLowerCase();
  const rows = GUEST_LIST.map((guest) => {
    const response = responseForGuest(guest);
    const responseLabel = getGuestResponseLabel(guest, response);
    return {
      guest,
      response,
      responseLabel,
      searchable: [
        guest.name,
        guest.side,
        guest.group,
        guest.inviteStatus,
        responseLabel,
        guest.notes,
        response?.message,
        response?.dietary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  }).filter((row) => !query || row.searchable.includes(query));

  guestTableBody.innerHTML = "";
  rows.forEach(({ guest, response, responseLabel }) => {
    const tr = document.createElement("tr");
    tr.dataset.response = responseLabel.toLowerCase();

    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = guest.name;
    const side = document.createElement("span");
    side.textContent = `${guest.side} side`;
    nameCell.append(name, side);

    const groupCell = document.createElement("td");
    groupCell.textContent = guest.group;

    const invitedCell = document.createElement("td");
    invitedCell.textContent = guest.invitedCount || "TBC";

    const inviteStatusCell = document.createElement("td");
    const inviteStatus = document.createElement("span");
    inviteStatus.className = "status-pill";
    inviteStatus.textContent = guest.inviteStatus;
    inviteStatusCell.append(inviteStatus);

    const responseCell = document.createElement("td");
    const responseStatus = document.createElement("span");
    responseStatus.className = "response-pill";
    responseStatus.textContent = responseLabel;
    responseCell.append(responseStatus);

    const notesCell = document.createElement("td");
    notesCell.textContent = [
      guest.notes,
      response?.dietary && `Dietary: ${response.dietary}`,
      response?.message && `Msg: ${response.message}`,
    ]
      .filter(Boolean)
      .join(" | ");

    tr.append(nameCell, groupCell, invitedCell, inviteStatusCell, responseCell, notesCell);
    guestTableBody.append(tr);
  });
}

function guestRowsForExport() {
  return GUEST_LIST.map((guest) => {
    const response = responseForGuest(guest);
    return {
      Guest: guest.name,
      Side: guest.side,
      Group: guest.group,
      Invited: guest.invitedCount || "",
      "Invite status": guest.inviteStatus,
      Response: getGuestResponseLabel(guest, response),
      "Actual guest count": response?.attendance === "Attending" ? response.guestCount : "",
      Events: response?.events?.join(", ") || "",
      "Dietary notes": response?.dietary || "",
      Message: response?.message || "",
      Notes: guest.notes,
      "Updated at": response?.updatedAt || "",
    };
  });
}

function toCsv(rows) {
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
    setEventControls(event.target.value === "Attending");
  }
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

downloadRsvp.addEventListener("click", () => {
  if (!currentResponse) {
    return;
  }

  downloadBlob(rsvpText(currentResponse), "qasim-raza-wedding-rsvp.txt", "text/plain");
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
