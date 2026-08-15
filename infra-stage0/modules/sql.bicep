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

// Serverless (with auto-pause) is the right tradeoff for dev/test - it's idle
// most of the time and cost matters more than the occasional 30-60s cold-resume
// delay on the first request after a pause. That same pause behavior is not
// acceptable for a live production service, where it would surface to riders/
// ops staff as an intermittent outage. Only `dev` gets the auto-pausing
// serverless SKU; any other environment name gets a provisioned, always-on tier.
var isDev = environment == 'dev'
var sqlSku = isDev
  ? { name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 1 }
  : { name: 'GP_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 2 }
var sqlDatabaseProperties = isDev
  ? { autoPauseDelay: 240, minCapacity: json('0.5'), maxSizeBytes: 34359738368 }
  : { maxSizeBytes: 34359738368 }

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
  sku: sqlSku
  properties: sqlDatabaseProperties
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
