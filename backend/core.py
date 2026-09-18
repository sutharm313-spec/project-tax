# Core: mongo connection, shared helpers, PyObjectId + BaseDocument (mongoDB adherence).
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, Field, ConfigDict
from typing_extensions import Annotated

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))  # /app/backend
load_dotenv(os.path.join(ROOT_DIR, ".env"))

mongo_url = os.environ["MONGO_URL"]
_mongo = AsyncIOMotorClient(mongo_url)
db = _mongo[os.environ.get("DB_NAME", "test_database")]


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def uid() -> str:
    return uuid.uuid4().hex


PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    """All documents map Mongo _id -> id (string). Never leak raw _id."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId = Field(alias="_id", default=None)

    @classmethod
    def from_mongo(cls, doc: dict[str, Any]) -> Optional[Any]:
        if not doc:
            return None
        data = dict(doc)
        if "_id" in data:
            data["id"] = str(data.pop("_id"))
        return cls(**data)

    def to_mongo(self) -> dict[str, Any]:
        data = self.model_dump(by_alias=True, exclude_none=True)
        if data.get("_id") is None:
            data.pop("_id", None)
        return data


async def next_seq(key: str) -> int:
    doc = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return int(doc["seq"])


def oid(s: str) -> Optional[ObjectId]:
    try:
        return ObjectId(s)
    except (InvalidId, TypeError):
        return None


# Collections used across the app
COLL = {
    "users": "users",
    "clients": "clients",
    "businesses": "businesses",
    "catalog": "service_catalog",
    "requests": "service_requests",
    "documents": "documents",
    "payments": "payments",
    "invoices": "invoices",
    "notifications": "notifications",
    "tickets": "tickets",
    "ticket_messages": "ticket_messages",
    "internal_notes": "internal_notes",
    "leads": "leads",
    "audit": "audit_logs",
    "access_logs": "document_access_logs",
    "settings": "settings",
    "otps": "otps",
    "counters": "counters",
    "wa_log": "whatsapp_messages",
    "email_log": "email_messages",
    "deadlines": "deadlines",
}
