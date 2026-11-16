from typing import Literal

from pydantic import BaseModel

from app.schemas.summaries import SummaryCourseDTO


SavedItemType = Literal["guide", "summary"]


class SavedItemState(BaseModel):
    item_type: SavedItemType
    item_id: int
    saved: bool


class SavedItemDTO(BaseModel):
    item_type: SavedItemType
    item_id: int
    course: SummaryCourseDTO
    title: str
    open_path: str


class SavedItemListResponse(BaseModel):
    items: list[SavedItemDTO]
