from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def _mk(title="CRUD Chal"):
    r = client.post("/challenges", json={"title": title, "difficulty": "easy"})
    assert r.status_code == 201, r.text
    return r.json()

def test_put_updates_and_defaults():
    ch = _mk("ToUpdate")
    r = client.put(f"/challenges/{ch['id']}", json={"title": "Updated", "difficulty": "hard"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Updated" and r.json()["score"] == 100 and r.json()["id"] == ch["id"]

def test_put_404():
    assert client.put("/challenges/nope", json={"title": "x"}).status_code == 404

def test_delete_204_and_404():
    ch = _mk("ToDelete")
    assert client.delete(f"/challenges/{ch['id']}").status_code == 204
    assert client.get(f"/challenges/{ch['id']}").status_code == 404
    assert client.delete(f"/challenges/{ch['id']}").status_code == 404

def test_delete_409_with_attempt():
    ch = _mk("HasAttempt")
    a = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "C"})
    assert a.status_code == 201
    assert client.delete(f"/challenges/{ch['id']}").status_code == 409

def test_clone():
    ch = _mk("Original")
    r = client.post(f"/challenges/{ch['id']}/clone")
    assert r.status_code == 201, r.text
    assert r.json()["id"] != ch["id"] and r.json()["title"] == "Original (copy)"
    assert client.post("/challenges/nope/clone").status_code == 404

def test_list_attempts_filters():
    ch = _mk("FilterChal")
    a = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "F1"}).json()
    lst = client.get("/attempts", params={"challenge_id": ch["id"]}).json()
    assert any(x["id"] == a["id"] for x in lst) and all(x["challenge_id"] == ch["id"] for x in lst)
    lst2 = client.get("/attempts", params={"challenge_id": ch["id"], "status": "in_progress"}).json()
    assert any(x["id"] == a["id"] for x in lst2)
    assert client.get("/attempts", params={"status": "submitted", "challenge_id": ch["id"]}).json() == []
    lst3 = client.get(f"/challenges/{ch['id']}/attempts").json()
    assert any(x["id"] == a["id"] for x in lst3)
    assert client.get("/challenges/nope/attempts").status_code == 404
