import pytest

from app.services.summary_storage import LocalPdfStorage


def test_private_storage_put_open_and_delete(tmp_path):
    storage = LocalPdfStorage(tmp_path / "private")
    key = "a" * 32

    metadata = storage.put_private(key, b"private pdf bytes")
    assert metadata.storage_key == key
    assert metadata.content_type == "application/pdf"
    assert metadata.size_bytes == len(b"private pdf bytes")
    assert storage.verify_private(key, len(b"private pdf bytes")) == metadata
    handle = storage.open_private(key)
    try:
        assert handle.read() == b"private pdf bytes"
    finally:
        handle.close()

    storage.delete_private(key)
    with pytest.raises(OSError):
        storage.open_private(key)


def test_storage_rejects_path_traversal_keys(tmp_path):
    storage = LocalPdfStorage(tmp_path / "private")

    with pytest.raises(ValueError):
        storage.put_private("../outside", b"not allowed")


def test_cleanup_queue_is_retried(tmp_path):
    storage = LocalPdfStorage(tmp_path / "private")
    key = "b" * 32
    storage.put_private(key, b"orphan")
    storage.queue_cleanup(key)

    assert storage.retry_pending_cleanup() == 1
    assert not (tmp_path / "private" / key).exists()
    assert not (tmp_path / "private" / ".cleanup" / f"{key}.pending").exists()
