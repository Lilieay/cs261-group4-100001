from contextlib import contextmanager
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.dao.saved_item_constraints import (
    IntegrityConflictKind,
    classify_saved_item_integrity_error,
)
from app.schemas.saved_item import SavedItemState
from app.services.saved_items import (
    SavedItemsService,
    SavedItemsUnavailable,
    SavedTargetNotFound,
)


class FakeSession:
    def __init__(self, events):
        self.events = events

    def begin(self):
        self.events.append("begin")
        return self.transaction()

    @contextmanager
    def transaction(self):
        try:
            yield
            self.commit()
        except Exception:
            self.rollback()
            raise

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def get_bind(self):
        bind = Mock()
        bind.get_execution_options.return_value = {}
        return bind

    def get(self, _model, _id):
        return object()


def make_service(item_type="guide", *, target=True, saved=False):
    events = []
    session = FakeSession(events)
    guide_dao = Mock()
    summary_dao = Mock()
    selected = guide_dao if item_type == "guide" else summary_dao
    selected.classify_integrity_error.return_value = (
        IntegrityConflictKind.BOOKMARK_DUPLICATE
    )
    def read_saved_state(_user_id, _item_id):
        events.append("read_saved_state")
        return saved if target else None

    selected.read_saved_state.side_effect = read_saved_state
    selected.insert_if_absent.side_effect = lambda _user_id, _item_id: events.append(
        "insert"
    )
    return (
        SavedItemsService(session, guide_dao, summary_dao),
        selected,
        events,
    )


@pytest.mark.parametrize("item_type", ["guide", "summary"])
def test_save_begins_transaction_before_target_select_and_returns_contract_state(item_type):
    service, dao, events = make_service(item_type)

    result = service.save(7, item_type, 12)

    assert result == SavedItemState(item_type=item_type, item_id=12, saved=True)
    assert events == ["begin", "read_saved_state", "insert", "commit"]
    dao.insert_if_absent.assert_called_once_with(7, 12)


def test_save_existing_relation_is_idempotent_without_second_insert():
    service, dao, events = make_service(saved=True)

    result = service.save(7, "guide", 12)

    assert result == SavedItemState(item_type="guide", item_id=12, saved=True)
    assert events == ["begin", "read_saved_state", "rollback"]
    dao.insert_if_absent.assert_not_called()


def test_state_returns_false_for_existing_unsaved_target():
    service, _dao, events = make_service("summary", saved=False)

    result = service.state(7, "summary", 12)

    assert result == SavedItemState(item_type="summary", item_id=12, saved=False)
    assert events == ["begin", "read_saved_state", "commit"]


def test_state_and_save_reject_missing_target():
    service, _dao, events = make_service(target=False)

    with pytest.raises(SavedTargetNotFound):
        service.save(7, "guide", 404)
    assert events == ["begin", "read_saved_state", "rollback"]


def test_database_read_failure_is_not_reported_as_unsaved():
    service, dao, _events = make_service()
    dao.read_saved_state.side_effect = SQLAlchemyError("read failed")

    with pytest.raises(SavedItemsUnavailable):
        service.state(7, "guide", 12)


def test_duplicate_insert_is_success_only_after_transactional_reread():
    service, dao, events = make_service()
    saved_results = iter([False, True])

    def read_saved_state(_user_id, _item_id):
        events.append("read_saved_state")
        return next(saved_results)

    dao.read_saved_state.side_effect = read_saved_state

    def duplicate_insert(_user_id, _item_id):
        events.append("insert")
        raise IntegrityError(
            "insert", {}, Exception("UNIQUE constraint failed: saved_guides.user_id")
        )

    dao.insert_if_absent.side_effect = duplicate_insert

    result = service.save(7, "guide", 12)

    assert result == SavedItemState(item_type="guide", item_id=12, saved=True)
    assert events == [
        "begin", "read_saved_state", "insert", "rollback",
        "begin", "read_saved_state", "commit",
    ]


def test_unclassified_integrity_error_returns_unavailable():
    service, dao, _events = make_service()
    dao.classify_integrity_error.return_value = IntegrityConflictKind.OTHER
    dao.insert_if_absent.side_effect = IntegrityError(
        "insert", {}, Exception("unclassified check constraint")
    )

    with pytest.raises(SavedItemsUnavailable):
        service.save(7, "guide", 12)


def test_target_deleted_during_insert_is_rechecked_after_rollback():
    service, dao, events = make_service()
    target_results = iter([False, None])

    def read_saved_state(_user_id, _item_id):
        events.append("read_saved_state")
        return next(target_results)

    def foreign_key_insert(_user_id, _item_id):
        events.append("insert")
        raise IntegrityError("insert", {}, Exception("FOREIGN KEY constraint failed"))

    dao.read_saved_state.side_effect = read_saved_state
    dao.classify_integrity_error.return_value = (
        IntegrityConflictKind.UNNAMED_FOREIGN_KEY
    )
    dao.insert_if_absent.side_effect = foreign_key_insert

    with pytest.raises(SavedTargetNotFound):
        service.save(7, "guide", 12)

    assert events == [
        "begin", "read_saved_state", "insert", "rollback",
        "begin", "read_saved_state", "rollback",
    ]


def test_unrelated_unique_constraint_stays_503_even_if_relation_would_recheck_true():
    service, dao, _events = make_service()
    dao.read_saved_state.side_effect = [False, True]
    duplicate_error = IntegrityError(
        "insert",
        {},
        Exception(
            "Violation of UNIQUE constraint 'UQ_other'. "
            "Cannot insert duplicate key in object 'dbo.saved_guides'. (2627)"
        ),
    )
    dao.insert_if_absent.side_effect = duplicate_error
    inspector = Mock()
    inspector.get_pk_constraint.return_value = {
        "name": "PK_saved_guides",
        "constrained_columns": ["user_id", "guide_id"],
    }
    inspector.get_unique_constraints.return_value = [
        {"name": "UQ_other", "column_names": ["guide_id"]}
    ]
    inspector.get_indexes.return_value = []

    def classify(error):
        return classify_saved_item_integrity_error(
            error,
            session=service.session,
            relation_table="saved_guides",
            bookmark_columns=("user_id", "guide_id"),
            target_column="guide_id",
            target_table="guides",
        )

    dao.classify_integrity_error.side_effect = classify

    with patch("app.dao.saved_item_constraints.inspect", return_value=inspector):
        with pytest.raises(SavedItemsUnavailable):
            service.save(7, "guide", 12)

    # The second result models a relation found by a recheck. It must
    # not be consulted for an error that did not match the bookmark key.
    dao.read_saved_state.assert_called_once_with(7, 12)
