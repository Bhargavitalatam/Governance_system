const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

// Porting a simplified version of the relayer logic for the recovery test
async function syncEventsMock(bridgeLock, bridgeMint, processedEvents, providerA, confirmationDepth) {
    const latestA = await providerA.getBlockNumber();
    const lockFilter = bridgeLock.filters.Locked();
    const lockLogs = await bridgeLock.queryFilter(lockFilter, 0, latestA - confirmationDepth);

    let processedCount = 0;
    for (const log of lockLogs) {
        const { user, amount, nonce } = log.args;
        const nonceStr = nonce.toString();
        if (!processedEvents.chainA.locks.includes(nonceStr)) {
            await bridgeMint.mintWrapped(user, amount, nonce);
            processedEvents.chainA.locks.push(nonceStr);
            processedCount++;
        }
    }
    return processedCount;
}

describe("Relayer Crash Recovery Test", function () {
    let vaultToken, bridgeLock, wrappedToken, bridgeMint;
    let owner, user, relayer;

    beforeEach(async function () {
        [owner, user, relayer] = await ethers.getSigners();

        const VaultToken = await ethers.getContractFactory("VaultToken");
        vaultToken = await VaultToken.deploy();

        const BridgeLock = await ethers.getContractFactory("BridgeLock");
        bridgeLock = await BridgeLock.deploy(vaultToken.target, owner.address);

        const WrappedVaultToken = await ethers.getContractFactory("WrappedVaultToken");
        wrappedToken = await WrappedVaultToken.deploy(owner.address);

        const BridgeMint = await ethers.getContractFactory("BridgeMint");
        bridgeMint = await BridgeMint.deploy(wrappedToken.target, owner.address);

        // Roles
        const RELAYER_ROLE = await bridgeLock.RELAYER_ROLE();
        await bridgeLock.grantRole(RELAYER_ROLE, relayer.address);
        await bridgeMint.grantRole(RELAYER_ROLE, relayer.address);
        await wrappedToken.grantRole(await wrappedToken.MINTER_ROLE(), bridgeMint.target);
    });

    it("Should detect and process events that occurred while relayer was offline", async function () {
        const amount = ethers.parseEther("10");
        const confirmationDepth = 0; // Set to 0 for instant processing in this test
        const processedEvents = { chainA: { locks: [] } };

        // 1. Relayer is 'offline' (we don't call syncEvents yet)
        await vaultToken.transfer(user.address, amount);
        await vaultToken.connect(user).approve(bridgeLock.target, amount);
        await bridgeLock.connect(user).lock(amount);

        // Verify user has no wrapped tokens yet
        expect(await wrappedToken.balanceOf(user.address)).to.equal(0);

        // 2. Relayer 'starts up' and scans history
        console.log("Relayer starting up and scanning for missed events...");
        const processed = await syncEventsMock(
            bridgeLock.connect(relayer),
            bridgeMint.connect(relayer),
            processedEvents,
            ethers.provider,
            confirmationDepth
        );

        expect(processed).to.equal(1);
        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
        expect(processedEvents.chainA.locks).to.include("0");
    });
});
