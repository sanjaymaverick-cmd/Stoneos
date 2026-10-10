export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "stoneos.session";

export function readToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { message?: unknown }) : {};
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(" ")
      : typeof data.message === "string"
        ? data.message
        : "Something went wrong";
    throw new ApiError(message, response.status);
  }
  return data as T;
}
