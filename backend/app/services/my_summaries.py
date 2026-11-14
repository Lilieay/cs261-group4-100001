from datetime import timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.course_dao import CourseDAO
from app.dao.my_summary_dao import MySummaryDAO
from app.models.course import Course
from app.models.summary import Summary
from app.schemas.my_summary_update import MySummaryUpdateRequest
from app.schemas.summaries import (
    SummaryCourseDTO,
    SummaryDTO,
    SummaryFileDTO,
    SummaryListResponseDTO,
    SummaryOwnerDTO,
)
from app.services.publisher_name import format_publisher_name


class MySummaryError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


class MySummariesService:
    def __init__(self, session: Session):
        self.session = session
        self.summaries = MySummaryDAO(session)
        self.courses = CourseDAO(session)

    def list_owned(self, owner_id: int) -> SummaryListResponseDTO:
        try:
            return SummaryListResponseDTO(
                items=[
                    self._to_dto(summary, summary.course)
                    for summary in self.summaries.list_owned(owner_id)
                ]
            )
        except SQLAlchemyError as error:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE") from error

    def update_metadata(
        self, summary_id: int, owner_id: int, metadata: MySummaryUpdateRequest
    ) -> SummaryDTO:
        try:
            with self.session.begin():
                summary = self.summaries.get_for_update(summary_id)
                if summary is None:
                    raise MySummaryError(404, "SUMMARY_NOT_FOUND")
                if summary.owner_id != owner_id:
                    raise MySummaryError(403, "SUMMARY_FORBIDDEN")
                course = self.courses.get_cs_by_id(metadata.course_id)
                if course is None:
                    raise MySummaryError(404, "COURSE_NOT_FOUND")
                if not self.summaries.update_metadata(summary, owner_id, metadata):
                    raise MySummaryError(404, "SUMMARY_NOT_FOUND")
                self.session.refresh(summary)
                response = self._to_dto(summary, course)
            return response
        except SQLAlchemyError as error:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE") from error

    @staticmethod
    def _to_dto(summary: Summary, course: Course) -> SummaryDTO:
        file = summary.file
        if file is None:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE")
        return SummaryDTO(
            id=summary.id,
            course=SummaryCourseDTO(
                id=course.id, course_code=course.course_code, course_name=course.course_name
            ),
            title=summary.title,
            description=summary.description,
            owner=SummaryOwnerDTO(
                id=summary.owner_id, display_name=format_publisher_name(summary.owner)
            ),
            file=SummaryFileDTO(
                original_name=file.original_name,
                content_type=file.content_type,
                size_bytes=file.size_bytes,
                read_path=f"/api/summaries/{summary.id}/file",
            ),
            created_at=summary.created_at.replace(tzinfo=timezone.utc),
            updated_at=summary.updated_at.replace(tzinfo=timezone.utc),
        )
