const { BigNumber } = require("@ethersproject/bignumber");

const BIGZERO = BigNumber.from(0);
const FREEBET_ADDRESS = process.env.FREEBET_ADDRESS || "";
const FORKING = process.env.FORKING === "YES";
const ITERATIONS = 100;
const LIVE_CORE_ADDRESS = process.env.LIVE_CORE_ADDRESS || "";
const MULTIPLIER = 1e12;
const UPGRADE_TEST = process.env.UPGRADE_TEST === "YES";

module.exports = {
  BIGZERO,
  FREEBET_ADDRESS,
  FORKING,
  ITERATIONS,
  LIVE_CORE_ADDRESS,
  MULTIPLIER,
  UPGRADE_TEST,
};
