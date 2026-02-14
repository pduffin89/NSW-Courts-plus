(function initNswPartyParser(root) {
  const MINOR_WORDS = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "via"
  ]);

  const FORCED_UPPER = new Set([
    "AAI",
    "AAMI",
    "ACT",
    "BUPA",
    "DD",
    "NSW",
    "NT",
    "QLD",
    "SA",
    "TAS",
    "VIC",
    "WA"
  ]);

  function cleanSpaces(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function smartCaseToken(token, isFirst) {
    const match = token.match(/^([^A-Za-z0-9']*)(.*?)([^A-Za-z0-9']*)$/);
    if (!match) return token;
    const lead = match[1] || "";
    const core = match[2] || "";
    const trail = match[3] || "";
    if (!core) return token;

    const upperCore = core.toUpperCase();
    if (FORCED_UPPER.has(upperCore)) {
      return `${lead}${upperCore}${trail}`;
    }
    if (isFirst && upperCore.length <= 2 && /^[A-Z]+$/.test(upperCore) && core === upperCore) {
      return `${lead}${upperCore}${trail}`;
    }

    let titled = "";
    if (core === upperCore && /^[A-Za-z][A-Za-z'\-]*$/.test(core)) {
      const hyParts = core.split("-");
      const hyOut = hyParts.map((hyPart) => {
        const apos = hyPart.split("'");
        const aposOut = apos.map((piece) => {
          if (!piece) return piece;
          return piece.slice(0, 1).toUpperCase() + piece.slice(1).toLowerCase();
        });
        return aposOut.join("'");
      });
      titled = hyOut.join("-");
    } else {
      titled = core.slice(0, 1).toUpperCase() + core.slice(1).toLowerCase();
    }

    if (MINOR_WORDS.has(titled.toLowerCase()) && !isFirst) {
      titled = titled.toLowerCase();
    }
    return `${lead}${titled}${trail}`;
  }

  function smartCase(text) {
    const raw = cleanSpaces(text);
    if (!raw) return "";
    const tokens = raw.split(" ");
    return tokens.map((token, idx) => smartCaseToken(token, idx === 0)).join(" ");
  }

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    items.forEach((item) => {
      const clean = cleanSpaces(item);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
    return out;
  }

  function stripNoisePrefixes(text) {
    let out = cleanSpaces(text);
    out = out.replace(/^\s*notice\s+of\s+motion(?:\s+civil)?\s*[-:]\s*/i, "");
    out = out.replace(/^\s*in\s+the\s+matter\s+of\s+/i, "");
    return cleanSpaces(out);
  }

  function stripCorporateSuffixes(text) {
    let out = cleanSpaces(text);
    out = out.replace(/\s+(?:pty|proprietary)\.?\s*(?:ltd|limited)\.?\s*$/i, "");
    return cleanSpaces(out);
  }

  function cleanEntity(text) {
    let out = cleanSpaces(text).replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "");
    out = out.replace(/^\(\s*(.*?)\s*\)$/, "$1");
    out = out.replace(/^\s*the\s+trustees\s+of\s+the\s+/i, "");
    out = out.replace(/^\s*the\s+trustees\s+of\s+/i, "");
    out = out.replace(/^\s*the\s+/i, "");
    out = out.replace(/\s+agent\s+of\s+.*$/i, "");
    out = stripCorporateSuffixes(out);
    return smartCase(out);
  }

  function splitOnAmpersand(text) {
    return cleanSpaces(text)
      .split(/\s*&\s*/g)
      .map((part) => cleanSpaces(part))
      .filter(Boolean);
  }

  function expandSegment(segment) {
    const text = stripNoisePrefixes(segment);
    if (!text) return [];

    const tutorMatch = text.match(/\bby\s+(?:his|her|their)\s+tutor\s+/i);
    if (tutorMatch && typeof tutorMatch.index === "number") {
      const lhs = text.slice(0, tutorMatch.index);
      const rhs = text.slice(tutorMatch.index + tutorMatch[0].length);
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    const guardianMatch = text.match(/\blitigation\s+guardian\s+for\s+/i);
    if (guardianMatch && typeof guardianMatch.index === "number") {
      let lhs = text.slice(0, guardianMatch.index);
      lhs = lhs.replace(/\btrading\s+as(?:\s+as)?\s*$/i, "");
      const rhs = text.slice(guardianMatch.index + guardianMatch[0].length);
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    const behalfMatch = text.match(/\b(?:on|of)\s+behalf\s+of\s+/i);
    if (behalfMatch && typeof behalfMatch.index === "number") {
      const lhs = text.slice(0, behalfMatch.index);
      const rhs = text.slice(behalfMatch.index + behalfMatch[0].length);
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    const respectMatch = text.match(/\bin\s+respect\s+of\s+/i);
    if (respectMatch && typeof respectMatch.index === "number") {
      const lhs = text.slice(0, respectMatch.index);
      const rhs = text.slice(respectMatch.index + respectMatch[0].length);
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    const tradingMatch = text.match(/\btrading\s+as(?:\s+as)?\s+/i);
    if (tradingMatch && typeof tradingMatch.index === "number") {
      const lhs = text.slice(0, tradingMatch.index);
      let rhs = text.slice(tradingMatch.index + tradingMatch[0].length);
      rhs = rhs.replace(/\s+agent\s+of\s+.*$/i, "");
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    const formerMatch = text.match(/\bformerly\s+known\s+as\s+/i);
    if (formerMatch && typeof formerMatch.index === "number") {
      const lhs = text.slice(0, formerMatch.index);
      const rhs = text.slice(formerMatch.index + formerMatch[0].length);
      return dedupe([cleanEntity(lhs), cleanEntity(rhs)]);
    }

    return dedupe(splitOnAmpersand(text).map((part) => cleanEntity(part)));
  }

  function splitOnV(text) {
    const match = text.match(/\s+v\s+/i);
    if (!match || typeof match.index !== "number") return null;
    const lhs = cleanSpaces(text.slice(0, match.index));
    const rhs = cleanSpaces(text.slice(match.index + match[0].length));
    return [lhs, rhs];
  }

  function isCriminal(matter) {
    const jurisdiction = cleanSpaces((matter && matter.jurisdiction) || "").toLowerCase();
    if (jurisdiction.includes("criminal")) return true;
    const matterName = cleanSpaces((matter && matter.matter_name) || "");
    return /^\s*r\s+v\s+/i.test(matterName);
  }

  function parseNewsSearchCandidates(matter) {
    const matterName = cleanSpaces((matter && matter.matter_name) || "");
    if (!matterName) return [];

    if (/^\s*apprehended\s+violence\s+application\b/i.test(matterName)) {
      const forMatch = matterName.match(/\bfor\s+/i);
      if (forMatch && typeof forMatch.index === "number") {
        const postFor = cleanSpaces(matterName.slice(forMatch.index + forMatch[0].length));
        const split = splitOnV(postFor);
        if (split) {
          return dedupe(expandSegment(split[0]).concat(expandSegment(split[1])));
        }
        return expandSegment(postFor);
      }
    }

    const text = stripNoisePrefixes(matterName);
    const split = splitOnV(text);
    if (split) {
      const lhs = split[0];
      const rhs = split[1];
      if (isCriminal(matter)) {
        return dedupe(expandSegment(rhs));
      }
      return dedupe(expandSegment(lhs).concat(expandSegment(rhs)));
    }
    return expandSegment(text);
  }

  function defaultNewsCandidate(matter) {
    const candidates = parseNewsSearchCandidates(matter);
    return candidates.length ? candidates[0] : "";
  }

  function buildGoogleNewsSearchUrl(query) {
    const q = encodeURIComponent(cleanSpaces(query));
    return `https://news.google.com/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
  }

  function buildGoogleNewsRssUrl(query) {
    const q = encodeURIComponent(cleanSpaces(query));
    return `https://news.google.com/rss/search?q=${q}&hl=en-AU&gl=AU&ceid=AU:en`;
  }

  root.NswPartyParser = {
    cleanSpaces,
    parseNewsSearchCandidates,
    defaultNewsCandidate,
    buildGoogleNewsSearchUrl,
    buildGoogleNewsRssUrl
  };
})(typeof window !== "undefined" ? window : globalThis);

