from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary
from app.schemas.saved_items import SavedItemDTO, SavedItemListResponse, SavedItemState


TARGETS = {"guide": (Guide, SavedGuide), "summary": (Summary, SavedSummary)}


class SavedItemNotFound(Exception):
    pass


class SavedItemsService:
    def __init__(self, session: Session):
        self.session = session

    def list(self, user_id: int) -> SavedItemListResponse:
        items = []
        for kind, (target, bookmark) in TARGETS.items():
            target_fk = getattr(bookmark, f"{kind}_id")
            statement = (
                select(target.id, target.title, Course.id, Course.course_code, Course.course_name)
                .join_from(bookmark, target, target_fk == target.id)
                .join(Course, target.course_id == Course.id)
                .where(bookmark.user_id == user_id)
            )
            for item_id, title, course_id, code, name in self.session.execute(statement):
                items.append(SavedItemDTO(
                    item_type=kind,
                    item_id=item_id,
                    course={"id": course_id, "course_code": code, "course_name": name},
                    title=title,
                    open_path=f"/api/{'guides' if kind == 'guide' else 'summaries'}/{item_id}",
                ))
        items.sort(key=lambda item: (item.course.course_code, item.item_type, -item.item_id))
        return SavedItemListResponse(items=items)

    def manage(self, method: str, user_id: int, kind: str, item_id: int) -> SavedItemState:
        target, bookmark = TARGETS[kind]
        key = (user_id, item_id)
        target_field = f"{kind}_id"
        if method == "DELETE":
            self.session.execute(delete(bookmark).where(
                bookmark.user_id == user_id, getattr(bookmark, target_field) == item_id
            ))
            self.session.commit()
            saved = False
        else:
            if self.session.get(target, item_id) is None:
                raise SavedItemNotFound
            saved = self.session.get(bookmark, key) is not None
            if method == "PUT" and not saved:
                try:
                    self.session.add(bookmark(user_id=user_id, **{target_field: item_id}))
                    self.session.commit()
                except IntegrityError:
                    self.session.rollback()
                    if self.session.get(bookmark, key) is None:
                        if self.session.get(target, item_id) is None:
                            raise SavedItemNotFound from None
                        raise
                saved = True
        return SavedItemState(item_type=kind, item_id=item_id, saved=saved)
