import argparse
import json
import sys

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--video", required=True)
    args = parser.parse_args()

    model = WhisperModel(args.model_dir, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(args.video)
    payload = [
        {"start": float(item.start), "end": float(item.end), "text": item.text.strip()}
        for item in segments
        if item.text and item.text.strip()
    ]
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
