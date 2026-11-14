from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from app.models.summary import Summary, utc_now_naive
from app.schemas.my_summary_update import MySummaryUpdateRequest


class MySummaryDAO:
    def __init__(self, session: Session):
        self.session = session

    def list_owned(self, owner_id: int) -> list[Summary]:
        statement = (
            select(Summary)
            .where(Summary.owner_id == owner_id)
            .options(
                joinedload(Summary.course),
                joinedload(Summary.owner),
                joinedload(Summary.file),
            )
            .order_by(Summary.created_at.desc(), Summary.id.desc())
        )
        return list(self.session.scalars(statement))

    def get_for_update(self, summary_id: int) -> Summary | None:
        statement = (
            select(Summary)
            .where(Summary.id == summary_id)
            .with_hint(Summary, "WITH (UPDLOCK, HOLDLOCK)", dialect_name="mssql")
        )
        return self.session.scalar(statement)

    def update_metadata(
        self, summary: Summary, owner_id: int, metadata: MySummaryUpdateRequest
    ) -> bool:
        statement = (
            update(Summary)
            .where(Summary.id == summary.id, Summary.owner_id == owner_id)
            .values(
                course_id=metadata.course_id,
                title=metadata.title,
                description=metadata.description,
                updated_at=utc_now_naive(),
            )
        )
        return self.session.execute(statement).rowcount == 1
