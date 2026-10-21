// Client-side auth helpers. The token is a JWT issued by the Rozark API
// (POST /auth/login, POST /auth/signup). Stored in localStorage — this is a
// client-side guard only; the API remains the source of truth and validates
// the token on protected endpoints (GET /auth/me).

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_KEY = "rozark_token";
const USER_KEY = "rozark_user";

export interface AuthUser {
  id: string;
  company_name: string;
  name: string;
  email: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function storeAuth(token: string, user: AuthUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

async function authRequest(path: string, body: Record<string, string>): Promise<AuthUser> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }
  const data = await res.json();
  storeAuth(data.token, data.user);
  return data.user as AuthUser;
}

export function login(email: string, password: string): Promise<AuthUser> {
  return authRequest("/auth/login", { email, password });
}

export function signup(company_name: string, name: string, email: string, password: string): Promise<AuthUser> {
  return authRequest("/auth/signup", { company_name, name, email, password });
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = (await res.json()) as AuthUser;
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  } catch {
    return getStoredUser();
  }
}
