import { describe, expect, it } from "vitest";
import { isPublicAddress, parsePublicHttpUrl, resolvePublicUrl } from "./public-url";

describe("Project public URL boundary", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1"
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("rejects local schemes, credentials, ports, and hostnames", () => {
    expect(() => parsePublicHttpUrl("file:///etc/passwd")).toThrow(/HTTP/);
    expect(() => parsePublicHttpUrl("https://user:pass@example.com/")).toThrow(/用户名/);
    expect(() => parsePublicHttpUrl("https://example.com:8080/")).toThrow(/端口/);
    expect(() => parsePublicHttpUrl("http://localhost/")).toThrow(/内网/);
    expect(() => parsePublicHttpUrl("http://[::1]/")).toThrow(/内网/);
    expect(() => parsePublicHttpUrl("http://[::ffff:7f00:1]/")).toThrow(/内网/);
  });

  it("accepts a public IPv6 literal without asking DNS to resolve brackets", async () => {
    const resolver = async () => { throw new Error("literal IP must not use DNS"); };
    await expect(resolvePublicUrl("https://[2606:4700:4700::1111]/", resolver)).resolves.toMatchObject({
      addresses: [{ address: "2606:4700:4700::1111", family: 6 }]
    });
  });

  it("rejects DNS answers containing private addresses", async () => {
    await expect(resolvePublicUrl("https://example.com/page", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ])).rejects.toThrow(/内网/);
  });
});
