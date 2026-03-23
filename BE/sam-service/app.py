import os
import io
import json
import math
import base64
import requests
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import numpy as np
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

app = FastAPI(title="MyGreenPlanner API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instances
predictor = None
mask_generator = None
device = "cuda" if torch.cuda.is_available() else "cpu"

def load_sam2_model():
    """Load SAM2 model on startup"""
    global predictor, mask_generator

    print(f"Loading SAM2 model on {device}...")

    # Use SAM2 large model - adjust path as needed
    checkpoint = "./checkpoints/sam2_hiera_large.pt"
    model_cfg = "sam2_hiera_l.yaml"

    if not os.path.exists(checkpoint):
        raise FileNotFoundError(
            f"SAM2 checkpoint not found at {checkpoint}. "
            "Please download it from: https://github.com/facebookresearch/segment-anything-2"
        )

    sam2_model = build_sam2(model_cfg, checkpoint, device=device)
    predictor = SAM2ImagePredictor(sam2_model)
    mask_generator = SAM2AutomaticMaskGenerator(
        sam2_model,
        points_per_side=32,
        pred_iou_thresh=0.7,
        stability_score_thresh=0.85,
        min_mask_region_area=200,
    )

    print("SAM2 model loaded successfully!")

@app.on_event("startup")
async def startup_event():
    """Initialize model on startup"""
    try:
        load_sam2_model()
    except Exception as e:
        print(f"Warning: Could not load SAM2 model: {e}")
        print("API will run but segmentation will not work until model is loaded.")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "model_loaded": predictor is not None and mask_generator is not None,
        "device": device
    }

@app.post("/segment-roof")
async def segment_roof(
    image: UploadFile = File(...),
    point_x: float = Form(...),
    point_y: float = Form(...),
):
    """
    Segment a roof from an image based on a point click.
    
    Args:
        image: Satellite/aerial image file
        point_x: X coordinate of the clicked point (normalized 0-1 or pixel)
        point_y: Y coordinate of the clicked point (normalized 0-1 or pixel)
    
    Returns:
        GeoJSON polygon of the segmented roof
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    try:
        # Read and process image
        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_np = np.array(pil_image)
        
        # Get image dimensions
        height, width = image_np.shape[:2]
        
        print(f"\n{'='*60}")
        print(f"📤 UPLOADED IMAGE SEGMENTATION:")
        print(f"   Click point: ({point_x}, {point_y})")
        print(f"   Image dimensions: {width}x{height}")
        print(f"   Aspect ratio: {width/height:.3f}")
        print(f"{'='*60}\n")
        
        # Convert normalized coordinates to pixel coordinates if needed
        # Assuming coordinates are sent as pixels from frontend
        point_coords = np.array([[point_x, point_y]])
        point_labels = np.array([1])  # 1 = foreground point
        
        # Set image in predictor
        predictor.set_image(image_np)
        
        # Predict mask
        masks, scores, logits = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )
        
        # Select best mask (highest score)
        best_mask_idx = np.argmax(scores)
        best_mask = masks[best_mask_idx]
        best_score = float(scores[best_mask_idx])
        
        # Convert mask to polygon
        polygon = mask_to_polygon(best_mask)
        
        # Convert original image to base64 for frontend display
        buffered = io.BytesIO()
        pil_image.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        print(f"\n{'='*60}")
        print(f"✅ SENDING BACK TO FRONTEND:")
        print(f"   Image dimensions: {width}x{height}")
        print(f"   Polygon points: {len(polygon)}")
        print(f"   Base64 image size: {len(img_base64):,} chars")
        print(f"   Confidence: {best_score:.3f}")
        print(f"{'='*60}\n")
        
        # Create GeoJSON format
        geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [polygon]
            },
            "properties": {
                "confidence": best_score,
                "area_pixels": int(np.sum(best_mask)),
                "image_width": width,
                "image_height": height,
                "image_base64": f"data:image/png;base64,{img_base64}",
                "polygon_pixels": polygon,
                "click_point": [float(point_x), float(point_y)]
            }
        }
        
        return JSONResponse(content=geojson)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation error: {str(e)}")

def mask_to_polygon(mask: np.ndarray, tolerance: float = 2.0) -> List[List[float]]:
    """
    Convert a binary mask to a polygon.
    
    Args:
        mask: Binary mask array
        tolerance: Simplification tolerance for polygon
    
    Returns:
        List of [x, y] coordinates forming the polygon
    """
    import cv2
    
    # Find contours
    contours, _ = cv2.findContours(
        mask.astype(np.uint8),
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )
    
    if not contours:
        return []
    
    # Get the largest contour
    largest_contour = max(contours, key=cv2.contourArea)
    
    # Simplify the contour
    epsilon = tolerance
    simplified_contour = cv2.approxPolyDP(largest_contour, epsilon, True)
    
    # Convert to list of coordinates
    polygon = [[float(point[0][0]), float(point[0][1])] 
               for point in simplified_contour]
    
    # Close the polygon if not closed
    if polygon and polygon[0] != polygon[-1]:
        polygon.append(polygon[0])
    
    return polygon

@app.post("/segment-roof-coordinates")
async def segment_roof_with_geo_coordinates(
    image: UploadFile = File(...),
    lat: float = Form(...),
    lng: float = Form(...),
    bounds: str = Form(...),  # JSON string: {"north": ..., "south": ..., "east": ..., "west": ...}
):
    """
    Segment a roof using geographic coordinates.
    Converts lat/lng to image pixel coordinates based on map bounds.
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    try:
        # Parse bounds
        bounds_dict = json.loads(bounds)
        
        # Read image
        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_np = np.array(pil_image)
        height, width = image_np.shape[:2]
        
        # Convert lat/lng to pixel coordinates
        lat_range = bounds_dict["north"] - bounds_dict["south"]
        lng_range = bounds_dict["east"] - bounds_dict["west"]
        
        pixel_x = ((lng - bounds_dict["west"]) / lng_range) * width
        pixel_y = ((bounds_dict["north"] - lat) / lat_range) * height
        
        # Use the other endpoint
        point_coords = np.array([[pixel_x, pixel_y]])
        point_labels = np.array([1])
        
        predictor.set_image(image_np)
        masks, scores, logits = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )
        
        best_mask_idx = np.argmax(scores)
        best_mask = masks[best_mask_idx]
        best_score = float(scores[best_mask_idx])
        
        # Convert mask to polygon (in pixels)
        polygon_pixels = mask_to_polygon(best_mask)
        
        # Convert pixel coordinates back to lat/lng
        polygon_geo = []
        for x, y in polygon_pixels:
            lng_point = bounds_dict["west"] + (x / width) * lng_range
            lat_point = bounds_dict["north"] - (y / height) * lat_range
            polygon_geo.append([lng_point, lat_point])
        
        geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [polygon_geo]
            },
            "properties": {
                "confidence": best_score,
                "area_pixels": int(np.sum(best_mask))
            }
        }
        
        return JSONResponse(content=geojson)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation error: {str(e)}")

def lat_lng_to_tile(lat: float, lng: float, zoom: int) -> tuple:
    """Convert lat/lng to tile coordinates"""
    n = 2.0 ** zoom
    x_tile = int((lng + 180.0) / 360.0 * n)
    y_tile = int((1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
    return x_tile, y_tile

def tile_to_lat_lng(x_tile: int, y_tile: int, zoom: int) -> tuple:
    """Convert tile coordinates to lat/lng (top-left corner)"""
    n = 2.0 ** zoom
    lng = x_tile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y_tile / n)))
    lat = math.degrees(lat_rad)
    return lat, lng

def fetch_google_tile(x: int, y: int, zoom: int) -> Image.Image:
    """Fetch a single tile from Google Maps"""
    server = np.random.randint(0, 4)  # Google uses servers 0-3
    url = f"https://mt{server}.google.com/vt/lyrs=s&x={x}&y={y}&z={zoom}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return Image.open(io.BytesIO(response.content))
    except Exception as e:
        print(f"Error fetching tile {x},{y},{zoom}: {e}")
        # Return blank tile on error
        return Image.new('RGB', (256, 256), color='gray')

def fetch_and_stitch_tiles(bounds: Dict[str, float], zoom: int, max_size: int = 1024) -> tuple:
    """
    Fetch and stitch map tiles for the given bounds.
    Returns: (stitched_image, actual_bounds_dict)
    """
    # Get tile coordinates for bounds
    west_tile, north_tile = lat_lng_to_tile(bounds["north"], bounds["west"], zoom)
    east_tile, south_tile = lat_lng_to_tile(bounds["south"], bounds["east"], zoom)
    
    # Ensure proper ordering
    x_min, x_max = min(west_tile, east_tile), max(west_tile, east_tile)
    y_min, y_max = min(north_tile, south_tile), max(north_tile, south_tile)
    
    # Calculate number of tiles needed
    tiles_x = x_max - x_min + 1
    tiles_y = y_max - y_min + 1
    
    print(f"Fetching {tiles_x}x{tiles_y} = {tiles_x * tiles_y} tiles at zoom {zoom}")
    
    # Create canvas for stitching
    tile_size = 256
    canvas_width = tiles_x * tile_size
    canvas_height = tiles_y * tile_size
    canvas = Image.new('RGB', (canvas_width, canvas_height))
    
    # Fetch and place tiles
    for ty in range(tiles_y):
        for tx in range(tiles_x):
            tile_x = x_min + tx
            tile_y = y_min + ty
            
            tile_img = fetch_google_tile(tile_x, tile_y, zoom)
            canvas.paste(tile_img, (tx * tile_size, ty * tile_size))
    
    # Calculate actual bounds of stitched image
    nw_lat, nw_lng = tile_to_lat_lng(x_min, y_min, zoom)
    se_lat, se_lng = tile_to_lat_lng(x_max + 1, y_max + 1, zoom)
    
    actual_bounds = {
        "north": nw_lat,
        "south": se_lat,
        "west": nw_lng,
        "east": se_lng
    }
    
    print(f"Original stitched image size: {canvas.size}")
    
    # Resize if larger than max_size while keeping aspect ratio
    if canvas.width > max_size or canvas.height > max_size:
        # Use copy() because thumbnail() modifies in place
        canvas = canvas.copy()
        canvas.thumbnail((max_size, max_size), Image.LANCZOS)
        print(f"Resized image to: {canvas.size}")
    
    print(f"Final image size: {canvas.size}, bounds: {actual_bounds}")
    
    return canvas, actual_bounds

@app.post("/segment-roof-from-map")
async def segment_roof_from_map(
    lat: float = Form(...),
    lng: float = Form(...),
    zoom: int = Form(...),
    bounds: str = Form(...),  # JSON: {"north": ..., "south": ..., "east": ..., "west": ...}
):
    """
    Segment roof directly from map coordinates.
    Backend fetches tiles from Google Maps to avoid CORS issues.
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
    
    try:
        # Parse bounds
        bounds_dict = json.loads(bounds)
        
        print(f"\n{'='*60}")
        print(f"📍 RECEIVED FROM FRONTEND:")
        print(f"   Lat/Lng: ({lat}, {lng})")
        print(f"   Zoom: {zoom}")
        print(f"   Bounds: N={bounds_dict['north']:.6f}, S={bounds_dict['south']:.6f}")
        print(f"           E={bounds_dict['east']:.6f}, W={bounds_dict['west']:.6f}")
        lat_span = bounds_dict['north'] - bounds_dict['south']
        lng_span = bounds_dict['east'] - bounds_dict['west']
        print(f"   Map viewport aspect: {lng_span/lat_span:.3f}")
        print(f"{'='*60}\n")
        
        # Fetch and stitch map tiles
        print(f"Fetching map tiles for lat={lat}, lng={lng}, zoom={zoom}")
        stitched_image, actual_bounds = fetch_and_stitch_tiles(bounds_dict, zoom)
        
        # Convert to numpy array
        image_np = np.array(stitched_image)
        height, width = image_np.shape[:2]
        
        print(f"\n{'='*60}")
        print(f"🖼️  IMAGE DIMENSIONS AFTER STITCHING & RESIZING:")
        print(f"   Width: {width}px")
        print(f"   Height: {height}px")
        print(f"   Aspect Ratio: {width/height:.3f}")
        print(f"   Total Pixels: {width * height:,}")
        print(f"{'='*60}\n")
        
        # Convert lat/lng to pixel coordinates
        lat_range = actual_bounds["north"] - actual_bounds["south"]
        lng_range = actual_bounds["east"] - actual_bounds["west"]
        
        pixel_x = ((lng - actual_bounds["west"]) / lng_range) * width
        pixel_y = ((actual_bounds["north"] - lat) / lat_range) * height
        
        print(f"\n{'='*60}")
        print(f"🎯 CLICK POINT CONVERSION:")
        print(f"   Input: lat={lat:.6f}, lng={lng:.6f}")
        print(f"   Using actual_bounds for conversion:")
        print(f"      West={actual_bounds['west']:.6f}, East={actual_bounds['east']:.6f}")
        print(f"      North={actual_bounds['north']:.6f}, South={actual_bounds['south']:.6f}")
        print(f"   Converted to pixel: ({pixel_x:.1f}, {pixel_y:.1f})")
        print(f"   Image size: {width}x{height}")
        print(f"   ⚠️  If click point looks wrong, bounds mismatch is the issue!")
        print(f"{'='*60}\n")
        
        print(f"Click point in image: ({pixel_x:.1f}, {pixel_y:.1f}) in {width}x{height} image")
        
        # Run SAM2
        point_coords = np.array([[pixel_x, pixel_y]])
        point_labels = np.array([1])
        
        predictor.set_image(image_np)
        masks, scores, logits = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )
        
        best_mask_idx = np.argmax(scores)
        best_mask = masks[best_mask_idx]
        best_score = float(scores[best_mask_idx])
        
        # Convert mask to polygon (in pixels)
        polygon_pixels = mask_to_polygon(best_mask)
        
        # Convert pixel coordinates back to lat/lng
        polygon_geo = []
        for x, y in polygon_pixels:
            lng_point = actual_bounds["west"] + (x / width) * lng_range
            lat_point = actual_bounds["north"] - (y / height) * lat_range
            polygon_geo.append([lng_point, lat_point])
        
        # Convert image to base64 for frontend display
        buffered = io.BytesIO()
        stitched_image.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        print(f"\n{'='*60}")
        print(f"✅ SENDING BACK TO FRONTEND:")
        print(f"   Image dimensions: {width}x{height}")
        print(f"   Polygon points (pixels): {len(polygon_pixels)}")
        print(f"   Polygon points (geo): {len(polygon_geo)}")
        print(f"   Base64 image size: {len(img_base64):,} chars")
        print(f"   Confidence: {best_score:.3f}")
        print(f"   Actual bounds used:")
        print(f"      North: {actual_bounds['north']:.6f}")
        print(f"      South: {actual_bounds['south']:.6f}")
        print(f"      East: {actual_bounds['east']:.6f}")
        print(f"      West: {actual_bounds['west']:.6f}")
        print(f"   Requested bounds:")
        print(f"      North: {bounds_dict['north']:.6f}")
        print(f"      South: {bounds_dict['south']:.6f}")
        print(f"      East: {bounds_dict['east']:.6f}")
        print(f"      West: {bounds_dict['west']:.6f}")
        print(f"   Sample polygon points (first 3):")
        for i in range(min(3, len(polygon_geo))):
            print(f"      [{polygon_geo[i][0]:.6f}, {polygon_geo[i][1]:.6f}]")
        print(f"{'='*60}\n")
        
        geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [polygon_geo]
            },
            "properties": {
                "confidence": best_score,
                "area_pixels": int(np.sum(best_mask)),
                "image_base64": f"data:image/png;base64,{img_base64}",
                "image_width": width,
                "image_height": height,
                "polygon_pixels": polygon_pixels,
                "click_point": [pixel_x, pixel_y],
                "actual_bounds": actual_bounds
            }
        }
        
        return JSONResponse(content=geojson)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Segmentation error: {str(e)}")

@app.post("/segment-all-panels")
async def segment_all_panels(
    image: UploadFile = File(...),
    sample_x: Optional[float] = Form(None),
    sample_y: Optional[float] = Form(None),
):
    """
    Detect all solar panels in a plan image.

    Strategy A (sample point provided):
      1. Detect the individual sample panel → measure its exact size and rotation.
      2. Select the SAM2 mask at the next scale up as the "array boundary".
      3. Fill the boundary with a regular grid at the measured panel step.

    Strategy B (no sample):
      Fall back to the automatic mask generator + aspect-ratio filter.
      Works best for CAD / plan drawings with clearly-outlined panels.

    Returns: { panels: [{ x, y, width, height, rotation, confidence }] }
    """
    if predictor is None or mask_generator is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")

    try:
        import cv2

        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_np = np.array(pil_image)
        img_h, img_w = image_np.shape[:2]

        print(f"\nSegment all panels — {img_w}x{img_h}  sample=({sample_x},{sample_y})")

        # ── STRATEGY A: sample-guided grid fill ──────────────────────────────
        if sample_x is not None and sample_y is not None:
            predictor.set_image(image_np)

            # SAM2 returns 3 masks at increasing scales: small / medium / large
            s_masks, s_scores, _ = predictor.predict(
                point_coords=np.array([[sample_x, sample_y]]),
                point_labels=np.array([1]),
                multimask_output=True,
            )

            # ── 1. Pick the smallest valid panel mask ─────────────────────
            # SAM2 multimask index 0 = finest, index 2 = coarsest.
            # Sort by area ascending and take the first mask that looks like
            # a single panel — this avoids picking row-of-panels masks.
            image_area = img_w * img_h
            best_mask_u8 = None
            best_dims    = None

            mask_candidates = sorted(
                zip(s_masks, s_scores),
                key=lambda ms: float(np.sum(ms[0]))
            )

            for m, sam_score in mask_candidates:
                m_u8 = m.astype(np.uint8)
                area = float(np.sum(m_u8))
                if area < image_area * 0.00005 or area > image_area * 0.02:
                    continue
                ctrs, _ = cv2.findContours(m_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if not ctrs:
                    continue
                lc = max(ctrs, key=cv2.contourArea)
                (cx_i, cy_i), (w_i, h_i), ang_i = cv2.minAreaRect(lc)
                if h_i > w_i:
                    w_i, h_i = h_i, w_i
                    ang_i += 90
                if h_i < 1:
                    continue
                aspect = w_i / h_i
                if not (1.2 <= aspect <= 6.0):
                    continue
                best_mask_u8 = m_u8
                best_dims    = (cx_i, cy_i, w_i, h_i, ang_i)
                print(f"  Selected mask area={area:.0f} aspect={aspect:.2f} sam_score={sam_score:.3f}")
                break

            if best_mask_u8 is None or best_dims is None:
                raise HTTPException(
                    status_code=400,
                    detail="No panel-like shape found at the sample point. "
                           "Try clicking directly on the centre of one panel."
                )

            cx0, cy0, pw, ph, rot_angle = best_dims
            while rot_angle >  0:   rot_angle -= 90
            while rot_angle <= -90: rot_angle += 90

            print(f"  Sample panel: ({cx0:.0f},{cy0:.0f})  {pw:.1f}×{ph:.1f}  {rot_angle:.1f}°")

            # ── 2. Array boundary via colour matching ─────────────────────
            #  Sample the panel's colour, find all similar pixels, close
            #  inter-panel gaps with morphology, then keep the connected
            #  component that contains the sample centre.
            panel_pixels = image_np[best_mask_u8 > 0]
            if len(panel_pixels) >= 10:
                mean_col = np.mean(panel_pixels, axis=0)
                std_col  = np.std (panel_pixels, axis=0)
                tolerance = np.maximum(std_col * 2.5, 30.0)

                diff    = np.abs(image_np.astype(np.float32) - mean_col)
                similar = np.all(diff <= tolerance, axis=2).astype(np.uint8)

                # Two-pass close: first bridge intra-row gaps, then inter-row gaps
                k1 = max(3, int(min(pw, ph) * 0.5))
                similar = cv2.morphologyEx(similar, cv2.MORPH_CLOSE,
                                           np.ones((k1, k1), np.uint8))
                k2 = max(5, int(max(pw, ph) * 1.3))
                similar = cv2.morphologyEx(similar, cv2.MORPH_CLOSE,
                                           np.ones((k2, k2), np.uint8))

                n_comp, labels = cv2.connectedComponents(similar)
                sample_label   = int(labels[int(cy0), int(cx0)])
                if sample_label > 0:
                    array_mask = (labels == sample_label).astype(np.uint8)
                else:
                    array_mask = similar   # fallback: all matched pixels
            else:
                # Fallback: SAM2 large mask + heavy dilation
                array_mask = s_masks[2].astype(np.uint8)
                k = max(5, int(max(pw, ph) * 2))
                array_mask = cv2.dilate(array_mask, np.ones((k, k), np.uint8), iterations=3)

            # Extra dilation to avoid clipping edge panels
            edge_k   = max(3, int(max(pw, ph) * 0.5))
            array_mask_d = cv2.dilate(array_mask, np.ones((edge_k, edge_k), np.uint8), iterations=1)

            print(f"  Array mask area: {np.sum(array_mask):,} px  (dilated: {np.sum(array_mask_d):,})")

            # ── 3. Fill array with regular grid ────────────────────────────
            angle_rad = math.radians(rot_angle)
            # Long axis (along panel row)
            lx, ly = math.cos(angle_rad), math.sin(angle_rad)
            # Short axis (across rows)
            sx_dir, sy_dir = -math.sin(angle_rad), math.cos(angle_rad)

            # Step = panel dimension + ~2.5 % gap
            step_long  = pw * 1.025   # panel width  + gap
            step_short = ph * 1.030   # panel height + gap

            # How many steps can we possibly need in each direction?
            diag = math.hypot(img_w, img_h)
            n_long  = int(diag / step_long)  + 2
            n_short = int(diag / step_short) + 2

            def point_in_mask(px, py):
                ix, iy = int(round(px)), int(round(py))
                if not (0 <= ix < img_w and 0 <= iy < img_h):
                    return False
                return array_mask_d[iy, ix] > 0

            def panel_fits(cx, cy):
                """Check 5 points: center + 4 inner corners at 70% half-dims."""
                if not point_in_mask(cx, cy):
                    return False
                for si in (-0.7, 0.7):
                    for sj in (-0.7, 0.7):
                        px2 = cx + si * (pw / 2) * lx + sj * (ph / 2) * sx_dir
                        py2 = cy + si * (pw / 2) * ly + sj * (ph / 2) * sy_dir
                        if not point_in_mask(px2, py2):
                            return False
                return True

            panels = []
            for i in range(-n_long, n_long + 1):
                for j in range(-n_short, n_short + 1):
                    cx = cx0 + i * step_long * lx  + j * step_short * sx_dir
                    cy = cy0 + i * step_long * ly  + j * step_short * sy_dir
                    if panel_fits(cx, cy):
                        panels.append({
                            "x": float(cx - pw / 2),
                            "y": float(cy - ph / 2),
                            "width":  float(pw),
                            "height": float(ph),
                            "rotation": float(rot_angle),
                            "confidence": 0.9,
                        })

            panels.sort(key=lambda p: (round(p["y"] / (ph * 0.5)) * ph * 0.5, p["x"]))
            print(f"  Grid fill → {len(panels)} panels")
            return JSONResponse(content={"panels": panels})

        # ── STRATEGY B: auto mask generator (works best for CAD drawings) ──
        all_masks = mask_generator.generate(image_np)
        print(f"  Auto-generated {len(all_masks)} masks")

        image_area = img_w * img_h
        min_area = image_area * 0.0003
        max_area = image_area * 0.12

        panels = []
        for mask_data in all_masks:
            area = mask_data["area"]
            if not (min_area <= area <= max_area):
                continue

            confidence = float(mask_data.get("predicted_iou", mask_data.get("stability_score", 0.5)))
            mask = mask_data["segmentation"].astype(np.uint8)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            largest = max(contours, key=cv2.contourArea)
            (cx, cy), (w, h), angle = cv2.minAreaRect(largest)
            if h > w:
                w, h = h, w
                angle += 90
            if h < 1:
                continue
            aspect = w / h
            if not (1.3 <= aspect <= 4.0):
                continue
            panels.append({
                "x": float(cx - w / 2),
                "y": float(cy - h / 2),
                "width": float(w),
                "height": float(h),
                "rotation": float(angle),
                "confidence": confidence,
            })

        panels.sort(key=lambda p: (round(p["y"] / 20) * 20, p["x"]))
        print(f"  Auto-mask filter → {len(panels)} panels")
        return JSONResponse(content={"panels": panels})

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Panel detection error: {str(e)}")


@app.post("/fill-panels-in-polygon")
async def fill_panels_in_polygon(
    image: UploadFile = File(...),
    polygon: str = Form(...),   # JSON: [[x, y], ...] in image pixel coords
    sample_x: float = Form(...),
    sample_y: float = Form(...),
):
    """
    Fill a user-defined polygon boundary with a regular panel grid.
    1. Detects the sample panel at (sample_x, sample_y) to measure size + rotation.
    2. Fills every grid position that fits inside the polygon with a panel.
    Returns: { panels: [{ x, y, width, height, rotation, confidence }] }
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")

    try:
        import cv2

        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_np = np.array(pil_image)
        img_h, img_w = image_np.shape[:2]

        poly_points = json.loads(polygon)   # [[x, y], ...]

        # ── 1. Rasterise polygon → mask ───────────────────────────────────
        poly_arr = np.array(poly_points, dtype=np.int32)
        poly_mask = np.zeros((img_h, img_w), dtype=np.uint8)
        cv2.fillPoly(poly_mask, [poly_arr], 1)
        print(f"\nFill panels: polygon area={np.sum(poly_mask):,} px  sample=({sample_x:.0f},{sample_y:.0f})")

        # ── 2. Detect sample panel ────────────────────────────────────────
        predictor.set_image(image_np)
        s_masks, s_scores, _ = predictor.predict(
            point_coords=np.array([[sample_x, sample_y]]),
            point_labels=np.array([1]),
            multimask_output=True,
        )

        image_area = img_w * img_h
        poly_area  = float(np.sum(poly_mask))

        # Upper bound: a single panel must be smaller than 25% of the polygon
        # and smaller than 2% of the total image — whichever is tighter.
        area_max = min(image_area * 0.02, poly_area * 0.25)
        area_min = image_area * 0.00005

        # SAM2 multimask: index 0 = finest/smallest, index 2 = coarsest/largest.
        # Sort by area ascending so we always prefer the smallest valid mask —
        # that is the most likely single-panel match.
        mask_candidates = sorted(
            zip(s_masks, s_scores),
            key=lambda ms: float(np.sum(ms[0]))
        )

        best_mask_u8 = None
        best_dims    = None

        for m, sam_score in mask_candidates:
            m_u8 = m.astype(np.uint8)
            area = float(np.sum(m_u8))
            if area < area_min or area > area_max:
                continue
            ctrs, _ = cv2.findContours(m_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not ctrs:
                continue
            lc = max(ctrs, key=cv2.contourArea)
            (cx_i, cy_i), (w_i, h_i), ang_i = cv2.minAreaRect(lc)
            if h_i > w_i:
                w_i, h_i = h_i, w_i
                ang_i += 90
            if h_i < 1:
                continue
            aspect = w_i / h_i
            if not (1.2 <= aspect <= 6.0):
                continue
            # Take the first (smallest) mask that looks like a panel
            best_mask_u8 = m_u8
            best_dims    = (cx_i, cy_i, w_i, h_i, ang_i)
            print(f"  Selected mask area={area:.0f} aspect={aspect:.2f} sam_score={sam_score:.3f}")
            break

        if best_dims is None:
            raise HTTPException(
                status_code=400,
                detail="No panel-like shape found at the sample point. "
                       "Try clicking the centre of one panel."
            )

        cx0, cy0, pw, ph, rot_angle = best_dims
        while rot_angle >  0:   rot_angle -= 90
        while rot_angle <= -90: rot_angle += 90
        print(f"  Sample panel: ({cx0:.0f},{cy0:.0f})  {pw:.1f}×{ph:.1f}  {rot_angle:.1f}°")

        # ── 3. Dilate polygon mask to avoid clipping edge panels ──────────
        edge_k = max(3, int(max(pw, ph) * 0.35))
        poly_mask_d = cv2.dilate(poly_mask, np.ones((edge_k, edge_k), np.uint8), iterations=1)

        # ── 4. Grid fill ──────────────────────────────────────────────────
        angle_rad = math.radians(rot_angle)
        lx,      ly      = math.cos(angle_rad),  math.sin(angle_rad)
        sx_dir,  sy_dir  = -math.sin(angle_rad), math.cos(angle_rad)
        step_long  = pw * 1.025
        step_short = ph * 1.030
        diag    = math.hypot(img_w, img_h)
        n_long  = int(diag / step_long)  + 2
        n_short = int(diag / step_short) + 2

        def in_mask(px, py):
            ix, iy = int(round(px)), int(round(py))
            return 0 <= ix < img_w and 0 <= iy < img_h and poly_mask_d[iy, ix] > 0

        def panel_fits(cx, cy):
            if not in_mask(cx, cy):
                return False
            for si in (-0.7, 0.7):
                for sj in (-0.7, 0.7):
                    if not in_mask(cx + si*(pw/2)*lx + sj*(ph/2)*sx_dir,
                                   cy + si*(pw/2)*ly + sj*(ph/2)*sy_dir):
                        return False
            return True

        panels = []
        for i in range(-n_long, n_long + 1):
            for j in range(-n_short, n_short + 1):
                cx = cx0 + i * step_long * lx  + j * step_short * sx_dir
                cy = cy0 + i * step_long * ly  + j * step_short * sy_dir
                if panel_fits(cx, cy):
                    panels.append({
                        "x":          float(cx - pw / 2),
                        "y":          float(cy - ph / 2),
                        "width":      float(pw),
                        "height":     float(ph),
                        "rotation":   float(rot_angle),
                        "confidence": 0.95,
                    })

        panels.sort(key=lambda p: (round(p["y"] / (ph * 0.5)) * ph * 0.5, p["x"]))
        print(f"  Grid fill → {len(panels)} panels")
        return JSONResponse(content={"panels": panels})

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Panel fill error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
