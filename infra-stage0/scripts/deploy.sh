#!/usr/bin/env bash
# Stage 0 deployment script.
# NOTE: location is westus2 - Central US and East US both had zero App
# Service quota on this subscription, confirmed via direct testing. If you
# hit SubscriptionIsOverQuotaForSku again in a new environment, test the
# region directly with `az appservice plan create --sku B1 --is-linux`
# before assuming it's a code/config problem.
#
# Usage: ./deploy.sh dev

set -euo pipefail

ENVIRONMENT="${1:-}"
if [[ -z "$ENVIRONMENT" ]]; then
  echo "Usage: $0 <dev|test|prod>"
  exit 1
fi

RESOURCE_GROUP="rg-mvta-onboard-${ENVIRONMENT}"
LOCATION="westus2"

echo "== Stage 0 deployment: ${ENVIRONMENT} =="
echo ""
echo "Step 1: Creating resource group (if it doesn't already exist)..."
az deployment sub create \
  --location "$LOCATION" \
  --template-file bootstrap.bicep \
  --parameters environment="$ENVIRONMENT" location="$LOCATION"

echo ""
echo "Step 2: Enter the SQL admin password for this environment."
read -rs -p "SQL admin password: " SQL_ADMIN_PASSWORD
echo ""

echo ""
echo "Step 3: Deploying core resources (network, monitoring, Key Vault, SQL, private DNS)..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file main.bicep \
  --parameters "parameters/${ENVIRONMENT}.parameters.json" \
  --parameters sqlAdminPassword="$SQL_ADMIN_PASSWORD"

echo ""
echo "== Stage 0 deployment for ${ENVIRONMENT} complete =="
