from io import BytesIO

import pytest
from pypdf import PdfWriter

from app.config import PDF_MAX_BYTES
from app.services.pdf_validator import PdfValidationError, PdfValidator


def valid_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_accepts_a_readable_pdf_and_sanitizes_original_name():
    name = PdfValidator().validate(
        r"C:\fakepath\สรุป.pdf", "application/pdf", valid_pdf()
    )

    assert name == "สรุป.pdf"


@pytest.mark.parametrize(
    ("filename", "content_type", "content", "code"),
    [
        ("empty.pdf", "application/pdf", b"", "PDF_INVALID"),
        ("renamed.pdf", "application/pdf", b"not a PDF", "PDF_INVALID"),
        ("real.txt", "application/pdf", valid_pdf(), "PDF_INVALID"),
        ("real.pdf", "text/plain", valid_pdf(), "PDF_INVALID"),
    ],
    ids=["empty", "invalid-content", "wrong-extension", "wrong-mime"],
)
def test_rejects_invalid_pdf_inputs(filename, content_type, content, code):
    with pytest.raises(PdfValidationError) as error:
        PdfValidator().validate(filename, content_type, content)

    assert error.value.code == code


def test_rejects_pdf_over_size_limit_before_parsing():
    content = b"%PDF-1.7\n" + b" " * PDF_MAX_BYTES

    with pytest.raises(PdfValidationError) as error:
        PdfValidator().validate("too-large.pdf", "application/pdf", content)

    assert error.value.code == "PDF_TOO_LARGE"


def test_accepts_pdf_at_exact_15_million_byte_boundary():
    base = valid_pdf()
    before_eof, eof = base.rsplit(b"%%EOF", 1)
    content = before_eof + b" " * (PDF_MAX_BYTES - len(base)) + b"%%EOF" + eof

    assert len(content) == PDF_MAX_BYTES
    assert PdfValidator().validate("boundary.pdf", "application/pdf", content)


def test_rejects_pdf_one_byte_over_15_million_byte_boundary():
    base = valid_pdf()
    before_eof, eof = base.rsplit(b"%%EOF", 1)
    content = before_eof + b" " * (PDF_MAX_BYTES + 1 - len(base)) + b"%%EOF" + eof

    assert len(content) == 15_000_001
    with pytest.raises(PdfValidationError) as error:
        PdfValidator().validate("over-limit.pdf", "application/pdf", content)

    assert error.value.status_code == 413
    assert error.value.code == "PDF_TOO_LARGE"


def test_rejects_encrypted_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt("secret")
    output = BytesIO()
    writer.write(output)

    with pytest.raises(PdfValidationError) as error:
        PdfValidator().validate("locked.pdf", "application/pdf", output.getvalue())

    assert error.value.code == "PDF_UNREADABLE"


def test_rejects_pdf_without_pages():
    writer = PdfWriter()
    output = BytesIO()
    writer.write(output)

    with pytest.raises(PdfValidationError) as error:
        PdfValidator().validate("no-pages.pdf", "application/pdf", output.getvalue())

    assert error.value.code == "PDF_UNREADABLE"
