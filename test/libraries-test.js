const { expect } = require("chai");
const { utils } = require("ethers");
const { ethers } = require("hardhat");
const { MULTIPLIER } = require("../utils/constants");

const dbg = require("debug")("test:math");

const ACCURACY = 12;

describe("PrematchCore tools test", function () {
  let libraryMock;

  before(async () => {
    const LibraryMock = await ethers.getContractFactory("LibraryMock", {
      signer: await ethers.getSigner(),
    });
    libraryMock = await LibraryMock.deploy();
    await libraryMock.deployed();
  });

  it("Should calculate margin", async function () {
    var a = await libraryMock.marginAdjustedOdds(MULTIPLIER * 1.73, MULTIPLIER * 0.05);
    dbg("1.73 with 5% newOdds = ", utils.formatUnits(a, ACCURACY));
    expect(a).to.equal(1658829422886);

    a = await libraryMock.marginAdjustedOdds(MULTIPLIER * 1.98, MULTIPLIER * 0.05);
    dbg("1.98 with 5% newOdds = ", utils.formatUnits(a, ACCURACY));
    expect(a).to.equal(1886657619097);

    a = await libraryMock.marginAdjustedOdds(MULTIPLIER * 1.98, MULTIPLIER * 0.1);
    dbg("1.98 with 10% newOdds = ", utils.formatUnits(a, ACCURACY));
    expect(a).to.equal(1801801818366);
  });
});
