#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".tmp", "extension-pdf-matrix");

const PROFILE = {
  applicant_name: "Perry Duffin",
  organisation: "The Sydney Morning Herald",
  contact_number: "0466 208 099",
  email: "perry.duffin@example.com",
  occupation: "Journalist",
};

const DETAILS = {
  transcript_dates: "1-2 June 2026",
  exhibits: "Exhibit A and Exhibit B",
  selected_images: "CCTV stills tendered in open court",
  other: "Statement of agreed facts",
  civil_pleading: "Statement of claim filed 4 June 2026",
  civil_other_filed: "Notice of motion filed 4 June 2026",
  additional_details: "Current proceedings, media access requested for reporting.",
};

const NON_PARTY_FIELD_FONT_SIZES = { Text28: 9, Text29: 9, Text48: 11, Text51: 11 };
const SUPREME_BAIL_DOCS = ["crown_bundle", "submissions", "selected_images"];
const SUPREME_GENERAL_DOCS = ["originating_process", "transcript", "exhibits", "notice_of_appeal", "other"];
const NON_PARTY_CRIME_DOCS = [
  "indictment_can",
  "witness_statements",
  "police_fact_sheet",
  "transcript",
  "record_conviction_or_order",
  "other",
];
const NON_PARTY_CIVIL_DOCS = [
  "sealed_copy_judgment",
  "certified_copy_reasons",
  "civil_pleading",
  "civil_other_filed",
];

function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, "extension", relativePath));
}

function makeContext() {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
  };
  context.globalThis = context;
  context.chrome = {
    runtime: {
      lastError: null,
      getURL: (relativePath) => relativePath,
      onMessage: { addListener() {} },
    },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    alarms: {
      onAlarm: { addListener() {} },
    },
    storage: {
      local: {
        get(_keys, callback) { callback({}); },
        set(_items, callback) { callback(); },
        remove(_keys, callback) { callback(); },
      },
    },
    downloads: {
      download(_options, callback) { callback(1); },
    },
  };
  context.importScripts = (...files) => {
    files.forEach((file) => {
      vm.runInContext(readExtensionFile(file).toString("utf8"), context, { filename: file });
    });
  };
  context.fetch = async (relativePath) => {
    const bytes = readExtensionFile(String(relativePath));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => bytes.toString("utf8"),
    };
  };
  vm.createContext(context);
  vm.runInContext(readExtensionFile("background.js").toString("utf8"), context, {
    filename: "background.js",
  });
  return context;
}

async function writePdf(context, name, template, values, fieldFontSizes = {}) {
  const bytes = await context.fillPdfTemplate(template, values, fieldFontSizes);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.pdf`), Buffer.from(bytes));
}

function powerset(items) {
  const results = [[]];
  for (const item of items) {
    const snapshot = results.map((set) => set.concat(item));
    results.push(...snapshot);
  }
  return results;
}

function subsetName(docs) {
  return docs.length ? docs.slice().sort().join("_") : "none";
}

function buildCases() {
  const mediaMatter = {
    case_number: "2026/100001",
    matter_name: "R v Alexandra Example",
    court: "Supreme Court",
    jurisdiction: "Criminal",
    court_location: "Sydney Supreme Court",
    plaintiff: "R",
    defendant: "Alexandra Example",
  };
  const localCrime = {
    case_number: "2026/200001",
    matter_name: "R v Benjamin Crime",
    court: "Local Court",
    jurisdiction: "Criminal",
    court_location: "Downing Centre Local Court",
    plaintiff: "R",
    defendant: "Benjamin Crime",
  };
  const districtCrime = {
    case_number: "2026/200002",
    matter_name: "R v Charlotte District",
    court: "District Court",
    jurisdiction: "Criminal",
    court_location: "Sydney District Court",
    plaintiff: "R",
    defendant: "Charlotte District",
  };
  const childrenCrime = {
    case_number: "2026/200003",
    matter_name: "R v Child Example",
    court: "Children's Court",
    jurisdiction: "Criminal",
    court_location: "Parramatta Children's Court",
    plaintiff: "R",
    defendant: "Child Example",
  };
  const coronerCrime = {
    case_number: "2026/200004",
    matter_name: "Inquest into Example",
    court: "Coroner's Court",
    jurisdiction: "Criminal",
    court_location: "Lidcombe Coroner's Court",
  };
  const localCivil = {
    case_number: "2026/300001",
    matter_name: "Acme Pty Ltd v Beta Pty Ltd",
    court: "Local Court",
    jurisdiction: "Civil",
    court_location: "Downing Centre Local Court Civil",
    plaintiff: "Acme Pty Ltd",
    defendant: "Beta Pty Ltd",
  };
  const districtCivil = {
    case_number: "2026/300002",
    matter_name: "Gamma Pty Ltd v Delta Pty Ltd",
    court: "District Court",
    jurisdiction: "Civil",
    court_location: "Sydney District Court Civil",
    plaintiff: "Gamma Pty Ltd",
    defendant: "Delta Pty Ltd",
  };

  const cases = [
    {
      name: "supreme_bail_all",
      template: "forms/access_application_2026.pdf",
      kind: "media",
      matter: mediaMatter,
      docs: ["crown_bundle", "submissions", "selected_images"],
    },
    {
      name: "supreme_general_all",
      template: "forms/access_application_2026.pdf",
      kind: "media",
      matter: mediaMatter,
      docs: ["originating_process", "transcript", "exhibits", "notice_of_appeal", "other"],
    },
    {
      name: "local_crime_all",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: localCrime,
      docs: ["indictment_can", "witness_statements", "police_fact_sheet", "transcript", "record_conviction_or_order", "other"],
    },
    {
      name: "district_crime_all",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: districtCrime,
      docs: ["indictment_can", "witness_statements", "police_fact_sheet", "transcript", "record_conviction_or_order", "other"],
    },
    {
      name: "children_crime_core",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: childrenCrime,
      docs: ["police_fact_sheet", "record_conviction_or_order"],
    },
    {
      name: "coroner_crime_core",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: coronerCrime,
      docs: ["transcript", "other"],
    },
    {
      name: "local_civil_all",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: localCivil,
      docs: ["sealed_copy_judgment", "certified_copy_reasons", "civil_pleading", "civil_other_filed"],
    },
    {
      name: "district_civil_all",
      template: "forms/application_non_party_access.pdf",
      kind: "non_party",
      matter: districtCivil,
      docs: ["sealed_copy_judgment", "certified_copy_reasons", "civil_pleading", "civil_other_filed"],
    },
  ];

  for (const docs of powerset(SUPREME_BAIL_DOCS)) {
    cases.push({
      name: `exhaustive_supreme_bail_${subsetName(docs)}`,
      template: "forms/access_application_2026.pdf",
      kind: "media",
      matter: mediaMatter,
      docs,
    });
  }
  for (const docs of powerset(SUPREME_GENERAL_DOCS)) {
    cases.push({
      name: `exhaustive_supreme_general_${subsetName(docs)}`,
      template: "forms/access_application_2026.pdf",
      kind: "media",
      matter: mediaMatter,
      docs,
    });
  }
  for (const [label, matter] of [
    ["local_crime", localCrime],
    ["district_crime", districtCrime],
    ["children_crime", childrenCrime],
    ["coroner_crime", coronerCrime],
  ]) {
    for (const docs of powerset(NON_PARTY_CRIME_DOCS)) {
      cases.push({
        name: `exhaustive_${label}_${subsetName(docs)}`,
        template: "forms/application_non_party_access.pdf",
        kind: "non_party",
        matter,
        docs,
      });
    }
  }
  for (const [label, matter] of [
    ["local_civil", localCivil],
    ["district_civil", districtCivil],
  ]) {
    for (const docs of powerset(NON_PARTY_CIVIL_DOCS)) {
      cases.push({
        name: `exhaustive_${label}_${subsetName(docs)}`,
        template: "forms/application_non_party_access.pdf",
        kind: "non_party",
        matter,
        docs,
      });
    }
  }

  return cases;
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const context = makeContext();

  for (const testCase of buildCases()) {
    const docs = new Set(testCase.docs);
    const values = testCase.kind === "media"
      ? context.mediaValues(PROFILE, testCase.matter, docs, DETAILS)
      : context.nonPartyValues(PROFILE, testCase.matter, docs, DETAILS);
    await writePdf(
      context,
      `extension_${testCase.name}`,
      testCase.template,
      values,
      testCase.kind === "media" ? {} : NON_PARTY_FIELD_FONT_SIZES
    );
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
