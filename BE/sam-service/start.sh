#!/bin/bash
# Start script for MyGreenPlanner Backend

echo "🌱 Starting MyGreenPlanner Backend..."

# Activate virtual environment
if [ -d "venv" ]; then
    source venv/bin/activate
    echo "✅ Virtual environment activated"
else
    echo "❌ Virtual environment not found. Run ./setup.sh first"
    exit 1
fi

# Check if checkpoint exists
if [ ! -f "checkpoints/sam2_hiera_large.pt" ]; then
    echo "⚠️  Warning: SAM2 checkpoint not found"
    echo "Run ./setup.sh to download the model"
fi

# Start the server
echo "🚀 Starting FastAPI server on http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

uvicorn app:app --host 0.0.0.0 --port 8000 --reload
