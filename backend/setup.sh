#!/bin/bash
# Setup script for MyGreenPlanner Backend

set -e  # Exit on error

echo "🌱 MyGreenPlanner Backend Setup"
echo "================================"
echo ""

# Check Python version
echo "📋 Checking Python version..."
python3 --version

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "🔧 Creating virtual environment..."
    python3 -m venv venv
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️  Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📦 Installing Python dependencies..."
echo "   This may take several minutes..."
pip install -r requirements.txt

# Create checkpoints directory
echo "📁 Creating checkpoints directory..."
mkdir -p checkpoints

# Download SAM2 model
CHECKPOINT_FILE="checkpoints/sam2_hiera_large.pt"

if [ -f "$CHECKPOINT_FILE" ]; then
    echo "✅ SAM2 checkpoint already exists at $CHECKPOINT_FILE"
else
    echo "⬇️  Downloading SAM2 model checkpoint..."
    echo "   This is a large file (~900MB), please be patient..."
    
    # SAM2 model download URL
    # Note: Replace with actual URL from Facebook Research
    MODEL_URL="https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt"
    
    curl -L "$MODEL_URL" -o "$CHECKPOINT_FILE"
    
    if [ -f "$CHECKPOINT_FILE" ]; then
        echo "✅ Model downloaded successfully!"
    else
        echo "❌ Failed to download model"
        echo "Please download manually from:"
        echo "https://github.com/facebookresearch/segment-anything-2"
        exit 1
    fi
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the backend server:"
echo "  1. source venv/bin/activate"
echo "  2. python app.py"
echo ""
echo "Or simply run:"
echo "  ./start.sh"
echo ""
