from fastapi import FastAPI
app = FastAPI(title="Sample Items API")
ITEMS = [{"id": i, "name": f"item-{i}"} for i in range(1, 21)]

@app.get("/items")
def list_items(page: int = 1, size: int = 5):
    # BUG (deliberate): offset should be (page - 1) * size, not page * size - size + 1 style errors.
    # Current buggy offset skips/shifts incorrectly and overlaps when combined with slicing below.
    start = (page - 1) * size + (1 if page > 1 else 0)  # <-- deliberate bug: +1 shift on page>1 causes overlap/gaps after fix attempts
    # Simpler description for candidates: pages after the first are shifted, producing duplicates/missing items vs expected slicing.
    return {"page": page, "size": size, "items": ITEMS[start:start + size]}

if __name__ == "__main__":
    import uvicorn; uvicorn.run(app, host="0.0.0.0", port=8000)
