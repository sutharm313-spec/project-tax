"""Comprehensive backend regression suite for taxman.manoj.
Covers: auth, client isolation, document lock, UPI flow, admin, RBAC,
catalog, notifications, tickets. Uses public preview URL.
"""
import io
import os
import time
import uuid

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
    assert r.status_code == 200, f"login failed for {identifier}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def client_token():
    return _login(CLIENT_EMAIL, CLIENT_PW)["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PW)["access_token"]


@pytest.fixture(scope="module")
def staff_token():
    return _login(STAFF_EMAIL, STAFF_PW)["access_token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- health ----------------
def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200 and r.json()["ok"] is True


# ---------------- Auth ----------------
class TestAuth:
    def test_register_returns_dev_otp_and_verify(self):
        uniq = uuid.uuid4().hex[:8]
        email = f"test_{uniq}@example.com"
        mobile = "9" + str(int(time.time()))[-9:]
        r = requests.post(f"{API}/auth/register", json={
            "name": "Test User", "email": email, "mobile": mobile, "password": "Passw0rd!"
        }, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "dev_otp" in body, "OTP_DEV_ECHO should surface dev_otp"
        code = body["dev_otp"]
        r2 = requests.post(f"{API}/auth/verify-otp", json={"email": email, "code": code}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert "access_token" in r2.json() and r2.json()["user"]["status"] == "active"
        pytest.NEW_USER = {"email": email, "password": "Passw0rd!",
                           "access_token": r2.json()["access_token"], "id": r2.json()["user"]["id"]}

    def test_login_success(self):
        data = _login(CLIENT_EMAIL, CLIENT_PW)
        assert "access_token" in data and data["user"]["client_code"] == "TM-000001"

    def test_login_invalid_credentials(self):
        r = requests.post(f"{API}/auth/login", json={"identifier": CLIENT_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_login_rate_limit(self):
        # Use a fresh identifier so we don't lock out demo user for other tests
        ident = f"ratelimit_{uuid.uuid4().hex[:6]}@x.com"
        # 5 attempts allowed then 429
        statuses = []
        for _ in range(7):
            r = requests.post(f"{API}/auth/login", json={"identifier": ident, "password": "wrong"}, timeout=15)
            statuses.append(r.status_code)
        assert 429 in statuses, f"Expected rate-limit after repeated failures, got {statuses}"

    def test_forgot_and_reset_password(self):
        user = getattr(pytest, "NEW_USER", None)
        assert user, "register test must run first"
        r = requests.post(f"{API}/auth/forgot-password", json={"email": user["email"]}, timeout=15)
        assert r.status_code == 200
        code = r.json().get("dev_otp")
        assert code, "forgot-password should return dev_otp"
        r2 = requests.post(f"{API}/auth/reset-password", json={"email": user["email"], "code": code, "new_password": "NewPassw0rd!"}, timeout=15)
        assert r2.status_code == 200
        # login with new password
        d = _login(user["email"], "NewPassw0rd!")
        assert "access_token" in d
        user["access_token"] = d["access_token"]
        user["password"] = "NewPassw0rd!"

    def test_me(self, client_token):
        r = requests.get(f"{API}/auth/me", headers=H(client_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == CLIENT_EMAIL


# ---------------- Client isolation ----------------
class TestClientIsolation:
    def test_client_b_cannot_access_client_a_request(self, client_token):
        # get one of demo user's requests
        r = requests.get(f"{API}/client/requests", headers=H(client_token), timeout=15)
        assert r.status_code == 200
        reqs = r.json()["requests"]
        assert reqs, "demo client should have seeded requests"
        a_req_id = reqs[0]["id"]
        # ensure new user (client B) exists
        user = getattr(pytest, "NEW_USER", None)
        assert user
        tokB = user["access_token"]
        # client B overview
        rb = requests.get(f"{API}/client/overview", headers=H(tokB), timeout=15)
        assert rb.status_code == 200
        ov = rb.json()
        assert ov["counts"]["businesses"] == 0
        assert ov["counts"]["documents_uploaded"] == 0
        # attempt cross-access
        r2 = requests.get(f"{API}/client/requests/{a_req_id}", headers=H(tokB), timeout=15)
        assert r2.status_code == 404, f"Expected 404 for cross-tenant access, got {r2.status_code}"
        # docs of B are empty
        rd = requests.get(f"{API}/client/documents", headers=H(tokB), timeout=15)
        assert rd.status_code == 200 and rd.json()["documents"] == []


# ---------------- Document lock ----------------
class TestDocumentLock:
    @pytest.fixture(scope="class")
    def requests_of_demo(self, client_token):
        r = requests.get(f"{API}/client/requests", headers=H(client_token), timeout=15)
        assert r.status_code == 200
        return r.json()["requests"]

    def test_locked_doc_returns_402(self, client_token, requests_of_demo):
        # find an unpaid request (create one if seed already exhausted)
        unpaid = [r for r in requests_of_demo if r.get("payment_status") != "verified"]
        if not unpaid:
            biz = requests.get(f"{API}/client/businesses", headers=H(client_token), timeout=15).json()["businesses"]
            svc = requests.get(f"{API}/catalog", timeout=15).json()["services"][0]
            cr = requests.post(f"{API}/client/requests", headers=H(client_token),
                               json={"service_id": svc["id"], "business_id": biz[0]["id"], "fy": "FY 2024-25"}, timeout=15).json()
            # upload doc to it
            files = {"file": ("t.pdf", io.BytesIO(b"%PDF-1.4\n%x"), "application/pdf")}
            requests.post(f"{API}/client/documents", headers=H(client_token), files=files, data={"request_id": cr["request"]["id"]}, timeout=30)
            unpaid = [cr["request"]]
        target = None
        for req in unpaid:
            det = requests.get(f"{API}/client/requests/{req['id']}", headers=H(client_token), timeout=15).json()
            for d in det.get("documents", []):
                if d.get("locked"):
                    target = d
                    break
            if target:
                break
        if not target:
            pytest.skip("no locked seeded doc found on unpaid request")
        r = requests.get(f"{API}/client/documents/{target['id']}/access?action=view", headers=H(client_token), timeout=15)
        assert r.status_code == 402, f"Expected 402 for locked doc, got {r.status_code} {r.text}"

    def test_paid_doc_returns_file_token_and_streams(self, client_token, requests_of_demo):
        paid = [r for r in requests_of_demo if r.get("payment_status") == "verified"]
        assert paid, "expected paid seeded request (ITR)"
        det = requests.get(f"{API}/client/requests/{paid[0]['id']}", headers=H(client_token), timeout=15).json()
        docs = [d for d in det["documents"] if not d.get("locked")]
        if not docs:
            pytest.skip("no unlocked doc found on paid request")
        d = docs[0]
        r = requests.get(f"{API}/client/documents/{d['id']}/access?action=view", headers=H(client_token), timeout=15)
        assert r.status_code == 200
        tok = r.json()["file_token"]
        assert tok
        rf = requests.get(f"{API}/files/{tok}", timeout=30)
        assert rf.status_code == 200 and len(rf.content) > 0
        pytest.PAID_DOC_ID = d["id"]

    def test_file_token_cannot_be_used_cross_user(self, client_token, requests_of_demo):
        paid = [r for r in requests_of_demo if r.get("payment_status") == "verified"]
        if not paid:
            pytest.skip("no paid request")
        det = requests.get(f"{API}/client/requests/{paid[0]['id']}", headers=H(client_token), timeout=15).json()
        docs = [d for d in det["documents"] if not d.get("locked")]
        if not docs:
            pytest.skip("no unlocked doc")
        # Client B cannot access A's document access endpoint
        user = getattr(pytest, "NEW_USER", None)
        assert user
        r = requests.get(f"{API}/client/documents/{docs[0]['id']}/access?action=view", headers=H(user["access_token"]), timeout=15)
        assert r.status_code == 404, f"Client B should get 404, got {r.status_code}"


# ---------------- UPI payment flow ----------------
class TestUpiFlow:
    def test_full_upi_verify_unlocks_documents(self, client_token, admin_token):
        # ensure at least one unpaid invoice exists — create fresh request if needed
        inv = requests.get(f"{API}/client/invoices?status=unpaid", headers=H(client_token), timeout=15).json()["invoices"]
        if not inv:
            biz = requests.get(f"{API}/client/businesses", headers=H(client_token), timeout=15).json()["businesses"]
            svc = requests.get(f"{API}/catalog", timeout=15).json()["services"][0]
            cr = requests.post(f"{API}/client/requests", headers=H(client_token),
                               json={"service_id": svc["id"], "business_id": biz[0]["id"], "fy": "FY 2024-25"}, timeout=15).json()
            inv = [cr["invoice"]]
        target_inv = inv[0]
        r = requests.post(f"{API}/client/payments/initiate", headers=H(client_token),
                          data={"invoice_id": target_inv["id"]}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["upi_uri"].startswith("upi://pay?")
        assert body["qr_base64"].startswith("data:image/png;base64,")
        payment_id = body["payment"]["id"]
        # bad utr rejected
        bad = requests.post(f"{API}/client/payments/{payment_id}/submit", headers=H(client_token), json={"utr": "12345"}, timeout=15)
        assert bad.status_code in (400, 422), f"Non-12-digit UTR should be rejected, got {bad.status_code}"
        # good 12-digit utr
        good = requests.post(f"{API}/client/payments/{payment_id}/submit", headers=H(client_token), json={"utr": "123456789012"}, timeout=15)
        assert good.status_code == 200 and good.json()["status"] == "submitted"
        # admin approve
        v = requests.post(f"{API}/admin/payments/{payment_id}/verify", headers=H(admin_token), json={"action": "approve"}, timeout=30)
        assert v.status_code == 200, v.text
        # linked request now payment_status verified
        req_id = target_inv.get("request_id")
        det = requests.get(f"{API}/client/requests/{req_id}", headers=H(client_token), timeout=15).json()
        assert det["request"]["payment_status"] == "verified"
        # docs, if any, should now be unlockable
        for d in det.get("documents", []):
            if not d.get("locked"):
                acc = requests.get(f"{API}/client/documents/{d['id']}/access?action=view", headers=H(client_token), timeout=15)
                assert acc.status_code == 200 and "file_token" in acc.json()
                break


# ---------------- Admin APIs ----------------
class TestAdmin:
    def test_stats(self, admin_token):
        r = requests.get(f"{API}/admin/stats", headers=H(admin_token), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "cards" in j and "charts" in j and "staff_workload" in j
        assert "total_clients" in j["cards"]

    def test_clients_search(self, admin_token):
        r = requests.get(f"{API}/admin/clients?q=demo", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        assert any(c.get("email") == CLIENT_EMAIL for c in r.json()["clients"])

    def test_payments_list_submitted(self, admin_token):
        r = requests.get(f"{API}/admin/payments?status=submitted", headers=H(admin_token), timeout=15)
        assert r.status_code == 200

    def test_reject_payment_flow(self, client_token, admin_token):
        # create another unpaid path: create a new request from a business
        biz = requests.get(f"{API}/client/businesses", headers=H(client_token), timeout=15).json()["businesses"]
        if not biz:
            pytest.skip("no business")
        cat = requests.get(f"{API}/catalog", timeout=15).json()["services"]
        svc = cat[0]
        cr = requests.post(f"{API}/client/requests", headers=H(client_token),
                           json={"service_id": svc["id"], "business_id": biz[0]["id"], "fy": "FY 2024-25"}, timeout=15)
        assert cr.status_code == 200, cr.text
        inv_id = cr.json()["invoice"]["id"]
        init = requests.post(f"{API}/client/payments/initiate", headers=H(client_token),
                             data={"invoice_id": inv_id}, timeout=15).json()
        pid = init["payment"]["id"]
        requests.post(f"{API}/client/payments/{pid}/submit", headers=H(client_token), json={"utr": "999888777666"}, timeout=15)
        rej = requests.post(f"{API}/admin/payments/{pid}/verify", headers=H(admin_token), json={"action": "reject", "reason": "test"}, timeout=30)
        assert rej.status_code == 200 and rej.json()["status"] == "rejected"

    def test_document_review_and_unlock(self, admin_token):
        docs = requests.get(f"{API}/admin/documents", headers=H(admin_token), timeout=15).json()["documents"]
        if not docs:
            pytest.skip("no docs")
        did = docs[0]["id"]
        r = requests.post(f"{API}/admin/documents/{did}/review", headers=H(admin_token), json={"action": "approve", "note": "ok"}, timeout=15)
        assert r.status_code == 200
        u = requests.post(f"{API}/admin/documents/{did}/unlock", headers=H(admin_token), json={"reason": "customer requested"}, timeout=15)
        assert u.status_code == 200 and "unlocked" in u.json()
        # audit log should contain manual_unlock
        a = requests.get(f"{API}/admin/audit?limit=50", headers=H(admin_token), timeout=15)
        assert a.status_code == 200
        assert any(l.get("action") == "document_manual_unlock" for l in a.json()["logs"])

    def test_search(self, admin_token):
        r = requests.get(f"{API}/admin/search?q=demo", headers=H(admin_token), timeout=15)
        assert r.status_code == 200 and isinstance(r.json()["results"], list)

    def test_catalog_create(self, admin_token):
        payload = {"name": f"TEST Service {uuid.uuid4().hex[:5]}", "category": "misc",
                   "description": "test", "price": 100, "price_type": "one_time",
                   "estimated_days": 3, "required_docs": [], "active": True}
        r = requests.post(f"{API}/admin/catalog", headers=H(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["service"]["name"] == payload["name"]

    def test_staff_create(self, admin_token):
        payload = {"name": "TEST Staff", "email": f"teststaff_{uuid.uuid4().hex[:6]}@example.com",
                   "mobile": "9" + str(int(time.time()))[-9:], "password": "Passw0rd!", "role": "accountant"}
        r = requests.post(f"{API}/admin/staff", headers=H(admin_token), json=payload, timeout=15)
        assert r.status_code == 200

    def test_leads_create(self, admin_token):
        r = requests.post(f"{API}/admin/leads", headers=H(admin_token),
                          json={"name": "TEST Lead", "mobile": "9999999999", "email": "lead@test.com",
                                "source": "web", "interested_service": "ITR", "status": "new"}, timeout=15)
        assert r.status_code == 200

    def test_settings_get_put(self, admin_token):
        r = requests.get(f"{API}/admin/settings", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        p = requests.put(f"{API}/admin/settings", headers=H(admin_token),
                         json={"whatsapp_number": "919999999999"}, timeout=15)
        assert p.status_code == 200

    def test_reports_csv(self, admin_token):
        for rt in ("clients", "revenue"):
            r = requests.get(f"{API}/admin/reports/{rt}", headers=H(admin_token), timeout=30)
            assert r.status_code == 200
            assert "text/csv" in r.headers.get("content-type", "")
            assert b"taxman.manoj" in r.content

    def test_audit(self, admin_token):
        r = requests.get(f"{API}/admin/audit", headers=H(admin_token), timeout=15)
        assert r.status_code == 200 and isinstance(r.json()["logs"], list)


# ---------------- Staff RBAC ----------------
class TestRbac:
    def test_staff_cannot_create_staff(self, staff_token):
        payload = {"name": "TEST Nope", "email": f"nope_{uuid.uuid4().hex[:5]}@example.com",
                   "mobile": "9111111111", "password": "Passw0rd!", "role": "accountant"}
        r = requests.post(f"{API}/admin/staff", headers=H(staff_token), json=payload, timeout=15)
        assert r.status_code == 403, f"Staff (accountant) should be denied manage_staff, got {r.status_code}"

    def test_client_cannot_access_admin(self, client_token):
        for path in ("/admin/stats", "/admin/clients", "/admin/payments", "/admin/audit"):
            r = requests.get(f"{API}{path}", headers=H(client_token), timeout=15)
            assert r.status_code == 403, f"Client should be 403 on {path}, got {r.status_code}"

    def test_staff_payment_permission_ok(self, staff_token):
        r = requests.get(f"{API}/admin/payments", headers=H(staff_token), timeout=15)
        assert r.status_code == 200


# ---------------- Catalog + upload ----------------
class TestCatalogAndUpload:
    def test_catalog_seeded(self):
        r = requests.get(f"{API}/catalog", timeout=15)
        assert r.status_code == 200
        services = r.json()["services"]
        assert len(services) >= 27, f"Expected at least 27 seeded services, got {len(services)}"

    def test_upload_document_before_payment(self, client_token):
        # find an unpaid request
        reqs = requests.get(f"{API}/client/requests", headers=H(client_token), timeout=15).json()["requests"]
        unpaid = [r for r in reqs if r.get("payment_status") != "verified"]
        assert unpaid
        target = unpaid[0]
        det = requests.get(f"{API}/client/requests/{target['id']}", headers=H(client_token), timeout=15).json()
        checklist = det["request"].get("checklist", [])
        key = checklist[0]["key"] if checklist else None
        fake = io.BytesIO(b"%PDF-1.4\n%test\n")
        files = {"file": ("test.pdf", fake, "application/pdf")}
        data = {"request_id": target["id"]}
        if key:
            data["checklist_key"] = key
        r = requests.post(f"{API}/client/documents", headers=H(client_token), files=files, data=data, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["document"]["locked"] is True  # unpaid so should still be locked
        pytest.UPLOADED_DOC = r.json()["document"]["id"]

    def test_replace_document(self, client_token):
        doc_id = getattr(pytest, "UPLOADED_DOC", None)
        assert doc_id
        fake = io.BytesIO(b"%PDF-1.4\n%v2\n")
        files = {"file": ("test_v2.pdf", fake, "application/pdf")}
        r = requests.post(f"{API}/client/documents/{doc_id}/replace", headers=H(client_token), files=files, timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True


# ---------------- Notifications & Tickets ----------------
class TestNotificationsTickets:
    def test_notifications_flow(self, client_token):
        r = requests.get(f"{API}/client/notifications", headers=H(client_token), timeout=15)
        assert r.status_code == 200
        notifs = r.json()["notifications"]
        if notifs:
            nid = notifs[0]["id"]
            r2 = requests.post(f"{API}/client/notifications/{nid}/read", headers=H(client_token), timeout=15)
            assert r2.status_code == 200
        r3 = requests.post(f"{API}/client/notifications/read-all", headers=H(client_token), timeout=15)
        assert r3.status_code == 200

    def test_ticket_create_and_reply(self, client_token):
        r = requests.post(f"{API}/client/tickets", headers=H(client_token),
                          json={"subject": "TEST ticket subject", "category": "general",
                                "description": "This is a TEST ticket description.", "priority": "normal"}, timeout=15)
        assert r.status_code == 200
        tid = r.json()["ticket"]["id"]
        r2 = requests.post(f"{API}/client/tickets/{tid}/messages", headers=H(client_token),
                           json={"body": "follow up"}, timeout=15)
        assert r2.status_code == 200
        lst = requests.get(f"{API}/client/tickets", headers=H(client_token), timeout=15)
        assert lst.status_code == 200 and any(t["id"] == tid for t in lst.json()["tickets"])
