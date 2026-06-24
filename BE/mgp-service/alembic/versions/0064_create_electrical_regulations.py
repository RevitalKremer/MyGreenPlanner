"""create electrical_regulations table + seed Israel grid tracks

Reference list of Israel Electric Company regulatory tracks (אסדרות) chosen in
Step 6. NO tariff/reward data is stored — only descriptive + kW-range fields.

Revision ID: 0064
Revises: 0063
Create Date: 2026-06-22

"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0064"
down_revision: Union[str, None] = "0063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, name_en, name_he, description_en, description_he, min_kw_ac, max_kw_ac, order)
SEED = [
    ("green_small", "Small tariff (Green track)", "אסדרה תעריפית קטנה (המסלול הירוק)",
     "Sells all generated electricity to the grid; fast digital approval.",
     "מכירת כל החשמל המיוצר לרשת; הליך אישור דיגיטלי מהיר.",
     None, 15.0, 1),
    ("medium", "Medium tariff", "אסדרה תעריפית בינונית",
     "Sells electricity to the grid for medium-power systems, no tenders.",
     "מכירת חשמל לרשת עבור מערכות בהספק בינוני, ללא מכרזים.",
     15.0, 100.0, 2),
    ("large", "Large tariff", "אסדרה תעריפית גדולה",
     "Sells electricity from large roofs/buildings, subject to grid availability and power tiers.",
     "מכירת חשמל מגגות ומבנים רחבי היקף, בכפוף לזמינות הרשת ומדרגות הספק.",
     100.0, 630.0, 3),
    ("net_meter", "Net metering (self-consumption)", "מונה נטו (צריכה עצמית)",
     "Generation serves self-consumption first; surplus is banked as a kWh credit to offset future bills.",
     "החשמל המיוצר משמש קודם לצריכה עצמית; עודפים נשמרים כקרדיט (קוט\"ש מול קוט\"ש) לקיזוז עתידי.",
     None, None, 4),
]


def upgrade() -> None:
    op.create_table(
        "electrical_regulations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(50), unique=True, nullable=False, index=True),
        sa.Column("name_en", sa.String(255), nullable=False),
        sa.Column("name_he", sa.String(255), nullable=False),
        sa.Column("description_en", sa.Text, nullable=True),
        sa.Column("description_he", sa.Text, nullable=True),
        sa.Column("min_kw_ac", sa.Float, nullable=True),
        sa.Column("max_kw_ac", sa.Float, nullable=True),
        sa.Column("display_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    conn = op.get_bind()
    stmt = sa.text(
        """
        INSERT INTO electrical_regulations
            (id, key, name_en, name_he, description_en, description_he,
             min_kw_ac, max_kw_ac, display_order, active, created_at, updated_at)
        VALUES
            (gen_random_uuid(), :key, :name_en, :name_he, :description_en, :description_he,
             :min_kw_ac, :max_kw_ac, :display_order, true, NOW(), NOW())
        ON CONFLICT (key) DO NOTHING
        """
    )
    for key, name_en, name_he, desc_en, desc_he, min_kw, max_kw, order in SEED:
        conn.execute(stmt, {
            "key": key, "name_en": name_en, "name_he": name_he,
            "description_en": desc_en, "description_he": desc_he,
            "min_kw_ac": min_kw, "max_kw_ac": max_kw, "display_order": order,
        })


def downgrade() -> None:
    op.drop_table("electrical_regulations")
