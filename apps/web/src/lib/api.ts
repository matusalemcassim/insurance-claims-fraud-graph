import { getAccessToken, refreshAccessToken, logout } from "./auth";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

async function authHeaders(): Promise<Record<string, string>> {
  const token = getAccessToken();
  if (!token) { logout(); return {}; }
  return {
    "Authorization": `Bearer ${token}`,
    "X-API-Key": process.env.NEXT_PUBLIC_API_KEY ?? "",
  };
}

async function handleResponse<T>(res: Response, retry: () => Promise<T>): Promise<T> {
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) return retry();
    logout();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
  return handleResponse(res, () => apiGet<T>(path));
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse(res, () => apiPost<T>(path, body));
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse(res, () => apiPatch<T>(path, body));
}