import React, { useEffect, useRef, useState } from 'react';
import { polygon, bsc, linea } from 'wagmi/chains';
import { Platform } from '@/constants';
import { useRouter } from 'next/router';
import Button from '@/components/button';
import Popover from '@/components/popover';
import { watchAccount } from '@wagmi/core';
import WalletPopover from './WalletPopover';
import Web3StatusInner from './Web3StatusInner';
import { useMutationLogin } from '@/hooks/user';
import { useIsMounted } from '@/hooks/useIsMounted';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { getAccessToken } from '@/utils/authorization';
import { posterCaptureAtom } from '@/store/poster/state';
import { isConnectPopoverOpen } from '@/store/web3/state';
import PosterButton from '@/components/poster/PosterButton';
import { useAccount, useNetwork, useSwitchNetwork } from 'wagmi';
import { useSignInWithEthereum } from '@/hooks/useSignInWithEthereum';
import { accessTokenAtom } from '@/store/user/state';
import { getLocalStorage, setLocalStorage } from '@/utils/storage';
import { useAutoReconnectWallet } from '@/hooks/user';
import ReactGA from 'react-ga4';

function Web3Status() {
  // Ensure auto-reconnect attempt on load
  useAutoReconnectWallet();
  const router = useRouter();
  const { chain } = useNetwork();
  const isMounted = useIsMounted();
  const { mutate } = useMutationLogin();
  const { address } = useAccount();
  const setAccessToken = useSetRecoilState(accessTokenAtom);
  const unwatchAccount = useRef<() => void>();
  const { signInWithEthereum } = useSignInWithEthereum({
    onSuccess: (args) => mutate({ ...args, platform: Platform.USER }),
  });
  const { isConnected, isConnecting } = useAccount({
    onConnect({ address, isReconnected, connector }) {
      unwatchAccount.current = watchAccount(({ isConnected, address }) => {
        const accessToken = getAccessToken({ address });
        if (address && isConnected && !accessToken) {
          signInWithEthereum(address).then();
        }
      });
      // Persist last connected wallet
      if (connector?.name) {
        setLocalStorage('lastConnectedWallet', connector.name);
      }
      if (isReconnected || !address) return;
      signInWithEthereum(address).then();
    },
    onDisconnect() {
      unwatchAccount.current?.();
    },
  });
  const { switchNetwork, isLoading: isSwitching, pendingChainId } = useSwitchNetwork();
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);

  const supportedNetworks = [polygon, linea, bsc];
  const isNetworkSupported = supportedNetworks.some((network) => network.id === chain?.id);
  const targetChains = supportedNetworks;
  const getChainName = (id?: number) => targetChains.find((c) => c.id === id)?.name ?? chain?.name ?? 'Unknown';
  const getStatusColor = () => {
    if (!isNetworkSupported) return 'bg-red-500';
    if (isSwitching) return 'bg-amber-500';
    return 'bg-green-500';
  };

  const NetworkList = () => (
    <div className="backdrop-box rounded-lg p-2">
      <div className="mb-2 text-xs opacity-70">Select network</div>
      {targetChains.map((c) => (
        <Button
          key={c.id}
          size="small"
          type="bordered"
          className="mb-2 w-full"
          onClick={() => switchNetwork?.(c.id)}
          disabled={isSwitching && pendingChainId === c.id}
        >
          {isSwitching && pendingChainId === c.id ? `Switching to ${c.name}...` : `Switch to ${c.name}`}
        </Button>
      ))}
    </div>
  );

  const [isOpen, setIsOpen] = useRecoilState(isConnectPopoverOpen);
  const posterCapture = useRecoilValue(posterCaptureAtom);

  useEffect(() => {
    const accessToken = getAccessToken({ address });
    setAccessToken(accessToken);
    // Optionally, read the last connected wallet (available for future UX logic)
    const last = getLocalStorage<string>('lastConnectedWallet');
    // We are not auto-connecting here, but this value can be used to prioritize/populate UI
  }, [address, setAccessToken]);

  if (!isMounted) return null;

  if (router.pathname === '/gamer/[address]') {
    return posterCapture ? <PosterButton /> : null;
  }

  if (isConnected) {
    if (!isNetworkSupported) {
      return (
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
          <Popover
            open={isNetworkOpen}
            onOpenChange={(op: boolean) => setIsNetworkOpen(op)}
            render={() => <NetworkList />}
          >
            <Button size="small" type="error" className="h-10">
              Wrong Network
            </Button>
          </Popover>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Popover
          open={isNetworkOpen}
          onOpenChange={(op: boolean) => setIsNetworkOpen(op)}
          render={() => <NetworkList />}
        >
          <div className="flex cursor-pointer items-center gap-1 text-xs opacity-80">
            <span className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
            <span>{getChainName(chain?.id)}</span>
          </div>
        </Popover>
        {router.pathname === '/gamer' && posterCapture && <PosterButton />}
        <div className="flex rounded-full bg-[#44465F]/60 text-sm">
          <Web3StatusInner />
        </div>
      </div>
    );
  } else {
    return (
      <div>
        <Popover open={isOpen} onOpenChange={(op) => setIsOpen(op)} render={({ close }) => <WalletPopover close={close} />}>
          <Button size="small" type="gradient" className="h-10 w-[120px]" disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        </Popover>
      </div>
    );
  }
}

export default Web3Status;
