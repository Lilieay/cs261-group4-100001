"""Real HTTP/validation/service/DAO with SQLite; session authentication is mocked.

The minimal Summary fixture is not the U6 ORM or real PDF storage. These tests
do not establish SQL Server locking/cascade/concurrency or full integration.
"""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.dao.review_dao import ReviewDAO
from app.dependencies import get_auth_service, get_db_session
from app.main import app
from app.models.course import Course
from app.models.guide import Guide
from app.models.review import Review, summary_reference
from app.models.user import User


@pytest.fixture
def api():
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    with engine.begin() as conn:
        User.__table__.create(conn)
        Course.__table__.create(conn)
        Guide.__table__.create(conn)
        summary_reference.create(conn)  # minimal test target, never production schema
        Review.__table__.create(conn)
    with Session(engine) as session:
        session.add_all([User(id=i, username=name, displayname_th=name)
                         for i, name in [(11, "publisher"), (22, "reader"), (33, "other")]])
        session.add(Course(id=1, course_code="CS261", course_name="Software Engineering"))
        session.flush()
        session.add(Guide(id=42, course_id=1, publisher_id=11, title="Guide",
                          academic_year=2569, semester=1, exam_period="midterm",
                          topics="Topic", exam_format="objective", objective_count=10))
        session.execute(summary_reference.insert().values(id=42, owner_id=11))
        session.commit()
        previous = app.dependency_overrides.copy()
        app.dependency_overrides[get_db_session] = lambda: session
        users = {name: SimpleNamespace(id=i) for name, i in
                 [("publisher", 11), ("reader", 22), ("other", 33)]}
        previous_auth = app.state.auth_service
        app.state.auth_service = SimpleNamespace(get_user=users.get)
        try:
            with TestClient(app) as client:
                yield client, session
        finally:
            app.state.auth_service = previous_auth
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
    engine.dispose()


def auth(actor="reader"):
    return {"Authorization": f"Bearer {actor}"}


def path(kind):
    return f"/api/{'guides' if kind == 'guide' else 'summaries'}/42/reviews"


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.headers["cache-control"] == "no-store"
    assert set(response.json()["error"]) == {"code", "message", "fields"}
    assert response.json()["error"]["code"] == code
    assert isinstance(response.json()["error"]["fields"], list)


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_lifecycle_and_isolation(api, kind):
    client, session = api
    url = path(kind)
    assert client.get(url, headers=auth()).json()["items"] == []
    created = client.post(url, headers=auth(), json={"rating": 5, "comment": " อ่านง่าย "})
    assert created.status_code == 201, created.text
    review = created.json()
    assert review["comment"] == "อ่านง่าย"
    assert review["author"] == {"id": 22, "display_name": "reader"}
    assert review["target_type"] == kind and review["target_id"] == 42
    assert review["created_at"].endswith("Z")
    rid = review["id"]
    other = client.post(url, headers=auth("other"), json={"rating": 3}).json()
    listed = client.get(url, headers=auth()).json()["items"]
    assert [r["id"] for r in listed] == [other["id"], rid]
    assert_error(client.post(url, headers=auth(), json={"rating": 1}), 409, "REVIEW_ALREADY_EXISTS")
    own_url = f"/api/reviews/{rid}"
    for method in ["put", "delete"]:
        kwargs = {"json": {"rating": 1}} if method == "put" else {}
        assert_error(getattr(client, method)(own_url, headers=auth("other"), **kwargs),
                     403, "REVIEW_FORBIDDEN")
    updated = client.put(own_url, headers=auth(), json={"rating": 4})
    assert updated.status_code == 200
    assert updated.json()["id"] == rid and updated.json()["comment"] is None
    assert client.get(url, headers=auth()).json()["items"][1]["rating"] == 4
    removed = client.delete(own_url, headers=auth())
    assert removed.status_code == 204 and removed.content == b""
    assert_error(client.delete(own_url, headers=auth()), 404, "REVIEW_NOT_FOUND")
    assert [r["id"] for r in client.get(url, headers=auth()).json()["items"]] == [other["id"]]
    assert client.post(url, headers=auth(), json={"rating": 1}).status_code == 201
    assert session.get(Guide, 42) is not None
    assert session.execute(select(summary_reference.c.id)).scalar_one() == 42


@pytest.mark.parametrize("kind", ["guide", "summary"])
@pytest.mark.parametrize("rating", [None, 0, 6, -1, 2.5, "5", True, {}, []])
def test_invalid_rating_on_create_and_update(api, kind, rating):
    client, _ = api
    original = client.post(path(kind), headers=auth(), json={"rating": 4, "comment": "เดิม"}).json()
    for url, method in [(path(kind), "post"), (f"/api/reviews/{original['id']}", "put")]:
        response = getattr(client, method)(url, headers=auth(), json={"rating": rating})
        assert_error(response, 422, "INVALID_PARAMETERS")
    assert client.get(path(kind), headers=auth()).json()["items"] == [original]


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_comment_boundaries_and_forbidden_fields(api, kind):
    client, _ = api
    url = path(kind)
    for body in [{}, {"rating": 5, "author_id": 33}, {"rating": 5, "target_id": 7},
                 {"rating": 5, "comment": 1}, {"rating": 5, "comment": "😀" * 2001}]:
        assert_error(client.post(url, headers=auth(), json=body), 422, "INVALID_PARAMETERS")
    created = client.post(url, headers=auth(), json={"rating": 1, "comment": " 😀" + "😀" * 1999 + " "})
    assert created.status_code == 201, created.text
    rid = created.json()["id"]
    own_url = f"/api/reviews/{rid}"
    assert_error(client.put(own_url, headers=auth(), json={"rating": 2, "comment": "ก" * 2001}),
                 422, "INVALID_PARAMETERS")
    assert_error(client.put(own_url, headers=auth(), json={"rating": 2, "author_id": 33}),
                 422, "INVALID_PARAMETERS")
    for comment in [" \t\n ", None]:
        result = client.put(own_url, headers=auth(), json={"rating": 5, "comment": comment})
        assert result.json()["comment"] is None


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_self_review_and_missing_target(api, kind):
    client, _ = api
    assert_error(client.post(path(kind), headers=auth("publisher"), json={"rating": 5}),
                 403, "SELF_REVIEW_FORBIDDEN")
    url = path(kind).replace("/42/", "/999999/")
    assert_error(client.get(url, headers=auth()), 404, f"{kind.upper()}_NOT_FOUND")
    assert_error(client.post(url, headers=auth(), json={"rating": 5}),
                 404, f"{kind.upper()}_NOT_FOUND")
    assert_error(client.put("/api/reviews/999999", headers=auth(), json={"rating": 5}),
                 404, "REVIEW_NOT_FOUND")


def test_same_id_targets_are_distinct(api):
    client, _ = api
    guide = client.post(path("guide"), headers=auth(), json={"rating": 1}).json()
    summary = client.post(path("summary"), headers=auth(), json={"rating": 5}).json()
    assert guide["id"] != summary["id"]
    assert client.get(path("guide"), headers=auth()).json()["items"] == [guide]
    assert client.get(path("summary"), headers=auth()).json()["items"] == [summary]


@pytest.mark.parametrize("method,url", [
    ("get", path("guide")), ("post", path("guide")),
    ("get", path("summary")), ("post", path("summary")),
    ("put", "/api/reviews/1"), ("delete", "/api/reviews/1"),
])
@pytest.mark.parametrize("headers", [{}, auth("expired"), {"Authorization": "Basic test"}])
def test_authentication(api, method, url, headers):
    client, _ = api
    response = getattr(client, method)(url, headers=headers)
    assert_error(response, 401, "AUTH_REQUIRED")
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("target_id", ["0", "-1", "+1", "1.0", "1e1", "2147483648", "a"])
def test_invalid_id(api, target_id):
    client, _ = api
    assert_error(client.get(f"/api/guides/{target_id}/reviews", headers=auth()),
                 422, "INVALID_PARAMETERS")


def test_protocol_validation(api):
    client, _ = api
    url = path("guide")
    assert_error(client.get(url + "?user_id=33", headers=auth()), 422, "INVALID_PARAMETERS")
    assert_error(client.request("GET", url, headers=auth(), content="{}"), 422, "INVALID_PARAMETERS")
    assert_error(client.request("DELETE", "/api/reviews/1", headers=auth(), content="{}"),
                 422, "INVALID_PARAMETERS")
    assert_error(client.post(url, headers=auth(), content="rating=5"), 415, "UNSUPPORTED_MEDIA_TYPE")
    assert_error(client.post(url, headers={**auth(), "Content-Type": "application/json"}, content="{"),
                 400, "MALFORMED_REQUEST")
    assert_error(client.post(url, headers={**auth(), "Content-Type": "application/json"}, content="x" * 32769),
                 413, "REQUEST_TOO_LARGE")
    assert_error(client.patch(url, headers=auth()), 405, "METHOD_NOT_ALLOWED")
    assert_error(client.get("/api/reviews/1/unknown", headers=auth()), 404, "ROUTE_NOT_FOUND")


@pytest.mark.parametrize("kind", ["guide", "summary"])
@pytest.mark.parametrize("method", ["create", "update_owned", "delete_owned"])
def test_storage_failure_rolls_back_mutations(api, kind, method):
    client, session = api
    url = path(kind)
    original = None
    if method != "create":
        original = client.post(url, headers=auth(), json={"rating": 4, "comment": "เดิม"}).json()
    real = getattr(ReviewDAO, method)

    def fail_after_write(dao, *args, **kwargs):
        real(dao, *args, **kwargs)
        raise SQLAlchemyError("injected failure after SQL, before commit")

    with patch.object(ReviewDAO, method, fail_after_write):
        if method == "create":
            response = client.post(url, headers=auth(), json={"rating": 5})
        elif method == "update_owned":
            response = client.put(f"/api/reviews/{original['id']}", headers=auth(), json={"rating": 1})
        else:
            response = client.delete(f"/api/reviews/{original['id']}", headers=auth())
        assert_error(response, 503, "STORAGE_UNAVAILABLE")
    items = client.get(url, headers=auth()).json()["items"]
    assert items == ([] if original is None else [original])


def test_read_and_commit_failures(api):
    client, session = api
    with patch.object(ReviewDAO, "list_for_target", side_effect=SQLAlchemyError("read fault")):
        assert_error(client.get(path("guide"), headers=auth()), 503, "STORAGE_UNAVAILABLE")
    with patch.object(session, "commit", side_effect=SQLAlchemyError("before commit")):
        assert_error(client.post(path("guide"), headers=auth(), json={"rating": 5}),
                     503, "STORAGE_UNAVAILABLE")
    assert session.scalar(select(func.count()).select_from(Review)) == 0


@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_removed_target_reviews_are_unavailable_in_sqlite(api, kind):
    client, session = api
    created = client.post(path(kind), headers=auth(), json={"rating": 5}).json()
    other_kind = "summary" if kind == "guide" else "guide"
    other = client.post(path(other_kind), headers=auth(), json={"rating": 4}).json()
    table = Guide.__table__ if kind == "guide" else summary_reference
    session.execute(table.delete().where(table.c.id == 42))
    session.rollback()
    assert client.get(path(kind), headers=auth()).json()["items"] == [created]
    session.execute(table.delete().where(table.c.id == 42))
    session.commit()
    assert_error(client.get(path(kind), headers=auth()), 404, f"{kind.upper()}_NOT_FOUND")
    assert_error(client.put(f"/api/reviews/{created['id']}", headers=auth(), json={"rating": 3}),
                 404, "REVIEW_NOT_FOUND")
    assert_error(client.delete(f"/api/reviews/{created['id']}", headers=auth()), 404, "REVIEW_NOT_FOUND")
    assert client.get(path(other_kind), headers=auth()).json()["items"] == [other]
