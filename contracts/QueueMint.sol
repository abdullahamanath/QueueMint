// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title QueueMint — on-chain "skip-the-line" passes
/// @notice A venue (any queue: an airport gate, a ramen counter, a support desk, a rate-limited API)
///         opens a fresh, hard-capped daily edition of skip-passes. Anyone — a person or an x402-paying
///         agent — mints one for a few cents of native USDC; the full payment is forwarded straight to the
///         venue owner, so the contract never holds a balance. A pass is bound to its buyer and its UTC day
///         and is BURNED when redeemed at the front of the line — provably one-time, no resale-after-use. An
///         autonomous CURATOR agent (a per-venue role with zero money authority) authors each day's edition
///         size and surge/decay price; it can never exceed the venue's immutable daily ceiling or move a cent.
///         No owner, no admin, no protocol fee, no custody. Built for ARC: cent-scale native-USDC mints and
///         agents that price + settle on-chain — a line-skip market that only pencils out where USDC is gas.
contract QueueMint {
    struct Venue {
        uint256 id;
        address owner;       // receives 100% of every mint
        address agent;       // curator (0 = owner acts); may open/price editions, never moves money
        string name;
        string uri;          // image / metadata
        uint32 maxDailyCap;  // immutable hard ceiling (1..10000)
        uint64 createdAt;
        bool active;
    }

    struct Edition {
        uint64 day;          // block.timestamp / 1 days
        uint256 price;       // native USDC per pass
        uint32 cap;          // today's print run (<= maxDailyCap)
        uint32 minted;
        uint32 redeemed;
        bool open;
    }

    struct Pass {
        uint256 id;
        uint256 venueId;
        uint64 day;
        uint32 serial;       // 1..cap (the print number)
        address owner;       // address(0) once burned
        bool redeemed;
    }

    uint256 public constant MAX_PRICE = 1000 ether;
    uint32 public constant MAX_CAP = 10000;
    uint256 public constant MAX_STR = 120;

    uint256 public venueCount;
    uint256 public passCount;
    uint256 public mintVolume;       // lifetime USDC routed through mints
    uint256 public passesMinted;     // lifetime
    uint256 public passesRedeemed;   // lifetime

    mapping(uint256 => Venue) public venues;
    mapping(uint256 => mapping(uint64 => Edition)) private _editions; // venueId => day => Edition
    mapping(uint256 => Pass) public passes;
    mapping(address => uint256[]) private _owned;        // live (un-burned) passes per holder
    mapping(uint256 => uint256) private _ownedIdx;       // passId => 1-based index in _owned

    event VenueCreated(uint256 indexed id, address indexed owner, address agent, string name, uint32 maxDailyCap);
    event AgentSet(uint256 indexed id, address agent);
    event EditionOpened(uint256 indexed id, uint64 day, uint256 price, uint32 cap);
    event PriceSet(uint256 indexed id, uint64 day, uint256 price, uint32 cap);
    event Minted(uint256 indexed passId, uint256 indexed venueId, address indexed to, uint32 serial, uint256 paid);
    event Redeemed(uint256 indexed passId, uint256 indexed venueId, address indexed who);

    function today() public view returns (uint64) { return uint64(block.timestamp / 1 days); }

    // ── venue owner ─────────────────────────────────────────
    function createVenue(string calldata name, string calldata uri, address agent, uint32 maxDailyCap) external returns (uint256) {
        require(bytes(name).length > 0 && bytes(name).length <= MAX_STR, "bad name");
        require(bytes(uri).length <= 400, "bad uri");
        require(maxDailyCap >= 1 && maxDailyCap <= MAX_CAP, "bad cap");
        uint256 id = ++venueCount;
        Venue storage v = venues[id];
        v.id = id; v.owner = msg.sender; v.agent = agent; v.name = name; v.uri = uri;
        v.maxDailyCap = maxDailyCap; v.createdAt = uint64(block.timestamp); v.active = true;
        emit VenueCreated(id, msg.sender, agent, name, maxDailyCap);
        return id;
    }

    function setAgent(uint256 venueId, address agent) external {
        Venue storage v = venues[venueId];
        require(v.owner == msg.sender, "not owner");
        v.agent = agent;
        emit AgentSet(venueId, agent);
    }

    function setActive(uint256 venueId, bool active) external {
        Venue storage v = venues[venueId];
        require(v.owner == msg.sender, "not owner");
        v.active = active;
    }

    // ── curator (owner OR agent) ────────────────────────────
    function _isCurator(Venue storage v) private view returns (bool) {
        return msg.sender == v.owner || (v.agent != address(0) && msg.sender == v.agent);
    }

    /// @notice Open today's limited edition (once per UTC day). Curator (owner or agent).
    function openEdition(uint256 venueId, uint256 price, uint32 cap) external {
        Venue storage v = venues[venueId];
        require(v.id != 0 && v.active, "no venue");
        require(_isCurator(v), "not curator");
        require(price > 0 && price <= MAX_PRICE, "bad price");
        require(cap >= 1 && cap <= v.maxDailyCap, "bad cap");
        uint64 d = today();
        Edition storage e = _editions[venueId][d];
        require(!e.open, "already open");
        e.day = d; e.price = price; e.cap = cap; e.open = true;
        emit EditionOpened(venueId, d, price, cap);
    }

    /// @notice Surge/decay today's price + run size. Curator. Can't drop cap below sold or above the ceiling.
    function setPrice(uint256 venueId, uint256 price, uint32 cap) external {
        Venue storage v = venues[venueId];
        require(v.id != 0, "no venue");
        require(_isCurator(v), "not curator");
        require(price > 0 && price <= MAX_PRICE, "bad price");
        Edition storage e = _editions[venueId][today()];
        require(e.open, "no edition");
        require(cap >= e.minted && cap <= v.maxDailyCap, "bad cap");
        e.price = price; e.cap = cap;
        emit PriceSet(venueId, e.day, price, cap);
    }

    // ── mint (anyone / x402 agent) ──────────────────────────
    /// @notice Mint one skip-pass at today's price. The full payment is forwarded to the venue owner.
    function mint(uint256 venueId) external payable returns (uint256) {
        Venue storage v = venues[venueId];
        require(v.id != 0 && v.active, "no venue");
        Edition storage e = _editions[venueId][today()];
        require(e.open, "edition closed");
        require(e.minted < e.cap, "sold out today");
        require(msg.value >= e.price, "underpaid");

        uint32 serial = e.minted + 1;
        e.minted = serial;
        uint256 pid = ++passCount;
        Pass storage p = passes[pid];
        p.id = pid; p.venueId = venueId; p.day = e.day; p.serial = serial; p.owner = msg.sender;
        _owned[msg.sender].push(pid);
        _ownedIdx[pid] = _owned[msg.sender].length;
        passesMinted += 1;
        mintVolume += msg.value;

        // interaction: forward the whole payment to the venue owner (contract keeps zero balance)
        (bool ok, ) = payable(v.owner).call{value: msg.value}("");
        require(ok, "pay failed");
        emit Minted(pid, venueId, msg.sender, serial, msg.value);
        return pid;
    }

    /// @notice Redeem (burn) a pass at the front of the line — owner only, today only, once.
    function redeem(uint256 passId) external {
        Pass storage p = passes[passId];
        require(p.owner == msg.sender, "not your pass");
        require(!p.redeemed, "already redeemed");
        require(p.day == today(), "not valid today");

        p.redeemed = true;
        p.owner = address(0);
        _editions[p.venueId][p.day].redeemed += 1;
        passesRedeemed += 1;
        _removeOwned(msg.sender, passId);
        emit Redeemed(passId, p.venueId, msg.sender);
    }

    function _removeOwned(address holder, uint256 passId) private {
        uint256 idx = _ownedIdx[passId];
        if (idx == 0) return;
        uint256[] storage arr = _owned[holder];
        uint256 last = arr.length;
        if (idx != last) {
            uint256 moved = arr[last - 1];
            arr[idx - 1] = moved;
            _ownedIdx[moved] = idx;
        }
        arr.pop();
        _ownedIdx[passId] = 0;
    }

    // ── views ───────────────────────────────────────────────
    function getVenue(uint256 id) external view returns (Venue memory) { return venues[id]; }
    function getEdition(uint256 venueId, uint64 day) external view returns (Edition memory) { return _editions[venueId][day]; }
    function todayEdition(uint256 venueId) external view returns (Edition memory) { return _editions[venueId][today()]; }
    function getPass(uint256 passId) external view returns (Pass memory) { return passes[passId]; }
    function ownedPasses(address who) external view returns (uint256[] memory) { return _owned[who]; }

    /// @notice Live "skips left today" — the dramatic gallery numeral.
    function remainingToday(uint256 venueId) external view returns (uint32) {
        Edition storage e = _editions[venueId][today()];
        if (!e.open || e.minted >= e.cap) return 0;
        return e.cap - e.minted;
    }

    /// @notice The doorman / x402 verifier check: a pass is valid iff un-burned and for the current day.
    function isValidToday(uint256 passId) external view returns (bool) {
        Pass storage p = passes[passId];
        return p.owner != address(0) && !p.redeemed && p.day == today();
    }
}
