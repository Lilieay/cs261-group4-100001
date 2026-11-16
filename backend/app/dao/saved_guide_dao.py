from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

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

    def target_exists(self, guide_id: int) -> bool:
        return self.session.get(Guide, guide_id) is not None

    def is_saved(self, user_id: int, guide_id: int) -> bool:
        return self.contains(user_id, guide_id)

    def insert_if_absent(self, user_id: int, guide_id: int) -> None:
        self.session.add(SavedGuide(user_id=user_id, guide_id=guide_id))
        self.session.flush()

    def add(self, user_id: int, guide_id: int) -> None:
        if not self.is_saved(user_id, guide_id):
            self.insert_if_absent(user_id, guide_id)

    def remove(self, user_id: int, guide_id: int) -> None:
        self.session.execute(delete(SavedGuide).where(
            SavedGuide.user_id == user_id, SavedGuide.guide_id == guide_id
        ))
