FROM python:3.12-slim

WORKDIR /app

# Install system deps for pypdf / python-docx
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake OSCAL catalog into image — .gcloudignore excludes local JSON files
RUN curl -fsSL \
  "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json" \
  -o oscal/NIST_SP-800-53_rev5_catalog.json

# Cloud Run sets PORT env var; default to 8080
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
