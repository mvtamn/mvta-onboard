param environment string
param location string
param uniqueSuffix string
param privateEndpointSubnetId string
param keyVaultName string

param sqlAdminLogin string = 'mvtaonboardadmin'

@secure()
param sqlAdminPassword string

@description('Create/update the SQL connection-string secret during initial provisioning only. Keep false for normal infrastructure redeployments so they cannot rotate the app credential.')
param manageSqlConnectionStringSecret bool = false

var sqlServerName = 'sql-mvta-${environment}-${uniqueSuffix}'
var sqlDatabaseName = 'sqldb-mvta-onboard-${environment}'

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  // Standard S3 (100 DTU) rather than serverless: the timers query the
  // database every few minutes, so serverless never auto-paused and billed
  // ~$254/mo of compute. 250 GB is S3's included storage.
  sku: {
    name: 'Standard'
    tier: 'Standard'
    capacity: 100
  }
  properties: {
    maxSizeBytes: 268435456000
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = {
  name: 'pe-${sqlServerName}'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'pe-connection-${sqlServerName}'
        properties: {
          privateLinkServiceId: sqlServer.id
          groupIds: ['sqlServer']
        }
      }
    ]
  }
}

// Fixes the "app setting gets wiped on redeploy" bug - the connection
// string lives here as a proper Bicep-managed secret, and the Function
// App references it via Key Vault reference rather than storing the raw
// value in its own app settings.
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource sqlConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (manageSqlConnectionStringSecret) {
  parent: keyVault
  name: 'sql-connection-string'
  properties: {
    value: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDatabaseName};User ID=${sqlAdminLogin};Password=${sqlAdminPassword};Encrypt=true;TrustServerCertificate=false;'
  }
}

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output privateEndpointName string = privateEndpoint.name
