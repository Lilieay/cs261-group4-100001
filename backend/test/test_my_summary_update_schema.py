import pytest
from pydantic import ValidationError

from app.schemas.my_summary_update import MySummaryUpdateRequest


def test_update_accepts_course_change_and_normalizes_text():
    request = MySummaryUpdateRequest(
        course_id="2", title="  สรุปฉบับใหม่  ", description="  คำแนะนำ  "
    )

    assert request.model_dump() == {
        "course_id": 2,
        "title": "สรุปฉบับใหม่",
        "description": "คำแนะนำ",
    }


@pytest.mark.parametrize("description", [None, "", " \t\n"])
def test_empty_description_clears_optional_information(description):
    request = MySummaryUpdateRequest(
        course_id="1", title="Summary", description=description
    )

    assert request.description is None


def test_omitted_description_clears_optional_information():
    request = MySummaryUpdateRequest(course_id="1", title="Summary")

    assert request.description is None


def test_literal_null_is_text_not_a_clear_command():
    request = MySummaryUpdateRequest(
        course_id="1", title="Summary", description="null"
    )

    assert request.description == "null"


@pytest.mark.parametrize("course_id", [1, "1", "0001", "2147483647"])
def test_supported_course_ids(course_id):
    request = MySummaryUpdateRequest(course_id=course_id, title="Summary")

    assert request.course_id == int(course_id)


@pytest.mark.parametrize(
    "course_id",
    [
        0, -1, True, False, 1.0, None, "", "0", "-1", "+1", "1.0",
        "1e2", " 1", "1 ", "๑", "2147483648", "9" * 5000,
    ],
)
def test_invalid_course_ids_are_rejected(course_id):
    with pytest.raises(ValidationError) as error:
        MySummaryUpdateRequest(course_id=course_id, title="Summary")

    assert error.value.errors()[0]["loc"] == ("course_id",)


@pytest.mark.parametrize("title", ["", " \t\n", "ก" * 201, None, 123])
def test_invalid_titles_are_rejected(title):
    with pytest.raises(ValidationError) as error:
        MySummaryUpdateRequest(course_id="1", title=title)

    assert error.value.errors()[0]["loc"] == ("title",)


def test_text_limits_apply_after_trimming_and_count_unicode_characters():
    request = MySummaryUpdateRequest(
        course_id="1", title=" " + "ก" * 200 + " ",
        description=" " + "ก" * 2000 + " ",
    )

    assert len(request.title) == 200
    assert len(request.description) == 2000


@pytest.mark.parametrize("description", ["ก" * 2001, 123, True])
def test_invalid_descriptions_are_rejected(description):
    with pytest.raises(ValidationError) as error:
        MySummaryUpdateRequest(
            course_id="1", title="Summary", description=description
        )

    assert error.value.errors()[0]["loc"] == ("description",)


@pytest.mark.parametrize(
    "field", ["owner_id", "user_id", "owner", "id", "file_key", "type",
              "created_at", "updated_at"],
)
def test_owner_spoofing_and_undeclared_metadata_are_rejected(field):
    with pytest.raises(ValidationError) as error:
        MySummaryUpdateRequest.model_validate(
            {"course_id": "1", "title": "Summary", field: "unexpected"}
        )

    assert error.value.errors()[0]["loc"] == (field,)
    assert error.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("missing", ["course_id", "title"])
def test_required_metadata_cannot_be_omitted(missing):
    payload = {"course_id": "1", "title": "Summary"}
    del payload[missing]

    with pytest.raises(ValidationError) as error:
        MySummaryUpdateRequest.model_validate(payload)

    assert error.value.errors()[0]["loc"] == (missing,)
