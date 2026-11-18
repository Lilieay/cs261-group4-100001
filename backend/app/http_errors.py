from fastapi.responses import JSONResponse

from app.schemas.errors import ErrorDetailDTO, ErrorFieldDTO, ErrorResponseDTO


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
    return JSONResponse(status_code=status_code, content=body.model_dump(), headers=headers)
