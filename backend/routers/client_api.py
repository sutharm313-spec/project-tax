# Client-facing APIs: dashboard, businesses, catalog, service requests, documents,
# UPI payments, tickets, notifications, profile. Every query is scoped to the
# authenticated user id — client isolation is enforced server-side.
import base64
import io
from typing import Optional

import qrcode
from bson import ObjectId
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from common import (FY_LIST, build_timeline, clean, clean_list, create_invoice, enrich_payment, get_settings,
                    get_client_price, ay_for_fy, re_utr, validate_utr)
from core import COLL, db, now
from notify import (audit, email_document_status, email_payment_verified, email_service_status, email_ticket_reply,
                    log_doc_access, notify, wa_deep_link)
from security import CurrentUser, get_current_user, rate_limiter

router = APIRouter(prefix="/api", tags=["client"])


async def _own_request(user: CurrentUser, request_id: str) -> dict:
    req = await db[COLL["requests"]].find_one({"_id": ObjectId(request_id), "client_id": user.id})
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found")
    return req


def _locked(doc: dict, request_map: dict[str, dict]) -> bool:
    """View/download lock: service-linked documents stay locked until that
    request's payment is verified server-side (or admin manual unlock)."""
    if doc.get("access_unlocked_manual"):
        return False
    rid = doc.get("request_id")
    if not rid:
        return False  # client's own general business documents
    req = request_map.get(rid)
    if not req:
        return True
    return req.get("payment_status") != "verified"


def _doc_view(doc: dict, request_map: dict[str, dict]) -> dict:
    out = clean(doc, extra_drop=["grid_id", "versions"])
    out["locked"] = _locked(doc, request_map)
    out["versions_count"] = len(doc.get("versions", []))
    return out


# ---------------- overview / dashboard ----------------
@router.get("/client/overview")
async def overview(user: CurrentUser = Depends(get_current_user), business_id: Optional[str] = None, fy: Optional[str] = None):
    base_q: dict = {"client_id": user.id, "deleted_at": {"$exists": False}}
    if business_id:
        base_q["business_id"] = business_id
    if fy:
        base_q["fy"] = fy
    businesses = await db[COLL["businesses"]].find({"client_id": user.id, "deleted_at": {"$exists": False}}).sort("created_at", 1).to_list(50)
    requests = await db[COLL["requests"]].find(base_q).sort("created_at", -1).to_list(200)
    request_map = {str(r["_id"]): r for r in requests}
    docs = await db[COLL["documents"]].find(base_q).sort("created_at", -1).to_list(500)
    invoices = await db[COLL["invoices"]].find({**base_q, "status": {"$in": ["unpaid", "partial"]}}).to_list(100)
    deadline_list = await db[COLL["deadlines"]].find({"$or": [{"client_id": user.id}, {"client_id": None}], "deleted_at": {"$exists": False}}).sort("due_date", 1).to_list(50)
    notifs = await db[COLL["notifications"]].find({"user_id": user.id}).sort("created_at", -1).limit(5).to_list(5)
    unread = await db[COLL["notifications"]].count_documents({"user_id": user.id, "read": False})
    open_tickets = await db[COLL["tickets"]].count_documents({"client_id": user.id, "status": {"$in": ["open", "in_progress", "waiting_for_client"]}})
    me = await db.users.find_one({"_id": ObjectId(user.id)}, {"password_hash": 0})

    profile_fields = [me.get("name"), me.get("email"), me.get("mobile"), me.get("pan"), me.get("address")]
    completion = round(100 * sum(1 for f in profile_fields if f) / len(profile_fields))

    # Action center
    actions = []
    for r in requests:
        label = f"{r.get('service_name')} · {r.get('fy', '')}"
        if r.get("payment_status") == "pending" and r.get("status") not in ("cancelled",):
            actions.append({"kind": "payment_required", "severity": "warning", "title": "Payment Required",
                            "body": f"Payment is pending for {r.get('service_name')}.", "request_id": str(r["_id"])})
        if r.get("payment_status") == "submitted":
            actions.append({"kind": "payment_review", "severity": "info", "title": "Payment Under Verification",
                            "body": f"Your UPI payment for {r.get('service_name')} is being verified.", "request_id": str(r["_id"])})
        if r.get("status") == "in_progress":
            actions.append({"kind": "in_progress", "severity": "info", "title": "Work in Progress",
                            "body": f"{r.get('service_name')} is in progress.", "request_id": str(r["_id"])})
        if r.get("status") == "completed":
            actions.append({"kind": "completed", "severity": "success", "title": "Completed",
                            "body": f"Your {r.get('service_name')} service has been completed.", "request_id": str(r["_id"])})
        if r.get("status") == "waiting_info":
            actions.append({"kind": "waiting_info", "severity": "warning", "title": "Waiting for Information",
                            "body": f"Additional information is required for {r.get('service_name')}.", "request_id": str(r["_id"])})
        for c in r.get("checklist", []):
            if c.get("required") and c.get("status") in ("required", "reupload_required"):
                pending = [c["name"]] + [x["name"] for x in r.get("checklist", []) if x.get("required") and x.get("status") in ("required", "reupload_required") and x is not c]
                actions.append({"kind": "documents_required", "severity": "warning", "title": "Documents Required",
                                "body": f"{len(pending)} document(s) required: {', '.join(pending[:3])}.", "request_id": str(r["_id"])})
                break
            if c.get("status") == "under_review":
                actions.append({"kind": "under_review", "severity": "info", "title": "Under Review",
                                "body": f"Your documents for {r.get('service_name')} are being reviewed.", "request_id": str(r["_id"])})
                break
        if r.get("status") == "under_review":
            actions.append({"kind": "under_review", "severity": "info", "title": "Under Review",
                            "body": f"Your documents for {r.get('service_name')} are being reviewed.", "request_id": str(r["_id"])})
    return {
        "user": {**clean(me), "profile_completion": completion},
        "businesses": clean_list(businesses),
        "fy_list": FY_LIST,
        "counts": {
            "businesses": len(businesses), "active_services": sum(1 for r in requests if r.get("status") in ("active", "in_progress", "under_review", "payment_submitted")),
            "pending_payments": sum(i["total"] for i in invoices),
            "pending_payment_count": len(invoices),
            "documents_required": sum(1 for r in requests for c in r.get("checklist", []) if c.get("required") and c.get("status") in ("required", "reupload_required")),
            "documents_uploaded": len(docs), "unread_notifications": unread, "open_tickets": open_tickets,
            "completed": sum(1 for r in requests if r.get("status") == "completed"),
        },
        "action_cards": actions[:12],
        "deadlines": [{"id": str(d["_id"]), "title": d.get("title"), "due_date": d.get("due_date"), "kind": d.get("kind")} for d in deadline_list[:6]],
        "notifications": clean_list(notifs),
        "recent_requests": clean_list(requests[:6]),
    }


# ---------------- businesses ----------------
class BusinessIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    type: str = "proprietorship"
    gstin: str = ""
    pan: str = ""


@router.get("/client/businesses")
async def list_businesses(user: CurrentUser = Depends(get_current_user)):
    docs = await db[COLL["businesses"]].find({"client_id": user.id}).to_list(50)
    return {"businesses": clean_list(docs)}


@router.post("/client/businesses")
async def add_business(body: BusinessIn, user: CurrentUser = Depends(get_current_user)):
    doc = {**body.model_dump(), "client_id": user.id, "created_at": now()}
    res = await db[COLL["businesses"]].insert_one(doc)
    await audit(user.id, user.role, "business_create", f"business:{res.inserted_id}", {"name": body.name})
    return {"business": clean({**doc, "_id": res.inserted_id})}


@router.patch("/client/businesses/{business_id}")
async def update_business(business_id: str, body: BusinessIn, user: CurrentUser = Depends(get_current_user)):
    res = await db[COLL["businesses"]].find_one_and_update(
        {"_id": ObjectId(business_id), "client_id": user.id}, {"$set": body.model_dump()}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Business not found")
    return {"business": clean(res)}


# ---------------- catalog ----------------
def _public_service(doc: dict) -> dict:
    """Catalog view for clients — base/standard price is NEVER exposed."""
    out = clean(doc, extra_drop=["price", "price_type"])
    out["price_visible"] = False
    return out


@router.get("/catalog")
async def catalog(category: Optional[str] = None):
    q = {"active": True}
    if category:
        q["category"] = category
    docs = await db[COLL["catalog"]].find(q).sort([("category", 1), ("name", 1)]).to_list(200)
    return {"services": [_public_service(d) for d in docs]}


@router.get("/catalog/{service_id}")
async def catalog_detail(service_id: str):
    doc = await db[COLL["catalog"]].find_one({"_id": ObjectId(service_id), "active": True})
    if not doc:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"service": _public_service(doc)}


@router.get("/client/price")
async def client_price(service_id: str, fy: str, user: CurrentUser = Depends(get_current_user)):
    """Returns ONLY this client's assigned price for the service+FY. If none is
    assigned, returns assigned=False so the client sees 'Contact us for pricing'
    and cannot pay. Standard prices are never revealed."""
    if fy not in FY_LIST:
        raise HTTPException(status_code=400, detail="Invalid financial year")
    price = await get_client_price(user.id, service_id, fy)
    if not price:
        return {"assigned": False, "amount": None, "fy": fy, "ay": ay_for_fy(fy), "currency": "INR"}
    return {"assigned": True, "amount": int(price["amount"]), "fy": fy, "ay": price.get("ay") or ay_for_fy(fy), "currency": "INR"}


# ---------------- service requests ----------------
class RequestIn(BaseModel):
    service_id: str
    business_id: str
    fy: str


@router.post("/client/requests")
async def create_request(body: RequestIn, user: CurrentUser = Depends(get_current_user)):
    svc = await db[COLL["catalog"]].find_one({"_id": ObjectId(body.service_id), "active": True})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    biz = await db[COLL["businesses"]].find_one({"_id": ObjectId(body.business_id), "client_id": user.id})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    if body.fy not in FY_LIST:
        raise HTTPException(status_code=400, detail="Invalid financial year")
    # Server-authoritative pricing: only a price assigned to THIS client for THIS
    # service + FY is valid. No standard/base price fallback. Frontend cannot set price.
    price_doc = await get_client_price(user.id, str(svc["_id"]), body.fy)
    if not price_doc:
        raise HTTPException(status_code=402, detail="Price not assigned yet. Please contact us for pricing.")
    amount = int(price_doc["amount"])
    ay = price_doc.get("ay") or ay_for_fy(body.fy)
    req = {
        "client_id": user.id, "business_id": body.business_id, "fy": body.fy, "ay": ay,
        "service_id": str(svc["_id"]), "service_name": svc["name"], "category": svc["category"],
        "price": amount, "price_id": str(price_doc["_id"]), "status": "payment_pending", "payment_status": "pending",
        "checklist": [{"key": c["key"], "name": c["name"], "required": c.get("required", True),
                       "instructions": c.get("instructions", ""), "status": "required", "document_id": None}
                      for c in svc.get("required_docs", [])],
        "timeline": [{"step": "requested", "at": now()}],
        "workspace": {}, "assigned_staff_id": None, "notes": "", "created_at": now(),
    }
    res = await db[COLL["requests"]].insert_one(req)
    req["_id"] = res.inserted_id
    invoice = await create_invoice(user.id, str(res.inserted_id), svc["name"], f"{svc['name']} — {body.fy} ({ay})", amount, body.business_id)
    staff_users = await db.users.find({"role": {"$in": ["super_admin", "admin", "manager"]}}).to_list(10)
    for s in staff_users:
        await notify(str(s["_id"]), "New service request", f"{user.name} ({user.client_code}) requested {svc['name']} — {body.fy}.", "info", {"request_id": str(res.inserted_id)})
    return {"request": clean(req), "invoice": clean(invoice)}


@router.get("/client/requests")
async def list_requests(user: CurrentUser = Depends(get_current_user), business_id: Optional[str] = None,
                        fy: Optional[str] = None, status: Optional[str] = None):
    q: dict = {"client_id": user.id, "deleted_at": {"$exists": False}}
    if business_id:
        q["business_id"] = business_id
    if fy:
        q["fy"] = fy
    if status:
        q["status"] = status
    docs = await db[COLL["requests"]].find(q).sort("created_at", -1).to_list(200)
    return {"requests": clean_list(docs)}


@router.get("/client/requests/{request_id}")
async def request_detail(request_id: str, user: CurrentUser = Depends(get_current_user)):
    req = await _own_request(user, request_id)
    docs = await db[COLL["documents"]].find({"request_id": request_id}).sort("created_at", -1).to_list(100)
    request_map = {request_id: req}
    invoice = await db[COLL["invoices"]].find_one({"request_id": request_id})
    payment = await db[COLL["payments"]].find_one({"request_id": request_id}, sort=[("created_at", -1)])
    business = await db[COLL["businesses"]].find_one({"_id": ObjectId(req["business_id"])})
    staff = None
    if req.get("assigned_staff_id"):
        s = await db.users.find_one({"_id": ObjectId(req["assigned_staff_id"])}, {"name": 1})
        staff = {"id": str(s["_id"]), "name": s.get("name")} if s else None
    return {
        "request": clean(req), "documents": [_doc_view(d, request_map) for d in docs],
        "invoice": clean(invoice), "payment": enrich_payment(clean(payment, extra_drop=[])),
        "business": clean(business), "assigned_staff": staff,
        "timeline": await build_timeline(req, docs),
    }


class WorkspaceIn(BaseModel):
    data: dict = Field(default_factory=dict)


@router.patch("/client/requests/{request_id}/workspace")
async def update_workspace(request_id: str, body: WorkspaceIn, user: CurrentUser = Depends(get_current_user)):
    req = await _own_request(user, request_id)
    merged = {**(req.get("workspace") or {}), **body.data}
    await db[COLL["requests"]].update_one({"_id": req["_id"]}, {"$set": {"workspace": merged}})
    return {"ok": True}


@router.post("/client/requests/{request_id}/cancel")
async def cancel_request(request_id: str, user: CurrentUser = Depends(get_current_user)):
    req = await _own_request(user, request_id)
    if req.get("payment_status") == "verified":
        raise HTTPException(status_code=400, detail="Paid services cannot be cancelled. Raise a support ticket.")
    await db[COLL["requests"]].update_one({"_id": req["_id"]}, {"$set": {"status": "cancelled"}})
    await db[COLL["invoices"]].update_many({"request_id": request_id, "status": "unpaid"}, {"$set": {"status": "cancelled"}})
    await audit(user.id, user.role, "request_cancel", f"request:{request_id}")
    return {"ok": True}


# ---------------- documents ----------------
@router.get("/client/documents")
async def list_documents(user: CurrentUser = Depends(get_current_user), business_id: Optional[str] = None,
                         fy: Optional[str] = None, request_id: Optional[str] = None):
    q: dict = {"client_id": user.id, "deleted_at": {"$exists": False}}
    if business_id:
        q["business_id"] = business_id
    if fy:
        q["fy"] = fy
    if request_id:
        q["request_id"] = request_id
    docs = await db[COLL["documents"]].find(q).sort("created_at", -1).to_list(500)
    rids = {d["request_id"] for d in docs if d.get("request_id")}
    reqs = await db[COLL["requests"]].find({"_id": {"$in": [ObjectId(r) for r in rids]}}).to_list(100)
    request_map = {str(r["_id"]): r for r in reqs}
    return {"documents": [_doc_view(d, request_map) for d in docs]}


async def _store_upload(user: CurrentUser, file: UploadFile, request_id: Optional[str], business_id: Optional[str],
                        fy: Optional[str], checklist_key: Optional[str], doc_name: Optional[str]) -> dict:
    from storage import put_file, validate_file
    data = await file.read()
    try:
        ext = validate_file(file.filename or "file", len(data))
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    content_type = file.content_type or "application/octet-stream"
    grid_id = await put_file(data, file.filename or "file", content_type, {"client_id": user.id})
    now_dt = now()
    doc = {
        "client_id": user.id, "business_id": business_id, "fy": fy or None,
        "request_id": request_id, "checklist_key": checklist_key,
        "name": (doc_name or file.filename or "Document").rsplit(".", 1)[0][:80],
        "filename": file.filename, "ext": ext, "size": len(data), "content_type": content_type,
        "grid_id": grid_id, "status": "uploaded", "access_unlocked_manual": False,
        "versions": [{"version": 1, "grid_id": grid_id, "filename": file.filename, "size": len(data), "uploaded_at": now_dt, "uploaded_by": user.id}],
        "created_at": now_dt,
    }
    res = await db[COLL["documents"]].insert_one(doc)
    doc["_id"] = res.inserted_id
    if request_id:
        req = await db[COLL["requests"]].find_one({"_id": ObjectId(request_id), "client_id": user.id})
        if req:
            upd: dict = {}
            new_status = "uploaded"
            if req.get("status") in ("payment_pending", "payment_submitted"):
                new_status = req["status"]
            if checklist_key:
                await db[COLL["requests"]].update_one(
                    {"_id": req["_id"], "checklist.key": checklist_key},
                    {"$set": {"checklist.$.status": new_status, "checklist.$.document_id": str(res.inserted_id)}})
            else:
                await db[COLL["requests"]].update_one({"_id": req["_id"]}, {"$push": {"checklist": {
                    "key": f"custom_{str(res.inserted_id)[:8]}", "name": doc["name"], "required": False,
                    "instructions": "", "status": "uploaded", "document_id": str(res.inserted_id)}}})
            upd["status"] = new_status if new_status != "uploaded" else req.get("status", "payment_pending")
            if upd["status"] in ("payment_pending", "payment_submitted"):
                upd.pop("status")
            await db[COLL["requests"]].update_one({"_id": req["_id"]}, {"$set": {k: v for k, v in upd.items()}})
            staff_users = await db.users.find({"role": {"$in": ["super_admin", "admin", "manager", "accountant", "tax_staff", "gst_staff"]}}).to_list(20)
            for s in staff_users:
                await notify(str(s["_id"]), "Document uploaded", f"{user.name} uploaded \"{doc['name']}\" for {req.get('service_name')} — {req.get('fy', '')}.", "info", {"request_id": request_id})
    return doc


@router.post("/client/documents")
async def upload_document(user: CurrentUser = Depends(get_current_user), file: UploadFile = None,
                          request_id: Optional[str] = Form(None), business_id: Optional[str] = Form(None),
                          fy: Optional[str] = Form(None), checklist_key: Optional[str] = Form(None),
                          doc_name: Optional[str] = Form(None)):
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")
    doc = await _store_upload(user, file, request_id if request_id else None, business_id, fy, checklist_key, doc_name)
    await audit(user.id, user.role, "document_upload", f"document:{doc['_id']}", {"name": doc["name"]})
    req_map = {}
    if request_id:
        r = await db[COLL["requests"]].find_one({"_id": ObjectId(request_id), "client_id": user.id})
        if r:
            req_map[request_id] = r
    return {"document": _doc_view(doc, req_map)}


@router.post("/client/documents/{doc_id}/replace")
async def replace_document(doc_id: str, user: CurrentUser = Depends(get_current_user), file: UploadFile = None):
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")
    doc = await db[COLL["documents"]].find_one({"_id": ObjectId(doc_id), "client_id": user.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    from storage import put_file, validate_file
    data = await file.read()
    try:
        ext = validate_file(file.filename or "file", len(data))
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    grid_id = await put_file(data, file.filename or doc["filename"], file.content_type or "application/octet-stream", {"client_id": user.id})
    version = {"version": len(doc.get("versions", [])) + 1, "grid_id": grid_id, "filename": file.filename,
               "size": len(data), "uploaded_at": now(), "uploaded_by": user.id}
    await db[COLL["documents"]].update_one({"_id": doc["_id"]}, {
        "$set": {"grid_id": grid_id, "status": "uploaded", "size": len(data), "content_type": file.content_type or doc["content_type"]},
        "$push": {"versions": version}})
    if doc.get("request_id"):
        await db[COLL["requests"]].update_one({"_id": ObjectId(doc["request_id"]), "checklist.document_id": doc_id},
                                              {"$set": {"checklist.$.status": "uploaded"}})
    await audit(user.id, user.role, "document_replace", f"document:{doc_id}", {"version": version["version"]})
    return {"ok": True}


@router.get("/client/documents/{doc_id}/access")
async def document_access(doc_id: str, user: CurrentUser = Depends(get_current_user), action: str = "view"):
    if action not in ("view", "download"):
        raise HTTPException(status_code=400, detail="Invalid action")
    doc = await db[COLL["documents"]].find_one({"_id": ObjectId(doc_id), "client_id": user.id})
    if not doc:
        await log_doc_access(user.id, doc_id, action, False, "not_found_or_not_owner")
        raise HTTPException(status_code=404, detail="Document not found")
    locked = _locked(doc, {})
    if locked and doc.get("request_id"):
        req = await db[COLL["requests"]].find_one({"_id": ObjectId(doc["request_id"])})
        locked = req is None or req.get("payment_status") != "verified"
    if locked:
        await log_doc_access(user.id, doc_id, action, False, "payment_required")
        raise HTTPException(status_code=402, detail="Payment required to view or download this document")
    from storage import file_token
    token = file_token(doc_id, user.id, action)
    await log_doc_access(user.id, doc_id, action, True, "payment_verified" if doc.get("request_id") else "client_document")
    return {"file_token": token, "expires_in": 300, "filename": doc.get("filename"), "action": action}


# ---------------- payments (UPI) ----------------
@router.post("/client/payments/initiate")
async def initiate_payment(user: CurrentUser = Depends(get_current_user), invoice_id: str = Form(...)):
    invoice = await db[COLL["invoices"]].find_one({"_id": ObjectId(invoice_id), "client_id": user.id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice is already paid")
    settings = await get_settings()
    vpa = settings.get("upi", {}).get("vpa") or "taxmanmanoj@upi"
    payee = settings.get("upi", {}).get("payee_name") or "taxman.manoj"
    existing = await db[COLL["payments"]].find_one({"invoice_id": invoice_id, "status": {"$in": ["pending", "submitted"]}})
    if existing:
        payment = existing
    else:
        payment = {"client_id": user.id, "request_id": invoice.get("request_id"), "invoice_id": invoice_id,
                   "amount": invoice["total"], "method": "upi", "status": "pending", "utr": None,
                   "created_at": now()}
        res = await db[COLL["payments"]].insert_one(payment)
        payment["_id"] = res.inserted_id
    tr = payment["invoice_id"].replace("-", "")[:18].upper() + str(payment["_id"])[-4:]
    upi_uri = f"upi://pay?pa={vpa}&pn={payee}&am={invoice['total']}.00&cu=INR&tn=Invoice {invoice['number']}&tr={tr}"
    qr_png = qrcode.make(upi_uri)
    buf = io.BytesIO()
    qr_png.save(buf, format="PNG")
    return {"payment": clean(payment), "upi_uri": upi_uri, "vpa": vpa, "payee_name": payee,
            "qr_base64": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            "invoice": clean(invoice)}


class SubmitUtrIn(BaseModel):
    utr: str


@router.post("/client/payments/{payment_id}/submit")
async def submit_payment(payment_id: str, body: SubmitUtrIn, user: CurrentUser = Depends(get_current_user)):
    payment = await db[COLL["payments"]].find_one({"_id": ObjectId(payment_id), "client_id": user.id})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.get("status") not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="This payment cannot be updated")
    utr = validate_utr(body.utr)
    await db[COLL["payments"]].update_one({"_id": payment["_id"]}, {"$set": {"status": "submitted", "utr": utr, "submitted_at": now()},
        "$push": {"history": {"status": "submitted", "label": "Under Verification", "at": now(), "by": "client", "note": f"UTR {utr} submitted"}}})
    if payment.get("request_id"):
        await db[COLL["requests"]].update_one({"_id": ObjectId(payment["request_id"])}, {"$set": {"status": "payment_submitted"}})
        req = await db[COLL["requests"]].find_one({"_id": ObjectId(payment["request_id"])})
        staff_users = await db.users.find({"role": {"$in": ["super_admin", "admin", "manager", "accountant"]}}).to_list(20)
        for s in staff_users:
            await notify(str(s["_id"]), "Payment verification needed", f"{user.name} submitted UPI reference {utr} for {req.get('service_name', '') if req else 'service'}.", "warning", {"payment_id": payment_id})
    await audit(user.id, user.role, "payment_submitted", f"payment:{payment_id}", {"utr": utr})
    return {"ok": True, "status": "submitted", "status_label": "Under Verification"}


@router.post("/client/payments/{payment_id}/screenshot")
async def upload_payment_screenshot(payment_id: str, file: UploadFile, user: CurrentUser = Depends(get_current_user)):
    """Optional payment proof image. Stored privately in GridFS (no public URL)."""
    from storage import put_file
    payment = await db[COLL["payments"]].find_one({"_id": ObjectId(payment_id), "client_id": user.id})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    data = await file.read()
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ("jpg", "jpeg", "png", "pdf"):
        raise HTTPException(status_code=400, detail="Upload a JPG, PNG or PDF screenshot")
    if len(data) <= 0 or len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Screenshot must be under 10 MB")
    grid_id = await put_file(data, file.filename or "payment_proof", file.content_type or "image/png",
                             {"client_id": user.id, "kind": "payment_screenshot", "payment_id": payment_id})
    await db[COLL["payments"]].update_one({"_id": payment["_id"]}, {"$set": {
        "screenshot_grid_id": grid_id, "screenshot_filename": file.filename, "screenshot_ct": file.content_type,
        "screenshot_uploaded_at": now()}})
    await audit(user.id, user.role, "payment_screenshot_uploaded", f"payment:{payment_id}")
    return {"ok": True}


@router.get("/client/payments")
async def list_payments(user: CurrentUser = Depends(get_current_user), status: Optional[str] = None):
    q: dict = {"client_id": user.id, "deleted_at": {"$exists": False}}
    if status:
        q["status"] = status
    docs = await db[COLL["payments"]].find(q).sort("created_at", -1).to_list(200)
    return {"payments": [enrich_payment(p) for p in clean_list(docs)]}


@router.get("/client/invoices")
async def list_invoices(user: CurrentUser = Depends(get_current_user), status: Optional[str] = None):
    q: dict = {"client_id": user.id, "deleted_at": {"$exists": False}}
    if status:
        q["status"] = status
    docs = await db[COLL["invoices"]].find(q).sort("created_at", -1).to_list(200)
    return {"invoices": clean_list(docs)}


async def _invoice_pdf_bytes(invoice: dict) -> bytes:
    from pdf import build_invoice_pdf
    client = await db.users.find_one({"_id": ObjectId(invoice["client_id"])}, {"password_hash": 0}) or {}
    business = None
    if invoice.get("business_id"):
        business = await db[COLL["businesses"]].find_one({"_id": ObjectId(invoice["business_id"])})
    settings = await get_settings()
    paid = invoice.get("status") == "paid"
    payment = None
    if invoice.get("payment_id"):
        payment = await db[COLL["payments"]].find_one({"_id": ObjectId(invoice["payment_id"])})
    elif invoice.get("request_id"):
        payment = await db[COLL["payments"]].find_one({"request_id": invoice["request_id"], "status": {"$in": ["verified", "received"]}}, sort=[("created_at", -1)])
    return build_invoice_pdf(invoice, client, business, settings, paid, payment)


@router.get("/client/invoices/{invoice_id}/pdf")
async def client_invoice_pdf(invoice_id: str, user: CurrentUser = Depends(get_current_user)):
    invoice = await db[COLL["invoices"]].find_one({"_id": ObjectId(invoice_id), "client_id": user.id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    data = await _invoice_pdf_bytes(invoice)
    kind = "Receipt" if invoice.get("status") == "paid" else "Invoice"
    fname = f"taxman.manoj-{kind}-{invoice.get('number','')}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=\"{fname}\""})


# ---------------- notifications ----------------
@router.get("/client/notifications")
async def list_notifications(user: CurrentUser = Depends(get_current_user), unread: Optional[bool] = None):
    q: dict = {"user_id": user.id}
    if unread:
        q["read"] = False
    docs = await db[COLL["notifications"]].find(q).sort("created_at", -1).limit(100).to_list(100)
    return {"notifications": clean_list(docs)}


@router.post("/client/notifications/{notification_id}/read")
async def read_notification(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    await db[COLL["notifications"]].update_one({"_id": ObjectId(notification_id), "user_id": user.id}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/client/notifications/read-all")
async def read_all_notifications(user: CurrentUser = Depends(get_current_user)):
    await db[COLL["notifications"]].update_many({"user_id": user.id, "read": False}, {"$set": {"read": True}})
    return {"ok": True}


# ---------------- tickets ----------------
class TicketIn(BaseModel):
    subject: str = Field(min_length=4, max_length=120)
    category: str = "general"
    description: str = Field(min_length=5, max_length=4000)
    priority: str = "normal"


@router.post("/client/tickets")
async def create_ticket(body: TicketIn, user: CurrentUser = Depends(get_current_user)):
    ticket = {**body.model_dump(), "client_id": user.id, "status": "open", "assigned_staff_id": None, "created_at": now(), "updated_at": now()}
    res = await db[COLL["tickets"]].insert_one(ticket)
    ticket["_id"] = res.inserted_id
    msg = {"ticket_id": str(res.inserted_id), "sender": "client", "sender_id": user.id, "sender_name": user.name,
           "body": body.description, "created_at": now()}
    await db[COLL["ticket_messages"]].insert_one(msg)
    staff_users = await db.users.find({"role": {"$in": ["super_admin", "admin", "manager", "support_staff"]}}).to_list(20)
    for s in staff_users:
        await notify(str(s["_id"]), "New support ticket", f"{user.name}: {body.subject}", "info", {"ticket_id": str(res.inserted_id)})
    return {"ticket": clean(ticket)}


@router.get("/client/tickets")
async def list_tickets(user: CurrentUser = Depends(get_current_user)):
    docs = await db[COLL["tickets"]].find({"client_id": user.id}).sort("updated_at", -1).to_list(100)
    return {"tickets": clean_list(docs)}


@router.get("/client/tickets/{ticket_id}")
async def ticket_detail(ticket_id: str, user: CurrentUser = Depends(get_current_user)):
    ticket = await db[COLL["tickets"]].find_one({"_id": ObjectId(ticket_id), "client_id": user.id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msgs = await db[COLL["ticket_messages"]].find({"ticket_id": ticket_id}).sort("created_at", 1).to_list(500)
    return {"ticket": clean(ticket), "messages": clean_list(msgs)}


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.post("/client/tickets/{ticket_id}/messages")
async def ticket_message(ticket_id: str, body: MessageIn, user: CurrentUser = Depends(get_current_user)):
    ticket = await db[COLL["tickets"]].find_one({"_id": ObjectId(ticket_id), "client_id": user.id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msg = {"ticket_id": ticket_id, "sender": "client", "sender_id": user.id, "sender_name": user.name, "body": body.body, "created_at": now()}
    await db[COLL["ticket_messages"]].insert_one(msg)
    await db[COLL["tickets"]].update_one({"_id": ticket["_id"]}, {"$set": {"updated_at": now(), "status": "open" if ticket.get("status") in ("waiting_for_client", "resolved") else ticket.get("status")}})
    return {"ok": True}


# ---------------- profile / deadlines ----------------
class ProfileIn(BaseModel):
    name: Optional[str] = None
    pan: Optional[str] = None
    address: Optional[str] = None
    language: Optional[str] = None
    mobile: Optional[str] = None
    notification_prefs: Optional[dict] = None


@router.patch("/client/profile")
async def update_profile(body: ProfileIn, user: CurrentUser = Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.mobile:
        from routers.auth import MOBILE_RE
        if not MOBILE_RE.match(body.mobile.strip()):
            raise HTTPException(status_code=400, detail="Enter a valid 10-digit mobile number")
        updates["mobile"] = body.mobile.strip()
    await db.users.update_one({"_id": ObjectId(user.id)}, {"$set": updates})
    await audit(user.id, user.role, "profile_update", f"user:{user.id}")
    doc = await db.users.find_one({"_id": ObjectId(user.id)}, {"password_hash": 0})
    return {"user": clean(doc)}


@router.get("/client/deadlines")
async def list_deadlines(user: CurrentUser = Depends(get_current_user)):
    docs = await db[COLL["deadlines"]].find({"$or": [{"client_id": user.id}, {"client_id": None}]}).sort("due_date", 1).to_list(50)
    return {"deadlines": clean_list(docs)}


# ---------------- file streaming (signed short-lived token) ----------------
from fastapi import Request as FastRequest
from fastapi.responses import Response


@router.get("/files/{token}")
async def stream_file(token: str):
    from storage import get_file, verify_file_token
    try:
        data = verify_file_token(token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Link expired. Request a new view/download link.")
    doc = await db[COLL["documents"]].find_one({"_id": ObjectId(data["doc"])})
    if not doc or doc.get("client_id") != data["usr"]:
        raise HTTPException(status_code=404, detail="File not found")
    content, content_type, filename = await get_file(doc["grid_id"])
    headers = {"Content-Disposition": f"{('attachment' if data['act'] == 'download' else 'inline')}; filename=\"{filename}\""}
    return Response(content=content, media_type=content_type, headers=headers)


@router.get("/gridfiles/{token}")
async def stream_grid_file(token: str):
    """Streams an arbitrary private GridFS object (e.g. a payment screenshot)
    authorized by a signed short-lived token issued after a server-side check."""
    from storage import get_file, verify_grid_token
    try:
        data = verify_grid_token(token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Link expired. Please reopen.")
    content, content_type, filename = await get_file(data["grid"])
    headers = {"Content-Disposition": f"inline; filename=\"{filename}\""}
    return Response(content=content, media_type=content_type, headers=headers)
