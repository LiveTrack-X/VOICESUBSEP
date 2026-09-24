/** A missing preview is terminal; transport failures leave the server outcome unknown. */
export function vstPollFailure(error: unknown, consecutiveFailures: number): "missing" | "pause" | "retry" {
  if (error && typeof error === "object" && "status" in error && error.status === 404) return "missing";
  return consecutiveFailures >= 3 ? "pause" : "retry";
}
