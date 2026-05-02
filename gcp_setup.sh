#!/bin/bash
# GCP one-time setup script for GRC Copilot
# Run this once before first deployment.
# Usage: ./gcp_setup.sh <project-id> <region>

set -euo pipefail

PROJECT_ID=${1:?"Usage: ./gcp_setup.sh <project-id> <region>"}
REGION=${2:-"us-central1"}
SA_NAME="grc-copilot-sa"
REPO_NAME="grc-copilot"

echo "Setting up GRC Copilot on GCP project: $PROJECT_ID (region: $REGION)"

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  identitytoolkit.googleapis.com

# Create Artifact Registry repository
echo "Creating Artifact Registry repo..."
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="GRC Copilot container images" || true

# Create service account
echo "Creating service account..."
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GRC Copilot Service Account" || true

SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# Grant permissions
echo "Granting IAM roles..."
for ROLE in \
  roles/aiplatform.user \
  roles/secretmanager.secretAccessor \
  roles/cloudsql.client \
  roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE"
done

# Create Cloud SQL user (fill in password after)
echo ""
echo "NOTE: Create a Cloud SQL user after this script finishes:"
echo "  gcloud sql users create grccopilot --instance=grc-copilot-db --password=PICK_A_STRONG_PASSWORD"
echo ""

# Create secrets (placeholders — fill in values after)
echo "Creating Secret Manager secrets..."
for SECRET in anthropic-api-key nvd-api-key db-url session-secret firebase-api-key; do
  gcloud secrets create "$SECRET" --replication-policy="automatic" || true
  echo "  Created secret: $SECRET"
done
echo ""
echo "Fill in secret values:"
echo "  echo -n 'sk-ant-...'   | gcloud secrets versions add anthropic-api-key --data-file=-"
echo "  echo -n 'your-nvd-key' | gcloud secrets versions add nvd-api-key --data-file=-"
echo "  echo -n 'postgresql://...' | gcloud secrets versions add db-url --data-file=-"
echo "  openssl rand -base64 32 | gcloud secrets versions add session-secret --data-file=-"
echo "  echo -n 'YOUR_FIREBASE_API_KEY' | gcloud secrets versions add firebase-api-key --data-file=-"

# Create Cloud SQL PostgreSQL instance
echo "Creating Cloud SQL instance (this takes ~5 minutes)..."
gcloud sql instances create grc-copilot-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-auto-increase || true

gcloud sql databases create grccopilot --instance=grc-copilot-db || true

echo ""
echo "Setup complete. Next steps:"
echo "  1. Add secret values:"
echo "       echo -n 'sk-ant-...' | gcloud secrets versions add anthropic-api-key --data-file=-"
echo "       echo -n 'your-nvd-key' | gcloud secrets versions add nvd-api-key --data-file=-"
echo "       echo -n 'postgresql://...' | gcloud secrets versions add db-url --data-file=-"
echo ""
echo "  2. Connect Cloud Build to your GitHub repo in the GCP Console"
echo "     (Cloud Build > Triggers > Connect Repository)"
echo ""
echo "  3. Push to main branch to trigger first deployment"
