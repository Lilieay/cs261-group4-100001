import os
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db import Base, engine as application_engine
from app.dependencies import current_user, get_db_session
from app.main import app
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.services.auth import AuthenticatedUser


@unittest.skipUnless(
    os.getenv("TASK116_TEST_SQLSERVER") == "1",
    "Set TASK116_TEST_SQLSERVER=1 to run saved-items SQL Server integration tests.",
)
class SavedItemsSqlServerIntegrationTests(unittest.TestCase):
    def test_save_and_read_guide_and_summary_relations_on_sql_server(self):
        schema = "task116_saved_" + uuid4().hex
        connection = application_engine.connect()
        isolated_engine = None
        schema_created = False
        previous = {
            dependency: app.dependency_overrides.get(dependency)
            for dependency in (current_user, get_db_session)
        }
        try:
            connection.execute(CreateSchema(schema))
            connection.commit()
            schema_created = True
            isolated_engine = create_engine(
                application_engine.url, pool_pre_ping=True
            ).execution_options(schema_translate_map={None: schema})
            Base.metadata.create_all(isolated_engine)
            sessions = sessionmaker(bind=isolated_engine)
            with sessions.begin() as session:
                user = User(username="task116_integration_user")
                course = Course(
                    course_code="CS116",
                    course_name="Task116 saved-items integration",
                )
                session.add_all([user, course])
                session.flush()
                guide = Guide(
                    course_id=course.id,
                    publisher_id=user.id,
                    title="Integration guide",
                    academic_year=2568,
                    semester=1,
                    exam_period="midterm",
                    topics="Integration topics",
                    exam_format="mixed",
                    subjective_count=2,
                    objective_count=10,
                )
                summary = Summary(
                    course_id=course.id,
                    owner_id=user.id,
                    title="Integration summary",
                )
                session.add_all([guide, summary])
                session.flush()
                session.add(
                    SummaryFile(
                        summary_id=summary.id,
                        storage_key=uuid4().hex,
                        original_name="integration.pdf",
                        content_type="application/pdf",
                        size_bytes=10,
                    )
                )
                user_id, guide_id, summary_id = user.id, guide.id, summary.id

            def override_session():
                with sessions() as session:
                    yield session

            app.dependency_overrides[current_user] = lambda: (
                "task116-test-token",
                AuthenticatedUser(
                    user_id,
                    "task116_integration_user",
                    "Integration User",
                    "student",
                ),
            )
            app.dependency_overrides[get_db_session] = override_session
            with TestClient(app) as client:
                headers = {"Authorization": "Bearer task116-test-token"}
                for item_type, item_id in (
                    ("guide", guide_id),
                    ("summary", summary_id),
                ):
                    path = f"/api/saved-items/{item_type}/{item_id}"
                    self.assertEqual(client.get(path, headers=headers).json()["saved"], False)
                    first = client.put(path, headers=headers)
                    repeated = client.put(path, headers=headers)
                    self.assertEqual(first.status_code, 200, first.text)
                    self.assertEqual(first.json(), repeated.json())
                    self.assertEqual(first.json()["saved"], True)

            with sessions() as session:
                self.assertEqual(
                    session.scalar(
                        select(func.count(SavedGuide.user_id)).where(
                            SavedGuide.user_id == user_id,
                            SavedGuide.guide_id == guide_id,
                        )
                    ),
                    1,
                )
                self.assertEqual(
                    session.scalar(
                        select(func.count(SavedSummary.user_id)).where(
                            SavedSummary.user_id == user_id,
                            SavedSummary.summary_id == summary_id,
                        )
                    ),
                    1,
                )
        finally:
            for dependency, override in previous.items():
                if override is None:
                    app.dependency_overrides.pop(dependency, None)
                else:
                    app.dependency_overrides[dependency] = override
            if isolated_engine is not None:
                Base.metadata.drop_all(isolated_engine)
                if isolated_engine is not application_engine:
                    isolated_engine.dispose()
            if schema_created:
                connection.execute(DropSchema(schema))
                connection.commit()
            connection.close()


if __name__ == "__main__":
    unittest.main()
