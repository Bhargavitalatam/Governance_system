// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GovernanceVoting {
    IERC20 public votingToken;
    uint256 public proposalCount;

    struct Proposal {
        uint256 id;
        string description;
        bytes data;
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed proposalId, string description, bytes data);
    event ProposalPassed(uint256 indexed proposalId, bytes data);

    constructor(address _votingToken) {
        votingToken = IERC20(_votingToken);
    }

    function createProposal(string memory description, bytes memory data) external {
        uint256 proposalId = proposalCount++;
        Proposal storage p = proposals[proposalId];
        p.id = proposalId;
        p.description = description;
        p.data = data;
        
        emit ProposalCreated(proposalId, description, data);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Proposal already executed");
        require(!p.hasVoted[msg.sender], "Already voted");
        
        uint256 weight = votingToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");
        
        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }
        
        p.hasVoted[msg.sender] = true;

        // Simple majority check for passing immediately in this simulation
        if (p.votesFor > votingToken.totalSupply() / 2) {
            p.executed = true;
            emit ProposalPassed(proposalId, p.data);
        }
    }
}
