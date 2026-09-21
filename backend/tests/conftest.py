"""Test-session log isolation — must run before any `app` import so
wallet ingest / 422-debug logging never touches the real backend/logs/*.log
files during pytest runs."""
import os
import tempfile

os.environ.setdefault(
    "WALLET_INGEST_LOG",
    os.path.join(tempfile.gettempdir(), "ledger_pytest_wallet_ingest.log"),
)
os.environ.setdefault(
    "WALLET_422_DEBUG_LOG",
    os.path.join(tempfile.gettempdir(), "ledger_pytest_wallet_422_debug.log"),
)
