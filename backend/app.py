import os
import io
import json
import math
import base64
import requests
from typing import List, Dict, Any
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import numpy as np
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

app = FastAPI(title="MyGreenPlanner API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global predictor instance
predictor = None
device = "cuda" if torch.cuda.is_available() else "cpu"

def load_sam2_model():
    """Load SAM2 model on startup"""
    global predictor
    
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
        "model_loaded": predictor is not None,
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
