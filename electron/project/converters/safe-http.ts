import http from "node:http";
import https from "node:https";
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { resolvePublicUrl, type AddressResolver, type ResolvedAddress } from "./public-url";

const MAX_REDIRECTS = 4;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export type SafeHttpResponse = {
  finalUrl: string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

export type SafeHttpOptions = {
  resolver?: AddressResolver;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  method?: "GET" | "HEAD";
  validateUrl?: (url: URL) => void;
};

function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (
    _hostname: string,
    options: LookupOneOptions | LookupAllOptions | number,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
  ) => {
    const all = typeof options === "object" && options !== null && "all" in options && options.all;
    if (all) {
      callback(null, addresses.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    const requestedFamily = typeof options === "number" ? options : typeof options === "object" ? options.family : 0;
    const selected = addresses.find((entry) => !requestedFamily || entry.family === requestedFamily) ?? addresses[0];
    callback(null, selected.address, selected.family);
  };
}

function timeoutError(): Error {
  return new Error("下载超时");
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function beforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) throw timeoutError();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), remaining);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function requestOnce(urlInput: string, options: SafeHttpOptions, deadline: number): Promise<SafeHttpResponse> {
  options.validateUrl?.(new URL(urlInput));
  const { url, addresses } = await beforeDeadline(resolvePublicUrl(urlInput, options.resolver), deadline);
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const transport = url.protocol === "https:" ? https : http;
  const remaining = remainingMs(deadline);
  if (remaining <= 0) throw timeoutError();

  return new Promise((resolve, reject) => {
    let settled = false;
    let request: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    const finish = (error?: unknown, value?: SafeHttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      const error = timeoutError();
      finish(error);
      response?.destroy(error);
      request?.destroy(error);
    }, remaining);

    try {
      request = transport.get(url, {
        method: options.method ?? "GET",
        lookup: createPinnedLookup(addresses),
        headers: {
          accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
          "user-agent": "OpenMind/1.0 ProjectMaterialFetcher"
        }
      }, (incoming) => {
        response = incoming;
        const declaredLength = Number(incoming.headers["content-length"] ?? 0);
        // A HEAD response describes the GET body size but does not transfer it.
        if (options.method !== "HEAD" && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          const error = new Error(`下载内容超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 限制`);
          finish(error);
          incoming.destroy(error);
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (rawChunk: Buffer | string) => {
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          received += chunk.length;
          if (received > maxBytes) {
            const error = new Error(`下载内容超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 限制`);
            finish(error);
            incoming.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        incoming.once("error", (error) => finish(error));
        incoming.once("aborted", () => finish(new Error("下载中断")));
        incoming.once("end", () => finish(undefined, {
          finalUrl: url.toString(),
          statusCode: incoming.statusCode ?? 0,
          headers: incoming.headers,
          body: Buffer.concat(chunks)
        }));
      });
      request.once("error", (error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

export async function safeHttpGet(input: string, options: SafeHttpOptions = {}): Promise<SafeHttpResponse> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const configuredTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1, Math.floor(configuredTimeout)) : DEFAULT_TIMEOUT_MS;
  // One monotonic wall-clock budget covers DNS resolution, connection setup,
  // every redirect and consumption of the complete response body. Socket
  // activity never refreshes this deadline, so a slow-drip peer cannot keep a
  // conversion alive indefinitely.
  const deadline = Date.now() + timeoutMs;
  let current = input;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await requestOnce(current, options, deadline);
    if (![301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`下载失败：HTTP ${response.statusCode}`);
      }
      return response;
    }
    const location = response.headers.location;
    if (!location) throw new Error("重定向响应缺少 Location");
    if (redirectCount === maxRedirects) throw new Error("网页重定向次数过多");
    current = new URL(location, response.finalUrl).toString();
  }
  throw new Error("网页重定向次数过多");
}
