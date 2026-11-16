from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.summaries import SummaryCourseDTO


SavedItemType = Literal["guide", "summary"]


class SavedItemState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_type: SavedItemType
    item_id: int = Field(gt=0, le=2_147_483_647)
    saved: bool


class SavedItemDTO(BaseModel):
    item_type: SavedItemType
    item_id: int
    course: SummaryCourseDTO
    title: str
    open_path: str


class SavedItemListResponse(BaseModel):
    items: list[SavedItemDTO]
