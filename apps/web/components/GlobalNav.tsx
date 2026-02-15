'use client'

import { useState } from 'react'
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
  const networkLabel = onKasplex ? 'Kasplex Testnet' : wallet.chainId ? 'Switch to Kasplex' : 'Network Unknown'
  const [copied, setCopied] = useState(false)

  const handleCopyAddress = () => {
    if (!wallet.address || typeof navigator === 'undefined') return
    void navigator.clipboard
      .writeText(wallet.address)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        setCopied(false)
      })
  }

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
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1 text-xs text-gray-400">
                Kasplex Testnet
              </span>
              <a
                href="https://metamask.io"
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-center text-sm text-yellow-300 sm:w-auto"
              >
                Install MetaMask
              </a>
            </div>
          ) : !wallet.isConnected ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1 text-xs text-gray-400">
                Kasplex Testnet
              </span>
              <button
                onClick={() => void wallet.connect()}
                disabled={wallet.loading}
                className="w-full rounded-full bg-kaspa-primary px-4 py-2 text-sm font-semibold text-black hover:bg-kaspa-primary/90 disabled:opacity-60 sm:w-auto"
              >
                {wallet.loading ? 'Connecting...' : 'Connect Wallet'}
              </button>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${
                  onKasplex
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
                }`}
              >
                {networkLabel}
              </span>
              <details className="group relative w-full sm:w-auto">
                <summary className="flex list-none items-center gap-2 rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1.5 text-xs text-gray-200 shadow-sm hover:border-gray-500 [&::-webkit-details-marker]:hidden">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      onKasplex ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-yellow-400'
                    }`}
                  />
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">
                    {wallet.walletLabel || 'EVM Wallet'}
                  </span>
                  <span className="font-mono text-xs text-white">
                    {wallet.address ? shortenAddress(wallet.address) : '-'}
                  </span>
                  <span className="ml-1 text-gray-400 transition group-open:rotate-180">▾</span>
                </summary>
                <div className="absolute right-0 mt-2 w-full min-w-[260px] max-w-[340px] rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-950/95 via-gray-950/98 to-black/95 p-3 shadow-xl sm:w-80">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">Connected Wallet</div>
                      <div className="mt-1 text-xs text-gray-300">{wallet.walletLabel || 'EVM Wallet'}</div>
                    </div>
                    <button
                      onClick={() => wallet.disconnect()}
                      className="rounded-full border border-gray-700 px-3 py-1 text-[11px] text-gray-200 hover:border-gray-500"
                      type="button"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/70 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Address</div>
                    <div className="mt-1 break-all font-mono text-xs text-white">
                      {wallet.address ?? '-'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleCopyAddress}
                        className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-[11px] text-gray-200 hover:border-gray-500"
                        type="button"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => void wallet.requestAccountSelection()}
                        disabled={wallet.loading}
                        className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-[11px] text-gray-200 hover:border-gray-500 disabled:opacity-60"
                        type="button"
                      >
                        {wallet.loading ? 'Switching...' : 'Switch Wallet'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                    <span>Chain</span>
                    <span className={onKasplex ? 'text-emerald-300' : 'text-yellow-300'}>
                      {wallet.chainId ?? 'unknown'} {onKasplex ? '(Kasplex)' : '(Switch required)'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-2 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">KAS</div>
                      <div className="text-sm text-white">
                        {wallet.balancesLoading ? '...' : formatUnits(wallet.kasBalanceWei, 18, 4)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-2 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">{PAYMENT_SYMBOL}</div>
                      <div className="text-sm text-white">
                        {wallet.balancesLoading ? '...' : formatUnits(wallet.usdcBalanceRaw, PAYMENT_DECIMALS, 2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                    <span>{networkLabel}</span>
                    <button
                      onClick={() => void wallet.refreshBalances()}
                      className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-[11px] text-gray-200 hover:border-gray-500"
                      type="button"
                    >
                      {wallet.balancesLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  {(wallet.error || wallet.balanceError) && (
                    <div className="mt-2 text-xs text-red-400">{wallet.error || wallet.balanceError}</div>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
