from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)
import uuid
SUF = uuid.uuid4().hex[:8]

_N=[0]
def _signup(company="Acme", name="Org User"):
    _N[0]+=1
    email = f"org-{SUF}-{_N[0]}-{company}@example.com".replace(" ", "")
    r = client.post("/auth/signup", json={"company_name": company, "name": name, "email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return r.json()

def _hdr(tok): return {"Authorization": f"Bearer {tok}"}

def test_org_and_members():
    a = _signup("AcmeCorp", "A One")
    b = _signup("AcmeCorp", "A Two")
    c = _signup("OtherCorp", "C One")
    r = client.get("/org", headers=_hdr(a["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["company_name"] == "AcmeCorp" and d["member_count"] == 2
    assert d["challenge_count"] >= 1 and "attempt_count" in d
    members = client.get("/org/members", headers=_hdr(a["token"])).json()
    emails = {m["email"] for m in members}
    assert a["user"]["email"] in emails and b["user"]["email"] in emails and c["user"]["email"] not in emails
    assert client.get("/org").status_code == 401

def test_patch_me_persists():
    a = _signup("PatchCo", "Before")
    r = client.patch("/auth/me", json={"name": "After Name"}, headers=_hdr(a["token"]))
    assert r.status_code == 200 and r.json()["name"] == "After Name"
    me = client.get("/auth/me", headers=_hdr(a["token"])).json()
    assert me["name"] == "After Name"
    r2 = client.patch("/auth/me", json={"company_name": "RenamedCo"}, headers=_hdr(a["token"]))
    assert r2.json()["company_name"] == "RenamedCo"

def test_change_password():
    a = _signup("PwCo", "Pw User")
    email = a["user"]["email"]
    bad = client.post("/auth/change-password", json={"current_password": "wrong", "new_password": "newpassword1"}, headers=_hdr(a["token"]))
    assert bad.status_code == 401
    short = client.post("/auth/change-password", json={"current_password": "password123", "new_password": "short"}, headers=_hdr(a["token"]))
    assert short.status_code == 422
    ok = client.post("/auth/change-password", json={"current_password": "password123", "new_password": "newpassword1"}, headers=_hdr(a["token"]))
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert client.post("/auth/login", json={"email": email, "password": "newpassword1"}).status_code == 200
    assert client.post("/auth/login", json={"email": email, "password": "password123"}).status_code == 401
