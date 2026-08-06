// Azure Maps account for Event Monitoring's real map overlay (event-module-
// implementation-plan.md, Part A3) - plots only RouteClassification-
// classified 'SpecialEvent' vehicle positions (GET /event-vehicle-positions)
// on an actual Twin Cities-area basemap instead of the retired static Lot A/
// Fairgrounds schematic.
//
// Gen2 pricing tier (S0/S1 no longer accept new accounts) - pay-as-you-go,
// no committed spend; expected to stay far under any real cost at this
// module's usage volume (one console, a handful of staff, a few markers).
// A new resource with real (if small) cost - not deployed until the owner
// approves, same convention as every other infra addition in this repo.
//
// Zero-standing-secret: no Maps subscription key is ever generated or
// shipped to the browser. The REST API Function App's managed identity is
// granted Azure Maps Data Reader on this account; mapsToken.ts uses that
// identity to mint a short-lived Azure AD token server-side, which the
// frontend SDK (azure-maps-control, 'anonymous' auth mode) exchanges for
// map tiles. The account's clientId (output below) is a public identifier,
// not a secret - safe to put in the AZURE_MAPS_CLIENT_ID app setting.
param location string

@description('System-assigned principal ID of the REST API Function App (mints Azure Maps tokens server-side via its own identity). Empty to skip the role assignment.')
param functionAppPrincipalId string = ''

@description('Azure Maps account name.')
param mapsAccountName string

resource mapsAccount 'Microsoft.Maps/accounts@2023-06-01' = {
  name: mapsAccountName
  location: 'global'
  sku: {
    name: 'G2'
  }
  kind: 'Gen2'
  properties: {
    disableLocalAuth: true
  }
}

// Azure Maps Data Reader - lets the Function App's identity read map data
// (tiles, geocoding) on this account; it never needs to manage the account
// itself.
resource mapsDataReaderRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '423170ca-a8f6-4b0f-8487-9e4eb8f49bfa'
}

resource functionAppAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(functionAppPrincipalId)) {
  name: guid(mapsAccount.id, functionAppPrincipalId, mapsDataReaderRole.id)
  scope: mapsAccount
  properties: {
    roleDefinitionId: mapsDataReaderRole.id
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output mapsAccountName string = mapsAccount.name
output mapsAccountId string = mapsAccount.id
// Public identifier (not a secret) - set as the AZURE_MAPS_CLIENT_ID app
// setting on the REST API Function App after deploy.
output mapsClientId string = mapsAccount.properties.uniqueId
