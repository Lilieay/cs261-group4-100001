import logging
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.course_dao import CourseDAO
from app.dao.my_summary_dao import MySummaryDAO
from app.dao.summary_file_dao import SummaryFileDAO
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.schemas.my_summary_update import MySummaryUpdateRequest
from app.schemas.summaries import SummaryDTO, SummaryListResponseDTO
from app.services.pdf_validator import PdfValidator
from app.services.summaries import SummaryService
from app.services.summary_storage import LocalPdfStorage


logger = logging.getLogger(__name__)


class MySummaryError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


class MySummariesService:
    def __init__(self, session: Session, storage: LocalPdfStorage):
        self.session = session
        self.storage = storage
        self.summaries = MySummaryDAO(session)
        self.files = SummaryFileDAO(session)
        self.courses = CourseDAO(session)

    def list_owned(self, owner_id: int) -> SummaryListResponseDTO:
        try:
            return SummaryListResponseDTO(
                items=[
                    SummaryService.to_dto(
                        summary, summary.course, summary.owner, self._require_file(summary)
                    )
                    for summary in self.summaries.list_owned(owner_id)
                ]
            )
        except SQLAlchemyError as error:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE") from error

    def update(
        self,
        summary_id: int,
        owner_id: int,
        metadata: MySummaryUpdateRequest,
        *,
        content: bytes | None = None,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> SummaryDTO:
        new_key = None
        old_key = None
        commit_started = False
        try:
            if content is not None:
                with Session(self.session.get_bind()) as preflight:
                    self._require_owner(preflight.get(Summary, summary_id), owner_id)
                    self._require_course(CourseDAO(preflight), metadata.course_id)
                original_name = PdfValidator().validate(filename, content_type, content)
                new_key = uuid4().hex
                # Startup checks markers against SQL, including after an interrupted commit.
                self.storage.queue_reconciliation(new_key)
                self.storage.put_private(new_key, content)
                stored_file = self.storage.verify_private(new_key, len(content))

            with self.session.begin():
                summary = self._require_owner(self.summaries.get_for_update(summary_id), owner_id)
                course = self._require_course(self.courses, metadata.course_id)
                summary_file = self._require_file(summary)
                if not self.summaries.update_metadata(summary, owner_id, metadata):
                    raise MySummaryError(404, "SUMMARY_NOT_FOUND")
                if new_key is not None:
                    old_key = summary_file.storage_key
                    self.files.replace(
                        summary_file,
                        storage_key=new_key,
                        original_name=original_name,
                        content_type=stored_file.content_type,
                        size_bytes=stored_file.size_bytes,
                    )
                    self.storage.queue_reconciliation(old_key)
                self.session.refresh(summary)
                response = SummaryService.to_dto(summary, course, summary.owner, summary_file)
                commit_started = True
        except (SQLAlchemyError, OSError, ValueError) as error:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE") from error
        finally:
            if new_key is not None and not commit_started:
                self._remove_private(new_key)

        if old_key is not None:
            self._remove_private(old_key)
        return response

    def delete(self, summary_id: int, owner_id: int) -> None:
        try:
            with self.session.begin():
                summary = self._require_owner(self.summaries.get_for_update(summary_id), owner_id)
                file = summary.file
                old_key = file.storage_key if file is not None else None
                if not self.summaries.delete_owned(summary_id, owner_id):
                    raise MySummaryError(404, "SUMMARY_NOT_FOUND")
                if old_key is not None:
                    self.storage.queue_reconciliation(old_key)
        except (SQLAlchemyError, OSError, ValueError) as error:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE") from error
        if old_key is not None:
            self._remove_private(old_key)

    @staticmethod
    def _require_owner(summary: Summary | None, owner_id: int) -> Summary:
        if summary is None:
            raise MySummaryError(404, "SUMMARY_NOT_FOUND")
        if summary.owner_id != owner_id:
            raise MySummaryError(403, "SUMMARY_FORBIDDEN")
        return summary

    @staticmethod
    def _require_course(courses: CourseDAO, course_id: int) -> Course:
        course = courses.get_cs_by_id(course_id)
        if course is None:
            raise MySummaryError(404, "COURSE_NOT_FOUND")
        return course

    @staticmethod
    def _require_file(summary: Summary) -> SummaryFile:
        if summary.file is None:
            raise MySummaryError(503, "STORAGE_UNAVAILABLE")
        return summary.file

    def _remove_private(self, key: str) -> None:
        try:
            self.storage.delete_private(key)
        except (OSError, ValueError):
            logger.exception("Private PDF cleanup remains pending for %s", key)
        else:
            self._clear_reconciliation(key)

    def _clear_reconciliation(self, key: str) -> None:
        try:
            self.storage.clear_reconciliation(key)
        except (OSError, ValueError):
            logger.exception("Could not clear private PDF reconciliation for %s", key)
