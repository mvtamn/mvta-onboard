// Reusable Function App module, used for both the REST API and the
// dispatch handler.
param functionAppName string
param location string
param environment string
param appInsightsConnectionString string
param storageAccountName string
param subnetId string
param keyVaultName string
param planSku string = 'B1'
param planTier string = 'Basic'

@description('Client ID of the MVTA OnBoard Entra ID app registration - wires up Easy Auth so the caller principal and app roles are available via x-ms-client-principal')
param aadClientId string

@description('Front Door ID (the FrontDoorId GUID from the Front Door profile). When set, inbound is locked so only traffic through this Front Door instance reaches the app. Empty = no inbound restriction (default, preserves current behavior).')
param frontDoorId string = ''

@description('Allowed CORS origins (the SWA / Front Door hostnames). Empty = leave Azure default CORS (no override).')
param allowedCorsOrigins array = []

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${functionAppName}'
  location: location
  sku: {
    name: planSku
    tier: planTier
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    virtualNetworkSubnetId: subnetId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|24'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Explicit CORS: only the declared origins may call the API from a
      // browser. Empty array => no override (Azure default). See main-phase1.
      cors: empty(allowedCorsOrigins) ? null : {
        allowedOrigins: allowedCorsOrigins
        supportCredentials: false
      }
      // Inbound lockdown: when a Front Door ID is supplied, only requests
      // arriving through THIS Front Door instance are allowed - direct hits on
      // the *.azurewebsites.net hostname (which would bypass the WAF) are
      // denied. Empty frontDoorId keeps the app open (current behavior) so the
      // restriction can be rolled out deliberately.
      ipSecurityRestrictionsDefaultAction: empty(frontDoorId) ? 'Allow' : 'Deny'
      ipSecurityRestrictions: empty(frontDoorId) ? [] : [
        {
          name: 'Allow-FrontDoor-only'
          priority: 100
          action: 'Allow'
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: {
            'x-azure-fdid': [frontDoorId]
          }
        }
      ]
      appSettings: [
        // Identity-based access to the host storage account - no account key
        // in app settings. Backed by the Blob/Queue/Table data-plane role
        // assignments below (they reference this app's identity, so they are
        // created just after the site; allow a minute for role propagation on
        // first deploy). Replaces the old AzureWebJobsStorage connection string
        // that embedded listKeys().
        { name: 'AzureWebJobsStorage__accountName', value: storageAccount.name }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: storageAccount.properties.primaryEndpoints.blob }
        { name: 'AzureWebJobsStorage__queueServiceUri', value: storageAccount.properties.primaryEndpoints.queue }
        { name: 'AzureWebJobsStorage__tableServiceUri', value: storageAccount.properties.primaryEndpoints.table }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'KEY_VAULT_NAME', value: keyVaultName }
        { name: 'ENVIRONMENT', value: environment }
        { name: 'WEBSITE_VNET_ROUTE_ALL', value: '1' }
        // Declared explicitly - otherwise every Bicep redeploy silently
        // wipes it (Bicep's inline appSettings list is the COMPLETE
        // desired state, not additive), which caused a real outage once
        // and needed a fresh `func azure functionapp publish --force` to
        // recover even after other fixes were in place.
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        // Key Vault reference, not a raw value - fixes the same class of
        // "wiped on redeploy" bug for the connection string specifically.
        { name: 'SQL_CONNECTION_STRING', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/sql-connection-string/)' }
      ]
    }
  }
}

resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, keyVaultSecretsUserRole.id, keyVaultName)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Data-plane roles backing identity-based AzureWebJobsStorage (no account key).
// Storage Blob Data Owner
resource blobDataOwnerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
}
// Storage Queue Data Contributor
resource queueDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
}

resource storageBlobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, blobDataOwnerRole.id, storageAccount.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: blobDataOwnerRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageQueueRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, queueDataContributorRole.id, storageAccount.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: queueDataContributorRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Easy Auth (App Service Authentication) - allow-anonymous mode.
// CRITICAL: "platform.enabled: true" must be explicit. Without it, we saw
// the WHOLE Function App return 404 on every route (including ones with
// zero dependencies) instead of just gating one route. Also use API
// version 2022-03-01 specifically for this config resource type - using
// the same version as the parent site resource caused issues.
// If this ever needs to be temporarily disabled: commenting this block
// out of Bicep does NOT undo it on Azure (Incremental mode just stops
// managing it) - use `az webapp auth update --enabled false` explicitly,
// and expect to need a fresh `func azure functionapp publish --force`
// after re-enabling it too.
resource authSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: aadClientId
          openIdIssuer: 'https://login.microsoftonline.com/${subscription().tenantId}/v2.0'
        }
        validation: {
          // The console requests a token for the API's own Application ID URI
          // (api://<aadClientId>/access_as_user), not just the bare client ID.
          // Without allowedAudiences listing that URI, Easy Auth rejects those
          // tokens and x-ms-client-principal never gets populated - callers
          // would appear anonymous even with a valid, role-bearing token.
          allowedAudiences: [
            'api://${aadClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
output functionAppId string = functionApp.id
