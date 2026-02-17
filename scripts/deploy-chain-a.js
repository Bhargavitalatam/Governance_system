const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts to Chain A with account:", deployer.address);

    const VaultToken = await hre.ethers.getContractFactory("VaultToken");
    const vaultToken = await VaultToken.deploy();
    await vaultToken.waitForDeployment();
    console.log("VaultToken deployed to:", vaultToken.target);

    const BridgeLock = await hre.ethers.getContractFactory("BridgeLock");
    const bridgeLock = await BridgeLock.deploy(vaultToken.target, deployer.address);
    await bridgeLock.waitForDeployment();
    console.log("BridgeLock deployed to:", bridgeLock.target);

    const GovernanceEmergency = await hre.ethers.getContractFactory("GovernanceEmergency");
    const govEmergency = await GovernanceEmergency.deploy(bridgeLock.target, deployer.address);
    await govEmergency.waitForDeployment();
    console.log("GovernanceEmergency deployed to:", govEmergency.target);

    // Set up roles
    const RELAYER_ROLE = await bridgeLock.RELAYER_ROLE();
    const EMERGENCY_ROLE = await bridgeLock.EMERGENCY_ROLE();
    await bridgeLock.grantRole(RELAYER_ROLE, deployer.address); // Deployer acts as relayer for now
    await bridgeLock.grantRole(EMERGENCY_ROLE, govEmergency.target);
    await govEmergency.grantRole(RELAYER_ROLE, deployer.address);

    console.log("Chain A setup complete.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
