(function initNswAutofill() {
  const ROW_FLAG = "nswAutofillInjected";
  const CASE_NUMBER_RE = /\b\d{4}\/\d{1,10}\b|\b\d{12}\b/;

  const DOC_OPTIONS = [
    { key: "indictment_can", label: "Indictment/CAN/commencing document", checked: true, group: "Crime (non-party)" },
    { key: "witness_statements", label: "Witness statements tendered", checked: false, group: "Crime (non-party)" },
    { key: "police_fact_sheet", label: "Police fact sheet (guilty plea)", checked: false, group: "Crime (non-party)" },
    { key: "transcript", label: "Transcript", checked: false, group: "Common" },
    { key: "record_conviction_or_order", label: "Record of conviction/order", checked: false, group: "Crime (non-party)" },
    { key: "selected_images", label: "Selected images", checked: false, group: "Media 2026" },
    { key: "originating_process", label: "Originating process/pleadings", checked: false, group: "Civil/Media" },
    { key: "sealed_copy_judgment", label: "Sealed copy judgment/order", checked: false, group: "Civil (non-party)" },
    { key: "certified_copy_reasons", label: "Certified reasons for judgment/order", checked: false, group: "Civil (non-party)" },
    { key: "notice_of_appeal", label: "Notice of appeal/grounds", checked: false, group: "Media 2026" },
    { key: "exhibits", label: "Exhibits", checked: false, group: "Common" },
    { key: "civil_other_filed", label: "Other filed civil document", checked: false, group: "Civil (non-party)" },
    { key: "other", label: "Other", checked: false, group: "Common" }
  ];

  const defaultMatter = {
    case_number: "",
    matter_name: "",
    court: "Supreme Court",
    jurisdiction: "",
    court_location: "",
    listing_date: "",
    plaintiff: "",
    defendant: ""
  };
  const ABN_HISTORY_CACHE = new Map();

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "nsw-autofill-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || "Extension runtime error"));
          return;
        }
        if (!response) {
          reject(new Error("No response from extension background."));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || "Unknown error"));
          return;
        }
        resolve(response.data);
      });
    });
  }

  async function apiRequest(path, method, body) {
    return sendMessage({ type: "API_REQUEST", path, method, body });
  }

  function partyParser() {
    if (
      window.NswPartyParser &&
      typeof window.NswPartyParser.parseNewsSearchCandidates === "function"
    ) {
      return window.NswPartyParser;
    }
    throw new Error("Party parser unavailable. Reload the extension.");
  }

  function isCivilMatter(matter) {
    return /civil/i.test(cleanText(matter && matter.jurisdiction));
  }

  function closeResearchDrawer() {
    const existing = document.querySelector(".nsw-news-drawer");
    if (existing) {
      existing.remove();
    }
  }

  function stripHtml(value) {
    const holder = document.createElement("div");
    holder.innerHTML = value || "";
    return cleanText(holder.textContent || holder.innerText || "");
  }

  function formatNewsDate(raw) {
    const parsed = new Date(raw || "");
    if (Number.isNaN(parsed.getTime())) return cleanText(raw || "");
    try {
      return parsed.toLocaleString("en-AU", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (_error) {
      return cleanText(raw || "");
    }
  }

  function parseGoogleNewsRss(rss) {
    const text = String(rss || "");
    if (!text) return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) return [];
    const items = Array.from(doc.querySelectorAll("item"));
    return items.slice(0, 30).map((item) => ({
      title: cleanText(item.querySelector("title")?.textContent || ""),
      link: cleanText(item.querySelector("link")?.textContent || ""),
      source: cleanText(item.querySelector("source")?.textContent || ""),
      published: formatNewsDate(item.querySelector("pubDate")?.textContent || ""),
      snippet: stripHtml(item.querySelector("description")?.textContent || "")
    }));
  }

  function resolveCaselawLink(href) {
    const raw = cleanText(href || "");
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;
    if (raw.startsWith("/decision/")) return `https://www.caselaw.nsw.gov.au${raw}`;
    return `https://www.austlii.edu.au${raw}`;
  }

  function parseNswCaselawSearchHtml(doc) {
    const blocks = Array.from(doc.querySelectorAll(".row.result"));
    if (!blocks.length) return [];
    const items = [];
    const seen = new Set();

    blocks.forEach((block) => {
      if (items.length >= 30) return;
      const anchor = block.querySelector('h4 a, a[href^="/decision/"]');
      if (!anchor) return;
      const title = cleanText(anchor.textContent || "");
      const link = resolveCaselawLink(anchor.getAttribute("href") || "");
      if (!title || !link || seen.has(link)) return;
      seen.add(link);

      const snippetNode =
        block.querySelector("p:nth-of-type(2)") ||
        block.querySelector("p:last-of-type") ||
        block.querySelector("p");
      let excerpt = cleanText(snippetNode ? snippetNode.textContent || "" : "");
      excerpt = cleanText(excerpt.replace(/^Catchwords:\s*/i, ""));

      const decisionDateLabel = Array.from(block.querySelectorAll("strong"))
        .find((node) => /decision date/i.test(cleanText(node.textContent || "")));
      const decisionDate = cleanText(
        decisionDateLabel?.parentElement?.nextElementSibling?.textContent ||
          ""
      );

      const judgeLabel = Array.from(block.querySelectorAll("strong"))
        .find((node) => /judgment of/i.test(cleanText(node.textContent || "")));
      const judge = cleanText(judgeLabel?.parentElement?.nextElementSibling?.textContent || "");
      const meta = [judge, decisionDate].filter(Boolean).join(" | ");

      items.push({
        title,
        link,
        excerpt,
        meta
      });
    });

    return items;
  }

  function parseGenericCaselawSearchHtml(doc) {
    const anchors = Array.from(
      doc.querySelectorAll('a[href*="/cgi-bin/viewdoc/"], a[href^="/decision/"], a[href*="caselaw.nsw.gov.au/decision/"]')
    );
    const seen = new Set();
    const items = [];

    anchors.forEach((anchor) => {
      if (items.length >= 30) return;
      const title = cleanText(anchor.textContent || "");
      const link = resolveCaselawLink(anchor.getAttribute("href") || "");
      if (!title || !link || seen.has(link)) return;
      seen.add(link);

      const container =
        anchor.closest(".row.result") ||
        anchor.closest("li") ||
        anchor.closest("tr") ||
        anchor.parentElement;
      const containerText = cleanText(container ? container.textContent || "" : "");
      const excerpt = cleanText(containerText.replace(title, ""));

      items.push({
        title,
        link,
        excerpt,
        meta: ""
      });
    });

    return items;
  }

  function parseCaselawSearchHtml(html) {
    const text = String(html || "");
    if (!text) return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const nswItems = parseNswCaselawSearchHtml(doc);
    if (nswItems.length) return nswItems;
    return parseGenericCaselawSearchHtml(doc);
  }

  function parseCaselawPagination(html) {
    const text = String(html || "");
    const match = text.match(/Displaying\s+(\d+)\s*-\s*(\d+)\s+of\s+([\d,]+)/i);
    if (!match) {
      return { from: 0, to: 0, total: 0, hasMore: false };
    }
    const from = Number(match[1] || 0);
    const to = Number(match[2] || 0);
    const total = Number(String(match[3] || "0").replace(/,/g, ""));
    return {
      from,
      to,
      total,
      hasMore: Number.isFinite(to) && Number.isFinite(total) ? to < total : false
    };
  }

  function setResearchDrawerBusy(drawer, isBusy) {
    drawer.querySelectorAll(".nsw-news-candidate").forEach((button) => {
      button.disabled = Boolean(isBusy);
    });
    drawer.querySelectorAll(".nsw-research-exact-toggle").forEach((button) => {
      button.disabled = Boolean(isBusy);
    });
    const close = drawer.querySelector(".nsw-news-drawer-close");
    if (close) close.disabled = Boolean(isBusy);
    drawer.querySelectorAll(".nsw-research-tab").forEach((tab) => {
      tab.disabled = Boolean(isBusy);
    });
  }

  function markActiveCandidate(drawer, query) {
    drawer.querySelectorAll(".nsw-news-candidate").forEach((button) => {
      button.classList.toggle("active", cleanText(button.dataset.query || "") === cleanText(query));
    });
  }

  function setResearchTab(drawer, tabName) {
    drawer.querySelectorAll(".nsw-research-tab").forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    drawer.querySelectorAll(".nsw-research-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tabName;
    });
  }

  function updateResearchTabLabels(drawer, newsCount, abnCount, caselawCount) {
    const newsTab = drawer.querySelector('.nsw-research-tab[data-tab="news"]');
    const abnTab = drawer.querySelector('.nsw-research-tab[data-tab="abn"]');
    const caselawTab = drawer.querySelector('.nsw-research-tab[data-tab="caselaw"]');
    if (newsTab) newsTab.textContent = `Google News (${newsCount})`;
    if (abnTab) abnTab.textContent = `ABN (${abnCount})`;
    if (caselawTab) caselawTab.textContent = `Caselaw (${caselawCount})`;
  }

  function isExactSearchEnabled(drawer) {
    return drawer.dataset.exactSearch === "1";
  }

  function setExactSearchEnabled(drawer, enabled) {
    drawer.dataset.exactSearch = enabled ? "1" : "0";
    drawer.querySelectorAll(".nsw-research-exact-toggle").forEach((button) => {
      button.classList.toggle("active", enabled);
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
    });
  }

  function toSearchQuery(rawQuery, exact) {
    const query = cleanText(rawQuery || "");
    if (!query) return "";
    if (!exact) return query;
    if (/^".*"$/.test(query)) return query;
    return `"${query}"`;
  }

  function getResearchCounts(drawer) {
    return {
      news: Number(drawer.dataset.newsCount || 0),
      abn: Number(drawer.dataset.abnCount || 0),
      caselaw: Number(drawer.dataset.caselawCount || 0)
    };
  }

  function setResearchCounts(drawer, newsCount, abnCount, caselawCount) {
    drawer.dataset.newsCount = String(Number(newsCount || 0));
    drawer.dataset.abnCount = String(Number(abnCount || 0));
    drawer.dataset.caselawCount = String(Number(caselawCount || 0));
    updateResearchTabLabels(drawer, Number(newsCount || 0), Number(abnCount || 0), Number(caselawCount || 0));
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function buildAbnRecordUrl(abn) {
    const normalized = digitsOnly(abn);
    return normalized ? `https://abr.business.gov.au/ABN/View?id=${encodeURIComponent(normalized)}` : "https://abr.business.gov.au/";
  }

  function toMainBusinessLocation(value, state, postcode) {
    const direct = cleanText(value || "");
    if (direct) return direct;
    const compact = [cleanText(state || ""), cleanText(postcode || "")].filter(Boolean).join(" ");
    return compact || "Unknown";
  }

  function addExpandedField(root, label, value) {
    const text = cleanText(value || "");
    if (!text) return;
    const row = document.createElement("div");
    row.className = "nsw-abn-expanded-row";
    row.textContent = `${label}: ${text}`;
    root.appendChild(row);
  }

  function renderHistorySection(root, label, rows) {
    const section = document.createElement("section");
    section.className = "nsw-abn-history-section";

    const heading = document.createElement("h5");
    heading.className = "nsw-abn-history-title";
    heading.textContent = label;
    section.appendChild(heading);

    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
      const empty = document.createElement("p");
      empty.className = "nsw-abn-detail-row";
      empty.textContent = "No historical entries.";
      section.appendChild(empty);
      root.appendChild(section);
      return;
    }

    const hasDateColumns = safeRows.some((row) => cleanText(row?.from || "") || cleanText(row?.to || ""));
    if (!hasDateColumns) {
      safeRows.forEach((row) => {
        const item = document.createElement("p");
        item.className = "nsw-abn-detail-row";
        item.textContent = cleanText(row?.value || "");
        section.appendChild(item);
      });
      root.appendChild(section);
      return;
    }

    const table = document.createElement("table");
    table.className = "nsw-abn-history-table";
    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    ["Value", "From", "To"].forEach((title) => {
      const th = document.createElement("th");
      th.textContent = title;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    safeRows.forEach((row) => {
      const tr = document.createElement("tr");
      const valueCell = document.createElement("td");
      valueCell.textContent = cleanText(row?.value || "");
      const fromCell = document.createElement("td");
      fromCell.textContent = cleanText(row?.from || "");
      const toCell = document.createElement("td");
      toCell.textContent = cleanText(row?.to || "");
      tr.appendChild(valueCell);
      tr.appendChild(fromCell);
      tr.appendChild(toCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    root.appendChild(section);
  }

  function renderExpandedAbnDetails(card, payload) {
    const body = card.querySelector(".nsw-abn-body");
    if (!body) return;
    body.innerHTML = "";

    const current = payload?.current || {};
    const history = payload?.history || {};

    const currentBlock = document.createElement("section");
    currentBlock.className = "nsw-abn-expanded-block";
    const currentTitle = document.createElement("h4");
    currentTitle.className = "nsw-abn-expanded-title";
    currentTitle.textContent = "Current details";
    currentBlock.appendChild(currentTitle);

    addExpandedField(currentBlock, "Entity name", current.entity_name);
    addExpandedField(currentBlock, "ABN status", current.abn_status);
    addExpandedField(currentBlock, "Entity type", current.entity_type);
    addExpandedField(currentBlock, "GST", current.gst);
    addExpandedField(currentBlock, "Main business location", current.main_business_location);
    addExpandedField(currentBlock, "ABN last updated", current.abn_last_updated);
    addExpandedField(currentBlock, "Record extracted", current.record_extracted);
    body.appendChild(currentBlock);

    const historyBlock = document.createElement("section");
    historyBlock.className = "nsw-abn-expanded-block";
    const historyTitle = document.createElement("h4");
    historyTitle.className = "nsw-abn-expanded-title";
    historyTitle.textContent = "Historical details";
    historyBlock.appendChild(historyTitle);

    renderHistorySection(historyBlock, "Entity name", history.entity_name);
    renderHistorySection(historyBlock, "ABN status", history.abn_status);
    if (cleanText(history.entity_type || "")) {
      renderHistorySection(historyBlock, "Entity type", [{ value: cleanText(history.entity_type) }]);
    }
    renderHistorySection(historyBlock, "GST", history.gst);
    renderHistorySection(historyBlock, "Main business location", history.main_business_location);
    body.appendChild(historyBlock);
  }

  async function ensureExpandedAbnDetails(card, abn) {
    const normalized = digitsOnly(abn || "");
    if (!normalized) return;
    const body = card.querySelector(".nsw-abn-body");
    if (!body) return;
    if (card.dataset.loading === "1") return;

    if (ABN_HISTORY_CACHE.has(normalized)) {
      renderExpandedAbnDetails(card, ABN_HISTORY_CACHE.get(normalized));
      return;
    }

    card.dataset.loading = "1";
    body.innerHTML = `<p class="nsw-abn-detail-row">Loading ABN current and historical details...</p>`;
    try {
      const payload = await sendMessage({ type: "ABN_HISTORY_DETAILS", abn: normalized });
      ABN_HISTORY_CACHE.set(normalized, payload || {});
      renderExpandedAbnDetails(card, payload || {});
    } catch (error) {
      body.innerHTML = `<p class="nsw-abn-detail-row">Could not load historical details: ${String(error && error.message ? error.message : error)}</p>`;
    } finally {
      card.dataset.loading = "0";
    }
  }

  function createAbnCard(options) {
    const card = document.createElement("details");
    card.className = "nsw-abn-item";

    const summary = document.createElement("summary");
    summary.className = "nsw-abn-summary";

    const header = document.createElement("div");
    header.className = "nsw-abn-header";
    const chevron = document.createElement("span");
    chevron.className = "nsw-abn-chevron";
    chevron.textContent = "▸";

    const title = document.createElement("div");
    title.className = "nsw-abn-title";
    title.textContent = cleanText(options.title || "ABN record");
    header.appendChild(chevron);
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "nsw-abn-meta";
    const link = document.createElement("a");
    link.className = "nsw-abn-link";
    link.href = buildAbnRecordUrl(options.abn);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `ABN ${cleanText(options.abn || "")}`;
    link.addEventListener("click", (event) => event.stopPropagation());
    meta.appendChild(link);

    const compactStatus = cleanText(options.abn_status || "") || "Status unavailable";
    const compactLocation = toMainBusinessLocation(options.main_business_location, options.state, options.postcode);
    meta.appendChild(document.createTextNode(` | ${compactStatus} | ${compactLocation}`));

    summary.appendChild(header);
    summary.appendChild(meta);
    card.appendChild(summary);

    const body = document.createElement("div");
    body.className = "nsw-abn-body";
    const hint = document.createElement("p");
    hint.className = "nsw-abn-detail-row";
    hint.textContent = "Expand to load full ABN current and historical details.";
    body.appendChild(hint);
    card.appendChild(body);

    const normalized = digitsOnly(options.abn || "");
    if (normalized) {
      card.addEventListener("toggle", () => {
        if (!card.open) return;
        ensureExpandedAbnDetails(card, normalized).catch(() => {});
      });
    }

    return card;
  }

  function renderNewsResults(drawer, payload) {
    const resultsRoot = drawer.querySelector(".nsw-research-news-panel");
    resultsRoot.innerHTML = "";

    const items = parseGoogleNewsRss(payload.rss || "");
    if (!items.length) {
      resultsRoot.innerHTML = `<p class="nsw-news-empty">No Google News results found.</p>`;
      return 0;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "nsw-news-item";

      const title = document.createElement("a");
      title.className = "nsw-news-item-title";
      title.href = item.link || payload.web_url || "#";
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = item.title || "(Untitled)";

      const meta = document.createElement("div");
      meta.className = "nsw-news-item-meta";
      meta.textContent = [item.source, item.published].filter(Boolean).join(" | ") || "Google News";

      const snippet = document.createElement("p");
      snippet.className = "nsw-news-item-snippet";
      snippet.textContent = item.snippet || "";

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(snippet);
      resultsRoot.appendChild(card);
    });

    return items.length;
  }

  function renderAbnResults(drawer, payload) {
    const resultsRoot = drawer.querySelector(".nsw-research-abn-panel");
    resultsRoot.innerHTML = "";

    if (!payload || !payload.search_type) {
      resultsRoot.innerHTML = `<p class="nsw-news-empty">No ABN results found.</p>`;
      return 0;
    }

    if (payload.search_type === "abn") {
      const item = payload.result || {};
      if (!item.abn) {
        resultsRoot.innerHTML = `<p class="nsw-news-empty">No ABN details found.</p>`;
        return 0;
      }
      const card = createAbnCard({
        title: item.entity_name || "ABN record",
        abn: item.abn,
        abn_status: item.abn_status,
        main_business_location: toMainBusinessLocation("", item.state, item.postcode),
        state: item.state,
        postcode: item.postcode
      });
      resultsRoot.appendChild(card);
      return 1;
    }

    const rows = Array.isArray(payload.results) ? payload.results : [];
    if (!rows.length) {
      resultsRoot.innerHTML = `<p class="nsw-news-empty">No ABN matches found.</p>`;
      return 0;
    }

    rows.slice(0, 20).forEach((item) => {
      const card = createAbnCard({
        title: item.entity_name || item.matched_name || "Unnamed entity",
        abn: item.abn,
        abn_status: item.abn_status,
        main_business_location: toMainBusinessLocation("", item.state, item.postcode),
        state: item.state,
        postcode: item.postcode
      });
      resultsRoot.appendChild(card);
    });

    return rows.length;
  }

  function renderCaselawResults(drawer, payload, options = {}) {
    const resultsRoot = drawer.querySelector(".nsw-research-caselaw-panel");
    const append = Boolean(options.append);
    if (!append) {
      resultsRoot.innerHTML = "";
    } else {
      const existingPager = resultsRoot.querySelector(".nsw-caselaw-load-more-wrap");
      if (existingPager) existingPager.remove();
    }

    const items = parseCaselawSearchHtml(payload.html || "");
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "nsw-news-empty";
      empty.textContent = "No caselaw results found.";
      resultsRoot.appendChild(empty);
      drawer.dataset.caselawHasMore = "0";
      return 0;
    }

    items.forEach((item) => {
      const card = document.createElement("details");
      card.className = "nsw-caselaw-item";

      const summary = document.createElement("summary");
      summary.className = "nsw-caselaw-summary";

      const header = document.createElement("div");
      header.className = "nsw-caselaw-header";
      const chevron = document.createElement("span");
      chevron.className = "nsw-caselaw-chevron";
      chevron.textContent = "▸";

      const title = document.createElement("a");
      title.className = "nsw-caselaw-title";
      title.href = item.link || payload.web_url || "#";
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = item.title || "(Untitled)";
      title.addEventListener("click", (event) => event.stopPropagation());

      header.appendChild(chevron);
      header.appendChild(title);
      summary.appendChild(header);

      const meta = document.createElement("div");
      meta.className = "nsw-caselaw-meta";
      meta.textContent = item.meta || cleanText(payload.source || "Caselaw");
      summary.appendChild(meta);
      card.appendChild(summary);

      const body = document.createElement("div");
      body.className = "nsw-caselaw-body";
      const excerpt = document.createElement("p");
      excerpt.className = "nsw-caselaw-excerpt";
      excerpt.textContent = item.excerpt || "No excerpt available for this result.";
      body.appendChild(excerpt);
      card.appendChild(body);

      resultsRoot.appendChild(card);
    });

    const pageInfo = parseCaselawPagination(payload.html || "");
    const page = Math.max(1, Number(payload.page || (append ? Number(drawer.dataset.caselawPage || 1) : 1)));
    drawer.dataset.caselawQuery = cleanText(payload.query || drawer.dataset.caselawQuery || "");
    drawer.dataset.caselawPage = String(page);
    drawer.dataset.caselawHasMore = pageInfo.hasMore ? "1" : "0";

    if (pageInfo.hasMore) {
      const wrap = document.createElement("div");
      wrap.className = "nsw-caselaw-load-more-wrap";
      const loadMore = document.createElement("button");
      loadMore.type = "button";
      loadMore.className = "nsw-caselaw-load-more";
      loadMore.textContent = "Load more";
      loadMore.addEventListener("click", async () => {
        if (loadMore.disabled) return;
        const query = cleanText(drawer.dataset.caselawQuery || "");
        const currentPage = Math.max(1, Number(drawer.dataset.caselawPage || 1));
        if (!query) return;
        loadMore.disabled = true;
        loadMore.textContent = "Loading...";
        try {
          const nextPayload = await sendMessage({
            type: "CASELAW_SEARCH",
            query,
            page: currentPage + 1
          });
          const added = renderCaselawResults(drawer, nextPayload || {}, { append: true });
          const counts = getResearchCounts(drawer);
          setResearchCounts(drawer, counts.news, counts.abn, counts.caselaw + added);
          const status = drawer.querySelector(".nsw-news-status");
          if (status) {
            const total = counts.caselaw + added;
            status.textContent = `Loaded more Caselaw results (${total} total).`;
          }
        } catch (error) {
          const status = drawer.querySelector(".nsw-news-status");
          if (status) {
            status.textContent = `Caselaw pagination failed: ${String(error && error.message ? error.message : error)}`;
          }
          loadMore.disabled = false;
          loadMore.textContent = "Load more";
        }
      });
      wrap.appendChild(loadMore);
      resultsRoot.appendChild(wrap);
    }

    return items.length;
  }

  async function runResearch(drawer, query) {
    const status = drawer.querySelector(".nsw-news-status");
    if (!query) return;
    const exact = isExactSearchEnabled(drawer);
    const searchQuery = toSearchQuery(query, exact);
    if (!searchQuery) return;
    markActiveCandidate(drawer, query);
    drawer.dataset.activeCandidate = query;
    setResearchDrawerBusy(drawer, true);
    status.textContent = `Researching ${searchQuery}...`;

    let newsCount = 0;
    let abnCount = 0;
    let caselawCount = 0;
    let newsError = "";
    let abnError = "";
    let caselawError = "";

    try {
      const [newsResult, abnResult, caselawResult] = await Promise.allSettled([
        sendMessage({ type: "NEWS_SEARCH", query: searchQuery }),
        sendMessage({ type: "ABN_SEARCH", query: searchQuery, maxResults: 12 }),
        sendMessage({ type: "CASELAW_SEARCH", query: searchQuery })
      ]);

      if (newsResult.status === "fulfilled") {
        newsCount = renderNewsResults(drawer, newsResult.value || {});
      } else {
        newsError = String(newsResult.reason && newsResult.reason.message ? newsResult.reason.message : newsResult.reason);
        drawer.querySelector(".nsw-research-news-panel").innerHTML = `<p class="nsw-news-empty">Google News failed: ${newsError}</p>`;
      }

      if (abnResult.status === "fulfilled") {
        abnCount = renderAbnResults(drawer, abnResult.value || {});
      } else {
        abnError = String(abnResult.reason && abnResult.reason.message ? abnResult.reason.message : abnResult.reason);
        drawer.querySelector(".nsw-research-abn-panel").innerHTML = `<p class="nsw-news-empty">ABN lookup failed: ${abnError}</p>`;
      }

      if (caselawResult.status === "fulfilled") {
        caselawCount = renderCaselawResults(drawer, caselawResult.value || {}, { append: false });
      } else {
        caselawError = String(caselawResult.reason && caselawResult.reason.message ? caselawResult.reason.message : caselawResult.reason);
        drawer.querySelector(".nsw-research-caselaw-panel").innerHTML = `<p class="nsw-news-empty">Caselaw lookup failed: ${caselawError}</p>`;
      }

      setResearchCounts(drawer, newsCount, abnCount, caselawCount);
      if (newsCount === 0 && abnCount > 0) {
        setResearchTab(drawer, "abn");
      } else if (newsCount === 0 && caselawCount > 0) {
        setResearchTab(drawer, "caselaw");
      } else {
        setResearchTab(drawer, "news");
      }

      if (!newsError && !abnError && !caselawError) {
        status.textContent = `${newsCount} news result${newsCount === 1 ? "" : "s"} | ${abnCount} ABN match${abnCount === 1 ? "" : "es"} | ${caselawCount} caselaw result${caselawCount === 1 ? "" : "s"}.`;
      } else if (newsError && abnError && caselawError) {
        status.textContent = "Google News, ABN lookup, and Caselaw lookup all failed.";
      } else {
        const summary = [];
        summary.push(newsError ? "News failed" : `News ${newsCount}`);
        summary.push(abnError ? "ABN failed" : `ABN ${abnCount}`);
        summary.push(caselawError ? "Caselaw failed" : `Caselaw ${caselawCount}`);
        status.textContent = summary.join(" | ");
      }
    } finally {
      setResearchDrawerBusy(drawer, false);
    }
  }

  function openResearchDrawer(matter) {
    closeResearchDrawer();

    const parser = partyParser();
    const candidates = parser.parseNewsSearchCandidates(matter || {});
    const civil = isCivilMatter(matter);

    const drawer = document.createElement("aside");
    drawer.className = "nsw-news-drawer";
    drawer.innerHTML = `
      <div class="nsw-news-drawer-head">
        <h2>Research</h2>
        <button type="button" class="nsw-news-drawer-close" aria-label="Close">Close</button>
      </div>
      <div class="nsw-news-context"></div>
      <div class="nsw-news-candidates"></div>
      <div class="nsw-news-status"></div>
      <div class="nsw-research-tabs" role="tablist" aria-label="Research result tabs">
        <button type="button" class="nsw-research-tab active" data-tab="news" role="tab" aria-selected="true">Google News (0)</button>
        <button type="button" class="nsw-research-tab" data-tab="abn" role="tab" aria-selected="false">ABN (0)</button>
        <button type="button" class="nsw-research-tab" data-tab="caselaw" role="tab" aria-selected="false">Caselaw (0)</button>
      </div>
      <div class="nsw-news-results">
        <section class="nsw-research-panel nsw-research-news-panel" data-panel="news"></section>
        <section class="nsw-research-panel nsw-research-abn-panel" data-panel="abn" hidden></section>
        <section class="nsw-research-panel nsw-research-caselaw-panel" data-panel="caselaw" hidden></section>
      </div>
    `;

    const context = drawer.querySelector(".nsw-news-context");
    context.textContent = `${matter.case_number || ""} ${matter.matter_name || ""}`.trim();

    const closeButton = drawer.querySelector(".nsw-news-drawer-close");
    closeButton.addEventListener("click", () => closeResearchDrawer());

    drawer.querySelectorAll(".nsw-research-tab").forEach((tab) => {
      tab.addEventListener("click", () => setResearchTab(drawer, tab.dataset.tab || "news"));
    });
    setResearchTab(drawer, "news");

    const candidatesRoot = drawer.querySelector(".nsw-news-candidates");
    if (!candidates.length) {
      drawer.querySelector(".nsw-news-status").textContent = "No party names found to research.";
      document.body.appendChild(drawer);
      return;
    }

    const label = document.createElement("p");
    label.className = "nsw-news-candidates-label";
    label.textContent = civil
      ? "Choose a party to search:"
      : (candidates.length > 1 ? "Choose a party to search:" : "Auto-search target:");
    const head = document.createElement("div");
    head.className = "nsw-news-candidates-head";
    head.appendChild(label);

    const exactToggle = document.createElement("button");
    exactToggle.type = "button";
    exactToggle.className = "nsw-research-exact-toggle";
    exactToggle.textContent = "Exact";
    exactToggle.setAttribute("aria-pressed", "false");
    exactToggle.addEventListener("click", () => {
      const next = !isExactSearchEnabled(drawer);
      setExactSearchEnabled(drawer, next);
      const activeCandidate = cleanText(drawer.dataset.activeCandidate || "");
      if (activeCandidate) {
        runResearch(drawer, activeCandidate).catch(() => {});
      }
    });

    head.appendChild(exactToggle);
    candidatesRoot.appendChild(head);
    setExactSearchEnabled(drawer, false);

    const buttonsWrap = document.createElement("div");
    buttonsWrap.className = "nsw-news-candidates-list";
    candidates.forEach((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nsw-news-candidate";
      button.dataset.query = candidate;
      button.textContent = candidate;
      button.addEventListener("click", () => runResearch(drawer, candidate));
      buttonsWrap.appendChild(button);
    });
    candidatesRoot.appendChild(buttonsWrap);

    document.body.appendChild(drawer);

    if (candidates.length > 1) {
      runResearch(drawer, candidates[0]);
    } else if (!civil && candidates.length === 1) {
      runResearch(drawer, candidates[0]);
    } else {
      drawer.querySelector(".nsw-news-status").textContent = "Select a name to run News + ABN + Caselaw research.";
    }
  }

  function inferCourtFromContext(row, text) {
    const contextParts = [text];
    let node = row.parentElement;
    let hop = 0;
    while (node && hop < 8) {
      const maybeHeading = cleanText(node.previousElementSibling ? node.previousElementSibling.textContent : "");
      if (maybeHeading) contextParts.push(maybeHeading);
      node = node.parentElement;
      hop += 1;
    }

    const context = contextParts.join(" ").toLowerCase();
    if (context.includes("district")) return "District Court";
    if (context.includes("children")) return "Children's Court";
    if (context.includes("local")) return "Local Court";
    if (context.includes("coroner")) return "Coroner's Court";
    if (context.includes("supreme")) return "Supreme Court";
    return "Supreme Court";
  }

  function parseMatterFromRow(row) {
    const cells = Array.from(row.querySelectorAll("td"));
    if (cells.length >= 10) {
      const caseCell = cleanText(cells[2].innerText || cells[2].textContent || "");
      const caseMatch = caseCell.match(CASE_NUMBER_RE);
      if (!caseMatch) return null;
      const caseNumber = caseMatch[0];
      const matterName = cleanText(cells[3].innerText || cells[3].textContent || "");
      const jurisdictionCell = cleanText(cells[4].innerText || cells[4].textContent || "");
      const courtCell = cleanText(cells[5].innerText || cells[5].textContent || "");
      const locationCell = cleanText(cells[8].innerText || cells[8].textContent || "");
      const listingDate = cleanText(
        `${cleanText(cells[0].innerText || cells[0].textContent || "")} ${cleanText(cells[1].innerText || cells[1].textContent || "")}`
      );

      let plaintiff = "";
      let defendant = "";
      const split = matterName.split(/\bv\b/i);
      if (split.length >= 2) {
        plaintiff = cleanText(split[0]);
        defendant = cleanText(split.slice(1).join("v"));
      }

      return {
        ...defaultMatter,
        case_number: caseNumber,
        matter_name: matterName || caseNumber,
        court: courtCell || inferCourtFromContext(row, matterName),
        jurisdiction: jurisdictionCell,
        court_location: locationCell,
        listing_date: listingDate,
        plaintiff,
        defendant
      };
    }

    const text = cleanText(row.innerText || row.textContent || "");
    const caseMatch = text.match(CASE_NUMBER_RE);
    if (!caseMatch) return null;
    const caseNumber = caseMatch[0];
    return {
      ...defaultMatter,
      case_number: caseNumber,
      matter_name: caseNumber,
      court: inferCourtFromContext(row, text)
    };
  }

  function collectRows() {
    return Array.from(document.querySelectorAll("tr, [role='row'], .court-list-row"));
  }

  function buildModal(matter) {
    const isSupreme = /supreme/i.test(matter.court || "");
    const courtOptions = [
      "Supreme Court",
      "District Court",
      "Local Court",
      "Children's Court",
      "Coroner's Court"
    ];
    const courtSelectHtml = courtOptions
      .map((label) => `<option value="${label}" ${matter.court === label ? "selected" : ""}>${label}</option>`)
      .join("");

    const grouped = DOC_OPTIONS.reduce((acc, d) => {
      if (!acc[d.group]) acc[d.group] = [];
      acc[d.group].push(d);
      return acc;
    }, {});

    const overlay = document.createElement("div");
    overlay.className = "nsw-autofill-modal-overlay";
    overlay.innerHTML = `
      <div class="nsw-autofill-modal">
        <h2>Request Docs</h2>
        <div class="nsw-autofill-context">
          <strong>${matter.case_number}</strong> ${matter.matter_name}<br />
          ${matter.court}${matter.court_location ? ` - ${matter.court_location}` : ""}
        </div>

        <div class="nsw-autofill-detail-grid">
          <select id="nsw-court-select">${courtSelectHtml}</select>
          <input id="nsw-court-location" placeholder="Court location" value="${matter.court_location || ""}" />
        </div>

        ${isSupreme ? `<label><input id="nsw-media-2026" type="checkbox" checked /> Media access 2026</label><br />` : `<input id="nsw-media-2026" type="checkbox" hidden />`}
        <label>
          <input id="nsw-non-party" type="checkbox" ${isSupreme ? "" : "checked"} />
          Non-party access (auto-ticks s314 + fair and accurate report)
        </label>

        <h3>Requested documents</h3>
        <div id="nsw-docs-groups"></div>

        <div class="nsw-autofill-detail-grid">
          <input id="detail-transcript" placeholder="Transcript dates (optional)" />
          <input id="detail-exhibits" placeholder="Exhibits details (optional)" />
          <input id="detail-images" placeholder="Selected images details (optional)" />
          <input id="detail-other" placeholder="Other document details (optional)" />
          <input id="detail-additional" placeholder="Additional details for non-party form (optional)" />
        </div>

        <div class="nsw-profile-drawer" id="nsw-profile-drawer" hidden>
          <h3>Profile</h3>
          <div class="nsw-autofill-detail-grid">
            <input id="pf-name" placeholder="Applicant full name" />
            <input id="pf-org" placeholder="Organisation" />
            <input id="pf-phone" placeholder="Contact number" />
            <input id="pf-email" placeholder="Email" />
          </div>
          <div class="nsw-autofill-actions">
            <button id="nsw-profile-save" class="primary">Save Profile</button>
          </div>
        </div>

        <div class="nsw-autofill-actions">
          <button id="nsw-profile-toggle">Edit Profile ▾</button>
          <button id="nsw-cancel">Cancel</button>
          <button id="nsw-generate" class="primary">Generate + Draft Email</button>
        </div>
      </div>
    `;

    const groupsRoot = overlay.querySelector("#nsw-docs-groups");
    Object.keys(grouped).forEach((groupName) => {
      const section = document.createElement("div");
      section.className = "nsw-doc-section";
      const h = document.createElement("h4");
      h.textContent = groupName;
      section.appendChild(h);

      const grid = document.createElement("div");
      grid.className = "nsw-autofill-grid";
      grouped[groupName].forEach((doc) => {
        const id = `doc-${doc.key}`;
        const wrapper = document.createElement("label");
        wrapper.innerHTML = `<input id="${id}" type="checkbox" ${doc.checked ? "checked" : ""}/> ${doc.label}`;
        grid.appendChild(wrapper);
      });
      section.appendChild(grid);
      groupsRoot.appendChild(section);
    });

    return overlay;
  }

  async function loadProfileIntoDrawer(overlay) {
    try {
      const profile = await sendMessage({ type: "PROFILE_GET" });
      if (!profile) {
        return false;
      }
      overlay.querySelector("#pf-name").value = profile.applicant_name || "";
      overlay.querySelector("#pf-org").value = profile.organisation || "";
      overlay.querySelector("#pf-phone").value = profile.contact_number || "";
      overlay.querySelector("#pf-email").value = profile.email || "";
      return true;
    } catch (error) {
      return false;
    }
  }

  async function saveProfileFromDrawer(overlay) {
    const payload = {
      applicant_name: cleanText(overlay.querySelector("#pf-name")?.value || ""),
      organisation: cleanText(overlay.querySelector("#pf-org")?.value || ""),
      contact_number: cleanText(overlay.querySelector("#pf-phone")?.value || ""),
      email: cleanText(overlay.querySelector("#pf-email")?.value || "")
    };

    if (!payload.applicant_name) {
      throw new Error("Applicant full name is required.");
    }

    await sendMessage({ type: "PROFILE_SAVE", profile: payload });
    return payload;
  }

  function currentProfileFromDrawer(overlay) {
    return {
      applicant_name: cleanText(overlay.querySelector("#pf-name")?.value || ""),
      organisation: cleanText(overlay.querySelector("#pf-org")?.value || ""),
      contact_number: cleanText(overlay.querySelector("#pf-phone")?.value || ""),
      email: cleanText(overlay.querySelector("#pf-email")?.value || "")
    };
  }

  function gatherSelection(overlay) {
    const selectedDocs = DOC_OPTIONS.filter((doc) => {
      const box = overlay.querySelector(`#doc-${doc.key}`);
      return box && box.checked;
    }).map((doc) => doc.key);

    return {
      matter_overrides: {
        court: cleanText(overlay.querySelector("#nsw-court-select")?.value || ""),
        court_location: cleanText(overlay.querySelector("#nsw-court-location")?.value || "")
      },
      applications: {
        media_access_2026: Boolean(overlay.querySelector("#nsw-media-2026")?.checked),
        non_party_access: Boolean(overlay.querySelector("#nsw-non-party")?.checked)
      },
      requested_documents: selectedDocs,
      document_details: {
        transcript_dates: cleanText(overlay.querySelector("#detail-transcript")?.value || ""),
        exhibits: cleanText(overlay.querySelector("#detail-exhibits")?.value || ""),
        selected_images: cleanText(overlay.querySelector("#detail-images")?.value || ""),
        other: cleanText(overlay.querySelector("#detail-other")?.value || ""),
        additional_details: cleanText(overlay.querySelector("#detail-additional")?.value || "")
      }
    };
  }

  async function ensureProfileReady(overlay) {
    const fromDrawer = currentProfileFromDrawer(overlay);
    if (fromDrawer.applicant_name) {
      return fromDrawer;
    }

    const saved = await sendMessage({ type: "PROFILE_GET" });
    if (saved && saved.applicant_name) {
      return saved;
    }

    const drawer = overlay.querySelector("#nsw-profile-drawer");
    drawer.hidden = false;
    throw new Error("Set profile details in the drawer, then press Generate again.");
  }

  async function generateFromMatter(matter, overlay) {
    const profile = await ensureProfileReady(overlay);
    const selection = gatherSelection(overlay);
    const { matter_overrides, ...requestSelection } = selection;
    const payloadMatter = {
      ...matter,
      court: matter_overrides.court || matter.court,
      court_location: matter_overrides.court_location || matter.court_location
    };
    return apiRequest("/generate", "POST", {
      matter: payloadMatter,
      profile,
      ...requestSelection
    });
  }

  function attachModalHandlers(matter, overlay) {
    const toggleProfile = overlay.querySelector("#nsw-profile-toggle");
    const saveProfile = overlay.querySelector("#nsw-profile-save");
    const drawer = overlay.querySelector("#nsw-profile-drawer");
    const cancel = overlay.querySelector("#nsw-cancel");
    const generate = overlay.querySelector("#nsw-generate");

    loadProfileIntoDrawer(overlay);

    toggleProfile.addEventListener("click", () => {
      drawer.hidden = !drawer.hidden;
      toggleProfile.textContent = drawer.hidden ? "Edit Profile ▾" : "Edit Profile ▴";
    });

    saveProfile.addEventListener("click", async () => {
      try {
        await saveProfileFromDrawer(overlay);
        showToast("Profile saved.");
      } catch (error) {
        window.alert(`Profile save failed: ${error.message}`);
      }
    });

    cancel.addEventListener("click", () => overlay.remove());

    generate.addEventListener("click", async () => {
      generate.disabled = true;
      generate.textContent = "Generating...";
      try {
        const result = await generateFromMatter(matter, overlay);
        overlay.remove();
        const files = (result.generated_files || []).map((path) => path.split("/").pop()).join(", ");
        const generatedPaths = Array.isArray(result.generated_files) ? result.generated_files : [];
        const outputDir = cleanText(result.output_folder || "") || (generatedPaths.length ? generatedPaths[0].split("/").slice(0, -1).join("/") : "");
        showToast(outputDir ? `Generated: ${files} (${outputDir})` : `Generated: ${files}`);

        const attachments = Array.isArray(result.attachment_urls) ? result.attachment_urls : [];
        if (attachments.length && result.gmail_compose_url) {
          sendMessage({
            type: "OPEN_GMAIL_WITH_ATTACHMENTS",
            composeUrl: result.gmail_compose_url,
            attachments: attachments
          }).catch((error) => {
            const msg = String(error && error.message ? error.message : error);
            showToast(`Attachment setup warning: ${msg}`);
            window.alert(`Attachment setup warning: ${msg}`);
            window.open(result.gmail_compose_url, "_blank", "noopener,noreferrer");
          });
        } else if (result.open_email_url) {
          window.open(result.open_email_url, "_blank", "noopener,noreferrer");
        } else if (result.gmail_compose_url) {
          window.open(result.gmail_compose_url, "_blank", "noopener,noreferrer");
        }
      } catch (error) {
        generate.disabled = false;
        generate.textContent = "Generate + Draft Email";
        window.alert(`Generation failed: ${error.message}`);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
  }

  function addButtonToRow(row, matter) {
    if (row.dataset[ROW_FLAG]) return;
    row.dataset[ROW_FLAG] = "true";

    const generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.className = "nsw-autofill-button";
    generateButton.textContent = "Request Docs";
    generateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const modal = buildModal(matter);
      document.body.appendChild(modal);
      attachModalHandlers(matter, modal);
    });

    const newsButton = document.createElement("button");
    newsButton.type = "button";
    newsButton.className = "nsw-news-search-button";
    newsButton.textContent = "Research";
    newsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        openResearchDrawer(matter);
      } catch (error) {
        window.alert(`Research unavailable: ${String(error && error.message ? error.message : error)}`);
      }
    });

    const rail = document.createElement("div");
    rail.className = "nsw-row-action-rail";
    rail.appendChild(generateButton);
    rail.appendChild(newsButton);

    const rowStyle = window.getComputedStyle(row);
    if (rowStyle.position === "static") {
      row.style.position = "relative";
    }
    row.style.overflow = "visible";
    const table = row.closest("table");
    if (table) {
      table.style.overflow = "visible";
      if (table.parentElement) {
        table.parentElement.style.overflow = "visible";
      }
    }
    row.appendChild(rail);
  }

  function injectButtons() {
    const rows = collectRows();
    rows.forEach((row) => {
      const matter = parseMatterFromRow(row);
      if (!matter || !matter.case_number) return;
      addButtonToRow(row, matter);
    });
  }

  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButtons();
})();
