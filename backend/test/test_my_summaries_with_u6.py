from datetime import datetime
from importlib.util import find_spec

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


if find_spec("app.models.summary") is None:
    pytest.skip("Requires the shared U6 Summary model", allow_module_level=True)

from app.db import Base
from app.dependencies import get_auth_service, get_db_session
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.routers.my_summaries import router
from app.services.auth import AuthService
from app.services.tu_api import TUAccount


@pytest.fixture
def api():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=[
        Course.__table__, User.__table__, Summary.__table__, SummaryFile.__table__,
    ])
    sessions = sessionmaker(engine)
    auth = AuthService(
        sessions,
        verify=lambda username, _: TUAccount(username, "Test Student", "student", True),
    )
    owner, other, empty = [auth.login(name, "test") for name in ("owner", "other", "empty")]
    with sessions.begin() as session:
        session.add_all([
            Course(id=1, course_code="CS261", course_name="Software Engineering"),
            Course(id=2, course_code="CS104", course_name="Programming"),
            Course(id=3, course_code="MA111", course_name="Mathematics"),
        ])
        session.flush()
        for summary_id, user_id, day in [
            (1, owner.user.id, 10),
            (2, other.user.id, 12),
            (3, owner.user.id, 11),
            (4, owner.user.id, 11),
        ]:
            session.add(Summary(
                id=summary_id, owner_id=user_id, course_id=1, title="Original",
                description="Original description", created_at=datetime(2026, 11, day),
            ))
            session.flush()
            session.add(SummaryFile(
                summary_id=summary_id, storage_key=f"{summary_id:032x}",
                original_name="original.pdf", size_bytes=100,
                content_type="application/pdf",
            ))

    def session_dependency():
        with sessions() as session:
            yield session

    application = FastAPI()
    application.dependency_overrides[get_db_session] = session_dependency
    application.dependency_overrides[get_auth_service] = lambda: auth
    application.include_router(router)
    headers = [{"Authorization": f"Bearer {login.token}"} for login in (owner, other, empty)]
    with TestClient(application) as client:
        yield client, sessions, headers
    engine.dispose()


def test_list_only_returns_owned_summaries_newest_first(api):
    client, _, (owner, other, empty) = api
    for headers, expected in [(owner, [4, 3, 1]), (other, [2]), (empty, [])]:
        response = client.get("/api/my-summaries", headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store"
        assert [item["id"] for item in response.json()["items"]] == expected


def test_owner_can_move_summary_without_changing_pdf_reference(api):
    client, sessions, (owner, _, _) = api
    response = client.put("/api/summaries/1", headers=owner, files={
        "title": (None, "  Updated  "),
        "course_id": (None, "2"),
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["course"]["id"] == 2
    assert result["title"] == "Updated"
    assert result["description"] is None
    assert result["file"]["read_path"] == "/api/summaries/1/file"
    assert "storage_key" not in result["file"]
    with sessions() as session:
        summary = session.get(Summary, 1)
        assert summary.course_id == 2
        assert summary.title == "Updated"
        assert summary.created_at == datetime(2026, 11, 10)
        assert summary.file.storage_key == f"{1:032x}"


@pytest.mark.parametrize(
    ("actor", "summary_id", "course_id", "status", "code"),
    [
        (None, 1, 2, 401, "AUTH_REQUIRED"),
        (1, 1, 2, 403, "SUMMARY_FORBIDDEN"),
        (0, 99, 2, 404, "SUMMARY_NOT_FOUND"),
        (0, 1, 3, 404, "COURSE_NOT_FOUND"),
    ],
)
def test_rejected_update_keeps_metadata_and_pdf_reference(
    api, actor, summary_id, course_id, status, code
):
    client, sessions, headers = api
    response = client.put(
        f"/api/summaries/{summary_id}",
        headers=headers[actor] if actor is not None else {},
        files={"title": (None, "Updated"), "course_id": (None, str(course_id))},
    )
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    with sessions() as session:
        summary = session.get(Summary, 1)
        assert summary.course_id == 1
        assert summary.title == "Original"
        assert summary.file.storage_key == f"{1:032x}"


def test_update_rolls_back_if_database_fails_before_commit(api):
    client, sessions, (owner, _, _) = api

    @event.listens_for(sessions, "before_commit", once=True)
    def fail_before_commit(_session):
        raise SQLAlchemyError("Database disconnected before commit")

    response = client.put(
        "/api/summaries/1",
        headers=owner,
        files={"title": (None, "Updated"), "course_id": (None, "2")},
    )
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "STORAGE_UNAVAILABLE"
    with sessions() as session:
        summary = session.get(Summary, 1)
        assert summary.course_id == 1
        assert summary.title == "Original"
        assert summary.file.storage_key == f"{1:032x}"
