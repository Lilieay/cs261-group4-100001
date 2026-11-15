from datetime import datetime
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.dependencies import get_auth_service, get_db_session
from app.main import app
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.services.auth import AuthService
from app.services.summary_reconciliation import reconcile_uncertain_uploads
from app.services.summary_storage import LocalPdfStorage
from app.services.tu_api import TUAccount


def make_pdf(width=144):
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=width, height=144)
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def storage(tmp_path):
    return LocalPdfStorage(tmp_path)


@pytest.fixture
def api(storage, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine, tables=[
        Course.__table__, User.__table__, Summary.__table__, SummaryFile.__table__,
    ])
    sessions = sessionmaker(engine)
    auth = AuthService(
        sessions,
        verify=lambda username, _: TUAccount(username, "Test Student", "student", True),
    )
    owner, other, empty = [auth.login(name, "test") for name in ("owner", "other", "empty")]
    original_pdf = make_pdf()
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
                original_name="original.pdf", size_bytes=len(original_pdf),
                content_type="application/pdf",
            ))
            storage.put_private(f"{summary_id:032x}", original_pdf)

    def session_dependency():
        with sessions() as session:
            yield session

    monkeypatch.setattr(app.state, "pdf_storage", storage)
    monkeypatch.setattr(app, "dependency_overrides", {
        get_db_session: session_dependency,
        get_auth_service: lambda: auth,
    })
    headers = [{"Authorization": f"Bearer {login.token}"} for login in (owner, other, empty)]
    with TestClient(app) as client:
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


def replace_pdf(client, headers, pdf):
    return client.put(
        "/api/summaries/1",
        headers=headers,
        files={
            "title": (None, "Replacement"),
            "course_id": (None, "2"),
            "file": ("replacement.pdf", pdf, "application/pdf"),
        },
    )


def test_replace_pdf_updates_both_tables_and_the_existing_read_path(api, storage):
    client, sessions, (owner, _, _) = api
    new_pdf = make_pdf(width=288)
    response = replace_pdf(client, owner, new_pdf)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == 1
    assert result["course"]["id"] == 2
    assert result["file"]["original_name"] == "replacement.pdf"
    file_response = client.get(result["file"]["read_path"], headers=owner)
    assert file_response.status_code == 200
    assert file_response.content == new_pdf
    with sessions() as session:
        summary = session.get(Summary, 1)
        assert summary.title == "Replacement"
        assert summary.file.storage_key != f"{1:032x}"
    assert f"{1:032x}" not in storage.list_private_objects()


def test_pdf_replacement_validation_and_owner_errors_keep_the_original(api, storage):
    client, _, (owner, other, _) = api
    original = storage.list_private_objects()
    denied = replace_pdf(client, other, make_pdf(width=288))
    assert denied.status_code == 403
    invalid = replace_pdf(client, owner, b"not a PDF")
    assert invalid.status_code == 422
    assert invalid.json()["error"]["fields"][0]["field"] == "file"
    assert storage.list_private_objects() == original
    assert client.get("/api/summaries/1/file", headers=owner).content == make_pdf()


def test_pdf_replacement_rolls_back_metadata_and_removes_uncommitted_file(api, storage):
    client, sessions, (owner, _, _) = api
    original = storage.list_private_objects()

    @event.listens_for(sessions, "before_flush", once=True)
    def fail_file_update(_session, _context, _instances):
        raise SQLAlchemyError("Could not save summary file reference")

    response = replace_pdf(client, owner, make_pdf(width=288))
    assert response.status_code == 503, response.text
    with sessions() as session:
        summary = session.get(Summary, 1)
        assert summary.title == "Original"
        assert summary.course_id == 1
        assert summary.file.original_name == "original.pdf"
    assert storage.list_private_objects() == original
    file_response = client.get("/api/summaries/1/file", headers=owner)
    assert file_response.content == make_pdf()


def test_uncertain_pdf_commit_keeps_both_objects_until_reconciliation(api, storage):
    client, sessions, (owner, _, _) = api

    @event.listens_for(sessions, "after_commit", once=True)
    def lose_commit_result(_session):
        raise SQLAlchemyError("Connection failed after committing the update")

    new_pdf = make_pdf(width=288)
    response = replace_pdf(client, owner, new_pdf)
    assert response.status_code == 503, response.text
    assert len(storage.pending_reconciliation()) == 2
    assert f"{1:032x}" in storage.list_private_objects()
    assert client.get("/api/summaries/1/file", headers=owner).content == new_pdf
    assert reconcile_uncertain_uploads(storage, sessions) == (1, 1)
    assert f"{1:032x}" not in storage.list_private_objects()
    assert client.get("/api/summaries/1/file", headers=owner).content == new_pdf


def test_owner_can_delete_and_u6_no_longer_exposes_the_summary_or_pdf(api, storage):
    client, sessions, (owner, other, _) = api
    assert client.delete("/api/summaries/1", headers=other).status_code == 403
    response = client.delete("/api/summaries/1", headers=owner)
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["Cache-Control"] == "no-store"
    for path in ("/api/summaries/1", "/api/summaries/1/file"):
        assert client.get(path, headers=owner).status_code == 404
    assert client.delete("/api/summaries/1", headers=owner).status_code == 404
    with sessions() as session:
        assert session.get(SummaryFile, 1) is None
        assert session.get(Summary, 2) is not None
        assert session.get(Course, 1) is not None
    assert f"{1:032x}" not in storage.list_private_objects()


def test_delete_remains_successful_if_old_file_cleanup_needs_retry(api, storage, monkeypatch):
    client, sessions, (owner, _, _) = api

    with monkeypatch.context() as patch:
        def fail_cleanup(_key):
            raise OSError("Temporary filesystem error")

        patch.setattr(storage, "delete_private", fail_cleanup)
        response = client.delete("/api/summaries/1", headers=owner)
        assert response.status_code == 204
        assert f"{1:032x}" in storage.pending_reconciliation()

    assert client.get("/api/summaries/1/file", headers=owner).status_code == 404
    assert reconcile_uncertain_uploads(storage, sessions) == (0, 1)
    assert f"{1:032x}" not in storage.list_private_objects()
