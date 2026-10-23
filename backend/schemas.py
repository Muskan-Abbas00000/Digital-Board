from typing import Literal
from pydantic import BaseModel


class Plan(BaseModel):
    topic: str
    scenes: list[str]


class Action(BaseModel):
    type: Literal["diagram", "text", "formula", "highlight", "clear"]
    content: str
    after_sentence: int = 0


class Scene(BaseModel):
    title: str
    narration: str
    actions: list[Action]


class Intent(BaseModel):
    intent: Literal["question", "repeat", "simplify", "stop", "new_topic"]
    argument: str = ""