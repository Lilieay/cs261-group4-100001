import json
import logging
import re

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException

from app.dependencies import bearer_scheme, current_user, get_auth_service, get_db_session
from app.dao.review_dao import ReviewDAO
from app.schemas.reviews import ReviewDTO, ReviewListResponse, ReviewWriteRequest
from app.services.reviews import ReviewError, ReviewsService

logger = logging.getLogger(__name__)
HEADERS = {"Cache-Control": "no-store"}


def error(status, code, message, fields=None, headers=None):
    return JSONResponse(status_code=status, headers={**(headers or {}), **HEADERS},
                        content={"error": {"code": code, "message": message, "fields": fields or []}})


async def reviews_http_exception_handler(request, exc):
    path = request.url.path
    is_review_path = path.startswith("/api/reviews") or re.fullmatch(
        r"/api/(guides|summaries)/[^/]+/reviews/?", path)
    if is_review_path and exc.status_code in (404, 405):
        return error(exc.status_code,
                     "METHOD_NOT_ALLOWED" if exc.status_code == 405 else "ROUTE_NOT_FOUND",
                     "ไม่รองรับคำขอนี้", headers=exc.headers)
    return await http_exception_handler(request, exc)


class ReviewRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request):
            try:
                # Authenticate before exposing validation or target information.
                current_user(await bearer_scheme(request), get_auth_service(request))
                fields = []
                for key, value in request.path_params.items():
                    if not re.fullmatch(r"[0-9]{1,10}", value) or not 1 <= int(value) <= 2_147_483_647:
                        fields.append({"field": key, "message": "กรุณาระบุ ID จำนวนเต็มบวก"})
                if request.query_params:
                    fields.extend({"field": key, "message": "ไม่รองรับ query parameter"}
                                  for key in request.query_params)
                if fields:
                    return error(422, "INVALID_PARAMETERS", "ข้อมูลไม่ถูกต้อง", fields)
                size = 0
                chunks = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 32768:
                        return error(413, "REQUEST_TOO_LARGE", "คำขอมีขนาดเกินกำหนด")
                    chunks.append(chunk)
                # Starlette's body cache is populated explicitly after bounded reading.
                # stream() is consumed, so retain the bytes for FastAPI JSON parsing.
                request._body = b"".join(chunks)
                if request.method in ("GET", "DELETE"):
                    if size:
                        return error(422, "INVALID_PARAMETERS", "เส้นทางนี้ไม่รับ body",
                                     [{"field": "body", "message": "ไม่รับ body"}])
                else:
                    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                        return error(415, "UNSUPPORTED_MEDIA_TYPE", "กรุณาส่ง application/json")
                    if size:
                        # Decode before JSON parsing: json.loads(bytes) otherwise
                        # auto-detects UTF-16/32, outside the UTF-8 contract.
                        # Cache the parsed value for FastAPI's request.json().
                        request._json = json.loads(request._body.decode("utf-8"))
                response = await original(request)
                response.headers.update(HEADERS)
                return response
            except ReviewError as exc:
                return error(exc.status, exc.code, exc.message)
            except RequestValidationError as exc:
                malformed = any(item["type"] == "json_invalid" for item in exc.errors())
                return error(400 if malformed else 422,
                             "MALFORMED_REQUEST" if malformed else "INVALID_PARAMETERS",
                             "ข้อมูลคำขอไม่ถูกต้อง",
                             [] if malformed else [{"field": ".".join(map(str, item["loc"][1:])),
                                                     "message": item["msg"]} for item in exc.errors()])
            except HTTPException as exc:
                return error(exc.status_code, "AUTH_REQUIRED" if exc.status_code == 401 else "INVALID_PARAMETERS",
                             "กรุณาเข้าสู่ระบบ" if exc.status_code == 401 else "ข้อมูลคำขอไม่ถูกต้อง",
                             headers=exc.headers)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return error(400, "MALFORMED_REQUEST", "JSON ไม่ถูกต้อง")
            except Exception:
                logger.exception("Unexpected review API error")
                return error(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ")
        return handle


def get_reviews_service(session=Depends(get_db_session)):
    return ReviewsService(session, ReviewDAO(session))


router = APIRouter(prefix="/api", tags=["reviews"], route_class=ReviewRoute)


@router.get("/guides/{guide_id}/reviews", response_model=ReviewListResponse)
def list_guide_reviews(guide_id: str, service=Depends(get_reviews_service)):
    return service.list_for_target("guide", int(guide_id))


@router.get("/summaries/{summary_id}/reviews", response_model=ReviewListResponse)
def list_summary_reviews(summary_id: str, service=Depends(get_reviews_service)):
    return service.list_for_target("summary", int(summary_id))


@router.post("/guides/{guide_id}/reviews", status_code=201, response_model=ReviewDTO)
def create_guide_review(guide_id: str, payload: ReviewWriteRequest,
                        context=Depends(current_user), service=Depends(get_reviews_service)):
    return service.create("guide", int(guide_id), context[1].id, payload)


@router.post("/summaries/{summary_id}/reviews", status_code=201, response_model=ReviewDTO)
def create_summary_review(summary_id: str, payload: ReviewWriteRequest,
                          context=Depends(current_user), service=Depends(get_reviews_service)):
    return service.create("summary", int(summary_id), context[1].id, payload)


@router.put("/reviews/{review_id}", response_model=ReviewDTO)
def update_review(review_id: str, payload: ReviewWriteRequest,
                  context=Depends(current_user), service=Depends(get_reviews_service)):
    return service.write(int(review_id), context[1].id, payload)


@router.delete("/reviews/{review_id}", status_code=204)
def delete_review(review_id: str, context=Depends(current_user), service=Depends(get_reviews_service)):
    service.write(int(review_id), context[1].id)
    return Response(status_code=204, headers=HEADERS)
