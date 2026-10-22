from fastapi.testclient import TestClient
from app.main import app
from app.sandbox import workspace_path_for
client = TestClient(app)

def _started():
    chs = client.get("/challenges").json()
    aid = client.post("/attempts", json={"challenge_id": chs[0]["id"], "candidate_name": "WF"}).json()["id"]
    r = client.post(f"/attempts/{aid}/sandbox/start")
    assert r.status_code == 200, r.text
    return aid

def test_files_require_sandbox():
    chs = client.get("/challenges").json()
    aid = client.post("/attempts", json={"challenge_id": chs[0]["id"], "candidate_name": "NoSB"}).json()["id"]
    assert client.get(f"/attempts/{aid}/files").status_code == 409
    assert client.get("/attempts/nope/files").status_code == 404

def test_list_and_read():
    aid = _started()
    d = client.get(f"/attempts/{aid}/files").json()
    assert d["attempt_id"] == aid and d["files"]
    paths = {f["path"]: f for f in d["files"]}
    assert "README.md" in paths and paths["README.md"]["read_only"] is True
    assert not any(p.startswith(".git") for p in paths)
    r = client.get(f"/attempts/{aid}/files/content", params={"path": "README.md"})
    assert r.status_code == 200 and r.json()["read_only"] is True and r.json()["content"]
    types = [e["type"] for e in client.get(f"/attempts/{aid}/events").json()]
    assert "file_view" in types
    assert client.get(f"/attempts/{aid}/files/content", params={"path": "nope.txt"}).status_code == 404

def test_write_and_readonly_and_traversal():
    aid = _started()
    r = client.put(f"/attempts/{aid}/files/content", json={"path": "notes/todo.txt", "content": "hello"})
    assert r.status_code == 200, r.text
    assert r.json() == {"path": "notes/todo.txt", "size": 5}
    got = client.get(f"/attempts/{aid}/files/content", params={"path": "notes/todo.txt"}).json()
    assert got["content"] == "hello"
    ro = client.put(f"/attempts/{aid}/files/content", json={"path": "README.md", "content": "x"})
    assert ro.status_code == 403
    trav = client.put(f"/attempts/{aid}/files/content", json={"path": "../evil.txt", "content": "x"})
    assert trav.status_code == 400
    trav2 = client.get(f"/attempts/{aid}/files/content", params={"path": "../../etc/passwd"})
    assert trav2.status_code in (400, 404)

def test_hidden_forbidden():
    aid = _started()
    ws = workspace_path_for(aid)
    (ws / "tests").mkdir(exist_ok=True)
    (ws / "tests" / "test_hidden.py").write_text("secret")
    r = client.get(f"/attempts/{aid}/files/content", params={"path": "tests/test_hidden.py"})
    assert r.status_code == 403
    w = client.put(f"/attempts/{aid}/files/content", json={"path": "tests/test_hidden.py", "content": "x"})
    assert w.status_code == 403

def test_put_after_submit_409_get_ok():
    aid = _started()
    assert client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 60%"}).status_code == 200
    assert client.put(f"/attempts/{aid}/files/content", json={"path": "a.txt", "content": "x"}).status_code == 409
    assert client.get(f"/attempts/{aid}/files").status_code == 200
