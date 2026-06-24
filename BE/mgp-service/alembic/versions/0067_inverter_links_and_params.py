"""set inverter Sadot links (he/en) + string-plan params

Updates active inverters with their sadot-energy.co.il product pages (per
locale) and string-plan params: mpptCount, dcAcRatio (1.5 -> 150 pct, 2.0 ->
200 pct) and maxEfficiencyPct. MPPT voltage window / current limits are not yet
supplied, so the string engine sizes by MPPT count and flags the rest.

Revision ID: 0067
Revises: 0066
Create Date: 2026-06-23

"""
from typing import Sequence, Union
import json
import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: Union[str, None] = "0066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPDATES = [
    {'tk': 'sadot_mod_15ktl3_x', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mod-10-15ktl3-x/', 'he': 'https://sadot-energy.co.il/product/mod-10-15ktl3-x/'}, 'params': {'mpptCount': 2, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.6}},
    {'tk': 'sadot_mid_30ktl3_x', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-25-40ktl3-x/', 'he': 'https://sadot-energy.co.il/product/mid-25-40ktl3-x/'}, 'params': {'mpptCount': 3, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_40ktl3_x', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-25-40ktl3-x/', 'he': 'https://sadot-energy.co.il/product/mid-25-40ktl3-x/'}, 'params': {'mpptCount': 3, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_30ktl3_x2', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-30-50ktl3-x2/', 'he': 'https://sadot-energy.co.il/product/mid-30-50ktl3-x2/'}, 'params': {'mpptCount': 3, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_50ktl3_x2', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-30-50ktl3-x2/', 'he': 'https://sadot-energy.co.il/product/mid-30-50ktl3-x2/'}, 'params': {'mpptCount': 3, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_17ktl3_x2', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-15-25ktl3-x/', 'he': 'https://sadot-energy.co.il/product/mid-15-25ktl3-x/'}, 'params': {'mpptCount': 2, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.75}},
    {'tk': 'sadot_max_50ktl3_lv', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/max-50-80ktl3-lv/', 'he': 'https://sadot-energy.co.il/product/max-50-80ktl3-lv/'}, 'params': {'mpptCount': 6, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 99.0}},
    {'tk': 'sadot_max_70ktl3_lv', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/max-50-80ktl3-lv/', 'he': 'https://sadot-energy.co.il/product/max-50-80ktl3-lv/'}, 'params': {'mpptCount': 6, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 99.0}},
    {'tk': 'sadot_max_100ktl3_x_lv', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/max-100-125ktl3-x-lv/', 'he': 'https://sadot-energy.co.il/product/max-100-150ktl3-x/'}, 'params': {'mpptCount': 10, 'dcAcRatio': 1.5, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_15ktl3_xh', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-11-30ktl3-xh/', 'he': 'https://sadot-energy.co.il/product/mid-11-30ktl3-xh/'}, 'params': {'mpptCount': 2, 'dcAcRatio': 2.0, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_25ktl3_xh', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-11-30ktl3-xh/', 'he': 'https://sadot-energy.co.il/product/mid-11-30ktl3-xh/'}, 'params': {'mpptCount': 2, 'dcAcRatio': 2.0, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_mid_30ktl3_xh', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/mid-11-30ktl3-xh/', 'he': 'https://sadot-energy.co.il/product/mid-11-30ktl3-xh/'}, 'params': {'mpptCount': 2, 'dcAcRatio': 2.0, 'maxEfficiencyPct': 98.8}},
    {'tk': 'sadot_wit_15k_hu', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/wit-4-15k-hu/', 'he': 'https://sadot-energy.co.il/product/wit-4-15k-hu/'}, 'params': {'mpptCount': 2, 'maxEfficiencyPct': 97.6}},
    {'tk': 'sadot_wit_25k_hu_lv', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/wit-29-9-50k-xhu/', 'he': 'https://sadot-energy.co.il/product/wit-29-9-50k-xhu/'}, 'params': {'mpptCount': 4, 'dcAcRatio': 2.0, 'maxEfficiencyPct': 98.0}},
    {'tk': 'sadot_wit50k_hu', 'sadot': {'en': 'https://sadot-energy.co.il/en/product/wit-50-100k-hu/', 'he': 'https://sadot-energy.co.il/product/wit-50-100k-hu/'}, 'params': {'mpptCount': 7, 'dcAcRatio': 2.0, 'maxEfficiencyPct': 98.0}},
]


def upgrade() -> None:
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE products "
        "SET sadot_url = CAST(:sadot AS jsonb), "
        "    params = COALESCE(params, '{}'::jsonb) || CAST(:params AS jsonb) "
        "WHERE type_key = :tk"
    )
    for u in UPDATES:
        conn.execute(stmt, {"tk": u["tk"], "sadot": json.dumps(u["sadot"]), "params": json.dumps(u["params"])})


def downgrade() -> None:
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE products SET sadot_url = NULL, "
        "params = (params - 'mpptCount' - 'dcAcRatio' - 'maxEfficiencyPct') "
        "WHERE type_key = :tk"
    )
    for u in UPDATES:
        conn.execute(stmt, {"tk": u["tk"]})
