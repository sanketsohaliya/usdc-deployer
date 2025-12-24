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

interface IFiatTokenProxy {
    function changeAdmin(address newAdmin) external;
}

interface IMasterMinter {
    function transferOwnership(address newOwner) external;
}

interface IFiatTokenV2_2 {
    function initialize(
        string calldata name,
        string calldata symbol,
        string calldata currency,
        uint8 decimals,
        address masterMinter,
        address pauser,
        address blacklister,
        address owner
    ) external;
    function initializeV2(string calldata name) external;
    function initializeV2_1(address lostAndFoundMetaToken) external;
    function initializeV2_2(address[] calldata accountsToBlacklist, string calldata newSymbol) external;
}

/**
 * @title USDC Batch Deployer
 * @notice Orchestrates the deployment and initialization of USDC components in one transaction.
 */
contract USDCBatchDeployer {
    address public proxy;
    address public implementation;
    address public masterMinter;

    struct Config {
        string name;
        string symbol;
        string currency;
        uint8 decimals;
        address owner;
        address proxyAdmin;
    }

    constructor(
        bytes memory implBytecode,
        bytes memory proxyBaseBytecode, 
        bytes memory mmBaseBytecode,
        Config memory config
    ) public {
        // 1. Deploy Implementation
        address _impl;
        assembly {
            _impl := create(0, add(implBytecode, 0x20), mload(implBytecode))
        }
        require(_impl != address(0), "USDCBatchDeployer: Impl deployment failed");
        implementation = _impl;

        // 2. Deploy Proxy
        bytes memory proxyFullBytecode = abi.encodePacked(proxyBaseBytecode, abi.encode(_impl));
        address _proxy;
        assembly {
            _proxy := create(0, add(proxyFullBytecode, 0x20), mload(proxyFullBytecode))
        }
        require(_proxy != address(0), "USDCBatchDeployer: Proxy deployment failed");
        proxy = _proxy;

        // 3. Deploy MasterMinter
        bytes memory mmFullBytecode = abi.encodePacked(mmBaseBytecode, abi.encode(_proxy));
        address _mm;
        assembly {
            _mm := create(0, add(mmFullBytecode, 0x20), mload(mmFullBytecode))
        }
        require(_mm != address(0), "USDCBatchDeployer: MM deployment failed");
        masterMinter = _mm;

        // 4. Setup Ownership and Admin
        IMasterMinter(_mm).transferOwnership(config.owner);
        IFiatTokenProxy(_proxy).changeAdmin(config.proxyAdmin);

        // 5. Initialize USDC logic
        IFiatTokenV2_2 proxyAsV2_2 = IFiatTokenV2_2(_proxy);
        
        proxyAsV2_2.initialize(
            config.name, 
            config.symbol, 
            config.currency, 
            config.decimals, 
            _mm, 
            config.owner, 
            config.owner, 
            config.owner
        );
        
        proxyAsV2_2.initializeV2(config.name);
        proxyAsV2_2.initializeV2_1(config.owner);
        proxyAsV2_2.initializeV2_2(new address[](0), config.symbol);
    }
}
