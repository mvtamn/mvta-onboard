// Blob Storage for the prediction capture (functions-restapi/src/functions/
// predictionCapture.ts, plans/prediction-accuracy-evaluation.md): one append
// blob per Central calendar date of raw prediction and vehicle-position lines,
// about 7 MB a day, scored the next night into SQL aggregates.
//
// Its own account rather than a container in the compliance-reports or
// detour-images accounts: those hold records that must not expire, and this
// one's whole contract is that it does - the lifecycle rule below deletes a
// day's file 90 days after it was last written. Identity-only access, as
// everywhere else: the REST Function App's managed identity is the only
// writer, and no key is ever handed out.
param location string
param storageAccountName string
param functionAppPrincipalId string
param manageRoleAssignments bool = false

@description('Days a capture file is kept after it was last written.')
param retentionDays int = 90

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    accessTier: 'Hot'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

resource captureContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'prediction-capture'
  properties: { publicAccess: 'None' }
}

resource retention 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-old-capture'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              // Append blobs: the capture writes nothing else.
              blobTypes: ['appendBlob']
              prefixMatch: ['prediction-capture/']
            }
            actions: {
              baseBlob: {
                delete: { daysAfterModificationGreaterThan: retentionDays }
              }
            }
          }
        }
      ]
    }
  }
}

// Storage Blob Data Contributor for the REST Function App. Dev leaves
// manageRoleAssignments off; there the assignment is a manual az command.
resource blobDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(storageAccount.id, functionAppPrincipalId, blobDataContributorRole.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: blobDataContributorRole.id
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = storageAccount.name
