#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "service"))

from autofill.news_party_parser import parse_news_search_candidates  # noqa: E402


CASES = [
    {
        "matter_name": "R v SAMUEL JAMES PATRICK MELEHAN",
        "jurisdiction": "Criminal",
        "expected": ["Samuel James Patrick Melehan"],
    },
    {
        "matter_name": (
            "Apprehended Violence Application SENCON MICHAELA SMIDT for Samantha O'ROURKE "
            "v Clinton INSLEY"
        ),
        "jurisdiction": "Criminal",
        "expected": ["Samantha O'Rourke", "Clinton Insley"],
    },
    {
        "matter_name": "Joshua Lees of behalf of the Palestine Action Group v State of New South Wales",
        "jurisdiction": "Civil",
        "expected": ["Joshua Lees", "Palestine Action Group", "State of New South Wales"],
    },
    {
        "matter_name": "Simon Younes v Transport for NSW",
        "jurisdiction": "Civil",
        "expected": ["Simon Younes", "Transport for NSW"],
    },
    {
        "matter_name": "Diane Harris v DEXUS LIFE NOMINEES PTY LIMITED trading as Casula Mall Shopping Centre",
        "jurisdiction": "Civil",
        "expected": ["Diane Harris", "Dexus Life Nominees", "Casula Mall Shopping Centre"],
    },
    {
        "matter_name": (
            "Adam Abberfield v Secretary Ministry of Health in Respect of "
            "Northern New South Wales Local Health District"
        ),
        "jurisdiction": "Civil",
        "expected": [
            "Adam Abberfield",
            "Secretary Ministry of Health",
            "Northern New South Wales Local Health District",
        ],
    },
    {
        "matter_name": "Stephen Howarth v MALLOY HOTELS OPERATIONS PTY LTD & SAMOTEL OPERATIONS PTY LIMITED",
        "jurisdiction": "Civil",
        "expected": ["Stephen Howarth", "Malloy Hotels Operations", "Samotel Operations"],
    },
    {
        "matter_name": "Fayza ELASSAAD v BUPA AGED CARE AUSTRALIA PTY LTD trading as BUPA GREENACRE",
        "jurisdiction": "Civil",
        "expected": ["Fayza Elassaad", "BUPA Aged Care Australia", "BUPA Greenacre"],
    },
    {
        "matter_name": "Brett Davis v AAI LIMITED trading as AAMI agent of The Nominal Defendant",
        "jurisdiction": "Civil",
        "expected": ["Brett Davis", "AAI Limited", "AAMI"],
    },
    {
        "matter_name": "New South Wales Crime Commission v Wayne Geoffrey Harrington",
        "jurisdiction": "Civil",
        "expected": ["New South Wales Crime Commission", "Wayne Geoffrey Harrington"],
    },
    {
        "matter_name": (
            "Christian Georgallis by his tutor Kim Georgallis v HEALTHSCOPE OPERATIONS PTY LTD "
            "trading as Sydney Southwest Private Hospital"
        ),
        "jurisdiction": "Civil",
        "expected": [
            "Christian Georgallis",
            "Kim Georgallis",
            "Healthscope Operations",
            "Sydney Southwest Private Hospital",
        ],
    },
    {
        "matter_name": "Notice of Motion Civil - Ying Guan v Yuping Zhong",
        "jurisdiction": "Civil",
        "expected": ["Ying Guan", "Yuping Zhong"],
    },
    {
        "matter_name": (
            "Liesa Maree Kenane v THE TRUSTEES OF THE ROMAN CATHOLIC CHURCH FOR "
            "THE DIOCESE OF PARRAMATTA"
        ),
        "jurisdiction": "Civil",
        "expected": [
            "Liesa Maree Kenane",
            "Roman Catholic Church for the Diocese of Parramatta",
        ],
    },
    {
        "matter_name": (
            "Valentina Nikolovska trading as as Litigation Guardian for Rade Nikolovski "
            "v SOUTH WESTERN SYDNEY LOCAL HEALTH DISTRICT"
        ),
        "jurisdiction": "Civil",
        "expected": [
            "Valentina Nikolovska",
            "Rade Nikolovski",
            "South Western Sydney Local Health District",
        ],
    },
    {
        "matter_name": "In the matter of DD LAND PTY. LTD.",
        "jurisdiction": "Civil",
        "expected": ["DD Land"],
    },
    {
        "matter_name": "in the matter of NANDISH SERVICES PTY. LTD.",
        "jurisdiction": "Civil",
        "expected": ["Nandish Services"],
    },
    {
        "matter_name": "Vanessa Leigh Prowse v Achilles Paffas trading as Paffas Lawyers",
        "jurisdiction": "Civil",
        "expected": ["Vanessa Leigh Prowse", "Achilles Paffas", "Paffas Lawyers"],
    },
    {
        "matter_name": "R v SARAH JANE RASIA",
        "jurisdiction": "Criminal",
        "expected": ["Sarah Jane Rasia"],
    },
    {
        "matter_name": "Apprehended Violence Application SENCON JAMES MURPHY for AS v Zakaria ALAWIE",
        "jurisdiction": "Criminal",
        "expected": ["AS", "Zakaria Alawie"],
    },
    {
        "matter_name": (
            "Daniel Herbert v Secretary Ministry of Health in respect of "
            "Northern NSW Local Health District"
        ),
        "jurisdiction": "Civil",
        "expected": [
            "Daniel Herbert",
            "Secretary Ministry of Health",
            "Northern NSW Local Health District",
        ],
    },
]


def main() -> int:
    failures = []
    for case in CASES:
        actual = parse_news_search_candidates(
            case["matter_name"],
            jurisdiction=case["jurisdiction"],
        )
        if actual != case["expected"]:
            failures.append(
                {
                    "matter_name": case["matter_name"],
                    "expected": case["expected"],
                    "actual": actual,
                }
            )

    if failures:
        print("FAIL")
        print(json.dumps(failures, indent=2, ensure_ascii=True))
        return 1

    print(f"PASS ({len(CASES)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
