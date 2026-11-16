import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.dependencies import current_user, get_db_session
from app.schemas.saved_items import SavedItemListResponse, SavedItemState
from app.services.auth import AuthenticatedUser
from app.services.saved_items import SavedItemNotFound, SavedItemsService, TARGETS


def saved_item_error(status, code, message, *, headers=None, fields=None):
    return JSONResponse(
        status_code=status,
        headers={**(headers or {}), "Cache-Control": "no-store"},
        content={"error": {"code": code, "message": message, "fields": fields or []}},
    )


def saved_items_http_error(request: Request, error: StarletteHTTPException):
    path = request.url.path.rstrip("/")
    root = "/api/saved-items"
    if path == root or path.startswith(f"{root}/"):
        if error.status_code == 405:
            allow = "GET" if path == root else "GET, PUT, DELETE"
            return saved_item_error(405, "METHOD_NOT_ALLOWED", "ไม่รองรับคำขอนี้", headers={"Allow": allow})
        if error.status_code == 404:
            return saved_item_error(404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางรายการที่บันทึก")
    return None


class SavedItemRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request):
            try:
                response = await original(request)
            except HTTPException as error:
                if error.status_code != 401:
                    raise
                return saved_item_error(401, "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบ", headers=error.headers)
            response.headers["Cache-Control"] = "no-store"
            return response

        return handle


router = APIRouter(prefix="/api/saved-items", tags=["Saved Items"], route_class=SavedItemRoute)


async def unexpected_fields(request: Request):
    fields = [{"field": name, "message": "ไม่รองรับ query parameter"} for name in request.query_params]
    async for chunk in request.stream():
        if chunk:
            fields.append({"field": "body", "message": "เส้นทางนี้ไม่รับ body"})
            break
    return fields


def invalid_parameters(fields):
    return saved_item_error(422, "INVALID_PARAMETERS", "ข้อมูลสำหรับเรียก API ไม่ถูกต้อง", fields=fields)


def run_operation(session, operation, kind=None):
    try:
        return operation()
    except SavedItemNotFound:
        return saved_item_error(404, f"{kind.upper()}_NOT_FOUND", "ไม่พบเอกสาร")
    except SQLAlchemyError:
        try:
            session.rollback()
        except SQLAlchemyError:
            pass
        return saved_item_error(503, "SAVED_ITEMS_UNAVAILABLE", "จัดการรายการที่บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง")


@router.get("", response_model=SavedItemListResponse)
async def list_saved_items(
    request: Request,
    context: tuple[str, AuthenticatedUser] = Depends(current_user),
    session: Session = Depends(get_db_session),
):
    fields = await unexpected_fields(request)
    if fields:
        return invalid_parameters(fields)
    return await run_in_threadpool(run_operation, session, lambda: SavedItemsService(session).list(context[1].id))


@router.get("/{item_type}/{item_id}", response_model=SavedItemState)
@router.put("/{item_type}/{item_id}", response_model=SavedItemState)
@router.delete("/{item_type}/{item_id}", response_model=SavedItemState)
async def manage_saved_item(
    item_type: str,
    item_id: str,
    request: Request,
    context: tuple[str, AuthenticatedUser] = Depends(current_user),
    session: Session = Depends(get_db_session),
):
    fields = await unexpected_fields(request)
    if item_type not in TARGETS:
        fields.append({"field": "item_type", "message": "กรุณาระบุ guide หรือ summary"})
    if not re.fullmatch(r"[0-9]{1,10}", item_id) or not 1 <= int(item_id) <= 2_147_483_647:
        fields.append({"field": "item_id", "message": "กรุณาระบุ ID จำนวนเต็มบวก"})
    if fields:
        return invalid_parameters(fields)
    return await run_in_threadpool(
        run_operation, session,
        lambda: SavedItemsService(session).manage(request.method, context[1].id, item_type, int(item_id)),
        item_type,
    )
