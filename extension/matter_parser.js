(function initNswMatterParser(root) {
  const CASE_NUMBER_RE = /\b\d{4}\/\d{1,10}\b|\b\d{12}\b/;

  const defaultMatter = {
    case_number: "",
    matter_name: "",
    court: "Supreme Court",
    jurisdiction: "",
    court_location: "",
    listing_type: "",
    listing_date: "",
    plaintiff: "",
    defendant: ""
  };

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function elementText(element) {
    return cleanText((element && (element.innerText || element.textContent)) || "");
  }

  function detectCourtFromText(text) {
    const haystack = cleanText(text).toLowerCase();
    if (!haystack) return "";
    if (haystack.includes("district court") || /\bdistrict\b/.test(haystack)) return "District Court";
    if (haystack.includes("supreme court")) return "Supreme Court";
    if (haystack.includes("children")) return "Children's Court";
    if (haystack.includes("coroner")) return "Coroner's Court";
    if (haystack.includes("local court") || /\blocal\b/.test(haystack)) return "Local Court";
    return "";
  }

  function inferCourtFromContextParts(parts) {
    const context = cleanText((parts || []).join(" ")).toLowerCase();
    if (context.includes("district")) return "District Court";
    if (context.includes("children")) return "Children's Court";
    if (context.includes("local")) return "Local Court";
    if (context.includes("coroner")) return "Coroner's Court";
    if (context.includes("supreme")) return "Supreme Court";
    return "Supreme Court";
  }

  function rowContextParts(row, text) {
    const contextParts = [text];
    let node = row && row.parentElement;
    let hop = 0;
    while (node && hop < 8) {
      const maybeHeading = elementText(node.previousElementSibling);
      if (maybeHeading) contextParts.push(maybeHeading);
      node = node.parentElement;
      hop += 1;
    }
    return contextParts;
  }

  function resolveCourtFromParts(row, parts) {
    const combined = cleanText((parts || []).join(" "));
    const direct = detectCourtFromText(combined);
    if (direct) return direct;
    return inferCourtFromContextParts(rowContextParts(row, combined));
  }

  function splitMatterParties(matterName) {
    const split = cleanText(matterName).split(/\bv\b/i);
    if (split.length < 2) return ["", ""];
    return [cleanText(split[0]), cleanText(split.slice(1).join("v"))];
  }

  function parseMatterFromRow(row, defaults) {
    const baseMatter = { ...defaultMatter, ...(defaults || {}) };
    const cells = Array.from(row && typeof row.querySelectorAll === "function" ? row.querySelectorAll("td") : []);
    if (cells.length >= 10) {
      const caseCell = elementText(cells[2]);
      const caseMatch = caseCell.match(CASE_NUMBER_RE);
      if (!caseMatch) return null;
      const caseNumber = caseMatch[0];
      const matterName = elementText(cells[3]);
      const jurisdictionCell = elementText(cells[4]);
      const courtCell = elementText(cells[5]);
      const listingTypeCell = elementText(cells[6]);
      const locationCell = elementText(cells[8]);
      const listingDate = cleanText(`${elementText(cells[0])} ${elementText(cells[1])}`);
      const rowText = elementText(row);
      const [plaintiff, defendant] = splitMatterParties(matterName);

      return {
        ...baseMatter,
        case_number: caseNumber,
        matter_name: matterName || caseNumber,
        court: resolveCourtFromParts(row, [courtCell, jurisdictionCell, locationCell, rowText, matterName]),
        jurisdiction: jurisdictionCell,
        court_location: locationCell,
        listing_type: listingTypeCell,
        listing_date: listingDate,
        plaintiff,
        defendant
      };
    }

    const text = elementText(row);
    const caseMatch = text.match(CASE_NUMBER_RE);
    if (!caseMatch) return null;
    const caseNumber = caseMatch[0];
    return {
      ...baseMatter,
      case_number: caseNumber,
      matter_name: caseNumber,
      court: resolveCourtFromParts(row, [text])
    };
  }

  root.NswMatterParser = {
    cleanText,
    detectCourtFromText,
    inferCourtFromContextParts,
    parseMatterFromRow
  };
})(typeof window !== "undefined" ? window : globalThis);
