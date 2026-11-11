from io import BytesIO

import pytest
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import FormData, Headers, UploadFile

from app.routers.my_summary_form import parse_summary_update_form


def pdf_upload() -> UploadFile:
    return UploadFile(
        BytesIO(b"PDF bytes are validated by the shared PDF layer"),
        filename="summary.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )


def test_metadata_only_update_leaves_file_replacement_absent():
    metadata, upload = parse_summary_update_form(
        FormData([("course_id", "2"), ("title", "  Updated summary  ")])
    )

    assert metadata.course_id == 2
    assert metadata.title == "Updated summary"
    assert metadata.description is None
    assert upload is None


def test_file_part_is_returned_unchanged_without_reading_or_closing():
    replacement = pdf_upload()
    metadata, upload = parse_summary_update_form(
        FormData([
            ("course_id", "2"), ("title", "Summary"),
            ("description", "  Advice  "), ("file", replacement),
        ])
    )

    assert metadata.description == "Advice"
    assert upload is replacement
    assert replacement.file.tell() == 0
    assert not replacement.file.closed


@pytest.mark.parametrize("field", ["course_id", "title", "description", "file"])
def test_duplicate_parts_are_rejected_instead_of_selecting_one_value(field):
    parts = [("course_id", "1"), ("title", "Summary")]
    if field in ("course_id", "title"):
        parts.append((field, "2"))
    else:
        first = pdf_upload() if field == "file" else "first"
        second = pdf_upload() if field == "file" else "second"
        parts.extend([(field, first), (field, second)])

    with pytest.raises(RequestValidationError) as error:
        parse_summary_update_form(FormData(parts))

    assert error.value.errors()[0]["loc"] == ("body", field)


@pytest.mark.parametrize(
    "field", ["owner_id", "user_id", "owner", "file_key", "type", "extra_file"],
)
def test_undeclared_parts_are_rejected(field):
    with pytest.raises(RequestValidationError) as error:
        parse_summary_update_form(FormData([
            ("course_id", "1"), ("title", "Summary"), (field, "forged"),
        ]))

    assert error.value.errors()[0]["loc"] == ("body", field)


@pytest.mark.parametrize("field", ["course_id", "title", "description"])
def test_file_parts_cannot_replace_text_fields(field):
    parts = {"course_id": "1", "title": "Summary", field: pdf_upload()}

    with pytest.raises(RequestValidationError) as error:
        parse_summary_update_form(FormData(parts))

    assert error.value.errors()[0]["loc"] == ("body", field)


@pytest.mark.parametrize("value", ["", "summary.pdf", "null"])
def test_text_file_part_is_not_treated_as_an_absent_upload(value):
    with pytest.raises(RequestValidationError) as error:
        parse_summary_update_form(FormData([
            ("course_id", "1"), ("title", "Summary"), ("file", value),
        ]))

    assert error.value.errors()[0]["loc"] == ("body", "file")


@pytest.mark.parametrize(
    ("parts", "field"),
    [
        ([("course_id", "1")], "title"),
        ([("title", "Summary")], "course_id"),
        ([("course_id", "1"), ("title", "   ")], "title"),
        ([("course_id", "1.5"), ("title", "Summary")], "course_id"),
    ],
)
def test_schema_errors_identify_the_form_field(parts, field):
    with pytest.raises(RequestValidationError) as error:
        parse_summary_update_form(FormData(parts))

    assert error.value.errors()[0]["loc"] == ("body", field)
    assert "input" not in error.value.errors()[0]
