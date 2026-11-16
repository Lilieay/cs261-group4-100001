from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


SavedItemType = Literal["guide", "summary"]


class SavedItemState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_type: SavedItemType
    item_id: int = Field(gt=0, le=2_147_483_647)
    saved: bool
