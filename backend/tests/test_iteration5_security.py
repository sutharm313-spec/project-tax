"""Iteration 5 backend security verification tests.

Covers:
- SEC-001 seed logins (env-driven, demo defaults in preview)
- SEC-003 malformed ObjectId -> 404 (global exception handler)
- SEC-004 staff permission gating on admin READ routes
- SEC-004 admin regression (super_admin still has access)
- RBAC regression: client blocked from /api/admin/*
- Prior fix regression: forgot-password no dev_otp; cross-purpose OTP rejected
- Core regression: create_request 402 without price; payment received unlocks doc
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fintech-tax-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"identifier": "admin@taxman.manoj", "password": "Admin@123"}
STAFF = {"identifier": "staff@taxman.manoj", "password": "Staff@123"}
CLIENT = {"identifier": "demo@taxman.manoj", "password": "Demo@123"}


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed for {creds['identifier']}: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data or "token" in data, f"No token in login response: {data}"
    return data.get("access_token") or data.get("token"), data.get("user", {})


@pytest.fixture(scope="session")
def admin_token(session):
    tok, _ = _login(session, ADMIN)
    return tok


@pytest.fixture(scope="session")
def staff_token(session):
    tok, u = _login(session, STAFF)
    # Sanity check on seeded permissions
    perms = set(u.get("permissions") or [])
    assert "view_documents" in perms, f"Expected view_documents in staff perms, got {perms}"
    assert "view_clients" in perms, f"Expected view_clients in staff perms, got {perms}"
    assert "view_reports" not in perms, f"Unexpected view_reports in accountant perms: {perms}"
    assert "manage_tickets" not in perms, f"Unexpected manage_tickets in accountant perms: {perms}"
    return tok


@pytest.fixture(scope="session")
def client_token(session):
    tok, u = _login(session, CLIENT)
    assert u.get("role") == "client", f"Expected role=client, got {u.get('role')}"
    return tok


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ------------------------ SEC-001: seed logins ------------------------
class TestSeedLogins:
    def test_admin_login(self, session):
        tok, u = _login(session, ADMIN)
        assert tok and u.get("role") == "super_admin"

    def test_staff_login(self, session):
        tok, u = _login(session, STAFF)
        assert tok and u.get("role") in ("staff", "accountant", "manager")

    def test_client_login(self, session):
        tok, u = _login(session, CLIENT)
        assert tok and u.get("role") == "client"


# ------------------------ SEC-003: malformed ObjectId ------------------------
class TestMalformedObjectId:
    def test_admin_client_notanid_returns_404(self, session, admin_token):
        r = session.get(f"{API}/admin/clients/notanid", headers=H(admin_token), timeout=15)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text[:200]}"

    def test_client_request_xyz123_returns_404(self, session, client_token):
        r = session.get(f"{API}/client/requests/xyz123", headers=H(client_token), timeout=15)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text[:200]}"

    def test_admin_payment_badid_status_returns_404(self, session, admin_token):
        r = session.post(f"{API}/admin/payments/badid/status", headers=H(admin_token),
                         json={"status": "received", "reason": "test"}, timeout=15)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text[:200]}"

    def test_no_endpoint_500s_on_malformed(self, session, admin_token, client_token):
        """Sweep a few more endpoints with malformed ids to ensure no 500s slip through."""
        cases = [
            ("GET", f"{API}/admin/clients/@@bad@@", admin_token, None),
            ("GET", f"{API}/admin/tickets/notanid", admin_token, None),
            ("GET", f"{API}/client/requests/!!bad!!", client_token, None),
            ("POST", f"{API}/admin/payments/xxxxx/verify", admin_token, {"action": "approve", "reason": ""}),
        ]
        for method, url, tok, body in cases:
            if method == "GET":
                r = session.get(url, headers=H(tok), timeout=15)
            else:
                r = session.post(url, headers=H(tok), json=body, timeout=15)
            assert r.status_code != 500, f"500 on {method} {url}: {r.text[:200]}"
            assert r.status_code in (400, 403, 404), f"Unexpected {r.status_code} on {method} {url}"


# ------------------------ SEC-004: accountant staff perm matrix ------------------------
class TestAccountantPermissions:
    def test_stats_forbidden(self, session, staff_token):
        r = session.get(f"{API}/admin/stats", headers=H(staff_token), timeout=15)
        assert r.status_code == 403, f"Expected 403 (needs view_reports), got {r.status_code}: {r.text[:200]}"

    def test_audit_forbidden(self, session, staff_token):
        r = session.get(f"{API}/admin/audit", headers=H(staff_token), timeout=15)
        assert r.status_code == 403, f"Expected 403 (admin-only), got {r.status_code}: {r.text[:200]}"

    def test_tickets_forbidden(self, session, staff_token):
        r = session.get(f"{API}/admin/tickets", headers=H(staff_token), timeout=15)
        assert r.status_code == 403, f"Expected 403 (needs manage_tickets), got {r.status_code}: {r.text[:200]}"

    def test_documents_allowed(self, session, staff_token):
        r = session.get(f"{API}/admin/documents", headers=H(staff_token), timeout=15)
        assert r.status_code == 200, f"Expected 200 (has view_documents), got {r.status_code}: {r.text[:200]}"

    def test_requests_allowed(self, session, staff_token):
        r = session.get(f"{API}/admin/requests", headers=H(staff_token), timeout=15)
        assert r.status_code == 200, f"Expected 200 (has view_clients), got {r.status_code}: {r.text[:200]}"


# ------------------------ SEC-004: admin regression ------------------------
class TestAdminRegression:
    @pytest.mark.parametrize("path", ["/admin/stats", "/admin/audit", "/admin/tickets", "/admin/documents", "/admin/requests"])
    def test_admin_allowed(self, session, admin_token, path):
        r = session.get(f"{API}{path}", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, f"Expected 200 for admin at {path}, got {r.status_code}: {r.text[:200]}"


# ------------------------ RBAC: client on /api/admin/* ------------------------
class TestClientBlockedFromAdmin:
    @pytest.mark.parametrize("path", ["/admin/stats", "/admin/audit", "/admin/tickets", "/admin/documents", "/admin/requests"])
    def test_client_forbidden(self, session, client_token, path):
        r = session.get(f"{API}{path}", headers=H(client_token), timeout=15)
        assert r.status_code == 403, f"Expected 403 for client at {path}, got {r.status_code}: {r.text[:200]}"


# ------------------------ Prior fix regression: OTP ------------------------
class TestOTPRegression:
    def test_forgot_password_no_dev_otp(self, session):
        r = session.post(f"{API}/auth/forgot-password", json={"email": "demo@taxman.manoj"}, timeout=15)
        assert r.status_code == 200, f"forgot-password should return 200, got {r.status_code}"
        body = r.json()
        assert "dev_otp" not in body, f"dev_otp leaked in reset flow: {body}"
        assert "otp" not in body, f"otp leaked in reset flow: {body}"
        # Ensure no bare 6-digit code
        import re
        assert not re.search(r"\b\d{6}\b", str(body)), f"6-digit code visible in reset flow body: {body}"

    def test_register_otp_cannot_reset_password(self, session):
        # Register a fresh sandbox email — /register echoes dev_otp with purpose=register.
        import uuid
        email = f"sectest+{uuid.uuid4().hex[:8]}@example.com"
        r = session.post(f"{API}/auth/register", json={
            "email": email, "password": "Test@1234", "name": "Sec5 Test",
            "mobile": f"9{int(time.time()) % 1000000000:09d}"
        }, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"Register endpoint returned {r.status_code}: {r.text[:200]}")
        body = r.json()
        otp = body.get("dev_otp") or body.get("otp")
        if not otp:
            pytest.skip(f"No dev_otp in register response (OTP_DEV_ECHO off?): {body}")
        # Try to use the register-purpose OTP at reset-password → must 400.
        r2 = session.post(f"{API}/auth/reset-password", json={
            "email": email, "code": otp, "new_password": "Newpass@123"
        }, timeout=15)
        assert r2.status_code == 400, f"Expected 400 cross-purpose reject, got {r2.status_code}: {r2.text[:200]}"


# ------------------------ Core regression: pricing 402 + payment unlock ------------------------
class TestPricingAndUnlock:
    def test_create_request_402_without_price(self, session, client_token):
        # Fetch a service + business, then attempt create with an unpriced FY.
        cat = session.get(f"{API}/catalog", headers=H(client_token), timeout=15)
        assert cat.status_code == 200, f"catalog fetch failed: {cat.status_code}"
        services = cat.json().get("services") or cat.json().get("catalog") or []
        if not services:
            pytest.skip("No services in catalog")
        svc_id = services[0].get("id") or services[0].get("_id")

        biz = session.get(f"{API}/client/businesses", headers=H(client_token), timeout=15)
        assert biz.status_code == 200, f"businesses fetch failed: {biz.status_code}"
        blist = biz.json().get("businesses") or biz.json().get("items") or []
        if not blist:
            pytest.skip("No businesses for demo client")
        biz_id = blist[0].get("id") or blist[0].get("_id")

        # Deliberately use an FY the client shouldn't have priced (older FY).
        r = session.post(f"{API}/client/requests", headers=H(client_token),
                         json={"service_id": svc_id, "business_id": biz_id, "fy": "2019-20"}, timeout=15)
        # 402 = price not assigned (SEC/pricing gate). 400 for invalid FY is also possible
        # depending on FY_LIST, so we accept either but strongly prefer 402.
        assert r.status_code in (400, 402), f"Expected 402 (no price) or 400 (bad FY), got {r.status_code}: {r.text[:200]}"

    def test_payment_received_unlocks_documents(self, session, admin_token, client_token):
        """Find an unpaid request for demo client, upload a document if none exists,
        verify doc is locked (402), admin marks payment received, doc access
        returns file_token."""
        # 1. list client requests, find one that is payment_pending
        rr = session.get(f"{API}/client/requests", headers=H(client_token), timeout=15)
        assert rr.status_code == 200
        req_list = rr.json().get("requests") or rr.json().get("items") or []
        target_req = None
        for req in req_list:
            if req.get("payment_status") in ("pending", "submitted"):
                target_req = req
                break
        if not target_req:
            pytest.skip("No unpaid request found for demo client.")
        rid = target_req.get("id") or target_req.get("_id")

        # 2. try to find an existing doc, otherwise upload one
        dd = session.get(f"{API}/client/documents", headers=H(client_token),
                         params={"request_id": rid}, timeout=15)
        docs = (dd.json().get("documents") or dd.json().get("items") or []) if dd.status_code == 200 else []
        target_doc_id = None
        if docs:
            target_doc_id = docs[0].get("id") or docs[0].get("_id")
        else:
            # upload a tiny file
            files = {"file": ("test5.txt", b"iteration5 unlock test payload", "text/plain")}
            data = {"request_id": rid, "doc_name": "TEST_iter5_unlock"}
            up = requests.post(f"{API}/client/documents",
                               headers={"Authorization": f"Bearer {client_token}"},
                               files=files, data=data, timeout=20)
            if up.status_code != 200:
                pytest.skip(f"upload failed {up.status_code}: {up.text[:200]}")
            doc = up.json().get("document") or {}
            target_doc_id = doc.get("id") or doc.get("_id")
        assert target_doc_id, "No doc id captured"

        # 3. before payment, doc access must 402
        r = session.get(f"{API}/client/documents/{target_doc_id}/access", headers=H(client_token),
                        params={"action": "view"}, timeout=15)
        assert r.status_code == 402, f"Expected 402 pre-payment, got {r.status_code}: {r.text[:200]}"

        # 4. find the payment for the request; use admin.
        pays = session.get(f"{API}/admin/payments", headers=H(admin_token), timeout=15)
        assert pays.status_code == 200
        plist = pays.json().get("payments") or pays.json().get("items") or []
        payment = next((p for p in plist if p.get("request_id") == rid), None)
        if not payment:
            pytest.skip(f"No payment found for request {rid}")
        pid = payment.get("id") or payment.get("_id")

        # 5. admin marks payment received
        r = session.post(f"{API}/admin/payments/{pid}/status", headers=H(admin_token),
                         json={"status": "received", "reason": "test unlock"}, timeout=15)
        assert r.status_code == 200, f"admin set_payment_status failed: {r.status_code} {r.text[:200]}"

        time.sleep(0.5)

        # 6. now doc access returns file_token
        r = session.get(f"{API}/client/documents/{target_doc_id}/access", headers=H(client_token),
                        params={"action": "view"}, timeout=15)
        assert r.status_code == 200, f"Expected 200 post-payment, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "file_token" in body and body["file_token"], f"file_token missing after unlock: {body}"
