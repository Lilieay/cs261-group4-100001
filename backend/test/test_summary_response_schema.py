import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.summaries import SummaryDTO, SummaryListResponseDTO


@pytest.fixture
def summary_payload():
    return {
        "id": 101,
        "course": {
            "id": 2,
            "course_code": "CS104",
            "course_name": "Introduction to Programming",
        },
        "title": "Updated summary",
        "description": None,
        "owner": {"id": 11, "display_name": "Test author"},
        "file": {
            "original_name": "summary.pdf",
            "content_type": "application/pdf",
            "size_bytes": 15000000,
            "read_path": "/api/summaries/101/file",
        },
        "created_at": "2026-11-11T10:00:00+07:00",
        "updated_at": "2026-11-11T12:00:00+07:00",
    }


def test_response_filters_private_storage_and_account_data(summary_payload):
    summary_payload["file_key"] = "private/object-key"
    summary_payload["owner"]["username"] = "private-account"
    summary_payload["owner"]["token"] = "synthetic-secret"
    summary_payload["file"]["storage_path"] = "private/files/summary.pdf"
    application = FastAPI()

    @application.get("/summary", response_model=SummaryDTO)
    def summary():
        return summary_payload

    with TestClient(application) as client:
        response = client.get("/summary")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "id", "course", "title", "description", "owner", "file",
        "created_at", "updated_at",
    }
    assert body["owner"] == {"id": 11, "display_name": "Test author"}
    assert body["file"] == {
        "original_name": "summary.pdf",
        "content_type": "application/pdf",
        "size_bytes": 15000000,
        "read_path": "/api/summaries/101/file",
    }
    assert body["description"] is None


def test_response_serializes_dates_in_utc(summary_payload):
    result = SummaryDTO.model_validate(summary_payload).model_dump(mode="json")

    assert result["created_at"] == "2026-11-11T03:00:00Z"
    assert result["updated_at"] == "2026-11-11T05:00:00Z"


def test_dates_without_a_timezone_require_explicit_mapping(summary_payload):
    summary_payload["created_at"] = "2026-11-11T03:00:00"

    with pytest.raises(ValidationError):
        SummaryDTO.model_validate(summary_payload)


def test_empty_list_is_a_successful_empty_result():
    assert SummaryListResponseDTO(items=[]).model_dump() == {"items": []}


@pytest.mark.parametrize(
    "path",
    [
        "https://files.example/summary.pdf",
        "/private/summary.pdf",
        "/api/summaries/101/file?token=synthetic-secret",
    ],
)
def test_file_link_cannot_expose_a_public_url_or_token(summary_payload, path):
    summary_payload["file"]["read_path"] = path

    with pytest.raises(ValidationError):
        SummaryDTO.model_validate(summary_payload)
