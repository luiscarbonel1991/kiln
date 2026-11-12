import { describe, expect, it } from "vitest";
import { isLocalHost } from "@/lib/local-address";

describe("isLocalHost", () => {
  it("this machine's names are local, with or without a port", () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "127.0.0.1:3009",
      "127.1.2.3",
      "[::1]:3000",
      "kiln.localhost:3000",
      "LOCALHOST:3000",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("anything else may be reached by other people", () => {
    for (const host of [
      "192.168.1.20:3000",
      "kiln.example.com",
      "0.0.0.0:3000",
      "localhost.example.com",
      "127.0.0.1.example.com",
      "my-mac.local:3000",
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("no Host at all is a call from this process", () => {
    expect(isLocalHost(null)).toBe(true);
  });
});
