import logging
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.guides import ErrorDetailDTO, ErrorFieldDTO, ErrorResponseDTO
from app.services.pdf_validator import PdfValidationError
from app.services.summaries import (
    SummaryCourseNotFound,
    SummaryNotFound,
    SummaryStorageUnavailable,
)


logger = logging.getLogger(__name__)


class SummaryApiRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original_handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await original_handler(request)
            except SummaryCourseNotFound:
                return error_response(404, "COURSE_NOT_FOUND", "ไม่พบรายวิชา CS")
            except SummaryNotFound:
                return error_response(404, "SUMMARY_NOT_FOUND", "ไม่พบสรุป")
            except PdfValidationError as error:
                return error_response(error.status_code, error.code, error.message)
            except SummaryStorageUnavailable:
                return error_response(
                    503,
                    "STORAGE_UNAVAILABLE",
                    "ไม่สามารถจัดเก็บหรืออ่านข้อมูลสรุปได้ในขณะนี้",
                )
            except StarletteHTTPException as error:
                return _http_error(error)
            except RequestValidationError as error:
                fields = [
                    ErrorFieldDTO(
                        field=".".join(str(part) for part in detail["loc"][1:]),
                        message=detail["msg"],
                    )
                    for detail in error.errors()
                ]
                return error_response(
                    422,
                    "INVALID_PARAMETERS",
                    "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง",
                    fields,
                )
            except Exception:
                logger.exception("Unexpected error in U6 summary API")
                return error_response(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ")

        return handle


def error_response(
    status_code: int,
    code: str,
    message: str,
    fields: list[ErrorFieldDTO] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponseDTO(
        error=ErrorDetailDTO(code=code, message=message, fields=fields or [])
    )
    return JSONResponse(
        content=body.model_dump(), status_code=status_code, headers=headers
    )


def _http_error(error: StarletteHTTPException) -> JSONResponse:
    if error.status_code == 401:
        return error_response(
            401,
            "AUTH_REQUIRED",
            "กรุณาเข้าสู่ระบบก่อนใช้งาน",
            headers=error.headers,
        )
    if error.status_code == 404:
        return error_response(404, "SUMMARY_NOT_FOUND", "ไม่พบสรุป")
    if error.status_code == 413:
        return error_response(413, "REQUEST_TOO_LARGE", "คำขอมีขนาดใหญ่เกินกำหนด")
    return error_response(
        error.status_code,
        "INVALID_PARAMETERS" if error.status_code == 422 else "INTERNAL_ERROR",
        "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง"
        if error.status_code == 422
        else "เกิดข้อผิดพลาดภายในระบบ",
        headers=error.headers,
    )
