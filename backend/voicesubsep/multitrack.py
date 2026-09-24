"""Sequential transcription of explicitly isolated speaker tracks."""
from __future__ import annotations
from .inference import AnalysisCancelled


def analyze_tracks(analyzer, media_path, *, selections, options, progress, cancelled):
    captions, speakers, warnings = [], {}, []
    duration = 0.0
    for index, selection in enumerate(selections):
        if cancelled():
            raise AnalysisCancelled("Track analysis was cancelled.")
        track = selection["audioTrack"]
        result = analyzer(media_path, **{**options, "audio_track": track, "diarization": False,
            "speaker_count": 1, "mode": "standard", "cancelled": cancelled,
            "progress": lambda stage, fraction: progress(f"Track {index + 1}/{len(selections)} · {stage}",
                                                         (index + fraction) / len(selections))})
        if cancelled():
            raise AnalysisCancelled("Track analysis was cancelled.")
        identity = selection["speakerId"]
        speakers[identity] = {"id": identity, "name": selection["name"], "color": selection["color"]}
        duration = max(duration, result["duration"])
        for caption in result["captions"]:
            captions.append({**caption, "id": f"track-{track}-{caption['id']}", "speakerId": identity,
                             "reasons": [reason for reason in caption.get("reasons", []) if reason not in {"unassigned", "speaker_count"}]})
        warnings.extend(f"Track {track}: {message}" for message in result.get("warnings", [])
                        if not message.startswith("전사만 실행했습니다."))
    captions.sort(key=lambda item: (item["start"], item["end"], item["id"]))
    warnings.append("Each selected track was assigned to the person you specified. Tracks must contain that person alone; mixed game/chat tracks are not separated automatically.")
    return {"captions": captions, "speakers": list(speakers.values()), "duration": duration, "warnings": warnings}
