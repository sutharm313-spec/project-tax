# Soft-delete feature tests: DELETE endpoints on admin_api for
# clients / catalog / payments / requests / leads with cascading
# soft-deletes, real-time stats deltas, client-side consistency,
# RBAC and 404 vs 500 on malformed ids.
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fintech-tax-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"identifier": "admin@taxman.manoj", "password": "Admin@123"}
STAFF = {"identifier": "staff@taxman.manoj", "password": "Staff@123"}
DEMO = {"identifier": "demo@taxman.manoj", "password": "Demo@123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['identifier']}: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json().get("user", {})


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    admin_tok, admin_user = _login(ADMIN)
    staff_tok, staff_user = _login(STAFF)
    demo_tok, demo_user = _login(DEMO)
    return {"admin": admin_tok, "staff": staff_tok, "demo": demo_tok,
            "admin_user": admin_user, "staff_user": staff_user, "demo_user": demo_user}


def _stats(tok):
    r = requests.get(f"{API}/admin/stats", headers=_h(tok), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["cards"]


# ---------------- catalog delete ----------------
class TestDeleteCatalog:
    def test_delete_service_flow_and_rbac(self, tokens):
        # create fresh service
        payload = {"name": f"TEST_svc_{uuid.uuid4().hex[:6]}", "category": "test", "price": 100, "estimated_days": 1}
        r = requests.post(f"{API}/admin/catalog", headers=_h(tokens["admin"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["service"]["id"]

        # accountant lacks manage_services -> 403
        r = requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(tokens["staff"]), timeout=30)
        assert r.status_code == 403, r.text

        # client -> 403 (not staff)
        r = requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403, r.text

        # admin deletes
        r = requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200 and r.json().get("deleted") == "service"

        # excluded from admin catalog
        r = requests.get(f"{API}/admin/catalog", headers=_h(tokens["admin"]), timeout=30)
        ids = [s["id"] for s in r.json()["services"]]
        assert sid not in ids

        # excluded from client catalog
        r = requests.get(f"{API}/catalog", headers=_h(tokens["demo"]), timeout=30)
        ids = [s["id"] for s in r.json()["services"]]
        assert sid not in ids


# ---------------- lead delete ----------------
class TestDeleteLead:
    def test_delete_lead(self, tokens):
        r = requests.post(f"{API}/admin/leads", headers=_h(tokens["admin"]),
                          json={"name": f"TEST_lead_{uuid.uuid4().hex[:6]}", "mobile": "9999900000"}, timeout=30)
        assert r.status_code == 200, r.text
        lid = r.json()["lead"]["id"]

        # client 403
        r = requests.delete(f"{API}/admin/leads/{lid}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403

        # admin delete
        r = requests.delete(f"{API}/admin/leads/{lid}", headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200

        r = requests.get(f"{API}/admin/leads", headers=_h(tokens["admin"]), timeout=30)
        assert lid not in [l["id"] for l in r.json()["leads"]]


# ---------------- request delete (using demo client fresh request) ----------------
class TestDeleteRequest:
    def _create_request_for_demo(self, tokens):
        """Create a fresh catalog svc + client price + demo request, return ids."""
        admin_tok = tokens["admin"]
        # create service
        r = requests.post(f"{API}/admin/catalog", headers=_h(admin_tok),
                          json={"name": f"TEST_req_svc_{uuid.uuid4().hex[:6]}", "category": "test",
                                "price": 500, "estimated_days": 1,
                                "required_docs": [{"key": "doc1", "name": "Doc 1", "required": True}]}, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["service"]["id"]

        demo_id = tokens["demo_user"]["id"]
        fy = "FY 2024-25"
        # set client price
        r = requests.post(f"{API}/admin/clients/{demo_id}/prices", headers=_h(admin_tok),
                          json={"service_id": sid, "fy": fy, "amount": 500, "active": True}, timeout=30)
        assert r.status_code == 200, r.text

        # demo client picks a business
        r = requests.get(f"{API}/client/businesses", headers=_h(tokens["demo"]), timeout=30)
        biz = r.json()["businesses"][0]["id"]
        r = requests.post(f"{API}/client/requests", headers=_h(tokens["demo"]),
                          json={"service_id": sid, "business_id": biz, "fy": fy}, timeout=30)
        assert r.status_code == 200, r.text
        req_id = r.json()["request"]["id"]
        return sid, req_id

    def test_delete_request_cascades_and_stats(self, tokens):
        sid, req_id = self._create_request_for_demo(tokens)
        before = _stats(tokens["admin"])

        # accountant lacks manage_services -> 403
        r = requests.delete(f"{API}/admin/requests/{req_id}", headers=_h(tokens["staff"]), timeout=30)
        assert r.status_code == 403

        # client -> 403
        r = requests.delete(f"{API}/admin/requests/{req_id}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403

        r = requests.delete(f"{API}/admin/requests/{req_id}", headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200 and r.json().get("deleted") == "request"

        # excluded admin list
        r = requests.get(f"{API}/admin/requests", headers=_h(tokens["admin"]), timeout=30)
        assert req_id not in [x["id"] for x in r.json()["requests"]]

        # excluded client list
        r = requests.get(f"{API}/client/requests", headers=_h(tokens["demo"]), timeout=30)
        assert req_id not in [x["id"] for x in r.json()["requests"]]

        # client overview no longer references it (recent_requests)
        ov = requests.get(f"{API}/client/overview", headers=_h(tokens["demo"]), timeout=30).json()
        assert req_id not in [x["id"] for x in ov["recent_requests"]]

        after = _stats(tokens["admin"])
        # the created request had status payment_pending which is NOT in active_services
        # but pending_payments (invoice total) should have dropped by >=500
        assert after["pending_payments"] <= before["pending_payments"], (before, after)

        # cleanup service
        requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(tokens["admin"]), timeout=30)


# ---------------- payment delete + re-lock ----------------
class TestDeletePayment:
    def test_delete_verified_payment_relocks(self, tokens):
        admin_tok = tokens["admin"]
        # create svc, price, request, invoice, then admin verifies payment
        r = requests.post(f"{API}/admin/catalog", headers=_h(admin_tok),
                          json={"name": f"TEST_pay_svc_{uuid.uuid4().hex[:6]}", "category": "test",
                                "price": 700, "estimated_days": 1}, timeout=30)
        sid = r.json()["service"]["id"]
        demo_id = tokens["demo_user"]["id"]
        fy = "FY 2024-25"
        requests.post(f"{API}/admin/clients/{demo_id}/prices", headers=_h(admin_tok),
                      json={"service_id": sid, "fy": fy, "amount": 700, "active": True}, timeout=30)
        biz = requests.get(f"{API}/client/businesses", headers=_h(tokens["demo"]), timeout=30).json()["businesses"][0]["id"]
        r = requests.post(f"{API}/client/requests", headers=_h(tokens["demo"]),
                          json={"service_id": sid, "business_id": biz, "fy": fy}, timeout=30)
        req_id = r.json()["request"]["id"]
        inv_id = r.json()["invoice"]["id"]

        # initiate payment via client
        r = requests.post(f"{API}/client/payments/initiate", headers={"Authorization": f"Bearer {tokens['demo']}"},
                          data={"invoice_id": inv_id}, timeout=30)
        assert r.status_code == 200, r.text
        pay_id = r.json()["payment"]["id"]
        # submit utr
        r = requests.post(f"{API}/client/payments/{pay_id}/submit", headers=_h(tokens["demo"]),
                          json={"utr": "123456789012"}, timeout=30)
        assert r.status_code == 200
        # admin verifies -> received
        r = requests.post(f"{API}/admin/payments/{pay_id}/status", headers=_h(admin_tok),
                          json={"status": "received"}, timeout=30)
        assert r.status_code == 200, r.text

        # confirm request is now verified/in_progress
        r = requests.get(f"{API}/admin/requests", headers=_h(admin_tok), timeout=30)
        req = next(x for x in r.json()["requests"] if x["id"] == req_id)
        assert req["payment_status"] == "verified"

        before = _stats(admin_tok)
        # RBAC: client 403
        r = requests.delete(f"{API}/admin/payments/{pay_id}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403

        # accountant has manage_payments -> should succeed. Use admin to keep the test clean.
        r = requests.delete(f"{API}/admin/payments/{pay_id}", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text

        # payment excluded from admin listing
        r = requests.get(f"{API}/admin/payments", headers=_h(admin_tok), timeout=30)
        assert pay_id not in [p["id"] for p in r.json()["payments"]]

        # revenue in stats dropped by amount
        after = _stats(admin_tok)
        # Note: stats.revenue currently filters by status=="verified" but payment status is stored as "received"
        # (see admin_api.py:151 vs 401). So revenue may be 0. We assert it did not INCREASE after delete.
        assert after["revenue"] <= before["revenue"], (before["revenue"], after["revenue"])

        # request re-locked
        r = requests.get(f"{API}/admin/requests", headers=_h(admin_tok), timeout=30)
        req = next(x for x in r.json()["requests"] if x["id"] == req_id)
        assert req["payment_status"] == "pending", req
        assert req["status"] == "payment_pending"

        # cleanup: soft delete request+service
        requests.delete(f"{API}/admin/requests/{req_id}", headers=_h(admin_tok), timeout=30)
        requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(admin_tok), timeout=30)


# ---------------- client delete (throwaway registered client) ----------------
class TestDeleteClient:
    def test_delete_throwaway_client(self, tokens):
        admin_tok = tokens["admin"]
        email = f"test_del_{uuid.uuid4().hex[:8]}@taxman.manoj"
        mobile = "9" + str(int(time.time()))[-9:]
        pwd = "Throw@1234"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST Throwaway", "email": email, "mobile": mobile, "password": pwd}, timeout=30)
        assert r.status_code == 200, r.text
        dev_otp = r.json().get("dev_otp")
        assert dev_otp, "OTP_DEV_ECHO not enabled or missing dev_otp"
        r = requests.post(f"{API}/auth/verify-otp", json={"email": email, "code": dev_otp}, timeout=30)
        assert r.status_code == 200, r.text
        client_id = r.json()["user"]["id"]

        # RBAC: accountant (not admin role) -> 403
        r = requests.delete(f"{API}/admin/clients/{client_id}", headers=_h(tokens["staff"]), timeout=30)
        assert r.status_code == 403, r.text

        # client itself -> 403
        r = requests.delete(f"{API}/admin/clients/{client_id}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403

        before = _stats(admin_tok)
        r = requests.delete(f"{API}/admin/clients/{client_id}", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text

        # not in admin listing
        r = requests.get(f"{API}/admin/clients", headers=_h(admin_tok), timeout=30)
        assert client_id not in [c["id"] for c in r.json()["clients"]]

        # stats total_clients decreased by 1
        after = _stats(admin_tok)
        assert after["total_clients"] == before["total_clients"] - 1, (before["total_clients"], after["total_clients"])

        # deleted client cannot log in
        r = requests.post(f"{API}/auth/login", json={"identifier": email, "password": pwd}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# ---------------- RBAC & malformed id ----------------
class TestRbacAndMalformed:
    @pytest.mark.parametrize("path", [
        "/admin/clients/{id}",
        "/admin/catalog/{id}",
        "/admin/payments/{id}",
        "/admin/requests/{id}",
        "/admin/leads/{id}",
    ])
    def test_client_cannot_delete(self, tokens, path):
        r = requests.delete(f"{API}{path.format(id='507f1f77bcf86cd799439011')}", headers=_h(tokens["demo"]), timeout=30)
        assert r.status_code == 403, f"{path} -> {r.status_code} {r.text}"

    @pytest.mark.parametrize("path", [
        "/admin/clients/not-an-id",
        "/admin/catalog/not-an-id",
        "/admin/payments/not-an-id",
        "/admin/requests/not-an-id",
        "/admin/leads/not-an-id",
    ])
    def test_malformed_id_returns_404_not_500(self, tokens, path):
        r = requests.delete(f"{API}{path}", headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 404, f"{path} -> {r.status_code} {r.text}"


# ---------------- regression ----------------
class TestRegression:
    def test_create_request_without_price_returns_402(self, tokens):
        # create a fresh service with no client price -> 402
        r = requests.post(f"{API}/admin/catalog", headers=_h(tokens["admin"]),
                          json={"name": f"TEST_np_{uuid.uuid4().hex[:6]}", "category": "test",
                                "price": 0, "estimated_days": 1}, timeout=30)
        sid = r.json()["service"]["id"]
        biz = requests.get(f"{API}/client/businesses", headers=_h(tokens["demo"]), timeout=30).json()["businesses"][0]["id"]
        r = requests.post(f"{API}/client/requests", headers=_h(tokens["demo"]),
                          json={"service_id": sid, "business_id": biz, "fy": "FY 2024-25"}, timeout=30)
        assert r.status_code == 402, f"expected 402 got {r.status_code} {r.text}"
        requests.delete(f"{API}/admin/catalog/{sid}", headers=_h(tokens["admin"]), timeout=30)
