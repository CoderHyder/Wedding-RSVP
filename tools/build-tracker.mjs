import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { GUEST_LIST } from "../src/guestList.js";

const workbook = Workbook.create();
const qasim = workbook.worksheets.add("Qasim");
const moksha = workbook.worksheets.add("Moksha");
const summary = workbook.worksheets.add("Summary");

const outputDir = path.resolve("outputs");
const previewDir = path.join(outputDir, "previews");
const outputPath = path.join(outputDir, "wedding-rsvp-tracker.xlsx");
const DATA_START_ROW = 6;
const MAX_DATA_ROW = 105;
const FAMILY_START_COL = 0;
const FRIENDS_START_COL = 12;
const BLOCK_WIDTH = 11;

const colors = {
  ivory: "#FFFAF0",
  parchment: "#F5EAD8",
  sage: "#344F3B",
  teal: "#2F6F73",
  wine: "#6D2731",
  rose: "#F3D8DE",
  gold: "#D49428",
  paleGreen: "#DDEADF",
  paleGold: "#F8EDCE",
  paleBlue: "#DDECEF",
  white: "#FFFFFF",
  ink: "#2F261D",
  grid: "#D9CEBA",
};

const partyHeaders = [
  "Guest ID",
  "Guest",
  "Invited",
  "Invite Status",
  "Response",
  "Actual",
  "Events",
  "Dietary Notes",
  "RSVP Message",
  "Notes",
  "Updated At",
];

const parties = [
  { name: "Qasim", sheet: qasim },
  { name: "Moksha", sheet: moksha },
];

function columnLetter(index) {
  let dividend = index + 1;
  let letter = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return letter;
}

function cell(col, row) {
  return `${columnLetter(col)}${row}`;
}

function rangeAddress(startCol, startRow, endCol, endRow) {
  return `${cell(startCol, startRow)}:${cell(endCol, endRow)}`;
}

function setColumnWidths(sheet) {
  const widths = [
    86, 190, 70, 112, 110, 70, 190, 170, 210, 190, 140, 28,
    86, 190, 70, 112, 110, 70, 190, 170, 210, 190, 140,
  ];

  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function styleTitle(sheet, partyName) {
  sheet.showGridLines = false;
  sheet.getRange("A1:W1").merge();
  sheet.getRange("A1:W1").values = [[`${partyName} Guest Tracker`]];
  sheet.getRange("A1:W1").format = {
    fill: colors.sage,
    font: { bold: true, color: colors.ivory, size: 20 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A1:W1").format.rowHeightPx = 46;

  sheet.getRange("A2:W2").merge();
  sheet.getRange("A2:W2").values = [[
    "Family and friends are split side-by-side. Website RSVPs update the Response, Actual, Events, dietary notes, personal note, and Updated At columns.",
  ]];
  sheet.getRange("A2:W2").format = {
    fill: colors.parchment,
    font: { color: colors.ink, italic: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A2:W2").format.rowHeightPx = 30;
}

function styleGroupTitle(sheet, startCol, title) {
  const titleRange = sheet.getRange(rangeAddress(startCol, 4, startCol + BLOCK_WIDTH - 1, 4));
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: title === "FAMILY" ? colors.wine : colors.teal,
    font: { bold: true, color: colors.white, size: 14 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  titleRange.format.rowHeightPx = 30;
}

function styleHeader(range) {
  range.format = {
    fill: colors.sage,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
}

function styleBody(range) {
  range.format = {
    fill: colors.white,
    font: { color: colors.ink },
    verticalAlignment: "top",
    wrapText: true,
  };
}

function writeBlock(sheet, partyName, groupName, startCol) {
  const guests = GUEST_LIST.filter((guest) => guest.side === partyName && guest.group === groupName);
  styleGroupTitle(sheet, startCol, groupName.toUpperCase());
  sheet.getRange(rangeAddress(startCol, 5, startCol + BLOCK_WIDTH - 1, 5)).values = [partyHeaders];
  styleHeader(sheet.getRange(rangeAddress(startCol, 5, startCol + BLOCK_WIDTH - 1, 5)));

  const rows = guests.map((guest) => [
      guest.id,
      guest.name,
      guest.invitedCount,
      guest.inviteStatus,
      guest.seedResponse || "Awaiting",
      guest.seedResponse === "Declined" ? 0 : "",
      null,
      null,
      null,
      guest.notes,
      null,
  ]);
  const lastRow = DATA_START_ROW + rows.length - 1;

  sheet.getRange(rangeAddress(startCol, DATA_START_ROW, startCol + BLOCK_WIDTH - 1, lastRow)).values = rows;
  styleBody(sheet.getRange(rangeAddress(startCol, DATA_START_ROW, startCol + BLOCK_WIDTH - 1, lastRow)));

  sheet.getRange(rangeAddress(startCol + 2, DATA_START_ROW, startCol + 2, lastRow)).format.numberFormat = "0";
  sheet.getRange(rangeAddress(startCol + 5, DATA_START_ROW, startCol + 5, lastRow)).format.numberFormat = "0";
  sheet.getRange(rangeAddress(startCol + 10, DATA_START_ROW, startCol + 10, lastRow)).format.numberFormat = "yyyy-mm-dd hh:mm";

  sheet.getRange(rangeAddress(startCol + 3, DATA_START_ROW, startCol + 3, lastRow)).dataValidation = {
    rule: { type: "list", values: ["Sent", "Not sent", "Thinking", "Maybe", "Website"] },
  };
  sheet.getRange(rangeAddress(startCol + 4, DATA_START_ROW, startCol + 4, lastRow)).dataValidation = {
    rule: { type: "list", values: ["Awaiting", "Attending", "Declined"] },
  };

  const responseRange = sheet.getRange(rangeAddress(startCol + 4, DATA_START_ROW, startCol + 4, lastRow));
  responseRange.conditionalFormats.add("containsText", {
    text: "Attending",
    format: { fill: colors.paleGreen, font: { bold: true, color: colors.sage } },
  });
  responseRange.conditionalFormats.add("containsText", {
    text: "Declined",
    format: { fill: colors.rose, font: { bold: true, color: colors.wine } },
  });
  responseRange.conditionalFormats.add("containsText", {
    text: "Awaiting",
    format: { fill: colors.paleGold, font: { bold: true, color: colors.ink } },
  });

  const statusRange = sheet.getRange(rangeAddress(startCol + 3, DATA_START_ROW, startCol + 3, lastRow));
  statusRange.conditionalFormats.add("containsText", {
    text: "Sent",
    format: { fill: colors.paleGreen, font: { color: colors.sage } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "Not sent",
    format: { fill: colors.rose, font: { color: colors.wine } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "Thinking",
    format: { fill: colors.paleBlue, font: { color: colors.teal } },
  });

  const tableRange = rangeAddress(startCol, 5, startCol + BLOCK_WIDTH - 1, lastRow);
  sheet.tables.add(tableRange, true, `${partyName}${groupName}Table`);
}

function writePartySheet({ name, sheet }) {
  styleTitle(sheet, name);
  writeBlock(sheet, name, "Family", FAMILY_START_COL);
  writeBlock(sheet, name, "Friends", FRIENDS_START_COL);
  sheet.freezePanes.freezeRows(5);
    setColumnWidths(sheet);
}

function blockRefs(sheetName, startCol) {
  return {
    id: `'${sheetName}'!${rangeAddress(startCol, DATA_START_ROW, startCol, MAX_DATA_ROW)}`,
    invited: `'${sheetName}'!${rangeAddress(startCol + 2, DATA_START_ROW, startCol + 2, MAX_DATA_ROW)}`,
    inviteStatus: `'${sheetName}'!${rangeAddress(startCol + 3, DATA_START_ROW, startCol + 3, MAX_DATA_ROW)}`,
    response: `'${sheetName}'!${rangeAddress(startCol + 4, DATA_START_ROW, startCol + 4, MAX_DATA_ROW)}`,
    actual: `'${sheetName}'!${rangeAddress(startCol + 5, DATA_START_ROW, startCol + 5, MAX_DATA_ROW)}`,
  };
}

function groupFormula(sheetName, group, metric) {
  const refs = blockRefs(sheetName, group === "Family" ? FAMILY_START_COL : FRIENDS_START_COL);
  if (metric === "rows") return `=COUNTA(${refs.id})`;
  if (metric === "invited") return `=SUM(${refs.invited})`;
  if (metric === "attending") return `=SUM(${refs.actual})`;
  if (metric === "declined") return `=COUNTIF(${refs.response},"Declined")`;
  if (metric === "awaiting") return `=COUNTIF(${refs.response},"Awaiting")`;
  if (metric === "notSent") return `=COUNTIF(${refs.inviteStatus},"Not sent")`;
  if (metric === "thinking") return `=COUNTIF(${refs.inviteStatus},"Thinking")+COUNTIF(${refs.inviteStatus},"Maybe")`;
  return "";
}

function writeSummary() {
  summary.showGridLines = false;
  summary.getRange("A1:J1").merge();
  summary.getRange("A1:J1").values = [["Wedding RSVP Summary"]];
  summary.getRange("A1:J1").format = {
    fill: colors.sage,
    font: { bold: true, color: colors.ivory, size: 20 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  summary.getRange("A1:J1").format.rowHeightPx = 46;

  summary.getRange("A3:J4").values = [
    ["Guest rows", "", "Invited count", "", "Attending", "", "Declined", "", "Awaiting", ""],
    [
      "",
      '=SUM(C8:C11)',
      "",
      '=SUM(D8:D11)',
      "",
      '=SUM(E8:E11)',
      "",
      '=SUM(F8:F11)',
      "",
      '=SUM(G8:G11)',
    ],
  ];
  summary.getRange("A3:J4").format = {
    fill: colors.ivory,
    font: { bold: true, color: colors.sage },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  summary.getRange("B4,D4,F4,H4,J4").format = {
    font: { bold: true, color: colors.wine, size: 18 },
  };

  summary.getRange("A7:I7").values = [[
    "Party",
    "Group",
    "Guest Rows",
    "Invited",
    "Attending",
    "Declined",
    "Awaiting",
    "Not Sent",
    "Maybe / Thinking",
  ]];
  styleHeader(summary.getRange("A7:I7"));

  const rows = [
    ["Qasim", "Family"],
    ["Qasim", "Friends"],
    ["Moksha", "Family"],
    ["Moksha", "Friends"],
  ];

  summary.getRange("A8:B11").values = rows;
  summary.getRange("C8:I11").formulas = rows.map(([partyName, groupName]) => [
    groupFormula(partyName, groupName, "rows"),
    groupFormula(partyName, groupName, "invited"),
    groupFormula(partyName, groupName, "attending"),
    groupFormula(partyName, groupName, "declined"),
    groupFormula(partyName, groupName, "awaiting"),
    groupFormula(partyName, groupName, "notSent"),
    groupFormula(partyName, groupName, "thinking"),
  ]);
  styleBody(summary.getRange("A8:I11"));

  summary.getRange("A14:C17").values = [
    ["Response", "Count", "Share"],
    ["Attending", "=F4", '=IF(SUM($B$15:$B$17)=0,0,B15/SUM($B$15:$B$17))'],
    ["Declined", "=H4", '=IF(SUM($B$15:$B$17)=0,0,B16/SUM($B$15:$B$17))'],
    ["Awaiting", "=J4", '=IF(SUM($B$15:$B$17)=0,0,B17/SUM($B$15:$B$17))'],
  ];
  styleHeader(summary.getRange("A14:C14"));
  styleBody(summary.getRange("A15:C17"));
  summary.getRange("C15:C17").format.numberFormat = "0%";

  const chart = summary.charts.add("bar", summary.getRange("A14:B17"));
  chart.title = "RSVP Status";
  chart.hasLegend = false;
  chart.xAxis = { axisType: "textAxis" };
  chart.setPosition("E14", "J29");

  [110, 110, 100, 100, 100, 100, 100, 100, 130, 110].forEach((width, index) => {
    summary.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
  summary.freezePanes.freezeRows(7);
}

parties.forEach(writePartySheet);
writeSummary();

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

for (const sheetName of ["Qasim", "Moksha", "Summary"]) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
