from collections.abc import Iterator
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile
from fastapi.responses import StreamingResponse

from app.config import PDF_MAX_BYTES
from app.dependencies import current_user, get_summary_service
from app.routers.summary_errors import SummaryApiRoute
from app.schemas.summaries import CourseSummaryListResponse, SummaryDTO
from app.services.auth import AuthenticatedUser
from app.services.summaries import SummaryService


router = APIRouter(tags=["U6 PDF Summaries"], route_class=SummaryApiRoute)
SummaryServiceDependency = Annotated[SummaryService, Depends(get_summary_service)]


@router.post("/api/summaries", response_model=SummaryDTO, status_code=201)
async def publish_summary(
    service: SummaryServiceDependency,
    user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
    course_id: Annotated[int, Form(gt=0)],
    title: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    description: Annotated[str | None, Form()] = None,
) -> SummaryDTO:
    content = await file.read(PDF_MAX_BYTES + 1)
    return service.publish(
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
    course_id: Annotated[int, Path(gt=0)],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> CourseSummaryListResponse:
    return service.list_by_course(course_id)


@router.get("/api/summaries/{summary_id}", response_model=SummaryDTO)
def read_summary(
    summary_id: Annotated[int, Path(gt=0)],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> SummaryDTO:
    return service.get_summary(summary_id)


@router.get("/api/summaries/{summary_id}/file")
def open_summary_file(
    summary_id: Annotated[int, Path(gt=0)],
    service: SummaryServiceDependency,
    _user_context: Annotated[
        tuple[str, AuthenticatedUser], Depends(current_user)
    ],
) -> StreamingResponse:
    summary_file, handle = service.open_pdf(summary_id)
    encoded_name = quote(summary_file.original_name, safe="")
    headers = {
        "Content-Disposition": (
            f'inline; filename="summary.pdf"; filename*=UTF-8\'\'{encoded_name}'
        ),
        "Content-Length": str(summary_file.size_bytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
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
