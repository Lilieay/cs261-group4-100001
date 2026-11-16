from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SavedSummary(Base):
    __tablename__ = "saved_summaries"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), primary_key=True
    )
    summary_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("summaries.id", ondelete="CASCADE"), primary_key=True
    )
