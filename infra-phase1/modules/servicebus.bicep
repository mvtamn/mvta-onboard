// Service Bus for the message-created event pattern. Namespace and queue
// exist and are deployed - nothing publishes to or subscribes from this
// queue yet. This is the next real wiring needed for SMS/email dispatch:
// messagesCreate.js should publish here on message creation, and the
// dispatch handler Function App should have a Service Bus trigger reading
// from this same queue.
//
// Security: local (SAS) auth is disabled - access is via Entra managed
// identity only. The REST API's identity gets Sender, the dispatch app's
// identity gets Receiver. Principal IDs are passed in from main-phase1 after
// the Function Apps are created; when empty (e.g. first-pass deploy before
// the apps exist) the role assignments are simply skipped.
param environment string
param location string

@description('System-assigned principal ID of the REST API Function App (publishes). Empty to skip.')
param senderPrincipalId string = ''

@description('System-assigned principal ID of the dispatch Function App (consumes). Empty to skip.')
param receiverPrincipalId string = ''

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: 'sb-mvta-onboard-${environment}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    // No SAS keys - identity-based access only.
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
  }
}

resource messageCreatedQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'message-created-events'
  properties: {
    maxDeliveryCount: 5
    lockDuration: 'PT1M'
    defaultMessageTimeToLive: 'P1D'
    deadLetteringOnMessageExpiration: true
  }
}

// Azure Service Bus Data Sender
resource sbSenderRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
}

// Azure Service Bus Data Receiver
resource sbReceiverRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  scope: subscription()
  name: '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
}

resource senderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(senderPrincipalId)) {
  name: guid(serviceBusNamespace.id, senderPrincipalId, sbSenderRole.id)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: sbSenderRole.id
    principalId: senderPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource receiverAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(receiverPrincipalId)) {
  name: guid(serviceBusNamespace.id, receiverPrincipalId, sbReceiverRole.id)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: sbReceiverRole.id
    principalId: receiverPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Double opt-in confirmation sends (SMS code / email link) are dispatched off
// this queue, kept separate from broadcast alerts so their delivery/retry
// behavior can be tuned independently.
resource confirmationQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'confirmation-requested-events'
  properties: {
    maxDeliveryCount: 5
    lockDuration: 'PT1M'
    defaultMessageTimeToLive: 'P1D'
    deadLetteringOnMessageExpiration: true
  }
}

output namespaceName string = serviceBusNamespace.name
output namespaceId string = serviceBusNamespace.id
output queueName string = messageCreatedQueue.name
output confirmationQueueName string = confirmationQueue.name
