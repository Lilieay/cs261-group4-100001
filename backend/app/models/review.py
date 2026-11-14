"""U8 reviews. The external summary reference never creates the U6 tables."""

from datetime import datetime, timezone

from sqlalchemy import (CheckConstraint, Column, DateTime, ForeignKey, Index,
                        Integer, MetaData, SmallInteger, Table, Unicode, text)
from sqlalchemy.dialects.mssql import DATETIME2, TINYINT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models.user import User  # register the existing FK target
from app.models.guide import Guide
from app.models.course import Course

# A reference to U6's existing table, in separate metadata so U8 cannot create it.
# No Summary entity, PDF table, upload flow or storage is duplicated here.
summary_reference = Table(
    "summaries", MetaData(), Column("id", Integer, primary_key=True),
    Column("owner_id", Integer, nullable=False),
)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ReviewBase(DeclarativeBase):
    """Keep optional U8 DDL out of the U1–U5 initializer's create_all."""


class Review(ReviewBase):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
        CheckConstraint(
            "(guide_id IS NOT NULL AND summary_id IS NULL) OR "
            "(guide_id IS NULL AND summary_id IS NOT NULL)",
            name="ck_reviews_one_target",
        ),
        Index("ux_reviews_guide_author", "guide_id", "author_id", unique=True,
              mssql_where=text("guide_id IS NOT NULL"),
              sqlite_where=text("guide_id IS NOT NULL")),
        Index("ux_reviews_summary_author", "summary_id", "author_id", unique=True,
              mssql_where=text("summary_id IS NOT NULL"),
              sqlite_where=text("summary_id IS NOT NULL")),
        Index("ix_reviews_guide_created_id", "guide_id", text("created_at DESC"),
              text("id DESC"), mssql_where=text("guide_id IS NOT NULL")),
        Index("ix_reviews_summary_created_id", "summary_id", text("created_at DESC"),
              text("id DESC"), mssql_where=text("summary_id IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    author_id: Mapped[int] = mapped_column(ForeignKey(User.__table__.c.id), nullable=False)
    guide_id: Mapped[int | None] = mapped_column(
        ForeignKey(Guide.__table__.c.id, ondelete="CASCADE"), nullable=True)
    summary_id: Mapped[int | None] = mapped_column(
        ForeignKey(summary_reference.c.id, ondelete="CASCADE"), nullable=True)
    rating: Mapped[int] = mapped_column(
        SmallInteger().with_variant(TINYINT(), "mssql"), nullable=False)
    comment: Mapped[str | None] = mapped_column(Unicode(4000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME2(precision=3), "mssql"), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME2(precision=3), "mssql"), default=utc_now)
