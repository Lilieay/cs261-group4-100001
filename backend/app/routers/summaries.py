from collections.abc import Iterator
from typing import Annotated
import re

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.config import PDF_MAX_BYTES
from app.dependencies import current_user, get_summary_service
from app.routers.summary_errors import SummaryApiRoute
from app.schemas.summaries import CourseSummaryListResponse, SummaryDTO
from app.services.auth import AuthenticatedUser
from app.services.pdf_validator import PdfValidationError
from app.services.summaries import SummaryService


router = APIRouter(tags=["U6 PDF Summaries"], route_class=SummaryApiRoute)
SummaryServiceDependency = Annotated[SummaryService, Depends(get_summary_service)]


def parse_summary_id(value: str, source: str, field: str) -> int:
    digits = value.lstrip("0")
    if 0 < len(digits) <= 10 and re.fullmatch(r"[0-9]+", digits):
        identifier = int(digits)
        if identifier <= 2_147_483_647:
            return identifier
    raise RequestValidationError([{
        "loc": (source, field),
        "msg": "ต้องเป็นจำนวนเต็มบวกไม่เกิน 2,147,483,647",
        "type": "value_error",
    }])


@router.post("/api/summaries", response_model=SummaryDTO, status_code=201)
async def publish_summary(
    request: Request,
    service: SummaryServiceDependency,
    user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> SummaryDTO:
    media_type = request.headers.get("content-type", "").partition(";")[0]
    if media_type.strip().lower() != "multipart/form-data":
        raise HTTPException(415)

    async with request.form() as form:
        allowed = {"course_id", "title", "description", "file"}
        items = form.multi_items()
        names = [name for name, _value in items]
        if (
            any(name not in allowed for name in names)
            or any(
                names.count(required) != 1
                for required in ("course_id", "title", "file")
            )
            or names.count("description") > 1
        ):
            raise PdfValidationError(
                "INVALID_PARAMETERS",
                "ต้องส่งเฉพาะช่องที่กำหนดและแต่ละช่องส่งได้ครั้งเดียว",
            )

        values = dict(items)
        raw_course_id = values["course_id"]
        title = values["title"]
        file = values["file"]
        description = values.get("description")
        if (
            not isinstance(raw_course_id, str)
            or not isinstance(title, str)
            or (description is not None and not isinstance(description, str))
            or not isinstance(file, UploadFile)
        ):
            raise PdfValidationError(
                "INVALID_PARAMETERS", "ชนิดข้อมูลของ multipart part ไม่ถูกต้อง"
            )
        course_id = parse_summary_id(raw_course_id, "body", "course_id")

        content = await file.read(PDF_MAX_BYTES + 1)
        return await run_in_threadpool(
            service.publish,
            course_id=course_id,
            title=title,
            description=description,
            filename=file.filename,
            content_type=file.content_type,
            content=content,
            authenticated_user=user_context[1],
        )


@router.get(
    "/api/courses/{course_id}/summaries",
    response_model=CourseSummaryListResponse,
)
def list_course_summaries(
    course_id: Annotated[str, Path()],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> CourseSummaryListResponse:
    return service.list_by_course(parse_summary_id(course_id, "path", "course_id"))


@router.get("/api/summaries/{summary_id}", response_model=SummaryDTO)
def read_summary(
    summary_id: Annotated[str, Path()],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> SummaryDTO:
    return service.get_summary(parse_summary_id(summary_id, "path", "summary_id"))


@router.get("/api/summaries/{summary_id}/file")
def open_summary_file(
    summary_id: Annotated[str, Path()],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> StreamingResponse:
    identifier = parse_summary_id(summary_id, "path", "summary_id")
    summary_file, handle = service.open_pdf(identifier)
    headers = {
        "Content-Disposition": f'inline; filename="summary-{identifier}.pdf"',
        "Content-Length": str(summary_file.size_bytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    return StreamingResponse(
        _stream_and_close(handle),
        media_type="application/pdf",
        headers=headers,
    )


def _stream_and_close(handle) -> Iterator[bytes]:
    try:
        while chunk := handle.read(64 * 1024):
            yield chunk
    finally:
        handle.close()
