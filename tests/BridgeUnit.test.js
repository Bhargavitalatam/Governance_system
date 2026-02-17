const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Bridge Contracts Unit Tests", function () {
  let VaultToken, BridgeLock, GovernanceEmergency;
  let WrappedVaultToken, BridgeMint, GovernanceVoting;
  let token, bridgeLock, govEmergency;
  let wrappedToken, bridgeMint, govVoting;
  let owner, relayer, user;

  beforeEach(async function () {
    [owner, relayer, user] = await ethers.getSigners();

    // Chain A setup
    VaultToken = await ethers.getContractFactory("VaultToken");
    token = await VaultToken.deploy();

    BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridgeLock = await BridgeLock.deploy(token.target, owner.address);

    GovernanceEmergency = await ethers.getContractFactory("GovernanceEmergency");
    govEmergency = await GovernanceEmergency.deploy(bridgeLock.target, owner.address);

    // Chain B setup
    WrappedVaultToken = await ethers.getContractFactory("WrappedVaultToken");
    wrappedToken = await WrappedVaultToken.deploy(owner.address);

    BridgeMint = await ethers.getContractFactory("BridgeMint");
    bridgeMint = await BridgeMint.deploy(wrappedToken.target, owner.address);

    GovernanceVoting = await ethers.getContractFactory("GovernanceVoting");
    govVoting = await GovernanceVoting.deploy(wrappedToken.target);

    // Setup roles
    const RELAYER_ROLE = await bridgeLock.RELAYER_ROLE();
    const EMERGENCY_ROLE = await bridgeLock.EMERGENCY_ROLE();
    await bridgeLock.grantRole(RELAYER_ROLE, relayer.address);
    await bridgeLock.grantRole(EMERGENCY_ROLE, govEmergency.target);
    await govEmergency.grantRole(RELAYER_ROLE, relayer.address);
    await bridgeMint.grantRole(RELAYER_ROLE, relayer.address);

    const MINTER_ROLE = await wrappedToken.MINTER_ROLE();
    const BURNER_ROLE = await wrappedToken.BURNER_ROLE();
    await wrappedToken.grantRole(MINTER_ROLE, bridgeMint.target);
    await wrappedToken.grantRole(BURNER_ROLE, bridgeMint.target);
  });

  describe("BridgeLock (Chain A)", function () {
    it("Should lock tokens and emit event", async function () {
      const amount = ethers.parseEther("100");
      await token.transfer(user.address, amount);
      await token.connect(user).approve(bridgeLock.target, amount);

      await expect(bridgeLock.connect(user).lock(amount))
        .to.emit(bridgeLock, "Locked")
        .withArgs(user.address, amount, 0);

      expect(await token.balanceOf(bridgeLock.target)).to.equal(amount);
    });

    it("Should unlock tokens (restricted to relayer)", async function () {
      const amount = ethers.parseEther("100");
      await token.transfer(bridgeLock.target, amount);

      await expect(bridgeLock.connect(relayer).unlock(user.address, amount, 0))
        .to.emit(bridgeLock, "Unlocked")
        .withArgs(user.address, amount, 0);

      expect(await token.balanceOf(user.address)).to.equal(amount);
    });

    it("Should prevent double unlock with same nonce", async function () {
      const amount = ethers.parseEther("100");
      await token.transfer(bridgeLock.target, amount);
      await bridgeLock.connect(relayer).unlock(user.address, amount, 0);
      await expect(bridgeLock.connect(relayer).unlock(user.address, amount, 0))
        .to.be.revertedWith("Nonce already processed");
    });
  });

  describe("BridgeMint (Chain B)", function () {
    it("Should mint wrapped tokens (restricted to relayer)", async function () {
      const amount = ethers.parseEther("100");
      await expect(bridgeMint.connect(relayer).mintWrapped(user.address, amount, 0))
        .to.emit(bridgeMint, "Minted")
        .withArgs(user.address, amount, 0);

      expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
    });

    it("Should burn wrapped tokens and emit event", async function () {
      const amount = ethers.parseEther("100");
      await bridgeMint.connect(relayer).mintWrapped(user.address, amount, 0);

      await expect(bridgeMint.connect(user).burn(amount))
        .to.emit(bridgeMint, "Burned")
        .withArgs(user.address, amount, 0);

      expect(await wrappedToken.balanceOf(user.address)).to.equal(0);
    });

    it("Should prevent double mint with same nonce", async function () {
      const amount = ethers.parseEther("100");
      await bridgeMint.connect(relayer).mintWrapped(user.address, amount, 0);
      await expect(bridgeMint.connect(relayer).mintWrapped(user.address, amount, 0))
        .to.be.revertedWith("Nonce already processed");
    });
  });

  describe("Governance", function () {
    it("Should pause bridge via emergency governance", async function () {
      await govEmergency.connect(relayer).pauseBridge();
      expect(await bridgeLock.paused()).to.be.true;

      const amount = ethers.parseEther("10");
      await expect(bridgeLock.connect(user).lock(amount))
        .to.be.revertedWithCustomError(bridgeLock, "EnforcedPause");
    });

    it("Should pass proposal and emit event", async function () {
      const amount = ethers.parseEther("100");
      await bridgeMint.connect(relayer).mintWrapped(user.address, amount, 0);

      const data = "0x";
      await govVoting.connect(user).createProposal("Pause Bridge", data);

      await expect(govVoting.connect(user).vote(0, true))
        .to.emit(govVoting, "ProposalPassed")
        .withArgs(0, data);
    });
  });
});
