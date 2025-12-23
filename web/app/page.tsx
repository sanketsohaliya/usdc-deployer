'use client';

import { useState, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getContract, Address, createPublicClient, http } from 'viem';
import FiatTokenProxyArtifact from '../abis/FiatTokenProxy.json';
import MasterMinterArtifact from '../abis/MasterMinter.json';
import SignatureCheckerArtifact from '../abis/hardhat/SignatureChecker.json';
import FiatTokenV2_2_Artifact_Unlinked from '../abis/hardhat/FiatTokenV2_2.json';

// Helper types for artifacts
type Artifact = {
  abi: any;
  bytecode: string | { object: string };
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [formData, setFormData] = useState({
    tokenName: 'USDC',
    tokenSymbol: 'USDC',
    currency: 'USD',
    decimals: '6',
    proxyAdmin: '',
    masterMinterOwner: '',
    owner: '',
    pauser: '',
    blacklister: '',
  });

  // Pre-fill addresses with connected wallet
  useEffect(() => {
    if (address && !formData.owner) {
      setFormData(prev => ({
        ...prev,
        proxyAdmin: prev.proxyAdmin || address,
        masterMinterOwner: prev.masterMinterOwner || address,
        owner: prev.owner || address,
        pauser: prev.pauser || address,
        blacklister: prev.blacklister || address,
      }));
    }
  }, [address, isConnected]);

  const [logs, setLogs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedAddresses, setDeployedAddresses] = useState({
    impl: '',
    proxy: '',
    masterMinter: '',
  });

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const getBytecode = (artifact: Artifact) => {
    if(typeof artifact.bytecode === 'string') return artifact.bytecode;
    return artifact.bytecode.object;
  }

  const deploy = async () => {
    if (!walletClient || !publicClient) return;
    setIsDeploying(true);
    setLogs([]);
    addLog('Starting deployment...');

    try {
      // 1. Deploy SignatureChecker library
      addLog('Deploying SignatureChecker library...');
      const libraryHash = await walletClient.deployContract({
        abi: SignatureCheckerArtifact.abi,
        bytecode: getBytecode(SignatureCheckerArtifact as any) as `0x${string}`,
        args: [],
      });
      addLog(`SignatureChecker tx hash: ${libraryHash}`);
      const libraryReceipt = await publicClient.waitForTransactionReceipt({ hash: libraryHash });
      const libraryAddress = libraryReceipt.contractAddress!;
      addLog(`SignatureChecker deployed at: ${libraryAddress}`);

      // 2. Link FiatTokenV2_2 bytecode
      addLog('Linking FiatTokenV2_2 bytecode...');
      const unlinkedBytecode = getBytecode(FiatTokenV2_2_Artifact_Unlinked as any);
      // Hardhat's placeholder format is __$<hash>$__ which needs escaping for regex
      const placeholder = '__\\$715109b5d747ea58b675c6ea3f0dba8c60\\$__';
      const linkedBytecode = unlinkedBytecode.replace(new RegExp(placeholder, 'g'), libraryAddress.slice(2));
      addLog('Bytecode linked successfully.');
      
      // 3. Deploy Implementation
      addLog('Deploying FiatTokenV2_2 Implementation...');
      const implHash = await walletClient.deployContract({
        abi: FiatTokenV2_2_Artifact_Unlinked.abi,
        bytecode: linkedBytecode as `0x${string}`,
        args: [],
      });
      addLog(`Implementation tx hash: ${implHash}`);
      const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
      const implAddress = implReceipt.contractAddress!;
      addLog(`Implementation deployed at: ${implAddress}`);
      setDeployedAddresses(prev => ({ ...prev, impl: implAddress }));

      // 4. Deploy Proxy
      addLog('Deploying FiatTokenProxy...');
      const proxyHash = await walletClient.deployContract({
        abi: FiatTokenProxyArtifact.abi,
        bytecode: getBytecode(FiatTokenProxyArtifact as any) as `0x${string}`,
        args: [implAddress],
      });
      addLog(`Proxy tx hash: ${proxyHash}`);
      const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash });
      const proxyAddress = proxyReceipt.contractAddress!;
      addLog(`Proxy deployed at: ${proxyAddress}`);
      setDeployedAddresses(prev => ({ ...prev, proxy: proxyAddress }));

      // 5. Deploy MasterMinter
      addLog('Deploying MasterMinter...');
      const mmHash = await walletClient.deployContract({
        abi: MasterMinterArtifact.abi,
        bytecode: getBytecode(MasterMinterArtifact as any) as `0x${string}`,
        args: [proxyAddress],
      });
      addLog(`MasterMinter tx hash: ${mmHash}`);
      const mmReceipt = await publicClient.waitForTransactionReceipt({ hash: mmHash });
      const mmAddress = mmReceipt.contractAddress!;
      addLog(`MasterMinter deployed at: ${mmAddress}`);
      setDeployedAddresses(prev => ({ ...prev, masterMinter: mmAddress }));

      // 6. Transfer MasterMinter Ownership
      addLog(`Transferring MasterMinter ownership to ${formData.masterMinterOwner}...`);
      const mmContract = getContract({
        address: mmAddress,
        abi: MasterMinterArtifact.abi,
        client: { public: publicClient, wallet: walletClient }
      });
      const tx1 = await mmContract.write.transferOwnership([formData.masterMinterOwner as Address]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      addLog('MasterMinter ownership transferred.');

      // 7. Change Proxy Admin
      addLog(`Changing Proxy Admin to ${formData.proxyAdmin}...`);
      const proxyContract = getContract({
        address: proxyAddress,
        abi: FiatTokenProxyArtifact.abi, // Proxy ABI has changeAdmin
        client: { public: publicClient, wallet: walletClient }
      });
      const tx2 = await proxyContract.write.changeAdmin([formData.proxyAdmin as Address]);
      await publicClient.waitForTransactionReceipt({ hash: tx2 });
      addLog('Proxy Admin changed.');

      if (formData.proxyAdmin.toLowerCase() === address?.toLowerCase()) {
        addLog("CRITICAL: You are now the Proxy Admin. You cannot call 'initialize' via the Proxy because the Proxy will intercept the call. Initialization steps will likely fail. You should have used a different address for Proxy Admin.");
      }

      // 8. Initialize (V1, V2, V2_1, V2_2)
      const proxyAsV2_2 = getContract({
        address: proxyAddress,
        abi: FiatTokenV2_2_Artifact_Unlinked.abi,
        client: { public: publicClient, wallet: walletClient }
      });

      addLog('Initializing V1...');
      const tx3 = await proxyAsV2_2.write.initialize([
        formData.tokenName,
        formData.tokenSymbol,
        formData.currency,
        parseInt(formData.decimals),
        mmAddress,
        formData.pauser as Address,
        formData.blacklister as Address,
        formData.owner as Address
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx3 });
      addLog('Initialized V1.');

      addLog('Initializing V2...');
      const tx4 = await proxyAsV2_2.write.initializeV2([formData.tokenName]);
      await publicClient.waitForTransactionReceipt({ hash: tx4 });
      addLog('Initialized V2.');

      addLog('Initializing V2_1...');
      const tx5 = await proxyAsV2_2.write.initializeV2_1([formData.owner as Address]);
      await publicClient.waitForTransactionReceipt({ hash: tx5 });
      addLog('Initialized V2_1.');

      addLog('Initializing V2_2...');
      const tx6 = await proxyAsV2_2.write.initializeV2_2([[], formData.tokenSymbol]);
      await publicClient.waitForTransactionReceipt({ hash: tx6 });
      addLog('Initialized V2_2.');

      addLog('DEPLOYMENT COMPLETE!');

    } catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.message || e}`);
    } finally {
      setIsDeploying(false);
    }
  };


  return (
    <div className="min-h-screen p-8 bg-gray-50 text-gray-900 font-sans">
      <main className="max-w-2xl mx-auto bg-white p-6 rounded-xl shadow-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-600">USDC Deployer (Sepolia)</h1>

        <div className="mb-6 flex justify-center h-16">
          {mounted ? (
            !isConnected ? (
              <button
                onClick={() => connect({ connector: injected() })}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-mono bg-gray-100 px-3 py-1 rounded">
                  Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
                <button
                  onClick={() => disconnect()}
                  className="text-xs text-red-500 hover:underline"
                >
                  Disconnect
                </button>
              </div>
            )
          ) : (
             <div className="px-6 py-2 bg-gray-200 text-gray-500 rounded-lg animate-pulse">
               Loading Wallet...
             </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Token Name</label>
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={formData.tokenName}
                onChange={e => setFormData({ ...formData, tokenName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Token Symbol</label>
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={formData.tokenSymbol}
                onChange={e => setFormData({ ...formData, tokenSymbol: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Currency</label>
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={formData.currency}
                onChange={e => setFormData({ ...formData, currency: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Decimals</label>
              <input
                type="number"
                className="w-full border p-2 rounded"
                value={formData.decimals}
                onChange={e => setFormData({ ...formData, decimals: e.target.value })}
              />
            </div>
          </div>

          <hr />
          
          <h3 className="font-semibold text-lg">Addresses</h3>
          <p className="text-xs text-gray-500 mb-2">Defaults to connected wallet. Change Proxy Admin to a different address!</p>
          
          <div>
            <label className="block text-sm font-semibold mb-1 text-red-600">Proxy Admin Address (IMPORTANT: Must NOT be Deployer)</label>
            <input
              type="text"
              className="w-full border p-2 rounded border-red-200"
              value={formData.proxyAdmin}
              onChange={e => setFormData({ ...formData, proxyAdmin: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Master Minter Owner</label>
            <input
              type="text"
              className="w-full border p-2 rounded"
              value={formData.masterMinterOwner}
              onChange={e => setFormData({ ...formData, masterMinterOwner: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Owner Address</label>
            <input
              type="text"
              className="w-full border p-2 rounded"
              value={formData.owner}
              onChange={e => setFormData({ ...formData, owner: e.target.value })}
            />
          </div>
          
           <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Pauser Address</label>
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={formData.pauser}
                onChange={e => setFormData({ ...formData, pauser: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Blacklister Address</label>
              <input
                type="text"
                className="w-full border p-2 rounded"
                value={formData.blacklister}
                onChange={e => setFormData({ ...formData, blacklister: e.target.value })}
              />
            </div>
           </div>

          <button
            onClick={deploy}
            disabled={!isConnected || isDeploying}
            className={`w-full py-3 rounded-lg text-white font-bold text-lg mt-4 ${
              !isConnected || isDeploying ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isDeploying ? 'Deploying...' : 'Deploy USDC'}
          </button>
        </div>

        {logs.length > 0 && (
          <div className="mt-8 bg-gray-900 text-green-400 p-4 rounded-lg text-sm font-mono h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}