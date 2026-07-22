// Front Door WAF policy for MVTA OnBoard.
//
// The live Front Door was built manually in the portal (see main-phase1.bicep
// header) and currently has NO WAF. This module defines the WAF policy as code
// so it can be associated with that Front Door via a Security Policy (portal:
// Front Door profile -> Security policies -> add, selecting this policy and the
// endpoint; or via Bicep once the Front Door profile is imported/managed).
//
// SKU note: rate-limit custom rules work on Front Door **Standard**. The
// Microsoft managed rule set (DRS) requires **Premium** - managed rules are
// only emitted when wafSku is Premium, so this deploys cleanly on either tier.
targetScope = 'resourceGroup'

param environment string

@allowed(['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor'])
param wafSku string = 'Standard_AzureFrontDoor'

@description('Requests allowed per minute per client IP before rate-limiting kicks in. Protects the public rider opt-in from abuse.')
param rateLimitThreshold int = 100

var isPremium = wafSku == 'Premium_AzureFrontDoor'

resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2022-05-01' = {
  name: 'wafmvtaonboard${environment}'
  location: 'global'
  sku: {
    name: wafSku
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      // Prevention actively blocks in prod; Detection only logs elsewhere so
      // rules can be tuned before they start blocking real staff/riders.
      mode: environment == 'prod' ? 'Prevention' : 'Detection'
      requestBodyCheck: 'Enabled'
    }
    customRules: {
      rules: [
        {
          name: 'RateLimitPerClientIp'
          priority: 100
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: rateLimitThreshold
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Any'
              negateCondition: false
              matchValue: []
            }
          ]
          action: 'Block'
        }
      ]
    }
    managedRules: isPremium ? {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
        }
      ]
    } : {
      managedRuleSets: []
    }
  }
}

output wafPolicyId string = wafPolicy.id
output wafPolicyName string = wafPolicy.name
