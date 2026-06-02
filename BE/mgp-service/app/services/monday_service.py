"""Monday.com integration — upload generated proposals to a board.

Per delivered proposal:
  1. create_item — new item on MONDAY_BOARD_ID / MONDAY_GROUP_ID, with the
     project metadata mapped to the configured columns (see _COLUMN_*).
  2. create_update × 2 — submitter contact details + project details posts
     on the new item.
  3. add_file_to_update × N — attach files (xlsx, optional PDF) to the
     project-details update so they appear under the item's Updates tab.

All operations are no-ops (returning None) when MONDAY_API_TOKEN is empty,
so local dev / CI without a token simply skips the integration.

Column IDs are board-schema specific and hard-coded. If the board schema
changes, update the constants below.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Iterable, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_API_URL  = "https://api.monday.com/v2"
_FILE_URL = "https://api.monday.com/v2/file"

# Board column mapping (see config.py + board schema in Monday UI).
_COLUMN_CLIENT_NAME = "text_mm3y9t7y"   # text → project owner's email
_COLUMN_DETAILS     = "long_text__1"    # long-text → project location
_COLUMN_PROJECT_NAME = "text78__1"      # text → "<project name> — <client name>"


def _enabled() -> bool:
    return bool(settings.MONDAY_API_TOKEN and settings.MONDAY_BOARD_ID)


def _headers() -> dict:
    return {"Authorization": settings.MONDAY_API_TOKEN}


async def _graphql(client: httpx.AsyncClient, query: str, variables: Optional[dict] = None) -> dict:
    """POST a GraphQL query to Monday and return the `data` payload.
    Raises RuntimeError on transport or GraphQL errors."""
    res = await client.post(
        _API_URL,
        headers={**_headers(), "Content-Type": "application/json"},
        json={"query": query, "variables": variables or {}},
        timeout=30.0,
    )
    res.raise_for_status()
    body = res.json()
    if body.get("errors"):
        raise RuntimeError(f"Monday GraphQL error: {body['errors']}")
    return body.get("data") or {}


async def _create_item(
    client: httpx.AsyncClient,
    item_name: str,
    column_values: dict,
) -> str:
    """Create an item on the configured board+group with column values.
    Returns the new item id."""
    query = """
      mutation ($board: ID!, $group: String, $name: String!, $cols: JSON) {
        create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $cols) { id }
      }
    """
    vars_ = {
        "board": settings.MONDAY_BOARD_ID,
        "group": settings.MONDAY_GROUP_ID or None,
        "name": item_name,
        # Monday's `column_values` arg is a JSON-encoded string of the dict.
        "cols": json.dumps(column_values, ensure_ascii=False),
    }
    data = await _graphql(client, query, vars_)
    item_id = (data.get("create_item") or {}).get("id")
    if not item_id:
        raise RuntimeError(f"Monday create_item returned no id: {data}")
    return str(item_id)


async def _create_update(client: httpx.AsyncClient, item_id: str, body_html: str) -> str:
    """Post an update (comment) on `item_id`; returns the update id."""
    query = """
      mutation ($item: ID!, $body: String!) {
        create_update(item_id: $item, body: $body) { id }
      }
    """
    data = await _graphql(client, query, {"item": item_id, "body": body_html})
    update_id = (data.get("create_update") or {}).get("id")
    if not update_id:
        raise RuntimeError(f"Monday create_update returned no id: {data}")
    return str(update_id)


def _format_owner_update(
    *,
    email: Optional[str],
    full_name: Optional[str],
    phone: Optional[str],
    created_at: Optional[datetime],
) -> str:
    """Render the project owner's contact details as an HTML <ul> for the
    Monday update body. Missing fields are shown as em-dash so the post
    still gives the company a consistent layout."""
    dash = "—"
    created_str = created_at.strftime("%Y-%m-%d %H:%M UTC") if created_at else dash
    return (
        "<p><strong>Submitted by</strong></p>"
        "<ul>"
        f"<li><strong>Full name:</strong> {full_name or dash}</li>"
        f"<li><strong>Email:</strong> {email or dash}</li>"
        f"<li><strong>Phone:</strong> {phone or dash}</li>"
        f"<li><strong>Account created:</strong> {created_str}</li>"
        "</ul>"
    )


def _format_project_update(
    *,
    project_id: str,
    project_name: Optional[str],
    client_name: Optional[str],
    location: Optional[str],
    generated_at: Optional[datetime],
) -> str:
    """Render the project metadata for the Monday update body. Mirrors the
    layout of `_format_owner_update`."""
    dash = "—"
    date_str = generated_at.strftime("%Y-%m-%d %H:%M UTC") if generated_at else dash
    return (
        "<p><strong>Project details</strong></p>"
        "<ul>"
        f"<li><strong>Project ID:</strong> {project_id}</li>"
        f"<li><strong>Project name:</strong> {project_name or dash}</li>"
        f"<li><strong>Client name:</strong> {client_name or dash}</li>"
        f"<li><strong>Location:</strong> {location or dash}</li>"
        f"<li><strong>Generated at:</strong> {date_str}</li>"
        "</ul>"
    )


async def _attach_file_to_update(
    client: httpx.AsyncClient,
    update_id: str,
    filename: str,
    file_bytes: bytes,
    mimetype: str,
) -> None:
    """Upload `file_bytes` as an attachment on update `update_id`.

    Monday's file endpoint takes a multipart form with `query` and a file
    part named `variables[file]` — the GraphQL variable `$file` binds to
    that part. Files attached to an update appear under the item's
    Updates tab.
    """
    mutation = (
        "mutation ($file: File!) { "
        f"add_file_to_update(file: $file, update_id: {int(update_id)}) {{ id }} "
        "}"
    )
    files = {"variables[file]": (filename, file_bytes, mimetype)}
    data = {"query": mutation}
    res = await client.post(
        _FILE_URL,
        headers=_headers(),
        data=data,
        files=files,
        timeout=60.0,
    )
    res.raise_for_status()
    body = res.json()
    if body.get("errors"):
        raise RuntimeError(f"Monday add_file_to_update error: {body['errors']}")


async def upload_proposal(
    *,
    project_id: str,
    project_name: str,
    client_name: str,
    owner_email: str,
    owner_full_name: Optional[str] = None,
    owner_phone: Optional[str] = None,
    owner_created_at: Optional[datetime] = None,
    location: Optional[str],
    attachments: Iterable[tuple[str, bytes, str]],
) -> Optional[dict]:
    """Create an item with project metadata, post two updates (submitter
    contact details, then project details), and attach files to the
    project-details update post.

    Returns { item_id, update_ids: [...], attached: [filenames] } on success.
    Returns None silently if Monday is not configured (no token / no board).
    Raises on any other failure — callers should catch + log so the user-
    facing email send still succeeds when Monday is misconfigured.
    """
    if not _enabled():
        logger.info("Monday integration disabled — skipping upload")
        return None

    # The board's Item Name column gets the project name; the dedicated
    # 'project name' text column gets "name — client_name" for searchability.
    item_name = project_name or "(unnamed project)"
    project_label = f"{project_name} — {client_name}" if client_name else project_name

    column_values = {
        _COLUMN_CLIENT_NAME:  owner_email or "",
        _COLUMN_PROJECT_NAME: project_label or "",
        _COLUMN_DETAILS:      location or "",
    }

    owner_body = _format_owner_update(
        email=owner_email,
        full_name=owner_full_name,
        phone=owner_phone,
        created_at=owner_created_at,
    )
    project_body = _format_project_update(
        project_id=project_id,
        project_name=project_name,
        client_name=client_name,
        location=location,
        generated_at=datetime.utcnow(),
    )

    async with httpx.AsyncClient() as client:
        item_id = await _create_item(client, item_name, column_values)
        logger.info("Monday: created item %s for project '%s'", item_id, item_name)
        # Post owner first, then project — Monday shows newest on top, so the
        # project details end up as the leading post visible on the item.
        owner_update_id = await _create_update(client, item_id, owner_body)
        logger.info("Monday: posted submitter update %s on item %s", owner_update_id, item_id)
        project_update_id = await _create_update(client, item_id, project_body)
        logger.info("Monday: posted project update %s on item %s", project_update_id, item_id)
        # Attach all files to the project-details update — they show up under
        # the item's Updates tab as inline attachments on that post.
        attached: list[str] = []
        for filename, file_bytes, mimetype in attachments:
            await _attach_file_to_update(client, project_update_id, filename, file_bytes, mimetype)
            logger.info("Monday: attached %s (%d bytes) to update %s", filename, len(file_bytes), project_update_id)
            attached.append(filename)

    update_ids = [owner_update_id, project_update_id]
    logger.info("Monday upload complete: item=%s updates=%s attached=%s", item_id, update_ids, attached)
    return {"item_id": item_id, "update_ids": update_ids, "attached": attached}
