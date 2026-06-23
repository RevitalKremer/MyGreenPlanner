"""rename products.electrical -> params; backfill productCategory

Renames the per-product JSONB `electrical` column to the more general `params`
(room for any unique product param), then backfills `params.productCategory`
from the Sadot sheet's "Product Category" column (inverters: ongrid/hybrid/
offgrid). The inverter-type concept maps to this category.

Revision ID: 0065
Revises: 0064
Create Date: 2026-06-23

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: Union[str, None] = "0064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# type_key -> product category (from the Sadot product sheet, normalized).
PRODUCT_CATEGORY = {
    'sadot_apx_cable': 'hybrid',
    'sadot_sdm630': 'ongrid, hybrid',
    'sadot_tpm_ct_e_meter_160a': 'ongrid',
    'sadot_max_100ktl3_x_lv': 'ongrid',
    'sadot_sem_1mw': 'ongrid, hybrid',
    'sadot_max_50ktl3_lv': 'ongrid',
    'sadot_shinelink_x': 'ongrid',
    'sadot_max_70ktl3_lv': 'ongrid',
    'sadot_mid_30ktl3_x': 'ongrid',
    'sadot_mid_36ktl3_x': 'ongrid',
    'sadot_mid_40ktl3_x': 'ongrid',
    'sadot_mid_50ktl3_x2': 'ongrid',
    'sadot_mod_15ktl3_x': 'ongrid',
    'sadot_shine4g_x': 'ongrid',
    'sadot_shinegprs_x': 'ongrid',
    'sadot_shinegprs_x2': 'ongrid',
    'sadot_shinelan_x': 'ongrid',
    'sadot_shinewifi_x': 'ongrid',
    'sadot_shinemaster': 'ongrid',
    'sadot_shinemaster_x': 'ongrid',
    'sadot_shinemaster_4g': 'ongrid',
    'sadot_sim_6000_es_plus_h': 'offgrid',
    'sadot_spf_6000_es_plus': 'offgrid',
    'sadot_shine_wifi_f': 'offgrid',
    'sadot_shinegprs_f': 'offgrid',
    'sadot_axe_5_0l_cable': 'offgrid',
    'sadot_alp_5_0l_cable': 'hybrid',
    'sadot_abm_battery_base': 'offgrid',
    'sadot_axe_5_0l_c1': 'offgrid',
    'sadot_abm_5_5l_a1': 'offgrid',
    'sadot_ark_2_5l_a1': 'offgrid',
    'sadot_infinity_2000': 'na',
    'sadot_mid_30ktl3_xh': 'hybrid',
    'sadot_shinewifi_x2': 'hybrid, ongrid',
    'sadot_mid_15ktl3_xh': 'hybrid',
    'sadot_sph_10000tl3_bh_up': 'hybrid',
    'sadot_apx_98034_p2': 'hybrid',
    'sadot_apx_hv_battery_base': 'hybrid',
    'sadot_apx_5_0p_b1': 'hybrid',
    'sadot_alp_5_0l_e2': 'hybrid',
    'sadot_ark_battery_base': 'hybrid',
    'sadot_alp_5_0l_e1_battery_base': 'hybrid',
    'sadot_ark2_5h_a1': 'hybrid',
    'sadot_syn100xh30': 'hybrid',
    'sadot_shinesem_x_cl_1mw': 'hybrid, ongrid',
    'sadot_max_250ktl3_x_hv': 'ongrid',
    'sadot_apx_5_0p_b': 'hybrid',
    'sadot_shinewilan_x2': 'hybrid, ongrid',
    'sadot_wit_15k_hu': 'hybrid',
    'sadot_wit_75k_hu': 'hybrid',
    'sadot_wit50k_hu': 'hybrid',
    'sadot_spa_10000tl3_bh_up': 'ongrid',
    'sadot_ark_2_5l_a1_cable': 'offgrid',
    'sadot_tpm_ct_e_250a': 'hybrid, ongrid',
    'sadot_shinesem_xa_r': 'ongrid',
    'sadot_max_253ktl3_x_hv': 'ongrid',
    'sadot_mid_25ktl3_x': 'ongrid',
    'sadot_mid_15ktl3_x': 'ongrid',
    'sadot_mid_17ktl3_x': 'ongrid',
    'sadot_infinity_1300_eu': 'na',
    'sadot_mid_17ktl3_xh': 'hybrid',
    'sadot_mod_15ktl3_hu': 'hybrid',
    'sadot_hope_16_0lm_a1': 'hybrid',
    'sadot_mid_25ktl3_xh': 'hybrid',
    'sadot_shinemaster4g_x': 'ongrid',
    'sadot_mid_30ktl3_x2': 'ongrid',
    'sadot_mid_17ktl3_x2': 'ongrid',
    'sadot_spm_6000tl_hu': 'hybrid',
    'sadot_wit_25k_hu_lv': 'hybrid',
}


def upgrade() -> None:
    op.alter_column("products", "electrical", new_column_name="params")
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE products "
        "SET params = COALESCE(params, '{}'::jsonb) || jsonb_build_object('productCategory', cast(:cat as text)) "
        "WHERE type_key = :tk"
    )
    for tk, cat in PRODUCT_CATEGORY.items():
        conn.execute(stmt, {"tk": tk, "cat": cat})


def downgrade() -> None:
    op.alter_column("products", "params", new_column_name="electrical")
