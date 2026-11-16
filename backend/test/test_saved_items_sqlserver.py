import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db import Base, engine
from app.dependencies import current_user, get_db_session
from app.main import app
from app.models.course import Course
from app.models.guide import Guide
from app.models.summary import Summary
from app.models.user import User
from app.services.auth import AuthenticatedUser
from app.services.saved_items import SavedItemsService, TARGETS


@pytest.mark.skipif(os.getenv("U9_TEST_SQLSERVER") != "1", reason="Enable U9_TEST_SQLSERVER to test SQL Server")
@pytest.mark.parametrize("kind", ["guide", "summary"])
def test_concurrent_bookmark_put_and_target_deletion_on_sqlserver(kind):
    assert engine.dialect.name == "mssql"
    schema = f"u9_saved_test_{uuid4().hex}"
    target, bookmark = TARGETS[kind]
    tables = [model.__table__ for model in (User, Course, target, bookmark)]
    isolated = engine.execution_options(schema_translate_map={None: schema})
    sessions = sessionmaker(bind=isolated)
    original = SavedItemsService._state
    old_overrides = app.dependency_overrides.copy()

    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    try:
        Base.metadata.create_all(isolated, tables=tables)
        with sessions.begin() as session:
            user = User(username="u9_sqlserver_reader")
            course = Course(course_code="CS261", course_name="U9 SQL Server test")
            session.add_all((user, course))
            session.flush()
            user_id = user.id
            item = (
                Guide(course_id=course.id, publisher_id=user.id, title="Guide", academic_year=2569,
                      semester=1, exam_period="midterm", topics="Topics", exam_format="objective", objective_count=1)
                if kind == "guide"
                else Summary(course_id=course.id, owner_id=user.id, title="PDF")
            )
            session.add(item)
            session.flush()
            item_id = item.id

        def db_session():
            with sessions() as session:
                yield session

        app.dependency_overrides[get_db_session] = db_session
        app.dependency_overrides[current_user] = lambda: (
            "test-token", AuthenticatedUser(user_id, "u9_sqlserver_reader", "Student", "student")
        )
        url = f"/api/saved-items/{kind}/{item_id}"
        barrier = Barrier(2)

        def simultaneous_state(service, *args):
            saved = original(service, *args)
            if not saved:
                barrier.wait(timeout=10)
            return saved

        def put():
            with TestClient(app) as client:
                return client.put(url)

        with patch.object(SavedItemsService, "_state", simultaneous_state):
            with ThreadPoolExecutor(max_workers=2) as workers:
                responses = list(workers.map(lambda _: put(), range(2)))
        assert [(response.status_code, response.json()) for response in responses] == [
            (200, {"item_type": kind, "item_id": item_id, "saved": True})
        ] * 2
        with sessions() as session:
            assert session.scalar(select(func.count()).select_from(bookmark)) == 1

        def delete_after_state(service, *args):
            saved = original(service, *args)
            assert saved is False
            with sessions.begin() as session:
                session.execute(delete(target).where(target.id == item_id))
            return saved

        with TestClient(app) as client:
            assert client.delete(url).status_code == 200
            with patch.object(SavedItemsService, "_state", delete_after_state):
                missing = client.put(url)
            assert missing.status_code == 404, missing.text
            assert missing.json()["error"]["code"] == f"{kind.upper()}_NOT_FOUND"
            assert client.get(url).status_code == 404
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)
        Base.metadata.drop_all(isolated, tables=tables)
        with engine.begin() as connection:
            connection.execute(DropSchema(schema))
