export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function apiBase(value: string) {
  if (!value) return "/api/v1";
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, "") !== "/api/v1" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "VITE_API_URL must be an HTTPS API address ending in /api/v1.",
    );
  return url.href.replace(/\/$/, "");
}
export class Client {
  base: string;
  token: string;
  expired: () => void;
  constructor(base: string, token = "", expired = () => {}) {
    this.base = apiBase(base);
    this.token = token;
    this.expired = expired;
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    asBlob = false,
  ): Promise<T> {
    if (
      !/^[a-z0-9][a-z0-9_/?=&.-]*$/i.test(path) ||
      path.includes("..") ||
      path.includes("//")
    )
      throw new Error("Invalid API path.");
    const response = await fetch(this.base + "/" + path, {
      method,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(body instanceof FormData ? 180000 : 25000),
          ])
        : AbortSignal.timeout(body instanceof FormData ? 180000 : 25000),
      headers: {
        ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    }).catch((error) => {
      if (error.name === "AbortError") throw error;
      throw new ApiError(
        "The server could not be reached. Check your connection and try again.",
        0,
      );
    });
    if (response.ok && asBlob) return (await response.blob()) as T;
    if (response.status === 204) return undefined as T;
    const value = await response.json().catch(() => null);
    if (response.ok && value === null)
      throw new ApiError("The server returned an unreadable response.", 502);
    if (!response.ok) {
      if (response.status === 401 && this.token) this.expired();
      const message = Array.isArray(value?.message)
        ? value.message.join("; ")
        : value?.message;
      throw new ApiError(
        typeof message === "string"
          ? message
          : "The request could not be completed.",
        response.status,
      );
    }
    return value as T;
  }
}
