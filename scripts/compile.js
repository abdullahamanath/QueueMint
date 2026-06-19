const fs = require("fs");
const path = require("path");
const solc = require("solc");

const source = fs.readFileSync(path.join(__dirname, "../contracts/QueueMint.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "QueueMint.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors) { let fatal = false; for (const e of out.errors) { console.log(e.formattedMessage); if (e.severity === "error") fatal = true; } if (fatal) process.exit(1); }
const c = out.contracts["QueueMint.sol"]["QueueMint"];
const shortVersion = "v" + solc.version().replace(/\.Emscripten.*$/, "");
fs.writeFileSync(path.join(__dirname, "../lib/queuemint_build.json"), JSON.stringify({
  contractName: "QueueMint", compilerVersion: shortVersion, evmVersion: "paris", optimizer: { enabled: true, runs: 200 },
  abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, source,
}, null, 2));
console.log("compiler:", shortVersion, "| bytecode:", ("0x" + c.evm.bytecode.object).length, "| abi:", c.abi.length);
