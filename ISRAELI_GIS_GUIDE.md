# Israeli High-Resolution Imagery for Solar PV Planning

## Overview
For the Israeli market, there are specialized GIS sources that provide significantly better resolution than global providers like Google Maps. This guide covers Israeli-specific imagery options optimized for solar panel planning.

## Israeli GIS Sources (Recommended)

### 1. GovMap (ממשל - מפות) ⭐ BEST FOR ISRAEL
**Provider**: Israeli Government / Survey of Israel  
**Resolution**: 10-15cm per pixel (significantly better than Google)  
**Zoom Level**: Up to 22  
**Coverage**: Excellent coverage across Israel  
**Updates**: Regular updates, recent imagery  
**Cost**: FREE - No API key required  
**Quality**: Highest resolution available for Israel  

**Use Case**: Primary choice for Israeli solar PV projects  
**URL**: https://www.govmap.gov.il/

**Pros**:
- ✅ Best resolution for Israel (10-15cm)
- ✅ Official government source
- ✅ Free and unrestricted
- ✅ Regularly updated
- ✅ Excellent for urban areas
- ✅ Perfect for roof identification

**Cons**:
- ❌ Israel-only coverage
- ❌ May have occasional gaps in remote areas

### 2. Survey of Israel (מדידות ישראל / Mapi) ⭐ EXCELLENT
**Provider**: Survey of Israel  
**Resolution**: 20-50cm per pixel  
**Zoom Level**: Up to 20  
**Coverage**: Complete Israel coverage  
**Cost**: FREE for most uses  
**Quality**: Very high quality, official source  

**Use Case**: Backup to GovMap, excellent quality throughout Israel  
**URL**: https://www.mapi.gov.il/

**Pros**:
- ✅ Official government mapping authority
- ✅ High accuracy and quality
- ✅ Free for public use
- ✅ Complete country coverage
- ✅ Reliable and stable

**Cons**:
- ❌ Slightly lower resolution than GovMap
- ❌ Israel-only

### 3. Municipal GIS Systems
Many Israeli municipalities provide their own high-resolution orthophotos:

**Tel Aviv-Yafo**: Up to 5cm resolution in some areas  
**Jerusalem**: High-resolution municipal GIS  
**Haifa**: Municipal orthophoto system  
**Be'er Sheva**: City GIS portal  

**Access**: Usually through municipal websites or by request

## Global Providers Comparison (for Israel)

### Google Maps Satellite
**Resolution in Israel**: 30-50cm per pixel  
**Zoom**: Up to 22  
**Quality**: Good but not sufficient for detailed roof analysis  
**Cost**: Free tier available  

**Issue for Israel**: Lower resolution than Israeli sources

### Mapbox Satellite
**Resolution in Israel**: Similar to Google (30-60cm)  
**Zoom**: Up to 22  
**Cost**: Free tier available  

**Issue**: Not specialized for Israel, lower quality

### Esri World Imagery
**Resolution in Israel**: 1-2m per pixel  
**Zoom**: Up to 19  
**Quality**: Lowest resolution  

**Issue**: Not suitable for detailed roof planning

## Resolution Comparison Table

| Source | Resolution (Israel) | Zoom Level | Cost | Best For |
|--------|-------------------|------------|------|----------|
| **GovMap** | 10-15cm | 22 | FREE | ⭐ Solar PV Planning |
| **Mapi** | 20-50cm | 20 | FREE | ✅ General Planning |
| Municipal GIS | 5-15cm | Varies | Usually FREE | ⭐ City Projects |
| Google Maps | 30-50cm | 22 | Free/Paid | ❌ Not recommended |
| Mapbox | 30-60cm | 22 | Free/Paid | ❌ Not recommended |
| Esri | 1-2m | 19 | FREE | ❌ Too low |

## Recommended Setup for Israeli Solar Projects

### Primary Workflow:
1. **Use GovMap** as default (10-15cm resolution)
2. **Fallback to Mapi** if GovMap unavailable
3. **Check Municipal GIS** for city-specific projects
4. **Use image upload** for custom high-res imagery

### Configuration in MyGreenPlanner:

The app now defaults to **GovMap** for Israeli projects and provides easy switching between sources.

**Tile Source Cycle**:
- GovMap (🇮🇱) → Mapi (🇮🇱) → Google → Mapbox → Esri

## Professional Israeli GIS Options

### For Commercial Solar Planning Companies:

**1. MAPI Commercial Services**
- Contact: Survey of Israel
- Ultra-high resolution imagery
- Custom orthophoto generation
- Professional license required
- Cost: Contact for pricing

**2. Ofek Aerial Imaging**
- Israeli aerial photography company
- Custom mission flights
- 5-10cm resolution
- Cost: Project-based pricing

**3. ImageSat International**
- Satellite imagery provider
- 50cm resolution
- Regular updates
- Cost: Subscription-based

**4. Rafael/RSIS**
- High-resolution satellite imagery
- Israeli defense industry source
- Premium quality
- Cost: Enterprise only

## Data Sources & APIs

### GovMap API
- REST API available
- Documentation (Hebrew): https://api.govmap.gov.il/
- Free for non-commercial use
- Can integrate directly into applications

### Survey of Israel WMS
- WMS/WMTS services available
- Official documentation on Mapi website
- Free for public services

## Legal Considerations

### Israeli Mapping Restrictions:
- Survey of Israel regulates official mapping
- Some military/sensitive areas may be restricted
- Commercial use may require licensing
- Always check current regulations

### Data Usage:
- GovMap: Free for public/non-commercial use
- Mapi: Free with attribution
- Municipal GIS: Check specific municipality terms
- Commercial providers: License required

## Recommendations by Project Type

### Residential Solar (1-10 roofs):
- **Primary**: GovMap (free, excellent quality)
- **Backup**: Mapi or image upload
- **Budget**: $0

### Commercial Solar (10-100 roofs):
- **Primary**: GovMap + Municipal GIS
- **Backup**: Mapi
- **Consider**: Ofek for custom flights
- **Budget**: $0-$5,000 for custom imagery

### Utility-Scale Solar:
- **Primary**: Professional aerial survey
- **Backup**: GovMap for initial assessment
- **Recommended**: ImageSat or custom flights
- **Budget**: $10,000-$50,000+

## Technical Setup

### Using GovMap in MyGreenPlanner:

Already configured! The app defaults to GovMap tiles:
```javascript
url: 'https://tiles.govmap.gov.il/orthophoto/{z}/{x}/{y}'
```

### No API Key Required!
GovMap works out of the box with no registration needed.

## Best Practices

1. **Always start with GovMap** for Israeli projects
2. **Verify imagery date** - check when photos were taken
3. **Compare multiple sources** - switch between GovMap and Mapi
4. **Use image upload** for client-provided high-res photos
5. **Check municipal sites** for city-specific projects
6. **Consider custom flights** for large commercial projects

## Support & Resources

- **GovMap Support**: https://www.govmap.gov.il/
- **Survey of Israel**: https://www.mapi.gov.il/
- **Developer API Docs**: https://api.govmap.gov.il/

## Summary

For Israeli solar PV planning:
- ✅ **GovMap** is now your default (10-15cm resolution)
- ✅ **FREE** and no API key needed
- ✅ **Better than Google** by 2-3x resolution
- ✅ **Perfect for roof identification**
- ✅ Built into MyGreenPlanner by default

Switch between sources using the satellite button to compare different imagery dates and sources!
