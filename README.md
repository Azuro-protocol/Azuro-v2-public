 # Azuro-V2

## Test environment

### 1. Set environment variables (optional)
Before start up test environment you can set `.env` variables:

- **ORACLES** list of addresses of oracles.
- **MAINTAINERS** list of addresses of maintainers.

### 2. Run local node

```
npm run node
```

### 3. Run deploy script

```
npm run deploy-local
```

## Special test features

### Forking
You can set **FORKING** environment variable to **"YES"** to run local environment with fork of already deployed contracts.

### Upgrade tests
You can set **UPGRADE_TEST** environment variable to **"YES"** with **FORKING** variable to upgrade contracts from forked chain before test run.  
Before this, make sure that you set `.env` variables:
- **FACTORY_ADDRESS**
- **BEACON_AZUROBET_ADDRESS**
- **BEACON_CORE_ADDRESS**
- **BEACON_LP_ADDRESS**
- **FREEBET_ADDRESS**

## Upgrade
### 1. Set environment variables
Before upgrade you need to set `.env` variables for respected contract(s):

- **FACTORY_ADDRESS** address of upgrading Factory.
- **BEACON_AZUROBET_ADDRESS** address of upgrading AzuroBet Beacon.
- **BEACON_CORE_ADDRESS** address of upgrading Core Beacon.
- **BEACON_LP_ADDRESS** address of upgrading LP Beacon.
- **USE_MULTISIG=YES/any** if you want to use multi-signature or not.

### 2 Run upgrade script

#### a) Upgrade specific contract on any network
   ```
   npm run %script_name% %network%
   ```
  Where `%script_name%` can be:
  * `upgrade-AzuroBet`
  * `upgrade-Core`
  * `upgrade-Factory`
  * `upgrade-LP`
#### b) Upgrade all contracts on **Gnosis Chain**
   ```
   npm run upgrade-all-gnosis
   ```

## Deploy FreeBet
### 1. Set environment variables
Before deploy you need to set `.env` variables:

- **TOKEN_ADDRESS** address of token used for free bet.
- **LP_ADDRESS** address of Liquidity Pool for which free bets will be provided.
- _(optional)_ **MAINTAINERS** list of addresses of maintainers.

### 2 Run deploy script

   ```
   npm run deploy-freebet %network%
   ```

## Docs  
https://docs.azuro.org/azuroprotocol/
