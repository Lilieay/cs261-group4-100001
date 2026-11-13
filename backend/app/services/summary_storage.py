import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


logger = logging.getLogger(__name__)
_STORAGE_KEY = re.compile(r"^[0-9a-f]{32}$")


@dataclass(frozen=True)
class PrivatePdfMetadata:
    storage_key: str
    content_type: str
    size_bytes: int


class LocalPdfStorage:
    """Store PDFs under a private root; this directory is never mounted as static."""

    def __init__(self, root: Path):
        self.root = Path(root).expanduser().resolve()
        self.cleanup_root = self.root / ".cleanup"
        self.reconciliation_root = self.root / ".reconciliation"

    def put_private(self, key: str, content: bytes) -> PrivatePdfMetadata:
        destination = self._path_for(key)
        temporary_path: Path | None = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=self.root, prefix=".upload-", delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(content)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, destination)
        except OSError as error:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise OSError("Private PDF storage write failed") from error
        return PrivatePdfMetadata(key, "application/pdf", len(content))

    def open_private(self, key: str) -> BinaryIO:
        path = self._path_for(key)
        try:
            return path.open("rb")
        except OSError as error:
            raise OSError("Private PDF storage read failed") from error

    def verify_private(self, key: str, expected_size: int) -> PrivatePdfMetadata:
        path = self._path_for(key)
        try:
            with path.open("rb") as stored_file:
                size_bytes = os.fstat(stored_file.fileno()).st_size
                first_byte = stored_file.read(1)
            if size_bytes != expected_size or not first_byte:
                raise OSError("Private PDF storage verification failed")
        except OSError as error:
            raise OSError("Private PDF storage verification failed") from error
        return PrivatePdfMetadata(key, "application/pdf", size_bytes)

    def delete_private(self, key: str) -> None:
        path = self._path_for(key)
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            raise OSError("Private PDF storage delete failed") from error

    def queue_cleanup(self, key: str) -> None:
        self._path_for(key)
        self.cleanup_root.mkdir(parents=True, exist_ok=True)
        marker = self.cleanup_root / f"{key}.pending"
        marker.write_text(key, encoding="ascii")

    def queue_reconciliation(self, key: str) -> None:
        self._path_for(key)
        self.reconciliation_root.mkdir(parents=True, exist_ok=True)
        marker = self.reconciliation_root / f"{key}.reconcile"
        marker.write_text(key, encoding="ascii")

    def pending_reconciliation(self) -> list[str]:
        if not self.reconciliation_root.exists():
            return []
        keys = []
        for marker in self.reconciliation_root.glob("*.reconcile"):
            key = marker.stem
            if _STORAGE_KEY.fullmatch(key):
                keys.append(key)
        return keys

    def clear_reconciliation(self, key: str) -> None:
        self._path_for(key)
        (self.reconciliation_root / f"{key}.reconcile").unlink(missing_ok=True)

    def retry_pending_cleanup(self) -> int:
        if not self.cleanup_root.exists():
            return 0
        removed = 0
        for marker in self.cleanup_root.glob("*.pending"):
            key = marker.stem
            try:
                self.delete_private(key)
                marker.unlink(missing_ok=True)
                removed += 1
            except (OSError, ValueError):
                logger.exception("Could not retry private PDF cleanup for %s", key)
        return removed

    def _path_for(self, key: str) -> Path:
        if not _STORAGE_KEY.fullmatch(key):
            raise ValueError("Invalid private storage key")
        return self.root / key
