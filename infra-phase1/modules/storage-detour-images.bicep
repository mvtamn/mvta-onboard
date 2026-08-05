// Blob Storage for Detour & Closure image attachments (staff photos of
// signage, hand-marked maps, screenshots - see detour-and-event-module-
// implementation-plan.md, Part B3). A new resource type for this repo - the
// only other Storage accounts here are AzureWebJobsStorage, embedded in
// functionapp.bicep, which is not meant for application data.
//
// Private container, no public-read: reads/writes both go through
// short-lived SAS tokens minted by blobStorage.ts using the REST API
// Function App's own managed identity (a user-delegation key, never a
// storage account key) - same zero-standing-secret identity convention as
// every other resource in this repo. Not deployed until the owner approves
// (new resource, real cost) - see HANDOFF.md.
param location string

@description('System-assigned principal ID of the REST API Function App (mints SAS tokens + purges expired images). Empty to skip the role assignment.')
param functionAppPrincipalId string = ''

@description('Globally-unique storage account name, max 24 chars, lowercase alphanumeric only.')
param storageAccountName string

@description('Origins allowed to PUT/GET blobs directly from the browser (the console SWA/Front Door hostname) - the upload/read SAS URLs point straight at Blob Storage, bypassing the Function App, so CORS must be set here rather than in functionapp.bicep. Empty leaves Azure default (no cross-origin browser access at all - uploads would fail).')
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
    // Identity-based access only, same posture as Service Bus's
    // disableLocalAuth - the Function App's managed identity does
    // everything; no account key is ever handed out.
    allowSharedKeyAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: !empty(allowedCorsOrigins) ? {
    cors: {
      corsRules: [
        {
          allowedOrigins: allowedCorsOrigins
          allowedMethods: ['GET', 'PUT', 'HEAD']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  } : {}
}

resource detourImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'detour-images'
  properties: {
    publicAccess: 'None'
  }
}

// Storage Blob Data Contributor - lets the Function App's identity read/
// write blobs and mint user-delegation SAS tokens scoped to this account.
resource blobDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

resource functionAppAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(functionAppPrincipalId)) {
  name: guid(storageAccount.id, functionAppPrincipalId, blobDataContributorRole.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: blobDataContributorRole.id
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output containerName string = detourImagesContainer.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
