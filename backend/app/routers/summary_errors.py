import logging
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException

from app.schemas.guides import ErrorDetailDTO, ErrorFieldDTO, ErrorResponseDTO

logger = logging.getLogger(__name__)

ERRORS = {
    "MALFORMED_REQUEST": (400, "รูปแบบคำขอไม่ถูกต้อง"),
    "AUTH_REQUIRED": (401, "กรุณาเข้าสู่ระบบ"),
    "SUMMARY_FORBIDDEN": (403, "ไม่มีสิทธิ์จัดการสรุปนี้"),
    "SUMMARY_NOT_FOUND": (404, "ไม่พบสรุป"),
    "COURSE_NOT_FOUND": (404, "ไม่พบรายวิชา CS"),
    "PDF_TOO_LARGE": (413, "ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB"),
    "REQUEST_TOO_LARGE": (413, "คำขอมีขนาดใหญ่เกินกำหนด"),
    "UNSUPPORTED_MEDIA_TYPE": (415, "ชนิดข้อมูลของคำขอไม่ถูกต้อง"),
    "INVALID_PARAMETERS": (422, "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง"),
    "PDF_INVALID": (422, "ไฟล์ไม่ใช่ PDF ที่ถูกต้อง"),
    "PDF_UNREADABLE": (422, "ไม่สามารถเปิดอ่านไฟล์ PDF นี้ได้"),
    "INTERNAL_ERROR": (500, "เกิดข้อผิดพลาดภายในระบบ"),
    "STORAGE_UNAVAILABLE": (503, "ระบบจัดเก็บข้อมูลไม่พร้อมใช้งาน"),
}

DEFAULT_CODES = {
    400: "MALFORMED_REQUEST",
    401: "AUTH_REQUIRED",
    403: "SUMMARY_FORBIDDEN",
    404: "SUMMARY_NOT_FOUND",
    413: "REQUEST_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "INVALID_PARAMETERS",
    503: "STORAGE_UNAVAILABLE",
}


class SummaryApiRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original_handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                response = await original_handler(request)
            except RequestValidationError as error:
                fields = [
                    ErrorFieldDTO(
                        field=".".join(str(part) for part in item["loc"][1:]),
                        message=item["msg"],
                    )
                    for item in error.errors()
                ]
                response = _error_response("INVALID_PARAMETERS", fields=fields)
            except HTTPException as error:
                code = DEFAULT_CODES.get(error.status_code, "INTERNAL_ERROR")
                if (
                    isinstance(error.detail, str)
                    and error.detail in ERRORS
                    and ERRORS[error.detail][0] == error.status_code
                ):
                    code = error.detail
                response = _error_response(code, headers=error.headers)
            except Exception:
                logger.exception("Unexpected error in summary API")
                response = _error_response("INTERNAL_ERROR")

            response.headers["Cache-Control"] = "no-store"
            return response

        return handle


def _error_response(
    code: str,
    *,
    fields: list[ErrorFieldDTO] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    status_code, message = ERRORS[code]
    body = ErrorResponseDTO(
        error=ErrorDetailDTO(code=code, message=message, fields=fields or [])
    )
    response = JSONResponse(
        status_code=status_code, content=body.model_dump(), headers=headers
    )
    if status_code == 401:
        response.headers["WWW-Authenticate"] = "Bearer"
    return response
