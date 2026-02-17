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

type BridgeResponse<T> = { ok: true; result: T } | { ok: false; error: string };

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
    const init: RequestInit = {
      method,
      signal: AbortSignal.timeout(30_000),
    };
    if (opts.body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url.toString(), init);
    const data = (await res.json()) as BridgeResponse<T>;
    if (!data.ok) {
      throw new Error(data.error);
    }
    return data.result;
  }

  schema(): Promise<BridgeSchema> {
    return this.request("GET", "/schema");
  }

  get(path: string, query?: Record<string, string | number | boolean>): Promise<unknown> {
    return this.request("GET", path, { query });
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, { body });
  }
}
