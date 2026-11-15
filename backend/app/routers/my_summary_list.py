from fastapi import HTTPException, Request


async def reject_my_summary_list_parameters(request: Request) -> None:
    """Reject query parameters and request bodies on the my-summaries list."""
    if request.query_params:
        raise HTTPException(status_code=422)

    async for chunk in request.stream():
        if chunk:
            raise HTTPException(status_code=422)
