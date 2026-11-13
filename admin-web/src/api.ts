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
    !/^\/(?:[a-z0-9_-]+\/)*api\/v1\/?$/i.test(url.pathname) ||
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
  private bearerProvider?: () => Promise<string>;
  private resources = new Map<string, { value: unknown; at: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  constructor(base: string, token = "", expired = () => {}) {
    this.base = apiBase(base);
    this.token = token;
    this.expired = expired;
  }
  // Private response data lives only in this session's Client instance. It is
  // never persisted to browser storage or used to make authorization decisions.
  peekResource<T>(path: string): { data: T; fresh: boolean } | undefined {
    const item = this.resources.get(path);
    if (!item || Date.now() - item.at > 120000) return undefined;
    return { data: item.value as T, fresh: Date.now() - item.at < 10000 };
  }
  clearResources() {
    this.generation++;
    this.resources.clear();
    this.pending.clear();
  }
  setBearerProvider(provider: () => Promise<string>) {
    this.clearResources();
    this.bearerProvider = provider;
  }
  async resource<T>(path: string, force = false): Promise<T> {
    if (path.startsWith("auth/") || path.startsWith("public/"))
      return this.request<T>(path);
    const cached = this.peekResource<T>(path);
    if (!force && cached?.fresh) return cached.data;
    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight as Promise<T>;
    const generation = this.generation;
    const promise = this.request<T>(path).then((value) => {
      if (this.generation === generation) {
        if (this.resources.size >= 100) this.resources.delete(this.resources.keys().next().value!);
        this.resources.set(path, { value, at: Date.now() });
      }
      return value;
    });
    this.pending.set(path, promise);
    try {
      return await promise;
    } finally {
      if (this.pending.get(path) === promise) this.pending.delete(path);
    }
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    asBlob = false,
    challengeHeaders?: { 'X-Turnstile-Token'?: string },
  ): Promise<T> {
    const [route, query, extra] = path.split("?");
    if (
      !/^[a-z0-9][a-z0-9_/.-]*$/i.test(route) || route.includes("..") || route.includes("//") || extra !== undefined ||
      (query !== undefined && (!/^[a-z0-9_%=&.+~-]*$/i.test(query) || /%(?![a-f0-9]{2})/i.test(query)))
    )
      throw new Error("Invalid API path.");
    if (method !== "GET") this.clearResources();
    const bearer = this.bearerProvider ? await this.bearerProvider() : this.token;
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
        ...challengeHeaders,
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
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
      if (response.status === 401 || response.status === 403) this.clearResources();
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
