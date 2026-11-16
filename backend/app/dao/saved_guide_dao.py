from sqlalchemy import and_, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.dao.saved_item_constraints import (
    IntegrityConflictKind,
    classify_saved_item_integrity_error,
)
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide


class SavedGuideDAO:
    def __init__(self, session: Session):
        self.session = session

    def list_by_user(self, user_id: int) -> list[Guide]:
        statement = (
            select(Guide)
            .join(SavedGuide, SavedGuide.guide_id == Guide.id)
            .where(SavedGuide.user_id == user_id)
            .options(joinedload(Guide.course), joinedload(Guide.publisher))
            .order_by(Guide.id.desc())
        )
        return list(self.session.scalars(statement).all())

    def contains(self, user_id: int, guide_id: int) -> bool:
        return self.session.get(SavedGuide, (user_id, guide_id)) is not None

    def read_saved_state(self, user_id: int, guide_id: int) -> bool | None:
        statement = (
            select(Guide.id, SavedGuide.user_id)
            .outerjoin(
                SavedGuide,
                and_(SavedGuide.guide_id == Guide.id, SavedGuide.user_id == user_id),
            )
            .where(Guide.id == guide_id)
        )
        row = self.session.execute(statement).one_or_none()
        return None if row is None else row.user_id is not None

    def is_saved(self, user_id: int, guide_id: int) -> bool:
        return self.contains(user_id, guide_id)

    def insert_if_absent(self, user_id: int, guide_id: int) -> None:
        self.session.add(SavedGuide(user_id=user_id, guide_id=guide_id))
        self.session.flush()

    def classify_integrity_error(
        self, error: IntegrityError
    ) -> IntegrityConflictKind:
        return classify_saved_item_integrity_error(
            error,
            session=self.session,
            relation_table="saved_guides",
            bookmark_columns=("user_id", "guide_id"),
            target_column="guide_id",
            target_table="guides",
        )

    def add(self, user_id: int, guide_id: int) -> None:
        if not self.is_saved(user_id, guide_id):
            self.insert_if_absent(user_id, guide_id)

    def remove(self, user_id: int, guide_id: int) -> None:
        self.session.execute(delete(SavedGuide).where(
            SavedGuide.user_id == user_id, SavedGuide.guide_id == guide_id
        ))
