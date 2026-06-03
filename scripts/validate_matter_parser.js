#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "extension", "matter_parser.js"), "utf8");
const context = { console };
vm.createContext(context);
vm.runInContext(source, context, { filename: "matter_parser.js" });

const parser = context.NswMatterParser;
if (!parser || typeof parser.parseMatterFromRow !== "function") {
  throw new Error("NswMatterParser did not initialize");
}

class FakeElement {
  constructor(text = "", cells = []) {
    this.textContent = text;
    this.innerText = text;
    this.cells = cells;
    this.parentElement = null;
    this.previousElementSibling = null;
  }

  querySelectorAll(selector) {
    return selector === "td" ? this.cells : [];
  }
}

function cell(text) {
  return new FakeElement(text);
}

function tableRow({
  date = "Thu 4 Jun",
  time = "9:30 am",
  caseNumber,
  matterName,
  jurisdiction,
  court,
  listingType,
  location,
  contextHeading = "",
}) {
  const cells = [
    cell(date),
    cell(time),
    cell(caseNumber),
    cell(matterName),
    cell(jurisdiction),
    cell(court),
    cell(listingType),
    cell(""),
    cell(location),
    cell("1"),
  ];
  const rowText = cells.map((item) => item.textContent).join(" ");
  const row = new FakeElement(rowText, cells);
  if (contextHeading) {
    const section = new FakeElement("");
    section.previousElementSibling = new FakeElement(contextHeading);
    row.parentElement = section;
  }
  return row;
}

function contextOnlyRow(text, contextHeading) {
  const row = new FakeElement(text, []);
  const section = new FakeElement("");
  section.previousElementSibling = new FakeElement(contextHeading);
  row.parentElement = section;
  return row;
}

const defaults = {
  case_number: "",
  matter_name: "",
  court: "Supreme Court",
  jurisdiction: "",
  court_location: "",
  listing_type: "",
  listing_date: "",
  plaintiff: "",
  defendant: "",
};

const cases = [
  {
    name: "supreme criminal bail row",
    row: tableRow({
      caseNumber: "2026/100001",
      matterName: "R v Alexandra Example",
      jurisdiction: "Criminal",
      court: "Supreme Court",
      listingType: "Bail Hearing",
      location: "Sydney Supreme Court",
    }),
    expected: {
      case_number: "2026/100001",
      matter_name: "R v Alexandra Example",
      court: "Supreme Court",
      jurisdiction: "Criminal",
      court_location: "Sydney Supreme Court",
      listing_type: "Bail Hearing",
      listing_date: "Thu 4 Jun 9:30 am",
      plaintiff: "R",
      defendant: "Alexandra Example",
    },
  },
  {
    name: "district criminal row",
    row: tableRow({
      caseNumber: "2026/200002",
      matterName: "R v Charlotte District",
      jurisdiction: "Criminal",
      court: "",
      listingType: "Sentence",
      location: "Sydney District Court",
    }),
    expected: {
      case_number: "2026/200002",
      matter_name: "R v Charlotte District",
      court: "District Court",
      jurisdiction: "Criminal",
      court_location: "Sydney District Court",
      listing_type: "Sentence",
      plaintiff: "R",
      defendant: "Charlotte District",
    },
  },
  {
    name: "local criminal row",
    row: tableRow({
      caseNumber: "2026/200001",
      matterName: "R v Benjamin Crime",
      jurisdiction: "Criminal",
      court: "",
      listingType: "Mention",
      location: "Downing Centre Local Court",
    }),
    expected: {
      court: "Local Court",
      court_location: "Downing Centre Local Court",
      plaintiff: "R",
      defendant: "Benjamin Crime",
    },
  },
  {
    name: "children criminal row",
    row: tableRow({
      caseNumber: "2026/200003",
      matterName: "R v Child Example",
      jurisdiction: "Criminal",
      court: "",
      listingType: "Hearing",
      location: "Parramatta Children's Court",
    }),
    expected: {
      court: "Children's Court",
      court_location: "Parramatta Children's Court",
      plaintiff: "R",
      defendant: "Child Example",
    },
  },
  {
    name: "coroner row",
    row: tableRow({
      caseNumber: "2026/200004",
      matterName: "Inquest into Example",
      jurisdiction: "Criminal",
      court: "",
      listingType: "Inquest",
      location: "Lidcombe Coroner's Court",
    }),
    expected: {
      court: "Coroner's Court",
      court_location: "Lidcombe Coroner's Court",
      plaintiff: "",
      defendant: "",
    },
  },
  {
    name: "local civil row",
    row: tableRow({
      caseNumber: "2026/300001",
      matterName: "Acme Pty Ltd v Beta Pty Ltd",
      jurisdiction: "Civil",
      court: "",
      listingType: "Directions",
      location: "Downing Centre Local Court Civil",
    }),
    expected: {
      court: "Local Court",
      jurisdiction: "Civil",
      plaintiff: "Acme Pty Ltd",
      defendant: "Beta Pty Ltd",
    },
  },
  {
    name: "district civil row",
    row: tableRow({
      caseNumber: "2026/300002",
      matterName: "Gamma Pty Ltd v Delta Pty Ltd",
      jurisdiction: "Civil",
      court: "",
      listingType: "Motion",
      location: "Sydney District Court Civil",
    }),
    expected: {
      court: "District Court",
      jurisdiction: "Civil",
      court_location: "Sydney District Court Civil",
      plaintiff: "Gamma Pty Ltd",
      defendant: "Delta Pty Ltd",
    },
  },
  {
    name: "12 digit case number fallback row",
    row: contextOnlyRow("202606040001 R v Context Only", "Local Court Daily List"),
    expected: {
      case_number: "202606040001",
      matter_name: "202606040001",
      court: "Local Court",
    },
  },
  {
    name: "context heading court inference",
    row: contextOnlyRow("2026/400001 Matter without cells", "District Court Criminal List"),
    expected: {
      case_number: "2026/400001",
      court: "District Court",
    },
  },
];

const failures = [];
for (const testCase of cases) {
  const actual = parser.parseMatterFromRow(testCase.row, defaults);
  if (!actual) {
    failures.push({ name: testCase.name, error: "returned null" });
    continue;
  }
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (actual[key] !== expected) {
      failures.push({ name: testCase.name, key, expected, actual: actual[key], matter: actual });
    }
  }
}

if (failures.length) {
  console.log("FAIL");
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log(`PASS (${cases.length} cases)`);
