// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract BridgeLock is Pausable, AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    IERC20 public vaultToken;

    mapping(uint256 => bool) public processedNonces;

    event Locked(address indexed user, uint256 amount, uint256 nonce);
    event Unlocked(address indexed user, uint256 amount, uint256 nonce);

    uint256 public nextNonce;

    constructor(address _vaultToken, address _admin) {
        vaultToken = IERC20(_vaultToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function lock(uint256 amount) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(vaultToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        uint256 nonce = nextNonce++;
        emit Locked(msg.sender, amount, nonce);
    }

    function unlock(address user, uint256 amount, uint256 nonce) external onlyRole(RELAYER_ROLE) {
        require(!processedNonces[nonce], "Nonce already processed");
        processedNonces[nonce] = true;
        
        require(vaultToken.transfer(user, amount), "Transfer failed");
        emit Unlocked(user, amount, nonce);
    }

    function pause() external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(EMERGENCY_ROLE, msg.sender), "Caller is not admin or emergency");
        _pause();
    }

    function unpause() external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(EMERGENCY_ROLE, msg.sender), "Caller is not admin or emergency");
        _unpause();
    }
}
