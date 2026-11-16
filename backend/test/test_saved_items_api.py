from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, inspect, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.dependencies import current_user, get_auth_service, get_db_session
from app.main import app
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.services.auth import AuthenticatedUser
from app.dao.saved_guide_dao import SavedGuideDAO


@pytest.fixture
def saved_item_client():
    engine = create_engine(
        "sqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as session:
        user_a = User(username="saved_items_a")
        user_b = User(username="saved_items_b")
        course = Course(course_code="CS261", course_name="Software Engineering")
        session.add_all([user_a, user_b, course])
        session.flush()
        guide = Guide(
            course_id=course.id,
            publisher_id=user_a.id,
            title="Saved guide",
            academic_year=2568,
            semester=1,
            exam_period="midterm",
            topics="Test topics",
            exam_format="mixed",
            subjective_count=2,
            objective_count=10,
        )
        summary = Summary(
            course_id=course.id,
            owner_id=user_a.id,
            title="Saved PDF summary",
        )
        session.add_all([guide, summary])
        session.flush()
        session.add(
            SummaryFile(
                summary_id=summary.id,
                storage_key="test-summary-private-key",
                original_name="summary.pdf",
                content_type="application/pdf",
                size_bytes=10,
            )
        )
        ids = {
            "user_a": user_a.id,
            "user_b": user_b.id,
            "course": course.id,
            "guide": guide.id,
            "summary": summary.id,
        }
        # Existing bookmark data remains in the legacy relation unchanged.
        session.add(SavedGuide(user_id=user_b.id, guide_id=guide.id))
        session.commit()

    # ORM create_all is rerunnable and must not copy or rewrite old bookmarks.
    Base.metadata.create_all(engine)
    account = {"id": ids["user_a"]}
    previous = app.dependency_overrides.copy()

    def current_user_override():
        current_id = account["id"]
        username = "saved_items_a" if current_id == ids["user_a"] else "saved_items_b"
        return "test-token", AuthenticatedUser(
            current_id, username, "Test Student", "student"
        )

    def db_override():
        with session_factory() as session:
            yield session

    app.dependency_overrides[current_user] = current_user_override
    app.dependency_overrides[get_db_session] = db_override
    try:
        with TestClient(app) as client:
            yield client, session_factory, engine, ids, account
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


def test_save_and_read_state_for_guides_and_summaries(saved_item_client):
    client, session_factory, _engine, ids, _account = saved_item_client
    assert ids["guide"] == ids["summary"]
    for item_type, item_id in (
        ("guide", ids["guide"]),
        ("summary", ids["summary"]),
    ):
        path = f"/api/saved-items/{item_type}/{item_id}"
        initial = client.get(path)
        assert initial.status_code == 200, initial.text
        assert initial.json() == {
            "item_type": item_type,
            "item_id": item_id,
            "saved": False,
        }
        assert initial.headers["cache-control"] == "no-store"

        first = client.put(path)
        repeated = client.put(path)
        assert first.status_code == repeated.status_code == 200
        assert first.json() == repeated.json() == {
            "item_type": item_type,
            "item_id": item_id,
            "saved": True,
        }
        assert first.headers["cache-control"] == "no-store"
        assert client.get(path).json()["saved"] is True

    with session_factory() as session:
        assert session.scalar(select(func.count(SavedGuide.user_id))) == 2
        assert session.scalar(select(func.count(SavedSummary.user_id))) == 1
        assert session.scalar(select(func.count(Course.id))) == 1


def test_current_user_owns_relation_and_legacy_saved_guides_are_preserved(
    saved_item_client,
):
    client, session_factory, engine, ids, account = saved_item_client
    guide_path = f"/api/saved-items/guide/{ids['guide']}"
    summary_path = f"/api/saved-items/summary/{ids['summary']}"

    # User B's pre-existing saved_guides row survives create_all and is not copied.
    with session_factory() as session:
        assert session.get(SavedGuide, (ids["user_b"], ids["guide"])) is not None
        assert session.scalar(select(func.count(SavedSummary.user_id))) == 0

    account["id"] = ids["user_b"]
    assert client.get(guide_path).json()["saved"] is True
    assert client.get(summary_path).json()["saved"] is False
    assert client.put(summary_path).json()["saved"] is True

    account["id"] = ids["user_a"]
    assert client.get(guide_path).json()["saved"] is False
    assert client.put(guide_path).json()["saved"] is True

    tables = set(inspect(engine).get_table_names())
    assert "saved_courses" not in tables
    assert "saved_summaries" in tables
    with session_factory() as session:
        assert session.get(SavedGuide, (ids["user_b"], ids["guide"])) is not None
        assert session.get(SavedGuide, (ids["user_a"], ids["guide"])) is not None
        assert session.get(SavedSummary, (ids["user_b"], ids["summary"])) is not None


@pytest.mark.parametrize(
    ("path", "expected_code"),
    [
        ("/api/saved-items/course/1", "INVALID_PARAMETERS"),
        ("/api/saved-items/guide/0", "INVALID_PARAMETERS"),
        ("/api/saved-items/guide/2147483648", "INVALID_PARAMETERS"),
        ("/api/saved-items/guide/not-an-id", "INVALID_PARAMETERS"),
    ],
)
def test_invalid_item_type_or_id_is_a_contract_error(
    saved_item_client, path, expected_code
):
    response = saved_item_client[0].put(path)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code
    assert response.headers["cache-control"] == "no-store"


def test_query_or_body_parameters_are_rejected(saved_item_client):
    client, _session_factory, _engine, ids, _account = saved_item_client
    path = f"/api/saved-items/guide/{ids['guide']}"

    query_response = client.get(path, params={"user_id": ids["user_b"]})
    body_response = client.put(path, json={"user_id": ids["user_b"]})

    for response in (query_response, body_response):
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_PARAMETERS"
        assert response.headers["cache-control"] == "no-store"


def test_missing_target_returns_type_specific_not_found(saved_item_client):
    client, _session_factory, _engine, _ids, _account = saved_item_client

    guide = client.put("/api/saved-items/guide/2147483000")
    summary = client.get("/api/saved-items/summary/2147483000")

    assert guide.status_code == 404
    assert guide.json()["error"]["code"] == "GUIDE_NOT_FOUND"
    assert summary.status_code == 404
    assert summary.json()["error"]["code"] == "SUMMARY_NOT_FOUND"
    assert guide.headers["cache-control"] == summary.headers["cache-control"] == "no-store"


def test_unauthenticated_requests_use_login_error_envelope(saved_item_client):
    client, _session_factory, _engine, ids, _account = saved_item_client
    previous_auth = app.dependency_overrides.get(get_auth_service)

    class InvalidAuthService:
        def get_user(self, _token):
            return None

    app.dependency_overrides.pop(current_user, None)
    app.dependency_overrides[get_auth_service] = lambda: InvalidAuthService()
    try:
        response = client.get(f"/api/saved-items/guide/{ids['guide']}")
    finally:
        app.dependency_overrides[current_user] = lambda: (
            "test-token",
            AuthenticatedUser(ids["user_a"], "saved_items_a", "Test Student", "student"),
        )
        if previous_auth is None:
            app.dependency_overrides.pop(get_auth_service, None)
        else:
            app.dependency_overrides[get_auth_service] = previous_auth

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"


def test_database_failures_return_503_and_do_not_create_bookmark(saved_item_client):
    client, session_factory, _engine, ids, _account = saved_item_client
    path = f"/api/saved-items/guide/{ids['guide']}"

    with patch.object(
        SavedGuideDAO, "target_exists", side_effect=SQLAlchemyError("read failed")
    ):
        read_response = client.get(path)
    with patch.object(
        SavedGuideDAO,
        "insert_if_absent",
        side_effect=SQLAlchemyError("write failed"),
    ):
        write_response = client.put(path)

    for response in (read_response, write_response):
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "SAVED_ITEMS_UNAVAILABLE"
        assert response.headers["cache-control"] == "no-store"
    with session_factory() as session:
        assert session.get(SavedGuide, (ids["user_a"], ids["guide"])) is None


def test_unauthorized_owner_body_is_not_accepted(saved_item_client):
    client, _session_factory, _engine, ids, _account = saved_item_client
    response = client.put(
        f"/api/saved-items/guide/{ids['guide']}", json={"user_id": ids["user_b"]}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"
