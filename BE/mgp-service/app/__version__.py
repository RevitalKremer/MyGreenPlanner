"""Single source of truth for the BE service version.

Bump this on every merge to dev or master (see CLAUDE.md §6 — Versioning).
The /version endpoint and FastAPI app metadata both read from here.
"""

__version__ = "2.4.0"
