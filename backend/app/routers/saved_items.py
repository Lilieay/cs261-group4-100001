import logging
import re
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.dependencies import current_user, get_saved_items_service
from app.schemas.guides import ErrorDetailDTO, ErrorFieldDTO, ErrorResponseDTO
from app.schemas.saved_item import SavedItemListResponse, SavedItemState, SavedItemType
from app.services.auth import AuthenticatedUser
from app.services.saved_items import (
    SavedItemCommitUnknown,
    SavedItemsService,
    SavedItemsUnavailable,
    SavedTargetNotFound,
)


logger = logging.getLogger(__name__)


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
        status_code=status_code,
        content=body.model_dump(),
        headers={**(headers or {}), "Cache-Control": "no-store"},
    )


def saved_items_http_error(
    request: Request, error: StarletteHTTPException
) -> JSONResponse | None:
    path = request.url.path.rstrip("/")
    root = "/api/saved-items"
    if path == root or path.startswith(f"{root}/"):
        if error.status_code == 405:
            allow = "GET" if path == root else "GET, PUT, DELETE"
            return error_response(
                405, "METHOD_NOT_ALLOWED", "ไม่รองรับคำขอนี้", headers={"Allow": allow}
            )
        if error.status_code == 404:
            return error_response(404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางรายการที่บันทึก")
    return None


def _parse_item_id(raw_item_id: str) -> int | None:
    if re.fullmatch(r"[0-9]+", raw_item_id, flags=re.ASCII) is None:
        return None
    significant_digits = raw_item_id.lstrip("0")
    if not significant_digits or len(significant_digits) > 10:
        return None
    item_id = int(significant_digits)
    if not 1 <= item_id <= 2_147_483_647:
        return None
    return item_id


def _invalid_item_id_response() -> JSONResponse:
    return error_response(
        422,
        "INVALID_PARAMETERS",
        "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง",
        [ErrorFieldDTO(field="item_id", message="กรุณาระบุเลขฐานสิบจำนวนเต็มบวก")],
    )


class SavedItemsApiRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original_handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await original_handler(request)
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
            except StarletteHTTPException as error:
                if error.status_code == 401:
                    return error_response(
                        401,
                        "AUTH_REQUIRED",
                        "กรุณาเข้าสู่ระบบก่อนใช้งาน",
                        headers=error.headers,
                    )
                return error_response(
                    error.status_code,
                    "INVALID_PARAMETERS",
                    "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง",
                    headers=error.headers,
                )
            except SavedTargetNotFound as error:
                code = (
                    "GUIDE_NOT_FOUND"
                    if error.item_type == "guide"
                    else "SUMMARY_NOT_FOUND"
                )
                message = "ไม่พบแนวข้อสอบ" if error.item_type == "guide" else "ไม่พบสรุป PDF"
                return error_response(404, code, message)
            except SavedItemCommitUnknown:
                return error_response(
                    503,
                    "SAVED_ITEMS_UNAVAILABLE",
                    "ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด",
                )
            except SavedItemsUnavailable:
                message = (
                    "จัดการรายการที่บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"
                    if request.method in ("PUT", "DELETE")
                    else "ไม่สามารถอ่านหรือบันทึกรายการที่บันทึกได้ในขณะนี้"
                )
                return error_response(
                    503,
                    "SAVED_ITEMS_UNAVAILABLE",
                    message,
                )
            except Exception:
                logger.exception("Unexpected saved-items API error")
                return error_response(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ")

        return handle


router = APIRouter(
    prefix="/api/saved-items", tags=["Saved Items"], route_class=SavedItemsApiRoute
)


async def _reject_query_or_body(request: Request) -> JSONResponse | None:
    fields: list[ErrorFieldDTO] = []
    fields.extend(
        ErrorFieldDTO(field=key, message="ไม่รองรับ query parameter")
        for key in request.query_params
    )
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            has_body = int(content_length) > 0
        except ValueError:
            has_body = True
        if has_body:
            fields.append(ErrorFieldDTO(field="body", message="ไม่รับ request body"))
    elif not fields:
        async for chunk in request.stream():
            if chunk:
                fields.append(
                    ErrorFieldDTO(field="body", message="ไม่รับ request body")
                )
                break
    if fields:
        return error_response(
            422, "INVALID_PARAMETERS", "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง", fields
        )
    return None


@router.get("", response_model=SavedItemListResponse)
async def list_saved_items(
    request: Request,
    user_context: tuple[str, AuthenticatedUser] = Depends(current_user),
    service: SavedItemsService = Depends(get_saved_items_service),
):
    invalid_request = await _reject_query_or_body(request)
    if invalid_request is not None:
        return invalid_request
    return await run_in_threadpool(service.list, user_context[1].id)


@router.put("/{item_type}/{item_id}", response_model=SavedItemState)
async def save_item(
    request: Request,
    item_type: SavedItemType,
    item_id: str = Path(),
    user_context: tuple[str, AuthenticatedUser] = Depends(current_user),
    service: SavedItemsService = Depends(get_saved_items_service),
):
    parsed_item_id = _parse_item_id(item_id)
    if parsed_item_id is None:
        return _invalid_item_id_response()
    invalid_request = await _reject_query_or_body(request)
    if invalid_request is not None:
        return invalid_request
    return await run_in_threadpool(
        service.save, user_context[1].id, item_type, parsed_item_id
    )


@router.get("/{item_type}/{item_id}", response_model=SavedItemState)
async def get_item_state(
    request: Request,
    item_type: SavedItemType,
    item_id: str = Path(),
    user_context: tuple[str, AuthenticatedUser] = Depends(current_user),
    service: SavedItemsService = Depends(get_saved_items_service),
):
    parsed_item_id = _parse_item_id(item_id)
    if parsed_item_id is None:
        return _invalid_item_id_response()
    invalid_request = await _reject_query_or_body(request)
    if invalid_request is not None:
        return invalid_request
    return await run_in_threadpool(
        service.state, user_context[1].id, item_type, parsed_item_id
    )


@router.delete("/{item_type}/{item_id}", response_model=SavedItemState)
async def remove_saved_item(
    request: Request,
    item_type: SavedItemType,
    item_id: str = Path(),
    user_context: tuple[str, AuthenticatedUser] = Depends(current_user),
    service: SavedItemsService = Depends(get_saved_items_service),
):
    parsed_item_id = _parse_item_id(item_id)
    if parsed_item_id is None:
        return _invalid_item_id_response()
    invalid_request = await _reject_query_or_body(request)
    if invalid_request is not None:
        return invalid_request
    return await run_in_threadpool(
        service.remove, user_context[1].id, item_type, parsed_item_id
    )
