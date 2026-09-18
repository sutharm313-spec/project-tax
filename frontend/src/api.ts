// API client: base URL from env, JWT attach, single refresh-on-401, multipart
// upload with progress. Tokens live in secure storage.
import { storage } from "@/src/utils/storage";

export const TOKEN_KEY = "tm_tokens";

export type Tokens = { access_token: string; refresh_token: string };

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getTokens(): Promise<Tokens | null> {
  return (await storage.secureGet(TokensShim.key, null as never)) as Tokens | null;
}

const TokensShim = { key: TOKEN_KEY };

export async function saveTokens(t: Tokens) {
  await storage.secureSet(TOKEN_KEY, t as never);
}

export async function clearTokens() {
  await storage.secureRemove(TOKEN_KEY);
}

type Opts = { method?: string; body?: unknown; raw?: true };

async function rawRequest(path: string, opts: Opts, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "detail" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).detail)
        : `Request failed (${res.status})`;
    throw new APIError(res.status, detail);
  }
  return data as T;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  let tokens = await getTokens();
  let res = await rawRequest(path, opts, tokens?.access_token);
  if (res.status === 401 && tokens?.refresh_token) {
    try {
      const refreshed = await fetch(`${BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      });
      if (refreshed.ok) {
        const data = (await refreshed.json()) as Tokens & { user?: unknown };
        await saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
        res = await rawRequest(path, opts, data.access_token);
      }
    } catch {
      // fallthrough to error below
    }
  }
  return parse<T>(res);
}

export async function apiUpload<T = unknown>(
  path: string,
  fields: Record<string, string>,
  file: { uri: string; name: string; mimeType: string },
  onProgress?: (pct: number) => void,
): Promise<T> {
  const tokens = await getTokens();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api${path}`);
    if (tokens?.access_token) xhr.setRequestHeader("Authorization", `Bearer ${tokens.access_token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { detail: xhr.responseText };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const detail =
          typeof data === "object" && data && "detail" in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>).detail)
            : `Upload failed (${xhr.status})`;
        reject(new APIError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new APIError(0, "Network error during upload"));
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    // React Native expects a file object, not a Blob
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    xhr.send(form);
  });
}

export async function apiForm<T = unknown>(path: string, fields: Record<string, string>): Promise<T> {
  const tokens = await getTokens();
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
    },
    body,
  });
  return parse<T>(res);
}

/** Authenticated, expiring file link (view or download) for a document. */
export async function fileUrl(docId: string, action: "view" | "download"): Promise<string> {
  const res = await api<{ file_token: string }>(`/client/documents/${docId}/access?action=${action}`);
  return `${BASE}/api/files/${res.file_token}`;
}

export const BACKEND = BASE;
