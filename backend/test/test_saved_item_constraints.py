from unittest.mock import Mock, patch

from sqlalchemy.exc import IntegrityError

from app.dao.saved_item_constraints import (
    IntegrityConflictKind,
    classify_saved_item_integrity_error,
)


def test_sqlite_bookmark_duplicate_requires_exact_relation_columns():
    session = Mock()
    expected = IntegrityError(
        "insert",
        {},
        Exception(
            "UNIQUE constraint failed: saved_guides.user_id, saved_guides.guide_id"
        ),
    )
    unrelated = IntegrityError(
        "insert", {}, Exception("UNIQUE constraint failed: saved_guides.guide_id")
    )

    classification = classify_saved_item_integrity_error(
        expected,
        session=session,
        relation_table="saved_guides",
        bookmark_columns=("user_id", "guide_id"),
        target_column="guide_id",
        target_table="guides",
    )
    other_classification = classify_saved_item_integrity_error(
        unrelated,
        session=session,
        relation_table="saved_guides",
        bookmark_columns=("user_id", "guide_id"),
        target_column="guide_id",
        target_table="guides",
    )

    assert classification is IntegrityConflictKind.BOOKMARK_DUPLICATE
    assert other_classification is IntegrityConflictKind.OTHER
    session.get_bind.assert_not_called()


def test_sqlserver_duplicate_constraint_name_must_match_expected_key_metadata():
    error = IntegrityError(
        "insert",
        {},
        Exception(
            "Violation of UNIQUE constraint 'UQ_other'. "
            "Cannot insert duplicate key in object 'dbo.saved_guides'. (2627)"
        ),
    )
    session = Mock()
    inspector = Mock()
    inspector.get_pk_constraint.return_value = {
        "name": "PK_saved_guides",
        "constrained_columns": ["user_id", "guide_id"],
    }
    inspector.get_unique_constraints.return_value = [
        {"name": "UQ_other", "column_names": ["guide_id"]}
    ]
    inspector.get_indexes.return_value = []

    with patch("app.dao.saved_item_constraints.inspect", return_value=inspector):
        result = classify_saved_item_integrity_error(
            error,
            session=session,
            relation_table="saved_guides",
            bookmark_columns=("user_id", "guide_id"),
            target_column="guide_id",
            target_table="guides",
        )

    assert result is IntegrityConflictKind.OTHER
    inspector.get_pk_constraint.assert_called_once_with("saved_guides")


def test_sqlserver_expected_primary_key_name_and_columns_are_confirmed():
    error = IntegrityError(
        "insert",
        {},
        Exception(
            "Violation of PRIMARY KEY constraint 'PK_saved_guides'. "
            "Cannot insert duplicate key in object 'dbo.saved_guides'. (2627)"
        ),
    )
    session = Mock()
    inspector = Mock()
    inspector.get_pk_constraint.return_value = {
        "name": "PK_saved_guides",
        "constrained_columns": ["user_id", "guide_id"],
    }

    with patch("app.dao.saved_item_constraints.inspect", return_value=inspector):
        result = classify_saved_item_integrity_error(
            error,
            session=session,
            relation_table="saved_guides",
            bookmark_columns=("user_id", "guide_id"),
            target_column="guide_id",
            target_table="guides",
        )

    assert result is IntegrityConflictKind.BOOKMARK_DUPLICATE


def test_sqlserver_target_fk_must_match_the_target_relation():
    error = IntegrityError(
        "insert",
        {},
        Exception(
            "The INSERT statement conflicted with the FOREIGN KEY constraint "
            "'FK_saved_guides_guides'. (547)"
        ),
    )
    session = Mock()
    inspector = Mock()
    inspector.get_foreign_keys.return_value = [
        {
            "name": "FK_saved_guides_guides",
            "constrained_columns": ["guide_id"],
            "referred_table": "guides",
            "referred_columns": ["id"],
        },
        {
            "name": "FK_saved_guides_users",
            "constrained_columns": ["user_id"],
            "referred_table": "users",
            "referred_columns": ["id"],
        },
    ]

    with patch("app.dao.saved_item_constraints.inspect", return_value=inspector):
        result = classify_saved_item_integrity_error(
            error,
            session=session,
            relation_table="saved_guides",
            bookmark_columns=("user_id", "guide_id"),
            target_column="guide_id",
            target_table="guides",
        )

    assert result is IntegrityConflictKind.TARGET_FOREIGN_KEY
