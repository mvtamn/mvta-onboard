// NOT CURRENTLY USED - kept for reference only.
// This module hit a persistent, never-resolved error:
// "WebApplicationFirewallPolicy validation failed... Policy ArmResourceId
// has incorrect formatting" - occurred with managed rules, without managed
// rules, with the securityPolicy linkage, and without it. Front Door was
// ultimately built directly in the Azure Portal instead (Standard tier,
// no WAF attached yet). If revisiting this in Bicep, budget real time for
// it - this was never solved despite significant effort.
param environment string
param location string = 'global'
param onboardSwaHostname string
param restApiHostname string

resource wafPolicy 'Microsoft.Network/frontdoorWebApplicationFirewallPolicies@2022-05-01' = {
  name: 'waf-mvta-onboard-${environment}'
  location: location
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: environment == 'prod' ? 'Prevention' : 'Detection'
    }
  }
}

resource frontDoorProfile 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: 'afd-mvta-onboard-${environment}'
  location: location
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: frontDoorProfile
  name: 'endpoint-mvta-onboard-${environment}'
  location: location
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: frontDoorProfile
  name: 'og-onboard'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 60
    }
  }
}

resource onboardOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: originGroup
  name: 'origin-onboard-swa'
  properties: {
    hostName: onboardSwaHostname
    httpPort: 80
    httpsPort: 443
    originHostHeader: onboardSwaHostname
    priority: 1
    weight: 1000
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: frontDoorEndpoint
  name: 'route-onboard'
  properties: {
    originGroup: { id: originGroup.id }
    supportedProtocols: ['Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
  }
  dependsOn: [onboardOrigin]
}

resource apiOriginGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: frontDoorProfile
  name: 'og-restapi'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/api/health'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 60
    }
  }
}

resource apiOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: apiOriginGroup
  name: 'origin-restapi'
  properties: {
    hostName: restApiHostname
    httpPort: 80
    httpsPort: 443
    originHostHeader: restApiHostname
    priority: 1
    weight: 1000
  }
}

resource apiRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: frontDoorEndpoint
  name: 'route-restapi'
  properties: {
    originGroup: { id: apiOriginGroup.id }
    supportedProtocols: ['Https']
    patternsToMatch: ['/api/*']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
  }
  dependsOn: [apiOrigin]
}

output frontDoorEndpointHostname string = frontDoorEndpoint.properties.hostName
output wafPolicyName string = wafPolicy.name
