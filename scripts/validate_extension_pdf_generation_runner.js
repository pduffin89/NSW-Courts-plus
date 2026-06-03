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

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const context = makeContext();

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
  const districtCivil = {
    case_number: "2026/300002",
    matter_name: "Gamma Pty Ltd v Delta Pty Ltd",
    court: "District Court",
    jurisdiction: "Civil",
    court_location: "Sydney District Court Civil",
    plaintiff: "Gamma Pty Ltd",
    defendant: "Delta Pty Ltd",
  };

  await writePdf(
    context,
    "extension_supreme_bail_all",
    "forms/access_application_2026.pdf",
    context.mediaValues(
      PROFILE,
      mediaMatter,
      new Set(["crown_bundle", "submissions", "selected_images"]),
      DETAILS
    )
  );

  await writePdf(
    context,
    "extension_supreme_general_all",
    "forms/access_application_2026.pdf",
    context.mediaValues(
      PROFILE,
      mediaMatter,
      new Set(["originating_process", "transcript", "exhibits", "notice_of_appeal", "other"]),
      DETAILS
    )
  );

  await writePdf(
    context,
    "extension_local_crime_all",
    "forms/application_non_party_access.pdf",
    context.nonPartyValues(
      PROFILE,
      localCrime,
      new Set(["indictment_can", "witness_statements", "police_fact_sheet", "transcript", "record_conviction_or_order", "other"]),
      DETAILS
    ),
    { Text28: 9, Text29: 9, Text48: 11, Text51: 11 }
  );

  await writePdf(
    context,
    "extension_district_civil_all",
    "forms/application_non_party_access.pdf",
    context.nonPartyValues(
      PROFILE,
      districtCivil,
      new Set(["sealed_copy_judgment", "certified_copy_reasons", "civil_pleading", "civil_other_filed"]),
      DETAILS
    ),
    { Text28: 9, Text29: 9, Text48: 11, Text51: 11 }
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
