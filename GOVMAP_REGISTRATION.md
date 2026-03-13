# GovMap Registration Guide

GovMap provides the highest resolution aerial imagery for Israel (10-15cm), making it ideal for precise solar panel planning applications.

## Registration Steps

### Option 1: Online Registration

1. **Visit GovMap Portal**
   - Main site: https://www.govmap.gov.il/
   - API Portal: https://api.govmap.gov.il/ (if available)
   
2. **Find Developer/API Section**
   - Look for "API" or "מפתחים" (Developers) in the menu
   - May be under "Services" → "API Access"
   
3. **Complete Registration Form**
   - Organization name and details
   - Contact information
   - Application description: "Solar PV roof planning application"
   - Expected usage volume
   - Type of imagery needed: Orthophoto tiles

### Option 2: Direct Contact

If online registration is not available or you need enterprise access:

**Email:** support@govmap.gov.il or api@govmap.gov.il

**Subject:** Request for Orthophoto Tile API Access

**Template Email:**
```
שלום / Hello,

I am developing a solar PV roof planning application for the Israeli market 
and would like to request API access to GovMap's orthophoto tile service.

Application Details:
- Purpose: Solar panel placement planning for rooftops
- Technology: Web application (PWA)
- Expected usage: [Estimate: e.g., 1000-5000 tile requests per month]
- Geographic focus: Israel

Could you please provide:
1. API access credentials/token
2. Tile service endpoint URL format
3. Usage limits and pricing (if applicable)
4. Technical documentation

Thank you,
[Your Name]
[Organization]
[Contact Information]
```

**Phone Support:**
- Check the GovMap website footer for current contact numbers
- Ministry of Defense mapping services may also have contact info

### Option 3: Survey of Israel

GovMap is operated by the Survey of Israel. You can contact them directly:

**Survey of Israel (מדידות ישראל)**
- Website: https://www.mapi.gov.il/
- They handle official mapping data licensing
- May require a formal data licensing agreement for commercial use

## After Receiving API Key

### 1. Add to Environment Variables

Create or update your `.env` file:

```bash
VITE_GOVMAP_API_KEY=your_actual_api_key_here
```

### 2. Test the Integration

Once added, restart your development server:

```bash
npm run dev
```

Then in the app:
1. Click the satellite imagery button to cycle sources
2. When "🇮🇱 GovMap (Z22)" appears, you should see high-resolution imagery
3. If you still see a warning message, check that the API key is correctly added

### 3. Verify API Key Format

The API key might be used in different ways:
- **Query parameter:** `?token=YOUR_KEY` or `?api_key=YOUR_KEY`
- **Header:** May need to be sent as an HTTP header
- **Path parameter:** Might be part of the URL path

The current implementation uses a query parameter. If it doesn't work, contact GovMap support for the correct format.

## Alternative High-Resolution Sources

While waiting for GovMap access, these sources work without registration:

1. **Google Satellite (Current default)** - Zoom 22, ~30-50cm resolution in Israel
2. **Mapbox Satellite** - Zoom 22, similar quality to Google
3. **Esri World Imagery** - Zoom 19, good coverage

## Usage Tips

- GovMap imagery is optimized for Israel and provides the best detail for roof identification
- The orthophoto layer is updated regularly (typically annually)
- For commercial applications, ensure you understand licensing terms
- Keep your API key secure - never commit it to public repositories

## Troubleshooting

**401 Unauthorized Error:**
- API key is missing or incorrect
- Check `.env` file exists and has correct format
- Restart development server after adding key
- Verify key hasn't expired

**403 Forbidden Error:**
- Usage limits exceeded
- IP address not whitelisted (if required)
- Contact GovMap support

**Tiles Not Loading:**
- Check browser console for specific error messages
- Verify URL format matches GovMap documentation
- Test with a different zoom level (try zoom 16-20)

**Image Quality Still Low:**
- Ensure you're viewing at zoom level 20-22
- GovMap may have limited coverage in some areas
- Switch to Google/Mapbox to compare

## Contact Information

- **GovMap Support:** support@govmap.gov.il
- **Survey of Israel:** https://www.mapi.gov.il/
- **Israeli Geoportal:** https://www.geoportal.gov.il/

## Additional Resources

- GovMap API Documentation (request from support)
- Survey of Israel Data Catalog
- Israeli Government Geospatial Portal

---

**Note:** As of March 2026, GovMap API access procedures may have changed. Always check their official website for the most current registration process.
