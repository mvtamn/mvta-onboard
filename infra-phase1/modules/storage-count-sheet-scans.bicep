// Blob Storage for scanned Count Sheets (plans/count-sheet-scan-upload.md §5,
// increment S1). One private account per environment, separate from the
// detour images account because immutability is set per container and needs
// blob versioning on the account.
//
//   count-sheet-originals - the PDF exactly as the garage desk uploaded it.
//     Version-level immutability (WORM) with a time-based retention policy.
//     The policy stays UNLOCKED until records management sets the retention
//     period: an unlocked policy already stops any original being deleted or
//     overwritten, and can still be changed. Once the period is set, someone
//     locks it by hand (a lock cannot be undone and is deliberately not in
//     Bicep); after that it can only be lengthened.
//   count-sheet-pages - straightened page images derived from the originals.
//     Rebuildable, so not WORM. A lifecycle rule to delete them at the
//     retention period is added once that period is known.
//
// Access is identity-only, as for the detour images: shared-key access is off
// and the REST app's managed identity mints short-lived user-delegation SAS
// URLs. The browser PUTs the original straight to Blob Storage, so CORS
// allows the console's origins.
param location string

@description('Globally-unique storage account name, max 24 chars, lowercase alphanumeric only.')
param storageAccountName string

@description('System-assigned principal ID of the REST API Function App. Empty to skip the role assignment.')
param functionAppPrincipalId string = ''
param manageRoleAssignments bool = false

@description('Origins allowed to PUT the original from the browser (the console). Empty leaves no cross-origin access, and uploads fail.')
param allowedCorsOrigins array = []

@description('Days each original is held under the unlocked retention policy. A placeholder until records management sets the period; while unlocked it can be changed in either direction.')
param originalsRetentionDays int = 3650

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    // Version-level immutability needs versioning on.
    isVersioningEnabled: true
    cors: {
      corsRules: empty(allowedCorsOrigins) ? [] : [
        {
          allowedOrigins: allowedCorsOrigins
          allowedMethods: ['PUT', 'HEAD', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource originalsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'count-sheet-originals'
  properties: {
    publicAccess: 'None'
    immutableStorageWithVersioning: {
      enabled: true
    }
  }
}

// The container's default time-based retention, applied to every version
// written to it. UNLOCKED: see the header.
resource originalsRetention 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2023-05-01' = {
  parent: originalsContainer
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: originalsRetentionDays
    allowProtectedAppendWrites: false
  }
}

resource pagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'count-sheet-pages'
  properties: {
    publicAccess: 'None'
  }
}

// Storage Blob Data Contributor: read and write blobs and get the user
// delegation key the SAS URLs are signed with. Applied here only where the
// deploying identity may assign roles (manageRoleAssignments); otherwise the
// user grants it by hand (PR steps).
resource blobDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

resource functionAppAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(functionAppPrincipalId) && manageRoleAssignments) {
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
