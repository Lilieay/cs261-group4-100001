import logging
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.http_errors import error_response
from app.schemas.errors import ErrorFieldDTO
from app.services.courses import CourseNotFound

logger = logging.getLogger(__name__)


class CourseApiRoute(APIRoute):
    def get_route_handler(
        self,
    ) -> Callable[[Request], Awaitable[JSONResponse]]:
        original_handler = super().get_route_handler()

        async def handle(request: Request) -> JSONResponse:
            try:
                return await original_handler(request)
            except CourseNotFound:
                return error_response(404, "COURSE_NOT_FOUND", "ไม่พบรายวิชา")
            except StarletteHTTPException as exc:
                code, message = http_error(exc.status_code)
                return error_response(exc.status_code, code, message, headers=exc.headers)
            except RequestValidationError as exc:
                fields = [
                    ErrorFieldDTO(
                        field=".".join(str(part) for part in error["loc"][1:]),
                        message=error["msg"],
                    )
                    for error in exc.errors()
                ]
                return error_response(
                    422,
                    "INVALID_PARAMETERS",
                    "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง",
                    fields,
                )
            except Exception:
                logger.exception("Unexpected error in course API")
                return error_response(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ")

        return handle


def http_error(status_code: int) -> tuple[str, str]:
    if status_code == 401:
        return "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบก่อนค้นหารายวิชา"
    if status_code == 422:
        return "INVALID_PARAMETERS", "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง"
    return "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ"
