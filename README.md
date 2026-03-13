# MyGreenPlanner 🌱

Solar PV Roof Planning Application - A Progressive Web App for identifying roofs and planning solar panel installations.

## Overview
MyGreenPlanner helps plan solar panel installations on rooftops. Users can identify roofs on high-resolution satellite maps, and the app uses SAM2 (Segment Anything Model 2) to automatically generate roof polygons for optimal solar panel placement planning.

## Features

### Phase 1 - Roof Identification ✅ (Current)
- ✅ Interactive satellite map with multiple tile sources
- ✅ High-resolution imagery (Google, Esri, OSM)
- ✅ Click to identify roof location  
- ✅ Geolocation support
- ✅ SAM2 backend API ready for integration
- ✅ GeoJSON output format

### Phase 2 - Solar Panel Planning (Upcoming)
- Automatic solar panel placement optimization
- Custom placement logic
- Area calculations
- Export capabilities

## Technology Stack

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Mapping**: Leaflet + React-Leaflet
- **PWA**: vite-plugin-pwa
- **Tile Sources**: Google Satellite, Esri World Imagery, OpenStreetMap

### Backend
- **Framework**: FastAPI (Python)
- **AI Model**: SAM2 (Segment Anything Model 2)
- **Image Processing**: OpenCV, Pillow, NumPy
- **ML Framework**: PyTorch

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.9+ and pip
- (Optional) Google Maps API key for highest resolution tiles

### Frontend Setup

1. **Install dependencies**
```bash
npm install
```

2. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` and add your API keys (optional):
```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_BACKEND_URL=http://localhost:8000
```

3. **Start development server**
```bash
npm run dev
```

Access at: http://localhost:5173

### Backend Setup

1. **Navigate to backend directory**
```bash
cd backend
```

2. **Create virtual environment**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**
```bash
pip install -r requirements.txt
```

4. **Download SAM2 model**

Download the SAM2 checkpoint from:
https://github.com/facebookresearch/segment-anything-2

Place it in:
```
backend/checkpoints/sam2_hiera_large.pt
```

5. **Run the backend server**
```bash
python app.py
```

Backend will run at: http://localhost:8000

## Map Tile Sources

The app supports multiple high-resolution satellite imagery sources, **optimized for the Israeli market**:

### Israeli Sources (Recommended) 🇮🇱
1. **GovMap** (Default) - No API key required ⭐ BEST
   - Max zoom: 22
   - Resolution: 10-15cm per pixel
   - FREE Israeli government orthophoto
   - Highest quality for Israel

2. **Mapi (Survey of Israel)** - No API key required
   - Max zoom: 20
   - Resolution: 20-50cm per pixel  
   - Official Israeli mapping authority

### Global Sources
3. **Google Satellite** - Works without API key (rate limited)
   - Max zoom: 22
   - Resolution: 30-50cm in Israel
   - Good fallback option

4. **Mapbox Satellite** - Works with demo token
   - Max zoom: 22
   - Similar to Google in Israel

5. **Esri World Imagery** - No API key required
   - Max zoom: 19
   - Lower resolution fallback

Click the tile source button to cycle: **GovMap → Mapi → Google → Mapbox → Esri**

See [ISRAELI_GIS_GUIDE.md](ISRAELI_GIS_GUIDE.md) for detailed Israeli GIS information.

## Usage

1. **Open the app** and allow location access (optional)
2. **Navigate** to your target location using the map
3. **Zoom in** to roof level (zoom 20+ recommended)
4. **Click** on a roof to identify it
5. **Wait** for SAM2 to process and generate the roof polygon
6. **Review** the generated polygon and proceed to solar panel planning

## Project Structure
```
MyGreenPlanner/
├── src/
│   ├── components/
│   │   ├── RoofMapper.jsx      # Main map component
│   │   └── RoofMapper.css
│   ├── services/
│   │   └── sam2Service.js      # SAM2 backend integration
│   ├── App.jsx                 # Main app component
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── backend/
│   ├── app.py                  # FastAPI server
│   ├── requirements.txt
│   ├── checkpoints/            # SAM2 model files
│   └── README.md
├── index.html
├── vite.config.js
└── package.json
```

## API Endpoints

### Backend API

**Health Check**
```
GET http://localhost:8000/
```

**Segment Roof (Geographic Coordinates)**
```
POST http://localhost:8000/segment-roof-coordinates
Content-Type: multipart/form-data

Parameters:
- image: Image file (map tile)
- lat: Latitude of clicked point
- lng: Longitude of clicked point  
- bounds: JSON string of map bounds

Returns: GeoJSON Feature with Polygon
```

## Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Test Backend
```bash
curl http://localhost:8000/
```

## Troubleshooting

**Low resolution tiles?**
- Switch to Google Satellite tiles (requires API key)
- Zoom in closer (level 20+)
- Check your internet connection

**Backend not connecting?**
- Ensure Python backend is running on port 8000
- Check VITE_BACKEND_URL in .env
- Verify CORS settings in backend/app.py

**SAM2 model not loading?**
- Download the correct SAM2 checkpoint file
- Place in backend/checkpoints/ directory
- Check Python dependencies are installed

## Next Steps
1. ✅ High-resolution satellite imagery
2. ✅ SAM2 backend API
3. 🔄 Complete frontend-backend integration
4. ⏳ Implement map tile capture
5. ⏳ Add solar panel placement logic
6. ⏳ Export functionality

## License
MIT

## Contributing
Contributions welcome! Please open an issue or PR.
