from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Unicode,
    UniqueConstraint,
    desc,
)
from sqlalchemy.dialects.mssql import DATETIME2
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import PDF_MAX_BYTES
from app.db import Base


def utc_now_naive() -> datetime:
    """Return UTC for storage in DATETIME2 columns without timezone metadata."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


_UTC_DATETIME = DateTime().with_variant(DATETIME2(precision=3), "mssql")


class Summary(Base):
    __tablename__ = "summaries"
    __table_args__ = (
        Index(
            "ix_summaries_course_created_id",
            "course_id",
            desc("created_at"),
            desc("id"),
        ),
        Index(
            "ix_summaries_owner_created_id",
            "owner_id",
            desc("created_at"),
            desc("id"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=False
    )
    owner_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=False
    )
    title: Mapped[str] = mapped_column(Unicode(400), nullable=False)
    description: Mapped[str | None] = mapped_column(Unicode(4000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        _UTC_DATETIME, nullable=False, default=utc_now_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        _UTC_DATETIME, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )

    course = relationship("Course")
    owner = relationship("User")
    file: Mapped["SummaryFile | None"] = relationship(
        back_populates="summary",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class SummaryFile(Base):
    __tablename__ = "summary_files"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_summary_files_storage_key"),
        CheckConstraint(
            f"size_bytes >= 1 AND size_bytes <= {PDF_MAX_BYTES}",
            name="ck_summary_files_size_bytes",
        ),
        CheckConstraint(
            "content_type = 'application/pdf'",
            name="ck_summary_files_content_type_pdf",
        ),
    )

    summary_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("summaries.id", ondelete="CASCADE"),
        primary_key=True,
    )
    storage_key: Mapped[str] = mapped_column(Unicode(512), nullable=False)
    original_name: Mapped[str] = mapped_column(Unicode(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    summary: Mapped[Summary] = relationship(back_populates="file")
