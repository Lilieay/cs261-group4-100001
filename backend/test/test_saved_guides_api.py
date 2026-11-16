from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.dao.saved_guide_dao import SavedGuideDAO
from app.dependencies import current_user, get_db_session
from app.main import app
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.summary import Summary
from app.models.user import User
from app.services.auth import AuthenticatedUser as AuthUser


@pytest.fixture
def saved_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = Session(engine)
    session.add_all([User(username="one"), User(username="two"),
                     Course(course_code="CS261", course_name="Software Engineering")])
    session.flush()
    guide = Guide(course_id=1, publisher_id=1, title="Guide", academic_year=2568,
                  semester=1, exam_period="midterm", topics="Topics", exam_format="mixed",
                  subjective_count=2, objective_count=10)
    session.add(guide)
    session.commit()
    account = {"id": 1}

    def user():
        return "test-token", AuthUser(account["id"], "one" if account["id"] == 1 else "two", "Student", "student")

    def db():
        yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[current_user] = user
    app.dependency_overrides[get_db_session] = db
    try:
        with TestClient(app) as client:
            yield client, session, account
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        session.close()
        engine.dispose()


def test_saved_guides_are_persistent_idempotent_and_separate_per_user(saved_client):
    client, session, account = saved_client
    assert client.get("/api/saved-guides").json() == []
    assert client.get("/api/saved-guides/1").json() == {"id": 1, "saved": False}
    for _ in range(2):
        assert client.put("/api/saved-guides/1").json() == {"id": 1, "saved": True}
    assert len(session.scalars(select(SavedGuide)).all()) == 1
    session.expire_all()
    assert client.get("/api/saved-guides").json()[0]["title"] == "Guide"
    account["id"] = 2
    assert client.get("/api/saved-guides").json() == []
    assert client.put("/api/saved-guides/1").status_code == 200
    assert len(client.get("/api/saved-guides").json()) == 1
    assert client.delete("/api/saved-guides/1").status_code == 200
    account["id"] = 1
    assert client.get("/api/saved-guides/1").json()["saved"] is True
    for _ in range(2):
        assert client.delete("/api/saved-guides/1").json()["saved"] is False
    assert client.get("/api/saved-guides").json() == []


def test_saved_list_uses_current_content_and_guide_deletion_cascades(saved_client):
    client, session, _ = saved_client
    assert client.put("/api/saved-guides/1").status_code == 200
    guide = session.get(Guide, 1)
    guide.title = "Updated title"
    session.commit()
    assert client.get("/api/saved-guides").json()[0]["title"] == "Updated title"
    assert client.delete("/api/my-guides/1").status_code == 200
    assert client.get("/api/saved-guides").json() == []
    assert session.scalars(select(SavedGuide)).all() == []
    assert client.put("/api/saved-guides/1").status_code == 404


def test_saved_routes_require_login_and_valid_ids(saved_client):
    client, _, _ = saved_client
    assert client.put("/api/saved-guides/999").status_code == 404
    for value in ["0", "-1", "abc", "2147483648"]:
        assert client.put(f"/api/saved-guides/{value}").status_code == 422
    app.dependency_overrides.pop(current_user)
    assert client.get("/api/saved-guides").status_code == 401
    assert client.put("/api/saved-guides/1").status_code == 401
    assert client.delete("/api/saved-guides/1").status_code == 401


@pytest.mark.parametrize("method", ["put", "delete"])
def test_saved_write_failure_rolls_back_without_changing_bookmarks(saved_client, method):
    client, session, _ = saved_client
    if method == "delete":
        assert client.put("/api/saved-guides/1").status_code == 200
    with patch.object(session, "commit", side_effect=SQLAlchemyError("write failed")):
        response = getattr(client, method)("/api/saved-guides/1")
    assert response.status_code == 503
    assert response.json() == {"detail": "SAVED_GUIDES_UNAVAILABLE"}
    session.expire_all()
    assert client.get("/api/saved-guides/1").json()["saved"] is (method == "delete")


def test_saved_duplicate_write_is_success_only_when_bookmark_exists(saved_client):
    client, _, _ = saved_client
    duplicate = IntegrityError("insert", {}, Exception("duplicate"))
    with patch.object(SavedGuideDAO, "add", side_effect=duplicate):
        assert client.put("/api/saved-guides/1").status_code == 503
    assert client.put("/api/saved-guides/1").status_code == 200
    with patch.object(SavedGuideDAO, "add", side_effect=duplicate):
        response = client.put("/api/saved-guides/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "saved": True}


@pytest.mark.parametrize("path,operation", [
    ("/api/saved-guides", "list_by_user"),
    ("/api/saved-guides/1", "contains"),
])
def test_saved_read_failure_preserves_unavailable_response(saved_client, path, operation):
    client, _, _ = saved_client
    with patch.object(SavedGuideDAO, operation, side_effect=SQLAlchemyError("read failed")):
        response = client.get(path)
    assert response.status_code == 503
    assert response.json() == {"detail": "SAVED_GUIDES_UNAVAILABLE"}


def test_saved_duplicate_recheck_failure_returns_unavailable(saved_client):
    client, _, _ = saved_client
    with patch.object(SavedGuideDAO, "add", side_effect=IntegrityError("insert", {}, Exception())), \
         patch.object(SavedGuideDAO, "contains", side_effect=SQLAlchemyError("read failed")):
        response = client.put("/api/saved-guides/1")
    assert response.status_code == 503
    assert response.json() == {"detail": "SAVED_GUIDES_UNAVAILABLE"}

def test_u9_combines_legacy_guides_with_saved_summaries_and_preserves_item_identity(saved_client):
    client, session, account = saved_client
    session.add(Summary(id=1, course_id=1, owner_id=1, title="PDF"))
    session.commit()
    assert client.put("/api/saved-guides/1").status_code == 200
    assert client.get("/api/saved-items/summary/1").json()["saved"] is False
    for _ in range(2):
        assert client.put("/api/saved-items/summary/1").json() == {
            "item_type": "summary", "item_id": 1, "saved": True
        }
        assert client.put("/api/saved-items/guide/1").json()["saved"] is True
    response = client.get("/api/saved-items")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    items = response.json()["items"]
    assert [(item["item_type"], item["item_id"], item["open_path"]) for item in items] == [
        ("guide", 1, "/api/guides/1"), ("summary", 1, "/api/summaries/1")
    ]
    assert all(item["course"]["course_code"] == "CS261" for item in items)
    account["id"] = 2
    assert client.get("/api/saved-items").json() == {"items": []}
    assert client.put("/api/saved-items/summary/1").json()["saved"] is True
    account["id"] = 1
    assert client.delete("/api/saved-items/summary/1").json()["saved"] is False
    assert client.get("/api/saved-items/guide/1").json()["saved"] is True
    account["id"] = 2
    assert client.get("/api/saved-items/summary/1").json()["saved"] is True
    session.delete(session.get(Summary, 1))
    session.commit()
    assert client.get("/api/saved-items").json() == {"items": []}
    assert client.get("/api/saved-items/summary/1").json()["error"]["code"] == "SUMMARY_NOT_FOUND"
    assert client.delete("/api/saved-items/summary/1").json()["saved"] is False


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_u9_validation_auth_and_rollback(saved_client, kind):
    client, session, _ = saved_client
    session.add(Summary(id=1, course_id=1, owner_id=1, title="PDF"))
    session.commit()
    url = f"/api/saved-items/{kind}/1"
    assert client.put(url + "?user_id=2").json()["error"]["code"] == "INVALID_PARAMETERS"
    assert client.put(url, json={"user_id": 2}).status_code == 422
    assert client.put(url.replace(kind, "course")).status_code == 422
    assert client.put(url[:-1] + "2147483648").status_code == 422
    with patch.object(session, "commit", side_effect=SQLAlchemyError("write failed")):
        failed = client.put(url)
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "SAVED_ITEMS_UNAVAILABLE"
    assert client.get(url).json()["saved"] is False
    app.dependency_overrides.pop(current_user)
    denied = client.put(url)
    assert denied.status_code == 401
    assert denied.headers["www-authenticate"] == "Bearer"
    assert denied.json()["error"]["code"] == "AUTH_REQUIRED"
