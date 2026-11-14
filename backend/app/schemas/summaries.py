from datetime import datetime

from pydantic import BaseModel


class SummaryCourseDTO(BaseModel):
    id: int
    course_code: str
    course_name: str


class SummaryOwnerDTO(BaseModel):
    id: int
    display_name: str


class SummaryFileDTO(BaseModel):
    original_name: str
    content_type: str
    size_bytes: int
    read_path: str


class SummaryDTO(BaseModel):
    id: int
    course: SummaryCourseDTO
    title: str
    description: str | None
    owner: SummaryOwnerDTO
    file: SummaryFileDTO
    created_at: datetime
    updated_at: datetime


class CourseSummaryListResponse(BaseModel):
    course_id: int
    items: list[SummaryDTO]
