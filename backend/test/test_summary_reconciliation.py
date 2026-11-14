import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.dao.summary_file_dao import SummaryFileDAO
from app.db import Base
from app.models.course import Course
from app.models.summary import Summary, SummaryFile
from app.models.user import User
from app.services.summary_reconciliation import (
    reconcile_orphaned_objects,
    reconcile_uncertain_uploads,
)
from app.services.summary_storage import LocalPdfStorage


@pytest.mark.parametrize("use_markers", [False, True])
def test_reconciliation_keeps_objects_referenced_by_sql_and_deletes_orphans(tmp_path, use_markers):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    storage = LocalPdfStorage(tmp_path / "pdfs")
    referenced_key = "a" * 32
    orphan_key = "b" * 32
    storage.put_private(referenced_key, b"referenced")
    storage.put_private(orphan_key, b"orphan")
    if use_markers:
        storage.queue_reconciliation(referenced_key)
        storage.queue_reconciliation(orphan_key)
    temp_upload = storage.root / ".upload-in-progress"
    temp_upload.write_bytes(b"temporary")

    with session_factory() as session:
        course = Course(course_code="CS110", course_name="Integration")
        owner = User(username="task110_reconcile")
        session.add_all((course, owner))
        session.flush()
        summary = Summary(
            course_id=course.id,
            owner_id=owner.id,
            title="Referenced summary",
        )
        session.add(summary)
        session.flush()
        session.add(
            SummaryFile(
                summary_id=summary.id,
                storage_key=referenced_key,
                original_name="referenced.pdf",
                content_type="application/pdf",
                size_bytes=10,
            )
        )
        session.commit()

    if use_markers:
        assert reconcile_uncertain_uploads(storage, session_factory) == (1, 1)
    else:
        restarted_storage = LocalPdfStorage(storage.root)
        assert reconcile_orphaned_objects(restarted_storage, session_factory) == 1
        assert reconcile_orphaned_objects(restarted_storage, session_factory) == 0
    assert temp_upload.read_bytes() == b"temporary"
    assert (storage.root / referenced_key).read_bytes() == b"referenced"
    assert not (storage.root / orphan_key).exists()
    with session_factory() as session:
        assert SummaryFileDAO(session).get_by_storage_key(referenced_key) is not None
    engine.dispose()


def test_startup_reconciliation_preserves_objects_if_database_is_unavailable(tmp_path):
    storage = LocalPdfStorage(tmp_path / "pdfs")
    key = "c" * 32
    storage.put_private(key, b"do not delete")

    def unavailable():
        raise SQLAlchemyError("Database unavailable")

    with pytest.raises(SQLAlchemyError):
        reconcile_orphaned_objects(storage, unavailable)

    with storage.open_private(key) as handle:
        assert handle.read() == b"do not delete"
