"""Backend tests for taxman.manoj private pricing + UPI manual verification."""
import io
import os
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"identifier": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def client_tok():
    return _login("demo@taxman.manoj", "Demo@123")


@pytest.fixture(scope="session")
def admin_tok():
    return _login("admin@taxman.manoj", "Admin@123")


@pytest.fixture(scope="session")
def staff_tok():
    return _login("staff@taxman.manoj", "Staff@123")


def H(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="session")
def catalog(client_tok):
    r = requests.get(f"{BASE}/api/catalog", headers=H(client_tok), timeout=30)
    assert r.status_code == 200
    return {s["name"]: s for s in r.json()["services"]}


@pytest.fixture(scope="session")
def demo_client_id(admin_tok):
    r = requests.get(f"{BASE}/api/admin/clients?q=demo", headers=H(admin_tok), timeout=30)
    for c in r.json()["clients"]:
        if c["email"] == "demo@taxman.manoj":
            return c["id"]
    pytest.skip("Demo client not found")


@pytest.fixture(scope="session")
def demo_biz(client_tok):
    r = requests.get(f"{BASE}/api/client/businesses", headers=H(client_tok), timeout=30)
    return r.json()["businesses"][0]["id"]


# ---------- (A) Catalog: NO price in public views ----------
class TestCatalogPriceHidden:
    def test_catalog_list_hides_price(self, catalog):
        for name, s in catalog.items():
            assert "price" not in s, f"price leaked for {name}"
            assert s.get("price_visible") is False

    def test_catalog_detail_hides_price(self, client_tok, catalog):
        sid = next(iter(catalog.values()))["id"]
        r = requests.get(f"{BASE}/api/catalog/{sid}", headers=H(client_tok), timeout=30)
        assert r.status_code == 200
        s = r.json()["service"]
        assert "price" not in s
        assert s.get("price_visible") is False


# ---------- (B) Client price lookup ----------
class TestClientPrice:
    def test_itr_fy2627(self, client_tok, catalog):
        sid = catalog["ITR Filing"]["id"]
        r = requests.get(f"{BASE}/api/client/price", params={"service_id": sid, "fy": "FY 2026-27"}, headers=H(client_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["assigned"] is True
        assert d["amount"] == 1699
        assert d["ay"] == "AY 2027-28"

    def test_itr_fy2526(self, client_tok, catalog):
        sid = catalog["ITR Filing"]["id"]
        r = requests.get(f"{BASE}/api/client/price", params={"service_id": sid, "fy": "FY 2025-26"}, headers=H(client_tok), timeout=30)
        d = r.json()
        assert d["assigned"] is True and d["amount"] == 1499 and d["ay"] == "AY 2026-27"

    def test_unassigned(self, client_tok, catalog):
        sid = catalog["Bank Reconciliation"]["id"]
        r = requests.get(f"{BASE}/api/client/price", params={"service_id": sid, "fy": "FY 2026-27"}, headers=H(client_tok), timeout=30)
        d = r.json()
        assert d["assigned"] is False and d["amount"] is None


# ---------- (C) Create request gating + AY populated ----------
class TestCreateRequestGating:
    def test_no_price_402(self, client_tok, catalog, demo_biz):
        sid = catalog["Bank Reconciliation"]["id"]
        r = requests.post(f"{BASE}/api/client/requests",
                          json={"service_id": sid, "business_id": demo_biz, "fy": "FY 2026-27"},
                          headers=H(client_tok), timeout=30)
        assert r.status_code == 402, r.text

    def test_with_price_ok_and_snapshot(self, client_tok, catalog, demo_biz):
        # Use GSTR-1 FY 2026-27 = 699 (unique so previous seeded requests don't interfere)
        sid = catalog["GSTR-1"]["id"]
        r = requests.post(f"{BASE}/api/client/requests",
                          json={"service_id": sid, "business_id": demo_biz, "fy": "FY 2026-27"},
                          headers=H(client_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["request"]["price"] == 699
        assert j["request"]["ay"] == "AY 2027-28"
        assert j["invoice"]["total"] == 699
        pytest.gstr1_req_id = j["request"]["id"]
        pytest.gstr1_invoice_id = j["invoice"]["id"]


# ---------- (D) Price snapshot immutability ----------
class TestPriceSnapshot:
    def test_snapshot_unchanged_after_admin_edit(self, admin_tok, demo_client_id, catalog, client_tok, demo_biz):
        # Create Tax Planning FY 2026-27 request (seeded 2499)
        sid = catalog["Tax Planning"]["id"]
        r = requests.post(f"{BASE}/api/client/requests",
                          json={"service_id": sid, "business_id": demo_biz, "fy": "FY 2026-27"},
                          headers=H(client_tok), timeout=30)
        assert r.status_code == 200, r.text
        req = r.json()["request"]
        inv = r.json()["invoice"]
        orig = req["price"]
        assert orig == 2499

        # Admin edits price - find price_id
        p = requests.get(f"{BASE}/api/admin/clients/{demo_client_id}/prices", headers=H(admin_tok), timeout=30).json()
        pid = next(x["id"] for x in p["prices"] if x["service_id"] == sid and x["fy"] == "FY 2026-27")
        r2 = requests.put(f"{BASE}/api/admin/prices/{pid}", json={"amount": 9999}, headers=H(admin_tok), timeout=30)
        assert r2.status_code == 200

        # Re-fetch request; price+invoice must be unchanged
        rd = requests.get(f"{BASE}/api/client/requests/{req['id']}", headers=H(client_tok), timeout=30).json()
        assert rd["request"]["price"] == orig
        assert rd["invoice"]["total"] == orig

        # Restore
        requests.put(f"{BASE}/api/admin/prices/{pid}", json={"amount": 2499}, headers=H(admin_tok), timeout=30)


# ---------- (E) UPI flow ----------
class TestUpiFlow:
    def test_initiate_and_submit(self, client_tok):
        inv_id = pytest.gstr1_invoice_id
        r = requests.post(f"{BASE}/api/client/payments/initiate",
                          data={"invoice_id": inv_id}, headers=H(client_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["qr_base64"].startswith("data:image/png;base64,")
        assert j["vpa"]
        assert j["upi_uri"].startswith("upi://pay?")
        pytest.gstr1_pay_id = j["payment"]["id"]

        # Non-12-digit rejected
        bad = requests.post(f"{BASE}/api/client/payments/{pytest.gstr1_pay_id}/submit",
                            json={"utr": "12345"}, headers=H(client_tok), timeout=30)
        assert bad.status_code == 400

        # Valid 12-digit
        ok = requests.post(f"{BASE}/api/client/payments/{pytest.gstr1_pay_id}/submit",
                           json={"utr": "999888777666"}, headers=H(client_tok), timeout=30)
        assert ok.status_code == 200, ok.text
        assert ok.json()["status"] == "submitted"
        assert ok.json()["status_label"] == "Under Verification"

    def test_screenshot_upload_and_admin_view(self, client_tok, admin_tok):
        # 1x1 png
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
               b"\x00\x00\x00\rIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
        r = requests.post(f"{BASE}/api/client/payments/{pytest.gstr1_pay_id}/screenshot",
                          files={"file": ("proof.png", io.BytesIO(png), "image/png")},
                          headers=H(client_tok), timeout=30)
        assert r.status_code == 200, r.text

        # Admin list should show has_screenshot=true
        lst = requests.get(f"{BASE}/api/admin/payments", headers=H(admin_tok), timeout=30).json()
        p = next(x for x in lst["payments"] if x["id"] == pytest.gstr1_pay_id)
        assert p["has_screenshot"] is True

        # Get token, then stream
        tr = requests.get(f"{BASE}/api/admin/payments/{pytest.gstr1_pay_id}/screenshot", headers=H(admin_tok), timeout=30)
        assert tr.status_code == 200
        tok = tr.json()["file_token"]
        stream = requests.get(f"{BASE}/api/gridfiles/{tok}", timeout=30)
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("image/")


# ---------- (F) Admin status control + lock/unlock ----------
class TestAdminStatusControl:
    def test_received_unlocks_then_relocks(self, admin_tok, client_tok):
        pid = pytest.gstr1_pay_id
        # Set received -> request payment_status = verified
        r = requests.post(f"{BASE}/api/admin/payments/{pid}/status",
                          json={"status": "received"}, headers=H(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status_label"] == "Payment Received"

        # Upload a doc under this request to test unlock
        req_id = pytest.gstr1_req_id
        up = requests.post(f"{BASE}/api/client/documents",
                           data={"request_id": req_id},
                           files={"file": ("test.pdf", b"%PDF-1.4 test", "application/pdf")},
                           headers=H(client_tok), timeout=30)
        assert up.status_code == 200, up.text
        doc_id = up.json()["document"]["id"]

        # Access should now succeed (payment_status verified)
        ac = requests.get(f"{BASE}/api/client/documents/{doc_id}/access", headers=H(client_tok), timeout=30)
        assert ac.status_code == 200, ac.text
        assert "file_token" in ac.json()

        # Flip to under_verification -> lock
        r2 = requests.post(f"{BASE}/api/admin/payments/{pid}/status",
                           json={"status": "under_verification"}, headers=H(admin_tok), timeout=30)
        assert r2.status_code == 200
        ac2 = requests.get(f"{BASE}/api/client/documents/{doc_id}/access", headers=H(client_tok), timeout=30)
        assert ac2.status_code == 402

        # Flip to not_received -> still locked
        r3 = requests.post(f"{BASE}/api/admin/payments/{pid}/status",
                           json={"status": "not_received"}, headers=H(admin_tok), timeout=30)
        assert r3.status_code == 200
        ac3 = requests.get(f"{BASE}/api/client/documents/{doc_id}/access", headers=H(client_tok), timeout=30)
        assert ac3.status_code == 402

        # History grew
        lst = requests.get(f"{BASE}/api/admin/payments", headers=H(admin_tok), timeout=30).json()
        p = next(x for x in lst["payments"] if x["id"] == pid)
        assert isinstance(p.get("history"), list) and len(p["history"]) >= 3

        # Cleanup: restore to received
        requests.post(f"{BASE}/api/admin/payments/{pid}/status", json={"status": "received"}, headers=H(admin_tok), timeout=30)

    def test_legacy_verify_endpoint(self, admin_tok):
        # Reject then approve on same payment
        pid = pytest.gstr1_pay_id
        rj = requests.post(f"{BASE}/api/admin/payments/{pid}/verify",
                           json={"action": "reject", "reason": "test"}, headers=H(admin_tok), timeout=30)
        assert rj.status_code == 200
        assert rj.json()["status"] == "rejected"
        ap = requests.post(f"{BASE}/api/admin/payments/{pid}/verify",
                           json={"action": "approve"}, headers=H(admin_tok), timeout=30)
        assert ap.status_code == 200
        assert ap.json()["status"] == "verified"


# ---------- (G) Admin pricing CRUD ----------
class TestAdminPricingCrud:
    def test_list_prices(self, admin_tok, demo_client_id):
        r = requests.get(f"{BASE}/api/admin/clients/{demo_client_id}/prices", headers=H(admin_tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["prices"], list) and len(j["prices"]) >= 5
        assert isinstance(j["services"], list) and any("suggested_price" in s for s in j["services"])
        assert isinstance(j["fy_list"], list)

    def test_set_edit_history(self, admin_tok, demo_client_id, catalog):
        sid = catalog["GST Registration"]["id"]
        # Set (may update existing)
        r = requests.post(f"{BASE}/api/admin/clients/{demo_client_id}/prices",
                          json={"service_id": sid, "fy": "FY 2024-25", "amount": 1234, "active": True},
                          headers=H(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["price"]["id"]

        # Edit amount + toggle active
        e = requests.put(f"{BASE}/api/admin/prices/{pid}", json={"amount": 1500, "active": False},
                        headers=H(admin_tok), timeout=30)
        assert e.status_code == 200

        # History
        h = requests.get(f"{BASE}/api/admin/prices/{pid}", headers=H(admin_tok), timeout=30).json()
        assert len(h["price"]["history"]) >= 2

    def test_bulk_assign(self, admin_tok, demo_client_id, catalog):
        sid = catalog["Financial Statements"]["id"]
        r = requests.post(f"{BASE}/api/admin/prices/bulk",
                          json={"client_ids": [demo_client_id], "service_id": sid, "fy": "FY 2026-27", "amount": 3333},
                          headers=H(admin_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()["updated"] == 1


# ---------- (H) FY/AY scoping of unlock ----------
class TestFyScoping:
    def test_paying_one_fy_doesnt_unlock_another(self, client_tok, admin_tok, catalog, demo_biz, demo_client_id):
        # Ensure prices for TDS Return FY 2025-26 (unassigned by seed) and FY 2026-27 (assigned 1299)
        sid = catalog["TDS Return"]["id"]
        # Assign FY 2025-26 as well
        requests.post(f"{BASE}/api/admin/clients/{demo_client_id}/prices",
                      json={"service_id": sid, "fy": "FY 2025-26", "amount": 1199, "active": True},
                      headers=H(admin_tok), timeout=30)

        # Create two requests for two FYs
        def mk(fy):
            r = requests.post(f"{BASE}/api/client/requests",
                              json={"service_id": sid, "business_id": demo_biz, "fy": fy},
                              headers=H(client_tok), timeout=30)
            assert r.status_code == 200, r.text
            return r.json()["request"]["id"], r.json()["invoice"]["id"]

        r_a, inv_a = mk("FY 2025-26")
        r_b, inv_b = mk("FY 2026-27")

        # Upload docs for both
        def upload(rid):
            up = requests.post(f"{BASE}/api/client/documents",
                               data={"request_id": rid},
                               files={"file": ("x.pdf", b"%PDF-1.4 test", "application/pdf")},
                               headers=H(client_tok), timeout=30)
            return up.json()["document"]["id"]
        d_a = upload(r_a)
        d_b = upload(r_b)

        # Pay only FY 2025-26
        init = requests.post(f"{BASE}/api/client/payments/initiate", data={"invoice_id": inv_a}, headers=H(client_tok), timeout=30).json()
        pid_a = init["payment"]["id"]
        requests.post(f"{BASE}/api/client/payments/{pid_a}/submit", json={"utr": "111222333444"}, headers=H(client_tok), timeout=30)
        requests.post(f"{BASE}/api/admin/payments/{pid_a}/status", json={"status": "received"}, headers=H(admin_tok), timeout=30)

        # FY 2025-26 doc unlocked, FY 2026-27 locked
        assert requests.get(f"{BASE}/api/client/documents/{d_a}/access", headers=H(client_tok), timeout=30).status_code == 200
        assert requests.get(f"{BASE}/api/client/documents/{d_b}/access", headers=H(client_tok), timeout=30).status_code == 402


# ---------- (I) RBAC ----------
class TestRbac:
    def test_client_blocked_on_admin(self, client_tok, demo_client_id):
        r = requests.get(f"{BASE}/api/admin/clients/{demo_client_id}/prices", headers=H(client_tok), timeout=30)
        assert r.status_code == 403
        r2 = requests.post(f"{BASE}/api/admin/payments/anyid/status", json={"status": "received"}, headers=H(client_tok), timeout=30)
        assert r2.status_code == 403

    def test_staff_without_perm_blocked(self, staff_tok, demo_client_id, catalog):
        # accountant has manage_payments but NOT manage_services -> allowed for pricing? spec says needs manage_payments OR manage_services
        # so accountant IS allowed for pricing. Test the payment status endpoint instead: accountant has manage_payments -> allowed.
        # We test manage_staff which accountant does NOT have.
        r = requests.post(f"{BASE}/api/admin/staff",
                          json={"name": "X", "email": "x@y.z", "mobile": "9812345678", "password": "Passw0rd!", "role": "accountant"},
                          headers=H(staff_tok), timeout=30)
        assert r.status_code == 403


# ---------- (J) Client isolation ----------
class TestIsolation:
    @pytest.fixture(scope="class")
    def clientB(self):
        # Register new client via OTP
        email = f"iso_{int(time.time())}@taxman.dev"
        r = requests.post(f"{BASE}/api/auth/register", json={
            "name": "Iso B", "email": email, "mobile": f"98120{int(time.time()) % 100000:05d}",
            "password": "IsoTest@123"
        }, timeout=30)
        if r.status_code != 200:
            pytest.skip(f"register failed: {r.text}")
        otp = r.json().get("dev_otp")
        if not otp:
            pytest.skip("no dev_otp")
        v = requests.post(f"{BASE}/api/auth/verify-otp", json={"email": email, "code": otp}, timeout=30)
        assert v.status_code == 200, v.text
        return v.json()["access_token"]

    def test_b_cannot_read_a_request(self, clientB):
        rid = pytest.gstr1_req_id
        r = requests.get(f"{BASE}/api/client/requests/{rid}", headers=H(clientB), timeout=30)
        assert r.status_code == 404

    def test_b_cannot_get_a_screenshot(self, clientB):
        pid = pytest.gstr1_pay_id
        # gridfiles token endpoint not exposed to clients, but admin/payments is admin only anyway.
        # ensure client B calling admin endpoint gets 403
        r = requests.get(f"{BASE}/api/admin/payments/{pid}/screenshot", headers=H(clientB), timeout=30)
        assert r.status_code == 403

    def test_b_price_shows_unassigned(self, clientB, catalog):
        sid = catalog["ITR Filing"]["id"]
        r = requests.get(f"{BASE}/api/client/price", params={"service_id": sid, "fy": "FY 2026-27"}, headers=H(clientB), timeout=30)
        assert r.json()["assigned"] is False
