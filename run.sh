#!/bin/bash
# AgriBridge — Start Script
# Run this file to start the server:
#   bash run.sh

echo "========================================"
echo "  🌿 AgriBridge Server"
echo "  Uganda Farm-to-Table Platform"
echo "========================================"
echo ""
echo "  Checking Python..."
python3 --version

echo ""
echo "  Checking Flask..."
python3 -c "import flask; print('  Flask OK')" 2>/dev/null || {
    echo "  Flask not found. Installing..."
    pip3 install flask
}

echo ""
echo "  Starting server..."
echo "  Website will open at: http://localhost:5000"
echo ""
python3 app.py
