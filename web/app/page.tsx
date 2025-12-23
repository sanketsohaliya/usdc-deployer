'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getContract, Address } from 'viem';
import FiatTokenProxyArtifact from '../abis/FiatTokenProxy.json';
import MasterMinterArtifact from '../abis/MasterMinter.json';
import SignatureCheckerArtifact from '../abis/hardhat/SignatureChecker.json';
import FiatTokenV2_2_Artifact_Unlinked from '../abis/hardhat/FiatTokenV2_2.json';

// Helper types for artifacts
type Artifact = {
  abi: any;
  bytecode: string | { object: string };
};

const PROXY_ADMIN_ADDRESS = '0x1269FB8D3C8712c3A70f4d3aF5Dc1DDa314d1532' as Address;

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [mounted, setMounted] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [formData, setFormData] = useState({
    tokenName: 'USDC',
    tokenSymbol: 'USDC',
    currency: 'USD',
    decimals: '6',
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const getBytecode = (artifact: Artifact) => {
    if(typeof artifact.bytecode === 'string') return artifact.bytecode;
    return artifact.bytecode.object;
  }

  const deploy = async () => {
    if (!walletClient || !publicClient || !address) {
      addLog("Please connect your wallet first.");
      return;
    }
    setIsDeploying(true);
    setLogs([]);
    addLog('Starting deployment sequence...');

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

      // 6. Transfer MasterMinter Ownership to connected wallet
      addLog(`Transferring MasterMinter ownership to ${address}...`);
      const mmContract = getContract({
        address: mmAddress,
        abi: MasterMinterArtifact.abi,
        client: { public: publicClient, wallet: walletClient }
      });
      const tx1 = await mmContract.write.transferOwnership([address]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      addLog('MasterMinter ownership transferred.');

      // 7. Change Proxy Admin to hardcoded address
      addLog(`Changing Proxy Admin to ${PROXY_ADMIN_ADDRESS}...`);
      const proxyContract = getContract({
        address: proxyAddress,
        abi: FiatTokenProxyArtifact.abi, // Proxy ABI has changeAdmin
        client: { public: publicClient, wallet: walletClient }
      });
      const tx2 = await proxyContract.write.changeAdmin([PROXY_ADMIN_ADDRESS]);
      await publicClient.waitForTransactionReceipt({ hash: tx2 });
      addLog('Proxy Admin changed.');

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
        address, // pauser
        address, // blacklister
        address  // owner
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx3 });
      addLog('Initialized V1.');

      addLog('Initializing V2...');
      const tx4 = await proxyAsV2_2.write.initializeV2([formData.tokenName]);
      await publicClient.waitForTransactionReceipt({ hash: tx4 });
      addLog('Initialized V2.');

      addLog('Initializing V2_1...');
      const tx5 = await proxyAsV2_2.write.initializeV2_1([address]);
      await publicClient.waitForTransactionReceipt({ hash: tx5 });
      addLog('Initialized V2_1.');

      addLog('Initializing V2_2...');
      const tx6 = await proxyAsV2_2.write.initializeV2_2([[], formData.tokenSymbol]);
      await publicClient.waitForTransactionReceipt({ hash: tx6 });
      addLog('Initialized V2_2.');

      addLog('DEPLOYMENT COMPLETE!');
      addLog(`Token Address: ${proxyAddress}`);


    } catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.shortMessage || e.message || e}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="min-h-screen text-gray-300 font-sans selection:bg-blue-500/30">
      
      {/*Navbar */}
      <nav className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white">
              C
            </div>
            <span className="font-semibold text-white tracking-tight">USDC Deployer</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:block text-xs text-gray-500 font-mono">
              Sepolia Testnet
            </div>
            {mounted ? (
              !isConnected ? (
                <button
                  onClick={() => connect({ connector: injected() })}
                  className="px-4 py-2 bg-white text-black text-sm font-medium rounded-full hover:bg-gray-200 transition-colors"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="flex items-center gap-3 bg-white/5 rounded-full px-4 py-1.5 border border-white/10">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-sm font-mono text-gray-300">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  <button
                    onClick={() => disconnect()}
                    className="ml-2 text-xs text-gray-500 hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )
            ) : (
              <div className="w-32 h-9 bg-white/5 rounded-full animate-pulse"></div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Left Column: Configuration */}
        <div className="lg:col-span-7 space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Deploy your Stablecoin</h1>
            <p className="text-gray-400">
              Configure parameters to deploy a fully compliant USDC standard contract on the Sepolia network.
            </p>
          </div>

          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 shadow-xl">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6">Configuration</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Token Name</label>
                <input
                  type="text"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50 focus:border-blue-600 transition-all placeholder:text-gray-700"
                  value={formData.tokenName}
                  onChange={e => setFormData({ ...formData, tokenName: e.target.value })}
                  placeholder="e.g. USD Coin"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Token Symbol</label>
                <input
                  type="text"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50 focus:border-blue-600 transition-all placeholder:text-gray-700"
                  value={formData.tokenSymbol}
                  onChange={e => setFormData({ ...formData, tokenSymbol: e.target.value })}
                  placeholder="e.g. USDC"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Currency</label>
                <input
                  type="text"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50 focus:border-blue-600 transition-all placeholder:text-gray-700"
                  value={formData.currency}
                  onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  placeholder="e.g. USD"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Decimals</label>
                <input
                  type="number"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600/50 focus:border-blue-600 transition-all placeholder:text-gray-700"
                  value={formData.decimals}
                  onChange={e => setFormData({ ...formData, decimals: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
               <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-900/10 border border-blue-900/20">
                  <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></div>
                  <div className="text-xs text-blue-200/80 leading-relaxed">
                    <strong className="text-blue-400 block mb-1">Ownership & Roles</strong>
                    Your connected wallet will be assigned as the <strong>Owner</strong>, <strong>Pauser</strong>, <strong>Blacklister</strong>, and <strong>MasterMinter</strong>.
                  </div>
               </div>
            </div>

            <div className="mt-6">
              <button
                onClick={deploy}
                disabled={!isConnected || isDeploying}
                className={`w-full py-4 rounded-xl font-semibold text-sm tracking-wide transition-all ${ 
                  !isConnected 
                    ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                    : isDeploying
                      ? 'bg-blue-600/50 text-white cursor-wait'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                }`}
              >
                {isDeploying ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deploying...
                  </span>
                ) : (
                  "Deploy Contracts"
                )}
              </button>
            </div>

          </div>
        </div>

        {/* Right Column: Logs */}
        <div className="lg:col-span-5 flex flex-col h-full min-h-[500px]">
          <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl overflow-hidden flex flex-col h-full shadow-2xl">
            <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs font-mono text-gray-400">Deployment Logs</span>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50"></div>
              </div>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-2 relative">
              {logs.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700 pointer-events-none">
                  <span className="opacity-50">Waiting for deployment...</span>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="break-all border-l-2 border-transparent hover:border-blue-500/50 pl-2 py-0.5 transition-colors">
                    <span className="text-gray-600 mr-2">{String(i + 1).padStart(2, '0')}</span>
                    <span className={log.includes('Error') ? 'text-red-400' : 'text-gray-300'}>
                      {log}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Footer status */}
            <div className="px-4 py-2 bg-black/40 border-t border-white/5 text-[10px] text-gray-600 font-mono flex justify-between">
               <span>STATUS: {isDeploying ? 'RUNNING' : 'IDLE'}</span>
               <span>NETWORK: SEPOLIA</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}