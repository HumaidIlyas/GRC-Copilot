#!/bin/bash
# First-time setup for GRC Copilot backend

echo "1. Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "2. Installing dependencies..."
pip install -r requirements.txt

echo "3. Copying env file..."
cp .env.example .env
echo "   -> Edit .env and add your ANTHROPIC_API_KEY"

echo "4. Downloading NIST 800-53 OSCAL catalog..."
curl -L \
  "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json" \
  -o oscal/nist-800-53-rev5-catalog.json

echo ""
echo "Setup complete. To start the backend:"
echo "  source venv/bin/activate"
echo "  uvicorn main:app --reload"
