import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient
from starlette.datastructures import FormData

from app.routers.my_summary_form import parse_summary_update_form
from app.routers.summary_errors import SummaryApiRoute


@pytest.fixture
def client():
    application = FastAPI()
    router = APIRouter(route_class=SummaryApiRoute)
    bearer = HTTPBearer(auto_error=False)

    def require_login(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ):
        if credentials is None or credentials.credentials != "synthetic-token":
            raise HTTPException(401, "Internal authentication detail")

    @router.get("/protected", dependencies=[Depends(require_login)])
    def protected():
        return {"items": []}

    @router.get("/validation/{summary_id}")
    def validation(summary_id: int = Path(gt=0)):
        return {"id": summary_id}

    @router.put("/invalid-form")
    def invalid_form():
        parse_summary_update_form(FormData([
            ("course_id", "1"), ("title", "Summary"), ("owner_id", "99"),
        ]))

    @router.get("/failure/{status_code}/{code}")
    def failure(status_code: int, code: str):
        raise HTTPException(status_code, code)

    @router.get("/unexpected")
    def unexpected():
        raise RuntimeError("SQL credentials and private storage path")

    @router.delete("/deleted", status_code=204)
    def deleted():
        return Response(status_code=204)

    application.include_router(router)
    with TestClient(application) as test_client:
        yield test_client


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
def test_authentication_errors_use_contract_and_bearer_challenge(client, headers):
    response = client.get("/protected", headers=headers)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "error": {"code": "AUTH_REQUIRED", "message": "กรุณาเข้าสู่ระบบ", "fields": []}
    }


def test_successful_private_response_cannot_be_cached(client):
    response = client.get(
        "/protected", headers={"Authorization": "Bearer synthetic-token"}
    )

    assert response.status_code == 200
    assert response.json() == {"items": []}
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("summary_id", ["0", "invalid"])
def test_path_validation_uses_field_errors_without_echoing_input(client, summary_id):
    response = client.get(f"/validation/{summary_id}")

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_PARAMETERS"
    assert error["fields"][0]["field"] == "summary_id"
    assert set(error["fields"][0]) == {"field", "message"}
    assert response.headers["Cache-Control"] == "no-store"


def test_multipart_part_errors_use_the_same_envelope(client):
    response = client.put("/invalid-form")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PARAMETERS"
    assert response.json()["error"]["fields"][0]["field"] == "owner_id"


@pytest.mark.parametrize(
    ("status_code", "code"),
    [
        (400, "MALFORMED_REQUEST"),
        (403, "SUMMARY_FORBIDDEN"),
        (404, "SUMMARY_NOT_FOUND"),
        (404, "COURSE_NOT_FOUND"),
        (413, "PDF_TOO_LARGE"),
        (413, "REQUEST_TOO_LARGE"),
        (415, "UNSUPPORTED_MEDIA_TYPE"),
        (422, "PDF_INVALID"),
        (422, "PDF_UNREADABLE"),
        (503, "STORAGE_UNAVAILABLE"),
    ],
)
def test_known_errors_keep_their_status_and_contract_code(client, status_code, code):
    response = client.get(f"/failure/{status_code}/{code}")

    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["fields"] == []
    assert response.headers["Cache-Control"] == "no-store"


def test_http_exception_detail_is_not_exposed(client):
    response = client.get("/failure/503/private-database-error")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "STORAGE_UNAVAILABLE"
    assert "private-database-error" not in response.text


def test_unexpected_failures_do_not_expose_internal_details(client):
    response = client.get("/unexpected")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert response.headers["Cache-Control"] == "no-store"
    assert "SQL credentials" not in response.text


def test_delete_success_remains_empty_with_no_store_header(client):
    response = client.delete("/deleted")

    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["Cache-Control"] == "no-store"
