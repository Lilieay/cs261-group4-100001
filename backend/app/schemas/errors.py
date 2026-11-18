from pydantic import BaseModel, Field


class ErrorFieldDTO(BaseModel):
    field: str
    message: str


class ErrorDetailDTO(BaseModel):
    code: str
    message: str
    fields: list[ErrorFieldDTO] = Field(default_factory=list)


class ErrorResponseDTO(BaseModel):
    error: ErrorDetailDTO
