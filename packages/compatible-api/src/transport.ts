import { request as httpsRequest, type RequestOptions } from "node:https";
import { performance } from "node:perf_hooks";
import { asCompatibleApiError, CompatibleApiError } from "./errors.js";

export const COMPATIBLE_ENDPOINTS = Object.freeze({
  listings: "/v1/auction/list/{page}",
  transactions: "/v1/auction/transactions/{page}",
});

export const DEFAULT_COMPATIBLE_ALLOWED_HOSTS = Object.freeze(["api.donutsmp.net"] as const);

export type AuctionSort = "highest_price" | "last_listed" | "lowest_price" | "recently_listed";
const AUCTION_SORTS = new Set<AuctionSort>(["highest_price", "last_listed", "lowest_price", "recently_listed"]);

export interface AuctionListRequest {
  readonly search?: string;
  readonly sort?: AuctionSort;
}

export interface TransportRequest {
  readonly url: URL;
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly signal?: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly byteLength: number;
  readonly elapsedMs: number;
}

export type HttpDispatcher = (request: TransportRequest) => Promise<TransportResponse>;

function headerRecord(headers: NodeJS.Dict<string | string[]>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return Object.freeze(result);
}

export const nodeHttpsDispatcher: HttpDispatcher = (input) => new Promise((resolve, reject) => {
  const started = performance.now();
  let settled = false;
  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  const options: RequestOptions = {
    protocol: input.url.protocol,
    hostname: input.url.hostname,
    ...(input.url.port === "" ? {} : { port: input.url.port }),
    path: `${input.url.pathname}${input.url.search}`,
    method: input.method,
    headers: input.headers,
  };
  const request = httpsRequest(options, (response) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    response.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > input.maxResponseBytes) {
        response.destroy();
        fail(new CompatibleApiError({
          code: "response_too_large",
          message: `Upstream response exceeded ${input.maxResponseBytes} bytes`,
          retryable: true,
        }));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Object.freeze({
        status: response.statusCode ?? 0,
        headers: headerRecord(response.headers),
        rawBody: Buffer.concat(chunks).toString("utf8"),
        byteLength,
        elapsedMs: performance.now() - started,
      }));
    });
    response.on("error", fail);
  });
  request.setTimeout(input.timeoutMs, () => {
    request.destroy(new CompatibleApiError({
      code: "timeout",
      message: `Compatible API request timed out after ${input.timeoutMs}ms`,
      retryable: true,
    }));
  });
  request.on("error", fail);
  if (input.signal !== undefined) {
    if (input.signal.aborted) {
      request.destroy(new CompatibleApiError({ code: "aborted", message: "Request aborted", retryable: false }));
      return;
    }
    input.signal.addEventListener("abort", () => {
      request.destroy(new CompatibleApiError({ code: "aborted", message: "Request aborted", retryable: false }));
    }, { once: true });
  }
  if (input.body !== undefined) request.write(input.body);
  request.end();
});

export interface CompatibleApiTransportConfig {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly allowedHosts?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly userAgent?: string;
  readonly dispatcher?: HttpDispatcher;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function pageNumber(value: number, endpoint: "listings" | "transactions"): number {
  positiveInteger(value, "page");
  if (endpoint === "transactions" && value > 10) {
    throw new CompatibleApiError({ code: "invalid_page", message: "Transaction page must be between 1 and 10", retryable: false });
  }
  return value;
}

export class CompatibleApiTransport {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly userAgent: string;
  private readonly dispatcher: HttpDispatcher;

  constructor(config: CompatibleApiTransportConfig) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(config.baseUrl);
    } catch (cause) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API base URL is invalid", retryable: false, cause });
    }
    if (baseUrl.protocol !== "https:") {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API base URL must use HTTPS", retryable: false });
    }
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API base URL cannot contain credentials, query, or fragment", retryable: false });
    }
    if (baseUrl.port !== "" && baseUrl.port !== "443") {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API base URL must use the default HTTPS port", retryable: false });
    }
    const allowedHosts = (config.allowedHosts ?? DEFAULT_COMPATIBLE_ALLOWED_HOSTS).map((host) => host.trim().toLowerCase());
    if (allowedHosts.length === 0 || allowedHosts.some((host) => host.length === 0 || /[/:@?#]/.test(host))) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API allowedHosts must contain hostnames only", retryable: false });
    }
    if (!allowedHosts.includes(baseUrl.hostname.toLowerCase())) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API host is not allowlisted", retryable: false });
    }
    const token = config.bearerToken.trim();
    if (token.length === 0 || /[\r\n]/.test(token)) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API bearer token is missing or invalid", retryable: false });
    }
    this.baseUrl = baseUrl;
    this.token = token;
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 10_000, "timeoutMs");
    this.maxResponseBytes = positiveInteger(config.maxResponseBytes ?? 2 * 1024 * 1024, "maxResponseBytes");
    const userAgent = (config.userAgent ?? "donut-market-collector/0.1").trim();
    if (userAgent.length === 0 || /[\u0000-\u001f\u007f]/.test(userAgent)) {
      throw new CompatibleApiError({ code: "configuration", message: "Compatible API userAgent is invalid", retryable: false });
    }
    this.userAgent = userAgent;
    this.dispatcher = config.dispatcher ?? nodeHttpsDispatcher;
  }

  private url(path: string): URL {
    const url = new URL(this.baseUrl.toString());
    const prefix = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    url.pathname = `${prefix}${path}`;
    url.search = "";
    url.hash = "";
    return url;
  }

  private async request(path: string, body: string | undefined, signal: AbortSignal | undefined): Promise<TransportResponse> {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain;q=0.9",
      authorization: `Bearer ${this.token}`,
      "user-agent": this.userAgent,
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(body));
      headers["cache-control"] = "no-store";
    }
    try {
      return await this.dispatcher({
        url: this.url(path),
        method: "GET",
        headers: Object.freeze(headers),
        ...(body === undefined ? {} : { body }),
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw asCompatibleApiError(error, [this.token]);
    }
  }

  async requestTransactionPage(page: number, signal?: AbortSignal): Promise<TransportResponse> {
    return await this.request(`/v1/auction/transactions/${pageNumber(page, "transactions")}`, undefined, signal);
  }

  async requestListingPage(page: number, request: AuctionListRequest = {}, signal?: AbortSignal): Promise<TransportResponse> {
    const search = request.search;
    if (search !== undefined && (typeof search !== "string" || search.length > 256 || /[\u0000-\u001f\u007f]/.test(search))) {
      throw new CompatibleApiError({ code: "configuration", message: "Auction search must be at most 256 printable characters", retryable: false });
    }
    if (request.sort !== undefined && !AUCTION_SORTS.has(request.sort)) {
      throw new CompatibleApiError({ code: "configuration", message: "Auction sort is not supported", retryable: false });
    }
    const payload: { search?: string; sort?: AuctionSort } = {};
    if (search !== undefined) payload.search = search;
    if (request.sort !== undefined) payload.sort = request.sort;
    const body = Object.keys(payload).length === 0 ? undefined : JSON.stringify(payload);
    return await this.request(`/v1/auction/list/${pageNumber(page, "listings")}`, body, signal);
  }
}
