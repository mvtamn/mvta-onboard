param location string
param storageAccountName string
param functionAppPrincipalId string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false, allowSharedKeyAccess: false }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = { parent: storageAccount, name: 'default' }
resource reportsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = { parent: blobService, name: 'compliance-reports', properties: { publicAccess: 'None' } }
resource blobDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = { scope: subscription(), name: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' }
resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id,functionAppPrincipalId,blobDataContributorRole.id)
  scope: storageAccount
  properties: { roleDefinitionId: blobDataContributorRole.id, principalId: functionAppPrincipalId, principalType: 'ServicePrincipal' }
}
output storageAccountName string = storageAccount.name
