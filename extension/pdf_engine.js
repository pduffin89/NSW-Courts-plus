/**
 * pdf_engine.js
 * In-extension PDF form filling engine.
 * JavaScript port of service/autofill/pdf_forms.py, orchestrator.py,
 * emailing.py and config.py - runs entirely in the Chrome extension
 * service worker using pdf-lib (loaded via importScripts before this file).
 *
 * Exposes:
 *   generateFormsInExtension(request)  -> { generated_files, attachment_urls, ... }
 *   storeTemplateBytes(name, bytes)    -> Promise<void>
 *   getTemplateBytes(name)             -> Promise<Uint8Array|null>
 *   listStoredTemplates()              -> Promise<string[]>
 *   TEMPLATE_NAMES                     -> { MEDIA, NON_PARTY }
 */

// ---------------------------------------------------------------------------
// Constants (from service/autofill/config.py)
// ---------------------------------------------------------------------------

const TEMPLATE_NAMES = {
  MEDIA: "media_access_2026",
  NON_PARTY: "non_party_access",
};

const MEDIA_DOC_TO_FIELD = {
  crown_bundle:        "Check Box39",
  submissions:         "Check Box40",
  selected_images:     "Check Box41",
  originating_process: "Check Box50",
  transcript:          "Check Box51",
  exhibits:            "Check Box52",
  notice_of_appeal:    "Check Box53",
  other:               "Check Box54",
};

const NON_PARTY_ACK_FIELDS = [
  "Button39","Button40","Button41","Button42","Button43",
  "Button44","Button45","Button46","Button47",
];

// Fields in the non-party form that require a non-default font size.
const NON_PARTY_FIELD_FONT_SIZES = {
  Text28: 9.0,
  Text29: 9.0,
  Text48: 11.0,
  Text51: 11.0,
};

const EMAIL_BODY =
  "Hey folks\n" +
  "Can I please get the latest outcomes, next dates, NPOs or any other orders, suburb and YOB.\n" +
  "Applying for the following docs as well.\n" +
  "Thanks heaps";

const DEFAULT_REQUESTED_DOCS = new Set(["originating_process", "transcript", "exhibits"]);

// ---------------------------------------------------------------------------
// String / text helpers (from pdf_forms.py)
// ---------------------------------------------------------------------------

function _cleanSpaces(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function _slug(value) {
  const s = _cleanSpaces(value).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "matter";
}

function _truncate(value, maxLen) {
  const text = _cleanSpaces(value);
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return text.slice(0, maxLen - 3).trimEnd() + "...";
}

function _lastName(value) {
  const text = _cleanSpaces(value);
  if (!text) return "";
  const tokens = text.match(/[A-Za-z][A-Za-z'\-]*/g);
  if (tokens && tokens.length) return tokens[tokens.length - 1];
  const parts = text.split(" ");
  return parts[parts.length - 1];
}

function _stripSignaturePrefix(value) {
  return _cleanSpaces(value).replace(/^\/s\/\s*/i, "");
}

function _effectiveSignatureText(profile) {
  const explicit = _stripSignaturePrefix(profile.signature_text || "");
  if (explicit) return explicit;
  return _stripSignaturePrefix(profile.applicant_name || "");
}

function _splitParties(matter) {
  const plaintiff = _cleanSpaces(matter.plaintiff || "");
  const defendant = _cleanSpaces(matter.defendant || "");
  if (plaintiff && defendant) return [plaintiff, defendant];
  const parts = (matter.matter_name || "").split(/\bv\b/i);
  if (parts.length >= 2) {
    return [
      parts[0].trim().replace(/^[\s\-:]+|[\s\-:]+$/g, ""),
      parts[1].trim().replace(/^[\s\-:]+|[\s\-:]+$/g, ""),
    ];
  }
  return [matter.matter_name || "", ""];
}

function _abbreviateCourtName(court) {
  let text = _cleanSpaces(court);
  if (!text) return "";
  text = text.replace(/\bSupreme Court\b/gi,   "Supreme Ct");
  text = text.replace(/\bDistrict Court\b/gi,   "District Ct");
  text = text.replace(/\bLocal Court\b/gi,       "Local Ct");
  text = text.replace(/\bChildren'?s Court\b/gi, "Children's Ct");
  text = text.replace(/\bCoroner'?s Court\b/gi,  "Coroner's Ct");
  return _cleanSpaces(text);
}

function _compactCaseTitle(matter, maxLen = 24) {
  const full = _cleanSpaces(matter.matter_name || "");
  if (!full) return _truncate(matter.case_number || "", maxLen);
  if (full.length <= maxLen) return full;

  const [plaintiff, defendant] = _splitParties(matter);
  const lhs = _cleanSpaces(plaintiff) || "R";
  const rhs = _lastName(matter.defendant || defendant);
  if (rhs) {
    const candidate = _cleanSpaces(`${lhs} v ${rhs}`);
    if (candidate.length <= maxLen) return candidate;
  }
  return _truncate(full, maxLen);
}

function _compactCourtText(matter, maxLen = 24) {
  const location = _cleanSpaces(matter.court_location || "");
  const shortLocation = _cleanSpaces(
    location.replace(/\bDivision\b/gi, "Div").replace(/\bCourt\b/gi, "Ct")
  );
  const court = _abbreviateCourtName(matter.court || "");

  if (shortLocation && shortLocation.length <= maxLen) return shortLocation;
  if (location && location.length <= maxLen)           return location;
  if (court && court.length <= maxLen)                 return court;
  if (location && court) {
    const withCourt = _cleanSpaces(`${location} (${court})`);
    if (withCourt.length <= maxLen) return withCourt;
  }
  if (location) return _truncate(shortLocation, maxLen);
  return _truncate(court || matter.court || "", maxLen);
}

// ---------------------------------------------------------------------------
// Date / timestamp helpers
// ---------------------------------------------------------------------------

function _nowInSydney() {
  // Produce a Date object adjusted to Australia/Sydney local time.
  // Intl.DateTimeFormat gives us the local time parts without requiring a TZ lib.
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map(({ type, value }) => [type, value])
  );
  return {
    year:   parseInt(parts.year,   10),
    month:  parseInt(parts.month,  10),
    day:    parseInt(parts.day,    10),
    hour:   parseInt(parts.hour,   10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function _nowDates() {
  const t = _nowInSydney();
  const long  = `${t.day} ${MONTH_NAMES[t.month - 1]} ${t.year}`;
  const short = `${t.day}/${t.month}/${t.year}`;
  return { long, short };
}

function _timestampSlug() {
  const t  = _nowInSydney();
  const p  = (n, len = 2) => String(n).padStart(len, "0");
  return `${t.year}${p(t.month)}${p(t.day)}_${p(t.hour)}${p(t.minute)}${p(t.second)}`;
}

// ---------------------------------------------------------------------------
// Court / email helpers (from emailing.py)
// ---------------------------------------------------------------------------

function _resolveCourtRecipient(court) {
  const lower = (court || "").toLowerCase();
  if (lower.includes("supreme"))  return { email: "media@courts.nsw.gov.au",               key: "supreme"  };
  if (lower.includes("district")) return { email: "mediadistrictcourt@dcj.nsw.gov.au",     key: "district" };
  return                                  { email: "localcourtmedia@courts.nsw.gov.au",     key: "local"    };
}

function _composeGmailUrl(to, subject, body) {
  const params = new URLSearchParams({ to, su: subject, body });
  return `https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Orchestrator helpers (from orchestrator.py)
// ---------------------------------------------------------------------------

function _effectiveApplications(courtText, requested) {
  const lower = (courtText || "").toLowerCase();
  const isSupreme = lower.includes("supreme");
  let mediaSelected    = Boolean(requested && requested.media_access_2026 != null ? requested.media_access_2026 : true);
  let nonPartySelected = Boolean(requested && requested.non_party_access  != null ? requested.non_party_access  : false);
  if (!isSupreme && mediaSelected) {
    mediaSelected    = false;
    nonPartySelected = true;
  }
  return { media_access_2026: mediaSelected, non_party_access: nonPartySelected };
}

function _effectiveRequestedDocs(courtText, jurisdictionText, requestedDocs) {
  const court      = (courtText      || "").toLowerCase();
  const jurisdiction = (jurisdictionText || "").toLowerCase();
  if (court.includes("local") && jurisdiction.includes("criminal")) {
    return new Set(["indictment_can"]);
  }
  return requestedDocs;
}

function _normalizeMatterName(caseNumber, matterName) {
  let text = (matterName || "").replace(/\s+/g, " ").trim();
  if (!text) return caseNumber;
  const escaped = caseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text.replace(new RegExp(`^\\s*${escaped}\\s*`), "").trim();
  text = text.replace(/^\s*[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*/i, "").trim();
  text = text.replace(/^\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*/i, "").trim();
  text = text.replace(new RegExp(`^\\s*${escaped}\\s*`), "").trim();
  text = text.replace(/\s+(Criminal|Civil)\s+(Local Court|District Court|Supreme Court).*$/i, "").trim();
  return text || caseNumber;
}

// ---------------------------------------------------------------------------
// Field value builders (from pdf_forms.py)
// ---------------------------------------------------------------------------

function _nonPartyJurisdictionField(courtText, jurisdictionText) {
  const text       = (courtText       || "").toLowerCase();
  const jurisdiction = (jurisdictionText || "").toLowerCase();
  if (text.includes("children"))                                              return "Button8";
  if (text.includes("district"))                                             return "Button7";
  if (text.includes("local") || text.includes("coroner")) {
    if (text.includes("civil") || jurisdiction.includes("civil"))            return "Button10";
    return "Button6";
  }
  return null;
}

function _media2026Values(profile, matter, requestedDocs, details) {
  const { long: longDate } = _nowDates();
  const [plaintiff, defendant] = _splitParties(matter);
  const signatureText = _effectiveSignatureText(profile);

  const mediaDocs = new Set([
    "crown_bundle","submissions","selected_images","originating_process",
    "transcript","exhibits","notice_of_appeal","other",
  ]);
  const unsupportedForMedia = [...requestedDocs].filter(d => d && !mediaDocs.has(d)).sort();
  let mediaOther = (details && details.other) || "";
  if (unsupportedForMedia.length) {
    const extra = unsupportedForMedia.join(", ");
    mediaOther = [mediaOther, extra].filter(Boolean).join("; ").trim();
  }

  const values = {
    "Name":                    profile.applicant_name || "",
    "Organisation":            profile.organisation   || "",
    "Contact number":          profile.contact_number || "",
    "Email":                   profile.email          || "",
    "Case number yearnumber":  matter.case_number     || "",
    "Plaintiff  Appellant name":    plaintiff,
    "Defendant  Respondent name":   defendant,
    "Applicant Signature":     signatureText,
    "Dated":                   longDate,
    "I submit that access to records on the court file should be granted because":
      "Public interest reporting by accredited media.",
    "Transcript dates":        (details && details.transcript_dates)    || "",
    "Exhibits":                (details && details.exhibits)            || "",
    "Others":                  mediaOther,
    "specify images":          (details && details.selected_images)     || "",
    "Check Box63": true,
    "Check Box64": true,
    "Check Box65": true,
  };

  for (const [docKey, fieldName] of Object.entries(MEDIA_DOC_TO_FIELD)) {
    values[fieldName] = requestedDocs.has(docKey);
  }
  return values;
}

function _applyNonPartyDocumentMap(requestedDocs, details, values) {
  const d = details || {};
  if (requestedDocs.has("indictment_can") || requestedDocs.has("originating_process")) {
    values["Button11"] = true;
  }
  if (requestedDocs.has("transcript")) {
    values["Button14"] = true;
    values["Text34"]   = d.transcript_dates || "";
  }
  if (requestedDocs.has("witness_statements"))       values["Button12"] = true;
  if (requestedDocs.has("police_fact_sheet"))        values["Button13"] = true;
  if (requestedDocs.has("record_conviction_or_order")) values["Button15"] = true;
  if (requestedDocs.has("sealed_copy_judgment"))     values["Button17"] = true;
  if (requestedDocs.has("certified_copy_reasons"))   values["Button18"] = true;
  if (requestedDocs.has("civil_pleading") || requestedDocs.has("originating_process")) {
    values["Button20"] = true;
    values["Text31"]   = d.civil_pleading || "Pleadings / originating process";
  }
  if (requestedDocs.has("civil_other_filed")) {
    values["Button21"] = true;
    values["Text32"]   = d.civil_other_filed || "Other filed civil document";
  }
  if (requestedDocs.has("exhibits")) {
    values["Button21"] = true;
    values["Text32"]   = d.exhibits || "Exhibits";
  }
  if (requestedDocs.has("notice_of_appeal")) {
    values["Button16"] = true;
    values["Text33"]   = "Notice of Appeal / grounds of appeal";
  }
  if (requestedDocs.has("other")) {
    values["Button16"] = true;
    values["Text33"]   = d.other || "Other documents as selected";
  }
  if (requestedDocs.has("selected_images")) {
    values["Button16"] = true;
    values["Text33"]   = d.selected_images || "Selected images in court file";
  }
}

function _nonPartyValues(profile, matter, requestedDocs, details) {
  const { short: shortDate } = _nowDates();
  const signatureText = _effectiveSignatureText(profile);

  const values = {
    "Button1": true,  "Button2": false, "Button3": false,
    "Text22": profile.applicant_name || "",
    "Text23": profile.occupation     || "Journalist",
    "Text24": profile.organisation   || "",
    "Text25": profile.email          || "",
    "Text26": profile.contact_number || "",
    "Button4": true,  "Button5": false,
    "Text27": matter.case_number || "",
    "Text28": _compactCaseTitle(matter),
    "Text29": _compactCourtText(matter),
    "Text35": (details && details.additional_details) || "",
    "Button37": true,
    "Text48": signatureText,
    "Text49": shortDate,
    "Text50": profile.applicant_name || "",
    "Text51": signatureText,
    "Text52": shortDate,
    // Jurisdiction checkboxes reset first
    "Button6": false, "Button7": false, "Button8": false, "Button10": false,
  };

  const jurisdictionField = _nonPartyJurisdictionField(matter.court, matter.jurisdiction);
  if (jurisdictionField) values[jurisdictionField] = true;

  for (const f of NON_PARTY_ACK_FIELDS) values[f] = true;
  _applyNonPartyDocumentMap(requestedDocs, details, values);
  return values;
}

// ---------------------------------------------------------------------------
// PDF filling using pdf-lib
// ---------------------------------------------------------------------------

function _replaceDaFontSize(da, size) {
  const text = (da || "").replace(/\s+/g, " ").trim();
  if (!text) return `/Helv ${size} Tf 0 g`;
  const updated = text.replace(/(\/\S+)\s+[-+]?\d+(?:\.\d+)?\s+Tf/, `$1 ${size} Tf`);
  return updated !== text ? updated : `/Helv ${size} Tf 0 g`;
}

async function _fillPdf(templateBytes, fieldValues, fieldFontSizes) {
  const pdfDoc = await PDFLib.PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form   = pdfDoc.getForm();

  for (const [name, value] of Object.entries(fieldValues)) {
    let field;
    try {
      field = form.getField(name);
    } catch (_) {
      // Field not found in this template - skip silently.
      continue;
    }

    try {
      if (typeof field.check === "function") {
        // PDFCheckBox
        if (value && value !== "/Off" && value !== false) {
          field.check();
        } else {
          field.uncheck();
        }
      } else if (typeof field.setText === "function") {
        // PDFTextField
        const text = value == null ? "" : String(value);
        field.setText(text);

        // Apply custom font size if requested (port of _set_text_field_font_size)
        const fontSize = fieldFontSizes && fieldFontSizes[name];
        if (fontSize) {
          try {
            const acroField = field.acroField;
            // Modify each widget's Default Appearance (/DA)
            for (const widget of acroField.getWidgets()) {
              const da      = widget.getDefaultAppearance() || "";
              const updated = _replaceDaFontSize(da, fontSize);
              widget.setDefaultAppearance(updated);
            }
            // Also modify the field-level DA
            const da      = acroField.getDefaultAppearance() || "";
            const updated = _replaceDaFontSize(da, fontSize);
            acroField.setDefaultAppearance(updated);
          } catch (_) {
            // Font size override is best-effort; form is still filled.
          }
        }
      } else if (typeof field.select === "function") {
        // PDFRadioGroup / PDFDropdown
        if (value !== false && value !== "/Off" && value != null) {
          try { field.select(String(value)); } catch (_) { /* ignore invalid option */ }
        }
      }
    } catch (err) {
      console.warn(`[NSW PDF] Field "${name}": ${err && err.message}`);
    }
  }

  // Set NeedAppearances=true so PDF viewers regenerate field appearances on open.
  // This mirrors pypdf's writer.set_need_appearances_writer() and avoids requiring
  // font embedding in the service worker.
  try {
    const naName = PDFLib.PDFName.of("NeedAppearances");
    // pdf-lib exposes acroForm on PDFForm; fall back to catalog lookup.
    if (form.acroForm && typeof form.acroForm.set === "function") {
      form.acroForm.set(naName, PDFLib.PDFBool.True);
    } else {
      const acroFormEntry = pdfDoc.catalog.get(PDFLib.PDFName.of("AcroForm"));
      if (acroFormEntry) {
        const acroFormDict = acroFormEntry.index != null
          ? pdfDoc.context.lookup(acroFormEntry)
          : acroFormEntry;
        if (acroFormDict && typeof acroFormDict.set === "function") {
          acroFormDict.set(naName, PDFLib.PDFBool.True);
        }
      }
    }
  } catch (_) {
    // NeedAppearances is best-effort; form values are still stored correctly.
  }

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Uint8Array / base64 utilities
// ---------------------------------------------------------------------------

function _uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function _base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// IndexedDB template store
// ---------------------------------------------------------------------------

const _IDB_NAME    = "nsw-courts-plus";
const _IDB_VERSION = 1;
const _IDB_STORE   = "templates";

function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = (ev) => {
      ev.target.result.createObjectStore(_IDB_STORE);
    };
    req.onsuccess  = (ev) => resolve(ev.target.result);
    req.onerror    = (ev) => reject(ev.target.error);
  });
}

async function getTemplateBytes(name) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_IDB_STORE, "readonly");
    const req = tx.objectStore(_IDB_STORE).get(name);
    req.onsuccess = (ev) => resolve(ev.target.result || null);
    req.onerror   = (ev) => reject(ev.target.error);
  });
}

async function storeTemplateBytes(name, bytes) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_IDB_STORE, "readwrite");
    const req = tx.objectStore(_IDB_STORE).put(bytes, name);
    req.onsuccess = () => resolve();
    req.onerror   = (ev) => reject(ev.target.error);
  });
}

async function listStoredTemplates() {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_IDB_STORE, "readonly");
    const req = tx.objectStore(_IDB_STORE).getAllKeys();
    req.onsuccess = (ev) => resolve(ev.target.result || []);
    req.onerror   = (ev) => reject(ev.target.error);
  });
}

// ---------------------------------------------------------------------------
// Main in-extension generate function (replaces POST /generate API call)
// ---------------------------------------------------------------------------

async function generateFormsInExtension(request) {
  const {
    matter,
    profile,
    applications: requestedApps,
    requested_documents,
    document_details,
  } = request;

  if (!profile || !profile.applicant_name) {
    throw new Error(
      "Profile missing. Set your applicant details in the extension drawer first."
    );
  }

  // Build effective doc set
  let requestedDocs = new Set(
    requested_documents && requested_documents.length ? requested_documents : DEFAULT_REQUESTED_DOCS
  );
  requestedDocs = _effectiveRequestedDocs(matter.court, matter.jurisdiction, requestedDocs);

  const applications = _effectiveApplications(matter.court, requestedApps || {});
  const details      = document_details || {};
  const stamp        = _timestampSlug();
  const safeCase     = _slug(matter.case_number || "");
  const safeName     = _slug(matter.matter_name || "").slice(0, 60);

  const generatedFiles  = [];
  const attachmentUrls  = [];   // items: { name, data (base64) }

  // --- Media access 2026 form ---
  if (applications.media_access_2026) {
    const tmpl = await getTemplateBytes(TEMPLATE_NAMES.MEDIA);
    if (!tmpl) {
      throw new Error(
        "Media access form template not found. " +
        "Open the extension settings (gear icon) and upload access_application_2026.pdf."
      );
    }
    const values   = _media2026Values(profile, matter, requestedDocs, details);
    const pdfBytes = await _fillPdf(tmpl, values, {});
    const filename = `${stamp}_${safeCase}_${safeName}_media_access_2026.pdf`;
    generatedFiles.push(filename);
    attachmentUrls.push({ name: filename, data: _uint8ArrayToBase64(pdfBytes) });
  }

  // --- Non-party access form ---
  if (applications.non_party_access) {
    const tmpl = await getTemplateBytes(TEMPLATE_NAMES.NON_PARTY);
    if (!tmpl) {
      throw new Error(
        "Non-party access form template not found. " +
        "Open the extension settings (gear icon) and upload the non-party access PDF."
      );
    }
    const values   = _nonPartyValues(profile, matter, requestedDocs, details);
    const pdfBytes = await _fillPdf(tmpl, values, NON_PARTY_FIELD_FONT_SIZES);
    const filename = `${stamp}_${safeCase}_${safeName}_non_party_access.pdf`;
    generatedFiles.push(filename);
    attachmentUrls.push({ name: filename, data: _uint8ArrayToBase64(pdfBytes) });
  }

  if (!generatedFiles.length) {
    throw new Error("No forms selected for generation.");
  }

  const { email: recipient } = _resolveCourtRecipient(matter.court);
  const subjectMatter = _normalizeMatterName(matter.case_number || "", matter.matter_name || "");
  const subject       = `${matter.case_number || ""} ${subjectMatter}`.trim();
  const composeUrl    = _composeGmailUrl(recipient, subject, EMAIL_BODY);

  return {
    generated_files:  generatedFiles,
    attachment_urls:  attachmentUrls,     // base64 payloads instead of HTTP URLs
    email_to:         recipient,
    email_subject:    subject,
    email_body:       EMAIL_BODY,
    gmail_compose_url: composeUrl,
    open_email_url:   composeUrl,
    in_extension:     true,              // flag so callers know no HTTP service was used
  };
}
