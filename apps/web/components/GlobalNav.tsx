'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEvmWallet } from '@/hooks/useEvmWallet'

const PAYMENT_SYMBOL = process.env['NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL'] || 'USDC'
const PAYMENT_DECIMALS = Number(process.env['NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS'] || '6')
const KASPLEX_CHAIN_ID = Number(process.env['NEXT_PUBLIC_KASPLEX_CHAIN_ID'] || '167012')

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatUnits(raw: bigint | null, decimals: number, maxDecimals = 4): string {
  if (raw === null) return '-'
  const base = 10n ** BigInt(decimals)
  const whole = raw / base
  const fraction = raw % base
  if (fraction === 0n) return whole.toString()

  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxDecimals)
    .replace(/0+$/, '')

  return fractionText.length > 0 ? `${whole.toString()}.${fractionText}` : whole.toString()
}

function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-2 text-sm transition ${
        active
          ? 'bg-kaspa-primary/20 text-kaspa-primary'
          : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
      }`}
    >
      {label}
    </Link>
  )
}

export function GlobalNav() {
  const pathname = usePathname()
  const wallet = useEvmWallet()
  const onKasplex = wallet.chainId === KASPLEX_CHAIN_ID

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800/80 bg-[#0d1117]/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/" className="rounded-md px-2 py-1 text-lg font-bold text-white">
            <span className="text-kaspa-primary">Tick</span>asting
          </Link>
          <div className="flex items-center gap-1">
            <NavItem href="/" label="Sales" active={pathname === '/'} />
            <NavItem href="/my-tickets" label="My Tickets" active={pathname === '/my-tickets'} />
            <NavItem href="/scanner" label="Scanner" active={pathname === '/scanner'} />
          </div>
        </div>

        <div className="min-w-0 flex-1 sm:flex sm:justify-end">
          {!wallet.isInstalled ? (
            <a
              href="https://metamask.io"
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-center text-sm text-yellow-300 sm:w-auto"
            >
              Install MetaMask
            </a>
          ) : !wallet.isConnected ? (
            <button
              onClick={() => void wallet.connect()}
              disabled={wallet.loading}
              className="w-full rounded-lg bg-kaspa-primary px-4 py-2 text-sm font-semibold text-black hover:bg-kaspa-primary/90 disabled:opacity-60 sm:w-auto"
            >
              {wallet.loading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : (
            <div className="w-full rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs sm:w-auto sm:min-w-[320px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-gray-300">
                  {wallet.walletLabel || 'EVM Wallet'} connected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void wallet.refreshBalances()}
                    className="text-gray-400 hover:text-white"
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <div className="mt-1 font-mono text-gray-100">
                {wallet.address ? shortenAddress(wallet.address) : '-'}
              </div>
              <div className={`mt-1 ${onKasplex ? 'text-green-400' : 'text-yellow-400'}`}>
                Chain: {wallet.chainId ?? 'unknown'} {onKasplex ? '(Kasplex)' : '(Switch required)'}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded bg-gray-800/80 px-2 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">KAS</div>
                  <div className="text-sm text-white">
                    {wallet.balancesLoading ? '...' : formatUnits(wallet.kasBalanceWei, 18, 4)}
                  </div>
                </div>
                <div className="rounded bg-gray-800/80 px-2 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{PAYMENT_SYMBOL}</div>
                  <div className="text-sm text-white">
                    {wallet.balancesLoading ? '...' : formatUnits(wallet.usdcBalanceRaw, PAYMENT_DECIMALS, 2)}
                  </div>
                </div>
              </div>
              {(wallet.error || wallet.balanceError) && (
                <div className="mt-2 text-red-400">{wallet.error || wallet.balanceError}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
