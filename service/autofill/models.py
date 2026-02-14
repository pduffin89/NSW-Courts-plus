from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Profile(BaseModel):
    applicant_name: str
    organisation: str = ""
    contact_number: str = ""
    email: str = ""
    occupation: str = "Journalist"
    signature_text: Optional[str] = None


class Matter(BaseModel):
    case_number: str
    matter_name: str
    court: str
    jurisdiction: str = ""
    court_location: str = ""
    listing_date: str = ""
    plaintiff: str = ""
    defendant: str = ""


class GenerateRequest(BaseModel):
    matter: Matter
    profile: Optional[Profile] = None
    applications: Dict[str, bool] = Field(
        default_factory=lambda: {
            "media_access_2026": True,
            "non_party_access": False,
        }
    )
    requested_documents: List[str] = Field(default_factory=list)
    document_details: Dict[str, str] = Field(default_factory=dict)
