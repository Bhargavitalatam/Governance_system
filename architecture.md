# System Architecture: Two-Chain Asset Bridge

The system consists of two independent blockchains, a Node.js relayer service, and an emergency governance mechanism.

## Component Overview

### 1. Chain A (Settlement Chain)
- **VaultToken**: The source ERC20 token to be bridged.
- **BridgeLock**: Handles locking of tokens on Chain A. Emits `Locked` events. Restricted `unlock` function for the relayer.
- **GovernanceEmergency**: Receives commands from the relayer to pause/unpause the bridge.

### 2. Chain B (Execution Chain)
- **WrappedVaultToken**: A representative ERC20 token minted/burned on Chain B.
- **BridgeMint**: Handles minting of wrapped tokens upon receiving `Locked` events from Chain A. Handles burning of tokens and emits `Burned` events.
- **GovernanceVoting**: A simple on-chain voting contract where wrapped token holders can vote on proposals.

### 3. Relayer (Node.js Service)
- **Event Monitoring**: Consistently polls both chains for events (`Locked`, `Burned`, `ProposalPassed`).
- **Confirmation Delay**: Waits for 3 block confirmations before processing any event to mitigate reorganization risks.
- **Persistence**: Records processed nonces in `processed_nonces.json` to prevent replay attacks and allow recovery from crashes.
- **Idempotency**: Ensures that if a transaction is submitted twice, the on-chain nonce check prevents double processing.

## Transaction Flows

### Bridging: Chain A -> Chain B
1. User calls `BridgeLock.lock(amount)`.
2. `BridgeLock` transfers `VaultToken` from User to itself and emits `Locked(user, amount, nonce)`.
3. Relayer detects `Locked` event after 3 confirmations.
4. Relayer calls `BridgeMint.mintWrapped(user, amount, nonce)` on Chain B.
5. `BridgeMint` mints `WrappedVaultToken` to the User.

### Withdrawing: Chain B -> Chain A
1. User calls `BridgeMint.burn(amount)`.
2. `BridgeMint` burns `WrappedVaultToken` and emits `Burned(user, amount, nonce)`.
3. Relayer detects `Burned` event after 3 confirmations.
4. Relayer calls `BridgeLock.unlock(user, amount, nonce)` on Chain A.
5. `BridgeLock` transfers `VaultToken` to the User.

### Emergency Governance
1. Users vote on `GovernanceVoting` on Chain B.
2. If a proposal passes, it emits `ProposalPassed(proposalId, data)`.
3. Relayer detects `ProposalPassed` and calls `GovernanceEmergency.pauseBridge()` on Chain A.
4. `GovernanceEmergency` pauses `BridgeLock`, halting all bridging activity.

## Persistence & Recovery
- The relayer state is stored in a volume-mounted JSON file.
- On restart, the relayer loads all previously processed nonces.
- It scans the chain history from block 0 to ensure no events were missed while offline.
