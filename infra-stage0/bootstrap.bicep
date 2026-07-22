targetScope = 'subscription'

@allowed(['dev', 'test', 'prod'])
param environment string

param location string = 'westus2'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-mvta-onboard-${environment}'
  location: location
  tags: {
    project: 'mvta-onboard'
    environment: environment
    managedBy: 'bicep'
  }
}

output resourceGroupName string = resourceGroup.name
