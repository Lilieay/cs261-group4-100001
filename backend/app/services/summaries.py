import logging
from datetime import timezone
from typing import BinaryIO
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.course_dao import CourseDAO
from app.dao.summary_dao import SummaryDAO
from app.dao.summary_file_dao import SummaryFileDAO
from app.dao.user_dao import UserDAO
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.schemas.summaries import (
    CourseSummaryListResponse,
    SummaryCourseDTO,
    SummaryDTO,
    SummaryFileDTO,
    SummaryOwnerDTO,
)
from app.services.auth import AuthenticatedUser
from app.services.pdf_validator import PdfValidationError, PdfValidator
from app.services.publisher_name import format_publisher_name
from app.services.summary_storage import LocalPdfStorage


logger = logging.getLogger(__name__)


class SummaryCourseNotFound(Exception):
    pass


class SummaryNotFound(Exception):
    pass


class SummaryStorageUnavailable(Exception):
    pass


class SummaryService:
    def __init__(
        self,
        session: Session,
        course_dao: CourseDAO,
        user_dao: UserDAO,
        summary_dao: SummaryDAO,
        summary_file_dao: SummaryFileDAO,
        storage: LocalPdfStorage,
        validator: PdfValidator | None = None,
    ):
        self.session = session
        self.course_dao = course_dao
        self.user_dao = user_dao
        self.summary_dao = summary_dao
        self.summary_file_dao = summary_file_dao
        self.storage = storage
        self.validator = validator or PdfValidator()

    def publish(
        self,
        *,
        course_id: int,
        title: str,
        description: str | None,
        filename: str | None,
        content_type: str | None,
        content: bytes,
        authenticated_user: AuthenticatedUser,
    ) -> SummaryDTO:
        normalized_title = title.strip()
        normalized_description = (description or "").strip() or None
        if not normalized_title:
            raise PdfValidationError("INVALID_PARAMETERS", "title is required")
        if len(normalized_title) > 200:
            raise PdfValidationError("INVALID_PARAMETERS", "title is too long")
        if normalized_description is not None and len(normalized_description) > 2000:
            raise PdfValidationError(
                "INVALID_PARAMETERS", "description is too long"
            )
        safe_name = self.validator.validate(filename, content_type, content)

        try:
            course = self.course_dao.get_cs_by_id(course_id)
            if course is None:
                raise SummaryCourseNotFound
            owner = self.user_dao.get_by_username(authenticated_user.username)
            if owner is None:
                raise SummaryStorageUnavailable("Authenticated user is not stored")
            course_pk = course.id
            owner_pk = owner.id
            # End the read-only lookup transaction before writing the file.
            self.session.rollback()
        except SQLAlchemyError as error:
            self.session.rollback()
            raise SummaryStorageUnavailable from error

        storage_key = uuid4().hex
        try:
            self.storage.put_private(storage_key, content)
            stored_file = self.storage.verify_private(storage_key, len(content))
        except (OSError, ValueError) as error:
            self.session.rollback()
            self._compensate(storage_key)
            raise SummaryStorageUnavailable from error

        try:
            summary = self.summary_dao.create(
                course_pk,
                owner_pk,
                normalized_title,
                normalized_description,
            )
            summary_file = self.summary_file_dao.create(
                summary_id=summary.id,
                storage_key=storage_key,
                original_name=safe_name,
                content_type=stored_file.content_type,
                size_bytes=stored_file.size_bytes,
            )
            response = self._to_dto(summary, course, owner, summary_file)
            self.session.commit()
            return response
        except SQLAlchemyError as error:
            self.session.rollback()
            return self._compensate_or_resolve(storage_key, error)
        except Exception:
            self.session.rollback()
            self._compensate(storage_key)
            raise

    def list_by_course(self, course_id: int) -> CourseSummaryListResponse:
        try:
            course = self.course_dao.get_cs_by_id(course_id)
            if course is None:
                raise SummaryCourseNotFound
            summaries = self.summary_dao.list_by_course(course.id)
            if any(summary.file is None for summary in summaries):
                raise SummaryStorageUnavailable("Summary file metadata is missing")
            items = [
                self._to_dto(summary, summary.course, summary.owner, summary.file)
                for summary in summaries
            ]
            return CourseSummaryListResponse(course_id=course.id, items=items)
        except SQLAlchemyError as error:
            raise SummaryStorageUnavailable from error

    def get_summary(self, summary_id: int) -> SummaryDTO:
        try:
            summary = self.summary_dao.get_by_id(summary_id)
            if summary is None or summary.file is None:
                raise SummaryNotFound
            return self._to_dto(
                summary, summary.course, summary.owner, summary.file
            )
        except SQLAlchemyError as error:
            raise SummaryStorageUnavailable from error

    def open_pdf(self, summary_id: int) -> tuple[SummaryFile, BinaryIO]:
        try:
            summary_file = self.summary_file_dao.get_by_summary_id(summary_id)
            if summary_file is None:
                raise SummaryNotFound
            handle = self.storage.open_private(summary_file.storage_key)
            return summary_file, handle
        except SummaryNotFound:
            raise
        except (OSError, ValueError, SQLAlchemyError) as error:
            raise SummaryStorageUnavailable from error

    def _compensate_or_resolve(
        self, storage_key: str, original_error: SQLAlchemyError
    ) -> SummaryDTO:
        try:
            persisted_file = self.summary_file_dao.get_by_storage_key(storage_key)
        except SQLAlchemyError:
            logger.exception(
                "Could not resolve SQL commit outcome for private PDF %s",
                storage_key,
            )
            self._queue_reconciliation(storage_key)
            raise SummaryStorageUnavailable from original_error

        if persisted_file is not None:
            summary = persisted_file.summary
            return self._to_dto(
                summary,
                summary.course,
                summary.owner,
                persisted_file,
            )

        self._compensate(storage_key)
        raise SummaryStorageUnavailable from original_error

    def _compensate(self, storage_key: str) -> None:
        try:
            self.storage.delete_private(storage_key)
        except (OSError, ValueError):
            logger.exception("Could not compensate private PDF %s", storage_key)
            self._queue_cleanup(storage_key)

    def _queue_cleanup(self, storage_key: str) -> None:
        try:
            self.storage.queue_cleanup(storage_key)
        except (OSError, ValueError):
            logger.exception("Could not queue cleanup for private PDF %s", storage_key)

    def _queue_reconciliation(self, storage_key: str) -> None:
        try:
            self.storage.queue_reconciliation(storage_key)
        except (OSError, ValueError):
            logger.exception(
                "Could not queue reconciliation for private PDF %s", storage_key
            )

    @staticmethod
    def _to_dto(
        summary: Summary,
        course: Course,
        owner: User,
        summary_file: SummaryFile,
    ) -> SummaryDTO:
        created_at = summary.created_at.replace(tzinfo=timezone.utc)
        updated_at = summary.updated_at.replace(tzinfo=timezone.utc)
        return SummaryDTO(
            id=summary.id,
            course=SummaryCourseDTO(
                id=course.id,
                course_code=course.course_code,
                course_name=course.course_name,
            ),
            title=summary.title,
            description=summary.description,
            owner=SummaryOwnerDTO(
                id=owner.id, display_name=format_publisher_name(owner)
            ),
            file=SummaryFileDTO(
                original_name=summary_file.original_name,
                content_type=summary_file.content_type,
                size_bytes=summary_file.size_bytes,
                read_path=f"/api/summaries/{summary.id}/file",
            ),
            created_at=created_at,
            updated_at=updated_at,
        )
