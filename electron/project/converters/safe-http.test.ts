import { EventEmitter } from "node:events";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeHttpGet } from "./safe-http";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeHttpGet total deadline", () => {
  it("preserves HEAD across redirects without treating the declared GET body size as downloaded bytes", async () => {
    const methods: unknown[] = [];
    vi.spyOn(http, "get").mockImplementation(((_url: unknown, options: http.RequestOptions, onResponse: (response: IncomingMessage) => void) => {
      methods.push(options.method);
      const response = fakeResponse(methods.length === 1 ? 302 : 200, { "content-length": "9999999", ...(methods.length === 1 ? { location: "/video" } : {}) });
      queueMicrotask(() => { onResponse(response); response.end(); });
      return new EventEmitter() as ClientRequest;
    }) as typeof http.get);
    const response = await safeHttpGet("http://example.com/share", { method: "HEAD", maxBytes: 1024, resolver: publicResolver });
    expect(methods).toEqual(["HEAD", "HEAD"]);
    expect(response.finalUrl).toBe("http://example.com/video");
    expect(response.body.length).toBe(0);
  });

  it("validates redirect destinations before DNS resolution or issuing a request", async () => {
    const resolver = vi.fn(publicResolver);
    const get = vi.spyOn(http, "get").mockImplementation(((_url: unknown, _options: unknown, onResponse: (response: IncomingMessage) => void) => {
      const response = fakeResponse(302, { location: "http://untrusted.example/video" });
      queueMicrotask(() => { onResponse(response); response.end(); });
      return new EventEmitter() as ClientRequest;
    }) as typeof http.get);
    await expect(safeHttpGet("http://example.com/share", { resolver, validateUrl: url => {
      if (url.hostname !== "example.com") throw new Error("Untrusted redirect");
    } })).rejects.toThrow("Untrusted redirect");
    expect(resolver).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it("times out a response that keeps dripping bytes without ever ending", async () => {
    vi.spyOn(http, "get").mockImplementation(((_url: unknown, _options: unknown, onResponse: (response: IncomingMessage) => void) => {
      const request = new EventEmitter() as ClientRequest;
      const response = fakeResponse(200, { "content-type": "text/plain" });
      let interval: NodeJS.Timeout | undefined;
      queueMicrotask(() => {
        onResponse(response);
        interval = setInterval(() => response.write("x"), 5);
      });
      response.once("close", () => { if (interval) clearInterval(interval); });
      request.destroy = ((error?: Error) => {
        if (interval) clearInterval(interval);
        if (error) queueMicrotask(() => request.emit("error", error));
        return request;
      }) as ClientRequest["destroy"];
      return request;
    }) as typeof http.get);

    const started = Date.now();
    await expect(safeHttpGet("http://example.com/slow", {
      resolver: publicResolver,
      timeoutMs: 45
    })).rejects.toThrow("下载超时");
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("shares one deadline across redirect hops instead of resetting per request", async () => {
    let calls = 0;
    vi.spyOn(http, "get").mockImplementation(((_url: unknown, _options: unknown, onResponse: (response: IncomingMessage) => void) => {
      calls += 1;
      const request = new EventEmitter() as ClientRequest;
      const hop = calls;
      const delivery = setTimeout(() => {
        const response = hop < 5
          ? fakeResponse(302, { location: `/hop-${hop + 1}` })
          : fakeResponse(200, { "content-type": "text/plain" });
        onResponse(response);
        response.end(hop < 5 ? "redirect" : "done");
      }, 25);
      request.destroy = ((error?: Error) => {
        clearTimeout(delivery);
        if (error) queueMicrotask(() => request.emit("error", error));
        return request;
      }) as ClientRequest["destroy"];
      return request;
    }) as typeof http.get);

    const started = Date.now();
    await expect(safeHttpGet("http://example.com/hop-1", {
      resolver: publicResolver,
      timeoutMs: 60,
      maxRedirects: 5
    })).rejects.toThrow("下载超时");
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(5);
    expect(Date.now() - started).toBeLessThan(300);
  });
});

function fakeResponse(statusCode: number, headers: IncomingMessage["headers"]): IncomingMessage {
  const response = new PassThrough() as IncomingMessage;
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}
