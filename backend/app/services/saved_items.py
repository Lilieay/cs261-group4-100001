import re
from sqlite3 import SQLITE_CONSTRAINT_FOREIGNKEY, SQLITE_CONSTRAINT_PRIMARYKEY, SQLITE_CONSTRAINT_UNIQUE

from sqlalchemy import and_, delete, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary
from app.models.user import User
from app.schemas.saved_items import SavedItemDTO, SavedItemListResponse, SavedItemState


TARGETS = {"guide": (Guide, SavedGuide), "summary": (Summary, SavedSummary)}


class SavedItemNotFound(Exception):
    pass


class SavedItemCommitUnknown(Exception):
    pass


def duplicate_bookmark(error: IntegrityError, table: str, target_field: str) -> bool:
    original = error.orig
    message = str(original).lower()
    if getattr(original, "sqlite_errorcode", None) in (SQLITE_CONSTRAINT_PRIMARYKEY, SQLITE_CONSTRAINT_UNIQUE):
        return message == f"unique constraint failed: {table}.user_id, {table}.{target_field}"
    return "(2627)" in message and "primary key constraint" in message and bool(
        re.search(rf"object '(?:[^']+\.)?{table}'", message)
    )


def bookmark_target_fk(error: IntegrityError, table: str) -> bool:
    original = error.orig
    if getattr(original, "sqlite_errorcode", None) == SQLITE_CONSTRAINT_FOREIGNKEY:
        return True  # SQLite does not name the referenced table.
    message = str(original).lower()
    return "(547)" in message and "foreign key constraint" in message and bool(
        re.search(rf'table "(?:[^"]+\.)?{table}"', message)
    )


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

    def _state(self, target, bookmark, target_fk, user_id: int, item_id: int) -> bool:
        statement = (
            select(target.id, bookmark.user_id)
            .select_from(target)
            .outerjoin(bookmark, and_(target_fk == target.id, bookmark.user_id == user_id))
            .where(target.id == item_id)
        )
        row = self.session.execute(statement).one_or_none()
        if row is None:
            raise SavedItemNotFound
        return row[1] is not None

    def _commit(self):
        try:
            self.session.commit()
        except SQLAlchemyError as error:
            raise SavedItemCommitUnknown from error

    def _save(self, target, bookmark, target_field: str, user_id: int, item_id: int):
        try:
            self.session.add(bookmark(user_id=user_id, **{target_field: item_id}))
            self.session.flush()
        except IntegrityError as error:
            self.session.rollback()
            if duplicate_bookmark(error, bookmark.__tablename__, target_field):
                if self._state(target, bookmark, getattr(bookmark, target_field), user_id, item_id):
                    return
            elif bookmark_target_fk(error, target.__tablename__):
                if self.session.get(target, item_id) is None and self.session.get(User, user_id) is not None:
                    raise SavedItemNotFound from error
            raise
        self._commit()

    def manage(self, method: str, user_id: int, kind: str, item_id: int) -> SavedItemState:
        target, bookmark = TARGETS[kind]
        target_field = f"{kind}_id"
        target_fk = getattr(bookmark, target_field)
        if method == "DELETE":
            self.session.execute(delete(bookmark).where(bookmark.user_id == user_id, target_fk == item_id))
            self._commit()
            saved = False
        else:
            saved = self._state(target, bookmark, target_fk, user_id, item_id)
            if method == "PUT" and not saved:
                self._save(target, bookmark, target_field, user_id, item_id)
                saved = True
        return SavedItemState(item_type=kind, item_id=item_id, saved=saved)
