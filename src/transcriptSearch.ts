import { parseTime } from "./domain";
import type { TranscriptTurn } from "./transcriptDocument";

/** Literal, case-insensitive display filtering; exports always retain the source project. */
export function filterTranscript(turns: readonly TranscriptTurn[], query: string): readonly TranscriptTurn[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? turns.filter(turn => `${turn.speaker} ${turn.text}`.toLocaleLowerCase().includes(needle)) : turns;
}

/** Use the same seconds / mm:ss / hh:mm:ss parser as cut editing. */
export function transcriptTimeTarget(turns: readonly TranscriptTurn[], input: string): TranscriptTurn | null {
  const seconds = parseTime(input);
  return turns.find(turn => turn.start <= seconds && seconds < turn.end) ?? turns.find(turn => turn.start >= seconds) ?? null;
}
