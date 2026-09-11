// Reusable Function App module, used for both the REST API and the
// dispatch handler.
param functionAppName string
param location string
param environment string
param appInsightsConnectionString string
param storageAccountName string
param subnetId string
param keyVaultName string
param planSku string = 'B1'
param planTier string = 'Basic'
param includeSpareApiKey bool = false
param spareMissedTripsEnabled bool = false
param onDemandMonitoringEnabled bool = false
param onDemandMonitoringServiceIds string = ''
param onDemandDeparturesEnabled bool = false
param gtfsSilentNoShowEnabled bool = false
// The month-boundary timer (assessmentPeriodOpen) runs only where this is
// true; off until the compute and the report are trusted in that environment.
param assessmentMonthBoundaryEnabled bool = false
param spareMissedTripServiceIds string = ''
param spareContractorFaultValues string = ''
param complianceReportsStorageAccountName string = ''
param manageRoleAssignments bool = false
param enableAccessManagement bool = false
param accessManagementConfigJson string = ''
param accessAdminFallback bool = false
param privilegedAuthContext string = 'c1'
param gtfsRtTripUpdateUrl string = ''
param gtfsStaticUrl string = ''
param onDemandZoneFlexUrl string = ''
param onDemandOperationalZoneIds string = ''
param gtfsRtVehicleUrl string = ''
param gtfsRtAlertUrl string = ''
param availAvlReportsUrl string = ''
param availOtpMonthlyUrl string = ''
param availOtpDailyUrl string = ''
param availMissedTripsUrl string = ''
param availPulloutUrl string = ''

@description('Service Bus namespace used by the Event AVL notification trigger. Empty disables its identity-based connection setting.')
param serviceBusNamespace string = ''

@description('Azure Communication Services endpoint for the dispatch app (email/SMS senders). Empty leaves ACS unconfigured and the senders no-op.')
param acsEndpoint string = ''

@description('Verified ACS email sender address, e.g. DoNotReply@<domain>.azurecomm.net. Empty leaves email sending unconfigured.')
param acsEmailFrom string = ''

@description('Configure Easy Auth for this app. Disable for background-only Function Apps with no HTTP surface.')
param enableEasyAuth bool = true

@description('Client ID of the MVTA OnBoard Entra ID app registration - wires up Easy Auth so the caller principal and app roles are available via x-ms-client-principal')
param aadClientId string

@description('Graph site id of the approved SOP library the Decision Matrix picker browses. Empty = no library configured, and the picker says so rather than failing.')
param decisionMatrixLibrarySiteId string = ''

@description('Graph drive id of that library. Both this and the site id must be set for browsing to be configured.')
param decisionMatrixLibraryDriveId string = ''

@description('Application (client) id of the dedicated SharePoint document-reading registration - the identity of steps 1-5 of docs/runbooks/decision-matrix-sharepoint-documents.md. Empty falls back to the API application where that has been granted the library, which is dev only.')
param decisionMatrixHealthClientId string = ''

@description('Front Door ID (the FrontDoorId GUID from the Front Door profile). When set, inbound is locked so only traffic through this Front Door instance reaches the app. Empty = no inbound restriction (default, preserves current behavior).')
param frontDoorId string = ''

@description('Allowed CORS origins (the SWA / Front Door hostnames). Empty = leave Azure default CORS (no override).')
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
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${functionAppName}'
  location: location
  sku: {
    name: planSku
    tier: planTier
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    virtualNetworkSubnetId: subnetId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|24'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Explicit CORS: only the declared origins may call the API from a
      // browser. Empty array => no override (Azure default). See main-phase1.
      cors: empty(allowedCorsOrigins) ? null : {
        allowedOrigins: allowedCorsOrigins
        supportCredentials: false
      }
      // Inbound lockdown: when a Front Door ID is supplied, only requests
      // arriving through THIS Front Door instance are allowed - direct hits on
      // the *.azurewebsites.net hostname (which would bypass the WAF) are
      // denied. Empty frontDoorId keeps the app open (current behavior) so the
      // restriction can be rolled out deliberately.
      ipSecurityRestrictionsDefaultAction: empty(frontDoorId) ? 'Allow' : 'Deny'
      ipSecurityRestrictions: empty(frontDoorId) ? [] : [
        {
          name: 'Allow-FrontDoor-only'
          priority: 100
          action: 'Allow'
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: {
            'x-azure-fdid': [frontDoorId]
          }
        }
      ]
      appSettings: concat([
        // Identity-based access to the host storage account - no account key
        // in app settings. Backed by the Blob/Queue/Table data-plane role
        // assignments below (they reference this app's identity, so they are
        // created just after the site; allow a minute for role propagation on
        // first deploy). Replaces the old AzureWebJobsStorage connection string
        // that embedded listKeys().
        { name: 'AzureWebJobsStorage__accountName', value: storageAccount.name }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: storageAccount.properties.primaryEndpoints.blob }
        { name: 'AzureWebJobsStorage__queueServiceUri', value: storageAccount.properties.primaryEndpoints.queue }
        { name: 'AzureWebJobsStorage__tableServiceUri', value: storageAccount.properties.primaryEndpoints.table }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'KEY_VAULT_NAME', value: keyVaultName }
        { name: 'ENVIRONMENT', value: environment }
        { name: 'WEBSITE_VNET_ROUTE_ALL', value: '1' }
        // Declared explicitly - otherwise every Bicep redeploy silently
        // wipes it (Bicep's inline appSettings list is the COMPLETE
        // desired state, not additive), which caused a real outage once
        // and needed a fresh `func azure functionapp publish --force` to
        // recover even after other fixes were in place.
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'GTFS_RT_TRIPUPDATE_URL', value: gtfsRtTripUpdateUrl }
        { name: 'GTFS_STATIC_URL', value: gtfsStaticUrl }
        { name: 'GTFS_RT_VEHICLE_URL', value: gtfsRtVehicleUrl }
        { name: 'GTFS_RT_ALERT_URL', value: gtfsRtAlertUrl }
        { name: 'AVAIL_AVL_REPORTS_URL', value: availAvlReportsUrl }
        { name: 'AVAIL_OTP_MONTHLY_URL', value: availOtpMonthlyUrl }
        { name: 'AVAIL_OTP_DAILY_URL', value: availOtpDailyUrl }
        { name: 'AVAIL_MISSED_TRIPS_URL', value: availMissedTripsUrl }
        { name: 'AVAIL_PULLOUT_URL', value: availPulloutUrl }
        // Declared for the same reason as WEBSITE_RUN_FROM_PACKAGE above: a
        // hand-set Portal value survives only until the next Bicep redeploy,
        // because this list is the COMPLETE desired state. This flag gates
        // schedule-based silent-no-show detection (gtfsMissedTripsPoll), and
        // when it is dropped the detector falls back to explicit
        // cancellations only - the console reports "Cancellation-only", but
        // nothing else announces that the schedule-absence half has stopped.
        // That is precisely what happened after it was enabled by hand.
        { name: 'GTFS_SILENT_NO_SHOW_ENABLED', value: string(gtfsSilentNoShowEnabled) }
        // The GTFS-Flex archive the on-demand wait monitor resolves pickups
        // against (onDemandZonesSync). Declared here for the same reason as the
        // flag above: unset, the importer skips every run and the monitor has
        // no geometry to resolve against.
        { name: 'ON_DEMAND_ZONE_FLEX_URL', value: onDemandZoneFlexUrl }
        // Which GTFS-Flex location ids are Operational zones rather than the
        // reference boundaries the same feed carries. Empty means the two-zone
        // pilot set compiled into the importer; set it to adopt a third zone or
        // an upstream location-id rename without a code change.
        { name: 'ON_DEMAND_OPERATIONAL_ZONE_IDS', value: onDemandOperationalZoneIds }
        // Key Vault reference, not a raw value - fixes the same class of
        // "wiped on redeploy" bug for the connection string specifically.
        { name: 'SQL_CONNECTION_STRING', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/sql-connection-string/)' }
        // Same Key Vault reference pattern - powers Compose's optional
        // rider-friendly summary drafting (messagesDraftSummary.ts). The
        // secret itself (anthropic-api-key) must be created in Key Vault
        // before this resolves; see HANDOFF.md.
        { name: 'ANTHROPIC_API_KEY', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/anthropic-api-key/)' }
        // Same Key Vault reference pattern - powers Event Monitoring's live
        // vehicle positions (availAvlPoll.ts). The secret itself
        // (avail-avl-reports-api-key) must be created in Key Vault before
        // this resolves; see HANDOFF.md. The non-secret endpoint is declared
        // above so routine infrastructure deployments preserve it.
        { name: 'AVAIL_AVL_REPORTS_API_KEY', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/avail-avl-reports-api-key/)' }
        // Optional until MVTA provisions the Teams incoming webhook. Keep it
        // as a Key Vault reference so Bicep redeploys cannot expose or wipe it.
        { name: 'TEAMS_EVENT_WEBHOOK_URL', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/teams-event-webhook-url/)' }
        // Detour communications posted to Teams (migration 092 send path). Its own channel/secret so detours need not share the event channel.
        { name: 'TEAMS_DETOUR_WEBHOOK_URL', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/teams-detour-webhook-url/)' }
      ], !empty(serviceBusNamespace) ? [
        // Azure Functions resolves this identity-based connection using the
        // app's system-assigned managed identity; no SAS secret is used.
        { name: 'ServiceBusConnection__fullyQualifiedNamespace', value: '${serviceBusNamespace}.servicebus.windows.net' }
      ] : [], !empty(acsEndpoint) ? [
        // Declared here because this list is the complete desired state: an
        // ACS endpoint set with `az functionapp config appsettings set` was
        // wiped by the next routine infra deploy (2026-09-05). Identity-based
        // (DefaultAzureCredential); the app's identity needs Contributor on
        // the ACS resource, which is granted outside this template.
        { name: 'ACS_ENDPOINT', value: acsEndpoint }
      ] : [], !empty(acsEmailFrom) ? [
        { name: 'ACS_EMAIL_FROM', value: acsEmailFrom }
      ] : [], enableAccessManagement ? [
        { name: 'AZURE_TENANT_ID', value: subscription().tenantId }
        { name: 'ONBOARD_API_CLIENT_ID', value: aadClientId }
        { name: 'ONBOARD_API_CLIENT_SECRET', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/onboard-api-client-secret/)' }
        { name: 'ONBOARD_ENVIRONMENT', value: environment }
        { name: 'ONBOARD_ACCESS_CONFIG_JSON', value: accessManagementConfigJson }
        { name: 'ONBOARD_ACCESS_ADMIN_FALLBACK', value: string(accessAdminFallback) }
        { name: 'ONBOARD_PRIVILEGED_AUTH_CONTEXT', value: privilegedAuthContext }
      ] : [], !empty(decisionMatrixLibrarySiteId) && !empty(decisionMatrixLibraryDriveId) ? [
        // The one approved SharePoint library the Decision Matrix picker may
        // browse. It is configuration rather than request input on purpose: the
        // application holds Sites.Selected, so SharePoint refuses any site an
        // administrator has not granted it, and naming the site here keeps an
        // OCC.Admin from reaching a second granted library by editing a query
        // string. Reading it is app-only - Sites.Selected is an application
        // permission, and the sync that shares the credential runs on a timer
        // with no signed-in user. Declared here because this list is the
        // COMPLETE desired state: set by hand, it is removed by the next
        // routine infra deploy. See
        // docs/runbooks/decision-matrix-sharepoint-documents.md.
        { name: 'DECISION_MATRIX_LIBRARY_SITE_ID', value: decisionMatrixLibrarySiteId }
        { name: 'DECISION_MATRIX_LIBRARY_DRIVE_ID', value: decisionMatrixLibraryDriveId }
      ] : [], !empty(decisionMatrixHealthClientId) ? [
        // The dedicated document-reading identity. It is separate from the API
        // application on purpose: that one carries the delegated scopes the
        // console signs in with and is the audience Easy Auth validates, so a
        // SharePoint *application* permission added there would let any code
        // path read the library with no user present, and could not be revoked
        // without disturbing sign-in for every user of the console.
        //
        // Both settings are emitted together or not at all. The client id
        // alone would leave decisionMatrixProcedureGovernance.ts asking for a
        // secret that is not there, which reads at runtime as a document
        // problem rather than as a half-configured identity.
        //
        // The secret is a Key Vault reference, never a literal: the vault-wide
        // Key Vault Secrets User assignment below already lets this app read
        // it, so rotating the secret is a vault operation with no redeploy.
        { name: 'DECISION_MATRIX_HEALTH_CLIENT_ID', value: decisionMatrixHealthClientId }
        { name: 'DECISION_MATRIX_HEALTH_CLIENT_SECRET', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/decision-matrix-health-client-secret/)' }
      ] : [], !empty(complianceReportsStorageAccountName) ? [
        { name: 'COMPLIANCE_REPORTS_STORAGE_ACCOUNT', value: complianceReportsStorageAccountName }
      ] : [], includeSpareApiKey ? [
        // Spare missed-trip ingestion runs only in the REST app. Keep this
        // reference in Bicep so a redeploy does not remove the setting.
        { name: 'SPARE_API_KEY', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/spare-api-key/)' }
        { name: 'SPARE_API_BASE_URL', value: 'https://api.us.sparelabs.com' }
        // Dedicated inbound receiver secret. It is deliberately distinct from
        // SPARE_API_KEY, which grants outbound reconciliation access.
        { name: 'SPARE_WEBHOOK_AUTH_SECRET', value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}.vault.azure.net/secrets/spare-webhook-auth-secret/)' }
        { name: 'SPARE_MISSED_TRIPS_ENABLED', value: string(spareMissedTripsEnabled) }
        { name: 'SPARE_MISSED_TRIP_SERVICE_IDS', value: spareMissedTripServiceIds }
        { name: 'SPARE_CONTRACTOR_FAULT_VALUES', value: spareContractorFaultValues }
        { name: 'SPARE_MISSED_TRIP_LOOKBACK_MINUTES', value: '120' }
        { name: 'SPARE_MISSED_TRIP_MAX_ROWS', value: '10000' }
        // On-demand garage departures (onDemandDeparturesPoll) read Spare duties
        // named by the missed-trip requests above, so they share that scope.
        { name: 'ON_DEMAND_DEPARTURES_ENABLED', value: string(onDemandDeparturesEnabled) }
        { name: 'ASSESSMENT_MONTH_BOUNDARY_ENABLED', value: string(assessmentMonthBoundaryEnabled) }
        // The activation gate for on-demand service-quality monitoring. It is
        // read by both onDemandSpareReconcile and the /on-demand-risks read
        // contract, so unset means the hourly reconciliation never runs, the
        // spare_on_demand_reconciliation feed never records a success, and OCC
        // reports Not connected. Declared here because this list is the
        // COMPLETE desired state: set by hand, it is removed by the next
        // routine infra deploy, which is how ACS_ENDPOINT was lost on
        // 2026-09-05. Deliberately independent of SPARE_MISSED_TRIPS_ENABLED -
        // ADR 0026 separates the two so a missed-trip policy change cannot
        // decide whether on-demand risk is trustworthy.
        { name: 'ON_DEMAND_MONITORING_ENABLED', value: string(onDemandMonitoringEnabled) }
        // Which Spare services the hourly reconciliation reads. Empty means
        // every service the API key can see, which is why this ships alongside
        // the flag rather than after it: enabling monitoring without a scope
        // would reconcile services that are not MVTA Connect. Deliberately not
        // defaulted to SPARE_MISSED_TRIP_SERVICE_IDS, which is missed-trip
        // policy and must not silently become monitoring policy.
        { name: 'ON_DEMAND_MONITORING_SERVICE_IDS', value: onDemandMonitoringServiceIds }
      ] : [])
    }
  }
}

resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(functionApp.id, keyVaultSecretsUserRole.id, keyVaultName)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Data-plane roles backing identity-based AzureWebJobsStorage (no account key).
// Storage Blob Data Owner
resource blobDataOwnerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
}
// Storage Queue Data Contributor
resource queueDataContributorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
}

resource storageBlobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(functionApp.id, blobDataOwnerRole.id, storageAccount.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: blobDataOwnerRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageQueueRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(functionApp.id, queueDataContributorRole.id, storageAccount.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: queueDataContributorRole.id
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Easy Auth (App Service Authentication) - allow-anonymous mode.
// CRITICAL: "platform.enabled: true" must be explicit. Without it, we saw
// the WHOLE Function App return 404 on every route (including ones with
// zero dependencies) instead of just gating one route. Also use API
// version 2022-03-01 specifically for this config resource type - using
// the same version as the parent site resource caused issues.
// If this ever needs to be temporarily disabled: commenting this block
// out of Bicep does NOT undo it on Azure (Incremental mode just stops
// managing it) - use `az webapp auth update --enabled false` explicitly,
// and expect to need a fresh `func azure functionapp publish --force`
// after re-enabling it too.
resource authSettings 'Microsoft.Web/sites/config@2022-03-01' = if (enableEasyAuth) {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: aadClientId
          // The app registration's null requestedAccessTokenVersion means v1 tokens.
          openIdIssuer: 'https://sts.windows.net/${subscription().tenantId}/'
        }
        validation: {
          // The console requests a token for the API's own Application ID URI
          // (api://<aadClientId>/access_as_user), not just the bare client ID.
          // Without allowedAudiences listing that URI, Easy Auth rejects those
          // tokens and x-ms-client-principal never gets populated - callers
          // would appear anonymous even with a valid, role-bearing token.
          allowedAudiences: [
            'api://${aadClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
output functionAppId string = functionApp.id
