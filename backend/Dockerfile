# Backend image. Build context is the REPO ROOT (see docker-compose.yml:
# build.context "." + dockerfile backend/Dockerfile) — not ./backend.
#
# Why: app/sandbox.py computes REPO_ROOT as the parent of backend/ and at
# import time loads REPO_ROOT/sandbox/recorder_sidecar.py and reads
# REPO_ROOT/sample-challenges/. A backend-only context would produce an
# image that crashes at import. The layout below reproduces the repo
# layout inside the image: /app/backend, /app/sandbox,
# /app/sample-challenges, with the app run from /app/backend.
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY sandbox/ ./sandbox/
COPY sample-challenges/ ./sample-challenges/
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
