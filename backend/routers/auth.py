# Authentication: register, email OTP, login (rate-limited), refresh, reset, sessions.
import os
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core import COLL, db, now
from notify import email_otp, email_welcome, audit, notify
from security import (client_ip, create_access_token, create_refresh_token, decode_token,
                      gen_otp, hash_password, otp_hash, rate_limiter, verify_password, CurrentUser,
                      get_current_user)

router = APIRouter(prefix="/api/auth", tags=["auth"])

OTP_DEV_ECHO = os.environ.get("OTP_DEV_ECHO", "false").lower() == "true"
MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def public_user(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]), "role": doc.get("role", "client"), "name": doc.get("name", ""),
        "email": doc.get("email", ""), "mobile": doc.get("mobile", ""), "client_code": doc.get("client_code"),
        "status": doc.get("status", "active"), "language": doc.get("language", "en"),
        "permissions": doc.get("permissions", []), "profile": doc.get("profile", {}),
        "notification_prefs": doc.get("notification_prefs", {"email": True, "whatsapp": True, "push": True}),
        "pan": doc.get("pan", ""), "address": doc.get("address", ""),
        "created_at": doc.get("created_at"),
    }


async def _send_otp(email: str, name: str, purpose: str) -> dict:
    if not rate_limiter.check(f"otp:{email.lower()}", 3, 600):
        raise HTTPException(status_code=429, detail="Too many OTP requests. Try again in 10 minutes.")
    code = gen_otp()
    await db[COLL["otps"]].update_one(
        {"email": email.lower()},
        {"$set": {"hash": otp_hash(email, code), "purpose": purpose, "attempts": 0,
                  "expires_at": now().timestamp() + 600, "created_at": now()}},
        upsert=True,
    )
    await email_otp(email, code, purpose)
    resp: dict = {"ok": True, "email": email}
    # Never echo reset OTPs (account-takeover risk); register/login OTPs may echo
    # only in explicit dev/preview mode for automated testing convenience.
    if OTP_DEV_ECHO and purpose != "reset":
        resp["dev_otp"] = code
    return resp


async def _consume_otp(email: str, code: str, purpose: str) -> dict:
    otp_doc = await db[COLL["otps"]].find_one({"email": email.lower()})
    if not otp_doc or otp_doc.get("expires_at", 0) < now().timestamp():
        raise HTTPException(status_code=400, detail="OTP expired. Request a new code.")
    if otp_doc.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Request a new code.")
    if otp_doc.get("purpose") != purpose:
        raise HTTPException(status_code=400, detail="This code cannot be used for this action.")
    if otp_doc.get("hash") != otp_hash(email, code):
        await db[COLL["otps"]].update_one({"_id": otp_doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect OTP")
    await db[COLL["otps"]].delete_one({"_id": otp_doc["_id"]})
    return otp_doc


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    mobile: str
    password: str = Field(min_length=8, max_length=72)


@router.post("/register")
async def register(body: RegisterIn, request: Request):
    if not rate_limiter.check(f"register:{client_ip(request)}", 10, 3600):
        raise HTTPException(status_code=429, detail="Too many attempts. Try later.")
    mobile = body.mobile.strip()
    if not MOBILE_RE.match(mobile):
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit Indian mobile number")
    email_l = body.email.lower()
    if await db.users.find_one({"$or": [{"email": email_l}, {"mobile": mobile}]}):
        raise HTTPException(status_code=409, detail="An account already exists with this email or mobile")
    seq = await db[COLL["counters"]].find_one_and_update({"_id": "client_code"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    client_code = f"TM-{int(seq['seq']):06d}"
    res = await db.users.insert_one({
        "role": "client", "name": body.name.strip(), "email": email_l, "mobile": mobile,
        "password_hash": hash_password(body.password), "status": "unverified", "client_code": client_code,
        "language": "en", "profile": {}, "created_at": now(),
    })
    await audit(str(res.inserted_id), "client", "register", f"user:{res.inserted_id}")
    out = await _send_otp(email_l, body.name, "register")
    return out


class VerifyOtpIn(BaseModel):
    email: EmailStr
    code: str


@router.post("/verify-otp")
async def verify_otp(body: VerifyOtpIn):
    email_l = body.email.lower()
    await _consume_otp(email_l, body.code.strip(), "register")
    user = await db.users.find_one_and_update({"email": email_l}, {"$set": {"status": "active"}})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.get("status") == "unverified":
        await notify(str(user["_id"]), "Welcome to taxman.manoj", "Your account is verified. Upload documents, request services and track compliance — all in one place.", "success")
        await email_welcome(email_l, user.get("name", ""), user.get("client_code", ""))
    tokens = issue_tokens(str(user["_id"]), user.get("role", "client"))
    return {**tokens, "user": public_user({**user, "status": "active"})}


class ResendIn(BaseModel):
    email: EmailStr


@router.post("/resend-otp")
async def resend_otp(body: ResendIn):
    user = await db.users.find_one({"email": body.email.lower()})
    return await _send_otp(body.email.lower(), user.get("name", "") if user else "", "register")


class LoginIn(BaseModel):
    identifier: str  # email or mobile
    password: str


@router.post("/login")
async def login(body: LoginIn, request: Request):
    ident = body.identifier.strip().lower()
    if not rate_limiter.check(f"login:{client_ip(request)}:{ident}", 5, 900):
        await audit("anonymous", "client", "login_rate_limited", ident)
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
    query = {"email": ident} if "@" in ident else {"mobile": re.sub(r"\D", "", ident)[-10:]}
    user = await db.users.find_one(query)
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("status") == "unverified":
        out = await _send_otp(user["email"], user.get("name", ""), "register")
        return {**out, "requires_otp": True}
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="Account is disabled. Contact support.")
    await audit(str(user["_id"]), user.get("role", "client"), "login", f"user:{user['_id']}")
    tokens = issue_tokens(str(user["_id"]), user.get("role", "client"))
    return {**tokens, "user": public_user(user)}


def issue_tokens(user_id: str, role: str) -> dict:
    return {"access_token": create_access_token(user_id, role),
            "refresh_token": create_refresh_token(user_id), "token_type": "bearer"}


class RefreshIn(BaseModel):
    refresh_token: str


@router.post("/refresh")
async def refresh(body: RefreshIn):
    data = decode_token(body.refresh_token, expected="refresh")
    user = await db.users.find_one({"_id": ObjectId(data["sub"])})
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=401, detail="Account unavailable")
    tokens = issue_tokens(str(user["_id"]), user.get("role", "client"))
    return {**tokens, "user": public_user(user)}


class ForgotIn(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if user:  # do not reveal whether the account exists
        return await _send_otp(body.email.lower(), user.get("name", ""), "reset")
    return {"ok": True}


class ResetIn(BaseModel):
    email: EmailStr
    code: str
    new_password: str = Field(min_length=8, max_length=72)


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    await _consume_otp(body.email.lower(), body.code.strip(), "reset")
    await db.users.update_one({"email": body.email.lower()}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}


@router.post("/logout")
async def logout(user: CurrentUser = Depends(get_current_user)):
    await audit(user.id, user.role, "logout", f"user:{user.id}")
    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    doc = await db.users.find_one({"_id": ObjectId(user.id)})
    return {"user": public_user(doc)}
