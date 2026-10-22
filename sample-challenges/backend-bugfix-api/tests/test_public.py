# Design contract for this suite: EXACTLY one pass + one fail.
# - test_first_page PASSES (page 1 is correct in the seeded app).
# - test_second_page_no_overlap FAILS (the deliberate pagination bug shifts
#   page 2 — fixing it is the candidate's job).
# The explicit 200-status assert keeps an environmental endpoint failure
# (app down, bad deploy, error payload) from surfacing as a confusing
# KeyError on "items" — it must fail loudly and readably instead.
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)
def test_first_page():
    r = client.get("/items", params={"page": 1, "size": 5})
    assert r.status_code == 200, f"GET /items did not return 200 (got {r.status_code}): {r.text[:200]}"
    assert [i["id"] for i in r.json()["items"]] == [1,2,3,4,5]
def test_second_page_no_overlap():
    r = client.get("/items", params={"page": 2, "size": 5})
    assert r.status_code == 200, f"GET /items did not return 200 (got {r.status_code}): {r.text[:200]}"
    assert [i["id"] for i in r.json()["items"]] == [6,7,8,9,10]
