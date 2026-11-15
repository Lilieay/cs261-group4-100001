"""Create the application database, ORM tables, and demo seed data."""

import os
import re
import time

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError
from sqlalchemy.schema import CreateColumn

from app.config import DB_CONNECTION_STRING
from app.db import Base, SessionLocal, engine
from app.models.user import User
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.summary import Summary, SummaryFile
from app.models.course_seed_ownership import CourseSeedOwnership
from scripts.seed_data.course_seed_service import CourseSeedService
from scripts.seed_data.guide_seed_service import GuideSeedService
from app.config import PDF_STORAGE_ROOT
from app.services.summary_storage import LocalPdfStorage
from app.services.summary_reconciliation import (
    reconcile_orphaned_objects,
    reconcile_uncertain_uploads,
)


DATABASE_NAME_PATTERN = re.compile(r"(?:^|;)DATABASE=([^;]+)", re.IGNORECASE)


def _master_engine():
    match = DATABASE_NAME_PATTERN.search(DB_CONNECTION_STRING)
    if match is None:
        raise RuntimeError("DB_CONNECTION_STRING must include a DATABASE name.")
    database_name = match.group(1)
    if not re.fullmatch(r"[A-Za-z0-9_]+", database_name):
        raise RuntimeError("The configured database name contains unsupported characters.")
    master_connection_string = DATABASE_NAME_PATTERN.sub(";DATABASE=master", DB_CONNECTION_STRING, count=1)
    return database_name, create_engine(
        URL.create("mssql+pyodbc", query={"odbc_connect": master_connection_string}),
        isolation_level="AUTOCOMMIT",
        pool_pre_ping=True,
        connect_args={"timeout": 5},
    )


def _ensure_database() -> None:
    database_name, master_engine = _master_engine()
    quoted_name = f"[{database_name.replace(']', ']]')}]"
    deadline = time.monotonic() + 300
    try:
        while True:
            try:
                with master_engine.connect() as connection:
                    connection.exec_driver_sql(
                        f"IF DB_ID(N'{database_name}') IS NULL CREATE DATABASE {quoted_name}"
                    )
                return
            except DBAPIError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)
    finally:
        master_engine.dispose()


def _ensure_summary_exam_columns(database_engine) -> None:
    """Add optional metadata to an existing summaries table without rewriting old rows."""
    table = Summary.__table__
    with database_engine.begin() as connection:
        existing = {column["name"] for column in inspect(connection).get_columns(table.name)}
        table_name = connection.dialect.identifier_preparer.format_table(table)
        for name in ("academic_year", "semester", "exam_period"):
            if name not in existing:
                column = CreateColumn(table.c[name]).compile(dialect=connection.dialect)
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD {column}")


def main() -> None:
    _ensure_database()
    Base.metadata.create_all(bind=engine)
    _ensure_summary_exam_columns(engine)
    PDF_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    pdf_storage = LocalPdfStorage(PDF_STORAGE_ROOT)
    if os.getenv("PDF_SCAN_ORPHANS_ON_STARTUP") == "1":
        reconcile_orphaned_objects(pdf_storage, SessionLocal)
    pdf_storage.retry_pending_cleanup()
    reconcile_uncertain_uploads(pdf_storage, SessionLocal)
    with SessionLocal.begin() as session:
        courses = CourseSeedService(session, "demo").seed()
        GuideSeedService(session, "test").seed()
    print(
        "Database initialized; demo courses "
        f"inserted={len(courses.inserted)}, reused={len(courses.reused)}; "
        "sample guides seeded."
    )


if __name__ == "__main__":
    main()
