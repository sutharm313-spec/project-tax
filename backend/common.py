# Shared service-layer helpers: settings, financial years, timelines, invoices, payments.
from typing import Any, Optional

from bson import ObjectId
from fastapi import HTTPException

from core import COLL, db, iso, now, uid

FY_LIST = ["FY 2024-25", "FY 2025-26", "FY 2026-27", "FY 2027-28"]

REQUEST_STEPS = ["requested", "payment_verified", "documents_uploaded", "under_review",
                 "work_in_progress", "verification", "completed"]

STEP_LABELS = {
    "requested": "Service Requested",
    "payment_verified": "Payment Verified",
    "documents_uploaded": "Documents Uploaded",
    "under_review": "Documents Under Review",
    "work_in_progress": "Work in Progress",
    "verification": "Verification",
    "completed": "Completed",
}


async def get_settings() -> dict:
    doc = await db[COLL["settings"]].find_one({"_id": "settings"})
    if not doc:
        doc = {"_id": "settings", "business": {"name": "taxman.manoj", "legal_name": "taxman.manoj", "phone": "", "email": "", "address": ""},
               "upi": {"vpa": "", "payee_name": "taxman.manoj"}, "allow_partial_payments": False,
               "whatsapp_number": "", "expiry_reminder_days": 30}
        await db[COLL["settings"]].insert_one(doc)
    return doc


def fy_label_for(d=None) -> str:
    import datetime
    d = d or now()
    y = d.year if d.month >= 4 else d.year - 1
    return f"FY {y}-{str(y + 1)[2:]}"


def clean(doc: Optional[dict], extra_drop: list[str] | None = None) -> Optional[dict]:
    """Serialize a Mongo doc for API output: _id -> id, datetimes -> ISO strings."""
    if doc is None:
        return None
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    for k, v in list(out.items()):
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif hasattr(v, "isoformat"):
            out[k] = iso(v)
    for k in extra_drop or []:
        out.pop(k, None)
    return out


def clean_list(docs: list[dict], extra_drop: list[str] | None = None) -> list[dict]:
    return [clean(d, extra_drop) for d in docs]


async def build_timeline(req: dict, docs: list[dict]) -> list[dict]:
    state = req.get("status", "requested")
    idx = REQUEST_STEPS.index(state) if state in REQUEST_STEPS else 0
    if state == "completed":
        idx = len(REQUEST_STEPS) - 1
    elif state in ("active", "in_progress"):
        idx = max(idx, 4)
    elif state == "under_review":
        idx = max(idx, 3)
    timeline = req.get("timeline") or []
    tl = {t.get("step"): t for t in timeline}
    out = []
    for i, step in enumerate(REQUEST_STEPS):
        entry = tl.get(step) or {}
        done = i <= idx and not (step == "documents_uploaded" and not docs)
        if step == "payment_verified" and req.get("payment_status") != "verified":
            done = False
            if idx < i:
                idx = i - 1 if req.get("status") == "payment_pending" else idx
        out.append({"step": step, "label": STEP_LABELS[step], "done": done,
                    "at": entry.get("at"), "current": i == idx and not done})
    return out


async def create_invoice(client_id: str, request_id: Optional[str], service_name: str, description: str,
                         amount: int, business_id: Optional[str] = None) -> dict:
    seq = await db[COLL["counters"]].find_one_and_update({"_id": "invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    invoice = {
        "number": f"INV-{int(seq['seq']):06d}", "client_id": client_id, "request_id": request_id,
        "business_id": business_id, "service_name": service_name, "description": description,
        "amount": int(amount), "tax": 0, "total": int(amount), "status": "unpaid",
        "date": now(), "created_at": now(),
    }
    res = await db[COLL["invoices"]].insert_one(invoice)
    invoice["_id"] = res.inserted_id
    return invoice


def validate_utr(utr: str) -> str:
    t = (utr or "").strip()
    if not re_utr(t):
        raise HTTPException(status_code=400, detail="Enter a valid UPI reference number (12 digits)")
    return t


def re_utr(t: str) -> bool:
    return len(t) == 12 and t.isdigit()
