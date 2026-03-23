#!/bin/bash

echo "🌱 MyGreenPlanner Setup Script"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Setup frontend
echo "📦 Setting up frontend..."
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "✅ Frontend dependencies already installed"
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your API keys if needed"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🐍 Setting up Python backend..."
cd backend

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Create checkpoints directory
if [ ! -d "checkpoints" ]; then
    mkdir -p checkpoints
    echo "📁 Created checkpoints directory"
fi

# Check for SAM2 checkpoint
if [ ! -f "checkpoints/sam2_hiera_large.pt" ]; then
    echo ""
    echo "⚠️  SAM2 model checkpoint not found!"
    echo "📥 Please download it from:"
    echo "   https://github.com/facebookresearch/segment-anything-2"
    echo "   and place it in: backend/checkpoints/sam2_hiera_large.pt"
else
    echo "✅ SAM2 checkpoint found"
fi

cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. (Optional) Edit .env and add your Google Maps API key for best resolution"
echo "   2. Download SAM2 model if not already done"
echo "   3. Start the frontend: npm run dev"
echo "   4. Start the backend: cd backend && source venv/bin/activate && python app.py"
echo ""
echo "🚀 Happy planning!"
