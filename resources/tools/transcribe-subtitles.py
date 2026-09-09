import argparse
import json
import math
import re
import sys

from faster_whisper import WhisperModel


def timed_segments(segment, pause_seconds=0.5):
    original = [{"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip()}]
    words = list(getattr(segment, "words", None) or [])
    if not words or re.sub(r"\s+", "", "".join(w.word for w in words)) != re.sub(r"\s+", "", segment.text):
        return original
    previous_end = segment.start
    for word in words:
        if (not math.isfinite(word.start) or not math.isfinite(word.end)
                or word.start < previous_end or word.end <= word.start
                or word.end > segment.end or not word.word.strip()):
            return original
        previous_end = word.end
    groups = []
    current = []

    def flush():
        if current:
            groups.append({"start": float(current[0].start), "end": float(current[-1].end),
                           "text": "".join(w.word for w in current).strip()})
            current.clear()

    for word in words:
        if current and word.start - current[-1].end >= pause_seconds:
            flush()
        current.append(word)
        if re.search(r'[，。！？；,.!?;][”’"\u0027]*$', word.word.strip()):
            flush()
    flush()
    if len(groups) == 1 and len(words) > 1:
        return [{"start": float(w.start), "end": float(w.end), "text": w.word.strip()} for w in words]
    return groups


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--include-timing", action="store_true")
    args = parser.parse_args()

    model = WhisperModel(args.model_dir, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(args.video, word_timestamps=args.include_timing)
    segments = list(segments)
    payload = [
        {"start": float(item.start), "end": float(item.end), "text": item.text.strip()}
        for item in segments
        if item.text and item.text.strip()
    ]
    if args.include_timing:
        timing = [part for item in segments if item.text and item.text.strip()
                  for part in timed_segments(item)]
        payload = {"segments": payload, "timingSegments": timing}
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
