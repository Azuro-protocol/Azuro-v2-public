var Wallet = require("ethereumjs-wallet");
const wallet = Wallet.generate();
console.log("privateKey: " + wallet.getPrivateKeyString());
console.log("address: " + wallet.getAddressString());
