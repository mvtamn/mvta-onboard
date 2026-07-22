// Stage 0: Foundational setup
targetScope = 'resourceGroup'

@allowed(['dev', 'test', 'prod'])
param environment string

param location string = resourceGroup().location

@description('Short unique string to make globally-unique resource names like Key Vault and SQL Server. LIVE VALUE IN USE: mvta-jx4471')
param uniqueSuffix string

param sqlAdminLogin string = 'mvtaonboardadmin'

@secure()
param sqlAdminPassword string

module network 'modules/network.bicep' = {
  name: 'network-deployment'
  params: {
    environment: environment
    location: location
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-deployment'
  params: {
    environment: environment
    location: location
  }
}

module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault-deployment'
  params: {
    environment: environment
    location: location
    uniqueSuffix: uniqueSuffix
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    vnetId: network.outputs.vnetId
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql-deployment'
  params: {
    environment: environment
    location: location
    uniqueSuffix: uniqueSuffix
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    keyVaultName: keyvault.outputs.keyVaultName
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
  }
}

module privateDns 'modules/privatedns.bicep' = {
  name: 'privatedns-deployment'
  params: {
    vnetId: network.outputs.vnetId
    keyVaultPrivateEndpointName: keyvault.outputs.privateEndpointName
    sqlPrivateEndpointName: sql.outputs.privateEndpointName
  }
}

output vnetName string = network.outputs.vnetName
output functionsSubnetId string = network.outputs.functionsSubnetId
output keyVaultName string = keyvault.outputs.keyVaultName
output keyVaultUri string = keyvault.outputs.keyVaultUri
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output logAnalyticsWorkspaceId string = monitoring.outputs.logAnalyticsWorkspaceId
