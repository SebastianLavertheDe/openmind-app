import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { IncomingMessage } from "node:http";
import type { CredentialVault } from "./credential-vault";
import type { ProviderProfile, ProviderProtocol, ProviderTestState } from "../../shared/provider-profiles";
import { ProviderProfileRepository } from "./provider-profile-repository";

export type ProviderConnectivityRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  tlsPolicy: ProviderProfile["tlsPolicy"];
  proxyUrl?: string;
};

type RequestResult = { statusCode: number };
export type ProviderConnectivityRequester = (spec: ProviderConnectivityRequest) => Promise<RequestResult>;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Main-process connectivity probe. It never returns or persists response bodies or Secrets. */
export class ProviderConnectivityService {
  constructor(
    private readonly profiles: ProviderProfileRepository,
    private readonly credentials: CredentialVault,
    private readonly request: ProviderConnectivityRequester = requestProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async test(id: string): Promise<ProviderProfile> {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error("Provider Profile 不存在。");
    const test = await this.runTest(profile);
    return this.profiles.recordTest(id, test);
  }

  private async runTest(profile: ProviderProfile): Promise<ProviderTestState> {
    const testedAt = this.now().toISOString();
    try {
      if (profile.proxyPolicy === "explicit" && !profile.proxyUrl) {
        return { status: "failed", testedAt, diagnostic: "显式代理策略尚未配置代理地址。" };
      }
      const run = async (secret: string) => this.requestWithRetry(profile, buildRequest(profile, secret));
      const result = profile.credentialId
        ? await this.credentials.withSecret(profile.credentialId, null, run)
        : await run("");
      if (result.statusCode >= 200 && result.statusCode < 300) {
        return { status: "success", testedAt, diagnostic: `连接成功（HTTP ${result.statusCode}）。` };
      }
      return { status: "failed", testedAt, diagnostic: `Provider 返回 HTTP ${result.statusCode}。` };
    } catch (error) {
      return { status: "failed", testedAt, diagnostic: safeDiagnostic(error) };
    }
  }

  private async requestWithRetry(profile: ProviderProfile, spec: ProviderConnectivityRequest): Promise<RequestResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.request(spec);
        if (!RETRYABLE_STATUS.has(result.statusCode) || attempt >= profile.maxRetries) return result;
      } catch (error) {
        if (attempt >= profile.maxRetries) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000)));
    }
  }
}

function buildRequest(profile: ProviderProfile, secret: string): ProviderConnectivityRequest {
  const url = resolveEndpoint(profile.baseUrl, profile.protocol);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (secret) {
    if (profile.protocol === "anthropic-messages") {
      headers["x-api-key"] = secret;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${secret}`;
    }
  }
  const options = profile.providerOptions || {};
  if (options.organization) headers["OpenAI-Organization"] = options.organization;
  if (options.project) headers["OpenAI-Project"] = options.project;
  if (options.apiVersion) headers["api-version"] = options.apiVersion;
  if (profile.protocol === "anthropic-messages" && options.anthropicVersion) headers["anthropic-version"] = options.anthropicVersion;
  const proxyUrl = profile.proxyPolicy === "explicit" ? profile.proxyUrl : undefined;
  if (profile.protocol === "provider-native") {
    return { method: "GET", url, headers, timeoutMs: profile.timeoutMs, tlsPolicy: profile.tlsPolicy, ...(proxyUrl ? { proxyUrl } : {}) };
  }
  headers["Content-Type"] = "application/json";
  const body = profile.protocol === "anthropic-messages"
    ? JSON.stringify({ model: profile.model, max_tokens: 8, temperature: 0, messages: [{ role: "user", content: "Reply with exactly OK." }] })
    : profile.protocol === "openai-responses"
      ? JSON.stringify({ model: profile.model, input: "Reply with exactly OK.", max_output_tokens: 8 })
      : JSON.stringify({ model: profile.model, messages: [{ role: "user", content: "Reply with exactly OK." }], max_tokens: 8, temperature: 0, stream: false });
  return { method: "POST", url, headers, body, timeoutMs: profile.timeoutMs, tlsPolicy: profile.tlsPolicy, ...(proxyUrl ? { proxyUrl } : {}) };
}

function resolveEndpoint(baseUrl: string, protocol: ProviderProtocol): string {
  if (!baseUrl) throw new Error("Provider Profile 缺少 Base URL；当前连接测试不支持空地址。");
  const url = new URL(baseUrl);
  const suffix = protocol === "openai-chat"
    ? "chat/completions"
    : protocol === "openai-responses"
      ? "responses"
      : protocol === "anthropic-messages" ? "messages" : "";
  if (!suffix || url.pathname.endsWith(`/${suffix}`)) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix}`;
  return url.toString();
}

function requestProvider(spec: ProviderConnectivityRequest): Promise<RequestResult> {
  const target = new URL(spec.url);
  const proxy = spec.proxyUrl ? new URL(spec.proxyUrl) : null;
  if (!proxy) return requestDirect(spec, target);
  if (target.protocol === "http:") return requestHttpViaProxy(spec, target, proxy);
  return requestHttpsViaProxy(spec, target, proxy);
}

function requestDirect(spec: ProviderConnectivityRequest, target: URL): Promise<RequestResult> {
  const transport = target.protocol === "https:" ? https : http;
  return requestWithTransport(transport, {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: spec.method,
    headers: spec.headers,
    timeout: spec.timeoutMs,
    ...(target.protocol === "https:" ? { rejectUnauthorized: spec.tlsPolicy !== "allow-insecure" } : {})
  }, spec);
}

function requestHttpViaProxy(spec: ProviderConnectivityRequest, target: URL, proxy: URL): Promise<RequestResult> {
  const transport = proxy.protocol === "https:" ? https : http;
  return requestWithTransport(transport, {
    protocol: proxy.protocol,
    hostname: proxy.hostname,
    port: proxy.port || undefined,
    path: target.toString(),
    method: spec.method,
    headers: { ...spec.headers, Host: target.host },
    timeout: spec.timeoutMs,
    ...(proxy.protocol === "https:" ? { rejectUnauthorized: spec.tlsPolicy !== "allow-insecure" } : {})
  }, spec);
}

function requestHttpsViaProxy(spec: ProviderConnectivityRequest, target: URL, proxy: URL): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const proxyTransport = proxy.protocol === "https:" ? https : http;
    const connect = proxyTransport.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || undefined,
      method: "CONNECT",
      path: target.host,
      headers: { Host: target.host },
      timeout: spec.timeoutMs,
      ...(proxy.protocol === "https:" ? { rejectUnauthorized: spec.tlsPolicy !== "allow-insecure" } : {})
    });
    connect.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        response.resume();
        socket.destroy();
        reject(new Error(`Proxy CONNECT 返回 HTTP ${response.statusCode || 0}。`));
        return;
      }
      if (head.length) socket.unshift(head);
      const secureSocket = tls.connect({
        socket,
        servername: target.hostname,
        rejectUnauthorized: spec.tlsPolicy !== "allow-insecure"
      });
      secureSocket.once("error", reject);
      secureSocket.once("secureConnect", () => {
        void requestWithTransport(https, {
          protocol: "https:",
          hostname: target.hostname,
          port: target.port || undefined,
          path: `${target.pathname}${target.search}`,
          method: spec.method,
          headers: spec.headers,
          timeout: spec.timeoutMs,
          agent: false,
          createConnection: () => secureSocket,
          rejectUnauthorized: spec.tlsPolicy !== "allow-insecure"
        }, spec).then(resolve, reject);
      });
    });
    connect.once("timeout", () => connect.destroy(new Error("Provider 代理连接超时。")));
    connect.once("error", reject);
    connect.end();
  });
}

function requestWithTransport(
  transport: typeof http | typeof https,
  options: http.RequestOptions | https.RequestOptions,
  spec: ProviderConnectivityRequest
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (response: IncomingMessage) => {
      response.resume();
      response.once("end", () => resolve({ statusCode: response.statusCode || 0 }));
    });
    req.once("timeout", () => req.destroy(new Error("Provider 连接超时。")));
    req.once("error", reject);
    if (spec.body) req.write(spec.body);
    req.end();
  });
}

function safeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|超时/i.test(message)) return "Provider 连接超时。";
  if (/certificate|self[- ]signed|tls|ssl/i.test(message)) return "TLS 握手失败，请检查证书策略。";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "Provider 主机名无法解析。";
  if (/ECONNREFUSED/i.test(message)) return "Provider 拒绝连接。";
  return message.replace(/\s+/g, " ").slice(0, 500) || "Provider 连接失败。";
}
