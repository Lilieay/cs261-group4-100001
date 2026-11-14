import os
from pathlib import Path

from dotenv import load_dotenv


ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_FILE)

AUTH_SESSION_TTL_SECONDS = int(os.getenv("AUTH_SESSION_TTL_SECONDS", "28800"))
if AUTH_SESSION_TTL_SECONDS <= 0:
    raise RuntimeError("AUTH_SESSION_TTL_SECONDS must be a positive integer.")

DB_CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING")

if not DB_CONNECTION_STRING:
    raise RuntimeError(
        "Set DB_CONNECTION_STRING in backend/.env or environment."
    )

DB_PASSWORD = os.getenv("DB_PASSWORD")

if DB_PASSWORD is not None:
    escape_password = DB_PASSWORD.replace("}", "}}")
    DB_CONNECTION_STRING = (
        DB_CONNECTION_STRING.rstrip(";")
        + ";PWD={" + escape_password + "};"
    )
