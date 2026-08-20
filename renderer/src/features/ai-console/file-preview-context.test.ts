import { describe, expect, it } from "vitest";
import { localFileReference } from "./file-preview-context";

describe("localFileReference", () => {
  it("rejects command output and embedded URLs", () => {
    expect(localFileReference("curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to x.com:443")).toBeNull();
    expect(localFileReference("500 Server Error for url: https://wechat2rss.bestblogs.dev/feed/error.xml")).toBeNull();
  });

  it("accepts real local file references", () => {
    expect(localFileReference("openmind/article/example.md:42")).toBe("openmind/article/example.md");
    expect(localFileReference("C:\\work\\notes\\report.md:12")).toBe("C:\\work\\notes\\report.md");
    expect(localFileReference("20260728_daily_summary.md")).toBe("openmind/daily-summary/20260728_daily_summary.md");
  });
});
