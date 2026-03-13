# High-Resolution Imagery Setup Guide

## Overview
MyGreenPlanner supports multiple satellite imagery providers. Higher resolution requires API keys from commercial providers.

## Recommended Providers (in order of quality)

### 1. Google Maps Satellite ⭐ BEST
**Resolution**: Up to zoom level 22 (very high detail)
**Cost**: Free tier available (25,000 map loads/month)
**Setup**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable "Maps JavaScript API"
4. Create credentials (API Key)
5. Add to `.env`: `VITE_GOOGLE_MAPS_API_KEY=your_key_here`

**Pricing after free tier**: ~$7 per 1,000 additional loads

### 2. Bing Maps Aerial ⭐ GREAT
**Resolution**: Up to zoom level 21 (high detail)
**Cost**: Free tier available (125,000 transactions/year)
**Setup**:
1. Go to [Bing Maps Dev Center](https://www.bingmapsportal.com/)
2. Sign in with Microsoft account
3. Create a new key
4. Add to `.env`: `VITE_BING_MAPS_API_KEY=your_key_here`

**Pricing after free tier**: Enterprise pricing

### 3. Mapbox Satellite ⭐ GOOD
**Resolution**: Up to zoom level 22
**Cost**: Free tier (50,000 map loads/month)
**Setup**:
1. Go to [Mapbox](https://www.mapbox.com/)
2. Create account
3. Get your default public token
4. Add to `.env`: `VITE_MAPBOX_API_KEY=your_key_here`

**Pricing after free tier**: $5 per 1,000 additional loads

### 4. Esri World Imagery (Current Default)
**Resolution**: Up to zoom level 19 (moderate detail)
**Cost**: FREE, no API key needed
**Quality**: Good for overview, not ideal for detailed roof identification

## Professional Options (High Cost)

### Nearmap
- Ultra-high resolution (5-7cm per pixel)
- Frequent updates
- Commercial subscription required
- Best for professional solar planning
- Contact sales for pricing

### Maxar/DigitalGlobe
- Professional satellite imagery
- 30-50cm resolution
- Enterprise only

## Recommended Configuration

For **best results** with MyGreenPlanner:

1. **Start with Google Maps** (best balance of quality and cost)
   - Free tier is usually sufficient for small-scale use
   - Excellent resolution for roof identification

2. **Fallback to Bing** (if Google quota exceeded)
   - Similar quality
   - Different free tier limits

3. **Use Mapbox** as secondary option

## Setup Instructions

1. Create `.env` file in project root:
```bash
cp .env.example .env
```

2. Edit `.env` and add your API keys:
```env
VITE_GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_KEY_HERE
VITE_BING_MAPS_API_KEY=YOUR_BING_KEY_HERE
VITE_MAPBOX_API_KEY=YOUR_MAPBOX_KEY_HERE
VITE_BACKEND_URL=http://localhost:8000
```

3. Restart the dev server:
```bash
npm run dev
```

4. Click the satellite button in the app to cycle through sources

## Tips for Best Results

1. **Zoom Level**: Use zoom 20-22 for roof identification
2. **Switch Sources**: Different providers have different imagery dates - try multiple sources
3. **Time of Day**: Some providers have better lighting in their imagery
4. **Cloud Coverage**: If one source has clouds, try another

## Cost Comparison (Monthly)

For a small solar planning business handling ~100 projects/month:

| Provider | Estimated Cost |
|----------|---------------|
| Google Maps | $0 (within free tier) |
| Bing Maps | $0 (within free tier) |
| Mapbox | $0 (within free tier) |
| Nearmap | $500-2000/month |

## Current Implementation

The app now cycles through sources in this order:
1. Google (zoom 22) - requires key
2. Bing (zoom 21) - requires key  
3. Mapbox (zoom 22) - requires key
4. Esri (zoom 19) - no key needed

Default tile source is **Google** for best quality.
