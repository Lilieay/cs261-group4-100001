from io import BytesIO
from pathlib import PurePath

from pypdf import PdfReader

from app.config import PDF_MAX_BYTES


class PdfValidationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class PdfValidator:
    def validate(
        self, filename: str | None, content_type: str | None, content: bytes
    ) -> str:
        if len(content) > PDF_MAX_BYTES:
            raise PdfValidationError(
                "PDF_TOO_LARGE", "ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MiB", 413
            )
        if not content:
            raise PdfValidationError("PDF_INVALID", "ไฟล์ PDF ว่างเปล่า")
        safe_name = self._safe_original_name(filename)
        if PurePath(safe_name).suffix.lower() != ".pdf":
            raise PdfValidationError("PDF_INVALID", "กรุณาเลือกไฟล์นามสกุล .pdf")
        if (content_type or "").lower().split(";", 1)[0].strip() != "application/pdf":
            raise PdfValidationError("PDF_INVALID", "ชนิดไฟล์ต้องเป็น application/pdf")

        try:
            reader = PdfReader(BytesIO(content), strict=True)
            if reader.is_encrypted or len(reader.pages) == 0:
                raise PdfValidationError(
                    "PDF_UNREADABLE", "PDF ต้องเปิดอ่านได้และมีอย่างน้อยหนึ่งหน้า"
                )
        except PdfValidationError:
            raise
        except Exception as error:
            raise PdfValidationError(
                "PDF_INVALID", "เนื้อหาไฟล์ไม่ใช่ PDF ที่ถูกต้อง"
            ) from error
        return safe_name

    @staticmethod
    def _safe_original_name(filename: str | None) -> str:
        name = (filename or "summary.pdf").replace("\\", "/").split("/")[-1]
        name = "".join(character for character in name if character.isprintable())
        name = name.strip().strip(".")
        if not name:
            name = "summary.pdf"
        # NVARCHAR(255) stores UTF-16 code units, not Unicode code points.
        bounded: list[str] = []
        code_units = 0
        for character in name:
            width = len(character.encode("utf-16-le")) // 2
            if code_units + width > 255:
                break
            bounded.append(character)
            code_units += width
        return "".join(bounded) or "summary.pdf"
