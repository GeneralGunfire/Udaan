#!/usr/bin/env python3
"""
Local text-embedding bridge for Udaan's Study feature.

Reads one JSON request per line from stdin, writes one JSON response per
line to stdout — a long-lived process (model loaded once, ~20s cold start
per Study's own benchmark on this hardware) rather than one process per
request, since re-loading the model per chunk would dominate runtime.

Request:  {"id": "<uuid>", "texts": ["chunk one", "chunk two", ...]}
Response: {"id": "<uuid>", "embeddings": [[0.1, ...], [0.2, ...]]}
       or {"id": "<uuid>", "error": "message"}

Model: sentence-transformers/all-MiniLM-L6-v2 (384-dim), chosen after
benchmarking on this exact machine (i5-3470, 8GB RAM, no GPU): ~20ms/chunk
encode, ~24s load from local cache. Genuinely practical for a textbook-
sized chunk count (a few hundred to ~1000 chunks indexes in 10-20s).
"""
import sys
import json

def main() -> None:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        print(json.dumps({"id": None, "error": f"sentence-transformers not installed: {exc}"}), flush=True)
        sys.exit(1)

    model = SentenceTransformer("all-MiniLM-L6-v2")
    # Signal readiness once the model is loaded — the Rust side waits for
    # this exact line before sending the first real request, so a request
    # sent during the ~24s load doesn't sit unanswered with no feedback.
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id")
            texts = request.get("texts")
            if not isinstance(texts, list) or not texts:
                raise ValueError("request must include a non-empty 'texts' array")
            embeddings = model.encode(texts, batch_size=16, show_progress_bar=False)
            print(json.dumps({"id": request_id, "embeddings": embeddings.tolist()}), flush=True)
        except Exception as exc:  # noqa: BLE001 - one bad request must not kill the long-lived process
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                pass
            print(json.dumps({"id": request_id, "error": str(exc)}), flush=True)

if __name__ == "__main__":
    main()
