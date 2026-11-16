from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.saved_item_constraints import IntegrityConflictKind
from app.dao.saved_guide_dao import SavedGuideDAO
from app.dao.saved_items_dao import SavedSummaryDAO
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary
from app.models.user import User
from app.schemas.saved_item import (
    SavedItemDTO,
    SavedItemListResponse,
    SavedItemState,
    SavedItemType,
)


TARGETS = {"guide": (Guide, SavedGuide), "summary": (Summary, SavedSummary)}


class SavedItemsUnavailable(Exception):
    pass


class SavedItemCommitUnknown(SavedItemsUnavailable):
    pass


class SavedTargetNotFound(Exception):
    def __init__(self, item_type: SavedItemType):
        self.item_type = item_type


class SavedItemsService:
    def __init__(
        self,
        session: Session,
        guide_dao: SavedGuideDAO,
        summary_dao: SavedSummaryDAO,
    ):
        self.session = session
        self.daos = {"guide": guide_dao, "summary": summary_dao}

    def list(self, user_id: int) -> SavedItemListResponse:
        items = []
        try:
            with self.session.begin():
                for item_type, (target, bookmark) in TARGETS.items():
                    target_fk = getattr(bookmark, f"{item_type}_id")
                    collection = "guides" if item_type == "guide" else "summaries"
                    statement = (
                        select(target.id, target.title, Course.id, Course.course_code, Course.course_name)
                        .join_from(bookmark, target, target_fk == target.id)
                        .join(Course, target.course_id == Course.id)
                        .where(bookmark.user_id == user_id)
                    )
                    for item_id, title, course_id, code, name in self.session.execute(statement):
                        items.append(
                            SavedItemDTO(
                                item_type=item_type,
                                item_id=item_id,
                                course={"id": course_id, "course_code": code, "course_name": name},
                                title=title,
                                open_path=f"/api/{collection}/{item_id}",
                            )
                        )
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemsUnavailable from error

        items.sort(key=lambda item: (item.course.course_code, item.item_type, -item.item_id))
        return SavedItemListResponse(items=items)

    def _state(self, user_id: int, item_type: SavedItemType, item_id: int) -> bool:
        saved = self.daos[item_type].read_saved_state(user_id, item_id)
        if saved is None:
            raise SavedTargetNotFound(item_type)
        return saved

    def state(
        self, user_id: int, item_type: SavedItemType, item_id: int
    ) -> SavedItemState:
        try:
            with self.session.begin():
                saved = self._state(user_id, item_type, item_id)
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemsUnavailable from error
        return SavedItemState(item_type=item_type, item_id=item_id, saved=saved)

    def save(
        self, user_id: int, item_type: SavedItemType, item_id: int
    ) -> SavedItemState:
        dao = self.daos[item_type]
        try:
            self.session.begin()
            saved = self._state(user_id, item_type, item_id)
        except SavedTargetNotFound:
            self._rollback()
            raise
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemsUnavailable from error

        if saved:
            self._rollback()
            return SavedItemState(item_type=item_type, item_id=item_id, saved=True)

        try:
            dao.insert_if_absent(user_id, item_id)
        except IntegrityError as error:
            self._rollback()
            return self._recover_integrity_conflict(
                error, user_id, item_type, item_id, dao
            )
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemsUnavailable from error

        self._commit()
        return SavedItemState(item_type=item_type, item_id=item_id, saved=True)

    def remove(
        self, user_id: int, item_type: SavedItemType, item_id: int
    ) -> SavedItemState:
        try:
            self.daos[item_type].remove(user_id, item_id)
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemsUnavailable from error
        self._commit()
        return SavedItemState(item_type=item_type, item_id=item_id, saved=False)

    def _commit(self) -> None:
        try:
            self.session.commit()
        except SQLAlchemyError as error:
            self._rollback()
            raise SavedItemCommitUnknown from error

    def _rollback(self) -> None:
        try:
            self.session.rollback()
        except SQLAlchemyError:
            # Preserve the operation's original error if the connection is lost.
            pass

    def _recover_integrity_conflict(
        self,
        error: IntegrityError,
        user_id: int,
        item_type: SavedItemType,
        item_id: int,
        dao: SavedGuideDAO | SavedSummaryDAO,
    ) -> SavedItemState:
        kind = dao.classify_integrity_error(error)
        if kind is IntegrityConflictKind.OTHER:
            raise SavedItemsUnavailable from error

        try:
            with self.session.begin():
                try:
                    saved = self._state(user_id, item_type, item_id)
                except SavedTargetNotFound:
                    if kind is IntegrityConflictKind.UNNAMED_FOREIGN_KEY and self.session.get(User, user_id) is None:
                        raise SavedItemsUnavailable from error
                    raise
            if kind is IntegrityConflictKind.BOOKMARK_DUPLICATE and saved:
                return SavedItemState(
                    item_type=item_type, item_id=item_id, saved=True
                )
            raise SavedItemsUnavailable from error
        except SQLAlchemyError as recovery_error:
            self._rollback()
            raise SavedItemsUnavailable from recovery_error
