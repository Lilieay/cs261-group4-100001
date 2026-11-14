from typing import Any


class SummaryNoStoreMiddleware:
    """Prevent caching U6 summary metadata, PDF bytes, and error responses."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not self._is_summary_path(
            scope.get("path", "")
        ):
            await self.app(scope, receive, send)
            return

        async def send_no_store(message):
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_no_store)

    @staticmethod
    def _is_summary_path(path: str) -> bool:
        return (
            path == "/api/summaries"
            or path.startswith("/api/summaries/")
            or path.startswith("/api/courses/") and path.endswith("/summaries")
        )
