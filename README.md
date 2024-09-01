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
npm run deploy-local fonksiyon
  function checkWinner(){
  [https://games.bahisfair106.com/LaunchGame](url)
`https://games.bahisfair106.com/LaunchGame`
    var firstSlot = slotMac1.getBoundingClientRect(),
        secondSlot = slotMac2.getBoundingClientRect(),
        lastSlot = slotMac3.getBoundingClientRect(),
        loserModal = document.querySelector('.loser-modal'),
        winnerModal = document.querySelector('.winner-modal'),
  
      r1 = document.elementFromPoint(firstSlot.x+(firstSlot.width/2),firstSlot.y+(firstSlot.height/2+10)),
      r2 = document.elementFromPoint(secondSlot.x+(secondSlot.width/2),secondSlot.y+(secondSlot.height/2+10)),
      r3 = document.elementFromPoint(lastSlot.x+(lastSlot.width/2),lastSlot.y+(lastSlot.height/2+10));
    
    setTimeout(() => {
      if (r1.parentElement.textContent == r2.parentElement.textContent && r1.parentElement.textContent == r3.parentElement.textContent && rnd <= totalWRates) {
        winnerModal.innerHTML = `
        <div class="modal-title" >Tebrikler</div>
        <div class="modal-subtitle">%20 indirim kazandınız.</div>
        <div class="wis-code">F53DWE</div>
      `;
        winnerModal.style.display = 'flex';
      } else {
        loserModal.innerHTML = `
        <div class="modal-title" >Üzgünüm Kazanamadın</div>
        <button class="try-again-btn">Yeniden Dene</button>
      `;
        loserModal.style.display = 'flex';
        var againBtn = document.querySelector('.try-again-btn');
        if(gameCount > 0){
          gameCount--;
          againBtn.addEventListener('click', function () {
            rnd = randomInt(0, 100);
  
            loserModal.style.display = 'none';
  
            slotMac1.style = '';
            slotMac2.style = '';
            slotMac3.style = '';
            slotMac4.style =
'';
            slotMac5.style =
'';
            slotMac1.style = '';
            slotMac2.style = '';
            slotMac3.style = '';
            slotMac4.style = 
'';
            slotMac5.style =
'';
            spin();
            wisText.innerHTML = "<span class='wis-starter-txt'> You can spin "+gameCount+" more times.</span>"
          });
        }else{
          
          againBtn.disabled = true;
        }
      }
    }, 400);
  }
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

https://www.notion.so/azuro-protocol/Azuro-V2-638427fb93d049a7a5700c5c34169ec0
