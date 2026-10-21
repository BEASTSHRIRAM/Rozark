from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)
def test_first_page():
    r = client.get("/items", params={"page": 1, "size": 5})
    assert [i["id"] for i in r.json()["items"]] == [1,2,3,4,5]
def test_second_page_no_overlap():
    r = client.get("/items", params={"page": 2, "size": 5})
    assert [i["id"] for i in r.json()["items"]] == [6,7,8,9,10]
