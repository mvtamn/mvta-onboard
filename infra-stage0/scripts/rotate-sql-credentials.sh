#!/usr/bin/env bash
# Rotate the SQL administrator password and the app's Key Vault connection
# string together. Run only when an intentional credential rotation is needed.
set -euo pipefail

ENVIRONMENT="${1:-dev}"
RESOURCE_GROUP="rg-mvta-onboard-${ENVIRONMENT}"
KEY_VAULT="$(az keyvault list --resource-group "$RESOURCE_GROUP" --query '[0].name' -o tsv)"
SQL_SERVER="$(az sql server list --resource-group "$RESOURCE_GROUP" --query '[0].name' -o tsv)"
SQL_DATABASE="sqldb-mvta-onboard-${ENVIRONMENT}"
SQL_LOGIN="mvtaonboardadmin"

if [[ -z "$KEY_VAULT" || -z "$SQL_SERVER" ]]; then
  echo "Could not find the Key Vault or SQL server in $RESOURCE_GROUP" >&2
  exit 1
fi

read -rs -p "New SQL password: " NEW_PASSWORD
echo
read -rs -p "Repeat new SQL password: " CONFIRM_PASSWORD
echo
[[ "$NEW_PASSWORD" == "$CONFIRM_PASSWORD" ]] || { echo "Passwords do not match" >&2; exit 1; }
[[ -n "$NEW_PASSWORD" ]] || { echo "Password cannot be empty" >&2; exit 1; }

echo "Updating SQL administrator password..."
az sql server update --resource-group "$RESOURCE_GROUP" --name "$SQL_SERVER" --admin-password "$NEW_PASSWORD" --output none

CONNECTION_STRING="Server=tcp:${SQL_SERVER}.database.windows.net,1433;Database=${SQL_DATABASE};User ID=${SQL_LOGIN};Password=${NEW_PASSWORD};Encrypt=true;TrustServerCertificate=false;"
echo "Updating Key Vault secret..."
az keyvault secret set --vault-name "$KEY_VAULT" --name sql-connection-string --value "$CONNECTION_STRING" --output none

for APP in "func-mvta-restapi-${ENVIRONMENT}" "func-mvta-dispatch-${ENVIRONMENT}"; do
  if az functionapp show --resource-group "$RESOURCE_GROUP" --name "$APP" --query name -o tsv >/dev/null 2>&1; then
    echo "Restarting $APP..."
    az functionapp restart --resource-group "$RESOURCE_GROUP" --name "$APP"
  fi
done

echo "SQL password and Key Vault secret rotated together; Function Apps restarted."
