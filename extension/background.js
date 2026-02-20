const PROFILE_KEY = "nsw_autofill_profile";

const ATTACH_MAX_ATTEMPTS = 8;
const ATTACH_RETRY_MS = 2000;
const ATTACH_KEY_PREFIX = "nsw_attach_pending_";
const ATTACH_ALARM_PREFIX = "nsw_attach_alarm_";
const ABN_GUID = "912aeab3-605b-4dc8-8aa5-9f5f70f65902";
const APP_TZ = "Australia/Sydney";
const FORM_TEMPLATE_MEDIA = "forms/access_application_2026.pdf";
const FORM_TEMPLATE_NON_PARTY = "forms/application_non_party_access.pdf";
const HANDWRITING_FONT_PATH = "vendor/fonts/Caveat-Regular.ttf";
const DOWNLOAD_SUBDIR = "Court Application Forms/Generated";
const SIGNATURE_FIELD_NAMES = new Set(["Applicant Signature", "Text48", "Text51"]);
const NON_PARTY_FIELD_FONT_SIZES = {
  Text28: 9,
  Text29: 9,
  Text48: 11,
  Text51: 11
};
const MEDIA_DOC_TO_FIELD = {
  crown_bundle: "Check Box39",
  submissions: "Check Box40",
  selected_images: "Check Box41",
  originating_process: "Check Box50",
  transcript: "Check Box51",
  exhibits: "Check Box52",
  notice_of_appeal: "Check Box53",
  other: "Check Box54"
};
const NON_PARTY_ACK_FIELDS = [
  "Button39",
  "Button40",
  "Button41",
  "Button42",
  "Button43",
  "Button44",
  "Button45",
  "Button46",
  "Button47"
];
const EMAIL_BODY = [
  "Hey folks",
  "Can I please get the latest outcomes, next dates, NPOs or any other orders, suburb and YOB.",
  "Applying for the following docs as well.",
  "Thanks heaps"
].join("\n");

const activeAttachRuns = new Set();

try {
  importScripts("vendor/pdf-lib.min.js");
  importScripts("vendor/fontkit.umd.min.js");
} catch (_error) {
  // Guarded at runtime by ensurePdfLibLoaded.
}

function cleanSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9]+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "") || "matter";
}

function truncateText(value, maxLen) {
  const text = cleanSpaces(value);
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

function stripSignaturePrefix(value) {
  return cleanSpaces(value).replace(/^\/s\/\s*/i, "");
}

function titleCaseToken(value) {
  const text = cleanSpaces(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function initialLastSignature(value) {
  const text = cleanSpaces(value);
  if (!text) return "";
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0].charAt(0).toUpperCase();
  const last = titleCaseToken(parts[parts.length - 1]);
  if (!first || !last) return text;
  return `${first}.${last}`;
}

function signatureFromProfile(profile) {
  const explicit = stripSignaturePrefix(profile && profile.signature_text ? profile.signature_text : "");
  if (explicit) return explicit;
  return initialLastSignature(profile && profile.applicant_name ? profile.applicant_name : "");
}

function splitParties(matter) {
  const plaintiff = cleanSpaces(matter && matter.plaintiff ? matter.plaintiff : "");
  const defendant = cleanSpaces(matter && matter.defendant ? matter.defendant : "");
  if (plaintiff && defendant) return [plaintiff, defendant];
  const parts = cleanSpaces(matter && matter.matter_name ? matter.matter_name : "").split(/\bv\b/i);
  if (parts.length >= 2) {
    return [
      cleanSpaces(parts[0].replace(/^[\s\-:]+|[\s\-:]+$/g, "")),
      cleanSpaces(parts[1].replace(/^[\s\-:]+|[\s\-:]+$/g, ""))
    ];
  }
  return [cleanSpaces(matter && matter.matter_name ? matter.matter_name : ""), ""];
}

function lastName(value) {
  const text = cleanSpaces(value);
  if (!text) return "";
  const tokens = text.match(/[A-Za-z][A-Za-z'\\-]*/g);
  if (tokens && tokens.length) return tokens[tokens.length - 1];
  const split = text.split(/\s+/);
  return split[split.length - 1];
}

function canonicalCriminalPlaintiff(value) {
  const text = cleanSpaces(value);
  if (!text) return "R";
  if (/^(r|regina|the king|the queen)$/i.test(text)) return "R";
  return text;
}

function isCriminalStyleMatter(matter, plaintiff) {
  const jurisdiction = cleanSpaces(matter && matter.jurisdiction ? matter.jurisdiction : "").toLowerCase();
  if (jurisdiction.includes("criminal")) return true;

  const lhs = cleanSpaces(plaintiff).toLowerCase();
  if (/^(r|regina|the king|the queen|dpp|director of public prosecutions)\b/.test(lhs)) return true;

  const name = cleanSpaces(matter && matter.matter_name ? matter.matter_name : "").toLowerCase();
  if (/^r\s*v\b/.test(name)) return true;

  return false;
}

function compactCaseTitle(matter, maxLen = 24) {
  const full = cleanSpaces(matter && matter.matter_name ? matter.matter_name : "");
  if (!full) return truncateText(matter && matter.case_number ? matter.case_number : "", maxLen);
  const [plaintiff, defendant] = splitParties(matter);
  const lhs = cleanSpaces(plaintiff) || "R";
  const rhs = titleCaseToken(lastName((matter && matter.defendant) || defendant));
  if (isCriminalStyleMatter(matter, lhs) && rhs) {
    return truncateText(cleanSpaces(`${canonicalCriminalPlaintiff(lhs)} v ${rhs}`), maxLen);
  }
  if (full.length <= maxLen) return full;
  if (rhs) {
    const candidate = cleanSpaces(`${lhs} v ${rhs}`);
    if (candidate.length <= maxLen) return candidate;
  }
  return truncateText(full, maxLen);
}

function abbreviateCourtName(court) {
  let text = cleanSpaces(court);
  if (!text) return "";
  const substitutions = [
    [/\bSupreme Court\b/gi, "Supreme Ct"],
    [/\bDistrict Court\b/gi, "District Ct"],
    [/\bLocal Court\b/gi, "Local Ct"],
    [/\bChildren'?s Court\b/gi, "Children's Ct"],
    [/\bCoroner'?s Court\b/gi, "Coroner's Ct"]
  ];
  substitutions.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return cleanSpaces(text);
}

function compactCourtText(matter, maxLen = 24) {
  const location = cleanSpaces(matter && matter.court_location ? matter.court_location : "");
  const shortLocation = cleanSpaces(location.replace(/\bDivision\b/gi, "Div").replace(/\bCourt\b/gi, "Ct"));
  const court = abbreviateCourtName(matter && matter.court ? matter.court : "");
  if (shortLocation && shortLocation.length <= maxLen) return shortLocation;
  if (location && location.length <= maxLen) return location;
  if (court && court.length <= maxLen) return court;
  if (location && court) {
    const withCourt = cleanSpaces(`${location} (${court})`);
    if (withCourt.length <= maxLen) return withCourt;
  }
  if (location) return truncateText(shortLocation, maxLen);
  return truncateText(court || (matter && matter.court ? matter.court : ""), maxLen);
}

function formatNowLongDate() {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: APP_TZ, day: "numeric" }).format(now);
  const monthYear = new Intl.DateTimeFormat("en-AU", {
    timeZone: APP_TZ,
    month: "long",
    year: "numeric"
  }).format(now);
  return `${day} ${monthYear}`;
}

function formatNowShortDate() {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: APP_TZ, day: "numeric" }).format(now);
  const month = new Intl.DateTimeFormat("en-AU", { timeZone: APP_TZ, month: "numeric" }).format(now);
  const year = new Intl.DateTimeFormat("en-AU", { timeZone: APP_TZ, year: "numeric" }).format(now);
  return `${day}/${month}/${year}`;
}

function timestampStamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}_${map.hour}${map.minute}${map.second}`;
}

function effectiveApplications(courtText, requestedApps) {
  const lowerCourt = cleanSpaces(courtText).toLowerCase();
  const isSupreme = lowerCourt.includes("supreme");
  let mediaSelected = Boolean(requestedApps && requestedApps.media_access_2026 !== undefined
    ? requestedApps.media_access_2026
    : true);
  let nonPartySelected = Boolean(requestedApps && requestedApps.non_party_access
    ? requestedApps.non_party_access
    : false);
  if (!isSupreme && mediaSelected) {
    mediaSelected = false;
    nonPartySelected = true;
  }
  return {
    media_access_2026: mediaSelected,
    non_party_access: nonPartySelected
  };
}

function resolveCourtRecipient(courtText) {
  const text = cleanSpaces(courtText).toLowerCase();
  if (text.includes("supreme")) return ["media@courts.nsw.gov.au", "supreme"];
  if (text.includes("district")) return ["mediadistrictcourt@dcj.nsw.gov.au", "district"];
  if (text.includes("local") || text.includes("children") || text.includes("childrens") || text.includes("coroner")) {
    return ["localcourtmedia@courts.nsw.gov.au", "local_children_coroner"];
  }
  return ["media@courts.nsw.gov.au", "supreme"];
}

function normalizeMatterName(caseNumber, matterName) {
  let text = cleanSpaces(matterName);
  if (!text) return cleanSpaces(caseNumber);
  const escapedCase = cleanSpaces(caseNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedCase) text = text.replace(new RegExp(`^\\s*${escapedCase}\\s*`, "i"), "").trim();
  text = text.replace(/^\s*[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*/i, "").trim();
  text = text.replace(/^\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*/i, "").trim();
  if (escapedCase) text = text.replace(new RegExp(`^\\s*${escapedCase}\\s*`, "i"), "").trim();
  text = text.replace(/\s+(Criminal|Civil)\s+(Local Court|District Court|Supreme Court).*$/i, "").trim();
  return text || cleanSpaces(caseNumber);
}

function composeGmailUrl(to, subject, body) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: cleanSpaces(to),
    su: cleanSpaces(subject),
    body: String(body || "")
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function boolFromPdfValue(value) {
  if (typeof value === "string") {
    return value !== "/Off" && cleanSpaces(value) !== "";
  }
  return Boolean(value);
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let pos = 0; pos < bytes.length; pos += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(pos, pos + chunkSize));
  }
  return btoa(binary);
}

async function ensurePdfLibLoaded() {
  if (!globalThis.PDFLib || !globalThis.PDFLib.PDFDocument) {
    throw new Error("PDF engine not loaded in extension worker.");
  }
  if (!globalThis.fontkit) {
    throw new Error("PDF fontkit runtime not loaded in extension worker.");
  }
  return globalThis.PDFLib;
}

function buildGoogleNewsSearchUrl(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://news.google.com/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
}

function buildGoogleNewsRssUrl(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://news.google.com/rss/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
}

function buildAustliiSearchUrl(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto;query=${q};excerpt=1`;
}

function buildAustliiSearchUrlAlt(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${q}`;
}

function buildNswCaselawSearchUrl(query, page = 1) {
  const q = encodeURIComponent(cleanSpaces(query));
  const p = Math.max(1, Number(page || 1));
  return p > 1
    ? `https://www.caselaw.nsw.gov.au/search?query=${q}&page=${p}`
    : `https://www.caselaw.nsw.gov.au/search?query=${q}`;
}

function buildFederalCourtSearchUrl(query, page = 1) {
  const q = cleanSpaces(query);
  const p = Math.max(1, Number(page || 1));
  const startRank = ((p - 1) * 20) + 1;
  const params = new URLSearchParams({
    collection: "fca~sp-judgments-internet",
    profile: "judgments-internet",
    sort: "date",
    meta_CourtID_orsand: "FCA FCAFC IRCA ACOMPT ACOPYT ADFDAT FPDT NFSC",
    meta_MNC: "",
    meta_Judge: "",
    meta_Reported: "",
    meta_FileNumber: "",
    meta_NPA_phrase_orsand: "",
    query_sand: q,
    query_or: "",
    query_not: "",
    query_phrase: "",
    query_prox: "",
    meta_d: "",
    meta_d1: "",
    meta_d2: "",
    meta_Legislation: "",
    meta_CasesCited: "",
    meta_Catchwords: ""
  });
  if (startRank > 1) {
    params.set("start_rank", String(startRank));
  }
  return `https://search.judgments.fedcourt.gov.au/s/search.html?${params.toString()}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function buildAbnLookupNameUrl(query, maxResults = 10) {
  const q = encodeURIComponent(cleanSpaces(query));
  const size = Math.max(1, Math.min(Number(maxResults || 10), 20));
  return `https://abr.business.gov.au/json/MatchingNames.aspx?name=${q}&maxResults=${size}&guid=${ABN_GUID}&callback=abnCb`;
}

function buildAbnLookupDetailsUrl(abn) {
  const normalized = digitsOnly(abn);
  return `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${normalized}&guid=${ABN_GUID}&callback=abnCb`;
}

function buildAbnCurrentPageUrl(abn) {
  const normalized = digitsOnly(abn);
  return `https://abr.business.gov.au/ABN/View?id=${normalized}`;
}

function buildAbnHistoryPageUrl(abn) {
  const normalized = digitsOnly(abn);
  return `https://abr.business.gov.au/AbnHistory/View?id=${normalized}`;
}

function parseJsonpPayload(text) {
  const raw = String(text || "").trim();
  const firstParen = raw.indexOf("(");
  const lastParen = raw.lastIndexOf(")");
  if (firstParen < 0 || lastParen <= firstParen) {
    throw new Error("ABN Lookup returned invalid JSONP.");
  }
  const json = raw.slice(firstParen + 1, lastParen).trim();
  return JSON.parse(json);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function normalizeHtmlText(value) {
  return cleanSpaces(decodeHtmlEntities(stripTags(value)));
}

function parseTableRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = null;
  while ((rowMatch = rowRe.exec(String(html || "")))) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRe = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch = null;
    while ((cellMatch = cellRe.exec(rowHtml))) {
      const tag = cleanSpaces(cellMatch[1] || "").toLowerCase();
      const attrs = String(cellMatch[2] || "");
      const raw = String(cellMatch[3] || "");
      const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      cells.push({
        tag,
        text: normalizeHtmlText(raw),
        colspan: colspanMatch ? Number(colspanMatch[1]) : 1
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeAbnSectionHeading(value) {
  const key = cleanSpaces(value).toLowerCase().replace(/:$/, "");
  if (key === "entity name") return "entity_name";
  if (key === "abn status") return "abn_status";
  if (key.includes("goods") && key.includes("tax")) return "gst";
  if (key === "main business location") return "main_business_location";
  if (key === "entity type") return "entity_type";
  return "";
}

function parseCurrentDetailsFromHtml(html) {
  const rows = parseTableRows(html);
  const current = {
    entity_name: "",
    abn_status: "",
    entity_type: "",
    gst: "",
    main_business_location: "",
    abn_last_updated: "",
    record_extracted: ""
  };

  rows.forEach((cells) => {
    if (cells.length < 2) return;
    if (cells[0].tag !== "th" || cells[1].tag !== "td") return;
    const heading = normalizeAbnSectionHeading(cells[0].text || "");
    if (!heading) return;
    if (heading === "entity_name") current.entity_name = cleanSpaces(cells[1].text || "");
    if (heading === "abn_status") current.abn_status = cleanSpaces(cells[1].text || "");
    if (heading === "entity_type") current.entity_type = cleanSpaces(cells[1].text || "");
    if (heading === "gst") current.gst = cleanSpaces(cells[1].text || "");
    if (heading === "main_business_location") current.main_business_location = cleanSpaces(cells[1].text || "");
  });

  const updatedMatch = String(html || "").match(/ABN last updated:\s*<\/strong>\s*([\s\S]*?)<\/li>/i);
  if (updatedMatch) {
    current.abn_last_updated = normalizeHtmlText(updatedMatch[1] || "");
  }
  const extractedMatch = String(html || "").match(/Record extracted:\s*<\/strong>\s*([\s\S]*?)<\/li>/i);
  if (extractedMatch) {
    current.record_extracted = normalizeHtmlText(extractedMatch[1] || "");
  }

  return current;
}

function parseHistoryDetailsFromHtml(html) {
  const out = {
    entity_name: [],
    abn_status: [],
    entity_type: "",
    gst: [],
    main_business_location: []
  };
  const rows = parseTableRows(html);
  let section = "";

  rows.forEach((cells) => {
    if (!cells.length) return;

    if (cells[0].tag === "th") {
      const heading = normalizeAbnSectionHeading(cells[0].text || "");
      if (heading) {
        section = heading;
        return;
      }
    }

    if (!section) return;

    if (section === "entity_type") {
      const textCell = cells.find((cell) => cell.tag === "td");
      if (textCell) out.entity_type = cleanSpaces(textCell.text || "");
      return;
    }

    if (cells[0].tag !== "td") return;

    if (cells.length >= 3) {
      out[section].push({
        value: cleanSpaces(cells[0].text || ""),
        from: cleanSpaces(cells[1].text || ""),
        to: cleanSpaces(cells[2].text || "")
      });
      return;
    }

    if (cells.length === 1) {
      out[section].push({
        value: cleanSpaces(cells[0].text || ""),
        from: "",
        to: ""
      });
    }
  });

  return out;
}

async function fetchAbnJsonDetails(abn) {
  const normalized = digitsOnly(abn);
  if (normalized.length !== 11) {
    throw new Error("ABN must be 11 digits.");
  }
  const response = await fetch(buildAbnLookupDetailsUrl(normalized), {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`ABN details request failed (${response.status}).`);
  }
  const jsonpText = await response.text();
  const payload = parseJsonpPayload(jsonpText);
  const remoteMessage = cleanSpaces(payload && payload.Message ? payload.Message : "");
  if (remoteMessage) {
    throw new Error(remoteMessage);
  }
  return {
    abn: cleanSpaces(payload.Abn || normalized),
    abn_status: cleanSpaces(payload.AbnStatus || ""),
    abn_status_effective_from: cleanSpaces(payload.AbnStatusEffectiveFrom || ""),
    entity_name: cleanSpaces(payload.EntityName || ""),
    entity_type: cleanSpaces(payload.EntityTypeName || ""),
    gst_from: cleanSpaces(payload.Gst || ""),
    state: cleanSpaces(payload.AddressState || ""),
    postcode: cleanSpaces(payload.AddressPostcode || "")
  };
}

function nonPartyJurisdictionField(courtText, jurisdictionText = "") {
  const text = cleanSpaces(courtText).toLowerCase();
  const jurisdiction = cleanSpaces(jurisdictionText).toLowerCase();
  if (text.includes("children")) return "Button8";
  if (text.includes("district")) return "Button7";
  if (text.includes("local") || text.includes("coroner")) {
    if (text.includes("civil") || jurisdiction.includes("civil")) return "Button10";
    return "Button6";
  }
  return "";
}

function applyNonPartyDocumentMap(requestedDocs, details, values) {
  if (requestedDocs.has("indictment_can") || requestedDocs.has("originating_process")) values.Button11 = true;
  if (requestedDocs.has("transcript")) {
    values.Button14 = true;
    values.Text34 = cleanSpaces(details.transcript_dates || "");
  }
  if (requestedDocs.has("witness_statements")) values.Button12 = true;
  if (requestedDocs.has("police_fact_sheet")) values.Button13 = true;
  if (requestedDocs.has("record_conviction_or_order")) values.Button15 = true;
  if (requestedDocs.has("sealed_copy_judgment")) values.Button17 = true;
  if (requestedDocs.has("certified_copy_reasons")) values.Button18 = true;
  if (requestedDocs.has("civil_pleading") || requestedDocs.has("originating_process")) {
    values.Button20 = true;
    values.Text31 = cleanSpaces(details.civil_pleading || "Pleadings / originating process");
  }
  if (requestedDocs.has("civil_other_filed")) {
    values.Button21 = true;
    values.Text32 = cleanSpaces(details.civil_other_filed || "Other filed civil document");
  }
  if (requestedDocs.has("exhibits")) {
    values.Button21 = true;
    values.Text32 = cleanSpaces(details.exhibits || "Exhibits");
  }
  if (requestedDocs.has("notice_of_appeal")) {
    values.Button16 = true;
    values.Text33 = "Notice of Appeal / grounds of appeal";
  }
  if (requestedDocs.has("other")) {
    values.Button16 = true;
    values.Text33 = cleanSpaces(details.other || "Other documents as selected");
  }
  if (requestedDocs.has("selected_images")) {
    values.Button16 = true;
    values.Text33 = cleanSpaces(details.selected_images || "Selected images in court file");
  }
}

function mediaValues(profile, matter, requestedDocs, details) {
  const longDate = formatNowLongDate();
  const [plaintiff, defendant] = splitParties(matter);
  const signatureText = signatureFromProfile(profile);
  const allowed = new Set([
    "crown_bundle",
    "submissions",
    "selected_images",
    "originating_process",
    "transcript",
    "exhibits",
    "notice_of_appeal",
    "other"
  ]);
  const unsupported = Array.from(requestedDocs).filter((doc) => doc && !allowed.has(doc)).sort();
  let mediaOther = cleanSpaces(details.other || "");
  if (unsupported.length) {
    mediaOther = cleanSpaces([mediaOther, unsupported.join(", ")].filter(Boolean).join("; "));
  }
  const values = {
    Name: cleanSpaces(profile.applicant_name || ""),
    Organisation: cleanSpaces(profile.organisation || ""),
    "Contact number": cleanSpaces(profile.contact_number || ""),
    Email: cleanSpaces(profile.email || ""),
    "Case number yearnumber": cleanSpaces(matter.case_number || ""),
    "Plaintiff  Appellant name": plaintiff,
    "Defendant  Respondent name": defendant,
    "Applicant Signature": signatureText,
    Dated: longDate,
    "I submit that access to records on the court file should be granted because":
      (
        "There is significant public interest in accredited media having access to documents deployed " +
        "in open court in order to fairly and accurately report on matters before the court - in " +
        "accordance with the principles of open justice and with full acknowledgement of restrictions " +
        "on publication including suppression, non-publication and statutory prohibitions."
      ),
    "Transcript dates": cleanSpaces(details.transcript_dates || ""),
    Exhibits: cleanSpaces(details.exhibits || ""),
    Others: mediaOther,
    "specify images": cleanSpaces(details.selected_images || ""),
    "Check Box63": true,
    "Check Box64": true,
    "Check Box65": true
  };
  Object.entries(MEDIA_DOC_TO_FIELD).forEach(([docKey, fieldName]) => {
    values[fieldName] = requestedDocs.has(docKey);
  });
  return values;
}

function nonPartyValues(profile, matter, requestedDocs, details) {
  const shortDate = formatNowShortDate();
  const signatureText = signatureFromProfile(profile);
  const values = {
    Button1: true,
    Button2: false,
    Button3: false,
    Text22: cleanSpaces(profile.applicant_name || ""),
    Text23: cleanSpaces(profile.occupation || "Journalist"),
    Text24: cleanSpaces(profile.organisation || ""),
    Text25: cleanSpaces(profile.email || ""),
    Text26: cleanSpaces(profile.contact_number || ""),
    Button4: true,
    Button5: false,
    Text27: cleanSpaces(matter.case_number || ""),
    Text28: compactCaseTitle(matter),
    Text29: compactCourtText(matter),
    Text35: cleanSpaces(details.additional_details || ""),
    Button37: true,
    Text48: signatureText,
    Text49: shortDate,
    Text50: cleanSpaces(profile.applicant_name || ""),
    Text51: signatureText,
    Text52: shortDate,
    Button6: false,
    Button7: false,
    Button8: false,
    Button10: false,
    Button11: false,
    Button12: false,
    Button13: false,
    Button14: false,
    Button15: false,
    Button16: false,
    Button17: false,
    Button18: false,
    Button20: false,
    Button21: false
  };
  const jurisdictionField = nonPartyJurisdictionField(
    cleanSpaces(`${matter.court || ""} ${matter.court_location || ""}`),
    matter.jurisdiction
  );
  if (jurisdictionField) values[jurisdictionField] = true;
  NON_PARTY_ACK_FIELDS.forEach((fieldName) => {
    values[fieldName] = true;
  });
  applyNonPartyDocumentMap(requestedDocs, details, values);
  return values;
}

async function loadRuntimeBytes(relativePath) {
  const url = chrome.runtime.getURL(relativePath);
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Missing extension runtime asset: ${relativePath}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function findFieldPageIndex(pdfDoc, pdfLib, fieldName) {
  const titleKey = pdfLib.PDFName.of("T");
  const pages = pdfDoc.getPages();
  for (let idx = 0; idx < pages.length; idx += 1) {
    const annots = pages[idx].node && typeof pages[idx].node.Annots === "function"
      ? pages[idx].node.Annots()
      : null;
    if (!annots || typeof annots.asArray !== "function") continue;
    const refs = annots.asArray();
    for (let i = 0; i < refs.length; i += 1) {
      const dict = pdfDoc.context.lookup(refs[i]);
      if (!dict || typeof dict.get !== "function") continue;
      const rawTitle = dict.get(titleKey);
      const title = rawTitle && typeof rawTitle.decodeText === "function"
        ? cleanSpaces(rawTitle.decodeText())
        : "";
      if (title === fieldName) return idx;
    }
  }
  return -1;
}

function drawSignatureOverlays(pdfDoc, pdfLib, form, values, handwritingFont) {
  if (!handwritingFont) return;
  const pages = pdfDoc.getPages();
  SIGNATURE_FIELD_NAMES.forEach((fieldName) => {
    const text = cleanSpaces(values && values[fieldName] ? values[fieldName] : "");
    if (!text) return;
    let field = null;
    try {
      field = form.getTextField(fieldName);
    } catch (_error) {
      field = null;
    }
    if (!field || !field.acroField || typeof field.acroField.getWidgets !== "function") return;
    const widgets = field.acroField.getWidgets();
    if (!Array.isArray(widgets) || !widgets.length) return;
    const pageIndex = findFieldPageIndex(pdfDoc, pdfLib, fieldName);
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    const page = pages[pageIndex];

    widgets.forEach((widget) => {
      if (!widget || typeof widget.getRectangle !== "function") return;
      const rect = widget.getRectangle();
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return;
      const width = Number(rect.width || 0);
      const height = Number(rect.height || 0);
      if (width <= 0 || height <= 0) return;

      const inset = 0.8;
      const drawWidth = Math.max(0, width - inset * 2);
      const drawHeight = Math.max(0, height - inset * 2);
      page.drawRectangle({
        x: rect.x + inset,
        y: rect.y + inset,
        width: drawWidth,
        height: drawHeight,
        color: pdfLib.rgb(1, 1, 1)
      });

      const maxWidth = Math.max(0, width - 6);
      let fontSize = Math.max(9, Math.min(12, height * 0.7));
      if (typeof handwritingFont.widthOfTextAtSize === "function" && maxWidth > 0) {
        while (fontSize > 6 && handwritingFont.widthOfTextAtSize(text, fontSize) > maxWidth) {
          fontSize -= 0.5;
        }
      }
      page.drawText(text, {
        x: rect.x + 3,
        y: rect.y + Math.max(1, (height - fontSize) / 2),
        size: fontSize,
        font: handwritingFont,
        color: pdfLib.rgb(0, 0, 0)
      });
    });
  });
}

function removeSignatureWidgets(pdfDoc, pdfLib) {
  const titleKey = pdfLib.PDFName.of("T");
  const annotsKey = pdfLib.PDFName.of("Annots");
  const pages = pdfDoc.getPages();
  pages.forEach((page) => {
    const annots = page.node && typeof page.node.Annots === "function"
      ? page.node.Annots()
      : null;
    if (!annots || typeof annots.asArray !== "function") return;
    const kept = annots.asArray().filter((ref) => {
      const dict = pdfDoc.context.lookup(ref);
      if (!dict || typeof dict.get !== "function") return true;
      const rawTitle = dict.get(titleKey);
      const title = rawTitle && typeof rawTitle.decodeText === "function"
        ? cleanSpaces(rawTitle.decodeText())
        : "";
      return !SIGNATURE_FIELD_NAMES.has(title);
    });
    page.node.set(annotsKey, pdfDoc.context.obj(kept));
  });
}

function removeNonPartyCheckboxWidgets(pdfDoc, pdfLib) {
  const titleKey = pdfLib.PDFName.of("T");
  const annotsKey = pdfLib.PDFName.of("Annots");
  const pages = pdfDoc.getPages();
  pages.forEach((page) => {
    const annots = page.node && typeof page.node.Annots === "function"
      ? page.node.Annots()
      : null;
    if (!annots || typeof annots.asArray !== "function") return;
    const kept = annots.asArray().filter((ref) => {
      const dict = pdfDoc.context.lookup(ref);
      if (!dict || typeof dict.get !== "function") return true;
      const rawTitle = dict.get(titleKey);
      const title = rawTitle && typeof rawTitle.decodeText === "function"
        ? cleanSpaces(rawTitle.decodeText())
        : "";
      return !/^Button\d+$/i.test(title);
    });
    page.node.set(annotsKey, pdfDoc.context.obj(kept));
  });
}

async function drawCheckedBoxOverlays(pdfDoc, pdfLib, fieldMap, values) {
  let markerFont = null;
  try {
    markerFont = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  } catch (_error) {
    markerFont = null;
  }
  if (!markerFont) return;

  const pages = pdfDoc.getPages();
  Object.entries(values || {}).forEach(([fieldName, rawValue]) => {
    const field = fieldMap.get(fieldName);
    if (!field) return;
    const isCheckBox = typeof field.check === "function" && typeof field.uncheck === "function";
    if (!isCheckBox || !boolFromPdfValue(rawValue)) return;
    if (!field.acroField || typeof field.acroField.getWidgets !== "function") return;

    const pageIndex = findFieldPageIndex(pdfDoc, pdfLib, fieldName);
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    const page = pages[pageIndex];

    field.acroField.getWidgets().forEach((widget) => {
      if (!widget || typeof widget.getRectangle !== "function") return;
      const rect = widget.getRectangle();
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return;
      const width = Number(rect.width || 0);
      const height = Number(rect.height || 0);
      if (width <= 0 || height <= 0) return;

      const size = Math.max(7, Math.min(11, Math.min(width, height) * 0.8));
      page.drawText("X", {
        x: rect.x + 1,
        y: rect.y + Math.max(0.6, (height - size) / 2),
        size,
        font: markerFont,
        color: pdfLib.rgb(0, 0, 0)
      });
    });
  });
}

async function fillPdfTemplate(templateRelativePath, values, fieldFontSizes = {}) {
  const pdfLib = await ensurePdfLibLoaded();
  const templateBytes = await loadRuntimeBytes(templateRelativePath);
  const pdfDoc = await pdfLib.PDFDocument.load(templateBytes, { ignoreEncryption: true });
  pdfDoc.registerFontkit(globalThis.fontkit);
  const DA_KEY = pdfLib.PDFName.of("DA");
  const OFF_AP_STATE = pdfLib.PDFName.of("Off");
  const FALLBACK_DA = pdfLib.PDFString.of("/Helvetica 11 Tf 0 g");
  const form = pdfDoc.getForm();
  const fieldMap = new Map(form.getFields().map((field) => [field.getName(), field]));
  let handwritingFont = null;
  let textAppearanceFont = null;
  const textFields = [];

  const hasSignatureValues = Object.entries(values || {}).some(([name, value]) =>
    SIGNATURE_FIELD_NAMES.has(name) && cleanSpaces(value) !== ""
  );
  if (hasSignatureValues) {
    try {
      const handwritingFontBytes = await loadRuntimeBytes(HANDWRITING_FONT_PATH);
      handwritingFont = await pdfDoc.embedFont(handwritingFontBytes, { subset: true });
    } catch (_error) {
      handwritingFont = null;
    }
    if (!handwritingFont) {
      throw new Error("Unable to load signature font. Reload the extension and try again.");
    }
  }

  try {
    textAppearanceFont = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  } catch (_error) {
    textAppearanceFont = null;
  }

  Object.entries(values || {}).forEach(([name, rawValue]) => {
    const field = fieldMap.get(name);
    if (!field) return;
    try {
      const isCheckBox = typeof field.check === "function" && typeof field.uncheck === "function";
      const isTextField = typeof field.setText === "function";
      const isSelectable = typeof field.select === "function";
      const hasOptions = typeof field.getOptions === "function";

      if (isCheckBox) {
        const checked = boolFromPdfValue(rawValue);
        if (checked) field.check();
        else field.uncheck();
        if (field.acroField && typeof field.acroField.getWidgets === "function") {
          field.acroField.getWidgets().forEach((widget) => {
            try {
              const onState = typeof widget.getOnValue === "function" ? widget.getOnValue() : null;
              if (typeof widget.setAppearanceState === "function") {
                widget.setAppearanceState(checked && onState ? onState : OFF_AP_STATE);
              }
            } catch (_error) {
              // Keep processing remaining widgets/fields.
            }
          });
        }
        return;
      }

      if (isTextField) {
        if (field && field.acroField && field.acroField.dict) {
          field.acroField.dict.set(DA_KEY, FALLBACK_DA);
        }
        const textValue = rawValue === undefined || rawValue === null ? "" : String(rawValue);
        field.setText(textValue);
        if (fieldFontSizes[name] && typeof field.setFontSize === "function") {
          field.setFontSize(Number(fieldFontSizes[name]));
        }
        textFields.push({ field, name, textValue });
        return;
      }

      if (isSelectable) {
        if (hasOptions) {
          const options = field.getOptions();
          if (Array.isArray(options) && options.length) {
            if (boolFromPdfValue(rawValue)) {
              const valueText = rawValue === undefined || rawValue === null ? "" : String(rawValue);
              field.select(options.includes(valueText) ? valueText : options[0]);
            } else if (typeof field.clear === "function") {
              field.clear();
            }
          }
          return;
        }
        field.select(rawValue === undefined || rawValue === null ? "" : String(rawValue));
        return;
      }
    } catch (_err) {
      // Continue writing remaining fields even if one field fails.
    }
  });

  textFields.forEach(({ field, name, textValue }) => {
    const isSignatureField = Boolean(SIGNATURE_FIELD_NAMES.has(name) && textValue);
    try {
      if (isSignatureField) {
        return;
      }
      if (textAppearanceFont && typeof field.updateAppearances === "function") {
        field.updateAppearances(textAppearanceFont);
        return;
      }
      if (typeof field.defaultUpdateAppearances === "function") {
        field.defaultUpdateAppearances();
      }
    } catch (error) {
      // Keep generating if one non-signature text appearance cannot update.
    }
  });

  if (hasSignatureValues) {
    drawSignatureOverlays(pdfDoc, pdfLib, form, values, handwritingFont);
    removeSignatureWidgets(pdfDoc, pdfLib);
  }

  if (templateRelativePath === FORM_TEMPLATE_NON_PARTY) {
    await drawCheckedBoxOverlays(pdfDoc, pdfLib, fieldMap, values);
    removeNonPartyCheckboxWidgets(pdfDoc, pdfLib);
  }

  return new Uint8Array(await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

async function savePdfToDownloads(fileName, bytes) {
  const base64 = uint8ToBase64(bytes);
  const dataUrl = `data:application/pdf;base64,${base64}`;
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: `${DOWNLOAD_SUBDIR}/${fileName}`,
        saveAs: false,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || "Download failed."));
          return;
        }
        if (!downloadId) {
          reject(new Error("Download failed."));
          return;
        }
        resolve();
      }
    );
  });
}

function ensureProfileFromPayload(profile) {
  const candidate = profile || {};
  if (!cleanSpaces(candidate.applicant_name)) {
    throw new Error("Profile missing. Set applicant details in the extension drawer, then generate again.");
  }
  return {
    applicant_name: cleanSpaces(candidate.applicant_name),
    organisation: cleanSpaces(candidate.organisation || ""),
    contact_number: cleanSpaces(candidate.contact_number || ""),
    email: cleanSpaces(candidate.email || ""),
    occupation: cleanSpaces(candidate.occupation || "Journalist"),
    signature_text: cleanSpaces(candidate.signature_text || "")
  };
}

async function generateLocally(body) {
  const matterRaw = body && body.matter ? body.matter : {};
  const matter = {
    case_number: cleanSpaces(matterRaw.case_number || ""),
    matter_name: cleanSpaces(matterRaw.matter_name || ""),
    court: cleanSpaces(matterRaw.court || ""),
    jurisdiction: cleanSpaces(matterRaw.jurisdiction || ""),
    court_location: cleanSpaces(matterRaw.court_location || ""),
    listing_date: cleanSpaces(matterRaw.listing_date || ""),
    plaintiff: cleanSpaces(matterRaw.plaintiff || ""),
    defendant: cleanSpaces(matterRaw.defendant || "")
  };

  if (!matter.case_number) {
    throw new Error("Missing case number.");
  }

  const incomingProfile = body && body.profile ? body.profile : null;
  const storedProfile = await storageGet(PROFILE_KEY);
  const profile = ensureProfileFromPayload(incomingProfile || storedProfile || {});
  if (incomingProfile) {
    await storageSet({ [PROFILE_KEY]: profile });
  }

  const requestedDocsRaw = Array.isArray(body && body.requested_documents)
    ? body.requested_documents
    : [];
  let requestedDocs = new Set(requestedDocsRaw.map((item) => cleanSpaces(item)).filter(Boolean));
  const details = body && body.document_details && typeof body.document_details === "object"
    ? body.document_details
    : {};
  const applications = effectiveApplications(matter.court, body && body.applications ? body.applications : {});

  const stamp = timestampStamp();
  const safeCase = slug(matter.case_number);
  const safeName = slug(matter.matter_name).slice(0, 60);
  const baseName = `${stamp}_${safeCase}_${safeName || "matter"}`;

  const generatedFiles = [];
  const attachments = [];

  if (applications.media_access_2026) {
    const fileName = `${baseName}_media_access_2026.pdf`;
    const pdfBytes = await fillPdfTemplate(
      FORM_TEMPLATE_MEDIA,
      mediaValues(profile, matter, requestedDocs, details),
      {}
    );
    await savePdfToDownloads(fileName, pdfBytes);
    generatedFiles.push(`${DOWNLOAD_SUBDIR}/${fileName}`);
    attachments.push({
      name: fileName,
      mime: "application/pdf",
      base64: uint8ToBase64(pdfBytes)
    });
  }

  if (applications.non_party_access) {
    const fileName = `${baseName}_non_party_access.pdf`;
    const pdfBytes = await fillPdfTemplate(
      FORM_TEMPLATE_NON_PARTY,
      nonPartyValues(profile, matter, requestedDocs, details),
      NON_PARTY_FIELD_FONT_SIZES
    );
    await savePdfToDownloads(fileName, pdfBytes);
    generatedFiles.push(`${DOWNLOAD_SUBDIR}/${fileName}`);
    attachments.push({
      name: fileName,
      mime: "application/pdf",
      base64: uint8ToBase64(pdfBytes)
    });
  }

  if (!generatedFiles.length) {
    throw new Error("No forms selected for generation.");
  }

  const [recipient] = resolveCourtRecipient(matter.court);
  const subjectMatter = normalizeMatterName(matter.case_number, matter.matter_name);
  const subject = cleanSpaces(`${matter.case_number} ${subjectMatter}`);
  return {
    generated_files: generatedFiles,
    output_folder: "Chrome Downloads",
    attachment_urls: attachments,
    email_to: recipient,
    email_subject: subject,
    email_body: EMAIL_BODY,
    gmail_compose_url: composeGmailUrl(recipient, subject, EMAIL_BODY),
    gmail_draft_id: null,
    open_email_url: composeGmailUrl(recipient, subject, EMAIL_BODY),
    applications_effective: applications
  };
}

async function handleApiRequest(message) {
  const path = message.path || "/health";
  const method = (message.method || "GET").toUpperCase();
  const body = message.body;
  if (path === "/health" && method === "GET") {
    return {
      status: "ok",
      mode: "extension_local"
    };
  }
  if (path === "/generate" && method === "POST") {
    return generateLocally(body || {});
  }
  throw new Error(`Unsupported local API route: ${method} ${path}`);
}

async function handleNewsSearch(message) {
  const query = cleanSpaces(message && message.query ? message.query : "");
  if (!query) {
    throw new Error("Missing news search query.");
  }

  const rssUrl = buildGoogleNewsRssUrl(query);
  const webUrl = buildGoogleNewsSearchUrl(query);
  const response = await fetch(rssUrl, {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Google News request failed (${response.status}).`);
  }
  const rss = await response.text();
  return {
    query,
    rss,
    rss_url: rssUrl,
    web_url: webUrl
  };
}

async function handleAbnSearch(message) {
  const rawQuery = cleanSpaces(message && message.query ? message.query : "");
  if (!rawQuery) {
    throw new Error("Missing ABN search query.");
  }
  const exactRequested = Boolean(message?.exact) || /^".*"$/.test(rawQuery);
  const exactPhrase = cleanSpaces(rawQuery.replace(/^"/, "").replace(/"$/, ""));
  const query = exactPhrase || rawQuery;

  const normalizedAbn = digitsOnly(query);
  const isAbnSearch = normalizedAbn.length === 11;
  const url = isAbnSearch
    ? buildAbnLookupDetailsUrl(normalizedAbn)
    : buildAbnLookupNameUrl(query, Number(message?.maxResults || 10));

  if (isAbnSearch) {
    const details = await fetchAbnJsonDetails(normalizedAbn);
    return {
      query,
      search_type: "abn",
      result: details
    };
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`ABN Lookup request failed (${response.status}).`);
  }

  const jsonpText = await response.text();
  const payload = parseJsonpPayload(jsonpText);
  const remoteMessage = cleanSpaces(payload && payload.Message ? payload.Message : "");
  if (remoteMessage) {
    throw new Error(remoteMessage);
  }

  const rows = Array.isArray(payload.Names) ? payload.Names : [];
  const baseRows = rows.map((item) => ({
    abn: cleanSpaces(item.Abn || ""),
    matched_name: cleanSpaces(item.Name || ""),
    state: cleanSpaces(item.State || ""),
    postcode: cleanSpaces(item.Postcode || "")
  }));

  const enriched = await Promise.all(
    baseRows.map(async (item) => {
      if (!item.abn) return item;
      try {
        const details = await fetchAbnJsonDetails(item.abn);
        return {
          ...item,
          abn: details.abn || item.abn,
          entity_name: details.entity_name || item.matched_name,
          abn_status: details.abn_status || "",
          state: details.state || item.state,
          postcode: details.postcode || item.postcode
        };
      } catch (_error) {
        return {
          ...item,
          entity_name: item.matched_name
        };
      }
    })
  );

  const filtered = (!isAbnSearch && exactRequested && exactPhrase)
    ? enriched.filter((item) => {
        const hay = cleanSpaces(item.entity_name || item.matched_name || "").toLowerCase();
        return hay.includes(exactPhrase.toLowerCase());
      })
    : enriched;

  return {
    query,
    search_type: "name",
    results: filtered,
    exact_applied: Boolean(!isAbnSearch && exactRequested && exactPhrase),
    exact_phrase: exactPhrase
  };
}

async function handleCaselawSearch(message) {
  const query = cleanSpaces(message && message.query ? message.query : "");
  if (!query) {
    throw new Error("Missing caselaw search query.");
  }
  const page = Math.max(1, Number(message?.page || 1));

  const austliiCandidates = [buildAustliiSearchUrl(query), buildAustliiSearchUrlAlt(query)];
  let webUrl = austliiCandidates[0];
  let response = null;
  let austliiStatus = 0;

  // NSW Caselaw has reliable page param support; use it directly for page > 1.
  if (page === 1) {
    for (let i = 0; i < austliiCandidates.length; i += 1) {
      webUrl = austliiCandidates[i];
      response = await fetch(webUrl, {
        method: "GET",
        cache: "no-store"
      });
      if (response.ok) {
        austliiStatus = response.status;
        break;
      }
      austliiStatus = response.status;
    }
  }

  let source = "AustLII";
  if (!response || !response.ok) {
    webUrl = buildNswCaselawSearchUrl(query, page);
    response = await fetch(webUrl, {
      method: "GET",
      cache: "no-store"
    });
    source = "NSW Caselaw";
    if (!response.ok) {
      throw new Error(`Caselaw requests failed (AustLII ${austliiStatus}; NSW Caselaw ${response.status}).`);
    }
  }

  const html = await response.text();
  return {
    query,
    page,
    html,
    web_url: webUrl,
    source,
    austlii_excerpt_url: buildAustliiSearchUrl(query),
    nsw_caselaw_url: buildNswCaselawSearchUrl(query, page)
  };
}

async function handleFederalCourtSearch(message) {
  const query = cleanSpaces(message && message.query ? message.query : "");
  if (!query) {
    throw new Error("Missing Federal Court search query.");
  }
  const page = Math.max(1, Number(message?.page || 1));
  const webUrl = buildFederalCourtSearchUrl(query, page);
  const response = await fetch(webUrl, {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Federal Court search request failed (${response.status}).`);
  }
  const html = await response.text();
  return {
    query,
    page,
    html,
    web_url: webUrl,
    source: "Federal Court"
  };
}

async function handleAbnHistoryDetails(message) {
  const normalized = digitsOnly(message && message.abn ? message.abn : "");
  if (normalized.length !== 11) {
    throw new Error("ABN must be 11 digits.");
  }

  const [currentResponse, historyResponse] = await Promise.all([
    fetch(buildAbnCurrentPageUrl(normalized), { method: "GET", cache: "no-store" }),
    fetch(buildAbnHistoryPageUrl(normalized), { method: "GET", cache: "no-store" })
  ]);

  if (!currentResponse.ok) {
    throw new Error(`ABN current details request failed (${currentResponse.status}).`);
  }
  if (!historyResponse.ok) {
    throw new Error(`ABN historical details request failed (${historyResponse.status}).`);
  }

  const [currentHtml, historyHtml] = await Promise.all([
    currentResponse.text(),
    historyResponse.text()
  ]);

  return {
    abn: normalized,
    record_url: buildAbnCurrentPageUrl(normalized),
    history_url: buildAbnHistoryPageUrl(normalized),
    current: parseCurrentDetailsFromHtml(currentHtml),
    history: parseHistoryDetailsFromHtml(historyHtml)
  };
}

async function handleFetchAttachments(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const out = [];
  for (let i = 0; i < attachments.length; i += 1) {
    const item = attachments[i] || {};
    if (item.base64) {
      out.push({
        name: item.name || `attachment-${i + 1}.pdf`,
        mime: item.mime || "application/pdf",
        base64: String(item.base64)
      });
      continue;
    }
    if (!item.url) {
      continue;
    }
    const response = await fetch(item.url, { method: "GET" });
    if (!response.ok) {
      continue;
    }
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    for (let pos = 0; pos < bytes.length; pos += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(pos, pos + chunkSize));
    }
    out.push({
      name: item.name || `attachment-${i + 1}.pdf`,
      mime: blob.type || "application/pdf",
      base64: btoa(binary)
    });
  }
  return out;
}

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "storage get failed"));
        return;
      }
      resolve(result ? result[key] : undefined);
    });
  });
}

function storageSet(entries) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "storage set failed"));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([key], () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "storage remove failed"));
        return;
      }
      resolve();
    });
  });
}

function pendingKey(tabId) {
  return `${ATTACH_KEY_PREFIX}${tabId}`;
}

function alarmName(tabId) {
  return `${ATTACH_ALARM_PREFIX}${tabId}`;
}

function parseTabIdFromAlarm(name) {
  if (!name || !name.startsWith(ATTACH_ALARM_PREFIX)) return null;
  const raw = name.slice(ATTACH_ALARM_PREFIX.length);
  const tabId = Number(raw);
  if (!Number.isFinite(tabId)) return null;
  return tabId;
}

async function getPendingAttach(tabId) {
  return storageGet(pendingKey(tabId));
}

async function setPendingAttach(tabId, payload) {
  await storageSet({ [pendingKey(tabId)]: payload });
}

async function clearPendingAttach(tabId) {
  await storageRemove(pendingKey(tabId));
  await new Promise((resolve) => {
    chrome.alarms.clear(alarmName(tabId), () => resolve());
  });
}

function scheduleAttachRetry(tabId, delayMs = ATTACH_RETRY_MS) {
  chrome.alarms.create(alarmName(tabId), { when: Date.now() + delayMs });
}

function getTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      const err = chrome.runtime.lastError;
      if (err || !tab) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function runAttachScript(tabId, filePayloads) {
  return new Promise((resolve) => {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      resolve({ ok: false, attached: 0, error: "chrome.scripting API unavailable." });
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "ISOLATED",
        func: async (payloads) => {
          const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

          const detectComposeRoot = () => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (dialog) return dialog;

            const messageBody =
              document.querySelector('[aria-label="Message Body"]') ||
              document.querySelector('div[g_editable="true"]') ||
              document.querySelector('div[contenteditable="true"][role="textbox"]') ||
              document.querySelector('div[contenteditable="true"][aria-label*="Message"]') ||
              document.querySelector('textarea[name="body"]') ||
              document.querySelector('textarea[aria-label*="Message"]');

            if (messageBody) {
              return (
                messageBody.closest('div[role="dialog"]') ||
                messageBody.closest("form") ||
                messageBody.closest('div[role="main"]') ||
                document.body
              );
            }

            const subjectField =
              document.querySelector('input[name="subjectbox"]') ||
              document.querySelector('input[name="subject"]') ||
              document.querySelector('input[placeholder*="Subject"]');

            if (subjectField) {
              return (
                subjectField.closest('div[role="dialog"]') ||
                subjectField.closest("form") ||
                subjectField.closest('div[role="main"]') ||
                document.body
              );
            }

            const toField =
              document.querySelector('textarea[name="to"]') ||
              document.querySelector('input[aria-label^="To"]') ||
              document.querySelector('textarea[aria-label^="To"]');

            if (toField) {
              return (
                toField.closest('div[role="dialog"]') ||
                toField.closest("form") ||
                toField.closest('div[role="main"]') ||
                document.body
              );
            }

            return null;
          };

          const waitForComposeRoot = async (timeoutMs) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const root = detectComposeRoot();
              if (root) return root;
              await wait(300);
            }
            return null;
          };

          const b64ToFile = (base64, fileName, mime) => {
            const binary = atob(base64 || "");
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            return new File([bytes], fileName || "attachment.pdf", { type: mime || "application/pdf" });
          };

          const findFileInput = (composeRoot) => {
            const selectors = [
              'input[type="file"][name="Filedata"]',
              'input[type="file"][multiple]',
              'input[type="file"]'
            ];
            for (const selector of selectors) {
              const local = composeRoot.querySelector(selector);
              if (local) return local;
              const global = document.querySelector(selector);
              if (global) return global;
            }
            return null;
          };

          const setInputFiles = (input, files) => {
            const dt = new DataTransfer();
            files.forEach((file) => dt.items.add(file));
            try {
              input.files = dt.files;
            } catch (error) {
              return false;
            }
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return Boolean(input.files && input.files.length);
          };

          const clickAttachButton = (composeRoot) => {
            const button =
              composeRoot.querySelector('div[command="Files"]') ||
              composeRoot.querySelector('[data-tooltip*="Attach files"]') ||
              composeRoot.querySelector('[data-tooltip*="Attach"]') ||
              composeRoot.querySelector('[aria-label*="Attach"]') ||
              document.querySelector('div[command="Files"]') ||
              document.querySelector('[data-tooltip*="Attach files"]') ||
              document.querySelector('[data-tooltip*="Attach"]') ||
              document.querySelector('[aria-label*="Attach"]');
            if (button) {
              button.click();
              return true;
            }
            return false;
          };

          const dropFiles = (target, files) => {
            const dt = new DataTransfer();
            files.forEach((file) => dt.items.add(file));
            ["dragenter", "dragover", "drop"].forEach((eventType) => {
              try {
                target.dispatchEvent(
                  new DragEvent(eventType, {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                  })
                );
              } catch (error) {
                // Keep trying via other methods.
              }
            });
          };

          const countNameMatches = (_composeRoot, names) => {
            const haystack = `${document.body ? document.body.innerText || "" : ""}`;
            let matches = 0;
            names.forEach((name) => {
              if (!name) return;
              if (haystack.includes(name)) matches += 1;
            });
            return matches;
          };

          const indicatorCount = (composeRoot) => {
            return [
              ...composeRoot.querySelectorAll('[title$=".pdf"]'),
              ...composeRoot.querySelectorAll('[aria-label$=".pdf"]'),
              ...composeRoot.querySelectorAll('[data-tooltip$=".pdf"]'),
              ...composeRoot.querySelectorAll("span.aV3"),
              ...composeRoot.querySelectorAll("span.aZo"),
              ...document.querySelectorAll('[title$=".pdf"]'),
              ...document.querySelectorAll('[aria-label$=".pdf"]'),
              ...document.querySelectorAll('[data-tooltip$=".pdf"]'),
              ...document.querySelectorAll("span.aV3"),
              ...document.querySelectorAll("span.aZo")
            ].length;
          };

          const waitForUploadedIndicators = async (composeRoot, names, timeoutMs) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const indicator = indicatorCount(composeRoot);
              const matchCount = countNameMatches(composeRoot, names);
              if (indicator > 0 || matchCount > 0) {
                return Math.max(indicator, matchCount);
              }
              await wait(400);
            }
            return 0;
          };

          const composeRoot = (await waitForComposeRoot(45000)) || document.body;

          const files = Array.isArray(payloads)
            ? payloads.map((item, idx) => b64ToFile(item.base64, item.name || `attachment-${idx + 1}.pdf`, item.mime))
            : [];
          if (!files.length) {
            return { ok: false, attached: 0, error: "No attachment payloads to upload." };
          }

          let input = findFileInput(composeRoot);
          if (!input) {
            clickAttachButton(composeRoot);
            await wait(450);
            input = findFileInput(composeRoot);
          }

          let injectedViaInput = false;
          if (input) {
            injectedViaInput = setInputFiles(input, files);
          }

          if (!injectedViaInput) {
            const bodyTarget =
              composeRoot.querySelector('[aria-label="Message Body"]') ||
              composeRoot.querySelector('textarea[name="body"]') ||
              document.querySelector('[aria-label="Message Body"]') ||
              document.querySelector('textarea[name="body"]') ||
              composeRoot;
            dropFiles(bodyTarget, files);
            await wait(180);
            dropFiles(composeRoot, files);
          }

          const names = files.map((f) => f.name || "").filter(Boolean);
          const attached = await waitForUploadedIndicators(composeRoot, names, 20000);
          if (attached > 0) {
            return { ok: true, attached };
          }
          return { ok: false, attached: 0, error: "Attachment upload not detected in Gmail UI." };
        },
        args: [filePayloads]
      },
      (results) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, attached: 0, error: String(err.message || err) });
          return;
        }
        const first = Array.isArray(results) && results.length ? results[0].result : null;
        if (!first || typeof first !== "object") {
          resolve({ ok: false, attached: 0, error: "No attach result from injected script." });
          return;
        }
        resolve({
          ok: Boolean(first.ok),
          attached: Number(first.attached || 0),
          error: first.error ? String(first.error) : ""
        });
      }
    );
  });
}

async function failAndRetry(tabId, pending, reason, delayMs = ATTACH_RETRY_MS) {
  const nextAttempts = Number(pending.attempts || 0) + 1;
  const payload = {
    ...pending,
    attempts: nextAttempts,
    last_error: reason,
    last_attempt_at: Date.now()
  };
  await setPendingAttach(tabId, payload);

  if (nextAttempts >= ATTACH_MAX_ATTEMPTS) {
    console.warn("[NSW Autofill] Attachment retries exhausted", { tabId, nextAttempts, reason });
    await clearPendingAttach(tabId);
    return;
  }

  console.warn("[NSW Autofill] Attach retry scheduled", { tabId, nextAttempts, reason });
  scheduleAttachRetry(tabId, delayMs);
}

async function tryAttachOnTab(tabId) {
  if (activeAttachRuns.has(tabId)) {
    return;
  }
  activeAttachRuns.add(tabId);

  try {
    const pending = await getPendingAttach(tabId);
    if (!pending) return;

    const currentAttempts = Number(pending.attempts || 0);
    if (currentAttempts >= ATTACH_MAX_ATTEMPTS) {
      await clearPendingAttach(tabId);
      return;
    }

    const tab = await getTab(tabId);
    if (!tab || !tab.url || !tab.url.startsWith("https://mail.google.com/")) {
      scheduleAttachRetry(tabId);
      return;
    }

    const filePayloads = await handleFetchAttachments({
      attachments: Array.isArray(pending.attachments) ? pending.attachments : []
    });
    if (!filePayloads.length) {
      await failAndRetry(tabId, pending, "Could not prepare attachment files.");
      return;
    }

    const result = await runAttachScript(tabId, filePayloads);
    if (result.ok && result.attached > 0) {
      console.info("[NSW Autofill] Attach succeeded", { tabId, attached: result.attached });
      await clearPendingAttach(tabId);
      return;
    }

    await failAndRetry(tabId, pending, result.error || "Unknown attach error.");
  } catch (error) {
    const pending = await getPendingAttach(tabId);
    if (pending) {
      await failAndRetry(tabId, pending, String(error && error.message ? error.message : error));
    }
  } finally {
    activeAttachRuns.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "API_REQUEST") {
      const data = await handleApiRequest(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "FETCH_ATTACHMENTS") {
      const data = await handleFetchAttachments(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "NEWS_SEARCH") {
      const data = await handleNewsSearch(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "ABN_SEARCH") {
      const data = await handleAbnSearch(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "CASELAW_SEARCH") {
      const data = await handleCaselawSearch(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "FEDERAL_COURT_SEARCH") {
      const data = await handleFederalCourtSearch(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "ABN_HISTORY_DETAILS") {
      const data = await handleAbnHistoryDetails(message);
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === "PROFILE_GET") {
      const profile = await storageGet(PROFILE_KEY);
      sendResponse({ ok: true, data: profile || null });
      return;
    }

    if (message?.type === "PROFILE_SAVE") {
      const profile = message.profile || {};
      await storageSet({ [PROFILE_KEY]: profile });
      sendResponse({ ok: true, data: { saved: true } });
      return;
    }

    if (message?.type === "OPEN_GMAIL_WITH_ATTACHMENTS") {
      const composeUrl = message.composeUrl;
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      if (!composeUrl) {
        sendResponse({ ok: false, error: "Missing composeUrl." });
        return;
      }

      chrome.tabs.create({ url: composeUrl, active: true }, (tab) => {
        if (!tab || typeof tab.id !== "number") {
          sendResponse({ ok: false, error: "Could not open Gmail tab." });
          return;
        }
        setPendingAttach(tab.id, {
          attachments,
          attempts: 0,
          created_at: Date.now()
        })
          .then(() => {
            scheduleAttachRetry(tab.id, 900);
            sendResponse({ ok: true, data: { tabId: tab.id } });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: String(error && error.message ? error.message : error)
            });
          });
      });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!tab.url || !tab.url.startsWith("https://mail.google.com/")) return;
  tryAttachOnTab(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearPendingAttach(tabId).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const tabId = parseTabIdFromAlarm(alarm?.name || "");
  if (tabId === null) return;
  tryAttachOnTab(tabId).catch(() => {});
});
