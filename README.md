# USDC Deployer

**Live Demo: [https://usdc-deployer.vercel.app/](https://usdc-deployer.vercel.app/)**

This project is a comprehensive tool for deploying and managing USDC smart contracts on EVM-compatible blockchains. It consists of the official Circle USDC smart contracts and a modern web interface to facilitate easy deployment and interaction.

## Project Overview

- **Smart Contracts**: Core USDC contracts (forked from [Circle's stablecoin-evm](https://github.com/circlefin/stablecoin-evm)).
- **Web Interface**: A Next.js-based dApp located in the `web/` directory that allows users to deploy and configure USDC instances via a GUI.

## Quick Start

### Web Interface (Frontend)

To run the deployment interface locally:

1. Navigate to the web directory:
   ```bash
   cd web
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Smart Contracts (Backend)

The smart contracts are managed with Hardhat and Foundry.

**Prerequisites:**
- Node 20.9.0
- Yarn 1.22.19
- [Foundry](https://getfoundry.sh/)

**Setup:**
```bash
# Install dependencies
yarn install

# Compile contracts
yarn compile

# Run tests
yarn test
```

## Deployment

### Web App (Vercel)
The web interface is optimized for deployment on Vercel.
1. Push this repository to GitHub.
2. Import the project in Vercel.
3. Set the **Root Directory** to `web`.
4. Deploy.

### Contracts (Manual)
If you prefer to deploy contracts using the CLI scripts instead of the web interface, refer to the `scripts/` directory and the original documentation below.

---

<!-- prettier-ignore-start -->
<!-- omit in toc -->
# Circle's Stablecoin Smart Contracts (Original Documentation)
<!-- prettier-ignore-end -->

*The following documentation pertains to the underlying smart contracts used in this project.*

This repository contains the smart contracts used by
[Circle's](https://www.circle.com/) stablecoins on EVM-compatible blockchains.
All contracts are written in [Solidity](https://soliditylang.org/) and managed
by the [Hardhat](https://hardhat.org/) framework.

## FiatToken features

The FiatToken offers a number of capabilities, which briefly are described
below. There are more [detailed design docs](./doc/tokendesign.md) in the `doc`
directory.

### ERC20 compatible

The FiatToken implements the ERC20 interface.

### Pausable

The entire contract can be frozen, in case a serious bug is found or there is a
serious key compromise. No transfers can take place while the contract is
paused. Access to the pause functionality is controlled by the `pauser` address.

### Upgradable

A new implementation contract can be deployed, and the proxy contract will
forward calls to the new contract. Access to the upgrade functionality is
guarded by a `proxyOwner` address. Only the `proxyOwner` address can change the
`proxyOwner` address.

### Blacklist

The contract can blacklist certain addresses which will prevent those addresses
from transferring or receiving tokens. Access to the blacklist functionality is
controlled by the `blacklister` address.

### Minting/Burning

Tokens can be minted or burned on demand. The contract supports having multiple
minters simultaneously. There is a `masterMinter` address which controls the
list of minters and how much each is allowed to mint. The mint allowance is
similar to the ERC20 allowance - as each minter mints new tokens their allowance
decreases. When it gets too low they will need the allowance increased again by
the `masterMinter`.

### Ownable

The contract has an Owner, who can change the `owner`, `pauser`, `blacklister`,
or `masterMinter` addresses. The `owner` can not change the `proxyOwner`
address.

## Additional Documentations

- [FiatToken design](./doc/tokendesign.md)
- [MasterMinter design](./doc/masterminter.md)
- [Deployment process](./doc/deployment.md)
- [Preparing an upgrade](./doc/upgrade.md)
- [Upgrading from v2.1 to v2.2](./doc/v2.2_upgrade.md)
- [Celo FiatToken extension](./doc/celo.md)