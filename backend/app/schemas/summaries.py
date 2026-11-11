from datetime import datetime, timezone
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field, field_validator


class SummaryCourseDTO(BaseModel):
    id: int
    course_code: str
    course_name: str


class SummaryOwnerDTO(BaseModel):
    id: int
    display_name: str


class SummaryFileDTO(BaseModel):
    original_name: str
    content_type: Literal["application/pdf"]
    size_bytes: int = Field(gt=0, le=15000000)
    read_path: str = Field(pattern=r"^/api/summaries/[1-9][0-9]*/file$")


class SummaryDTO(BaseModel):
    id: int
    course: SummaryCourseDTO
    title: str
    description: str | None
    owner: SummaryOwnerDTO
    file: SummaryFileDTO
    created_at: AwareDatetime
    updated_at: AwareDatetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def use_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)


class SummaryListResponseDTO(BaseModel):
    items: list[SummaryDTO]
