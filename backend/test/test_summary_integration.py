import os
import unittest
from io import BytesIO
from tempfile import TemporaryDirectory
from uuid import uuid4

from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db import Base, engine as application_engine
from app.dependencies import get_auth_service, get_db_session, get_pdf_storage
from app.main import app
from app.models.course import Course
from app.models.summary import SummaryFile
from app.models.user import User
from app.services.auth import AuthenticatedUser
from app.services.summary_storage import LocalPdfStorage


class IntegrationAuthService:
    def __init__(self, user: AuthenticatedUser):
        self.user = user

    def get_user(self, token: str) -> AuthenticatedUser | None:
        return self.user if token == "task110-integration-token" else None


@unittest.skipUnless(
    os.getenv("TASK110_TEST_SQLSERVER") == "1",
    "Set TASK110_TEST_SQLSERVER=1 to run the SQL Server + private storage integration test.",
)
class SummarySqlServerIntegrationTests(unittest.TestCase):
    def test_publish_list_and_read_pdf_against_sql_server_and_local_storage(self):
        schema = "task110_" + uuid4().hex
        isolated_engine = None
        schema_connection = application_engine.connect()
        schema_created = False
        previous_overrides = {
            dependency: app.dependency_overrides.get(dependency)
            for dependency in (get_db_session, get_auth_service, get_pdf_storage)
        }
        previous_storage = getattr(app.state, "pdf_storage", None)

        try:
            schema_connection.execute(CreateSchema(schema))
            schema_connection.commit()
            schema_created = True
            isolated_engine = create_engine(
                application_engine.url, pool_pre_ping=True
            ).execution_options(schema_translate_map={None: schema})
            Base.metadata.create_all(isolated_engine)
            session_factory = sessionmaker(bind=isolated_engine)
            with session_factory() as session:
                course = Course(
                    course_code="CS110",
                    course_name="Task110 SQL Server integration",
                )
                user = User(username="task110_integration_owner")
                session.add_all((course, user))
                session.commit()
                course_id = course.id
                owner_id = user.id

            # create_all is additive: calling it again must preserve existing records.
            Base.metadata.create_all(isolated_engine)
            with session_factory() as session:
                self.assertEqual(
                    session.scalar(
                        select(func.count(Course.id)).where(
                            Course.course_code == "CS110"
                        )
                    ),
                    1,
                )

            def override_session():
                with session_factory() as session:
                    yield session

            with TemporaryDirectory(prefix="task110-pdf-") as storage_dir:
                storage = LocalPdfStorage(storage_dir)
                auth = IntegrationAuthService(
                    AuthenticatedUser(
                        owner_id,
                        "task110_integration_owner",
                        "Integration Owner",
                        "student",
                    )
                )
                app.state.pdf_storage = storage
                app.dependency_overrides[get_db_session] = override_session
                app.dependency_overrides[get_auth_service] = lambda: auth
                app.dependency_overrides[get_pdf_storage] = lambda: storage
                writer = PdfWriter()
                writer.add_blank_page(width=72, height=72)
                file_buffer = BytesIO()
                writer.write(file_buffer)

                with TestClient(app) as client:
                    headers = {
                        "Authorization": "Bearer task110-integration-token"
                    }
                    created = client.post(
                        "/api/summaries",
                        data={"course_id": str(course_id), "title": "SQL Server PDF"},
                        files={
                            "file": (
                                "integration.pdf",
                                file_buffer.getvalue(),
                                "application/pdf",
                            )
                        },
                        headers=headers,
                    )
                    self.assertEqual(created.status_code, 201, created.text)
                    summary_id = created.json()["id"]

                    listed = client.get(
                        f"/api/courses/{course_id}/summaries", headers=headers
                    )
                    self.assertEqual(listed.status_code, 200, listed.text)
                    self.assertEqual(
                        [item["id"] for item in listed.json()["items"]],
                        [summary_id],
                    )

                    opened = client.get(
                        f"/api/summaries/{summary_id}/file", headers=headers
                    )
                    self.assertEqual(opened.status_code, 200, opened.text)
                    self.assertTrue(opened.content.startswith(b"%PDF-"))
                    with session_factory() as session:
                        storage_key = session.scalar(
                            select(SummaryFile.storage_key).where(
                                SummaryFile.summary_id == summary_id
                            )
                        )
                    self.assertEqual(
                        list((storage.root).glob("[0-9a-f]*")),
                        [storage.root / storage_key],
                    )

        finally:
            for dependency, previous in previous_overrides.items():
                if previous is None:
                    app.dependency_overrides.pop(dependency, None)
                else:
                    app.dependency_overrides[dependency] = previous
            if previous_storage is not None:
                app.state.pdf_storage = previous_storage
            if isolated_engine is not None:
                Base.metadata.drop_all(isolated_engine)
                isolated_engine.dispose()
            if schema_created:
                schema_connection.execute(DropSchema(schema))
                schema_connection.commit()
            schema_connection.close()


if __name__ == "__main__":
    unittest.main()
