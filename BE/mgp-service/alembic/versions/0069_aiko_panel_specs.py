"""add AIKO G670 panel electrical specs (for string plan)

Sets Voc/Vmp/Isc/Imp on the AIKO-G670-MCH72Mw panel so the string engine can
compute string voltage/current. Temperature coefficients are not supplied; the
engine falls back to typical mono defaults.

Revision ID: 0069
Revises: 0068
Create Date: 2026-06-23

"""
from typing import Sequence, Union
import json
import sqlalchemy as sa
from alembic import op

revision: str = "0069"
down_revision: Union[str, None] = "0068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PANEL_KEY = "AIKO-G670-MCH72Mw"
SPECS = {"Voc": 54.8, "Vmp": 45.5, "Isc": 15.36, "Imp": 14.73, "Wp": 670}


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE products SET params = COALESCE(params, '{}'::jsonb) || CAST(:p AS jsonb) "
            "WHERE type_key = :tk"
        ),
        {"tk": PANEL_KEY, "p": json.dumps(SPECS)},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE products SET params = (params - 'Voc' - 'Vmp' - 'Isc' - 'Imp' - 'Wp') "
            "WHERE type_key = :tk"
        ),
        {"tk": PANEL_KEY},
    )
