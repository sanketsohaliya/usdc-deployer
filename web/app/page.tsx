'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getContract, Address } from 'viem';
import SignatureCheckerArtifact from '../abis/hardhat/SignatureChecker.json';
import FiatTokenV2_2_Artifact_Unlinked from '../abis/hardhat/FiatTokenV2_2.json';
import USDCFactoryArtifact from '../abis/USDCFactory.json';

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
  const [isCopied, setIsCopied] = useState(false);
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
  const [deploymentResult, setDeploymentResult] = useState<{
    proxy: string;
    impl: string;
    mm: string;
  } | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const getBytecode = (artifact: Artifact) => {
    const code = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
    return code.startsWith('0x') ? (code as `0x${string}`) : (`0x${code}` as `0x${string}`);
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const watchAsset = async (address: string, symbol: string, decimals: number) => {
    if (!walletClient) return;
    try {
      await walletClient.watchAsset({
        type: 'ERC20',
        options: {
          address,
          symbol,
          decimals,
        },
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deploy = async () => {
    if (!walletClient || !publicClient || !address) {
      addLog("Please connect your wallet first.");
      return;
    }
    setIsDeploying(true);
    setLogs([]);
    setDeploymentResult(null);
    addLog('Starting optimized deployment sequence...');

    try {
      // 1. Deploy Factory (if not exist)
      addLog('Step 1: Deploying Orchestrator Factory...');
      const factoryHash = await walletClient.deployContract({
        abi: USDCFactoryArtifact.abi,
        bytecode: getBytecode(USDCFactoryArtifact as any),
        args: [],
      });
      addLog(`Factory tx hash: ${factoryHash}`);
      const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
      const factoryAddress = factoryReceipt.contractAddress!;
      addLog(`SUCCESS: Factory at ${factoryAddress}`);

      // 2. Deploy SignatureChecker library
      addLog('Step 2: Deploying SignatureChecker library...');
      const libraryHash = await walletClient.deployContract({
        abi: SignatureCheckerArtifact.abi,
        bytecode: getBytecode(SignatureCheckerArtifact as any),
        args: [],
      });
      addLog(`SignatureChecker tx hash: ${libraryHash}`);
      const libraryReceipt = await publicClient.waitForTransactionReceipt({ hash: libraryHash });
      const libraryAddress = libraryReceipt.contractAddress!;
      addLog(`SUCCESS: SignatureChecker at ${libraryAddress}`);

      // 3. Link and Deploy Implementation
      addLog('Step 3: Linking and Deploying FiatTokenV2_2 Implementation...');
      const unlinkedBytecode = getBytecode(FiatTokenV2_2_Artifact_Unlinked as any);
      const placeholder = '__\\$715109b5d747ea58b675c6ea3f0dba8c60\\$__';
      const linkedBytecode = unlinkedBytecode.replace(new RegExp(placeholder, 'g'), libraryAddress.slice(2));
      
      const implHash = await walletClient.deployContract({
        abi: FiatTokenV2_2_Artifact_Unlinked.abi,
        bytecode: linkedBytecode as `0x${string}`,
        args: [],
      });
      addLog(`Implementation tx hash: ${implHash}`);
      const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
      const implAddress = implReceipt.contractAddress!;
      addLog(`SUCCESS: Implementation at ${implAddress}`);
      
      // 4. One-Click Deploy everything else
      addLog('Step 4: Executing final orchestration (Proxy + MasterMinter + Initializations)...');
      addLog(`Target Implementation Address: ${implAddress}`);
      addLog('This is the FINAL confirmation required.');
      
      const factoryContract = getContract({
        address: factoryAddress,
        abi: USDCFactoryArtifact.abi,
        client: { public: publicClient, wallet: walletClient }
      });

      const txHash = await factoryContract.write.deployUSDC([
        implAddress,
        {
          name: formData.tokenName,
          symbol: formData.tokenSymbol,
          currency: formData.currency,
          decimals: parseInt(formData.decimals),
          owner: address,
          proxyAdmin: PROXY_ADMIN_ADDRESS
        }
      ]);
      
      addLog(`Orchestration tx hash: ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      
      // Fetch result from contract state for verification
      const finalProxyAddress = await factoryContract.read.proxy();
      const finalImplAddress = await factoryContract.read.implementation();
      const finalMmAddress = await factoryContract.read.masterMinter();

      setDeploymentResult({
        proxy: finalProxyAddress as string,
        impl: finalImplAddress as string,
        mm: finalMmAddress as string
      });

      addLog('COMPLETE: USDC Suite is live!');
      addLog(`Proxy Address: ${finalProxyAddress}`);
      addLog(`MasterMinter Address: ${finalMmAddress}`);


    } catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.shortMessage || e.message || e}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="min-h-screen text-gray-300 font-sans selection:bg-gray-700 selection:text-white bg-[#0a0a0a]">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-[#0a0a0a] to-[#0a0a0a] z-0 pointer-events-none opacity-60"></div>

      <nav className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center font-bold text-white shadow-sm transition-colors group-hover:border-white/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25" />
              </svg>
            </div>
            <span className="font-medium text-white tracking-tight">USDC Deployer</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-wider text-gray-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
              Sepolia Testnet
            </div>
            {mounted ? (
              !isConnected ? (
                <button
                  onClick={() => connect({ connector: injected() })}
                  className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="group flex items-center gap-3 bg-black/40 rounded-lg px-4 py-1.5 border border-white/10 transition-colors hover:border-white/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                  <span className="text-sm font-mono text-gray-200">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  <button 
                    onClick={() => address && copyToClipboard(address)}
                    className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
                    title="Copy Address"
                  >
                    {isCopied ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 text-green-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => disconnect()}
                    className="ml-1 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                    title="Disconnect"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                    </svg>
                  </button>
                </div>
              )
            ) : (
              <div className="w-32 h-9 bg-white/5 rounded-lg animate-pulse"></div>
            )}
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        <div className="lg:col-span-7 space-y-8">
          <div>
            <h1 className="text-3xl font-semibold text-white mb-2 tracking-tight">Streamlined Deployment</h1>
            <p className="text-gray-400 text-sm leading-relaxed max-w-lg">
              Deployment is split into 4 optimized steps to stay within gas limits while maintaining a seamless experience.
            </p>
          </div>

          <div className="bg-[#0f0f0f]/50 backdrop-blur-sm border border-white/5 rounded-xl p-8 shadow-2xl">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-8">
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 ml-1">Token Name</label>
                <input
                  type="text"
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-colors placeholder:text-gray-800"
                  value={formData.tokenName}
                  onChange={e => setFormData({ ...formData, tokenName: e.target.value })}
                  placeholder="e.g. USD Coin"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 ml-1">Token Symbol</label>
                <input
                  type="text"
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-colors placeholder:text-gray-800"
                  value={formData.tokenSymbol}
                  onChange={e => setFormData({ ...formData, tokenSymbol: e.target.value })}
                  placeholder="e.g. USDC"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 ml-1">Currency</label>
                <input
                  type="text"
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-colors placeholder:text-gray-800"
                  value={formData.currency}
                  onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  placeholder="e.g. USD"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 ml-1">Decimals</label>
                <input
                  type="number"
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 focus:bg-black transition-colors placeholder:text-gray-800"
                  value={formData.decimals}
                  onChange={e => setFormData({ ...formData, decimals: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
               <div className="flex items-start gap-3 p-4 rounded-lg bg-white/[0.02] border border-white/5">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-400 mt-0.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <div className="text-xs text-gray-400 leading-relaxed">
                    <p className="mb-1 text-gray-200 font-medium">Automatic Sequence</p>
                    You will need to sign 4 transactions in total. The last transaction orchestrates the final Proxy, MasterMinter, and initialization logic.
                  </div>
               </div>
            </div>

            <div className="mt-8">
              <button
                onClick={deploy}
                disabled={!mounted || !isConnected || isDeploying}
                className={`w-full py-3.5 rounded-lg font-medium text-sm tracking-wide transition-all duration-200 transform active:scale-[0.99] ${ 
                  !mounted || !isConnected 
                    ? 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5'
                    : isDeploying
                      ? 'bg-white text-black cursor-wait opacity-80'
                      : 'bg-white hover:bg-gray-100 text-black shadow-lg shadow-white/5 hover:shadow-white/10 cursor-pointer'
                }`}
              >
                {!mounted ? (
                  "Initializing..."
                ) : isDeploying ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Executing Sequence...
                  </span>
                ) : (
                  "Initiate Deployment"
                )}
              </button>
            </div>

          </div>

          {/* Deployment Summary */}
          {deploymentResult && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3 text-black">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-green-400 uppercase tracking-wider">Deployment Summary</h2>
              </div>

              <div className="space-y-4">
                <div className="bg-black/40 rounded-lg p-4 border border-white/5">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Token Proxy (ERC20)</span>
                    <button 
                      onClick={() => watchAsset(deploymentResult.proxy, formData.tokenSymbol, parseInt(formData.decimals))}
                      className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z" clipRule="evenodd" />
                      </svg>
                      Add to Metamask
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <code className="text-xs text-gray-200 break-all bg-white/5 px-2 py-1 rounded">{deploymentResult.proxy}</code>
                    <button onClick={() => copyToClipboard(deploymentResult.proxy)} className="text-gray-500 hover:text-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <span className="text-[9px] text-gray-500 uppercase font-bold block mb-1">Implementation</span>
                    <div className="flex items-center justify-between">
                      <code className="text-[10px] text-gray-400 break-all">{deploymentResult.impl.slice(0, 20)}...</code>
                      <button onClick={() => copyToClipboard(deploymentResult.impl)} className="text-gray-600 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <span className="text-[9px] text-gray-500 uppercase font-bold block mb-1">Master Minter</span>
                    <div className="flex items-center justify-between">
                      <code className="text-[10px] text-gray-400 break-all">{deploymentResult.mm.slice(0, 20)}...</code>
                      <button onClick={() => copyToClipboard(deploymentResult.mm)} className="text-gray-600 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
           <div className="flex items-center justify-between mb-2 px-1">
             <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">Deployment Progress</h2>
           </div>
          <div className="h-[600px] bg-black border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-2xl relative">
            <div className="px-4 py-2 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Logs</span>
              <div className="w-1.5 h-1.5 rounded-full bg-white/10"></div>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 scrollbar-hide">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-800 pointer-events-none">
                  <span className="opacity-50 text-[10px] uppercase tracking-widest">Ready to deploy</span>
                </div>
              ) : (
                logs.map((log, i) => {
                  const isError = log.toLowerCase().includes('error');
                  const isTx = log.includes('tx hash:');
                  const isAddress = log.includes('at:') || log.includes('Address:');
                  const isSuccess = log.includes('SUCCESS') || log.includes('COMPLETE') || log.includes('successfully');

                  return (
                    <div key={i} className="flex gap-3 group border-l border-transparent hover:border-white/10 pl-2 transition-colors">
                      <span className="text-gray-700 select-none w-5 shrink-0 group-hover:text-gray-500">{(i + 1).toString().padStart(2, '0')}</span>
                      
                      <div className="flex-1 break-all">
                        {isError && <span className="text-red-500 mr-2">✖</span>}
                        {isSuccess && <span className="text-green-500 mr-2">✔</span>}
                        {!isError && !isSuccess && <span className="text-blue-500/50 mr-2">→</span>}
                        
                        <span className={`
                          ${isError ? 'text-red-400' : ''}
                          ${isSuccess ? 'text-green-400 font-bold' : ''}
                          ${!isError && !isSuccess ? 'text-gray-100' : ''}
                        `}>
                          {log.split(':').map((part, index, array) => {
                            if (index === array.length - 1 && (isTx || isAddress)) {
                              return (
                                <span key={index} className="text-blue-400/90 font-mono bg-blue-500/5 px-1 rounded ml-1">
                                  {part}
                                </span>
                              );
                            }
                            return (index > 0 ? ':' : '') + part;
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="px-4 py-2 bg-white/[0.04] border-t border-white/5 text-[10px] font-mono flex justify-between uppercase tracking-wider items-center">
               <div className="flex items-center gap-2">
                 <span className="text-gray-500 font-semibold">System Status</span>
                 {isDeploying ? (
                   <span className="flex items-center gap-1.5 text-blue-400 font-bold animate-pulse bg-blue-400/10 px-2 py-0.5 rounded border border-blue-400/20">
                     <span className="w-1 h-1 rounded-full bg-blue-400"></span>
                     Processing
                   </span>
                 ) : (
                   <span className="flex items-center gap-1.5 text-green-500 font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                     <span className="w-1 h-1 rounded-full bg-green-500"></span>
                     Ready
                   </span>
                 )}
               </div>
               <span className="text-gray-600 font-bold">v2.2.0</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
