import re
from io import BytesIO
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject, TextStringObject
from reportlab.pdfgen import canvas

from .config import APP_TZ, MEDIA_DOC_TO_FIELD, NON_PARTY_ACK_FIELDS
from .models import Matter, Profile


def now_dates() -> tuple[str, str]:
    now = datetime.now(APP_TZ)
    long_date = f"{now.day} {now.strftime('%B %Y')}"
    short_date = f"{now.day}/{now.month}/{now.year}"
    return long_date, short_date


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip())
    return cleaned.strip("_") or "matter"


def _clean_spaces(value: str) -> str:
    return " ".join((value or "").split()).strip()


def _strip_signature_prefix(value: str) -> str:
    clean = _clean_spaces(value)
    return re.sub(r"^/s/\s*", "", clean, flags=re.IGNORECASE)


def signature_from_name(name: str) -> str:
    return _strip_signature_prefix(name)


def _effective_signature_text(profile: Profile) -> str:
    explicit = _strip_signature_prefix(profile.signature_text or "")
    if explicit:
        return explicit
    return signature_from_name(profile.applicant_name)


def _truncate(value: str, max_len: int) -> str:
    text = _clean_spaces(value)
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return f"{text[: max_len - 3].rstrip()}..."


def _canonical_criminal_plaintiff(value: str) -> str:
    text = _clean_spaces(value)
    if not text:
        return "R"
    if re.match(r"^(r|regina|the king|the queen)$", text, flags=re.IGNORECASE):
        return "R"
    return text


def _is_criminal_style_matter(matter: Matter, plaintiff: str) -> bool:
    jurisdiction = _clean_spaces(matter.jurisdiction).lower()
    if "criminal" in jurisdiction:
        return True
    lhs = _clean_spaces(plaintiff).lower()
    if re.match(r"^(r|regina|the king|the queen|dpp|director of public prosecutions)\b", lhs):
        return True
    name = _clean_spaces(matter.matter_name).lower()
    return bool(re.match(r"^r\s*v\b", name))


def _compact_case_title(matter: Matter, max_len: int = 64) -> str:
    full = _clean_spaces(matter.matter_name)
    if not full:
        return _truncate(matter.case_number, max_len)

    plaintiff, defendant = split_parties(matter)
    lhs = _clean_spaces(plaintiff) or "R"
    rhs_full = _clean_spaces(matter.defendant or defendant)

    if _is_criminal_style_matter(matter, lhs) and rhs_full:
        candidate = _clean_spaces(f"{_canonical_criminal_plaintiff(lhs)} v {rhs_full}")
        if len(candidate) <= max_len:
            return candidate
        return _truncate(candidate, max_len)

    if full:
        return _truncate(full, max_len)
    return _truncate(matter.case_number, max_len)


def _auto_case_title_font_size(case_title: str, default_size: float = 9.0) -> float:
    length = len(_clean_spaces(case_title))
    if length <= 24:
        return default_size
    if length <= 34:
        return 8.0
    if length <= 44:
        return 7.5
    if length <= 56:
        return 7.0
    return 6.5


def _abbreviate_court_name(court: str) -> str:
    text = _clean_spaces(court)
    if not text:
        return ""
    substitutions = (
        (r"\bSupreme Court\b", "Supreme Ct"),
        (r"\bDistrict Court\b", "District Ct"),
        (r"\bLocal Court\b", "Local Ct"),
        (r"\bChildren'?s Court\b", "Children's Ct"),
        (r"\bCoroner'?s Court\b", "Coroner's Ct"),
    )
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return _clean_spaces(text)


def _compact_court_text(matter: Matter, max_len: int = 24) -> str:
    location = _clean_spaces(matter.court_location)
    short_location = _clean_spaces(
        re.sub(
            r"\bCourt\b",
            "Ct",
            re.sub(r"\bDivision\b", "Div", location, flags=re.IGNORECASE),
            flags=re.IGNORECASE,
        )
    )
    court = _abbreviate_court_name(matter.court)
    if short_location and len(short_location) <= max_len:
        return short_location
    if location and len(location) <= max_len:
        return location
    if court and len(court) <= max_len:
        return court
    if location and court:
        with_court = _clean_spaces(f"{location} ({court})")
        if len(with_court) <= max_len:
            return with_court
    if location:
        return _truncate(short_location, max_len)
    return _truncate(court or matter.court, max_len)


NON_PARTY_FIELD_FONT_SIZES: dict[str, float] = {
    "Text28": 9.0,   # Case name field is physically narrow in the template.
    "Text29": 9.0,   # Court/location field is physically narrow in the template.
    "Text48": 11.0,
    "Text51": 11.0,
}


def split_parties(matter: Matter) -> tuple[str, str]:
    plaintiff = matter.plaintiff.strip()
    defendant = matter.defendant.strip()
    if plaintiff and defendant:
        return plaintiff, defendant
    tokens = re.split(r"\bv\b", matter.matter_name, flags=re.IGNORECASE)
    if len(tokens) >= 2:
        lhs = tokens[0].strip(" -:")
        rhs = tokens[1].strip(" -:")
        return lhs, rhs
    return matter.matter_name, ""


def _checkbox_on_values(reader: PdfReader) -> dict[str, str]:
    states: dict[str, str] = {}
    for page in reader.pages:
        annots = page.get("/Annots")
        if not annots:
            continue
        try:
            widgets = list(annots)
        except TypeError:
            widgets = list(annots.get_object())
        for widget_ref in widgets:
            widget = widget_ref.get_object()
            if widget.get("/FT") != "/Btn":
                continue
            name = widget.get("/T")
            if not name:
                continue
            on_value = "/Yes"
            appearance = widget.get("/AP")
            if appearance and appearance.get("/N"):
                names = [str(v) for v in appearance["/N"].keys()]
                active = [v for v in names if v != "/Off"]
                if active:
                    on_value = active[0]
            states[str(name)] = on_value
    return states


def _normalize_pdf_values(
    values: dict[str, Any], checkbox_states: dict[str, str]
) -> dict[str, Any]:
    # Start from all checkboxes off so template default ticks never leak into output.
    normalized: dict[str, Any] = {key: "/Off" for key in checkbox_states}
    for key, value in values.items():
        if key in checkbox_states:
            if isinstance(value, str) and value.startswith("/"):
                normalized[key] = value
            elif bool(value):
                normalized[key] = checkbox_states[key]
            else:
                normalized[key] = "/Off"
            continue
        normalized[key] = value
    return normalized


def fill_pdf(
    template_path: Path,
    output_path: Path,
    values: dict[str, Any],
    field_font_sizes: Optional[dict[str, float]] = None,
) -> None:
    reader = PdfReader(str(template_path))
    checkbox_states = _checkbox_on_values(reader)
    normalized_values = _normalize_pdf_values(values, checkbox_states)
    effective_field_font_sizes = dict(field_font_sizes or {})
    if "Text28" in normalized_values:
        effective_field_font_sizes["Text28"] = _auto_case_title_font_size(
            str(normalized_values.get("Text28") or ""),
            default_size=float(effective_field_font_sizes.get("Text28", 9.0)),
        )

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    for page in writer.pages:
        writer.update_page_form_field_values(page, normalized_values, auto_regenerate=False)
    _force_set_fields(
        writer,
        normalized_values,
        checkbox_states,
        field_font_sizes=effective_field_font_sizes,
    )
    _apply_widget_font_sizes(writer, effective_field_font_sizes)
    writer.update_page_form_field_values(
        list(writer.pages),
        normalized_values,
        auto_regenerate=True,
        flatten=True,
    )
    checked_boxes = _checked_checkbox_fields(normalized_values, checkbox_states)
    if checked_boxes:
        _overlay_checked_boxes(writer, checked_boxes)
    _strip_form_interactivity(writer)

    with output_path.open("wb") as handle:
        writer.write(handle)


def _strip_form_interactivity(writer: PdfWriter) -> None:
    annots_key = NameObject("/Annots")
    for page in writer.pages:
        if annots_key in page:
            del page[annots_key]

    acro = writer.root_object.get("/AcroForm")
    if not acro:
        return
    acro_obj = acro.get_object()
    acro_obj[NameObject("/Fields")] = ArrayObject()
    if NameObject("/NeedAppearances") in acro_obj:
        del acro_obj[NameObject("/NeedAppearances")]


def _pdf_value_is_checked(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip() != "" and value != "/Off"
    return bool(value)


def _checked_checkbox_fields(
    normalized_values: dict[str, Any], checkbox_states: dict[str, str]
) -> set[str]:
    checked: set[str] = set()
    for field_name in checkbox_states:
        if _pdf_value_is_checked(normalized_values.get(field_name)):
            checked.add(field_name)
    return checked


def _overlay_checked_boxes(writer: PdfWriter, checked_fields: set[str]) -> None:
    if not checked_fields:
        return

    for page in writer.pages:
        annots = page.get("/Annots")
        if not annots:
            continue
        try:
            widgets = list(annots)
        except TypeError:
            widgets = list(annots.get_object())

        marks: list[tuple[float, float, float, float]] = []
        for widget_ref in widgets:
            widget = widget_ref.get_object()
            field_obj = widget
            parent = widget.get("/Parent")
            if parent:
                field_obj = parent.get_object()

            ftype = field_obj.get("/FT") or widget.get("/FT")
            if str(ftype) != "/Btn":
                continue

            name_obj = widget.get("/T") or field_obj.get("/T")
            if name_obj is None:
                continue
            field_name = str(name_obj)
            if field_name not in checked_fields:
                continue

            rect_obj = widget.get("/Rect")
            if not rect_obj or len(rect_obj) < 4:
                continue
            x0, y0, x1, y1 = [float(v) for v in rect_obj]
            left = min(x0, x1)
            bottom = min(y0, y1)
            right = max(x0, x1)
            top = max(y0, y1)
            marks.append((left, bottom, right, top))

        if not marks:
            continue

        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        packet = BytesIO()
        c = canvas.Canvas(packet, pagesize=(width, height))
        for left, bottom, right, top in marks:
            box_w = max(0.0, right - left)
            box_h = max(0.0, top - bottom)
            size = max(7.0, min(11.0, min(box_w, box_h) * 0.8))
            c.setFont("Helvetica-Bold", size)
            c.drawString(left + 1.0, bottom + max(0.6, (box_h - size) / 2), "X")
        c.save()
        packet.seek(0)

        overlay_reader = PdfReader(packet)
        page.merge_page(overlay_reader.pages[0])


def _set_widget_appearance(field_obj: Any, value_name: NameObject) -> None:
    kids = field_obj.get("/Kids")
    if kids:
        for kid_ref in kids:
            kid = kid_ref.get_object()
            kid[NameObject("/AS")] = value_name
    else:
        field_obj[NameObject("/AS")] = value_name


def _replace_da_font_size(da: str, size: float) -> str:
    da_text = _clean_spaces(da)
    if not da_text:
        return f"/Helvetica {size:g} Tf 0 g"
    updated = re.sub(
        r"(/[^ ]+)\s+[-+]?\d+(?:\.\d+)?\s+Tf",
        rf"\1 {size:g} Tf",
        da_text,
        count=1,
    )
    if updated == da_text:
        return f"/Helvetica {size:g} Tf 0 g"
    return updated


def _set_text_field_font_size(field_obj: Any, size: float) -> None:
    field_da = _replace_da_font_size(str(field_obj.get("/DA") or ""), size)
    field_obj[NameObject("/DA")] = TextStringObject(field_da)

    kids = field_obj.get("/Kids")
    if not kids:
        return
    for kid_ref in kids:
        kid = kid_ref.get_object()
        kid_da = _replace_da_font_size(str(kid.get("/DA") or field_da), size)
        kid[NameObject("/DA")] = TextStringObject(kid_da)


def _apply_widget_font_sizes(writer: PdfWriter, field_font_sizes: dict[str, float]) -> None:
    if not field_font_sizes:
        return
    for page in writer.pages:
        annots = page.get("/Annots")
        if not annots:
            continue
        try:
            widgets = list(annots)
        except TypeError:
            widgets = list(annots.get_object())
        for widget_ref in widgets:
            widget = widget_ref.get_object()
            name_obj = widget.get("/T")
            if name_obj is None and widget.get("/Parent"):
                name_obj = widget["/Parent"].get_object().get("/T")
            if name_obj is None:
                continue
            name = str(name_obj)
            size = field_font_sizes.get(name)
            if not size:
                continue
            da = _replace_da_font_size(str(widget.get("/DA") or ""), size)
            widget[NameObject("/DA")] = TextStringObject(da)


def _force_set_fields(
    writer: PdfWriter,
    values: dict[str, Any],
    checkbox_states: dict[str, str],
    field_font_sizes: dict[str, float],
) -> None:
    acro = writer.root_object.get("/AcroForm")
    if not acro:
        return
    fields = acro.get("/Fields") or []
    for field_ref in fields:
        field_obj = field_ref.get_object()
        name = field_obj.get("/T")
        name_str = str(name) if name is not None else ""
        if not name_str or name_str not in values:
            continue

        ftype = field_obj.get("/FT")
        value = values[name_str]
        if ftype == "/Btn":
            if isinstance(value, str) and value.startswith("/"):
                v_name = NameObject(value)
            elif bool(value):
                v_name = NameObject(checkbox_states.get(name_str, "/Yes"))
            else:
                v_name = NameObject("/Off")
            field_obj[NameObject("/V")] = v_name
            _set_widget_appearance(field_obj, v_name)
        else:
            font_size = field_font_sizes.get(name_str)
            if font_size:
                _set_text_field_font_size(field_obj, font_size)
            field_obj[NameObject("/V")] = TextStringObject("" if value is None else str(value))


def media_2026_values(
    profile: Profile,
    matter: Matter,
    requested_docs: set[str],
    details: dict[str, str],
) -> dict[str, Any]:
    long_date, _ = now_dates()
    plaintiff, defendant = split_parties(matter)
    signature_text = _effective_signature_text(profile)
    unsupported_for_media = sorted(
        doc
        for doc in requested_docs
        if doc
        not in {
            "crown_bundle",
            "submissions",
            "selected_images",
            "originating_process",
            "transcript",
            "exhibits",
            "notice_of_appeal",
            "other",
        }
    )
    media_other = details.get("other", "")
    if unsupported_for_media:
        extra = ", ".join(unsupported_for_media)
        media_other = f"{media_other}; {extra}".strip("; ").strip()

    values: dict[str, Any] = {
        "Name": profile.applicant_name,
        "Organisation": profile.organisation,
        "Contact number": profile.contact_number,
        "Email": profile.email,
        "Case number yearnumber": matter.case_number,
        "Plaintiff  Appellant name": plaintiff,
        "Defendant  Respondent name": defendant,
        "Applicant Signature": signature_text,
        "Dated": long_date,
        "I submit that access to records on the court file should be granted because": (
            "Public interest reporting by accredited media."
        ),
        "Transcript dates": details.get("transcript_dates", ""),
        "Exhibits": details.get("exhibits", ""),
        "Others": media_other,
        "specify images": details.get("selected_images", ""),
        "Check Box63": True,
        "Check Box64": True,
        "Check Box65": True,
    }
    for doc_key, field_name in MEDIA_DOC_TO_FIELD.items():
        values[field_name] = doc_key in requested_docs
    return values


def _non_party_jurisdiction_field(court_text: str, jurisdiction_text: str = "") -> Optional[str]:
    text = court_text.lower()
    jurisdiction = jurisdiction_text.lower()
    if "children" in text:
        return "Button8"
    if "district" in text:
        return "Button7"
    if "local" in text or "coroner" in text:
        if "civil" in text or "civil" in jurisdiction:
            return "Button10"
        return "Button6"
    return None


def _apply_non_party_document_map(
    requested_docs: set[str], details: dict[str, str], values: dict[str, Any]
) -> None:
    if "indictment_can" in requested_docs or "originating_process" in requested_docs:
        values["Button11"] = True

    if "transcript" in requested_docs:
        values["Button14"] = True
        values["Text34"] = details.get("transcript_dates", "")

    if "witness_statements" in requested_docs:
        values["Button12"] = True

    if "police_fact_sheet" in requested_docs:
        values["Button13"] = True

    if "record_conviction_or_order" in requested_docs:
        values["Button15"] = True

    if "sealed_copy_judgment" in requested_docs:
        values["Button17"] = True

    if "certified_copy_reasons" in requested_docs:
        values["Button18"] = True

    if "civil_pleading" in requested_docs or "originating_process" in requested_docs:
        values["Button20"] = True
        values["Text31"] = details.get("civil_pleading", "Pleadings / originating process")

    if "civil_other_filed" in requested_docs:
        values["Button21"] = True
        values["Text32"] = details.get("civil_other_filed", "Other filed civil document")

    if "exhibits" in requested_docs:
        values["Button21"] = True
        values["Text32"] = details.get("exhibits", "Exhibits")

    if "notice_of_appeal" in requested_docs:
        values["Button16"] = True
        values["Text33"] = "Notice of Appeal / grounds of appeal"

    if "other" in requested_docs:
        values["Button16"] = True
        values["Text33"] = details.get("other", "Other documents as selected")

    if "selected_images" in requested_docs:
        values["Button16"] = True
        values["Text33"] = details.get("selected_images", "Selected images in court file")


def non_party_values(
    profile: Profile,
    matter: Matter,
    requested_docs: set[str],
    details: dict[str, str],
) -> dict[str, Any]:
    _, short_date = now_dates()
    signature_text = _effective_signature_text(profile)
    values: dict[str, Any] = {
        "Button1": True,
        "Button2": False,
        "Button3": False,
        "Text22": profile.applicant_name,
        "Text23": profile.occupation or "Journalist",
        "Text24": profile.organisation,
        "Text25": profile.email,
        "Text26": profile.contact_number,
        "Button4": True,
        "Button5": False,
        "Text27": matter.case_number,
        "Text28": _compact_case_title(matter),
        "Text29": _compact_court_text(matter),
        "Text35": details.get("additional_details", ""),
        "Button37": True,
        "Text48": signature_text,
        "Text49": short_date,
        "Text50": profile.applicant_name,
        "Text51": signature_text,
        "Text52": short_date,
    }

    # Ensure only the correct court/jurisdiction box is selected.
    values["Button6"] = False   # Local Court Crime
    values["Button7"] = False   # District Court Crime
    values["Button8"] = False   # Children's Court Crime
    values["Button10"] = False  # Local Court Civil

    jurisdiction_field = _non_party_jurisdiction_field(matter.court, matter.jurisdiction)
    if jurisdiction_field:
        values[jurisdiction_field] = True

    for field_name in NON_PARTY_ACK_FIELDS:
        values[field_name] = True

    _apply_non_party_document_map(requested_docs, details, values)
    return values
