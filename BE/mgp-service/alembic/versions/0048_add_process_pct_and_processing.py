"""Add process_pct column + processing summary product.

Mirrors the depreciation_pct / depreciation_waste pair (migrations 0036 / 0003 /
0042): every Product can declare a per-product processing percentage; the BOM
emits a single aggregated 'processing' row at the bottom (sum of
totalLengthM × process_pct / 100 across length-bearing items), which is then
priced via the dedicated 'processing' product.

Revision ID: 0048
Revises: 0047
Create Date: 2026-06-03
"""
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa


revision = '0048'
down_revision = '0047'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('products', sa.Column('process_pct', sa.Float(), nullable=True))

    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    # Seed the 'processing' summary product. price_ils=16.5 → ₪ per meter
    # of processing labor (matches the aluminium material rate). The BOM
    # emits qty as meters-of-processing (sum of each material's length ×
    # its process_pct/100); proposal computes total = qty × 16.5 ₪.
    # The summary product itself has process_pct=NULL — it's not a material
    # that gets processed. The aggregation reads process_pct only from the
    # actual aluminium materials.
    conn.execute(sa.text("""
        INSERT INTO products
            (id, type_key, product_type, part_number, name, name_he,
             additional_info, active, extra, alt_group, is_default,
             length_cm, width_cm, kw_peak, price_ils, weight_kg,
             depreciation_pct, process_pct, bundle, created_at, updated_at)
        VALUES
            (gen_random_uuid(), 'processing', 'aluminium', NULL,
             'Processing', 'עיבוד',
             NULL, TRUE, NULL, NULL, FALSE,
             NULL, NULL, NULL, 16.5, NULL,
             NULL, NULL, NULL, :now, :now)
        ON CONFLICT (type_key) DO NOTHING
    """), {'now': now})

    # Default process_pct = 9 on every aluminium-category material so the new
    # BOM summary row has something to aggregate immediately after migration.
    # The 'depreciation_waste' and 'processing' summary rows themselves are
    # categorised as 'aluminium' for reporting symmetry, but they're aggregate
    # rows — not materials we want to multiply against. Admins can tweak
    # individual values via the products UI.
    conn.execute(sa.text("""
        UPDATE products
           SET process_pct = 9.0,
               updated_at  = :now
         WHERE product_type = 'aluminium'
           AND type_key NOT IN ('depreciation_waste', 'processing')
    """), {'now': now})

    # Null out depreciation_pct on the depreciation_waste summary product so
    # it matches the new policy: summary products carry no pct of their own,
    # the feature toggles via the contributing materials' pct (or the
    # product's active flag). Mirrors how 'processing' is seeded above.
    conn.execute(sa.text("""
        UPDATE products
           SET depreciation_pct = NULL,
               updated_at       = :now
         WHERE type_key = 'depreciation_waste'
    """), {'now': now})


def downgrade() -> None:
    op.execute("DELETE FROM products WHERE type_key = 'processing'")
    op.drop_column('products', 'process_pct')
