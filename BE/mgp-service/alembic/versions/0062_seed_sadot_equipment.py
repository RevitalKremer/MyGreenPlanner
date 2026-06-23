"""seed Sadot Energy equipment catalog

Imports the Sadot Energy product list (inverters, batteries, dongles,
dataloggers, smart meters, cables, cabinets, …) from
docs/Products_of_Sadot_Energy_1782132180.xlsx into the products table as
Sadot equipment (kept separate from construction materials). Idempotent:
ON CONFLICT (type_key) DO NOTHING, so re-runs and hand-edits are safe.

Revision ID: 0062
Revises: 0061
Create Date: 2026-06-22

"""
from typing import Sequence, Union
import json
import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: Union[str, None] = "0061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Sadot Energy equipment. price_ils in ₪; `electrical` holds the AC rating
# (acPowerKw) for inverters where the source sheet provided it. MPPT specs
# (voltage window, currents) are not in the source sheet — admins enrich the
# `electrical` blob via the Sadot Energy admin tab.
SADOT_PRODUCTS = [
    {'type_key': 'sadot_apx_cable', 'product_type': 'cable', 'name': 'APX Cable', 'part_number': None, 'additional_info': 'Hybrid Battery Cable', 'price_ils': 359.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_sdm630', 'product_type': 'smart_meter', 'name': 'SDM630', 'part_number': None, 'additional_info': 'Smart Meter', 'price_ils': 479.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_tpm_ct_e_meter_160a', 'product_type': 'smart_meter', 'name': 'TPM-CT-E METER (160A)', 'part_number': None, 'additional_info': 'Ongrid Smart Meter', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_max_100ktl3_x_lv', 'product_type': 'inverter', 'name': 'MAX 100KTL3-X LV', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 13800.0, 'active': True, 'electrical': {'acPowerKw': 100.0}},
    {'type_key': 'sadot_sem_1mw', 'product_type': 'network_cabinet', 'name': 'SEM 1MW', 'part_number': None, 'additional_info': 'Network Cabinet', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_max_50ktl3_lv', 'product_type': 'inverter', 'name': 'MAX 50KTL3 LV', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 11390.0, 'active': True, 'electrical': {'acPowerKw': 50.0}},
    {'type_key': 'sadot_shinelink_x', 'product_type': 'datalogger', 'name': 'ShineLink-X', 'part_number': None, 'additional_info': 'Dongle On Grid', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_max_70ktl3_lv', 'product_type': 'inverter', 'name': 'MAX 70KTL3 LV', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 12600.0, 'active': True, 'electrical': {'acPowerKw': 70.0}},
    {'type_key': 'sadot_mid_30ktl3_x', 'product_type': 'inverter', 'name': 'MID 30KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 7400.0, 'active': True, 'electrical': {'acPowerKw': 30.0}},
    {'type_key': 'sadot_mid_36ktl3_x', 'product_type': 'inverter', 'name': 'MID 36KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 36.0}},
    {'type_key': 'sadot_mid_40ktl3_x', 'product_type': 'inverter', 'name': 'MID 40KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 7920.0, 'active': True, 'electrical': {'acPowerKw': 40.0}},
    {'type_key': 'sadot_mid_50ktl3_x2', 'product_type': 'inverter', 'name': 'MID 50KTL3-X2', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 8950.0, 'active': True, 'electrical': {'acPowerKw': 50.0}},
    {'type_key': 'sadot_mod_15ktl3_x', 'product_type': 'inverter', 'name': 'MOD 15KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': 3980.0, 'active': True, 'electrical': {'acPowerKw': 15.0}},
    {'type_key': 'sadot_shine4g_x', 'product_type': 'dongle', 'name': 'Shine4G-X', 'part_number': None, 'additional_info': 'dongle On Grid', 'price_ils': 185.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_shinegprs_x', 'product_type': 'dongle', 'name': 'ShineGPRS-X', 'part_number': None, 'additional_info': 'Dongle On Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinegprs_x2', 'product_type': 'dongle', 'name': 'ShineGPRS-X2', 'part_number': None, 'additional_info': 'Dongle On Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinelan_x', 'product_type': 'dongle', 'name': 'ShineLan-X', 'part_number': None, 'additional_info': 'Dongle On Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinewifi_x', 'product_type': 'dongle', 'name': 'ShineWiFi-X', 'part_number': None, 'additional_info': 'Dongle On Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinemaster', 'product_type': 'datalogger', 'name': 'ShineMaster', 'part_number': None, 'additional_info': 'Data Logger On Grid', 'price_ils': 1350.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinemaster_x', 'product_type': 'datalogger', 'name': 'ShineMaster X', 'part_number': None, 'additional_info': 'Data Logger On Grid', 'price_ils': 1350.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinemaster_4g', 'product_type': 'datalogger', 'name': 'ShineMaster 4G', 'part_number': None, 'additional_info': 'Data Logger On Grid', 'price_ils': 1350.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_sim_6000_es_plus_h', 'product_type': 'inverter', 'name': 'SIM 6000 ES PLUS-H', 'part_number': None, 'additional_info': 'Inverter Off Grid', 'price_ils': 3106.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_spf_6000_es_plus', 'product_type': 'inverter', 'name': 'SPF 6000 ES PLUS', 'part_number': None, 'additional_info': 'Inverter Off Grid', 'price_ils': 3106.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shine_wifi_f', 'product_type': 'dongle', 'name': 'Shine WiFi-F', 'part_number': None, 'additional_info': 'Dongle Off Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_shinegprs_f', 'product_type': 'dongle', 'name': 'ShineGPRS-F', 'part_number': None, 'additional_info': 'Dongle Off Grid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_axe_5_0l_cable', 'product_type': 'cable', 'name': 'AXE 5.0L Cable', 'part_number': None, 'additional_info': 'Off Grid Battery Cable', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_alp_5_0l_cable', 'product_type': 'cable', 'name': 'ALP 5.0L Cable', 'part_number': None, 'additional_info': 'ALP Battery Cable', 'price_ils': 168.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_abm_battery_base', 'product_type': 'battery_base', 'name': 'ABM Battery Base', 'part_number': None, 'additional_info': 'Off Grid Battery Base', 'price_ils': 808.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_axe_5_0l_c1', 'product_type': 'battery', 'name': 'AXE 5.0L-C1', 'part_number': None, 'additional_info': 'Battery Off Grid', 'price_ils': 5840.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_abm_5_5l_a1', 'product_type': 'battery', 'name': 'ABM 5.5L-A1', 'part_number': None, 'additional_info': 'Off Grid Battery', 'price_ils': 5125.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_ark_2_5l_a1', 'product_type': 'battery', 'name': 'ARK 2.5L-A1', 'part_number': None, 'additional_info': 'Battery Off Grid', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_infinity_2000', 'product_type': 'portable_power_station', 'name': 'INFINITY 2000', 'part_number': None, 'additional_info': 'Portable Power Station', 'price_ils': 5175.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_mid_30ktl3_xh', 'product_type': 'inverter', 'name': 'MID 30KTL3-XH', 'part_number': None, 'additional_info': 'Inverter', 'price_ils': 8407.0, 'active': True, 'electrical': {'acPowerKw': 30.0}},
    {'type_key': 'sadot_shinewifi_x2', 'product_type': 'dongle', 'name': 'ShineWiFi-X2', 'part_number': None, 'additional_info': 'Dongle Hybrid', 'price_ils': 185.0, 'active': False, 'electrical': None},
    {'type_key': 'sadot_mid_15ktl3_xh', 'product_type': 'inverter', 'name': 'MID 15KTL3-XH', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': 5783.0, 'active': True, 'electrical': {'acPowerKw': 15.0}},
    {'type_key': 'sadot_sph_10000tl3_bh_up', 'product_type': 'inverter', 'name': 'SPH 10000TL3 BH-UP', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_apx_98034_p2', 'product_type': 'bms', 'name': 'APX 98034-P2', 'part_number': None, 'additional_info': 'BMS Hybrid', 'price_ils': 2133.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_apx_hv_battery_base', 'product_type': 'battery_base', 'name': 'APX HV Battery Base', 'part_number': None, 'additional_info': 'Battery Base Hybrid', 'price_ils': 270.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_apx_5_0p_b1', 'product_type': 'battery', 'name': 'APX 5.0P-B1', 'part_number': None, 'additional_info': 'Battery Hybrid', 'price_ils': 4143.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_alp_5_0l_e2', 'product_type': 'battery', 'name': 'ALP 5.0L-E2', 'part_number': None, 'additional_info': 'ALP 5.0L Lithum Battery', 'price_ils': 4038.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_ark_battery_base', 'product_type': 'battery_base', 'name': 'ARK Battery Base', 'part_number': None, 'additional_info': 'Battery Base Hybrid', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_alp_5_0l_e1_battery_base', 'product_type': 'battery_base', 'name': 'ALP 5.0L-E1 Battery Base', 'part_number': None, 'additional_info': 'ALP Battery Base Hybrid', 'price_ils': 270.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_ark2_5h_a1', 'product_type': 'battery', 'name': 'ARK2.5H-A1', 'part_number': None, 'additional_info': 'Battery Hybrid', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_syn100xh30', 'product_type': 'backup_box', 'name': 'SYN100XH30', 'part_number': None, 'additional_info': 'SYN Hybrid', 'price_ils': 2037.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_shinesem_x_cl_1mw', 'product_type': 'energy_management', 'name': 'ShineSEM-X-CL 1MW', 'part_number': None, 'additional_info': 'Smart Energy Management', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_max_250ktl3_x_hv', 'product_type': 'inverter', 'name': 'MAX 250KTL3-X HV', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 250.0}},
    {'type_key': 'sadot_apx_5_0p_b', 'product_type': 'battery_base', 'name': 'APX 5.0P-B', 'part_number': None, 'additional_info': 'מוצר נלווה לסוללות של APX', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_shinewilan_x2', 'product_type': 'dongle', 'name': 'ShineWiLan-X2', 'part_number': None, 'additional_info': 'Dongle Hybrid', 'price_ils': 185.0, 'active': True, 'electrical': None},
    {'type_key': 'sadot_wit_15k_hu', 'product_type': 'inverter', 'name': 'WIT 15K-HU', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': 8484.0, 'active': True, 'electrical': {'acPowerKw': 15.0}},
    {'type_key': 'sadot_wit_75k_hu', 'product_type': 'inverter', 'name': 'WIT 75K-HU', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 75.0}},
    {'type_key': 'sadot_wit50k_hu', 'product_type': 'inverter', 'name': 'WIT50K-HU', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': None, 'active': True, 'electrical': {'acPowerKw': 50.0}},
    {'type_key': 'sadot_spa_10000tl3_bh_up', 'product_type': 'inverter', 'name': 'SPA 10000TL3 BH-UP', 'part_number': None, 'additional_info': None, 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 10.0}},
    {'type_key': 'sadot_ark_2_5l_a1_cable', 'product_type': 'cable', 'name': 'ARK 2.5L-A1 Cable', 'part_number': None, 'additional_info': 'Battery Off Grid Cable', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_tpm_ct_e_250a', 'product_type': 'smart_meter', 'name': 'TPM-CT-E (250A)', 'part_number': None, 'additional_info': None, 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_shinesem_xa_r', 'product_type': 'datalogger', 'name': 'ShineSEM-XA-R', 'part_number': None, 'additional_info': 'Smart Energy Manager', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_max_253ktl3_x_hv', 'product_type': 'inverter', 'name': 'MAX 253KTL3-X HV', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 253.0}},
    {'type_key': 'sadot_mid_25ktl3_x', 'product_type': 'inverter', 'name': 'MID 25KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 25.0}},
    {'type_key': 'sadot_mid_15ktl3_x', 'product_type': 'inverter', 'name': 'MID 15KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 15.0}},
    {'type_key': 'sadot_mid_17ktl3_x', 'product_type': 'inverter', 'name': 'MID 17KTL3-X', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 17.0}},
    {'type_key': 'sadot_infinity_1300_eu', 'product_type': 'portable_power_station', 'name': 'Infinity 1300-EU', 'part_number': None, 'additional_info': 'Portable Power Station', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_mid_17ktl3_xh', 'product_type': 'inverter', 'name': 'MID 17KTL3-XH', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': None, 'active': False, 'electrical': {'acPowerKw': 17.0}},
    {'type_key': 'sadot_mod_15ktl3_hu', 'product_type': 'inverter', 'name': 'MOD 15KTL3-HU', 'part_number': None, 'additional_info': 'MOD 15KTL3-HU Hybrid Inverter', 'price_ils': None, 'active': False, 'electrical': None},
    {'type_key': 'sadot_hope_16_0lm_a1', 'product_type': 'battery', 'name': 'Hope 16.0LM-A1', 'part_number': None, 'additional_info': 'Indoor Battery', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_mid_25ktl3_xh', 'product_type': 'inverter', 'name': 'MID 25KTL3-XH', 'part_number': None, 'additional_info': 'Inverter Hybrid', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_shinemaster4g_x', 'product_type': 'datalogger', 'name': 'ShineMaster4G-X', 'part_number': None, 'additional_info': 'Shine Master 4G-X', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_mid_30ktl3_x2', 'product_type': 'inverter', 'name': 'MID 30KTL3-X2', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': True, 'electrical': {'acPowerKw': 30.0}},
    {'type_key': 'sadot_mid_17ktl3_x2', 'product_type': 'inverter', 'name': 'MID 17KTL3-X2', 'part_number': None, 'additional_info': 'Inverter On Grid', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_spm_6000tl_hu', 'product_type': 'inverter', 'name': 'SPM 6000TL-HU', 'part_number': None, 'additional_info': '6kW Single Phase Hybrid Inverter', 'price_ils': None, 'active': True, 'electrical': {'acPowerKw': 6.0}},
    {'type_key': 'sadot_wit_25k_hu_lv', 'product_type': 'inverter', 'name': 'WIT 25K-HU LV', 'part_number': None, 'additional_info': '25 kW Hybrid Inverter LV', 'price_ils': None, 'active': True, 'electrical': {'acPowerKw': 25.0}},
    {'type_key': 'sadot_ee_mana_16_0_1p1', 'product_type': 'battery', 'name': 'EE - MANA 16.0-1P1', 'part_number': None, 'additional_info': 'Eenovance MANA 16.0 kWh LV Battery', 'price_ils': None, 'active': True, 'electrical': None},
    {'type_key': 'sadot_alp_5_0_lv_series_cable', 'product_type': 'cable', 'name': 'ALP 5.0 LV Series Cable', 'part_number': None, 'additional_info': 'ALP 5.0 LV Series Cable', 'price_ils': None, 'active': True, 'electrical': None},
]

# type_keys seeded here — used by downgrade() to remove exactly these rows.
_TYPE_KEYS = [p["type_key"] for p in SADOT_PRODUCTS]


def upgrade() -> None:
    conn = op.get_bind()
    stmt = sa.text(
        """
        INSERT INTO products
            (id, type_key, product_type, name, part_number, additional_info,
             active, price_ils, electrical, created_at, updated_at)
        VALUES
            (gen_random_uuid(), :type_key, :product_type, :name, :part_number,
             :additional_info, :active, :price_ils, CAST(:electrical AS JSONB),
             NOW(), NOW())
        ON CONFLICT (type_key) DO NOTHING
        """
    )
    for p in SADOT_PRODUCTS:
        conn.execute(stmt, {
            "type_key": p["type_key"],
            "product_type": p["product_type"],
            "name": p["name"],
            "part_number": p["part_number"],
            "additional_info": p["additional_info"],
            "active": p["active"],
            "price_ils": p["price_ils"],
            "electrical": json.dumps(p["electrical"]) if p["electrical"] else None,
        })


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM products WHERE type_key = ANY(:keys)"),
        {"keys": _TYPE_KEYS},
    )
