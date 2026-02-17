const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

describe("Bridge Integration Tests", function () {
    let vaultToken, bridgeLock, govEmergency;
    let wrappedToken, bridgeMint, govVoting;
    let owner, user;

    before(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy everything (similar to deployment scripts)
        const VaultToken = await ethers.getContractFactory("VaultToken");
        vaultToken = await VaultToken.deploy();

        const BridgeLock = await ethers.getContractFactory("BridgeLock");
        bridgeLock = await BridgeLock.deploy(vaultToken.target, owner.address);

        const GovernanceEmergency = await ethers.getContractFactory("GovernanceEmergency");
        govEmergency = await GovernanceEmergency.deploy(bridgeLock.target, owner.address);

        const WrappedVaultToken = await ethers.getContractFactory("WrappedVaultToken");
        wrappedToken = await WrappedVaultToken.deploy(owner.address);

        const BridgeMint = await ethers.getContractFactory("BridgeMint");
        bridgeMint = await BridgeMint.deploy(wrappedToken.target, owner.address);

        const GovernanceVoting = await ethers.getContractFactory("GovernanceVoting");
        govVoting = await GovernanceVoting.deploy(wrappedToken.target);

        // Setup roles
        const RELAYER_ROLE = await bridgeLock.RELAYER_ROLE();
        const EMERGENCY_ROLE = await bridgeLock.EMERGENCY_ROLE();
        const MINTER_ROLE = await wrappedToken.MINTER_ROLE();
        const BURNER_ROLE = await wrappedToken.BURNER_ROLE();

        await bridgeLock.grantRole(RELAYER_ROLE, owner.address); // Owner acts as relayer
        await bridgeLock.grantRole(EMERGENCY_ROLE, govEmergency.target);
        await govEmergency.grantRole(RELAYER_ROLE, owner.address);
        await bridgeMint.grantRole(RELAYER_ROLE, owner.address);
        await wrappedToken.grantRole(MINTER_ROLE, bridgeMint.target);
        await wrappedToken.grantRole(BURNER_ROLE, bridgeMint.target);
    });

    it("Should complete full Lock -> Mint -> Burn -> Unlock cycle", async function () {
        const amount = ethers.parseEther("50");
        await vaultToken.transfer(user.address, amount);

        const balanceBeforeLock = await vaultToken.balanceOf(user.address);
        await vaultToken.connect(user).approve(bridgeLock.target, amount);

        // 1. Lock on Chain A
        const lockTx = await bridgeLock.connect(user).lock(amount);
        await lockTx.wait();

        const balanceAfterLock = await vaultToken.balanceOf(user.address);
        expect(balanceBeforeLock - balanceAfterLock).to.equal(amount);

        // Emulate relayer behavior (the logic itself is tested in relayer/index.js and Recovery.test.js)
        const lockReceipt = await lockTx.wait();
        const lockEvent = lockReceipt.logs.find(x => x.fragment && x.fragment.name === 'Locked');
        const nonce = lockEvent.args.nonce;

        // 2. Relayer call Mint on Chain B
        await bridgeMint.mintWrapped(user.address, amount, nonce);
        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);

        // Invariant Check 1: After Lock-and-Mint
        expect(await vaultToken.balanceOf(bridgeLock.target)).to.equal(await wrappedToken.totalSupply());

        // 3. Burn on Chain B
        const wrappedBalanceBeforeBurn = await wrappedToken.balanceOf(user.address);
        const burnTx = await bridgeMint.connect(user).burn(amount);
        const burnReceipt = await burnTx.wait();

        const wrappedBalanceAfterBurn = await wrappedToken.balanceOf(user.address);
        expect(wrappedBalanceBeforeBurn - wrappedBalanceAfterBurn).to.equal(amount);

        const burnEvent = burnReceipt.logs.find(x => x.fragment && x.fragment.name === 'Burned');
        const burnNonce = burnEvent.args.nonce;

        // 4. Relayer call Unlock on Chain A
        const balanceBeforeUnlock = await vaultToken.balanceOf(user.address);
        await bridgeLock.unlock(user.address, amount, burnNonce);
        const balanceAfterUnlock = await vaultToken.balanceOf(user.address);

        expect(balanceAfterUnlock - balanceBeforeUnlock).to.equal(amount);
        expect(balanceAfterUnlock).to.equal(ethers.parseEther("50")); // Original total returned

        // Invariant Check 2: After Burn-and-Unlock
        expect(await vaultToken.balanceOf(bridgeLock.target)).to.equal(await wrappedToken.totalSupply());
        expect(await wrappedToken.totalSupply()).to.equal(0);
    });

    it("Should pause bridge via cross-chain governance simulation", async function () {
        const amount = ethers.parseEther("100");
        await bridgeMint.mintWrapped(user.address, amount, 999); // Give user voting power

        // 1. Pass proposal on Chain B
        const data = "0x";
        await govVoting.connect(user).createProposal("Emergency Pause", data);
        await govVoting.connect(user).vote(0, true);

        // 2. Relayer detects ProposalPassed and calls pauseBridge on Chain A
        await govEmergency.pauseBridge();
        expect(await bridgeLock.paused()).to.be.true;

        // 3. Verify bridge is paused
        await expect(bridgeLock.connect(user).lock(ethers.parseEther("1")))
            .to.be.revertedWithCustomError(bridgeLock, "EnforcedPause");
    });
});
