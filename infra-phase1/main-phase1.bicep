// Phase 1: MVP + core rider channels
// Front Door is deliberately NOT included here - it was built directly in
// the Azure Portal after the Bicep module (frontdoor.bicep, still present
// in this folder for reference) hit a persistent, unresolved
// "Policy ArmResourceId has incorrect formatting" error across every
// configuration variation tried. If Front Door ever needs to be rebuilt,
// plan on doing it manually in the portal again: profile (Standard tier)
// -> origin group + origin for the Static Web App -> origin group + origin
// for the REST API -> the /api/* path-based route -> WAF as a separate step.
targetScope = 'resourceGroup'

@allowed(['dev', 'test', 'prod'])
param environment string

param location string = resourceGroup().location
param uniqueSuffix string

@description('Client ID of the MVTA OnBoard Entra ID app registration. LIVE VALUE: 7e5a35b1-dc1b-473d-987d-6942a7b4fae2')
param aadClientId string

@description('Front Door ID (FrontDoorId GUID). When set, Function App inbound is locked to this Front Door only. Empty leaves inbound open (roll out deliberately - see functionapp.bicep).')
param frontDoorId string = ''

@description('CORS origins allowed to call the API from a browser - the SWA / Front Door hostnames. Empty leaves Azure default.')
param allowedCorsOrigins array = []

@description('Front Door tier for the WAF policy. The live Front Door is Standard; managed rule sets require Premium (see wafpolicy.bicep).')
@allowed(['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor'])
param wafSku string = 'Standard_AzureFrontDoor'

var cleanSuffix = replace(uniqueSuffix, '-', '')

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'kv-mvta-${environment}-${uniqueSuffix}'
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: 'appi-mvta-onboard-${environment}'
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' existing = {
  name: 'vnet-mvta-onboard-${environment}'
}

module restApiFunction 'modules/functionapp.bicep' = {
  name: 'rest-api-function-deployment'
  params: {
    functionAppName: 'func-mvta-restapi-${environment}'
    location: location
    environment: environment
    appInsightsConnectionString: appInsights.properties.ConnectionString
    storageAccountName: take('stmvtarestapi${environment}${cleanSuffix}', 24)
    subnetId: vnet.properties.subnets[0].id
    keyVaultName: keyVault.name
    planSku: 'B1'
    planTier: 'Basic'
    aadClientId: aadClientId
    frontDoorId: frontDoorId
    allowedCorsOrigins: allowedCorsOrigins
  }
}

module dispatchFunction 'modules/functionapp.bicep' = {
  name: 'dispatch-function-deployment'
  params: {
    functionAppName: 'func-mvta-dispatch-${environment}'
    location: location
    environment: environment
    appInsightsConnectionString: appInsights.properties.ConnectionString
    storageAccountName: take('stmvtadispatch${environment}${cleanSuffix}', 24)
    subnetId: vnet.properties.subnets[0].id
    keyVaultName: keyVault.name
    planSku: 'B1'
    planTier: 'Basic'
    aadClientId: aadClientId
    frontDoorId: frontDoorId
    allowedCorsOrigins: allowedCorsOrigins
  }
}

module onboardSwa 'modules/staticwebapp.bicep' = {
  name: 'onboard-swa-deployment'
  params: {
    staticWebAppName: 'stapp-mvta-onboard-${environment}'
    location: location
    sku: 'Standard'
  }
}

module riderOptinSwa 'modules/staticwebapp.bicep' = {
  name: 'rider-optin-swa-deployment'
  params: {
    staticWebAppName: 'stapp-mvta-riderapp-${environment}'
    location: location
    // Standard (was Free): needed for enterprise-grade features and so the
    // staticwebapp.config.json security headers / routing are honored.
    sku: 'Standard'
  }
}

module serviceBus 'modules/servicebus.bicep' = {
  name: 'servicebus-deployment'
  params: {
    environment: environment
    location: location
    // Identity-based access (local auth is disabled in the module): the REST
    // API publishes (Sender), the dispatch app consumes (Receiver).
    senderPrincipalId: restApiFunction.outputs.functionAppPrincipalId
    receiverPrincipalId: dispatchFunction.outputs.functionAppPrincipalId
  }
}

// WAF policy (define-as-code). Associate it with the manually-built Front Door
// via a Security Policy - see wafpolicy.bicep header.
module wafPolicy 'modules/wafpolicy.bicep' = {
  name: 'waf-policy-deployment'
  params: {
    environment: environment
    wafSku: wafSku
  }
}

output wafPolicyId string = wafPolicy.outputs.wafPolicyId
output restApiFunctionName string = restApiFunction.outputs.functionAppName
output restApiFunctionHostname string = restApiFunction.outputs.functionAppHostname
output dispatchFunctionName string = dispatchFunction.outputs.functionAppName
output onboardSwaHostname string = onboardSwa.outputs.staticWebAppHostname
output riderOptinSwaHostname string = riderOptinSwa.outputs.staticWebAppHostname
output serviceBusNamespace string = serviceBus.outputs.namespaceName
output serviceBusQueueName string = serviceBus.outputs.queueName
