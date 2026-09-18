# Demo data seeding (runs once on first startup, clearly labeled demo data).
from datetime import timedelta

from core import COLL, db, now
from common import ay_for_fy
from notify import notify
from security import DEFAULT_PERMS, hash_password

MIN_PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
           b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
           b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
           b"4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 72 700 Td (taxman.manoj demo document) Tj ET\nendstream endobj\n"
           b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")


CATALOG = [
    ("ITR Filing", "income_tax", "Complete income tax return preparation and filing with expert review.", 1499, " itr", ["pan", "aadhaar", "bank_statement", "form16", "ais", "investment_proofs", "previous_itr"], 3),
    ("Revised ITR", "income_tax", "File a revised return for corrections after original ITR filing.", 999, "", ["pan", "previous_itr"], 2),
    ("ITR Consultation", "income_tax", "One-on-one consultation for income tax queries and planning.", 499, "", [], 1),
    ("Tax Planning", "income_tax", "Year-round tax saving strategy with investment planning.", 1999, "", ["form16", "investment_proofs"], 3),
    ("GST Registration", "gst", "New GST registration with documents and application tracking.", 1499, "", ["pan", "aadhaar", "bank_statement", "address_proof", "photo"], 5),
    ("GSTR-1", "gst", "Monthly/quarterly outward supplies return filing.", 799, "", ["sales_register", "purchase_register"], 2),
    ("GSTR-3B", "gst", "Monthly summary return filing with tax payment.", 799, "", ["sales_register", "purchase_register", "bank_statement"], 2),
    ("GST Reconciliation", "gst", "GSTR-2A/2B vs books reconciliation with ITC report.", 1499, "", ["purchase_register", "gstr2b"], 3),
    ("GST Annual Return", "gst", "GSTR-9/9C preparation and filing.", 4999, "", ["financial_statements", "gst_returns"], 7),
    ("GST Amendment", "gst", "Amend GST registration details like legal name, address or partners.", 999, "", ["pan", "address_proof"], 4),
    ("GST Cancellation", "gst", "Surrender or cancellation of GST registration.", 1499, "", ["gstin_certificate"], 4),
    ("GST Notices / Replies", "gst", "Drafting and filing replies to GST notices (ASMT-10, DRC-01 etc.).", 2499, "", ["notice_copy", "relevant_records"], 4),
    ("Bookkeeping", "accounting", "Day-to-day transaction recording with clean books.", 1999, "", ["bank_statement", "sales_register", "purchase_register"], 5),
    ("Monthly Accounting", "accounting", "End-to-end monthly accounting with MIS reports.", 2999, "", ["bank_statement", "sales_register", "purchase_register"], 5),
    ("Ledger Maintenance", "accounting", "Party-wise ledger maintenance and periodic review.", 999, "", ["sales_register", "purchase_register"], 3),
    ("Bank Reconciliation", "accounting", "Bank statement vs books reconciliation with report.", 799, "", ["bank_statement"], 2),
    ("Financial Statements", "accounting", "Profit & loss, balance sheet and cash flow preparation.", 2499, "", ["bank_statement", "trial_balance"], 5),
    ("TDS Return", "tds_tcs", "Quarterly TDS return filing (24Q/26Q/27Q/27EQ).", 1499, "", ["tan", "challan_details", "deductee_details"], 3),
    ("TCS Return", "tds_tcs", "Quarterly TCS return filing with challan matching.", 1499, "", ["tan", "challan_details"], 3),
    ("TDS Compliance", "tds_tcs", "Ongoing TDS compliance: rates, thresholds, due dates.", 999, "", ["tan"], 2),
    ("Form 16 / 16A", "tds_tcs", "Generation and issuance of Form 16/16A certificates.", 499, "", ["tan", "challan_details"], 2),
    ("Tax Audit", "audit", "Tax audit under section 44AB with documentation.", 14999, "", ["financial_statements", "bank_statement", "gst_returns"], 15),
    ("Audit Documentation", "audit", "Working papers, checklist and audit support file preparation.", 4999, "", ["financial_statements"], 7),
    ("Udyam Registration", "business_registration", "MSME Udyam registration certificate.", 499, "", ["aadhaar", "pan", "bank_statement"], 2),
    ("PAN Application", "business_registration", "New PAN card application for individuals and entities.", 499, "", ["aadhaar", "photo"], 3),
    ("TAN Application", "business_registration", "TAN application for TDS deduction accounts.", 499, "", ["pan"], 3),
    ("Business Registration", "business_registration", "Proprietorship / partnership / company registration support.", 2999, "", ["pan", "aadhaar", "address_proof", "bank_statement"], 7),
]

DOC_NAMES = {
    "pan": ("PAN Card", True), "aadhaar": ("Aadhaar Card", True), "bank_statement": ("Bank Statement", True),
    "form16": ("Form 16", False), "ais": ("AIS", False), "tis": ("TIS", False),
    "investment_proofs": ("Investment Proofs", False), "previous_itr": ("Previous ITR", False),
    "capital_gains": ("Capital Gains Statement", False), "sales_register": ("Sales Register", True),
    "purchase_register": ("Purchase Register", True), "gstr2b": ("GSTR-2B", False),
    "financial_statements": ("Financial Statements", False), "gst_returns": ("GST Returns Copy", False),
    "address_proof": ("Address Proof", True), "photo": ("Photograph", True),
    "tan": ("TAN Card", True), "challan_details": ("Challan Details", True),
    "deductee_details": ("Deductee Details", True), "trial_balance": ("Trial Balance", False),
    "gstin_certificate": ("GSTIN Certificate", True), "notice_copy": ("Notice Copy", True),
    "relevant_records": ("Relevant Records", False),
}


def _checklist(keys: list[str]) -> list[dict]:
    out = []
    for k in keys:
        name, required = DOC_NAMES.get(k, (k.replace("_", " ").title(), True))
        out.append({"key": k, "name": name, "required": required, "instructions": "", "status": "required", "document_id": None})
    return out


async def seed_if_empty() -> None:
    if await db.users.count_documents({}) > 0:
        return
    await db[COLL["settings"]].update_one(
        {"_id": "settings"},
        {"$set": {"business": {"name": "taxman.manoj", "legal_name": "taxman.manoj — Tax & Compliance Services",
                               "phone": "+91 98765 43210", "email": "support@taxman.manoj",
                               "address": "Office 12, Business Hub, Ahmedabad, Gujarat 380001"},
                  "upi": {"vpa": "taxmanmanoj@upi", "payee_name": "taxman.manoj"},
                  "allow_partial_payments": False, "whatsapp_number": "919876543210",
                  "expiry_reminder_days": 30}}, upsert=True)

    admin = await db.users.insert_one({
        "role": "super_admin", "name": "Manoj (Admin)", "email": "admin@taxman.manoj", "mobile": "919876543210",
        "password_hash": hash_password("Admin@123"), "status": "active", "permissions": ["*"], "created_at": now()})
    staff = await db.users.insert_one({
        "role": "accountant", "name": "Priya Sharma", "email": "staff@taxman.manoj", "mobile": "919812345678",
        "password_hash": hash_password("Staff@123"), "status": "active",
        "permissions": DEFAULT_PERMS["accountant"], "created_at": now()})
    client = await db.users.insert_one({
        "role": "client", "name": "Demo Client", "email": "demo@taxman.manoj", "mobile": "919812000000",
        "password_hash": hash_password("Demo@123"), "status": "active", "client_code": "TM-000001",
        "pan": "ABCDE1234F", "address": "12 Sample Street, Ahmedabad, Gujarat 380001", "language": "en",
        "notification_prefs": {"email": True, "whatsapp": True, "push": True}, "created_at": now()})
    client_id = str(client.inserted_id)

    biz1 = await db[COLL["businesses"]].insert_one({"client_id": client_id, "name": "Demo Traders", "type": "proprietorship", "gstin": "24ABCDE1234F1Z5", "pan": "ABCDE1234F", "created_at": now()})
    biz2 = await db[COLL["businesses"]].insert_one({"client_id": client_id, "name": "Manoj & Co.", "type": "partnership", "gstin": "", "pan": "AAAFE1234F", "created_at": now()})
    biz1_id, biz2_id = str(biz1.inserted_id), str(biz2.inserted_id)

    catalog_ids: dict[str, str] = {}
    for name, category, desc, price, _, doc_keys, days in CATALOG:
        res = await db[COLL["catalog"]].insert_one({
            "name": name, "category": category, "description": desc, "price": price, "price_type": "one_time",
            "frequency": "monthly" if name in ("GSTR-1", "GSTR-3B", "Bookkeeping", "Monthly Accounting") else None,
            "estimated_days": days, "gst_applicable": False, "active": True,
            "required_docs": [{"key": k, "name": DOC_NAMES.get(k, (k,))[0], "required": DOC_NAMES.get(k, (k, True))[1],
                               "instructions": "", } for k in doc_keys],
            "created_at": now()})
        catalog_ids[name] = str(res.inserted_id)

    # Demo client-specific PRIVATE prices (Client + Service + FY + AY).
    # No standard price is ever shown to clients; only these assigned prices apply.
    admin_id = str(admin.inserted_id)
    demo_prices = [
        ("ITR Filing", "FY 2025-26", 1499), ("ITR Filing", "FY 2026-27", 1699),
        ("GSTR-3B", "FY 2026-27", 799), ("GSTR-3B", "FY 2025-26", 799),
        ("Bookkeeping", "FY 2025-26", 1999), ("Bookkeeping", "FY 2026-27", 2199),
        ("GST Registration", "FY 2026-27", 1499), ("GSTR-1", "FY 2026-27", 699),
        ("Tax Planning", "FY 2026-27", 2499), ("TDS Return", "FY 2026-27", 1299),
    ]
    for sname, fy, amt in demo_prices:
        if sname not in catalog_ids:
            continue
        ay = ay_for_fy(fy)
        await db[COLL["client_prices"]].insert_one({
            "client_id": client_id, "service_id": catalog_ids[sname], "service_name": sname,
            "category": "", "fy": fy, "ay": ay, "amount": amt, "active": True,
            "history": [{"action": "set", "amount": amt, "active": True, "at": now(), "by": admin_id, "by_name": "Manoj (Admin)"}],
            "created_by": admin_id, "created_by_name": "Manoj (Admin)", "created_at": now(), "updated_at": now()})

    # Request 1: ITR — paid & in progress, docs uploaded
    r1 = await db[COLL["requests"]].insert_one({
        "client_id": client_id, "business_id": biz1_id, "fy": "FY 2025-26", "service_id": catalog_ids["ITR Filing"],
        "service_name": "ITR Filing", "category": "income_tax", "price": 1499, "status": "in_progress",
        "payment_status": "verified", "assigned_staff_id": str(staff.inserted_id),
        "checklist": [
            {"key": "pan", "name": "PAN Card", "required": True, "instructions": "", "status": "approved", "document_id": None},
            {"key": "aadhaar", "name": "Aadhaar Card", "required": True, "instructions": "", "status": "approved", "document_id": None},
            {"key": "form16", "name": "Form 16", "required": False, "instructions": "", "status": "under_review", "document_id": None},
            {"key": "bank_statement", "name": "Bank Statement", "required": True, "instructions": "", "status": "uploaded", "document_id": None},
        ],
        "timeline": [{"step": "requested", "at": now()}, {"step": "payment_verified", "at": now()}],
        "workspace": {"salary": 850000, "business_income": 0, "capital_gains": 0, "other_income": 12000, "deductions": 150000},
        "notes": "", "created_at": now() - timedelta(days=6)})
    inv1 = await db[COLL["invoices"]].insert_one({
        "number": "INV-000001", "client_id": client_id, "request_id": str(r1.inserted_id), "business_id": biz1_id,
        "service_name": "ITR Filing", "description": "ITR Filing — FY 2025-26", "amount": 1499, "tax": 0,
        "total": 1499, "status": "paid", "date": now() - timedelta(days=6), "created_at": now() - timedelta(days=6)})
    pay1 = await db[COLL["payments"]].insert_one({
        "client_id": client_id, "request_id": str(r1.inserted_id), "invoice_id": str(inv1.inserted_id),
        "amount": 1499, "method": "upi", "status": "verified", "utr": "123456789012",
        "verified_by": str(admin.inserted_id), "verified_by_name": "Manoj (Admin)",
        "created_at": now() - timedelta(days=6), "verified_at": now() - timedelta(days=5)})
    for key, name, status in [("pan", "PAN Card", "approved"), ("aadhaar", "Aadhaar Card", "approved"),
                              ("form16", "Form 16", "under_review"), ("bank_statement", "Bank Statement", "uploaded")]:
        g = await db["secure_docs.files"].insert_one({"length": len(MIN_PDF), "chunkSize": 261120, "uploadDate": now(), "filename": f"{name}.pdf", "metadata": {"contentType": "application/pdf"}})
        await db[f"secure_docs.chunks"].insert_one({"files_id": g.inserted_id, "n": 0, "data": MIN_PDF})
        doc_res = await db[COLL["documents"]].insert_one({
            "client_id": client_id, "business_id": biz1_id, "fy": "FY 2025-26", "request_id": str(r1.inserted_id),
            "checklist_key": key, "name": name, "filename": f"{name.replace(' ', '_')}.pdf", "ext": "pdf",
            "size": len(MIN_PDF), "content_type": "application/pdf", "grid_id": str(g.inserted_id),
            "status": status, "access_unlocked_manual": False,
            "versions": [{"version": 1, "grid_id": str(g.inserted_id), "filename": f"{name}.pdf", "size": len(MIN_PDF), "uploaded_at": now(), "uploaded_by": client_id}],
            "created_at": now() - timedelta(days=5)})
        await db[COLL["requests"]].update_one({"_id": r1.inserted_id, "checklist.key": key},
                                              {"$set": {"checklist.$.document_id": str(doc_res.inserted_id)}})

    # Request 2: GSTR-3B — payment pending (documents locked)
    r2 = await db[COLL["requests"]].insert_one({
        "client_id": client_id, "business_id": biz1_id, "fy": "FY 2026-27", "service_id": catalog_ids["GSTR-3B"],
        "service_name": "GSTR-3B", "category": "gst", "price": 799, "status": "payment_pending",
        "payment_status": "pending", "assigned_staff_id": None,
        "checklist": [{"key": "sales_register", "name": "Sales Register", "required": True, "instructions": "", "status": "required", "document_id": None},
                      {"key": "purchase_register", "name": "Purchase Register", "required": True, "instructions": "", "status": "required", "document_id": None},
                      {"key": "bank_statement", "name": "Bank Statement", "required": True, "instructions": "", "status": "required", "document_id": None}],
        "timeline": [{"step": "requested", "at": now()}], "workspace": {}, "notes": "",
        "created_at": now() - timedelta(days=2)})
    await db[COLL["invoices"]].insert_one({
        "number": "INV-000002", "client_id": client_id, "request_id": str(r2.inserted_id), "business_id": biz1_id,
        "service_name": "GSTR-3B", "description": "GSTR-3B — FY 2026-27", "amount": 799, "tax": 0, "total": 799,
        "status": "unpaid", "date": now() - timedelta(days=2), "created_at": now() - timedelta(days=2)})

    # Request 3: Bookkeeping — completed
    r3 = await db[COLL["requests"]].insert_one({
        "client_id": client_id, "business_id": biz2_id, "fy": "FY 2025-26", "service_id": catalog_ids["Bookkeeping"],
        "service_name": "Bookkeeping", "category": "accounting", "price": 1999, "status": "completed",
        "payment_status": "verified", "assigned_staff_id": str(staff.inserted_id),
        "checklist": [{"key": "bank_statement", "name": "Bank Statement", "required": True, "instructions": "", "status": "approved", "document_id": None}],
        "timeline": [{"step": "requested", "at": now() - timedelta(days=30)}, {"step": "payment_verified", "at": now() - timedelta(days=30)}, {"step": "completed", "at": now() - timedelta(days=10)}],
        "workspace": {}, "notes": "", "created_at": now() - timedelta(days=30)})
    inv3 = await db[COLL["invoices"]].insert_one({
        "number": "INV-000003", "client_id": client_id, "request_id": str(r3.inserted_id), "business_id": biz2_id,
        "service_name": "Bookkeeping", "description": "Bookkeeping — FY 2025-26", "amount": 1999, "tax": 0, "total": 1999,
        "status": "paid", "date": now() - timedelta(days=30), "created_at": now() - timedelta(days=30)})
    await db[COLL["payments"]].insert_one({
        "client_id": client_id, "request_id": str(r3.inserted_id), "invoice_id": str(inv3.inserted_id),
        "amount": 1999, "method": "upi", "status": "verified", "utr": "223456789012",
        "verified_by": str(admin.inserted_id), "verified_by_name": "Manoj (Admin)",
        "created_at": now() - timedelta(days=30), "verified_at": now() - timedelta(days=30)})

    for n in [("Payment verified", "Your payment for ITR Filing is verified. You can now view and download your documents.", "success"),
              ("3 documents required", "Bank Statement and other documents are required for GSTR-3B — FY 2026-27.", "warning"),
              ("Deadline approaching", "ITR filing deadline is approaching for FY 2025-26.", "info")]:
        await notify(client_id, n[0], n[1], n[2])
    await notify(str(admin.inserted_id), "Payment verification needed", "Demo Client submitted UPI reference 123456789012 for ITR Filing.", "warning")
    await notify(str(admin.inserted_id), "New service request", "Demo Client (TM-000001) requested GSTR-3B — FY 2026-27.", "info")

    t1 = await db[COLL["tickets"]].insert_one({
        "client_id": client_id, "subject": "Query about ITR deductions", "category": "income_tax",
        "description": "Can I claim 80G donations in my ITR?", "priority": "normal", "status": "open",
        "assigned_staff_id": None, "created_at": now() - timedelta(days=1), "updated_at": now() - timedelta(hours=20)})
    await db[COLL["ticket_messages"]].insert_many([
        {"ticket_id": str(t1.inserted_id), "sender": "client", "sender_id": client_id, "sender_name": "Demo Client",
         "body": "Can I claim 80G donations in my ITR?", "created_at": now() - timedelta(days=1)},
        {"ticket_id": str(t1.inserted_id), "sender": "staff", "sender_id": str(admin.inserted_id), "sender_name": "Manoj (Admin)",
         "body": "Yes, donations to eligible institutions qualify for 80G deduction. Share the donation receipts and we will include them.", "created_at": now() - timedelta(hours=20)}])

    for lead in [("Rakesh Patel", "9812345670", "rakesh@example.com", "referral", "GST Registration", "new", ""),
                 ("Sunita Jain", "9812345671", "sunita@example.com", "instagram", "ITR Filing", "follow_up", ""),
                 ("Amit Verma", "9812345672", "amit@example.com", "google", "Tax Audit", "proposal_sent", "")]:
        await db[COLL["leads"]].insert_one({"name": lead[0], "mobile": lead[1], "email": lead[2], "source": lead[3],
                                            "interested_service": lead[4], "status": lead[5], "follow_up_date": None,
                                            "assigned_staff_id": None, "notes": "", "created_at": now()})

    await db[COLL["deadlines"]].insert_many([
        {"client_id": None, "title": "GSTR-3B filing for the month", "due_date": "2026-07-20", "kind": "gst"},
        {"client_id": None, "title": "TDS return (Q1)", "due_date": "2026-07-31", "kind": "tds"},
        {"client_id": client_id, "title": "ITR filing deadline — FY 2025-26", "due_date": "2026-07-31", "kind": "income_tax"},
        {"client_id": None, "title": "Tax audit report (44AB)", "due_date": "2026-09-30", "kind": "audit"},
    ])
