from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.dependencies import current_user, get_db_session
from app.routers.my_summary_form import parse_summary_update_form
from app.routers.my_summary_list import reject_my_summary_list_parameters
from app.routers.summary_errors import SummaryApiRoute
from app.schemas.summaries import SummaryDTO, SummaryListResponseDTO
from app.services.auth import AuthenticatedUser
from app.services.my_summaries import MySummariesService, MySummaryError


router = APIRouter(route_class=SummaryApiRoute)
CurrentUser = Annotated[tuple[str, AuthenticatedUser], Depends(current_user)]
DatabaseSession = Annotated[Session, Depends(get_db_session)]


@router.get("/api/my-summaries", response_model=SummaryListResponseDTO)
def list_my_summaries(
    user_context: CurrentUser,
    _parameters: Annotated[None, Depends(reject_my_summary_list_parameters)],
    session: DatabaseSession,
) -> SummaryListResponseDTO:
    try:
        return MySummariesService(session).list_owned(user_context[1].id)
    except MySummaryError as error:
        raise HTTPException(error.status_code, error.code) from error


@router.put("/api/summaries/{summary_id}", response_model=SummaryDTO)
async def update_my_summary(
    summary_id: Annotated[int, Path(gt=0, le=2_147_483_647)],
    user_context: CurrentUser,
    request: Request,
    session: DatabaseSession,
) -> SummaryDTO:
    content_type = request.headers.get("content-type", "").partition(";")[0]
    if content_type.strip().lower() != "multipart/form-data":
        raise HTTPException(415)

    # This route is mounted only in the integration test app until PDF replacement is wired.
    async with request.form(max_files=0, max_fields=16, max_part_size=32_768) as form:
        metadata, _ = parse_summary_update_form(form)

    try:
        return await run_in_threadpool(
            MySummariesService(session).update_metadata,
            summary_id,
            user_context[1].id,
            metadata,
        )
    except MySummaryError as error:
        raise HTTPException(error.status_code, error.code) from error
