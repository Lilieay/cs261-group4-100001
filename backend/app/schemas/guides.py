from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


AcademicYear = Literal[2566, 2567, 2568, 2569]


class GuideListItemDTO(BaseModel):
    id: int
    title: str
    academic_year: int
    semester: Literal[1, 2, 3]
    exam_period: Literal["midterm", "final"]
    publisher_name: str


class GuideListResponseDTO(BaseModel):
    course_id: int
    has_guides: bool
    items: list[GuideListItemDTO]


class CourseInfoDTO(BaseModel):
    id: int
    course_code: str
    course_name: str
    instructor_names: str | None


class GuideDetailResponseDTO(GuideListItemDTO):
    course: CourseInfoDTO
    topics: str
    exam_format: Literal["objective", "subjective", "mixed"]
    objective_count: int | None
    subjective_count: int | None
    additional_advice: str | None


class GuideFilterOptionsResponseDTO(BaseModel):
    course_id: int
    academic_years: list[int]
    semesters: list[Literal[1, 2, 3]]
    exam_periods: list[Literal["midterm", "final"]]


class GuidePublishRequestDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: int = Field(gt=0, strict=True)
    title: str = Field(min_length=1, max_length=200)
    academic_year: AcademicYear
    semester: Literal[1, 2, 3]
    exam_period: Literal["midterm", "final"]
    topics: str = Field(min_length=1, max_length=2000)
    exam_format: Literal["objective", "subjective", "mixed"]
    objective_count: int | None = Field(default=None, gt=0, strict=True)
    subjective_count: int | None = Field(default=None, gt=0, strict=True)
    additional_advice: str | None = Field(default=None, max_length=2000)

    @field_validator("title", "topics", mode="before")
    @classmethod
    def strip_required_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("additional_advice", mode="before")
    @classmethod
    def normalize_optional_advice(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @model_validator(mode="after")
    def validate_counts_for_format(self) -> "GuidePublishRequestDTO":
        if self.exam_format == "objective" and self.subjective_count is not None:
            raise ValueError("subjective_count is not valid for objective exams")
        if self.exam_format == "subjective" and self.objective_count is not None:
            raise ValueError("objective_count is not valid for subjective exams")
        return self
