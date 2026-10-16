#!/usr/bin/env bash
# Stage 0 deployment script.
# NOTE: location is westus2 - Central US and East US both had zero App
# Service quota on this subscription, confirmed via direct testing. If you
# hit SubscriptionIsOverQuotaForSku again in a new environment, test the
# region directly with `az appservice plan create --sku B1 --is-linux`
# before assuming it's a code/config problem.
#
# Usage: ./deploy.sh dev
#        ./deploy.sh prod --first-provision
#
# --first-provision is for the first deploy of a new environment only. It asks
# for a NEW SQL admin password (twice) and writes the sql-connection-string
# secret to Key Vault. Every later run leaves that secret alone, so a routine
# redeploy can never rotate the credential the apps are using.

set -euo pipefail

ENVIRONMENT="${1:-}"
MODE="${2:-}"
if [[ -z "$ENVIRONMENT" || ( -n "$MODE" && "$MODE" != "--first-provision" ) ]]; then
  echo "Usage: $0 <dev|test|prod> [--first-provision]"
  exit 1
fi

FIRST_PROVISION=false
if [[ "$MODE" == "--first-provision" ]]; then
  FIRST_PROVISION=true
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
if [[ "$FIRST_PROVISION" == true ]]; then
  echo "Step 2: FIRST PROVISION. Choose a NEW SQL admin password for ${ENVIRONMENT}"
  echo "and store it in the password manager before continuing."
  read -rs -p "New SQL admin password: " SQL_ADMIN_PASSWORD
  echo ""
  read -rs -p "Repeat it: " SQL_ADMIN_PASSWORD_AGAIN
  echo ""
  if [[ "$SQL_ADMIN_PASSWORD" != "$SQL_ADMIN_PASSWORD_AGAIN" ]]; then
    echo "The passwords do not match. Nothing was deployed."
    exit 1
  fi
else
  echo "Step 2: Enter the existing SQL admin password for this environment."
  echo "Do not enter a new password here. Use scripts/rotate-sql-credentials.sh for intentional rotation."
  read -rs -p "SQL admin password: " SQL_ADMIN_PASSWORD
  echo ""
fi

echo ""
echo "Step 3: Deploying core resources (network, monitoring, Key Vault, SQL, private DNS)..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file main.bicep \
  --parameters "parameters/${ENVIRONMENT}.parameters.json" \
  --parameters sqlAdminPassword="$SQL_ADMIN_PASSWORD" \
  --parameters manageSqlConnectionStringSecret="$FIRST_PROVISION"

echo ""
echo "== Stage 0 deployment for ${ENVIRONMENT} complete =="
