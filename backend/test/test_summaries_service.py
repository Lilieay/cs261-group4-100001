from unittest.mock import MagicMock

import pytest

from app.services.auth import AuthenticatedUser
from app.services.pdf_validator import PdfValidationError
from app.services.summaries import SummaryCourseNotFound, SummaryService


@pytest.mark.parametrize(
    ("title", "description"),
    [
        ("   ", None),
        ("x" * 201, None),
        ("valid title", "x" * 2001),
    ],
    ids=["blank-title", "title-too-long", "description-too-long"],
)
def test_service_rejects_invalid_text_before_storage_or_database_writes(
    title, description
):
    session = MagicMock()
    course_dao = MagicMock()
    user_dao = MagicMock()
    summary_dao = MagicMock()
    file_dao = MagicMock()
    storage = MagicMock()
    service = SummaryService(
        session,
        course_dao,
        user_dao,
        summary_dao,
        file_dao,
        storage,
    )

    with pytest.raises(PdfValidationError) as error:
        service.publish(
            course_id=1,
            title=title,
            description=description,
            filename="summary.pdf",
            content_type="application/pdf",
            content=b"unused-invalid-input",
            authenticated_user=AuthenticatedUser(1, "student", "Student", "student"),
        )

    assert error.value.code == "INVALID_PARAMETERS"
    course_dao.get_cs_by_id.assert_not_called()
    user_dao.get_by_username.assert_not_called()
    storage.put_private.assert_not_called()
    summary_dao.create.assert_not_called()


def test_service_rejects_course_outside_cs_scope_before_storing_file():
    session = MagicMock()
    course_dao = MagicMock()
    course_dao.get_cs_by_id.return_value = None
    storage = MagicMock()
    validator = MagicMock()
    validator.validate.return_value = "summary.pdf"
    service = SummaryService(
        session,
        course_dao,
        MagicMock(),
        MagicMock(),
        MagicMock(),
        storage,
        validator,
    )

    with pytest.raises(SummaryCourseNotFound):
        service.publish(
            course_id=777,
            title="Valid title",
            description=None,
            filename="summary.pdf",
            content_type="application/pdf",
            content=b"valid file not needed",
            authenticated_user=AuthenticatedUser(7, "student", "Student", "student"),
        )

    storage.put_private.assert_not_called()
    session.rollback.assert_not_called()
