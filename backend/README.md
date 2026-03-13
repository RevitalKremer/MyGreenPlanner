# MyGreenPlanner Backend

FastAPI backend for roof segmentation using SAM2 (Segment Anything Model 2).

## Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Download SAM2 Model

Download the SAM2 checkpoint from the official repository:
https://github.com/facebookresearch/segment-anything-2

Place the checkpoint in:
```
backend/checkpoints/sam2_hiera_large.pt
```

### 3. Run the Server

```bash
python app.py
```

Or with uvicorn:
```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### Health Check
```
GET /
```

### Segment Roof (Pixel Coordinates)
```
POST /segment-roof
Content-Type: multipart/form-data

Parameters:
- image: Image file
- point_x: X coordinate (pixels)
- point_y: Y coordinate (pixels)

Returns: GeoJSON polygon
```

### Segment Roof (Geographic Coordinates)
```
POST /segment-roof-coordinates
Content-Type: multipart/form-data

Parameters:
- image: Image file
- lat: Latitude
- lng: Longitude
- bounds: JSON string of map bounds

Returns: GeoJSON polygon with geographic coordinates
```

## Testing

Test with curl:
```bash
curl -X POST "http://localhost:8000/segment-roof" \
  -F "image=@test_image.jpg" \
  -F "point_x=100" \
  -F "point_y=150"
```
