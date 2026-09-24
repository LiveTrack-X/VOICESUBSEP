import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientDiagnostics, DIAGNOSTICS_STORAGE_KEY, readServerDiagnostics, sanitizeDiagnostic, serializeDiagnostics } from "./diagnostics";

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
afterEach(() => vi.unstubAllGlobals());
describe("local diagnostics", () => {
  it("retains errors across sessions, coalesces repeats and bounds history", () => {
    const data = storage(); const logs = new ClientDiagnostics(() => data);
    logs.record("api", "connection", "GET /api/jobs"); logs.record("api", "connection", "GET /api/jobs");
    expect(new ClientDiagnostics(() => data).read()).toMatchObject([{ count: 2, message: "GET /api/jobs" }]);
    for (let i = 0; i < 150; i++) logs.record("vst", "failed", `Error ${i}`);
    expect(logs.read()).toHaveLength(100);
    expect(logs.read()[0]?.message).toBe("Error 50");
    expect(data.getItem(DIAGNOSTICS_STORAGE_KEY)!.length).toBeLessThan(200_000);
  });
  it("redacts Windows and Unix paths, URLs, emails and credentials", () => {
    for (const secret of ["C:\\Users\\Alice\\Private.wav", "\\\\server\\private.wav", "/home/alice/private.wav", "https://example.com/?token=private", "Bearer abcdef", "api_key=abcdef", "password: abcdef", "hf_abcdefghijk", "sk-abcdefghijk", "alice@example.com"]) {
      expect(sanitizeDiagnostic(`Failure ${secret}`)).not.toContain(secret);
    }
    expect(sanitizeDiagnostic("x".repeat(20_000))).toHaveLength(1000);
  });
  it("keeps a usable session log when persistence fails", () => {
    const logs = new ClientDiagnostics(() => { throw new Error("Storage blocked"); });
    expect(() => logs.record("api", "failed", "Timeout")).not.toThrow();
    expect(logs.read()).toHaveLength(1);
    expect(logs.persistenceAvailable).toBe(false);
    const report = JSON.parse(serializeDiagnostics("0.1.1", null, logs));
    expect(report.server.available).toBe(false);
    expect(report.client.entries[0].message).toBe("Timeout");
    expect(report.client.persistence.available).toBe(false);
  });
  it("redacts quoted JSON credentials and complete values with spaces", () => {
    expect(sanitizeDiagnostic('{"password":"test-secret","access_token":"test-access"}')).not.toMatch(/test-secret|test-access/u);
    expect(sanitizeDiagnostic('password = "test secret with spaces"')).toBe("[credential]");
    expect(sanitizeDiagnostic("'api_key': 'secret with spaces' next")).toBe("[credential] next");
    expect(sanitizeDiagnostic(JSON.stringify({ password: 'secret "inside" value' }))).toBe("{[credential]}");
    expect(sanitizeDiagnostic("Error\n    at C:\\Users\\Private\\file.ts")).toBe("Error");
  });
  it("ignores corrupt storage and removes unrecognized fields on restored records", () => {
    const data = storage(); data.setItem(DIAGNOSTICS_STORAGE_KEY, "{");
    expect(new ClientDiagnostics(() => data).read()).toEqual([]);
    data.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify([null, { timestamp: new Date().toISOString(), level: "error", source: "api", event: "failed", message: "Error", transcript: "secret speech", parameters: { secret: 1 } }]));
    const report = serializeDiagnostics("0.1.1", null, new ClientDiagnostics(() => data));
    expect(report).not.toContain("secret"); expect(JSON.parse(report).client.entries).toHaveLength(1);
  });
  it("reads only allowlisted server fields and sanitizes exported messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, appVersion: "0.1.1", persistence: { available: true }, entries: [{ timestamp: new Date().toISOString(), level: "error", source: "vst", event: "failed", message: "Cannot load C:\\Users\\Alice\\Private.vst3", request: { text: "secret" } }] }))));
    const server = await readServerDiagnostics();
    const report = serializeDiagnostics("0.1.1", server, new ClientDiagnostics(storage));
    expect(report).not.toContain("Alice"); expect(report).not.toContain("secret");
    expect(JSON.parse(report).server.available).toBe(true);
  });
  it("rejects unavailable or oversized/malformed server diagnostic reports", async () => {
    for (const response of [new Response("Missing", { status: 404 }), new Response("null"), new Response(JSON.stringify({ version: 1, entries: [null] })), new Response("x".repeat(2_000_001))]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(readServerDiagnostics()).rejects.toThrow();
    }
  });
});
