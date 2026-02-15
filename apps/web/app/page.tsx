import Image from 'next/image'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center">
        <div className="mb-6 flex justify-center">
          <Image
            src="/logo-mark.png"
            alt="Tickasting logo mark"
            width={120}
            height={120}
            priority
          />
        </div>
        <h1 className="text-5xl font-bold mb-4">
          <span className="text-kaspa-primary">Tickasting</span>
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          Fair Ticketing Powered by Kasplex EVM
        </p>
        <div className="bg-gray-800 rounded-lg p-6 max-w-md">
          <p className="text-sm text-gray-300 mb-4">
            The server doesn&apos;t create the queue.
            <br />
            The chain does. Verifiable by anyone.
          </p>
          <div className="flex gap-4 justify-center">
            <span className="px-3 py-1 bg-kaspa-primary/20 text-kaspa-primary rounded text-sm">
              Deterministic Ordering
            </span>
            <span className="px-3 py-1 bg-kaspa-primary/20 text-kaspa-primary rounded text-sm">
              On-Chain USDC Purchase
            </span>
          </div>
        </div>
        <p className="mt-8 text-gray-500 text-sm">
          Development build - MVP in progress
        </p>
      </div>
    </main>
  )
}
