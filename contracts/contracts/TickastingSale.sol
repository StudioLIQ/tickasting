// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TickastingSale
 * @notice On-chain claim/mint contract for Tickasting fair-queue ticketing.
 *         Off-chain engine on Kaspa determines winners via deterministic ordering.
 *         Winners claim ERC-721 tickets here using Merkle proofs.
 */
contract TickastingSale is ERC721Enumerable, Ownable, ReentrancyGuard {
    struct TicketType {
        bytes32 code;
        string name;
        uint256 priceSompi;
        uint256 supply;
        uint256 minted;
        string metadataUri;
        bool active;
    }

    // ─── State ───
    bytes32 public saleId;
    address public organizer;
    uint256 public startAt;
    uint256 public endAt;
    bytes32 public merkleRoot;
    bool public claimOpen;
    bool public finalized;

    bytes32[] public ticketTypeCodes;
    mapping(bytes32 => TicketType) public ticketTypes;
    mapping(bytes32 => bool) public claimed; // kaspaTxid => already claimed
    mapping(uint256 => bytes32) public tokenType; // tokenId => typeCode
    uint256 public nextTokenId;

    // ─── Events ───
    event SaleCreated(
        bytes32 indexed saleId,
        address indexed organizer,
        uint256 startAt,
        uint256 endAt
    );

    event TicketTypeDefined(
        bytes32 indexed saleId,
        bytes32 indexed typeCode,
        string name,
        uint256 supply,
        uint256 priceSompi
    );

    event ClaimOpened(bytes32 indexed saleId, bytes32 merkleRoot);

    event TicketClaimed(
        bytes32 indexed saleId,
        bytes32 indexed typeCode,
        address indexed claimer,
        uint256 tokenId,
        bytes32 kaspaTxid,
        uint256 finalRank
    );

    event SaleFinalized(bytes32 indexed saleId, uint256 totalMinted);

    // ─── Modifiers ───
    modifier onlyOrganizer() {
        require(msg.sender == organizer, "Not organizer");
        _;
    }

    modifier saleNotFinalized() {
        require(!finalized, "Sale already finalized");
        _;
    }

    // ─── Constructor ───
    constructor() ERC721("Tickasting Ticket", "TKST") Ownable(msg.sender) {
        nextTokenId = 1;
    }

    // ─── Admin Functions ───

    function createSale(
        bytes32 _saleId,
        address _organizer,
        uint256 _startAt,
        uint256 _endAt
    ) external onlyOwner {
        require(saleId == bytes32(0), "Sale already created");
        require(_organizer != address(0), "Invalid organizer");

        saleId = _saleId;
        organizer = _organizer;
        startAt = _startAt;
        endAt = _endAt;

        emit SaleCreated(_saleId, _organizer, _startAt, _endAt);
    }

    function defineTicketType(
        bytes32 _code,
        string calldata _name,
        uint256 _priceSompi,
        uint256 _supply,
        string calldata _metadataUri
    ) external onlyOrganizer saleNotFinalized {
        require(_supply > 0, "Supply must be positive");
        require(ticketTypes[_code].supply == 0, "Type already defined");

        ticketTypes[_code] = TicketType({
            code: _code,
            name: _name,
            priceSompi: _priceSompi,
            supply: _supply,
            minted: 0,
            metadataUri: _metadataUri,
            active: true
        });
        ticketTypeCodes.push(_code);

        emit TicketTypeDefined(saleId, _code, _name, _supply, _priceSompi);
    }

    function openClaim(bytes32 _merkleRoot) external onlyOrganizer saleNotFinalized {
        require(_merkleRoot != bytes32(0), "Invalid merkle root");
        merkleRoot = _merkleRoot;
        claimOpen = true;

        emit ClaimOpened(saleId, _merkleRoot);
    }

    function finalizeSale() external onlyOrganizer saleNotFinalized {
        finalized = true;
        claimOpen = false;

        emit SaleFinalized(saleId, nextTokenId - 1);
    }

    // ─── Public Functions ───

    function claimTicket(
        bytes32 _ticketTypeCode,
        bytes32 _kaspaTxid,
        uint256 _finalRank,
        bytes32[] calldata _merkleProof
    ) external nonReentrant {
        require(claimOpen, "Claim not open");
        require(!finalized, "Sale finalized");
        require(!claimed[_kaspaTxid], "Already claimed");

        TicketType storage tt = ticketTypes[_ticketTypeCode];
        require(tt.active, "Ticket type not active");
        require(tt.minted < tt.supply, "Sold out");

        // Verify Merkle proof
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, _ticketTypeCode, _kaspaTxid, _finalRank)
        );
        require(
            MerkleProof.verify(_merkleProof, merkleRoot, leaf),
            "Invalid proof"
        );

        // Mint
        claimed[_kaspaTxid] = true;
        tt.minted += 1;

        uint256 tokenId = nextTokenId++;
        tokenType[tokenId] = _ticketTypeCode;
        _safeMint(msg.sender, tokenId);

        emit TicketClaimed(
            saleId,
            _ticketTypeCode,
            msg.sender,
            tokenId,
            _kaspaTxid,
            _finalRank
        );
    }

    // ─── View Functions ───

    function getTicketType(bytes32 _code) external view returns (TicketType memory) {
        return ticketTypes[_code];
    }

    function getTicketTypeCodes() external view returns (bytes32[] memory) {
        return ticketTypeCodes;
    }

    function getRemainingSupply(bytes32 _code) external view returns (uint256) {
        TicketType storage tt = ticketTypes[_code];
        if (tt.supply == 0) return 0;
        return tt.supply - tt.minted;
    }

    function isClaimed(bytes32 _kaspaTxid) external view returns (bool) {
        return claimed[_kaspaTxid];
    }

    function getTokenTicketType(uint256 _tokenId) external view returns (bytes32) {
        return tokenType[_tokenId];
    }
}
