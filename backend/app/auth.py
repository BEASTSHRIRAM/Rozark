"""Authentication for Rozark (increment: product surface + auth).

Design (honest, MVP-grade):
- Passwords are NEVER stored in plaintext. They are hashed with
  hashlib.pbkdf2_hmac (SHA-256, per-user random salt, 260k iterations)
  from the Python standard library — no native dependency risk.
- Sessions are signed JWTs (PyJWT, HS256). The signing secret comes from
  the ROZARK_JWT_SECRET environment variable. The default below is a DEV
  DEFAULT ONLY — set a real secret in any deployed environment.
- Users live in the in-memory store (same pattern as challenges/attempts),
  so accounts reset when the backend restarts. Persistence is future work
  and is labelled as such in the README.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException

# DEV DEFAULT — override with ROZARK_JWT_SECRET in production.
JWT_SECRET = os.environ.get("ROZARK_JWT_SECRET", "rozark-dev-secret-change-me")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24 * 7  # 7 days

_PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def create_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")


def current_user_id(authorization: str | None) -> str:
    """Extract and validate the Bearer token from an Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    payload = decode_token(authorization.removeprefix("Bearer ").strip())
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(401, "Invalid token")
    return sub
