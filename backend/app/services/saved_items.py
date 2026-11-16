from enum import Enum

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.saved_guide_dao import SavedGuideDAO
from app.dao.saved_items_dao import SavedSummaryDAO
from app.schemas.saved_item import SavedItemState, SavedItemType


class SavedItemsUnavailable(Exception):
    pass


class SavedTargetNotFound(Exception):
    def __init__(self, item_type: SavedItemType):
        self.item_type = item_type


class _IntegrityKind(Enum):
    DUPLICATE_BOOKMARK = "duplicate_bookmark"
    FOREIGN_KEY = "foreign_key"
    OTHER = "other"


def _classify_integrity_error(error: IntegrityError) -> _IntegrityKind:
    message = " ".join(str(part) for part in getattr(error.orig, "args", ()))
    lowered = message.lower()
    if (
        "2627" in lowered
        or "2601" in lowered
        or "duplicate key" in lowered
        or "unique constraint failed" in lowered
    ):
        return _IntegrityKind.DUPLICATE_BOOKMARK
    if "547" in lowered or "foreign key constraint failed" in lowered:
        return _IntegrityKind.FOREIGN_KEY
    return _IntegrityKind.OTHER


class SavedItemsService:
    def __init__(
        self,
        session: Session,
        guide_dao: SavedGuideDAO,
        summary_dao: SavedSummaryDAO,
    ):
        self.session = session
        self.daos = {"guide": guide_dao, "summary": summary_dao}

    def state(
        self, user_id: int, item_type: SavedItemType, item_id: int
    ) -> SavedItemState:
        dao = self.daos[item_type]
        try:
            with self.session.begin():
                if not dao.target_exists(item_id):
                    raise SavedTargetNotFound(item_type)
                saved = dao.is_saved(user_id, item_id)
            return SavedItemState(item_type=item_type, item_id=item_id, saved=saved)
        except SavedTargetNotFound:
            raise
        except SQLAlchemyError as error:
            self.session.rollback()
            raise SavedItemsUnavailable from error

    def save(
        self, user_id: int, item_type: SavedItemType, item_id: int
    ) -> SavedItemState:
        dao = self.daos[item_type]
        try:
            with self.session.begin():
                if not dao.target_exists(item_id):
                    raise SavedTargetNotFound(item_type)
                if not dao.is_saved(user_id, item_id):
                    dao.insert_if_absent(user_id, item_id)
            return SavedItemState(item_type=item_type, item_id=item_id, saved=True)
        except SavedTargetNotFound:
            raise
        except IntegrityError as error:
            self.session.rollback()
            return self._recover_integrity_conflict(
                error, user_id, item_type, item_id, dao
            )
        except SQLAlchemyError as error:
            self.session.rollback()
            raise SavedItemsUnavailable from error

    def _recover_integrity_conflict(
        self,
        error: IntegrityError,
        user_id: int,
        item_type: SavedItemType,
        item_id: int,
        dao,
    ) -> SavedItemState:
        kind = _classify_integrity_error(error)
        if kind is _IntegrityKind.OTHER:
            raise SavedItemsUnavailable from error

        try:
            with self.session.begin():
                if not dao.target_exists(item_id):
                    raise SavedTargetNotFound(item_type)
                saved = (
                    dao.is_saved(user_id, item_id)
                    if kind is _IntegrityKind.DUPLICATE_BOOKMARK
                    else False
                )
            if kind is _IntegrityKind.DUPLICATE_BOOKMARK and saved:
                return SavedItemState(
                    item_type=item_type, item_id=item_id, saved=True
                )
            raise SavedItemsUnavailable from error
        except SavedTargetNotFound:
            raise
        except SQLAlchemyError as recovery_error:
            self.session.rollback()
            raise SavedItemsUnavailable from recovery_error
