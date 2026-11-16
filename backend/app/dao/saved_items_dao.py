from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.saved_summary import SavedSummary
from app.models.summary import Summary


class SavedSummaryDAO:
    def __init__(self, session: Session):
        self.session = session

    def target_exists(self, summary_id: int) -> bool:
        return self.session.get(Summary, summary_id) is not None

    def is_saved(self, user_id: int, summary_id: int) -> bool:
        return self.session.get(SavedSummary, (user_id, summary_id)) is not None

    def insert_if_absent(self, user_id: int, summary_id: int) -> None:
        self.session.add(SavedSummary(user_id=user_id, summary_id=summary_id))
        self.session.flush()
