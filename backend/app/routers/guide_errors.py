import logging
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.http_errors import error_response as _error_response
from app.schemas.errors import ErrorFieldDTO
from app.services.publish_guide import GuidePublishNotFound
from app.services.read_guide import GuideReadNotFound

logger = logging.getLogger(__name__)


class GuideApiRoute(APIRoute):
    def get_route_handler(
        self,
    ) -> Callable[[Request], Awaitable[JSONResponse]]:
        original_handler = super().get_route_handler()

        async def handle(request: Request) -> JSONResponse:
            try:
                return await original_handler(request)
            except GuideReadNotFound as exc:
                message = (
                    "ไม่พบรายวิชา"
                    if exc.code == "COURSE_NOT_FOUND"
                    else "ไม่พบแนวข้อสอบ"
                )
                return _error_response(404, exc.code, message)
            except GuidePublishNotFound:
                return _error_response(
                    404,
                    "COURSE_NOT_FOUND",
                    "ไม่พบรายวิชาที่เผยแพร่หรือรายวิชาไม่อยู่ในขอบเขต",
                )
            except StarletteHTTPException as exc:
                code, message = _http_error(exc.status_code)
                return _error_response(exc.status_code, code, message, headers=exc.headers)
            except RequestValidationError as exc:
                fields = [
                    ErrorFieldDTO(
                        field=".".join(str(part) for part in error["loc"][1:]),
                        message=error["msg"],
                    )
                    for error in exc.errors()
                ]
                return _error_response(
                    422,
                    "INVALID_PARAMETERS",
                    "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง",
                    fields,
                )
            except Exception:
                logger.exception("Unexpected error in guide read API")
                return _error_response(
                    500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ"
                )

        return handle


def _http_error(status_code: int) -> tuple[str, str]:
    if status_code == 401:
        return "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบก่อนอ่านแนวข้อสอบ"
    if status_code == 422:
        return "INVALID_PARAMETERS", "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง"
    if status_code == 404:
        return "GUIDE_NOT_FOUND", "ไม่พบแนวข้อสอบ"
    return "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ"
