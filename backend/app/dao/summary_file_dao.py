from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.summary import Summary, SummaryFile


class SummaryFileDAO:
    """Read and stage file metadata without committing the caller's transaction."""

    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        summary_id: int,
        storage_key: str,
        original_name: str,
        content_type: str,
        size_bytes: int,
    ) -> SummaryFile:
        summary_file = SummaryFile(
            summary_id=summary_id,
            storage_key=storage_key,
            original_name=original_name,
            content_type=content_type,
            size_bytes=size_bytes,
        )
        self.session.add(summary_file)
        self.session.flush()
        return summary_file

    def get_by_summary_id(self, summary_id: int) -> SummaryFile | None:
        statement = (
            select(SummaryFile)
            .where(SummaryFile.summary_id == summary_id)
            .options(
                joinedload(SummaryFile.summary).joinedload(Summary.course),
                joinedload(SummaryFile.summary).joinedload(Summary.owner),
            )
        )
        return self.session.scalars(statement).unique().one_or_none()

    def get_by_storage_key(self, storage_key: str) -> SummaryFile | None:
        statement = (
            select(SummaryFile)
            .where(SummaryFile.storage_key == storage_key)
            .options(
                joinedload(SummaryFile.summary).joinedload(Summary.course),
                joinedload(SummaryFile.summary).joinedload(Summary.owner),
            )
        )
        return self.session.scalars(statement).unique().one_or_none()
