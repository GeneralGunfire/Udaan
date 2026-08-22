"""
Long-lived whisper transcription server. Loads the model once, then reads
one JSON request per line from stdin and writes one JSON response per line
to stdout. Avoids the ~7-8s model-load cost on every mic click that a
one-shot-per-call script would pay.

Request:  {"audio_path": "..."}
Response: {"text": "...", "language": "...", "languageProbability": 0.99}
       or {"error": "..."}
"""
import sys
import json

from faster_whisper import WhisperModel

def main() -> None:
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            audio_path = request["audio_path"]
            segments, info = model.transcribe(audio_path, beam_size=1)
            text = "".join(seg.text for seg in segments).strip()
            response = {
                "text": text,
                "language": info.language,
                "languageProbability": info.language_probability,
            }
        except Exception as e:
            response = {"error": str(e)}
        print(json.dumps(response), flush=True)

if __name__ == "__main__":
    main()
