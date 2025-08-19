import Button from '@/components/button';
import { EventCategory, EventName } from '@/constants/event';
import { downloadClickAtom } from '@/store/web3/state';
import React from 'react';
import ReactGA from 'react-ga4';
import { useRecoilState } from 'recoil';
import { useConnect } from 'wagmi';
import type { Connector } from 'wagmi';
import { WalletType } from './WalletPopover';
import { toast } from 'react-toastify';
import Message from '@/components/message';
ReactGA.event({ category: EventCategory.Global, action: EventName.ToInvitation });

type WalletConnectProps = {
  setWalletType?: (type: WalletType) => void;
};

function WalletConnect({ setWalletType }: WalletConnectProps) {
  const MAX_RETRIES = 3;
  const retryCountersRef = React.useRef<Record<string, number>>({});
  type WalletTypeKey = 'meta_mask' | 'token_pocket' | 'bitget_wallet' | 'particle_network' | 'wallet_connect';

  const getConnectorKey = (connector: Connector | undefined, walletType: string) =>
    (connector?.id as unknown as string) || (connector?.name as string) || walletType || 'unknown';

  const isRetryableError = (error: any) => {
    const code = (error?.code ?? error?.data?.code) as number | undefined;
    const name = (error?.name ?? '') as string;
    // Do not retry on user rejection or missing connector
    if (code === 4001 || name === 'UserRejectedRequestError' || name === 'ConnectorNotFoundError') return false;
    // Default: retryable
    return true;
  };

  const scheduleRetry = (connector: Connector | undefined, walletType: WalletTypeKey) => {
    const key = getConnectorKey(connector, walletType);
    const current = retryCountersRef.current[key] ?? 0;
    if (current >= MAX_RETRIES) return false;
    const next = current + 1;
    retryCountersRef.current[key] = next;
    const delay = Math.min(1500 * Math.pow(2, current), 8000);
    toast.info(
      <Message title={`Retrying ${formatWalletTitle(walletType)}...`} message={`Attempt ${next} of ${MAX_RETRIES}`} />
    );
    setTimeout(() => {
      connect({ connector } as any);
    }, delay);
    return true;
  };
  const { connect, connectors } = useConnect({
    onSuccess: () => {
      ReactGA.event({ category: EventCategory.Global, action: EventName.ConnectResult, label: 'success' });
    },
    onError: (error: unknown, { connector }: { connector?: Connector } = {}) => {
      ReactGA.event({ category: EventCategory.Global, action: EventName.ConnectResult, label: 'failed' });
      // Map connector to our wallet type keys
      const walletType = mapConnectorToType(connector);

      // Specific handling for missing MetaMask
      if ((error as any)?.name === 'ConnectorNotFoundError' && connector?.name === 'MetaMask') {
        window.open('https://metamask.io');
        handleWalletError(error, 'meta_mask');
        return;
      }

      // Retry if possible; otherwise show final error
      if (isRetryableError(error) && scheduleRetry(connector, walletType)) {
        return;
      }
      handleWalletError(error, walletType, { final: true });
    },
  });
  const [downloadClick, setDownloadClick] = useRecoilState(downloadClickAtom);

  // Add error handling for each wallet type with friendly messages
  const handleWalletError = (error: any, walletType: WalletTypeKey, opts?: { final?: boolean }) => {
    const baseMessages: Record<string, { title: string; tip: string }> = {
      meta_mask: {
        title: 'MetaMask connection failed',
        tip: "Open MetaMask, ensure it's unlocked, then try again.",
      },
      token_pocket: {
        title: 'TokenPocket connection failed',
        tip: 'Open TokenPocket and unlock. Ensure the DApp browser/extension is allowed.',
      },
      bitget_wallet: {
        title: 'Bitget Wallet connection failed',
        tip: 'Open Bitget Wallet and unlock. Ensure the extension is enabled on this site.',
      },
      particle_network: {
        title: 'Particle Network connection failed',
        tip: 'Make sure popups are not blocked and retry.',
      },
      wallet_connect: {
        title: 'WalletConnect session failed',
        tip: "Approve the session in your wallet app. If it persists, disconnect in your wallet and try again.",
      },
    };

    const { title, tip } = baseMessages[walletType] ?? {
      title: 'Wallet connection failed',
      tip: 'Please try again.',
    };

    const friendly = getFriendlyErrorMessage(error, walletType) ?? tip;

    if (opts?.final) {
      toast.error(<Message title={title} message={friendly} />);
    } else {
      toast.error(<Message title={title} message={friendly} />);
    }
  };

  const getFriendlyErrorMessage = (error: any, walletType: WalletTypeKey): string | undefined => {
    const code = (error?.code ?? error?.data?.code) as number | undefined;
    const name = (error?.name ?? '') as string;
    const message = (error?.message ?? '') as string;

    // Common EIP-1193 / provider errors
    if (code === 4001 || /rejected/i.test(name) || /rejected/i.test(message)) {
      return 'Request was rejected. Please approve in your wallet to continue.';
    }
    if (/unsupported chain|chain not configured|switch chain/i.test(message)) {
      return 'Unsupported network. Please switch to the correct network in your wallet.';
    }
    if (/already pending|request already pending/i.test(message)) {
      return 'There is a pending request in your wallet. Please complete or cancel it first.';
    }
    if (/timeout|timed out|deadline/i.test(message)) {
      return 'The request timed out. Please ensure your wallet is open and unlocked, then retry.';
    }
    // Per-wallet nuanced guidance
    if (walletType === 'wallet_connect') {
      return 'Open your wallet app to approve the session. If it fails, disconnect the old session and try again.';
    }
    return undefined;
  };

  const formatWalletTitle = (walletType: WalletTypeKey) => {
    switch (walletType) {
      case 'meta_mask':
        return 'MetaMask';
      case 'token_pocket':
        return 'TokenPocket';
      case 'bitget_wallet':
        return 'Bitget Wallet';
      case 'particle_network':
        return 'Particle Network';
      case 'wallet_connect':
      default:
        return 'WalletConnect';
    }
  };

  const mapConnectorToType = (connector?: Connector): WalletTypeKey => {
    const name = (connector?.name ?? '').toLowerCase();
    if (name.includes('metamask')) return 'meta_mask';
    if (name.includes('token')) return 'token_pocket';
    if (name.includes('bitget') || name.includes('bitkeep')) return 'bitget_wallet';
    if (name.includes('particle')) return 'particle_network';
    if (name.includes('walletconnect')) return 'wallet_connect';
    return 'wallet_connect';
  };

  const findConnectorByType = (type: WalletTypeKey): Connector | undefined => {
    const predicate = (name: string) => {
      const lower = name.toLowerCase();
      if (type === 'meta_mask') return lower.includes('metamask');
      if (type === 'token_pocket') return lower.includes('token');
      if (type === 'bitget_wallet') return lower.includes('bitget') || lower.includes('bitkeep');
      if (type === 'particle_network') return lower.includes('particle');
      if (type === 'wallet_connect') return lower.includes('walletconnect');
      return false;
    };
    return connectors.find((c) => predicate(c.name));
  };

  /**
   * connectWallet
   * @param connector
   */
  const connectWallet = (connector: Connector | undefined) => {
    if (!connector) {
      handleWalletError(new Error('Connector not found'), 'wallet_connect');
      return;
    }
    try {
      // Start connection; errors will be routed to onError above
      connect({ connector } as any);
    } catch (error: any) {
      const walletType = mapConnectorToType(connector);
      // No sync retry here; onError will handle retry scheduling
      handleWalletError(error, walletType);
    }
  };

  const onConnectClick = (type: WalletTypeKey) => {
    ReactGA.event({ category: EventCategory.Global, action: EventName.ConnectWallet, label: type });
    const connector = findConnectorByType(type);
    connectWallet(connector);
  };

  return (
    <div className="flex-center-y p-6">
      <h4 className="text-xl font-medium">Connect wallet</h4>
      <div className="mt-6 grid grid-cols-2 gap-3 px-4">
        <Button type="bordered" className="flex-center col-span-2 gap-2" onClick={() => onConnectClick('meta_mask')}>
          <img className="h-7.5 w-7.5" src="/img/metamask@2x.png" alt="meta_mask" />
          <span className="text-sm">MetaMask</span>
        </Button>
        <Button type="bordered" className="flex-center gap-2" onClick={() => onConnectClick('token_pocket')}>
          <img className="h-7.5 w-7.5" src="/img/tokenPocket.png" alt="TokenPocket" />
          <span className="text-sm">TokenPocket</span>
        </Button>
        <Button type="bordered" className="flex-center gap-2" onClick={() => onConnectClick('bitget_wallet')}>
          <img className="h-7.5 w-7.5" src="/img/bitgetWallet.png" alt="BitgetWallet" />
          <span className="text-sm">Bitget Wallet</span>
        </Button>
        <Button type="bordered" className="flex-center gap-2 px-6" onClick={() => onConnectClick('particle_network')}>
          <img className="h-7.5 w-7.5" src="/img/particleNetwork.png" alt="ParticleNetwork" />
          <span className="whitespace-nowrap text-sm">Particle Network</span>
        </Button>
        <Button type="bordered" className="flex-center gap-2" onClick={() => onConnectClick('wallet_connect')}>
          <img className="h-7.5 w-7.5" src="/img/walletconnet.png" alt="wallet_connect" />
          <span className="text-sm">WalletConnect</span>
        </Button>
      </div>
      <div className="mt-4 px-4 text-xs text-gray">
        {downloadClick ? 'Please refresh page after installation. Re-install ' : "Don't have one? "}
        <span
          className="cursor-pointer text-blue"
          onClick={() => {
            setDownloadClick(true);
            setWalletType?.(WalletType.DOWNLOAD);
          }}
        >
          click here
        </span>
      </div>
    </div>
  );
}

export default React.memo(WalletConnect);
