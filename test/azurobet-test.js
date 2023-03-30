const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  createCondition,
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  makeBetGetTokenId,
  createGame,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const ONE_HOUR = 3600;
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const URI = "https://smth.com";

describe("AzuroBet test", function () {
  const reinforcement = tokens(20000); // 100%
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;
  const betAmount = tokens(100);
  const bettor2Balance = tokens(100_000);

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, bettor, bettor2;
  let access, core, wxDAI, lp, azuroBet;
  let roleIds, time;

  let gameId = 0;
  let condId = 0;

  before(async () => {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, bettor, bettor2] = await ethers.getSigners();

    ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      bettor,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      LIQUIDITY
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    await bettor2.sendTransaction({ to: wxDAI.address, value: bettor2Balance });
    await wxDAI.connect(bettor2).approve(lp.address, bettor2Balance);
  });
  it("Check changing URI", async () => {
    await azuroBet.connect(poolOwner).setBaseURI(URI);
    expect(await azuroBet.baseURI()).to.be.equal(URI);
  });
  it("Check supportsInterface EIP-165", async () => {
    expect(await azuroBet.supportsInterface(0x01ffc9a7)).to.be.equal(true);
  });
  it("Get all tokens owned by owner", async () => {
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    const balanceBefore = await azuroBet.balanceOf(bettor.address);
    for (const i of Array(10).keys()) {
      const tokenId = await makeBetGetTokenId(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMELOSE,
        time + 100,
        0
      );
      const tokens = await azuroBet["getTokensByOwner(address)"](bettor.address);
      expect(tokens.length).to.be.equal(balanceBefore.add(i + 1));
      expect(tokens[balanceBefore.add(i)]).to.be.equal(tokenId);
    }
  });
  it("Get tokens owned by owner in several parts", async () => {
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );
    const balanceBefore = await azuroBet.balanceOf(bettor.address);
    for (const _ of Array(10).keys()) {
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);
    }
    await expect(
      azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore.add(10), 0)
    ).to.be.revertedWith("ERC721: start index out of bounds");

    let allTokens = await azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore, 0);
    expect(allTokens.length).to.be.equal(0);

    allTokens = await azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore, 10);
    expect(allTokens.length).to.be.equal(10);

    let tokens = await azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore, 100);
    expect(allTokens.length).to.be.equal(10);
    for (let i = 0; i < tokens.length; ++i) {
      expect(allTokens[i]).to.be.equal(tokens[i]);
    }

    tokens = await azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore, 5);
    expect(tokens.length).to.be.equal(5);
    for (let i = 0; i < tokens.length; ++i) {
      expect(allTokens[i]).to.be.equal(tokens[i]);
    }

    tokens = await azuroBet["getTokensByOwner(address,uint256,uint256)"](bettor.address, balanceBefore.add(5), 5);
    expect(tokens.length).to.be.equal(5);
    for (let i = 0; i < tokens.length; ++i) {
      expect(allTokens[i + 5]).to.be.equal(tokens[i]);
    }
  });
});
