import dns from "node:dns/promises";
import net from "node:net";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const FORBIDDEN_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const words = parseIpv6Words(value);
  if (!words) return true;
  const embeddedIpv4 = (offset: number) => `${words[offset] >> 8}.${words[offset] & 0xff}.${words[offset + 1] >> 8}.${words[offset + 1] & 0xff}`;
  // IPv4-mapped and IPv4-compatible spellings must inherit the IPv4 policy,
  // including hexadecimal forms such as ::ffff:7f00:1.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isForbiddenIpv4(embeddedIpv4(6));
  }
  if (words.slice(0, 6).every((word) => word === 0)) {
    return isForbiddenIpv4(embeddedIpv4(6));
  }
  // 6to4 embeds the destination IPv4 address in words 1-2.
  if (words[0] === 0x2002 && isForbiddenIpv4(embeddedIpv4(1))) return true;
  const firstByte = words[0] >> 8;
  return (
    firstByte === 0 ||
    (firstByte & 0xfe) === 0xfc ||
    (words[0] & 0xffc0) === 0xfe80 ||
    firstByte === 0xff ||
    (words[0] === 0x0100 && words.slice(1, 4).every((word) => word === 0)) ||
    (words[0] === 0x2001 && words[1] === 0x0db8) ||
    (words[0] === 0x2001 && words[1] === 0x0002) ||
    (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0010) ||
    (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0020) ||
    (words[0] & 0xfff0) === 0x3ff0
  );
}

function parseIpv6Words(input: string): number[] | null {
  let value = input;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const dotted = value.slice(lastColon + 1);
    const parts = dotted.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = `${value.slice(0, lastColon)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const compressed = value.split("::");
  if (compressed.length > 2) return null;
  const parseSide = (side: string) => side ? side.split(":").map((part) => /^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : Number.NaN) : [];
  const left = parseSide(compressed[0]);
  const right = parseSide(compressed[1] ?? "");
  if ([...left, ...right].some((word) => !Number.isFinite(word))) return null;
  if (compressed.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array.from({ length: missing }, () => 0), ...right] : null;
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !isForbiddenIpv4(address);
  if (family === 6) return !isForbiddenIpv6(address);
  return false;
}

export function parsePublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("URL 格式无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("仅支持 HTTP 或 HTTPS URL");
  if (url.username || url.password) throw new Error("URL 不能包含用户名或密码");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("URL 端口不在允许范围内");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("不允许访问本机或内网地址");
  }
  if (net.isIP(hostname) && !isPublicAddress(hostname)) throw new Error("不允许访问本机或内网地址");
  url.hash = "";
  return url;
}

export const defaultAddressResolver: AddressResolver = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
};

export async function resolvePublicUrl(
  input: string | URL,
  resolver: AddressResolver = defaultAddressResolver
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const url = input instanceof URL ? parsePublicHttpUrl(input.toString()) : parsePublicHttpUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) as 4 | 6 }]
    : await resolver(hostname);
  if (addresses.length === 0) throw new Error("URL 域名没有可用地址");
  if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error("URL 解析到本机、内网或保留地址");
  return { url, addresses };
}
