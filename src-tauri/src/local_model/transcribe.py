"""Transcribes an audio file with faster-whisper (tiny model, int8, CPU) and prints JSON to stdout."""
import sys
import json

from faster_whisper import WhisperModel

def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: transcribe.py <audio_path>"}), file=sys.stdout)
        sys.exit(1)

    audio_path = sys.argv[1]
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio_path, beam_size=1)
    text = "".join(seg.text for seg in segments).strip()

    print(json.dumps({
        "text": text,
        "language": info.language,
        "languageProbability": info.language_probability,
    }))

if __name__ == "__main__":
    main()
