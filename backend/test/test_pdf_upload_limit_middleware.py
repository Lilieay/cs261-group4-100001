import asyncio

from app.middleware.pdf_upload_limit import PdfUploadSizeLimitMiddleware


def test_rejects_chunked_body_that_exceeds_limit_without_content_length():
    messages = iter(
        [
            {"type": "http.request", "body": b"123", "more_body": True},
            {"type": "http.request", "body": b"456", "more_body": False},
        ]
    )
    sent = []
    downstream_called = False

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    async def app(scope, _receive, _send):
        nonlocal downstream_called
        downstream_called = True

    middleware = PdfUploadSizeLimitMiddleware(app, max_bytes=5)
    asyncio.run(
        middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/summaries",
                "headers": [],
            },
            receive,
            send,
        )
    )

    assert not downstream_called
    assert sent[0]["status"] == 413
    assert b"REQUEST_TOO_LARGE" in sent[1]["body"]
