from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator, field_serializer


class ReviewWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: StrictInt = Field(ge=1, le=5)
    comment: StrictStr | None = None

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value):
        if value is None:
            return None
        value = value.strip()
        if len(value) > 2000:
            raise ValueError("ข้อความยาวได้ไม่เกิน 2,000 Unicode code points")
        # SQL Server NVARCHAR cannot store unpaired UTF-16 surrogates.
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("ข้อความมี Unicode ที่ไม่ถูกต้อง")
        return value or None


class ReviewAuthorDTO(BaseModel):
    id: int
    display_name: str


class ReviewDTO(BaseModel):
    id: int
    target_type: Literal["guide", "summary"]
    target_id: int
    rating: int
    comment: str | None
    author: ReviewAuthorDTO
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_time(self, value):
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


class ReviewListResponse(BaseModel):
    target_type: Literal["guide", "summary"]
    target_id: int
    items: list[ReviewDTO]
