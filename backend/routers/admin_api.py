# Admin/Staff APIs: analytics, client management, payment verification, document
# review + manual unlock (audited), catalog, staff, leads, tickets, search,
# reports, settings. All routes require staff auth; sensitive ops check permissions.
import csv
import io
import re
from datetime import timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field

from common import (clean, clean_list, create_invoice, get_settings, enrich_payment, get_client_price,
                    ay_for_fy, payment_label, FY_LIST)
from core import COLL, db, now
from notify import (audit, email_document_status, email_payment_verified, email_service_status, email_ticket_reply,
                    notify, wa_deep_link)
from security import (DEFAULT_PERMS, STAFF_ROLES, CurrentUser, get_current_user, hash_password, has_perm,
                      rate_limiter, require_perm, require_staff, client_ip)
from routers.auth import MOBILE_RE, public_user

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_staff)])


def _rx(q: str) -> dict:
    return {"$regex": re.escape(q.strip()), "$options": "i"}


# ---------------- analytics ----------------
@router.get("/stats")
async def stats(user: CurrentUser = Depends(require_staff), fy: Optional[str] = None):
    require_perm(user, "view_reports")
    rq: dict = {}
    if fy:
        rq["fy"] = fy
    requests = await db[COLL["requests"]].find(rq).to_list(1000)
    invoices = await db[COLL["invoices"]].find(rq if not fy else {}).to_list(1000)
    payments = await db[COLL["payments"]].find({}).to_list(1000)
    clients = await db.users.count_documents({"role": "client"})
    new_clients = await db.users.count_documents({"role": "client", "created_at": {"$gte": now() - timedelta(days=30)}})
    docs = await db[COLL["documents"]].find({}).to_list(1000)
    tickets = await db[COLL["tickets"]].count_documents({"status": {"$in": ["open", "in_progress", "waiting_for_client"]}})
    revenue_by_month: dict[str, float] = {}
    for p in payments:
        if p.get("status") == "verified" and p.get("verified_at"):
            m = p["verified_at"].strftime("%Y-%m")
            revenue_by_month[m] = revenue_by_month.get(m, 0) + p.get("amount", 0)
    client_growth: dict[str, int] = {}
    async for c in db.users.find({"role": "client"}, {"created_at": 1}):
        if c.get("created_at"):
            m = c["created_at"].strftime("%Y-%m")
            client_growth[m] = client_growth.get(m, 0) + 1
    dist: dict[str, int] = {}
    for r in requests:
        dist[r.get("category", "other")] = dist.get(r.get("category", "other"), 0) + 1
    pay_status: dict[str, int] = {}
    for p in payments:
        pay_status[p.get("status", "pending")] = pay_status.get(p.get("status", "pending"), 0) + 1
    doc_status: dict[str, int] = {}
    for d in docs:
        doc_status[d.get("status", "uploaded")] = doc_status.get(d.get("status", "uploaded"), 0) + 1
    staff = await db.users.find({"role": {"$in": STAFF_ROLES}}).to_list(50)
    workload = []
    for s in staff:
        c = await db[COLL["requests"]].count_documents({"assigned_staff_id": str(s["_id"])})
        workload.append({"id": str(s["_id"]), "name": s.get("name"), "role": s.get("role"), "active_requests": c})
    pending_amount = sum(i.get("total", 0) for i in invoices if i.get("status") in ("unpaid", "partial"))
    return {
        "cards": {
            "total_clients": clients, "new_clients": new_clients,
            "active_services": sum(1 for r in requests if r.get("status") in ("active", "in_progress", "under_review")),
            "pending_payments": pending_amount,
            "revenue": sum(p.get("amount", 0) for p in payments if p.get("status") == "verified"),
            "pending_documents": sum(1 for d in docs if d.get("status") == "uploaded"),
            "completed_services": sum(1 for r in requests if r.get("status") == "completed"),
            "open_tickets": tickets,
        },
        "charts": {
            "revenue_by_month": sorted(revenue_by_month.items()),
            "client_growth": sorted(client_growth.items()),
            "service_distribution": sorted(dist.items()),
            "payment_status": sorted(pay_status.items()),
            "document_status": sorted(doc_status.items()),
        },
        "staff_workload": workload,
    }


# ---------------- clients ----------------
@router.get("/clients")
async def list_clients(user: CurrentUser = Depends(require_staff), q: Optional[str] = None, require_perm_dep=None):
    require_perm(user, "view_clients")
    query = {"role": "client"}
    if q:
        query["$or"] = [{"name": _rx(q)}, {"email": _rx(q)}, {"mobile": _rx(q)}, {"client_code": _rx(q)}, {"pan": _rx(q)}]
    docs = await db.users.find(query, {"password_hash": 0}).sort("created_at", -1).limit(200).to_list(200)
    out = []
    for d in docs:
        item = clean(d)
        biz = await db[COLL["businesses"]].count_documents({"client_id": str(d["_id"])})
        reqs = await db[COLL["requests"]].count_documents({"client_id": str(d["_id"])})
        item["business_count"] = biz
        item["request_count"] = reqs
        out.append(item)
    return {"clients": out}


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    context: str = "client"  # client | business | service | document | task
    ref_id: Optional[str] = None


@router.post("/clients/{client_id}/notes")
async def add_internal_note(client_id: str, body: NoteIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_clients")
    note = {"client_id": client_id, "business_id": body.ref_id if body.context == "business" else None,
            "request_id": body.ref_id if body.context == "service" else None,
            "document_id": body.ref_id if body.context == "document" else None,
            "context": body.context, "body": body.body, "author_id": user.id, "author_name": user.name, "created_at": now()}
    res = await db[COLL["internal_notes"]].insert_one(note)
    note["_id"] = res.inserted_id
    return {"note": clean(note)}


@router.get("/clients/{client_id}/notes")
async def list_internal_notes(client_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_clients")
    docs = await db[COLL["internal_notes"]].find({"client_id": client_id}).sort("created_at", -1).to_list(200)
    return {"notes": clean_list(docs)}


@router.get("/clients/{client_id}")
async def client_detail(client_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_clients")
    doc = await db.users.find_one({"_id": ObjectId(client_id), "role": "client"}, {"password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")
    businesses = await db[COLL["businesses"]].find({"client_id": client_id}).to_list(50)
    requests = await db[COLL["requests"]].find({"client_id": client_id}).sort("created_at", -1).to_list(200)
    invoices = await db[COLL["invoices"]].find({"client_id": client_id}).sort("created_at", -1).to_list(200)
    docs_count = await db[COLL["documents"]].count_documents({"client_id": client_id})
    notes = await db[COLL["internal_notes"]].find({"client_id": client_id}).sort("created_at", -1).to_list(100)
    prices = await db[COLL["client_prices"]].find({"client_id": client_id}).sort("created_at", -1).to_list(300)
    return {"client": clean(doc), "businesses": clean_list(businesses), "requests": clean_list(requests),
            "invoices": clean_list(invoices), "documents_count": docs_count, "notes": clean_list(notes),
            "prices": clean_list(prices)}


# ---------------- client-specific private pricing ----------------
def _perm_pricing(user: CurrentUser):
    if not (has_perm(user, "manage_payments") or has_perm(user, "manage_services")):
        raise HTTPException(status_code=403, detail="Missing permission: manage pricing")


@router.get("/clients/{client_id}/prices")
async def list_client_prices(client_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_clients")
    prices = await db[COLL["client_prices"]].find({"client_id": client_id}).sort([("created_at", -1)]).to_list(500)
    services = await db[COLL["catalog"]].find({"active": True}).sort([("category", 1), ("name", 1)]).to_list(300)
    svc_out = [{"id": str(s["_id"]), "name": s["name"], "category": s["category"], "suggested_price": s.get("price", 0)} for s in services]
    return {"prices": clean_list(prices), "services": svc_out, "fy_list": FY_LIST}


class PriceIn(BaseModel):
    service_id: str
    fy: str
    amount: int
    active: bool = True


@router.post("/clients/{client_id}/prices")
async def set_client_price(client_id: str, body: PriceIn, user: CurrentUser = Depends(require_staff)):
    _perm_pricing(user)
    client = await db.users.find_one({"_id": ObjectId(client_id), "role": "client"}, {"name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    svc = await db[COLL["catalog"]].find_one({"_id": ObjectId(body.service_id)})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if body.fy not in FY_LIST:
        raise HTTPException(status_code=400, detail="Invalid financial year")
    if body.amount < 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    ay = ay_for_fy(body.fy)
    existing = await db[COLL["client_prices"]].find_one({"client_id": client_id, "service_id": body.service_id, "fy": body.fy, "ay": ay})
    hist = {"action": "set", "amount": int(body.amount), "active": body.active, "at": now(), "by": user.id, "by_name": user.name}
    if existing:
        await db[COLL["client_prices"]].update_one({"_id": existing["_id"]}, {
            "$set": {"amount": int(body.amount), "active": body.active, "updated_at": now(), "updated_by": user.name},
            "$push": {"history": hist}})
        price_id = str(existing["_id"])
    else:
        price = {"client_id": client_id, "service_id": body.service_id, "service_name": svc["name"],
                 "category": svc["category"], "fy": body.fy, "ay": ay, "amount": int(body.amount),
                 "active": body.active, "history": [hist], "created_by": user.id, "created_by_name": user.name,
                 "created_at": now(), "updated_at": now()}
        res = await db[COLL["client_prices"]].insert_one(price)
        price_id = str(res.inserted_id)
    await audit(user.id, user.role, "price_set", f"client:{client_id}", {"service": svc["name"], "fy": body.fy, "ay": ay, "amount": body.amount, "active": body.active})
    doc = await db[COLL["client_prices"]].find_one({"_id": ObjectId(price_id)})
    return {"price": clean(doc)}


class PriceEditIn(BaseModel):
    amount: Optional[int] = None
    active: Optional[bool] = None


@router.put("/prices/{price_id}")
async def edit_client_price(price_id: str, body: PriceEditIn, user: CurrentUser = Depends(require_staff)):
    _perm_pricing(user)
    price = await db[COLL["client_prices"]].find_one({"_id": ObjectId(price_id)})
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    updates: dict = {"updated_at": now(), "updated_by": user.name}
    action = "edit"
    if body.amount is not None:
        if body.amount < 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        updates["amount"] = int(body.amount)
    if body.active is not None:
        updates["active"] = body.active
        action = "activate" if body.active else "deactivate"
    hist = {"action": action, "amount": updates.get("amount", price.get("amount")),
            "active": updates.get("active", price.get("active")), "at": now(), "by": user.id, "by_name": user.name}
    await db[COLL["client_prices"]].update_one({"_id": price["_id"]}, {"$set": updates, "$push": {"history": hist}})
    await audit(user.id, user.role, f"price_{action}", f"price:{price_id}", {"amount": updates.get("amount"), "active": updates.get("active")})
    doc = await db[COLL["client_prices"]].find_one({"_id": price["_id"]})
    return {"price": clean(doc)}


@router.get("/prices/{price_id}")
async def price_history(price_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_clients")
    price = await db[COLL["client_prices"]].find_one({"_id": ObjectId(price_id)})
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    return {"price": clean(price)}


class BulkPriceIn(BaseModel):
    client_ids: list[str] = Field(default_factory=list)
    service_id: str
    fy: str
    amount: int


@router.post("/prices/bulk")
async def bulk_set_prices(body: BulkPriceIn, user: CurrentUser = Depends(require_staff)):
    _perm_pricing(user)
    svc = await db[COLL["catalog"]].find_one({"_id": ObjectId(body.service_id)})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if body.fy not in FY_LIST:
        raise HTTPException(status_code=400, detail="Invalid financial year")
    ay = ay_for_fy(body.fy)
    count = 0
    for cid in body.client_ids:
        hist = {"action": "bulk_set", "amount": int(body.amount), "active": True, "at": now(), "by": user.id, "by_name": user.name}
        existing = await db[COLL["client_prices"]].find_one({"client_id": cid, "service_id": body.service_id, "fy": body.fy, "ay": ay})
        if existing:
            await db[COLL["client_prices"]].update_one({"_id": existing["_id"]}, {"$set": {"amount": int(body.amount), "active": True, "updated_at": now(), "updated_by": user.name}, "$push": {"history": hist}})
        else:
            await db[COLL["client_prices"]].insert_one({"client_id": cid, "service_id": body.service_id, "service_name": svc["name"],
                "category": svc["category"], "fy": body.fy, "ay": ay, "amount": int(body.amount), "active": True,
                "history": [hist], "created_by": user.id, "created_by_name": user.name, "created_at": now(), "updated_at": now()})
        count += 1
    await audit(user.id, user.role, "price_bulk_set", f"service:{body.service_id}", {"clients": count, "fy": body.fy, "amount": body.amount})
    return {"ok": True, "updated": count}


# ---------------- payments verification ----------------
@router.get("/payments")
async def list_payments(user: CurrentUser = Depends(require_staff), status: Optional[str] = None):
    require_perm(user, "manage_payments")
    q: dict = {}
    if status:
        q["status"] = status
    docs = await db[COLL["payments"]].find(q).sort("created_at", -1).limit(200).to_list(200)
    out = []
    for p in docs:
        item = enrich_payment(clean(p, extra_drop=["screenshot_grid_id"]))
        item["has_screenshot"] = bool(p.get("screenshot_grid_id"))
        cl = await db.users.find_one({"_id": ObjectId(p["client_id"])}, {"name": 1, "client_code": 1, "mobile": 1, "email": 1})
        item["client"] = {"name": cl.get("name"), "client_code": cl.get("client_code"), "mobile": cl.get("mobile"), "email": cl.get("email")} if cl else None
        if p.get("request_id"):
            r = await db[COLL["requests"]].find_one({"_id": ObjectId(p["request_id"])}, {"service_name": 1, "fy": 1, "ay": 1})
            item["service"] = {"name": r.get("service_name"), "fy": r.get("fy"), "ay": r.get("ay") or ay_for_fy(r.get("fy", ""))} if r else None
        out.append(item)
    return {"payments": out}


@router.get("/payments/{payment_id}/screenshot")
async def payment_screenshot(payment_id: str, user: CurrentUser = Depends(require_staff)):
    """Issues a signed short-lived link to view the client's payment proof."""
    require_perm(user, "manage_payments")
    from storage import grid_token
    payment = await db[COLL["payments"]].find_one({"_id": ObjectId(payment_id)})
    if not payment or not payment.get("screenshot_grid_id"):
        raise HTTPException(status_code=404, detail="No screenshot uploaded for this payment")
    token = grid_token(payment["screenshot_grid_id"], user.id, "view")
    await audit(user.id, user.role, "payment_screenshot_viewed", f"payment:{payment_id}")
    return {"file_token": token, "expires_in": 300, "filename": payment.get("screenshot_filename")}


class VerifyIn(BaseModel):
    action: str  # approve | reject (legacy) OR status: received | not_received | under_verification
    reason: str = ""


async def _apply_payment_status(payment: dict, new_status: str, user: CurrentUser, reason: str = "") -> dict:
    """Single source of truth for payment status changes. Unlock (request
    payment_status='verified') happens ONLY for 'received'. Client can never
    call this — staff only. FY/AY scoping is inherent: unlock touches only the
    specific linked request (one service + one FY/AY)."""
    payment_id = str(payment["_id"])
    label = payment_label(new_status)
    prev = payment.get("status")
    hist = {"status": new_status, "label": label, "at": now(), "by": "staff",
            "by_id": user.id, "by_name": user.name, "note": reason}
    set_fields = {"status": new_status, "status_changed_by": user.name, "status_changed_at": now()}
    if new_status == "received":
        set_fields.update({"verified_by": user.id, "verified_by_name": user.name, "verified_at": now()})
    if reason:
        set_fields["rejection_reason"] = reason
    await db[COLL["payments"]].update_one({"_id": payment["_id"]}, {"$set": set_fields, "$push": {"history": hist}})

    if payment.get("invoice_id"):
        inv_status = "paid" if new_status == "received" else "unpaid"
        inv_set = {"status": inv_status}
        if new_status == "received":
            inv_set.update({"payment_id": payment_id, "paid_at": now()})
        await db[COLL["invoices"]].update_one({"_id": ObjectId(payment["invoice_id"])}, {"$set": inv_set})

    if payment.get("request_id"):
        if new_status == "received":
            req = await db[COLL["requests"]].find_one_and_update(
                {"_id": ObjectId(payment["request_id"])},
                {"$set": {"payment_status": "verified", "status": "in_progress"},
                 "$push": {"timeline": {"step": "payment_verified", "at": now()}}}, return_document=True)
            if req:
                client_doc = await db.users.find_one({"_id": ObjectId(payment["client_id"])})
                wa = wa_deep_link(client_doc.get("mobile", ""), "payment_verified",
                                  client_name=client_doc.get("name", "Client"), service_name=req.get("service_name"))
                await db[COLL["wa_log"]].insert_one({"client_id": payment["client_id"], **wa})
                await notify(payment["client_id"], "Payment received", f"Your payment for {req.get('service_name')} — {req.get('fy','')} is confirmed. You can now view and download your documents for this year.", "success", {"request_id": str(req["_id"])})
                invoice = await db[COLL["invoices"]].find_one({"_id": ObjectId(payment["invoice_id"])}) if payment.get("invoice_id") else None
                await email_payment_verified(client_doc["email"], client_doc.get("name", ""), req.get("service_name", ""),
                                             f"₹{payment.get('amount', 0):,}", (invoice or {}).get("number", ""), payment.get("utr", ""))
        else:
            # not_received / under_verification -> re-lock this year's service/documents
            new_req_status = "payment_pending" if new_status == "not_received" else "payment_submitted"
            await db[COLL["requests"]].update_one({"_id": ObjectId(payment["request_id"])},
                {"$set": {"payment_status": "pending" if new_status == "not_received" else "pending", "status": new_req_status}})
            msg = {"not_received": f"Your payment could not be verified. {reason}".strip(),
                   "under_verification": "Your payment is under verification. We'll confirm shortly."}[new_status]
            await notify(payment["client_id"], "Payment status updated", msg, "warning" if new_status == "under_verification" else "error", {"payment_id": payment_id})
    await audit(user.id, user.role, f"payment_{new_status}", f"payment:{payment_id}", {"prev": prev, "utr": payment.get("utr"), "amount": payment.get("amount"), "reason": reason})
    return {"ok": True, "status": new_status, "status_label": label}


class StatusIn(BaseModel):
    status: str  # received | not_received | under_verification
    reason: str = ""


@router.post("/payments/{payment_id}/status")
async def set_payment_status(payment_id: str, body: StatusIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_payments")
    if body.status not in ("received", "not_received", "under_verification"):
        raise HTTPException(status_code=400, detail="Invalid status")
    payment = await db[COLL["payments"]].find_one({"_id": ObjectId(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    reason = body.reason.strip() or ("Reference number could not be verified" if body.status == "not_received" else "")
    return await _apply_payment_status(payment, body.status, user, reason)


@router.post("/payments/{payment_id}/verify")
async def verify_payment(payment_id: str, body: VerifyIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_payments")
    payment = await db[COLL["payments"]].find_one({"_id": ObjectId(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    mapping = {"approve": "received", "reject": "not_received",
               "received": "received", "not_received": "not_received", "under_verification": "under_verification"}
    new_status = mapping.get(body.action)
    if not new_status:
        raise HTTPException(status_code=400, detail="Invalid action")
    if new_status == "received" and payment.get("status") == "received":
        return {"ok": True, "already": True}
    reason = body.reason.strip() or ("Reference number could not be verified" if new_status == "not_received" else "")
    res = await _apply_payment_status(payment, new_status, user, reason)
    # legacy response shape
    return {"ok": True, "status": "verified" if new_status == "received" else ("rejected" if new_status == "not_received" else "submitted")}


class BookkeepIn(BaseModel):
    status: str  # refunded | cancelled | partially_paid
    reason: str = ""


@router.post("/payments/{payment_id}/bookkeep")
async def bookkeep_payment(payment_id: str, body: BookkeepIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_payments")
    if body.status not in ("refunded", "cancelled", "partially_paid"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db[COLL["payments"]].find_one_and_update({"_id": ObjectId(payment_id)}, {"$set": {"status": body.status, "note": body.reason, "verified_by": user.id}}, return_document=True)
    if body.status in ("refunded", "cancelled"):
        await db[COLL["invoices"]].update_one({"_id": ObjectId(res["invoice_id"])}, {"$set": {"status": "unpaid" if body.status == "refunded" else "cancelled"}})
        if res.get("request_id") and body.status == "refunded":
            await db[COLL["requests"]].update_one({"_id": ObjectId(res["request_id"])}, {"$set": {"payment_status": "pending", "status": "payment_pending"}})
    await audit(user.id, user.role, f"payment_{body.status}", f"payment:{payment_id}", {"reason": body.reason})
    return {"payment": clean(res)}


# ---------------- documents review + manual unlock ----------------
@router.get("/documents")
async def list_documents(user: CurrentUser = Depends(require_staff), status: Optional[str] = None, request_id: Optional[str] = None):
    require_perm(user, "view_documents")
    q: dict = {}
    if status:
        q["status"] = status
    if request_id:
        q["request_id"] = request_id
    docs = await db[COLL["documents"]].find(q).sort("created_at", -1).limit(300).to_list(300)
    out = []
    for d in docs:
        item = clean(d, extra_drop=["grid_id"])
        cl = await db.users.find_one({"_id": ObjectId(d["client_id"])}, {"name": 1, "client_code": 1})
        item["client"] = {"id": d["client_id"], "name": cl.get("name"), "client_code": cl.get("client_code")} if cl else None
        out.append(item)
    return {"documents": out}


class ReviewIn(BaseModel):
    action: str  # approve | reject | reupload_required
    note: str = ""


@router.post("/documents/{doc_id}/review")
async def review_document(doc_id: str, body: ReviewIn, user: CurrentUser = Depends(require_staff)):
    if not has_perm(user, "approve_documents") and not has_perm(user, "*"):
        require_perm(user, "approve_documents")
    if body.action not in ("approve", "reject", "reupload_required"):
        raise HTTPException(status_code=400, detail="Invalid action")
    doc = await db[COLL["documents"]].find_one({"_id": ObjectId(doc_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db[COLL["documents"]].update_one({"_id": doc["_id"]}, {"$set": {"status": body.action, "review_note": body.note, "reviewed_by": user.name, "reviewed_at": now()}})
    if doc.get("request_id"):
        await db[COLL["requests"]].update_one({"_id": ObjectId(doc["request_id"]), "checklist.document_id": doc_id},
                                              {"$set": {"checklist.$.status": body.action}})
        req = await db[COLL["requests"]].find_one({"_id": ObjectId(doc["request_id"])})
        if req:
            all_done = all(c.get("status") in ("approved", "not_required", "rejected", "reupload_required") or not c.get("required") for c in req.get("checklist", []))
            if all_done and req.get("status") == "in_progress":
                await db[COLL["requests"]].update_one({"_id": req["_id"]}, {"$set": {"status": "under_review"}})
    client_doc = await db.users.find_one({"_id": ObjectId(doc["client_id"])})
    status_label = {"approve": "approved", "reject": "rejected", "reupload_required": "re-upload required"}[body.action]
    if client_doc:
        await notify(str(doc["client_id"]), f"Document {status_label}", f"{doc.get('name')}: {status_label}. {body.note}".strip(),
                     "success" if body.action == "approve" else "warning", {"document_id": doc_id})
        await email_document_status(client_doc["email"], client_doc.get("name", ""), doc.get("name", ""), status_label, body.note)
    await audit(user.id, user.role, f"document_{body.action}", f"document:{doc_id}", {"note": body.note})
    return {"ok": True, "status": body.action}


class UnlockIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/documents/{doc_id}/unlock")
async def manual_unlock(doc_id: str, body: UnlockIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "approve_documents")
    doc = await db[COLL["documents"]].find_one({"_id": ObjectId(doc_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    prev = bool(doc.get("access_unlocked_manual"))
    await db[COLL["documents"]].update_one({"_id": doc["_id"]}, {"$set": {"access_unlocked_manual": not prev}})
    await notify(str(doc["client_id"]), "Document access unlocked", f"Access to \"{doc.get('name')}\" was unlocked by our team. Reason: {body.reason}", "info", {"document_id": doc_id})
    # Full audit trail: admin, client, document/service, time, reason, previous -> new status
    await audit(user.id, user.role, "document_manual_unlock", f"document:{doc_id}", {
        "client_id": doc.get("client_id"), "request_id": doc.get("request_id"), "reason": body.reason,
        "previous_status": "locked" if not prev else "unlocked", "new_status": "unlocked" if not prev else "locked"})
    return {"ok": True, "unlocked": not prev}


# ---------------- catalog ----------------
class ChecklistItemIn(BaseModel):
    key: str
    name: str
    required: bool = True
    instructions: str = ""


class CatalogIn(BaseModel):
    name: str
    category: str
    description: str = ""
    price: int = 0
    price_type: str = "one_time"
    frequency: Optional[str] = None
    estimated_days: int = 7
    required_docs: list[ChecklistItemIn] = []
    active: bool = True


@router.get("/catalog")
async def admin_catalog(user: CurrentUser = Depends(require_staff)):
    docs = await db[COLL["catalog"]].find({}).sort([("category", 1), ("name", 1)]).to_list(300)
    return {"services": clean_list(docs)}


@router.post("/catalog")
async def create_service(body: CatalogIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    doc = {**body.model_dump(), "created_at": now()}
    res = await db[COLL["catalog"]].insert_one(doc)
    doc["_id"] = res.inserted_id
    return {"service": clean(doc)}


@router.patch("/catalog/{service_id}")
async def update_service(service_id: str, body: CatalogIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    res = await db[COLL["catalog"]].find_one_and_update({"_id": ObjectId(service_id)}, {"$set": body.model_dump()}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"service": clean(res)}


# ---------------- requests management ----------------
@router.get("/requests")
async def all_requests(user: CurrentUser = Depends(require_staff), status: Optional[str] = None, fy: Optional[str] = None):
    require_perm(user, "view_clients")
    q: dict = {}
    if status:
        q["status"] = status
    if fy:
        q["fy"] = fy
    docs = await db[COLL["requests"]].find(q).sort("created_at", -1).limit(300).to_list(300)
    out = []
    for r in docs:
        item = clean(r)
        cl = await db.users.find_one({"_id": ObjectId(r["client_id"])}, {"name": 1, "client_code": 1})
        item["client"] = {"id": r["client_id"], "name": cl.get("name"), "client_code": cl.get("client_code")} if cl else None
        out.append(item)
    return {"requests": out}


class ManageRequestIn(BaseModel):
    status: Optional[str] = None
    assigned_staff_id: Optional[str] = None
    acknowledgement_no: Optional[str] = None
    filing_date: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/requests/{request_id}")
async def manage_request(request_id: str, body: ManageRequestIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    req = await db[COLL["requests"]].find_one({"_id": ObjectId(request_id)})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    push = None
    if body.status and body.status != req.get("status"):
        push = {"step": body.status, "at": now()}
        updates.setdefault("status", body.status)
    res = await db[COLL["requests"]].find_one_and_update({"_id": req["_id"]}, ({"$set": updates, "$push": {"timeline": push}} if push else {"$set": updates}), return_document=True)
    if body.assigned_staff_id:
        await notify(str(req["client_id"]), "Staff assigned", f"{req.get('service_name')}: a team member has been assigned to your request.", "info", {"request_id": request_id})
    if body.status == "completed":
        client_doc = await db.users.find_one({"_id": ObjectId(req["client_id"])})
        await notify(str(req["client_id"]), "Service completed", f"Your {req.get('service_name')} has been completed.", "success", {"request_id": request_id})
        await email_service_status(client_doc["email"], client_doc.get("name", ""), req.get("service_name", ""), "completed")
        wa = wa_deep_link(client_doc.get("mobile", ""), "service_completed", client_name=client_doc.get("name", "Client"), service_name=req.get("service_name", ""))
        await db[COLL["wa_log"]].insert_one({"client_id": req["client_id"], **wa})
    elif body.status == "waiting_info":
        await notify(str(req["client_id"]), "Information required", f"Additional information is required for {req.get('service_name')}. Please check your request.", "warning", {"request_id": request_id})
    await audit(user.id, user.role, "request_update", f"request:{request_id}", updates)
    return {"request": clean(res)}


# ---------------- staff ----------------
class StaffIn(BaseModel):
    name: str
    email: EmailStr
    mobile: str
    password: str = Field(min_length=8, max_length=72)
    role: str
    permissions: list[str] = []


@router.get("/staff")
async def list_staff(user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_staff") if user.role not in ("super_admin", "admin") else None
    docs = await db.users.find({"role": {"$in": STAFF_ROLES}}, {"password_hash": 0}).to_list(100)
    return {"staff": clean_list(docs)}


@router.post("/staff")
async def create_staff(body: StaffIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_staff")
    if body.role not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {"role": body.role, "name": body.name, "email": body.email.lower(), "mobile": body.mobile,
           "password_hash": hash_password(body.password), "status": "active",
           "permissions": body.permissions or DEFAULT_PERMS.get(body.role, []), "created_at": now()}
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user.id, user.role, "staff_create", f"user:{res.inserted_id}", {"role": body.role})
    return {"staff": clean(doc, extra_drop=["password_hash"])}


@router.patch("/staff/{staff_id}")
async def update_staff(staff_id: str, body: dict, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_staff")
    allowed = {k: v for k, v in body.items() if k in ("role", "permissions", "status", "name")}
    if allowed.get("role") and allowed["role"] not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    res = await db.users.find_one_and_update({"_id": ObjectId(staff_id)}, {"$set": allowed}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Staff not found")
    await audit(user.id, user.role, "staff_update", f"user:{staff_id}", allowed)
    return {"staff": clean(res, extra_drop=["password_hash"])}


# ---------------- leads ----------------
class LeadIn(BaseModel):
    name: str
    mobile: str = ""
    email: str = ""
    source: str = ""
    interested_service: str = ""
    status: str = "new"
    follow_up_date: Optional[str] = None
    assigned_staff_id: Optional[str] = None
    notes: str = ""


@router.get("/leads")
async def list_leads(user: CurrentUser = Depends(require_staff), status: Optional[str] = None):
    require_perm(user, "view_clients")
    q = {"status": status} if status else {}
    docs = await db[COLL["leads"]].find(q).sort("created_at", -1).to_list(200)
    return {"leads": clean_list(docs)}


@router.post("/leads")
async def create_lead(body: LeadIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "edit_clients")
    doc = {**body.model_dump(), "created_at": now()}
    res = await db[COLL["leads"]].insert_one(doc)
    doc["_id"] = res.inserted_id
    return {"lead": clean(doc)}


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "edit_clients")
    data = body.model_dump()
    if data.get("status") == "converted":
        data["converted_at"] = now()
    res = await db[COLL["leads"]].find_one_and_update({"_id": ObjectId(lead_id)}, {"$set": data}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"lead": clean(res)}


# ---------------- tickets ----------------
@router.get("/tickets")
async def all_tickets(user: CurrentUser = Depends(require_staff), status: Optional[str] = None):
    require_perm(user, "manage_tickets")
    q = {"status": status} if status else {}
    docs = await db[COLL["tickets"]].find(q).sort("updated_at", -1).to_list(200)
    out = []
    for t in docs:
        item = clean(t)
        cl = await db.users.find_one({"_id": ObjectId(t["client_id"])}, {"name": 1, "client_code": 1})
        item["client"] = {"name": cl.get("name"), "client_code": cl.get("client_code")} if cl else None
        out.append(item)
    return {"tickets": out}


@router.get("/tickets/{ticket_id}")
async def ticket_detail(ticket_id: str, user: CurrentUser = Depends(require_staff)):
    ticket = await db[COLL["tickets"]].find_one({"_id": ObjectId(ticket_id)})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msgs = await db[COLL["ticket_messages"]].find({"ticket_id": ticket_id}).sort("created_at", 1).to_list(500)
    cl = await db.users.find_one({"_id": ObjectId(ticket["client_id"])}, {"name": 1, "client_code": 1, "email": 1})
    return {"ticket": clean(ticket), "messages": clean_list(msgs), "client": clean(cl) if cl else None}


@router.post("/tickets/{ticket_id}/messages")
async def reply_ticket(ticket_id: str, body: dict, user: CurrentUser = Depends(require_staff)):
    ticket = await db[COLL["tickets"]].find_one({"_id": ObjectId(ticket_id)})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msg = {"ticket_id": ticket_id, "sender": "staff", "sender_id": user.id, "sender_name": user.name,
           "body": str(body.get("body", ""))[:4000], "created_at": now()}
    await db[COLL["ticket_messages"]].insert_one(msg)
    await db[COLL["tickets"]].update_one({"_id": ticket["_id"]}, {"$set": {"updated_at": now(), "status": body.get("status", "in_progress") or ticket.get("status")}})
    client_doc = await db.users.find_one({"_id": ObjectId(ticket["client_id"])})
    if client_doc:
        await notify(str(client_doc["_id"]), "Ticket reply", f"Support replied to \"{ticket.get('subject')}\".", "info", {"ticket_id": ticket_id})
        await email_ticket_reply(client_doc["email"], client_doc.get("name", ""), ticket.get("subject", ""))
    await audit(user.id, user.role, "ticket_reply", f"ticket:{ticket_id}")
    return {"ok": True}


# ---------------- global search ----------------
@router.get("/search")
async def global_search(q: str, user: CurrentUser = Depends(require_staff)):
    if not q.strip():
        return {"results": []}
    results: list[dict] = []
    async for c in db.users.find({"role": "client", "$or": [{"name": _rx(q)}, {"email": _rx(q)}, {"mobile": _rx(q)}, {"client_code": _rx(q)}, {"pan": _rx(q)}]}, {"password_hash": 0}).limit(10):
        results.append({"type": "client", "id": str(c["_id"]), "title": c.get("name"), "subtitle": f"{c.get('client_code', '')} · {c.get('email', '')}"})
    async for b in db[COLL["businesses"]].find({"$or": [{"name": _rx(q)}, {"gstin": _rx(q)}]}).limit(10):
        results.append({"type": "business", "id": str(b["_id"]), "title": b.get("name"), "subtitle": b.get("gstin", "") or b.get("type", "")})
    async for r in db[COLL["requests"]].find({"$or": [{"service_name": _rx(q)}, {"fy": _rx(q)}]}).limit(10):
        results.append({"type": "service_request", "id": str(r["_id"]), "title": r.get("service_name"), "subtitle": f"{r.get('fy', '')} · {r.get('status', '')}"})
    async for i in db[COLL["invoices"]].find({"number": _rx(q)}).limit(5):
        results.append({"type": "invoice", "id": str(i["_id"]), "title": i.get("number"), "subtitle": f"₹{i.get('total', 0):,} · {i.get('status', '')}"})
    async for p in db[COLL["payments"]].find({"$or": [{"utr": _rx(q)}, {"_id": ObjectId(q) if ObjectId.is_valid(q) and len(q) == 24 else None}]}).limit(5):
        results.append({"type": "payment", "id": str(p["_id"]), "title": p.get("utr") or str(p["_id"])[:12], "subtitle": f"₹{p.get('amount', 0):,} · {p.get('status', '')}"})
    async for d in db[COLL["documents"]].find({"name": _rx(q)}).limit(10):
        results.append({"type": "document", "id": str(d["_id"]), "title": d.get("name"), "subtitle": d.get("filename", "")})
    async for t in db[COLL["tickets"]].find({"$or": [{"subject": _rx(q)}, {"description": _rx(q)}]}).limit(10):
        results.append({"type": "ticket", "id": str(t["_id"]), "title": t.get("subject"), "subtitle": t.get("status", "")})
    return {"results": results[:40]}


# ---------------- reports (CSV) ----------------
@router.get("/reports/{report_type}")
async def reports(report_type: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "view_reports") if "reports" not in user.permissions and "*" not in user.permissions else None
    rows: list[list] = []
    headers: list[str] = []
    if report_type == "clients":
        headers = ["Client ID", "Name", "Email", "Mobile", "PAN", "Businesses", "Created"]
        async for c in db.users.find({"role": "client"}):
            biz = await db[COLL["businesses"]].count_documents({"client_id": str(c["_id"])})
            rows.append([c.get("client_code", ""), c.get("name"), c.get("email"), c.get("mobile"), c.get("pan", ""), biz, str(c.get("created_at"))])
    elif report_type == "revenue":
        headers = ["Payment ID", "Client", "Service", "Amount", "Status", "Verified At"]
        async for p in db[COLL["payments"]].find({}):
            r = await db[COLL["requests"]].find_one({"_id": ObjectId(p["request_id"])}) if p.get("request_id") else None
            rows.append([str(p["_id"]), p.get("client_id"), (r or {}).get("service_name", ""), p.get("amount"), p.get("status"), str(p.get("verified_at", ""))])
    elif report_type == "services":
        headers = ["Service", "Client", "FY", "Price", "Status", "Payment"]
        async for r in db[COLL["requests"]].find({}):
            rows.append([r.get("service_name"), r.get("client_id"), r.get("fy"), r.get("price"), r.get("status"), r.get("payment_status")])
    elif report_type == "pending_documents":
        headers = ["Document", "Client", "Status", "Uploaded At"]
        async for d in db[COLL["documents"]].find({"status": {"$in": ["required", "uploaded", "rejected", "reupload_required"]}}):
            rows.append([d.get("name"), d.get("client_id"), d.get("status"), str(d.get("created_at"))])
    elif report_type == "deadlines":
        headers = ["Title", "Due Date", "Kind"]
        async for d in db[COLL["deadlines"]].find({}).sort("due_date", 1):
            rows.append([d.get("title"), d.get("due_date"), d.get("kind")])
    elif report_type == "tickets":
        headers = ["Subject", "Category", "Priority", "Status", "Created"]
        async for t in db[COLL["tickets"]].find({}):
            rows.append([t.get("subject"), t.get("category"), t.get("priority"), t.get("status"), str(t.get("created_at"))])
    else:
        raise HTTPException(status_code=404, detail="Unknown report")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f"taxman.manoj — {report_type.replace('_', ' ').title()} Report"])
    writer.writerow(headers)
    writer.writerows(rows)
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=taxmanmanoj-{report_type}.csv"})


# ---------------- audit + settings ----------------
@router.get("/audit")
async def audit_logs(user: CurrentUser = Depends(require_staff), limit: int = 100):
    if user.role not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Only admins can view audit logs")
    docs = await db[COLL["audit"]].find({}).sort("created_at", -1).limit(min(limit, 500)).to_list(500)
    return {"logs": clean_list(docs)}


@router.get("/settings")
async def get_settings_route(user: CurrentUser = Depends(require_staff)):
    return {"settings": clean(await get_settings())}


class SettingsIn(BaseModel):
    business: Optional[dict] = None
    upi: Optional[dict] = None
    allow_partial_payments: Optional[bool] = None
    whatsapp_number: Optional[str] = None
    expiry_reminder_days: Optional[int] = None


@router.put("/settings")
async def update_settings(body: SettingsIn, user: CurrentUser = Depends(require_staff)):
    if user.role not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Only admins can change settings")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db[COLL["settings"]].update_one({"_id": "settings"}, {"$set": updates}, upsert=True)
    await audit(user.id, user.role, "settings_update", "settings", updates)
    return {"settings": clean(await get_settings())}


# ---------------- invoice / receipt PDF (staff) ----------------
@router.get("/invoices/{invoice_id}/pdf")
async def admin_invoice_pdf(invoice_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_payments")
    from routers.client_api import _invoice_pdf_bytes
    invoice = await db[COLL["invoices"]].find_one({"_id": ObjectId(invoice_id)})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    data = await _invoice_pdf_bytes(invoice)
    kind = "Receipt" if invoice.get("status") == "paid" else "Invoice"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=\"taxman.manoj-{kind}-{invoice.get('number','')}.pdf\""})


# ---------------- recurring services ----------------
def _advance(date_str: str, freq: str) -> str:
    from datetime import date
    y, m, d = [int(x) for x in date_str[:10].split("-")]
    step = {"monthly": 1, "quarterly": 3, "annual": 12}.get(freq, 1)
    m += step
    while m > 12:
        m -= 12; y += 1
    dd = min(d, [31, 29 if y % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, dd).isoformat()


class RecurringIn(BaseModel):
    client_id: str
    business_id: str
    service_id: str
    fy: str
    frequency: str  # monthly | quarterly | annual
    amount: int
    next_due: str  # YYYY-MM-DD
    assigned_staff_id: Optional[str] = None


@router.get("/recurring")
async def list_recurring(user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    docs = await db[COLL["recurring"]].find({}).sort("next_due", 1).to_list(300)
    out = []
    for r in docs:
        item = clean(r)
        cl = await db.users.find_one({"_id": ObjectId(r["client_id"])}, {"name": 1, "client_code": 1})
        item["client"] = {"name": (cl or {}).get("name"), "client_code": (cl or {}).get("client_code")} if cl else None
        out.append(item)
    return {"recurring": out}


@router.post("/recurring")
async def create_recurring(body: RecurringIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    if body.frequency not in ("monthly", "quarterly", "annual"):
        raise HTTPException(status_code=400, detail="Invalid frequency")
    if body.fy not in FY_LIST:
        raise HTTPException(status_code=400, detail="Invalid financial year")
    svc = await db[COLL["catalog"]].find_one({"_id": ObjectId(body.service_id)})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    # ensure a client price exists for this service+fy so auto-created requests are payable
    ay = ay_for_fy(body.fy)
    existing_price = await db[COLL["client_prices"]].find_one({"client_id": body.client_id, "service_id": body.service_id, "fy": body.fy, "ay": ay})
    if not existing_price:
        await db[COLL["client_prices"]].insert_one({"client_id": body.client_id, "service_id": body.service_id, "service_name": svc["name"],
            "category": svc["category"], "fy": body.fy, "ay": ay, "amount": int(body.amount), "active": True,
            "history": [{"action": "recurring_set", "amount": int(body.amount), "active": True, "at": now(), "by": user.id, "by_name": user.name}],
            "created_by": user.id, "created_by_name": user.name, "created_at": now(), "updated_at": now()})
    plan = {"client_id": body.client_id, "business_id": body.business_id, "service_id": body.service_id,
            "service_name": svc["name"], "category": svc["category"], "fy": body.fy, "ay": ay,
            "frequency": body.frequency, "amount": int(body.amount), "next_due": body.next_due[:10],
            "assigned_staff_id": body.assigned_staff_id, "active": True, "runs": 0,
            "created_by": user.id, "created_at": now()}
    res = await db[COLL["recurring"]].insert_one(plan)
    plan["_id"] = res.inserted_id
    await audit(user.id, user.role, "recurring_created", f"client:{body.client_id}", {"service": svc["name"], "frequency": body.frequency})
    return {"recurring": clean(plan)}


class RecurringEditIn(BaseModel):
    active: Optional[bool] = None
    amount: Optional[int] = None
    next_due: Optional[str] = None


@router.put("/recurring/{plan_id}")
async def edit_recurring(plan_id: str, body: RecurringEditIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    updates = {k: (v[:10] if k == "next_due" and isinstance(v, str) else v) for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db[COLL["recurring"]].update_one({"_id": ObjectId(plan_id)}, {"$set": updates})
    await audit(user.id, user.role, "recurring_updated", f"recurring:{plan_id}", updates)
    doc = await db[COLL["recurring"]].find_one({"_id": ObjectId(plan_id)})
    return {"recurring": clean(doc)}


async def run_recurring(actor_id: str = "system", actor_role: str = "system") -> int:
    """Create service requests + invoices for any recurring plan that is due."""
    from datetime import date
    today = date.today().isoformat()
    created = 0
    async for plan in db[COLL["recurring"]].find({"active": True, "next_due": {"$lte": today}}):
        svc = await db[COLL["catalog"]].find_one({"_id": ObjectId(plan["service_id"])})
        if not svc:
            continue
        amount = int(plan["amount"])
        req = {"client_id": plan["client_id"], "business_id": plan["business_id"], "fy": plan["fy"], "ay": plan.get("ay"),
               "service_id": plan["service_id"], "service_name": plan["service_name"], "category": plan["category"],
               "price": amount, "status": "payment_pending", "payment_status": "pending", "recurring_id": str(plan["_id"]),
               "checklist": [{"key": c["key"], "name": c["name"], "required": c.get("required", True),
                              "instructions": c.get("instructions", ""), "status": "required", "document_id": None}
                             for c in svc.get("required_docs", [])],
               "timeline": [{"step": "requested", "at": now()}], "workspace": {},
               "assigned_staff_id": plan.get("assigned_staff_id"), "notes": "Auto-created recurring service", "created_at": now()}
        res = await db[COLL["requests"]].insert_one(req)
        await create_invoice(plan["client_id"], str(res.inserted_id), plan["service_name"],
                             f"{plan['service_name']} — {plan['fy']} ({plan.get('ay','')}) · recurring", amount, plan["business_id"])
        await db[COLL["recurring"]].update_one({"_id": plan["_id"]}, {"$set": {"next_due": _advance(plan["next_due"], plan["frequency"]), "last_run": now()}, "$inc": {"runs": 1}})
        await notify(plan["client_id"], "New recurring service", f"{plan['service_name']} for {plan['fy']} is ready. Upload documents and complete payment.", "info", {"request_id": str(res.inserted_id)})
        created += 1
    return created


@router.post("/recurring/run")
async def run_recurring_route(user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    n = await run_recurring(user.id, user.role)
    await audit(user.id, user.role, "recurring_run", "recurring", {"created": n})
    return {"ok": True, "created": n}


# ---------------- deadlines + reminders + document expiry ----------------
class DeadlineIn(BaseModel):
    title: str
    due_date: str  # YYYY-MM-DD
    kind: str = "compliance"
    client_id: Optional[str] = None
    business_id: Optional[str] = None
    is_expiry: bool = False


@router.get("/deadlines")
async def list_deadlines(user: CurrentUser = Depends(require_staff)):
    docs = await db[COLL["deadlines"]].find({"deleted_at": {"$exists": False}}).sort("due_date", 1).to_list(500)
    out = []
    for d in docs:
        item = clean(d)
        if d.get("client_id"):
            cl = await db.users.find_one({"_id": ObjectId(d["client_id"])}, {"name": 1, "client_code": 1})
            item["client"] = {"name": (cl or {}).get("name"), "client_code": (cl or {}).get("client_code")} if cl else None
        out.append(item)
    return {"deadlines": out}


@router.post("/deadlines")
async def create_deadline(body: DeadlineIn, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    d = {"title": body.title.strip(), "due_date": body.due_date[:10], "kind": body.kind,
         "client_id": body.client_id or None, "business_id": body.business_id or None,
         "is_expiry": body.is_expiry, "reminded_at": None, "created_at": now()}
    res = await db[COLL["deadlines"]].insert_one(d)
    d["_id"] = res.inserted_id
    await audit(user.id, user.role, "deadline_created", "deadline", {"title": body.title, "due": body.due_date})
    return {"deadline": clean(d)}


@router.delete("/deadlines/{deadline_id}")
async def delete_deadline(deadline_id: str, user: CurrentUser = Depends(require_staff)):
    require_perm(user, "manage_services")
    await db[COLL["deadlines"]].update_one({"_id": ObjectId(deadline_id)}, {"$set": {"deleted_at": now()}})
    return {"ok": True}


async def run_deadline_reminders() -> int:
    """Notify clients + staff for deadlines/expiries falling within the reminder
    window. Each deadline is reminded at most once per day."""
    from datetime import date, timedelta as td
    settings = await get_settings()
    window = int(settings.get("expiry_reminder_days") or 30)
    today = date.today()
    horizon = (today + td(days=window)).isoformat()
    today_s = today.isoformat()
    staff_users = await db.users.find({"role": {"$in": ["super_admin", "admin", "manager"]}}).to_list(20)
    sent = 0
    async for d in db[COLL["deadlines"]].find({"due_date": {"$lte": horizon, "$gte": today_s}, "deleted_at": {"$exists": False}}):
        last = d.get("reminded_at")
        if last and str(last)[:10] == today_s:
            continue
        title = d.get("title", "Deadline")
        due = d.get("due_date", "")
        kind = "Expiry" if d.get("is_expiry") else "Deadline"
        if d.get("client_id"):
            await notify(d["client_id"], f"{kind} approaching", f"{title} is due on {due}. Please act in time.", "warning", {"deadline_id": str(d["_id"])})
        for s in staff_users:
            await notify(str(s["_id"]), f"{kind} approaching", f"{title} due {due}" + (" (client-specific)" if d.get("client_id") else ""), "warning", {"deadline_id": str(d["_id"])})
        await db[COLL["deadlines"]].update_one({"_id": d["_id"]}, {"$set": {"reminded_at": now()}})
        sent += 1
    return sent


@router.post("/deadlines/run-reminders")
async def run_reminders_route(user: CurrentUser = Depends(require_staff)):
    n = await run_deadline_reminders()
    await audit(user.id, user.role, "reminders_run", "deadlines", {"sent": n})
    return {"ok": True, "reminders_sent": n}
