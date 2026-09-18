"""Iteration 3 backend tests: PDF invoices/receipts, recurring plans, bulk pricing,
deadlines + reminders, plus RBAC and regression.
Run: pytest /app/backend/tests/test_iteration3_features.py -v
"""
import io
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fintech-tax-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

CLIENT_EMAIL = "demo@taxman.manoj"
CLIENT_PW = "Demo@123"
ADMIN_EMAIL = "admin@taxman.manoj"
ADMIN_PW = "Admin@123"
STAFF_EMAIL = "staff@taxman.manoj"
STAFF_PW = "Staff@123"


def _login(identifier, password):
    r = requests.post(f"{API}/auth/login", json={"identifier": identifier, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {identifier}: {r.status_code} {r.text}"
    return r.json()


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- module fixtures ----------------
@pytest.fixture(scope="module")
def client_tok():
    return _login(CLIENT_EMAIL, CLIENT_PW)["access_token"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN_EMAIL, ADMIN_PW)["access_token"]


@pytest.fixture(scope="module")
def staff_tok():
    return _login(STAFF_EMAIL, STAFF_PW)["access_token"]


@pytest.fixture(scope="module")
def client_b_tok():
    """Register a fresh secondary client for isolation tests."""
    uniq = uuid.uuid4().hex[:8]
    email = f"iso3_{uniq}@taxman.dev"
    mobile = "9" + str(int(time.time()))[-9:]
    r = requests.post(f"{API}/auth/register", json={
        "name": "Iso B", "email": email, "mobile": mobile, "password": "Passw0rd!",
    }, timeout=30)
    assert r.status_code == 200, r.text
    code = r.json()["dev_otp"]
    r2 = requests.post(f"{API}/auth/verify-otp", json={"email": email, "code": code}, timeout=30)
    assert r2.status_code == 200
    return r2.json()["access_token"]


@pytest.fixture(scope="module")
def demo_client_id(admin_tok):
    r = requests.get(f"{API}/admin/clients?q=demo", headers=H(admin_tok), timeout=15)
    assert r.status_code == 200
    for c in r.json()["clients"]:
        if c.get("email") == CLIENT_EMAIL:
            return c["id"]
    pytest.fail("demo client not found via admin search")


@pytest.fixture(scope="module")
def demo_business_id(client_tok):
    r = requests.get(f"{API}/client/businesses", headers=H(client_tok), timeout=15)
    assert r.status_code == 200
    bs = r.json()["businesses"]
    assert bs, "demo client should have businesses"
    return bs[0]["id"]


@pytest.fixture(scope="module")
def catalog_services():
    r = requests.get(f"{API}/catalog", timeout=15)
    assert r.status_code == 200
    return r.json()["services"]


# ==================================================================
# 1) PDF invoice/receipt
# ==================================================================
class TestInvoicePdf:
    def test_client_unpaid_invoice_pdf(self, client_tok):
        inv = requests.get(f"{API}/client/invoices?status=unpaid", headers=H(client_tok), timeout=15).json()["invoices"]
        assert inv, "expected at least one unpaid invoice for demo client"
        target = inv[0]
        r = requests.get(f"{API}/client/invoices/{target['id']}/pdf", headers=H(client_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF"), "unpaid PDF must start with %PDF"
        cd = r.headers.get("content-disposition", "")
        assert "Invoice" in cd, f"unpaid filename must say Invoice, got: {cd}"

    def test_client_paid_receipt_pdf(self, client_tok):
        inv = requests.get(f"{API}/client/invoices?status=paid", headers=H(client_tok), timeout=15).json()["invoices"]
        assert inv, "expected at least one paid invoice for demo client (ITR seeded)"
        r = requests.get(f"{API}/client/invoices/{inv[0]['id']}/pdf", headers=H(client_tok), timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")
        cd = r.headers.get("content-disposition", "")
        assert "Receipt" in cd, f"paid filename must say Receipt, got: {cd}"

    def test_client_b_cannot_fetch_a_invoice_pdf(self, client_tok, client_b_tok):
        inv = requests.get(f"{API}/client/invoices", headers=H(client_tok), timeout=15).json()["invoices"]
        assert inv
        r = requests.get(f"{API}/client/invoices/{inv[0]['id']}/pdf", headers=H(client_b_tok), timeout=15)
        assert r.status_code == 404, f"cross-tenant should get 404, got {r.status_code}"

    def test_admin_pdf_with_manage_payments(self, staff_tok, client_tok):
        inv = requests.get(f"{API}/client/invoices", headers=H(client_tok), timeout=15).json()["invoices"]
        assert inv
        r = requests.get(f"{API}/admin/invoices/{inv[0]['id']}/pdf", headers=H(staff_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")

    def test_admin_pdf_client_forbidden(self, client_tok):
        inv = requests.get(f"{API}/client/invoices", headers=H(client_tok), timeout=15).json()["invoices"]
        assert inv
        r = requests.get(f"{API}/admin/invoices/{inv[0]['id']}/pdf", headers=H(client_tok), timeout=15)
        assert r.status_code == 403, f"client token must be 403, got {r.status_code}"


# ==================================================================
# 2) Recurring services
# ==================================================================
class TestRecurring:
    plan_id = None

    def test_create_recurring_monthly_and_autocreate_price(self, admin_tok, demo_client_id, demo_business_id, catalog_services):
        # pick a service the demo client does NOT already have priced in an obscure FY
        # Use "Bank Reconciliation" which is intentionally unassigned per iter 2 report
        svc = next((s for s in catalog_services if s["name"] == "Bank Reconciliation"), None)
        assert svc, "Bank Reconciliation service must exist"
        # pick a next_due in the past to make run() trigger
        past = (date.today() - timedelta(days=1)).isoformat()
        payload = {
            "client_id": demo_client_id, "business_id": demo_business_id, "service_id": svc["id"],
            "fy": "FY 2024-25", "frequency": "monthly", "amount": 777, "next_due": past,
        }
        r = requests.post(f"{API}/admin/recurring", headers=H(admin_tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        plan = r.json()["recurring"]
        assert plan["frequency"] == "monthly" and plan["amount"] == 777
        assert plan["ay"] == "AY 2025-26"
        TestRecurring.plan_id = plan["id"]

        # Verify client_price was auto-created
        p = requests.get(f"{API}/client/price?service_id={svc['id']}&fy=FY 2024-25", headers={"Authorization": f"Bearer {_login(CLIENT_EMAIL, CLIENT_PW)['access_token']}"}, timeout=15)
        assert p.status_code == 200
        pj = p.json()
        assert pj.get("assigned") is True, f"auto-price should be assigned: {pj}"
        assert pj.get("amount") == 777

    def test_create_recurring_invalid_frequency(self, admin_tok, demo_client_id, demo_business_id, catalog_services):
        svc = catalog_services[0]
        r = requests.post(f"{API}/admin/recurring", headers=H(admin_tok), json={
            "client_id": demo_client_id, "business_id": demo_business_id, "service_id": svc["id"],
            "fy": "FY 2024-25", "frequency": "weekly", "amount": 100,
            "next_due": date.today().isoformat(),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_create_recurring_invalid_fy(self, admin_tok, demo_client_id, demo_business_id, catalog_services):
        svc = catalog_services[0]
        r = requests.post(f"{API}/admin/recurring", headers=H(admin_tok), json={
            "client_id": demo_client_id, "business_id": demo_business_id, "service_id": svc["id"],
            "fy": "FY 1999-00", "frequency": "monthly", "amount": 100,
            "next_due": date.today().isoformat(),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_run_creates_request_and_invoice_and_advances(self, admin_tok, client_tok):
        assert TestRecurring.plan_id, "plan must have been created"
        # snapshot invoices before
        inv_before = requests.get(f"{API}/client/invoices?status=unpaid", headers=H(client_tok), timeout=15).json()["invoices"]
        before_ids = {i["id"] for i in inv_before}
        # Run
        r = requests.post(f"{API}/admin/recurring/run", headers=H(admin_tok), json={}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Fetch plan and confirm advance
        lst = requests.get(f"{API}/admin/recurring", headers=H(admin_tok), timeout=15).json()["recurring"]
        plan = next((p for p in lst if p["id"] == TestRecurring.plan_id), None)
        assert plan is not None
        assert plan["runs"] >= 1, f"runs should be >=1, got {plan}"
        # next_due advanced past today (was yesterday + 1 month -> ~29 days out from yesterday)
        today = date.today().isoformat()
        assert plan["next_due"] > today, f"next_due should have advanced past today: {plan['next_due']}"
        assert plan.get("last_run"), "last_run should be set"

        # Verify a new unpaid invoice appeared with recurring flavor
        inv_after = requests.get(f"{API}/client/invoices?status=unpaid", headers=H(client_tok), timeout=15).json()["invoices"]
        new_invs = [i for i in inv_after if i["id"] not in before_ids]
        assert new_invs, "expected new unpaid invoice created by recurring run"
        new_inv = new_invs[0]
        assert new_inv.get("total") == 777, f"invoice amount should equal plan amount: {new_inv}"

        # Verify generated request payment_status=pending and price=777
        reqs = requests.get(f"{API}/client/requests", headers=H(client_tok), timeout=15).json()["requests"]
        # match by recurring_id via detail lookup — find one with price==777 and pending
        candidates = [r for r in reqs if r.get("price") == 777 and r.get("payment_status") == "pending"]
        assert candidates, "expected a pending recurring-generated request with price 777"

    def test_pause_recurring_and_run_skips(self, admin_tok, client_tok):
        assert TestRecurring.plan_id
        # Force next_due to today (should be picked up if active)
        today = date.today().isoformat()
        # Pause it AND set next_due to today; run should NOT create anything
        r1 = requests.put(f"{API}/admin/recurring/{TestRecurring.plan_id}", headers=H(admin_tok),
                          json={"next_due": today}, timeout=15)
        assert r1.status_code == 200
        r2 = requests.put(f"{API}/admin/recurring/{TestRecurring.plan_id}", headers=H(admin_tok),
                          json={"active": False}, timeout=15)
        assert r2.status_code == 200 and r2.json()["recurring"]["active"] is False

        inv_before = requests.get(f"{API}/client/invoices?status=unpaid", headers=H(client_tok), timeout=15).json()["invoices"]
        before_ids = {i["id"] for i in inv_before}
        rn = requests.post(f"{API}/admin/recurring/run", headers=H(admin_tok), json={}, timeout=30)
        assert rn.status_code == 200
        # Plan runs count should NOT change for this paused plan
        lst = requests.get(f"{API}/admin/recurring", headers=H(admin_tok), timeout=15).json()["recurring"]
        plan = next(p for p in lst if p["id"] == TestRecurring.plan_id)
        # Make sure paused plan wasn't re-processed: it should still have runs from previous test
        assert plan["active"] is False
        # Confirm no NEW invoice for THIS plan was created (there may be other recurring plans in DB,
        # so we only assert the paused plan didn't advance)
        assert plan["next_due"] == today, "paused plan next_due should not advance"

    def test_list_recurring_has_client_info(self, admin_tok):
        lst = requests.get(f"{API}/admin/recurring", headers=H(admin_tok), timeout=15)
        assert lst.status_code == 200
        rec = lst.json()["recurring"]
        assert rec, "expected at least one recurring plan (the one we created)"
        for r in rec:
            if r["id"] == TestRecurring.plan_id:
                assert r.get("client"), f"client info missing: {r}"
                assert r["client"].get("client_code") == "TM-000001"
                break


# ==================================================================
# 3) Bulk pricing
# ==================================================================
class TestBulkPricing:
    def test_bulk_assign_to_multiple_clients(self, admin_tok, client_tok, client_b_tok, demo_client_id, catalog_services):
        # get client B's id via /auth/me
        me_b = requests.get(f"{API}/auth/me", headers=H(client_b_tok), timeout=15).json()
        b_id = me_b["user"]["id"]

        svc = next(s for s in catalog_services if s["name"] == "Financial Statements")
        fy = "FY 2027-28"
        amount = 4321
        r = requests.post(f"{API}/admin/prices/bulk", headers=H(admin_tok), json={
            "client_ids": [demo_client_id, b_id], "service_id": svc["id"], "fy": fy, "amount": amount,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("updated") == 2

        # verify each client sees assigned=true with amount
        for tok in (client_tok, client_b_tok):
            p = requests.get(f"{API}/client/price?service_id={svc['id']}&fy={fy}", headers=H(tok), timeout=15)
            assert p.status_code == 200
            pj = p.json()
            assert pj["assigned"] is True, f"bulk price should be assigned: {pj}"
            assert pj["amount"] == amount


# ==================================================================
# 4) Deadlines + reminders
# ==================================================================
class TestDeadlines:
    deadline_id = None
    generic_id = None

    def test_create_client_specific_deadline(self, admin_tok, demo_client_id):
        due = (date.today() + timedelta(days=5)).isoformat()
        r = requests.post(f"{API}/admin/deadlines", headers=H(admin_tok), json={
            "title": f"TEST GST filing due {uuid.uuid4().hex[:5]}",
            "due_date": due, "kind": "compliance", "client_id": demo_client_id, "is_expiry": False,
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()["deadline"]
        assert d["due_date"] == due
        TestDeadlines.deadline_id = d["id"]

    def test_create_generic_expiry_deadline(self, admin_tok):
        due = (date.today() + timedelta(days=10)).isoformat()
        r = requests.post(f"{API}/admin/deadlines", headers=H(admin_tok), json={
            "title": f"TEST DSC expiry {uuid.uuid4().hex[:5]}",
            "due_date": due, "kind": "expiry", "is_expiry": True,
        }, timeout=15)
        assert r.status_code == 200
        TestDeadlines.generic_id = r.json()["deadline"]["id"]

    def test_list_deadlines_with_client_info(self, admin_tok):
        r = requests.get(f"{API}/admin/deadlines", headers=H(admin_tok), timeout=15)
        assert r.status_code == 200
        items = r.json()["deadlines"]
        by_id = {x["id"]: x for x in items}
        assert TestDeadlines.deadline_id in by_id
        assert TestDeadlines.generic_id in by_id
        specific = by_id[TestDeadlines.deadline_id]
        assert specific.get("client") is not None
        assert specific["client"]["client_code"] == "TM-000001"

    def test_run_reminders_notifies_client(self, admin_tok, client_tok):
        # count unread client notifications before
        notifs_before = requests.get(f"{API}/client/notifications", headers=H(client_tok), timeout=15).json()["notifications"]
        before_ids = {n["id"] for n in notifs_before}
        r = requests.post(f"{API}/admin/deadlines/run-reminders", headers=H(admin_tok), json={}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # verify at least one new client notification referencing our deadline
        notifs_after = requests.get(f"{API}/client/notifications", headers=H(client_tok), timeout=15).json()["notifications"]
        new_notifs = [n for n in notifs_after if n["id"] not in before_ids]
        # our TEST client-specific deadline should have generated a notif
        matched = [n for n in new_notifs if TestDeadlines.deadline_id in str(n.get("meta") or {})]
        assert matched or any("approaching" in (n.get("title") or "").lower() for n in new_notifs), \
            f"expected client notification for the client-specific deadline; got new={new_notifs}"

    def test_run_reminders_idempotent_same_day(self, admin_tok, client_tok):
        # Second run same day should not add another notif for same deadline
        notifs_before = requests.get(f"{API}/client/notifications", headers=H(client_tok), timeout=15).json()["notifications"]
        before_ids = {n["id"] for n in notifs_before}
        r = requests.post(f"{API}/admin/deadlines/run-reminders", headers=H(admin_tok), json={}, timeout=30)
        assert r.status_code == 200
        notifs_after = requests.get(f"{API}/client/notifications", headers=H(client_tok), timeout=15).json()["notifications"]
        new_notifs = [n for n in notifs_after if n["id"] not in before_ids]
        # No new notif should reference our TEST deadline
        dup = [n for n in new_notifs if TestDeadlines.deadline_id in str(n.get("meta") or {})]
        assert not dup, f"duplicate reminder within same day: {dup}"

    def test_soft_delete_deadline(self, admin_tok):
        assert TestDeadlines.generic_id
        r = requests.delete(f"{API}/admin/deadlines/{TestDeadlines.generic_id}", headers=H(admin_tok), timeout=15)
        assert r.status_code == 200 and r.json().get("ok") is True
        lst = requests.get(f"{API}/admin/deadlines", headers=H(admin_tok), timeout=15).json()["deadlines"]
        assert TestDeadlines.generic_id not in {d["id"] for d in lst}, "soft-deleted deadline must not appear in list"


# ==================================================================
# 5) RBAC
# ==================================================================
class TestRbac:
    def test_client_forbidden_on_admin_endpoints(self, client_tok, demo_client_id, catalog_services):
        svc_id = catalog_services[0]["id"]
        cases = [
            ("GET", f"{API}/admin/recurring", None),
            ("POST", f"{API}/admin/recurring", {"client_id": demo_client_id, "business_id": "x", "service_id": svc_id, "fy": "FY 2024-25", "frequency": "monthly", "amount": 1, "next_due": "2026-01-01"}),
            ("POST", f"{API}/admin/recurring/run", {}),
            ("GET", f"{API}/admin/deadlines", None),
            ("POST", f"{API}/admin/deadlines", {"title": "x", "due_date": "2026-12-31"}),
            ("POST", f"{API}/admin/deadlines/run-reminders", {}),
            ("POST", f"{API}/admin/prices/bulk", {"client_ids": [demo_client_id], "service_id": svc_id, "fy": "FY 2024-25", "amount": 100}),
        ]
        for method, url, body in cases:
            if method == "GET":
                r = requests.get(url, headers=H(client_tok), timeout=15)
            else:
                r = requests.post(url, headers=H(client_tok), json=body, timeout=15)
            assert r.status_code == 403, f"{method} {url} expected 403 got {r.status_code}: {r.text[:120]}"

    def test_staff_lacks_manage_services_on_recurring_and_deadlines(self, staff_tok, demo_client_id, demo_business_id, catalog_services):
        svc = catalog_services[0]
        r = requests.post(f"{API}/admin/recurring", headers=H(staff_tok), json={
            "client_id": demo_client_id, "business_id": demo_business_id, "service_id": svc["id"],
            "fy": "FY 2024-25", "frequency": "monthly", "amount": 100,
            "next_due": date.today().isoformat(),
        }, timeout=15)
        assert r.status_code == 403, f"staff (accountant) should 403 on recurring create, got {r.status_code}"

        r2 = requests.post(f"{API}/admin/deadlines", headers=H(staff_tok), json={
            "title": "TEST staff deadline", "due_date": (date.today() + timedelta(days=3)).isoformat(),
        }, timeout=15)
        assert r2.status_code == 403, f"staff (accountant) should 403 on deadline create, got {r2.status_code}"


# ==================================================================
# 6) Regression: pricing 402, UPI flow, doc unlock
# ==================================================================
class TestRegression:
    def test_create_request_402_without_price(self, client_tok, demo_business_id, catalog_services):
        # Pick a service+FY within FY_LIST that is unpriced for demo client.
        # Bank Reconciliation FY 2025-26 is intentionally unassigned per iter2 seed.
        svc = next(s for s in catalog_services if s["name"] == "Bank Reconciliation")
        r = requests.post(f"{API}/client/requests", headers=H(client_tok), json={
            "service_id": svc["id"], "business_id": demo_business_id, "fy": "FY 2025-26",
        }, timeout=15)
        assert r.status_code == 402, f"expected 402 for unpriced service, got {r.status_code}: {r.text}"

    def test_upi_and_doc_unlock_flow(self, client_tok, admin_tok, demo_business_id, catalog_services):
        # Create fresh priced request via admin -> client price already exists for GST Registration FY 2024-25 from iter2 seed OR create one
        # Simpler: use a service the client has price for; from iter 2 seed there are 10 prices.
        # Get client's available FY-priced service via /client/price loop; easier: use ITR Filing FY 2025-26 (1499)
        svc = next(s for s in catalog_services if s["name"] == "ITR Filing")
        p = requests.get(f"{API}/client/price?service_id={svc['id']}&fy=FY 2025-26", headers=H(client_tok), timeout=15).json()
        if not p.get("assigned"):
            pytest.skip("ITR Filing FY 2025-26 not priced for demo; regression skipped")
        # Create request
        cr = requests.post(f"{API}/client/requests", headers=H(client_tok), json={
            "service_id": svc["id"], "business_id": demo_business_id, "fy": "FY 2025-26",
        }, timeout=15)
        assert cr.status_code == 200, cr.text
        inv_id = cr.json()["invoice"]["id"]
        req_id = cr.json()["request"]["id"]
        # Upload a doc — must remain locked
        files = {"file": ("t.pdf", io.BytesIO(b"%PDF-1.4\nregr\n"), "application/pdf")}
        up = requests.post(f"{API}/client/documents", headers=H(client_tok), files=files, data={"request_id": req_id}, timeout=30)
        assert up.status_code == 200
        doc_id = up.json()["document"]["id"]
        acc_locked = requests.get(f"{API}/client/documents/{doc_id}/access?action=view", headers=H(client_tok), timeout=15)
        assert acc_locked.status_code == 402
        # Pay
        init = requests.post(f"{API}/client/payments/initiate", headers=H(client_tok),
                             data={"invoice_id": inv_id}, timeout=15).json()
        pid = init["payment"]["id"]
        sub = requests.post(f"{API}/client/payments/{pid}/submit", headers=H(client_tok), json={"utr": "111222333444"}, timeout=15)
        assert sub.status_code == 200 and sub.json()["status"] == "submitted"
        v = requests.post(f"{API}/admin/payments/{pid}/status", headers=H(admin_tok), json={"status": "received"}, timeout=30)
        assert v.status_code == 200, v.text
        # Doc now unlockable
        acc = requests.get(f"{API}/client/documents/{doc_id}/access?action=view", headers=H(client_tok), timeout=15)
        assert acc.status_code == 200 and "file_token" in acc.json()
