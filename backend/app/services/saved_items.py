from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.saved_item_constraints import IntegrityConflictKind
from app.dao.saved_guide_dao import SavedGuideDAO
from app.dao.saved_items_dao import SavedSummaryDAO
from app.schemas.saved_item import SavedItemDTO, SavedItemListResponse, SavedItemState, SavedItemType


class SavedItemsUnavailable(Exception):
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

    def list_for_user(self, user_id: int) -> SavedItemListResponse:
        try:
            with self.session.begin():
                items = []
                for kind, dao in self.daos.items():
                    for target in dao.list_by_user(user_id):
                        course = target.course
                        items.append(SavedItemDTO(
                            item_type=kind, item_id=target.id, title=target.title,
                            course={"id": course.id, "course_code": course.course_code,
                                    "course_name": course.course_name},
                            open_path=f"/api/{'guides' if kind == 'guide' else 'summaries'}/{target.id}",
                        ))
                items.sort(key=lambda item: (item.course.course_code, item.item_type, -item.item_id))
                response = SavedItemListResponse(items=items)
            return response
        except SQLAlchemyError as error:
            self.session.rollback()
            raise SavedItemsUnavailable from error

    def remove(self, user_id: int, item_type: SavedItemType, item_id: int) -> SavedItemState:
        try:
            with self.session.begin():
                # No target lookup: repeated removal and already deleted targets
                # are both successful no-ops. Only this user's relation is touched.
                self.daos[item_type].remove(user_id, item_id)
            return SavedItemState(item_type=item_type, item_id=item_id, saved=False)
        except SQLAlchemyError as error:
            self.session.rollback()
            raise SavedItemsUnavailable from error

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
        kind = dao.classify_integrity_error(error)
        if kind is IntegrityConflictKind.OTHER:
            raise SavedItemsUnavailable from error

        try:
            with self.session.begin():
                if not dao.target_exists(item_id):
                    raise SavedTargetNotFound(item_type)
                saved = (
                    dao.is_saved(user_id, item_id)
                    if kind is IntegrityConflictKind.BOOKMARK_DUPLICATE
                    else False
                )
            if kind is IntegrityConflictKind.BOOKMARK_DUPLICATE and saved:
                return SavedItemState(
                    item_type=item_type, item_id=item_id, saved=True
                )
            raise SavedItemsUnavailable from error
        except SavedTargetNotFound:
            raise
        except SQLAlchemyError as recovery_error:
            self.session.rollback()
            raise SavedItemsUnavailable from recovery_error
