import re
from typing import Iterable, List, Optional


_MINOR_WORDS = {
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
    "via",
}

_FORCED_UPPER = {
    "BUPA",
    "AAI",
    "DD",
    "ACT",
    "AAMI",
    "NSW",
    "NT",
    "QLD",
    "SA",
    "TAS",
    "VIC",
    "WA",
}


def _clean_spaces(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _smart_case_token(token: str, is_first: bool) -> str:
    match = re.match(r"^([^A-Za-z0-9']*)(.*?)([^A-Za-z0-9']*)$", token)
    if not match:
        return token
    lead, core, trail = match.groups()
    if not core:
        return token

    upper_core = core.upper()
    if upper_core in _FORCED_UPPER:
        return f"{lead}{upper_core}{trail}"
    if (
        is_first
        and len(upper_core) <= 2
        and upper_core.isalpha()
        and core.upper() == core
    ):
        return f"{lead}{upper_core}{trail}"

    if core.upper() == core and re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", core):
        pieces = []
        for hy_part in core.split("-"):
            apos = hy_part.split("'")
            apos = [p[:1].upper() + p[1:].lower() if p else p for p in apos]
            pieces.append("'".join(apos))
        titled = "-".join(pieces)
    else:
        titled = core[:1].upper() + core[1:].lower()

    if titled.lower() in _MINOR_WORDS and not is_first:
        titled = titled.lower()

    return f"{lead}{titled}{trail}"


def _smart_case(text: str) -> str:
    raw = _clean_spaces(text)
    if not raw:
        return ""
    tokens = raw.split(" ")
    return " ".join(_smart_case_token(token, idx == 0) for idx, token in enumerate(tokens))


def _dedupe(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for value in values:
        item = _clean_spaces(value)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _strip_noise_prefixes(text: str) -> str:
    out = _clean_spaces(text)
    patterns = (
        r"^\s*notice\s+of\s+motion(?:\s+civil)?\s*[-:]\s*",
        r"^\s*in\s+the\s+matter\s+of\s+",
    )
    for pattern in patterns:
        out = re.sub(pattern, "", out, flags=re.IGNORECASE)
    return _clean_spaces(out)


def _strip_corporate_suffixes(text: str) -> str:
    out = _clean_spaces(text)
    out = re.sub(
        r"\s+(?:pty|proprietary)\.?\s*(?:ltd|limited)\.?\s*$",
        "",
        out,
        flags=re.IGNORECASE,
    )
    return _clean_spaces(out)


def _clean_entity(text: str) -> str:
    out = _clean_spaces(text)
    out = out.strip(" ,;:-")
    out = re.sub(r"^\(\s*(.*?)\s*\)$", r"\1", out)

    out = re.sub(
        r"^\s*the\s+trustees\s+of\s+the\s+",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"^\s*the\s+trustees\s+of\s+",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(r"^\s*the\s+", "", out, flags=re.IGNORECASE)
    out = re.sub(
        r"\s+agent\s+of\s+.*$",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = _strip_corporate_suffixes(out)
    out = _clean_spaces(out)
    return _smart_case(out)


def _split_entities_on_ampersand(text: str) -> List[str]:
    parts = re.split(r"\s*&\s*", _clean_spaces(text))
    return [part for part in parts if part]


def _expand_segment(segment: str) -> List[str]:
    text = _strip_noise_prefixes(segment)
    if not text:
        return []

    tutor_match = re.search(r"\bby\s+(?:his|her|their)\s+tutor\s+", text, flags=re.IGNORECASE)
    if tutor_match:
        lhs = text[: tutor_match.start()]
        rhs = text[tutor_match.end() :]
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    guardian_match = re.search(
        r"\blitigation\s+guardian\s+for\s+",
        text,
        flags=re.IGNORECASE,
    )
    if guardian_match:
        lhs = text[: guardian_match.start()]
        lhs = re.sub(r"\btrading\s+as(?:\s+as)?\s*$", "", lhs, flags=re.IGNORECASE)
        rhs = text[guardian_match.end() :]
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    behalf_match = re.search(
        r"\b(?:on|of)\s+behalf\s+of\s+",
        text,
        flags=re.IGNORECASE,
    )
    if behalf_match:
        lhs = text[: behalf_match.start()]
        rhs = text[behalf_match.end() :]
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    respect_match = re.search(r"\bin\s+respect\s+of\s+", text, flags=re.IGNORECASE)
    if respect_match:
        lhs = text[: respect_match.start()]
        rhs = text[respect_match.end() :]
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    trading_match = re.search(r"\btrading\s+as(?:\s+as)?\s+", text, flags=re.IGNORECASE)
    if trading_match:
        lhs = text[: trading_match.start()]
        rhs = text[trading_match.end() :]
        rhs = re.sub(r"\s+agent\s+of\s+.*$", "", rhs, flags=re.IGNORECASE)
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    former_match = re.search(r"\bformerly\s+known\s+as\s+", text, flags=re.IGNORECASE)
    if former_match:
        lhs = text[: former_match.start()]
        rhs = text[former_match.end() :]
        return _dedupe([_clean_entity(lhs), _clean_entity(rhs)])

    entities = [_clean_entity(item) for item in _split_entities_on_ampersand(text)]
    return _dedupe(entities)


def _split_on_v(text: str) -> Optional[tuple[str, str]]:
    match = re.search(r"\s+v\s+", text, flags=re.IGNORECASE)
    if not match:
        return None
    lhs = text[: match.start()]
    rhs = text[match.end() :]
    return _clean_spaces(lhs), _clean_spaces(rhs)


def _is_criminal(jurisdiction: str, matter_name: str) -> bool:
    if "criminal" in (jurisdiction or "").lower():
        return True
    return bool(re.match(r"^\s*r\s+v\s+", matter_name or "", flags=re.IGNORECASE))


def parse_news_search_candidates(matter_name: str, jurisdiction: str = "") -> List[str]:
    raw = _clean_spaces(matter_name)
    if not raw:
        return []

    avo_match = re.search(
        r"^\s*apprehended\s+violence\s+application\b",
        raw,
        flags=re.IGNORECASE,
    )
    if avo_match:
        for_match = re.search(r"\bfor\s+", raw, flags=re.IGNORECASE)
        if for_match:
            post_for = _clean_spaces(raw[for_match.end() :])
            split = _split_on_v(post_for)
            if split:
                lhs, rhs = split
                return _dedupe(_expand_segment(lhs) + _expand_segment(rhs))
            return _expand_segment(post_for)

    text = _strip_noise_prefixes(raw)
    split = _split_on_v(text)
    if split:
        lhs, rhs = split
        if _is_criminal(jurisdiction, text):
            if re.fullmatch(r"r", lhs, flags=re.IGNORECASE):
                return _dedupe(_expand_segment(rhs))
            return _dedupe(_expand_segment(rhs))
        return _dedupe(_expand_segment(lhs) + _expand_segment(rhs))

    return _expand_segment(text)


def default_news_candidate(matter_name: str, jurisdiction: str = "") -> Optional[str]:
    candidates = parse_news_search_candidates(matter_name, jurisdiction=jurisdiction)
    if not candidates:
        return None
    return candidates[0]


def build_google_news_rss_url(query: str) -> str:
    from urllib.parse import quote_plus

    q = quote_plus(_clean_spaces(query))
    return f"https://news.google.com/rss/search?q={q}&hl=en-AU&gl=AU&ceid=AU:en"
