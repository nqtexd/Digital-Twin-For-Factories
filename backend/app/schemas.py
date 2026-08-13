from typing import Optional
from pydantic import BaseModel, Field


class FailureRequest(BaseModel):
    machine_id: str
    scenario: str
    speed: float = Field(default=0.025, ge=0.005, le=0.08)


class BrainRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    machine_id: Optional[str] = None
    conversation_id: Optional[str] = None


class BrainConversationRequest(BaseModel):
    title: str = Field(default='New conversation', min_length=1, max_length=120)
    machine_id: Optional[str] = None


class BrainKnowledgeRequest(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    content: str = Field(min_length=10, max_length=20000)
    machine_id: Optional[str] = None


class NoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    machine_id: Optional[str] = None


class MachineCreateRequest(BaseModel):
    machine_id: str = Field(min_length=3, max_length=40, pattern=r'^[A-Z0-9][A-Z0-9-]*$')
    machine_type: str = Field(min_length=2, max_length=60)
    display_name: str = Field(min_length=2, max_length=100)
    line_name: str = Field(min_length=1, max_length=80)
    layout_x: float = Field(ge=7, le=93)
    layout_y: float = Field(ge=12, le=88)
