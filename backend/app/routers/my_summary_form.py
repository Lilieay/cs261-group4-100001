from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.datastructures import FormData, UploadFile

from app.schemas.my_summary_update import MySummaryUpdateRequest


def parse_summary_update_form(
    form: FormData,
) -> tuple[MySummaryUpdateRequest, UploadFile | None]:
    """Validate parsed multipart parts without reading or storing PDF bytes.

    The caller owns the FormData context and must keep uploads open until the
    service finishes. PDF validation and storage belong to the shared U6 layer.
    """
    metadata: dict[str, str] = {}
    upload: UploadFile | None = None
    seen: set[str] = set()
    errors: list[dict] = []

    for name, value in form.multi_items():
        if name in seen:
            errors.append(_field_error(name, "ส่งแต่ละช่องได้เพียงครั้งเดียว"))
            continue
        seen.add(name)

        if name == "file":
            if isinstance(value, UploadFile):
                upload = value
            else:
                errors.append(_field_error(name, "ต้องส่ง PDF เป็น file part"))
        elif name not in MySummaryUpdateRequest.model_fields:
            errors.append(_field_error(name, "ไม่อนุญาตให้ส่งช่องข้อมูลนี้"))
        elif not isinstance(value, str):
            errors.append(_field_error(name, "ต้องส่งช่องข้อมูลเป็นข้อความ"))
        else:
            metadata[name] = value

    if errors:
        raise RequestValidationError(errors)

    try:
        request = MySummaryUpdateRequest.model_validate(metadata)
    except ValidationError as error:
        raise RequestValidationError(
            [
                {**item, "loc": ("body", *item["loc"])}
                for item in error.errors(include_input=False, include_context=False)
            ]
        ) from error

    return request, upload


def _field_error(field: str, message: str) -> dict:
    return {"loc": ("body", field), "msg": message, "type": "value_error"}
