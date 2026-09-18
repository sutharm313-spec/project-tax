# Private document storage: MongoDB GridFS (private bucket equivalent) +
# short-lived signed file tokens. Files are NEVER served from a public URL.
import os
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from core import db, now
from security import FILE_TTL, decode_token

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "xls", "xlsx", "doc", "docx", "zip"}

_bucket: Optional[AsyncIOMotorGridFSBucket] = None


def bucket() -> AsyncIOMotorGridFSBucket:
    global _bucket
    if _bucket is None:
        _bucket = AsyncIOMotorGridFSBucket(db, bucket_name="secure_docs")
    return _bucket


def validate_file(filename: str, size: int) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"File type .{ext} is not allowed")
    if size <= 0 or size > MAX_UPLOAD_BYTES:
        raise ValueError("File size must be between 1 byte and 25 MB")
    return ext


def file_token(doc_id: str, user_id: str, action: str) -> str:
    from security import _token
    return _token({"doc": doc_id, "usr": user_id, "act": action, "typ": "file"}, FILE_TTL)


def verify_file_token(token: str) -> dict:
    return decode_token(token, expected="file")


async def put_file(data: bytes, filename: str, content_type: str, meta: dict) -> str:
    grid_id = await bucket().upload_from_stream(
        filename, data, metadata={"contentType": content_type or "application/octet-stream", **meta, "uploaded_at": now()}
    )
    return str(grid_id)


async def get_file(grid_id: str) -> tuple[bytes, str, str]:
    stream = await bucket().open_download_stream(ObjectId(grid_id))
    data = await stream.read()
    meta = stream.metadata or {}
    return data, meta.get("contentType", "application/octet-stream"), stream.filename
