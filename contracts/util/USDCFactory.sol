/**
 * Copyright 2024 Circle Internet Group, Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import { FiatTokenProxy } from "../v1/FiatTokenProxy.sol";
import { MasterMinter } from "../minting/MasterMinter.sol";
import { FiatTokenV2_2 } from "../v2/FiatTokenV2_2.sol";

/**
 * @title USDC Factory
 * @notice Orchestrates the deployment and initialization of USDC components in a single transaction.
 */
contract USDCFactory {
    struct Config {
        string name;
        string symbol;
        string currency;
        uint8 decimals;
        address owner;
        address proxyAdmin;
    }

    event USDCDeployed(
        address proxy,
        address implementation,
        address masterMinter,
        address owner
    );

    // Storage variables to hold addresses for frontend retrieval after deployment
    address public proxy;
    address public implementation;
    address public masterMinter;

    /**
     * @notice Deploys a Proxy and MasterMinter, and initializes the USDC suite in one transaction.
     * @param _implementation The address of the pre-deployed FiatTokenV2_2 implementation.
     * @param config Configuration for the new token.
     */
    function deployUSDC(
        address _implementation,
        Config memory config
    ) public returns (address _proxyAddr, address _mmAddr) {
        implementation = _implementation;

        // 1. Deploy Proxy pointing to the Implementation
        // msg.sender of this call (the Factory) becomes the initial admin of the proxy
        FiatTokenProxy _proxy = new FiatTokenProxy(_implementation);
        _proxyAddr = address(_proxy);
        proxy = _proxyAddr;

        // 2. Deploy MasterMinter pointing to the new Proxy
        MasterMinter _mm = new MasterMinter(_proxyAddr);
        _mmAddr = address(_mm);
        masterMinter = _mmAddr;

        // 3. Setup MasterMinter ownership
        _mm.transferOwnership(config.owner);

        // 4. IMPORTANT: Change Proxy Admin BEFORE initialization
        // The admin of a proxy cannot call implementation functions (Transparent Proxy Pattern).
        // By changing the admin to the user's address first, the Factory (msg.sender)
        // is no longer the admin and can thus successfully call 'initialize' through the proxy.
        _proxy.changeAdmin(config.proxyAdmin);

        // 5. Initialize USDC logic through the Proxy
        _initializeProxy(_proxyAddr, _mmAddr, config);

        emit USDCDeployed(_proxyAddr, _implementation, _mmAddr, config.owner);
    }

    /**
     * @dev Private helper to handle initialization logic and avoid stack too deep errors.
     */
    function _initializeProxy(address _proxy, address _mm, Config memory _config) private {
        FiatTokenV2_2 proxyAsV2_2 = FiatTokenV2_2(_proxy);
        
        proxyAsV2_2.initialize(
            _config.name,
            _config.symbol,
            _config.currency,
            _config.decimals,
            _mm,
            _config.owner, // pauser
            _config.owner, // blacklister
            _config.owner  // owner
        );
        
        proxyAsV2_2.initializeV2(_config.name);
        proxyAsV2_2.initializeV2_1(_config.owner);
        proxyAsV2_2.initializeV2_2(new address[](0), _config.symbol);
    }
}