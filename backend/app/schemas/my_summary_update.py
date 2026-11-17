import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MySummaryUpdateRequest(BaseModel):
    """Editable multipart metadata; the router handles the optional PDF separately."""

    model_config = ConfigDict(extra="forbid")

    course_id: int = Field(gt=0, le=2147483647, strict=True)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("course_id", mode="before")
    @classmethod
    def parse_course_id(cls, value: object) -> object:
        if isinstance(value, str):
            if not re.fullmatch(r"[0-9]+", value):
                raise ValueError("course_id must contain decimal digits only")
            # Check the range before conversion, including arbitrarily long input.
            digits = value.lstrip("0") or "0"
            if len(digits) > 10 or (
                len(digits) == 10 and digits > "2147483647"
            ):
                raise ValueError("course_id exceeds the supported ID range")
            return int(digits)
        return value

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value
