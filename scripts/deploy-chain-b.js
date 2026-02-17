const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts to Chain B with account:", deployer.address);

    const WrappedVaultToken = await hre.ethers.getContractFactory("WrappedVaultToken");
    const wrappedToken = await WrappedVaultToken.deploy(deployer.address);
    await wrappedToken.waitForDeployment();
    console.log("WrappedVaultToken deployed to:", wrappedToken.target);

    const BridgeMint = await hre.ethers.getContractFactory("BridgeMint");
    const bridgeMint = await BridgeMint.deploy(wrappedToken.target, deployer.address);
    await bridgeMint.waitForDeployment();
    console.log("BridgeMint deployed to:", bridgeMint.target);

    const GovernanceVoting = await hre.ethers.getContractFactory("GovernanceVoting");
    const govVoting = await GovernanceVoting.deploy(wrappedToken.target);
    await govVoting.waitForDeployment();
    console.log("GovernanceVoting deployed to:", govVoting.target);

    // Set up roles
    const RELAYER_ROLE = await bridgeMint.RELAYER_ROLE();
    const MINTER_ROLE = await wrappedToken.MINTER_ROLE();
    const BURNER_ROLE = await wrappedToken.BURNER_ROLE();

    await bridgeMint.grantRole(RELAYER_ROLE, deployer.address);
    await wrappedToken.grantRole(MINTER_ROLE, bridgeMint.target);
    await wrappedToken.grantRole(BURNER_ROLE, bridgeMint.target);

    console.log("Chain B setup complete.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
