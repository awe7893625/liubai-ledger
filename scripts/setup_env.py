"""Create private first-run settings without reading or overwriting existing secrets."""
import os
import secrets
from pathlib import Path


def create_settings(root: Path) -> bool:
    target = root / ".env"
    db = root / "backend" / "data" / "ledger.db"
    content = "\n".join([
        "# Local-only configuration. Never share this file.",
        "DATABASE_URL=sqlite:///" + str(db),
        "APP_TIMEZONE=Asia/Taipei",
        "LEDGER_INGEST_TOKEN=" + secrets.token_urlsafe(32),
        "LEDGER_STORE_LOCATION=false", "LEDGER_WALLET_DEBUG=false",
        "LEDGER_OLLAMA_MODEL=", "LEDGER_OLLAMA_VISION_MODEL=",
        "OPENROUTER_API_KEY=", "",
    ])
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print("Existing .env kept unchanged. Configure it on your own device.")
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(content)
    print("Created .env with file mode 0600 and a new random ingest token.")
    print("Read the token locally; do not upload it or paste it into a website.")
    return True

if __name__ == "__main__":
    create_settings(Path(__file__).resolve().parents[1])
