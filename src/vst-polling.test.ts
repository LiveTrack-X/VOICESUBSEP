import { describe, expect, it } from "vitest";
import { vstPollFailure } from "./vst-polling";
describe("VST preview loss and recovery", () => {
  it("terminates an expired preview on the first HTTP 404", () => {
    expect(vstPollFailure(Object.assign(new Error("Missing"), { status: 404 }), 1)).toBe("missing");
  });
  it("keeps transient errors retryable but releases the dialog after repeated failure", () => {
    expect(vstPollFailure(new TypeError("Failed to fetch"), 1)).toBe("retry");
    expect(vstPollFailure(new TypeError("Failed to fetch"), 2)).toBe("retry");
    expect(vstPollFailure(new TypeError("Failed to fetch"), 3)).toBe("pause");
    expect(vstPollFailure({ status: 503 }, 3)).toBe("pause");
  });
  it("does not mistake reflected 404 text for a missing job", () => {
    expect(vstPollFailure(new Error("Plugin 404 failed"), 1)).toBe("retry");
    expect(vstPollFailure({ status: "404" }, 1)).toBe("retry");
  });
});
