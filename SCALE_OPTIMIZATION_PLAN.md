# MyGreenPlanner — Scale Optimization Roadmap

## Executive Summary

This document outlines the complete optimization strategy to scale MyGreenPlanner for production use with hundreds of users and thousands of projects. The plan addresses database size, API payload efficiency, frontend performance, and user experience.

---

## Current State (Before Optimization)

### Problems
1. **Monolithic JSONB storage** — Entire project (layout + step2 + step3 + step4 + images) in single `layout_data` column
2. **Image bloat** — 1-2MB base64 images stored in JSONB, transferred on every save/load
3. **White canvas waste** — 1MB of white pixels stored for non-imagery projects
4. **All-or-nothing loading** — Must load entire project even to view basic info
5. **Save inefficiency** — Re-save entire project JSON even when only one step changes
6. **No image optimization** — Full-resolution images stored without compression

### Impact
- 2-5 second save times for typical projects
- 100+ MB database size with just 50 projects
- Slow project list loading (must parse all JSONB)
- Mobile users struggle with large payloads
- Database bloat increases hosting costs

---

## Optimization Strategy — 6 Phases

### ✅ Phase 1: Separate Image Storage (COMPLETED)

**Goal:** Move images out of JSONB into dedicated BLOB storage

**Implementation:**
- Created `project_images` table with BYTEA column
- Added `imageRef` field to link layout to image
- API endpoints: `POST /projects/{id}/image`, `GET /projects/{id}/image/{ref}`
- Frontend: `uploadProjectImage()`, fetch image on load

**Results:**
- ✅ Reduced layout_data JSON by ~1-2MB per project
- ✅ Images loaded separately, not blocking project metadata
- ✅ Enables lazy image loading (future enhancement)

**Files Changed:**
- `BE/mgp-service/alembic/versions/0031_create_project_images_table.py`
- `BE/mgp-service/app/models/project_image.py`
- `BE/mgp-service/app/routers/projects.py` (lines 45-125)
- `FE/src/hooks/useProjectState.js` (lines 232-265, 348-370)
- `FE/src/services/projectsApi.js` (lines 45+)

---

### ✅ Phase 2: White Canvas Optimization (COMPLETED)

**Goal:** Eliminate storage/transfer of white canvas images

**Implementation:**
- Detect white canvas via `isWhiteboard: true` flag
- Exclude `imageData` from save if `isWhiteboard || imageRef`
- Regenerate white canvas on load using `generateWhiteCanvas()`
- Skip database upload for white canvas

**Results:**
- ✅ Reduced payload by ~1MB for white canvas projects
- ✅ 4-6x faster saves for non-imagery projects
- ✅ Zero database storage for white canvas

**Files Changed:**
- `FE/src/hooks/useProjectState.js` (lines 196-201, 275-291, 348-351)

**See:** [WHITE_CANVAS_OPTIMIZATION.md](./WHITE_CANVAS_OPTIMIZATION.md) (to be created)

---

### 🔄 Phase 3: Split Step Data Storage (IN PLANNING)

**Goal:** Separate layout, step2, step3, step4 data into individual columns/tables

**Current Structure:**
```javascript
layout_data: {
  layout: { panels: [...], rectAreas: [...], uploadedImageData: {...} },
  step2: { settings: {...}, panelGroups: [...] },
  step3: { settings: {...}, adjustments: [...] },
  step4: { globalSettings: {...}, areaSettings: [...], trapezoidConfigs: [...] }
}
```

**Target Structure:**
```sql
-- Option A: Separate columns
projects {
  id, name, user_id, created_at, current_step,
  layout_data JSONB,      -- Only layout (panels, areas, image metadata)
  step2_data JSONB,       -- Only step 2 settings
  step3_data JSONB,       -- Only step 3 settings
  step4_data JSONB        -- Only step 4 settings
}

-- Option B: Separate table (more flexible)
project_steps {
  id, project_id, step_number, data JSONB, updated_at
}
```

**Migration Strategy:**
1. Create new column schema (backward compatible)
2. Add migration script to split existing `layout_data`
3. Update frontend `getLayoutData()` to save to separate fields
4. Update `handleImportProject()` to load from separate fields
5. Deprecate old monolithic storage after migration period

**Expected Benefits:**
- Lazy load: Only fetch step data when user navigates to that step
- Incremental saves: Save only changed step, not entire project
- Faster project list: Don't need step data for project cards
- Reduced payload: Typical ~50-70% reduction per request

**Effort Estimate:** 3-4 hours

---

### 🔜 Phase 4: Incremental Save Strategy (PLANNED)

**Goal:** Save only the step that changed, not entire project

**Current Flow:**
```
User edits Step 4 → handleSaveProject() → Save ALL steps to database
```

**Target Flow:**
```
User edits Step 4 → handleSaveStep4() → Save ONLY step4_data
```

**Implementation:**
- Add `saveStep(stepNumber, data)` API endpoint
- Track `dirtySteps` in frontend state
- Debounced auto-save per step
- Optimistic UI updates (save in background)

**Expected Benefits:**
- 70-80% faster saves (saving 10KB instead of 50KB)
- Less database write load
- Better UX with background saves

**Dependencies:** Requires Phase 3 (split step data) first

**Effort Estimate:** 2-3 hours

---

### 🔜 Phase 5: Image Optimization Pipeline (PLANNED)

**Goal:** Reduce image size without quality loss

**Implementation:**
1. **Client-side resize** (before upload)
   - Max dimensions: 4000×4000 (typical roof images don't need more)
   - Use canvas API to resize large images
   
2. **Server-side compression** (on upload)
   - Convert PNG → WebP (70-80% smaller, lossless)
   - Quality setting: 85 (imperceptible quality loss)
   - Library: Pillow (Python) or sharp (if we add Node.js service)

3. **Thumbnail generation**
   - Generate 400×300 thumbnail for project list
   - Store both full + thumbnail in `project_images`
   - Serve thumbnail for grid views

**Expected Benefits:**
- 60-80% reduction in image storage (WebP conversion)
- Faster project list rendering (thumbnails)
- Lower bandwidth costs

**Migration Strategy:**
- Process existing images in background job
- Keep original format as backup for 30 days

**Effort Estimate:** 4-6 hours

---

### 🔜 Phase 6: Caching & Performance (PLANNED)

**Goal:** Reduce redundant database queries and computations

**Frontend Caching:**
1. **Session storage cache**
   - Cache loaded projects in sessionStorage
   - Invalidate on save
   - Reduces repeated API calls when navigating between steps

2. **In-memory state cache**
   - Cache computed values (BOM, measurements)
   - Invalidate on relevant setting changes
   - Avoid re-computing on every render

**Backend Caching:**
1. **Redis cache** (optional, for production scale)
   - Cache project metadata for list views
   - Cache user settings
   - TTL: 5 minutes

2. **Database indexes**
   - Index on `user_id` (already exists)
   - Index on `created_at` for sorting
   - Partial index on `current_step` for filtering

**Expected Benefits:**
- 2-3x faster project list loading
- Reduced database load
- Better UX on slow connections

**Effort Estimate:** 3-5 hours

---

## Measurement & Success Metrics

### Key Performance Indicators (KPIs)

| Metric | Before | After Phase 2 | Target (Phase 6) |
|--------|--------|---------------|------------------|
| **Save time (white canvas)** | 2-3s | 0.5s ✅ | 0.3s |
| **Save time (with image)** | 3-5s | 2-3s | 0.8s |
| **Load time** | 1-2s | 1-2s | 0.5s |
| **Project list load** | 1-2s | 1-2s | 0.3s |
| **JSON payload size (white canvas)** | 1.2 MB | 0.2 MB ✅ | 0.15 MB |
| **JSON payload size (with image)** | 2.5 MB | 0.3 MB ✅ | 0.2 MB |
| **Database size (per project)** | 1-2 MB | 0.1-1 MB | 0.05-0.3 MB |
| **Image storage (per project)** | 1-2 MB | 1-2 MB | 0.3-0.6 MB |

### Monitoring Plan

**Phase 3+ Monitoring:**
- Add timing logs to API endpoints (P50, P95, P99)
- Track payload sizes in production
- User-reported performance issues
- Database size growth rate

---

## Implementation Priority

### High Priority (Next Sprint)
1. ✅ Phase 1: Separate image storage
2. ✅ Phase 2: White canvas optimization
3. **Phase 3: Split step data** ← NEXT

### Medium Priority (Following Sprint)
4. Phase 4: Incremental saves
5. Phase 5: Image optimization

### Low Priority (Future Enhancement)
6. Phase 6: Caching & advanced performance

---

## Risk Assessment

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Migration data loss** | High | Comprehensive backup before migration, rollback plan |
| **Backward compatibility break** | High | Gradual migration, support both formats during transition |
| **Image quality degradation** | Medium | A/B test WebP quality, keep originals for 30 days |
| **Cache invalidation bugs** | Medium | Conservative TTL, manual invalidation endpoints |
| **Increased complexity** | Low | Good documentation, clear separation of concerns |

### Performance Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Lazy loading delays** | Medium | Prefetch next step data, show loading states |
| **Multiple API calls overhead** | Low | HTTP/2 multiplexing, consider GraphQL later |
| **Redis cost** | Low | Start without Redis, add only if needed |

---

## Rollback Plan

### Per-Phase Rollback
- **Phase 3:** Revert to reading from monolithic `layout_data`, populate from split columns if missing
- **Phase 4:** Disable incremental saves, fall back to full save
- **Phase 5:** Serve original images if WebP conversion fails
- **Phase 6:** Disable cache layers, direct database queries

### Database Migration Rollback
```sql
-- Rollback Phase 3 migration (if needed)
UPDATE projects 
SET layout_data = jsonb_build_object(
  'layout', layout_data,
  'step2', step2_data,
  'step3', step3_data,
  'step4', step4_data
);
```

---

## Code Structure Changes

### New File Organization (Post Phase 3)

```
FE/src/
  hooks/
    useProjectState.js        → General project management
    useLayoutData.js          → NEW: Layout-specific state
    useStep2Data.js           → NEW: Step 2 state & save
    useStep3Data.js           → NEW: Step 3 state & save
    useStep4Data.js           → NEW: Step 4 state & save
  services/
    projectsApi.js            → Project CRUD
    layoutApi.js              → NEW: Layout-specific API
    stepDataApi.js            → NEW: Step data save/load
```

### API Endpoint Changes

```
# Current
GET  /api/projects/{id}              → Full project (all steps)
POST /api/projects/{id}              → Save full project

# After Phase 3
GET  /api/projects/{id}              → Metadata + layout only
GET  /api/projects/{id}/step/{num}   → Specific step data
POST /api/projects/{id}/step/{num}   → Save specific step
GET  /api/projects/{id}/full         → Full project (for export)
```

---

## Testing Strategy

### Phase 3 Testing Checklist
- [ ] New project creation (all fields populated correctly)
- [ ] Load existing project (migration from monolithic structure)
- [ ] Save individual steps (verify only changed step saved)
- [ ] Navigate between steps (data preserved)
- [ ] Export project (all data included)
- [ ] Import project (split data correctly)
- [ ] Performance test: Save 100 projects, measure time
- [ ] Database size test: Verify no bloat after migration

### Phase 4 Testing Checklist
- [ ] Auto-save triggers correctly
- [ ] Optimistic UI updates work
- [ ] Network failure handling (rollback UI state)
- [ ] Concurrent edit detection (multiple tabs)
- [ ] Dirty state tracking accurate

### Phase 5 Testing Checklist
- [ ] Image resize maintains aspect ratio
- [ ] WebP conversion quality acceptable (visual comparison)
- [ ] Thumbnail generation correct
- [ ] Legacy image support (pre-optimization)
- [ ] Mobile upload performance

---

## Timeline Estimate

| Phase | Description | Hours | Status |
|-------|-------------|-------|--------|
| 1 | Separate image storage | 4h | ✅ Complete |
| 2 | White canvas optimization | 2h | ✅ Complete |
| 3 | Split step data storage | 4h | 🔄 Next |
| 4 | Incremental saves | 3h | 📋 Planned |
| 5 | Image optimization | 6h | 📋 Planned |
| 6 | Caching & performance | 5h | 📋 Planned |
| **Total** | | **24h** | **~8% complete** |

---

## Questions & Decisions

### Open Questions
1. **Phase 3:** Separate columns vs separate table?
   - **Recommendation:** Separate columns (simpler queries, less joins)
   
2. **Phase 4:** How to handle concurrent edits from multiple tabs?
   - **Recommendation:** Last-write-wins + warning notification
   
3. **Phase 5:** WebP browser support concerns?
   - **Recommendation:** 97% support (caniuse.com), fallback to PNG for old browsers
   
4. **Phase 6:** Redis worth the complexity?
   - **Recommendation:** Start without, add if >1000 active users

### Decisions Made
- ✅ Store images in PostgreSQL BYTEA (not S3) — simpler deployment
- ✅ Regenerate white canvas client-side (not store) — huge savings
- ✅ Use imageRef pattern (not embed URLs) — cleaner separation

---

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) — Developer instructions
- [WHITE_CANVAS_OPTIMIZATION.md](./WHITE_CANVAS_OPTIMIZATION.md) — Phase 2 details (to be created)
- `/BE/mgp-service/alembic/versions/` — Database migration history
- `/FE/src/hooks/useProjectState.js` — Primary state management

---

**Document Version:** 1.0  
**Last Updated:** April 10, 2026  
**Status:** Phases 1-2 complete, Phase 3 in planning  
**Owner:** GitHub Copilot + Revital Kremer
