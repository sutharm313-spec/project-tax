# Security: password hashing, JWT sessions, OTP, rate limiting, auth dependencies.
import hashlib
import os
import secrets
import time
from typing import Any, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from core import db, now, uid

JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALG = "HS256"
ACCESS_TTL = 60 * 60 * 12  # 12h
REFRESH_TTL = 60 * 60 * 24 * 30  # 30d
FILE_TTL = 60 * 5  # 5 min signed file tokens

STAFF_ROLES = ["super_admin", "admin", "manager", "accountant", "tax_staff", "gst_staff", "support_staff"]
DEFAULT_PERMS: dict[str, list[str]] = {
    "super_admin": ["*"],
    "admin": ["*"],
    "manager": ["view_clients", "edit_clients", "view_documents", "approve_documents", "download_documents",
                "manage_payments", "manage_services", "view_reports"],
    "accountant": ["view_clients", "edit_clients", "view_documents", "approve_documents", "download_documents",
                   "manage_accounting", "manage_payments"],
    "tax_staff": ["view_clients", "view_documents", "download_documents", "manage_itr", "manage_tds"],
    "gst_staff": ["view_clients", "view_documents", "download_documents", "manage_gst"],
    "support_staff": ["view_clients", "view_documents", "manage_tickets"],
}


class RateLimiter:
    """Simple sliding-window limiter keyed by arbitrary string."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str, limit: int, window_s: int) -> bool:
        t = time.time()
        hits = [h for h in self._hits.get(key, []) if t - h < window_s]
        if len(hits) >= limit:
            self._hits[key] = hits
            return False
        hits.append(t)
        self._hits[key] = hits
        return True


rate_limiter = RateLimiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else None) or (request.client.host if request.client else "unknown")


# ---------- passwords ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# ---------- tokens ----------
def _token(payload: dict[str, Any], ttl: int) -> str:
    data = {**payload, "iat": int(time.time()), "exp": int(time.time()) + ttl, "jti": uid()}
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALG)


def create_access_token(user_id: str, role: str) -> str:
    return _token({"sub": user_id, "role": role, "typ": "access"}, ACCESS_TTL)


def create_refresh_token(user_id: str) -> str:
    return _token({"sub": user_id, "typ": "refresh"}, REFRESH_TTL)


def decode_token(token: str, expected: Optional[str] = None) -> dict[str, Any]:
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    if expected and data.get("typ") != expected:
        raise HTTPException(status_code=401, detail="Invalid token type")
    return data


# ---------- OTP ----------
def gen_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def otp_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{email.lower()}:{code}:{JWT_SECRET}".encode()).hexdigest()


# ---------- dependencies ----------
class CurrentUser(BaseModel):
    id: str
    role: str
    email: str
    name: str
    is_staff: bool
    permissions: list[str] = []
    client_code: Optional[str] = None
    status: str = "active"


async def _load_user(user_id: str) -> Optional[CurrentUser]:
    doc = await db.users.find_one({"_id": __import__("bson").ObjectId(user_id)}) if user_id else None
    if not doc:
        return None
    if doc.get("status") not in (None, "active"):
        return None
    return CurrentUser(
        id=str(doc["_id"]), role=doc.get("role", "client"), email=doc.get("email", ""),
        name=doc.get("name", ""), is_staff=doc.get("role") in STAFF_ROLES,
        permissions=doc.get("permissions", DEFAULT_PERMS.get(doc.get("role", "client"), [])),
        client_code=doc.get("client_code"), status=doc.get("status", "active"),
    )


async def get_current_user(request: Request) -> CurrentUser:
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    data = decode_token(token, expected="access")
    user = await _load_user(data["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Account unavailable")
    return user


async def require_staff(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_staff:
        raise HTTPException(status_code=403, detail="Staff access only")
    return user


def has_perm(user: CurrentUser, perm: str) -> bool:
    return "*" in user.permissions or perm in user.permissions


def require_perm(user: CurrentUser, perm: str) -> None:
    if not has_perm(user, perm):
        raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")
