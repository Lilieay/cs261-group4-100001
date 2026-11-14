import json
from typing import Any


class PdfUploadSizeLimitMiddleware:
    """Bound the complete multipart request body for the PDF publish route."""

    def __init__(self, app: Any, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if not (
            scope.get("type") == "http"
            and scope.get("method") == "POST"
            and scope.get("path") == "/api/summaries"
        ):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length")
        if raw_length is not None:
            try:
                declared_length = int(raw_length)
            except ValueError:
                await self._reject(send)
                return
            if declared_length < 0 or declared_length > self.max_bytes:
                await self._reject(send)
                return

        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > self.max_bytes:
                await self._reject(send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        await self.app(scope, self._replay(chunks), send)

    @staticmethod
    def _replay(chunks: list[bytes]):
        index = 0

        async def receive():
            nonlocal index
            if index >= len(chunks):
                return {"type": "http.request", "body": b"", "more_body": False}
            body = chunks[index]
            index += 1
            return {
                "type": "http.request",
                "body": body,
                "more_body": index < len(chunks),
            }

        return receive

    async def _reject(self, send) -> None:
        body = json.dumps(
            {
                "error": {
                    "code": "REQUEST_TOO_LARGE",
                    "message": "คำขอมีขนาดใหญ่เกินกำหนด",
                    "fields": [],
                }
            },
            ensure_ascii=False,
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
