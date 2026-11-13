import unittest
from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import PDF_REQUEST_MAX_BYTES
from app.db import Base
from app.dependencies import get_auth_service, get_db_session, get_pdf_storage
from app.main import app
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.services.auth import AuthService, AuthenticatedUser
from app.services.summaries import SummaryStorageUnavailable
from app.services.summary_storage import PrivatePdfMetadata
from app.services.tu_api import TUAccount


class MemoryPdfStorage:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.queued: list[str] = []
        self.reconciliation: list[str] = []
        self.fail_put = False
        self.fail_delete = False

    def put_private(self, key: str, content: bytes) -> PrivatePdfMetadata:
        if self.fail_put:
            raise OSError("simulated storage put failure")
        self.files[key] = content
        return PrivatePdfMetadata(key, "application/pdf", len(content))

    def verify_private(self, key: str, expected_size: int) -> PrivatePdfMetadata:
        content = self.files[key]
        if len(content) != expected_size:
            raise OSError("verification failed")
        return PrivatePdfMetadata(key, "application/pdf", len(content))

    def open_private(self, key: str):
        try:
            return BytesIO(self.files[key])
        except KeyError as error:
            raise OSError("missing file") from error

    def delete_private(self, key: str) -> None:
        if self.fail_delete:
            raise OSError("simulated storage delete failure")
        self.files.pop(key, None)

    def queue_cleanup(self, key: str) -> None:
        self.queued.append(key)

    def queue_reconciliation(self, key: str) -> None:
        self.reconciliation.append(key)

    def retry_pending_cleanup(self) -> int:
        return 0


def make_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class SummaryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        event.listen(cls.engine, "connect", cls._enable_sqlite_foreign_keys)
        Base.metadata.create_all(cls.engine)
        cls.session_factory = sessionmaker(bind=cls.engine)
        cls.client = TestClient(app)
        cls.previous_overrides = {
            dependency: app.dependency_overrides.get(dependency)
            for dependency in (get_db_session, get_auth_service, get_pdf_storage)
        }
        cls.previous_storage = getattr(app.state, "pdf_storage", None)

        def override_session():
            with cls.session_factory() as session:
                yield session

        app.dependency_overrides[get_db_session] = override_session
        cls.storage = MemoryPdfStorage()
        app.state.pdf_storage = cls.storage
        app.dependency_overrides[get_pdf_storage] = lambda: cls.storage
        with cls.session_factory() as session:
            session.add_all(
                [
                    Course(course_code="CS261", course_name="Software Engineering"),
                    Course(course_code="CS104", course_name="Programming"),
                    Course(course_code="MA111", course_name="Mathematics"),
                ]
            )
            session.commit()
            cls.cs_course_id = session.scalar(
                select(Course.id).where(Course.course_code == "CS261")
            )
            cls.empty_course_id = session.scalar(
                select(Course.id).where(Course.course_code == "CS104")
            )
            cls.non_cs_course_id = session.scalar(
                select(Course.id).where(Course.course_code == "MA111")
            )

    @classmethod
    def _enable_sqlite_foreign_keys(cls, connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    @classmethod
    def tearDownClass(cls):
        for dependency, previous in cls.previous_overrides.items():
            if previous is None:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous
        if cls.previous_storage is not None:
            app.state.pdf_storage = cls.previous_storage
        cls.engine.dispose()

    def setUp(self):
        with self.session_factory() as session:
            session.execute(SummaryFile.__table__.delete())
            session.execute(Summary.__table__.delete())
            session.execute(User.__table__.delete())
            session.commit()
        self.storage = MemoryPdfStorage()
        app.state.pdf_storage = self.storage
        app.dependency_overrides[get_pdf_storage] = lambda: self.storage
        self.auth_service = AuthService(
            self.session_factory,
            verify=lambda username, password: (
                TUAccount(username, "U6 Student", "student", True)
                if password == "0000000000000"
                else None
            ),
        )
        app.dependency_overrides[get_auth_service] = lambda: self.auth_service

    def tearDown(self):
        app.dependency_overrides[get_pdf_storage] = lambda: type(self).storage

    def headers_for(self, username="u6_student"):
        response = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "0000000000000"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.user_id = response.json()["user"]["id"]
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def publish(self, headers, **overrides):
        data = {
            "course_id": str(self.cs_course_id),
            "title": "สรุป Task110",
            "description": "เนื้อหาทดสอบ",
            "owner_id": "999999",
        }
        data.update(overrides)
        return self.client.post(
            "/api/summaries",
            data=data,
            files={"file": ("summary.pdf", make_pdf(), "application/pdf")},
            headers=headers,
        )

    def test_publish_list_detail_and_open_pdf_end_to_end_with_mock_storage(self):
        headers = self.headers_for()
        created = self.publish(headers)

        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(body["title"], "สรุป Task110")
        self.assertEqual(body["created_at"], body["updated_at"])
        self.assertEqual(body["course"]["course_code"], "CS261")
        self.assertEqual(body["owner"]["id"], self.user_id)
        self.assertEqual(body["file"]["content_type"], "application/pdf")
        self.assertTrue(body["file"]["read_path"].endswith("/file"))
        summary_id = body["id"]

        listed = self.client.get(
            f"/api/courses/{self.cs_course_id}/summaries", headers=headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item["id"] for item in listed.json()["items"]], [summary_id])

        detail = self.client.get(f"/api/summaries/{summary_id}", headers=headers)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["id"], summary_id)

        opened = self.client.get(
            f"/api/summaries/{summary_id}/file", headers=headers
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.headers["content-type"], "application/pdf")
        self.assertEqual(opened.headers["cache-control"], "private, no-store")
        self.assertTrue(opened.content.startswith(b"%PDF-"))
        self.assertNotIn("storage_key", created.text)

    def test_list_returns_empty_items_for_course_without_summaries(self):
        response = self.client.get(
            f"/api/courses/{self.empty_course_id}/summaries",
            headers=self.headers_for("u6_empty"),
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"course_id": self.empty_course_id, "items": []})

    def test_all_routes_require_a_valid_login(self):
        requests = [
            self.client.post(
                "/api/summaries",
                data={"course_id": self.cs_course_id, "title": "x"},
                files={"file": ("x.pdf", make_pdf(), "application/pdf")},
            ),
            self.client.get(f"/api/courses/{self.cs_course_id}/summaries"),
            self.client.get("/api/summaries/1"),
            self.client.get("/api/summaries/1/file"),
        ]
        for response in requests:
            with self.subTest(status=response.status_code):
                self.assertEqual(response.status_code, 401, response.text)
                self.assertEqual(response.json()["error"]["code"], "AUTH_REQUIRED")

    def test_rejects_invalid_fields_files_and_course_scope(self):
        headers = self.headers_for("u6_invalid")
        cases = [
            (self.publish(headers, title="   "), 422, "INVALID_PARAMETERS"),
            (self.publish(headers, title="x" * 201), 422, "INVALID_PARAMETERS"),
            (
                self.client.post(
                    "/api/summaries",
                    data={"course_id": str(self.cs_course_id), "title": "x"},
                    files={"file": ("fake.pdf", b"not a PDF", "application/pdf")},
                    headers=headers,
                ),
                422,
                "PDF_INVALID",
            ),
            (
                self.client.post(
                    "/api/summaries",
                    data={"course_id": str(self.cs_course_id), "title": "x"},
                    files={"file": ("real.txt", make_pdf(), "application/pdf")},
                    headers=headers,
                ),
                422,
                "PDF_INVALID",
            ),
        ]
        for response, status_code, code in cases:
            with self.subTest(code=code, status=status_code):
                self.assertEqual(response.status_code, status_code, response.text)
                self.assertEqual(response.json()["error"]["code"], code)

        for course_id in (999999, self.non_cs_course_id):
            response = self.publish(headers, course_id=str(course_id))
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json()["error"]["code"], "COURSE_NOT_FOUND")

        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(Summary.id))), 0)

    def test_rejects_missing_fields_and_spoofed_owner_is_ignored(self):
        headers = self.headers_for("u6_form")
        missing = self.client.post(
            "/api/summaries",
            data={"course_id": str(self.cs_course_id)},
            files={"file": ("summary.pdf", make_pdf(), "application/pdf")},
            headers=headers,
        )
        self.assertEqual(missing.status_code, 422, missing.text)
        self.assertEqual(missing.json()["error"]["code"], "INVALID_PARAMETERS")

        response = self.publish(headers, owner_id="999999")
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["owner"]["id"], self.user_id)

    def test_storage_failure_does_not_create_summary_rows(self):
        headers = self.headers_for("u6_storage_failure")
        self.storage.fail_put = True

        response = self.publish(headers)

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["error"]["code"], "STORAGE_UNAVAILABLE")
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(Summary.id))), 0)

    def test_sql_failure_rolls_back_and_compensates_file(self):
        headers = self.headers_for("u6_sql_failure")
        with patch(
            "app.services.summaries.SummaryFileDAO.create",
            side_effect=RuntimeError("simulated SQL failure"),
        ):
            response = self.publish(headers)

        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(self.storage.files, {})
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(Summary.id))), 0)

    def test_commit_failure_rolls_back_and_compensates_file(self):
        headers = self.headers_for("u6_commit_failure")
        with patch(
            "app.services.summaries.SummaryFileDAO.create",
            side_effect=SQLAlchemyError("simulated SQL write failure"),
        ):
            response = self.publish(headers)

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(self.storage.files, {})
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(Summary.id))), 0)

    def test_failed_file_compensation_is_queued_and_stays_private(self):
        headers = self.headers_for("u6_cleanup_failure")
        self.storage.fail_delete = True
        with patch(
            "app.services.summaries.SummaryFileDAO.create",
            side_effect=SQLAlchemyError("simulated SQL write failure"),
        ):
            response = self.publish(headers)

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["error"]["code"], "STORAGE_UNAVAILABLE")
        self.assertEqual(len(self.storage.files), 1)
        self.assertEqual(len(self.storage.queued), 1)
        with self.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count(Summary.id))), 0)

    def test_uncertain_sql_commit_keeps_file_and_queues_reconciliation(self):
        headers = self.headers_for("u6_uncertain_commit")
        with (
            patch(
                "app.services.summaries.SummaryFileDAO.create",
                side_effect=SQLAlchemyError("simulated uncertain commit"),
            ),
            patch(
                "app.services.summaries.SummaryFileDAO.get_by_storage_key",
                side_effect=SQLAlchemyError("simulated SQL lookup failure"),
            ),
        ):
            response = self.publish(headers)

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(len(self.storage.files), 1)
        self.assertEqual(len(self.storage.reconciliation), 1)
        self.assertEqual(self.storage.queued, [])

    def test_missing_summary_details_and_pdf_return_not_found(self):
        headers = self.headers_for("u6_missing")
        for path in ("/api/summaries/999999", "/api/summaries/999999/file"):
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json()["error"]["code"], "SUMMARY_NOT_FOUND")

    def test_missing_private_object_returns_storage_unavailable(self):
        headers = self.headers_for("u6_missing_object")
        created = self.publish(headers)
        self.assertEqual(created.status_code, 201, created.text)
        self.storage.files.clear()

        response = self.client.get(
            created.json()["file"]["read_path"], headers=headers
        )

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(
            response.json()["error"]["code"], "STORAGE_UNAVAILABLE"
        )

    def test_over_limit_request_is_rejected_before_form_parsing(self):
        headers = self.headers_for("u6_too_large")
        response = self.client.post(
            "/api/summaries",
            headers={
                **headers,
                "Content-Length": str(PDF_REQUEST_MAX_BYTES + 1),
            },
        )
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(response.json()["error"]["code"], "REQUEST_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
