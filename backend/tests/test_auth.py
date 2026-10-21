from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

SIGNUP = {"company_name": "Acme Hiring", "name": "Asha Recruiter", "email": "asha@acme.test", "password": "hunter2-password"}


def test_signup_returns_token_and_user():
    r = client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 201
    data = r.json()
    assert data["token"]
    assert data["user"]["email"] == SIGNUP["email"]
    assert data["user"]["company_name"] == "Acme Hiring"
    assert "password" not in str(data).lower() or "password_hash" not in str(data)


def test_signup_duplicate_email_409():
    client.post("/auth/signup", json={**SIGNUP, "email": "dup@acme.test"})
    r = client.post("/auth/signup", json={**SIGNUP, "email": "dup@acme.test"})
    assert r.status_code == 409


def test_signup_short_password_422():
    r = client.post("/auth/signup", json={**SIGNUP, "email": "short@acme.test", "password": "abc"})
    assert r.status_code == 422


def test_login_success():
    client.post("/auth/signup", json={**SIGNUP, "email": "login@acme.test"})
    r = client.post("/auth/login", json={"email": "login@acme.test", "password": SIGNUP["password"]})
    assert r.status_code == 200
    assert r.json()["token"]


def test_login_wrong_password_401():
    client.post("/auth/signup", json={**SIGNUP, "email": "wrong@acme.test"})
    r = client.post("/auth/login", json={"email": "wrong@acme.test", "password": "not-the-password"})
    assert r.status_code == 401


def test_login_unknown_email_401():
    r = client.post("/auth/login", json={"email": "ghost@nowhere.test", "password": "whatever123"})
    assert r.status_code == 401


def test_me_with_token():
    r = client.post("/auth/signup", json={**SIGNUP, "email": "me@acme.test"})
    token = r.json()["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "me@acme.test"


def test_me_without_token_401():
    assert client.get("/auth/me").status_code == 401


def test_me_with_garbage_token_401():
    r = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_demo_account_can_login():
    r = client.post("/auth/login", json={"email": "demo@rozark.dev", "password": "demo1234"})
    assert r.status_code == 200
    assert r.json()["user"]["company_name"] == "Demo Startup"
