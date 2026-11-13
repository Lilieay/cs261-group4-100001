from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.summary import Summary, utc_now_naive


class SummaryDAO:
    """Read and stage summaries; transaction ownership stays with the service."""

    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        course_id: int,
        owner_id: int,
        title: str,
        description: str | None,
    ) -> Summary:
        created_at = utc_now_naive()
        summary = Summary(
            course_id=course_id,
            owner_id=owner_id,
            title=title,
            description=description,
            created_at=created_at,
            updated_at=created_at,
        )
        self.session.add(summary)
        self.session.flush()
        return summary

    def list_by_course(self, course_id: int) -> list[Summary]:
        statement = (
            select(Summary)
            .where(Summary.course_id == course_id)
            .options(
                joinedload(Summary.course),
                joinedload(Summary.owner),
                joinedload(Summary.file),
            )
            .order_by(Summary.created_at.desc(), Summary.id.desc())
        )
        return list(self.session.scalars(statement).unique().all())

    def get_by_id(self, summary_id: int) -> Summary | None:
        statement = (
            select(Summary)
            .where(Summary.id == summary_id)
            .options(
                joinedload(Summary.course),
                joinedload(Summary.owner),
                joinedload(Summary.file),
            )
        )
        return self.session.scalars(statement).unique().one_or_none()
