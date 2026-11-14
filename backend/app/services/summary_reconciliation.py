import logging
from collections.abc import Callable

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.dao.summary_file_dao import SummaryFileDAO
from app.services.summary_storage import LocalPdfStorage


logger = logging.getLogger(__name__)


def reconcile_orphaned_objects(
    storage: LocalPdfStorage,
    session_factory: Callable[[], Session],
) -> int:
    """Scan private storage before a single backend starts accepting uploads."""
    objects = storage.list_private_objects()
    if not objects:
        return 0

    with session_factory() as session:
        live_keys = SummaryFileDAO(session).list_storage_keys()

    removed = 0
    for key in objects - live_keys:
        try:
            storage.delete_private(key)
            removed += 1
        except OSError:
            logger.exception("Could not remove orphaned private PDF %s", key)
    return removed


def reconcile_uncertain_uploads(
    storage: LocalPdfStorage,
    session_factory: Callable[[], Session],
) -> tuple[int, int]:
    """Resolve commit-uncertain objects only after querying SQL successfully."""
    kept = 0
    removed = 0
    for storage_key in storage.pending_reconciliation():
        try:
            with session_factory() as session:
                persisted = SummaryFileDAO(session).get_by_storage_key(storage_key)
            if persisted is not None:
                storage.clear_reconciliation(storage_key)
                kept += 1
            else:
                storage.delete_private(storage_key)
                storage.clear_reconciliation(storage_key)
                removed += 1
        except (SQLAlchemyError, OSError, ValueError):
            # Keep both the private object and marker until SQL can be checked.
            logger.exception(
                "Could not reconcile private PDF upload %s", storage_key
            )
    return kept, removed
