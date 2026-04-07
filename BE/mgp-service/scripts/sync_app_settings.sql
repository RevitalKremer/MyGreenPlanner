-- Sync app_settings to expected state after all migrations (0003-0029)
-- Safe to run multiple times (idempotent)
-- Run: docker exec -i <container> psql -U <user> -d <db> < scripts/sync_app_settings.sql

BEGIN;

-- ── Visibility ──────────────────────────────────────────────────────────
UPDATE app_settings SET visible = false WHERE key IN (
    'panelGapCm', 'lineGapCm', 'railRoundThresholdCm', 'panelThickCm',
    'reverseBlockPunches', 'angleProfileSizeMm',
    'diagSkipBelowCm', 'diagDoubleAboveCm',
    'railRoundPrecisionCm', 'crossRailEdgeDistMm', 'stockLengths',
    'punchOverlapMarginCm', 'punchInnerOffsetCm'
);

UPDATE app_settings SET visible = true WHERE key IN (
    'railSpacingV', 'railSpacingH', 'keepSymmetry', 'railOverhangCm',
    'edgeOffsetMm', 'spacingMm', 'baseOverhangCm',
    'blockHeightCm', 'blockLengthCm', 'blockWidthCm', 'blockPunchCm',
    'diagTopPct', 'diagBasePct',
    'purlinBufferCm', 'extendFront', 'extendRear'
);

-- ── Highlight groups ────────────────────────────────────────────────────
UPDATE app_settings SET highlight_group = 'railSpacingV'  WHERE key = 'railSpacingV';
UPDATE app_settings SET highlight_group = 'railSpacingH'  WHERE key = 'railSpacingH';
UPDATE app_settings SET highlight_group = 'rail-ends'     WHERE key = 'railOverhangCm';
UPDATE app_settings SET highlight_group = 'cross-rails'   WHERE key = 'crossRailEdgeDistMm';
UPDATE app_settings SET highlight_group = 'rail-cuts'     WHERE key = 'stockLengths';
UPDATE app_settings SET highlight_group = 'base-edges'    WHERE key = 'edgeOffsetMm';
UPDATE app_settings SET highlight_group = 'base-spacing'  WHERE key = 'spacingMm';
UPDATE app_settings SET highlight_group = 'base-overhang' WHERE key = 'baseOverhangCm';
UPDATE app_settings SET highlight_group = 'blocks'        WHERE key IN ('blockHeightCm', 'blockLengthCm', 'blockWidthCm', 'blockPunchCm');
UPDATE app_settings SET highlight_group = 'diagonal'      WHERE key IN ('diagTopPct', 'diagBasePct');
UPDATE app_settings SET highlight_group = 'diagonals'     WHERE key IN ('diagSkipBelowCm', 'diagDoubleAboveCm');
UPDATE app_settings SET highlight_group = 'punches'       WHERE key IN ('punchOverlapMarginCm', 'punchInnerOffsetCm');
UPDATE app_settings SET highlight_group = 'extension'     WHERE key IN ('purlinBufferCm', 'extendFront', 'extendRear');

-- ── Roof types ──────────────────────────────────────────────────────────
-- NULL = all roof types
UPDATE app_settings SET roof_types = NULL WHERE key IN (
    'railSpacingV', 'railSpacingH', 'keepSymmetry', 'railOverhangCm',
    'crossRailEdgeDistMm', 'stockLengths',
    'panelGapCm', 'panelThickCm', 'lineGapCm',
    'railRoundThresholdCm', 'railRoundPrecisionCm'
);

-- Concrete only
UPDATE app_settings SET roof_types = '["concrete"]'::jsonb WHERE key IN (
    'blockHeightCm', 'blockLengthCm', 'blockWidthCm', 'blockPunchCm',
    'reverseBlockPunches'
);

-- Concrete + purlin types (not tiles)
UPDATE app_settings SET roof_types = '["concrete", "iskurit", "insulated_panel"]'::jsonb WHERE key IN (
    'diagTopPct', 'diagBasePct', 'diagSkipBelowCm', 'diagDoubleAboveCm',
    'edgeOffsetMm', 'spacingMm', 'baseOverhangCm', 'angleProfileSizeMm',
    'punchOverlapMarginCm', 'punchInnerOffsetCm'
);

-- Purlin types only
UPDATE app_settings SET roof_types = '["iskurit", "insulated_panel"]'::jsonb WHERE key IN (
    'purlinBufferCm', 'extendFront', 'extendRear'
);

-- ── Products: roof-type mounting hardware ───────────────────────────────
UPDATE products SET active = true WHERE type_key IN (
    'self_drilling_screw_7_5_drill_1_4_1_4_1_with_seal',
    'self_drilling_screw_12_5_5_drill_with_seal',
    'hooks', 'hook_5cm_with_3_holes_gallery',
    'torx_sharp_screw_for_wood_roof_7_5cm_3'
);

UPDATE products SET alt_group = 2, is_default = true  WHERE type_key = 'hooks';
UPDATE products SET alt_group = 2, is_default = false WHERE type_key = 'hook_5cm_with_3_holes_gallery';

COMMIT;

-- Verify
SELECT key, visible, highlight_group, roof_types, scope, section
FROM app_settings
ORDER BY section, scope, key;
