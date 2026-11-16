from typing import Any


class SavedItemsNoStoreMiddleware:
    """Apply the API contract's no-store policy to every saved-items response."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope.get("type") != "http" or not (
            path == "/api/saved-items" or path.startswith("/api/saved-items/")
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
