import type { Project, Speaker } from "./domain";

/** Existing captions define current identities; the count selector only prepares analysis. */
export function editableSpeakers(project: Project): Speaker[] {
  const assigned = new Set(project.captions.map(caption => caption.speakerId).filter(id => id !== null));
  return project.captions.length
    ? project.speakers.filter(speaker => assigned.has(speaker.id))
    : project.speakers.slice(0, project.speakerCount);
}

/** Called only after the user reviews and confirms a whole-project reassignment. */
export function assignAllCaptionsToSpeaker(project: Project, speakerId: string): Project {
  if (!project.speakers.some(speaker => speaker.id === speakerId))
    throw new Error("존재하지 않는 인물입니다.");
  return {
    ...project,
    speakerCount: 1,
    // Keep the other identity records, including their names and styles, for later reuse.
    captions: project.captions.map(caption => ({
      ...caption,
      speakerId,
      reasons: caption.reasons.filter(reason => reason !== "unassigned" && reason !== "speaker_count"),
    })),
  };
}
