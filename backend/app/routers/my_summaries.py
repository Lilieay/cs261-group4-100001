from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import PDF_MAX_BYTES
from app.dependencies import current_user, get_db_session, get_pdf_storage
from app.routers.my_summary_form import parse_summary_update_form
from app.routers.my_summary_list import reject_my_summary_list_parameters
from app.routers.summaries import parse_summary_id
from app.routers.summary_errors import SummaryApiRoute
from app.schemas.summaries import SummaryDTO, SummaryListResponseDTO
from app.services.auth import AuthenticatedUser
from app.services.my_summaries import MySummariesService, MySummaryError
from app.services.summary_storage import LocalPdfStorage


router = APIRouter(tags=["U7 My Summaries"], route_class=SummaryApiRoute)
CurrentUser = Annotated[tuple[str, AuthenticatedUser], Depends(current_user)]
DatabaseSession = Annotated[Session, Depends(get_db_session)]
PdfStorage = Annotated[LocalPdfStorage, Depends(get_pdf_storage)]


@router.get("/api/my-summaries", response_model=SummaryListResponseDTO)
def list_my_summaries(
    user_context: CurrentUser,
    _parameters: Annotated[None, Depends(reject_my_summary_list_parameters)],
    session: DatabaseSession,
    storage: PdfStorage,
) -> SummaryListResponseDTO:
    try:
        return MySummariesService(session, storage).list_owned(user_context[1].id)
    except MySummaryError as error:
        raise HTTPException(error.status_code, error.code) from error


@router.put("/api/summaries/{summary_id}", response_model=SummaryDTO)
async def update_my_summary(
    summary_id: Annotated[str, Path()],
    user_context: CurrentUser,
    request: Request,
    session: DatabaseSession,
    storage: PdfStorage,
) -> SummaryDTO:
    identifier = parse_summary_id(summary_id, "path", "summary_id")
    if request.query_params:
        raise HTTPException(422)
    content_type = request.headers.get("content-type", "").partition(";")[0]
    if content_type.strip().lower() != "multipart/form-data":
        raise HTTPException(415)

    async with request.form(max_files=2, max_fields=16, max_part_size=32_768) as form:
        metadata, upload = parse_summary_update_form(form)
        filename = upload.filename if upload is not None else None
        mime_type = upload.content_type if upload is not None else None
        content = await upload.read(PDF_MAX_BYTES + 1) if upload is not None else None

    try:
        return await run_in_threadpool(
            MySummariesService(session, storage).update,
            identifier,
            user_context[1].id,
            metadata,
            content=content,
            filename=filename,
            content_type=mime_type,
        )
    except MySummaryError as error:
        raise HTTPException(error.status_code, error.code) from error


@router.delete("/api/summaries/{summary_id}", status_code=204)
def delete_my_summary(
    summary_id: Annotated[str, Path()],
    user_context: CurrentUser,
    _parameters: Annotated[None, Depends(reject_my_summary_list_parameters)],
    session: DatabaseSession,
    storage: PdfStorage,
) -> Response:
    identifier = parse_summary_id(summary_id, "path", "summary_id")
    try:
        MySummariesService(session, storage).delete(identifier, user_context[1].id)
    except MySummaryError as error:
        raise HTTPException(error.status_code, error.code) from error
    return Response(status_code=204)
