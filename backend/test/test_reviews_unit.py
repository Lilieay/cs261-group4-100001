"""Validation/business tests use mocks; DDL checks compile SQL without SQL Server."""
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.dialects import mssql
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.schema import CreateIndex, CreateTable

from app.dao.review_dao import ReviewDAO
from app.db import Base
from app.models.review import Review, summary_reference
from app.schemas.reviews import ReviewWriteRequest
from app.services.reviews import ReviewError, ReviewsService, duplicate_review
from scripts.init_reviews import initialize_reviews


def service():
    session, dao = MagicMock(), MagicMock()
    return ReviewsService(session, dao), session, dao


@pytest.mark.parametrize("rating", [1, 5])
@pytest.mark.parametrize("comment", [None, "", "  ", "😀" * 2000])
def test_payload_valid_boundaries(rating, comment):
    payload = ReviewWriteRequest(rating=rating, comment=comment)
    assert payload.rating == rating
    assert payload.comment == ((comment.strip() or None) if comment is not None else None)


@pytest.mark.parametrize("rating", [0, 6, -1, 2.5, True, "5", None])
def test_payload_rejects_invalid_rating(rating):
    with pytest.raises(ValidationError):
        ReviewWriteRequest(rating=rating)


def test_payload_missing_rating_and_surrogates():
    for body in [{}, {"rating": 5, "comment": "\ud800"}]:
        with pytest.raises(ValidationError):
            ReviewWriteRequest(**body)


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_create_business_rules_do_not_write(kind):
    svc, session, dao = service()
    for target, code in [(None, f"{kind.upper()}_NOT_FOUND"), ((42, 11), "SELF_REVIEW_FORBIDDEN")]:
        dao.get_target_for_create.return_value = target
        with pytest.raises(ReviewError) as caught:
            svc.create(kind, 42, 11, ReviewWriteRequest(rating=5))
        assert caught.value.code == code
    dao.create.assert_not_called()
    session.commit.assert_not_called()
    assert session.rollback.call_count == 2


def test_unowned_review_is_not_modified():
    svc, session, dao = service()
    dao.get_review_for_write.return_value = SimpleNamespace(author_id=33)
    with pytest.raises(ReviewError) as caught:
        svc.write(7, 22, ReviewWriteRequest(rating=1))
    assert caught.value.code == "REVIEW_FORBIDDEN"
    dao.update_owned.assert_not_called()
    dao.delete_owned.assert_not_called()
    session.rollback.assert_called_once()


@pytest.mark.parametrize("operation", ["create", "update", "delete", "list"])
def test_storage_errors_rollback(operation):
    svc, session, dao = service()
    if operation == "create":
        dao.get_target_for_create.side_effect = SQLAlchemyError("failure")
        invoke = lambda: svc.create("guide", 42, 22, ReviewWriteRequest(rating=5))
    elif operation == "list":
        dao.list_for_target.side_effect = SQLAlchemyError("failure")
        invoke = lambda: svc.list_for_target("summary", 42)
    else:
        dao.get_review_for_write.side_effect = SQLAlchemyError("failure")
        invoke = lambda: svc.write(7, 22, ReviewWriteRequest(rating=5) if operation == "update" else None)
    with pytest.raises(ReviewError) as caught:
        invoke()
    assert caught.value.status == 503
    session.rollback.assert_called_once()
    session.commit.assert_not_called()


@pytest.mark.parametrize("message,is_duplicate", [
    ("2601 duplicate key ux_reviews_guide_author", True),
    ("2601 duplicate key ux_reviews_summary_author", True),
    ("UNIQUE constraint failed: reviews.guide_id, reviews.author_id", True),
    ("FK_reviews_summary conflict", False),
    ("CHECK ck_reviews_rating conflict", False),
    ("duplicate key unrelated_index", False),
])
def test_only_review_unique_conflicts_map_to_409(message, is_duplicate):
    exc = IntegrityError("insert", {}, Exception(message))
    assert duplicate_review(exc) is is_duplicate
    svc, session, dao = service()
    dao.get_target_for_create.side_effect = exc
    with pytest.raises(ReviewError) as caught:
        svc.create("guide", 42, 22, ReviewWriteRequest(rating=5))
    assert caught.value.status == (409 if is_duplicate else 503)
    session.rollback.assert_called_once()


def test_empty_list_is_distinct_from_missing_target():
    svc, _, dao = service()
    dao.list_for_target.return_value = [(42, None, None)]
    assert svc.list_for_target("summary", 42).items == []
    dao.list_for_target.return_value = []
    with pytest.raises(ReviewError) as caught:
        svc.list_for_target("summary", 42)
    assert caught.value.code == "SUMMARY_NOT_FOUND"


def test_sqlserver_ddl_and_lock_hints_compile():
    sql = str(CreateTable(Review.__table__).compile(dialect=mssql.dialect()))
    assert "NVARCHAR(4000)" in sql and "DATETIME2(3)" in sql and "TINYINT" in sql
    assert "REFERENCES summaries (id) ON DELETE CASCADE" in sql
    assert "REFERENCES guides (id) ON DELETE CASCADE" in sql
    assert "ck_reviews_one_target" in sql and "ck_reviews_rating" in sql
    indexes = {i.name: str(CreateIndex(i).compile(dialect=mssql.dialect())) for i in Review.__table__.indexes}
    assert "WHERE summary_id IS NOT NULL" in indexes["ux_reviews_summary_author"]
    assert "WHERE guide_id IS NOT NULL" in indexes["ux_reviews_guide_author"]
    assert summary_reference.metadata is not Base.metadata
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "mssql"
    stmt = ReviewDAO(session).lock(select(summary_reference.c.id), summary_reference)
    assert "WITH (UPDLOCK, HOLDLOCK)" in str(stmt.compile(dialect=mssql.dialect()))


def test_initializer_does_not_create_missing_shared_tables():
    engine = create_engine("sqlite://")
    try:
        with pytest.raises(RuntimeError, match="shared U1/U3/U6 schema"):
            initialize_reviews(engine)
        assert inspect(engine).get_table_names() == []
    finally:
        engine.dispose()


def test_initializer_adds_only_reviews_and_preserves_existing_records():
    from app.models.user import User
    from app.models.course import Course
    from app.models.guide import Guide

    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine, tables=[User.__table__, Course.__table__, Guide.__table__])
        summary_reference.create(engine)
        with engine.begin() as conn:
            conn.execute(summary_reference.insert().values(id=42, owner_id=11))
        initialize_reviews(engine)
        tables = inspect(engine).get_table_names()
        assert set(tables) == {"users", "courses", "guides", "summaries", "reviews"}
        with engine.connect() as conn:
            assert conn.scalar(select(summary_reference.c.id)) == 42
        with pytest.raises(RuntimeError, match="reviews already exists"):
            initialize_reviews(engine)
        assert inspect(engine).get_table_names() == tables
    finally:
        engine.dispose()


def test_failed_rollback_returns_uncertain_storage_error():
    svc, session, dao = service()
    session.commit.side_effect = SQLAlchemyError("commit disconnected")
    session.rollback.side_effect = SQLAlchemyError("rollback disconnected")
    dao.list_for_target.return_value = [(42, None, None)]
    with pytest.raises(ReviewError) as caught:
        svc.list_for_target("guide", 42)
    assert caught.value.status == 503
    assert "โหลดข้อมูลล่าสุด" in caught.value.message
