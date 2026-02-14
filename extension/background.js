const API_BASES = ["http://127.0.0.1:8765", "http://localhost:8765"];
const PROFILE_KEY = "nsw_autofill_profile";

const ATTACH_MAX_ATTEMPTS = 8;
const ATTACH_RETRY_MS = 2000;
const ATTACH_KEY_PREFIX = "nsw_attach_pending_";
const ATTACH_ALARM_PREFIX = "nsw_attach_alarm_";
const ABN_GUID = "912aeab3-605b-4dc8-8aa5-9f5f70f65902";

const activeAttachRuns = new Set();

class ApiHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

function detailToMessage(payload, status) {
  if (payload && typeof payload === "object" && payload.detail) {
    const detail = payload.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && detail.message) return String(detail.message);
    return JSON.stringify(detail);
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  return `Request failed (${status})`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildGoogleNewsSearchUrl(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://news.google.com/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
}

function buildGoogleNewsRssUrl(query) {
  const q = encodeURIComponent(cleanSpaces(query));
  return `https://news.google.com/rss/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
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

async function handleApiRequest(message) {
  const path = message.path || "/health";
  const method = (message.method || "GET").toUpperCase();
  const body = message.body;

  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    for (const base of API_BASES) {
      try {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json"
          },
          body: body ? JSON.stringify(body) : undefined
        });

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json() : await response.text();
        if (!response.ok) {
          throw new ApiHttpError(response.status, detailToMessage(payload, response.status));
        }
        return payload;
      } catch (error) {
        if (error instanceof ApiHttpError) {
          throw error;
        }
        lastError = error;
      }
    }
    await sleep(350);
  }

  if (lastError instanceof ApiHttpError) {
    throw lastError;
  }
  throw new Error(
    `Local service unreachable. Start '/Users/perry/Applications/NSW Court Autofill/start-service.command'. (${String(lastError && lastError.message ? lastError.message : lastError)})`
  );
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
  const query = cleanSpaces(message && message.query ? message.query : "");
  if (!query) {
    throw new Error("Missing ABN search query.");
  }

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

  return {
    query,
    search_type: "name",
    results: enriched
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
      await failAndRetry(tabId, pending, "Could not fetch attachment files from local service.");
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
