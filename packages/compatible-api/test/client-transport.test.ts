import { describe, expect, it, vi } from "vitest";
import { createCompatibleApiClient } from "../src/client.js";
import { CompatibleApiError } from "../src/errors.js";
import {
  CompatibleApiTransport,
  type HttpDispatcher,
  type TransportRequest,
  type TransportResponse,
} from "../src/transport.js";

const item = '{"id":"minecraft:diamond","count":2,"display_name":"Diamond","lore":[],"enchants":{"enchantments":{"levels":{}},"trim":{"material":null,"pattern":null}},"contents":[]}';
const seller = '{"name":"ExampleSeller","uuid":"01234567-89ab-cdef-0123-456789abcdef"}';
const listingBody = '{"status":200,"result":[{"item":' + item + ',"price":5,"seller":' + seller + ',"time_left":1000},null]}';

function response(status: number, rawBody: string, headers: Record<string, string> = {}): TransportResponse {
  return Object.freeze({
    status,
    headers: Object.freeze(headers),
    rawBody,
    byteLength: Buffer.byteLength(rawBody),
    elapsedMs: 3,
  });
}

describe("allowlisted GET-with-body transport", () => {
  it("sends only a fixed compatible endpoint with a JSON GET body", async () => {
    const requests: TransportRequest[] = [];
    const dispatcher: HttpDispatcher = async (request) => {
      requests.push(request);
      return response(200, listingBody, { "content-type": "application/json" });
    };
    const transport = new CompatibleApiTransport({
      baseUrl: "https://api.donutsmp.net",
      bearerToken: "test-secret",
      dispatcher,
    });
    await transport.requestListingPage(2, { search: "diamond", sort: "lowest_price" });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url.toString()).toBe("https://api.donutsmp.net/v1/auction/list/2");
    expect(requests[0]!.body).toBe('{"search":"diamond","sort":"lowest_price"}');
    expect(requests[0]!.headers.authorization).toBe("Bearer test-secret");
    expect(requests[0]!.headers["content-type"]).toBe("application/json");
  });

  it("rejects hosts that were not explicitly allowlisted", () => {
    expect(() => new CompatibleApiTransport({
      baseUrl: "https://example.invalid",
      bearerToken: "test-secret",
      dispatcher: async () => response(200, "{}"),
    })).toThrowError(CompatibleApiError);
  });

  it("bounds transaction pages before network dispatch", async () => {
    const dispatcher = vi.fn(async () => response(200, "{}"));
    const transport = new CompatibleApiTransport({
      baseUrl: "https://api.donutsmp.net",
      bearerToken: "test-secret",
      dispatcher,
    });
    await expect(transport.requestTransactionPage(11)).rejects.toMatchObject({ code: "invalid_page" });
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe("compatible API client evidence and taxonomy", () => {
  it("retries 429 responses, honors Retry-After, and returns exact evidence", async () => {
    const responses = [
      response(429, '{"status":429,"result":"limited"}', { "retry-after": "2", "content-type": "text/plain" }),
      response(200, listingBody, { "content-type": "application/json", "x-request-id": "fixture" }),
    ];
    const sleeps: number[] = [];
    const client = createCompatibleApiClient({
      bearerToken: "test-secret",
      dispatcher: async () => responses.shift()!,
      now: () => 1_893_456_000_000,
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 10,
        maxDelayMs: 20,
        random: () => 0,
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      },
    });
    const result = await client.getListingPage(1, { search: "diamond" });
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([2_000]);
    expect(result.data.nullPaddingPositions).toEqual([1]);
    expect(result.evidence.rawBody).toBe(listingBody);
    expect(result.evidence.responseHeaders["x-request-id"]).toBe("fixture");
  });

  it("attaches raw 401 evidence while safe serialization omits the body and token", async () => {
    const rawBody = '{"status":401,"result":"token test-secret denied"}';
    const client = createCompatibleApiClient({
      bearerToken: "test-secret",
      dispatcher: async () => response(401, rawBody, {
        "content-type": "text/plain",
        "set-cookie": "must-not-persist",
      }),
      retryPolicy: { maxAttempts: 1 },
      now: () => 1_893_456_000_000,
    });
    let caught: unknown;
    try {
      await client.getTransactionPage(1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompatibleApiError);
    const error = caught as CompatibleApiError;
    expect(error.code).toBe("unauthorized");
    expect(error.evidence?.rawBody).toBe(rawBody);
    expect(error.evidence?.responseHeaders["set-cookie"]).toBeUndefined();
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(rawBody);
    expect(serialized).not.toContain("test-secret");
    expect(serialized).toContain(error.evidence!.contentSha256);
  });

  it("classifies malformed 2xx bodies and keeps their evidence", async () => {
    const rawBody = '{"status":200,"result":[';
    const client = createCompatibleApiClient({
      bearerToken: "test-secret",
      dispatcher: async () => response(200, rawBody),
      retryPolicy: { maxAttempts: 1 },
      now: () => 1_893_456_000_000,
    });
    await expect(client.getListingPage(1)).rejects.toMatchObject({
      code: "malformed_json",
      evidence: { rawBody },
    });
  });
});
