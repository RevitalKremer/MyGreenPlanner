"""add inverter MPPT voltage window + max input current

Adds mpptVmin / mpptVmax / maxInputCurrentA (from Growatt datasheets) to the
active inverters, so the string engine can validate string voltage against the
MPPT window and current against the per-tracker input limit.

Revision ID: 0068
Revises: 0067
Create Date: 2026-06-23

"""
from typing import Sequence, Union
import json
import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: Union[str, None] = "0067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPDATES = [
    {'tk': 'sadot_mod_15ktl3_x', 'params': {'mpptVmin': 140, 'mpptVmax': 1000, 'maxInputCurrentA': 26}},
    {'tk': 'sadot_mid_30ktl3_x', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 26}},
    {'tk': 'sadot_mid_40ktl3_x', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 26}},
    {'tk': 'sadot_mid_30ktl3_x2', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_mid_50ktl3_x2', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_mid_17ktl3_x2', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 27}},
    {'tk': 'sadot_max_50ktl3_lv', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 26}},
    {'tk': 'sadot_max_70ktl3_lv', 'params': {'mpptVmin': 200, 'mpptVmax': 1000, 'maxInputCurrentA': 26}},
    {'tk': 'sadot_max_100ktl3_x_lv', 'params': {'mpptVmin': 180, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_mid_15ktl3_xh', 'params': {'mpptVmin': 160, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_mid_25ktl3_xh', 'params': {'mpptVmin': 160, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_mid_30ktl3_xh', 'params': {'mpptVmin': 160, 'mpptVmax': 1000, 'maxInputCurrentA': 32}},
    {'tk': 'sadot_wit_15k_hu', 'params': {'mpptVmin': 150, 'mpptVmax': 850, 'maxInputCurrentA': 20}},
    {'tk': 'sadot_wit_25k_hu_lv', 'params': {'mpptVmin': 180, 'mpptVmax': 1000, 'maxInputCurrentA': 40}},
    {'tk': 'sadot_wit50k_hu', 'params': {'mpptVmin': 180, 'mpptVmax': 800, 'maxInputCurrentA': 32}},
]


def upgrade() -> None:
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE products SET params = COALESCE(params, '{}'::jsonb) || CAST(:params AS jsonb) "
        "WHERE type_key = :tk"
    )
    for u in UPDATES:
        conn.execute(stmt, {"tk": u["tk"], "params": json.dumps(u["params"])})


def downgrade() -> None:
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE products SET params = (params - 'mpptVmin' - 'mpptVmax' - 'maxInputCurrentA') "
        "WHERE type_key = :tk"
    )
    for u in UPDATES:
        conn.execute(stmt, {"tk": u["tk"]})
