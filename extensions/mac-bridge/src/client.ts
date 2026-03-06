export type EndpointParam = {
  name: string;
  from: "query" | "body";
  type: "string" | "number" | "boolean" | "string[]";
  required?: boolean;
  default?: string | number | boolean;
  max?: number;
};

export type EndpointSchema = {
  method: string;
  path: string;
  params: EndpointParam[];
};

export type BridgeSchema = {
  app: string;
  endpoints: EndpointSchema[];
};

export type BridgeInfo = {
  name: string;
  prefix: string;
  status: string;
  help: string;
};

type BridgeResponse<T> = { ok: true; result: T } | { ok: false; error: string };

export class BridgeError extends Error {
  readonly data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown>) {
    super(message);
    this.data = data;
  }
}

export class BridgeClient {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | boolean>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }
    // Request JSON so FormatMiddleware doesn't convert to markdown
    const headers: Record<string, string> = { Accept: "application/json" };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url.toString(), init);
    const data = await res.json();
    if (!res.ok) {
      const message = typeof data?.reason === "string" ? data.reason : `HTTP ${res.status}`;
      throw new BridgeError(message, data as Record<string, unknown>);
    }
    const envelope = data as BridgeResponse<T>;
    if (!envelope.ok) {
      throw new BridgeError(envelope.error, data as Record<string, unknown>);
    }
    return envelope.result;
  }

  listBridges(): Promise<BridgeInfo[]> {
    return this.request("GET", "/");
  }

  schema(bridge: string): Promise<BridgeSchema> {
    return this.request("GET", `/${bridge}/schema`);
  }

  get(
    bridge: string,
    path: string,
    query?: Record<string, string | number | boolean>,
  ): Promise<unknown> {
    return this.request("GET", this.resolvePath(bridge, path), { query });
  }

  post(bridge: string, path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", this.resolvePath(bridge, path), { body });
  }

  // Schema paths include the bridge prefix (e.g. "/mail/accounts");
  // avoid doubling it when the agent passes the full schema path.
  private resolvePath(bridge: string, path: string): string {
    const prefix = `/${bridge}`;
    return path.startsWith(prefix) ? path : `${prefix}${path}`;
  }
}
