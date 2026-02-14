'use client'

import { useState, useRef, useEffect } from 'react'
import { config } from '@/lib/config'

interface ScanResult {
  success?: boolean
  valid?: boolean
  result: string
  message?: string
  ticket?: {
    id: string
    eventTitle?: string
    status?: string
    redeemedAt?: string
  }
}

export default function ScannerPage() {
  const [qrInput, setQrInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [mode, setMode] = useState<'manual' | 'camera'>('manual')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start camera
  const startCamera = async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setCameraError('Camera access denied or not available')
    }
  }

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  // Switch mode
  useEffect(() => {
    if (mode === 'camera') {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [mode])

  // Verify ticket (read-only)
  const handleVerify = async (qrCode?: string) => {
    const code = qrCode ?? qrInput
    if (!code.trim()) return

    setScanning(true)
    setResult(null)

    try {
      const res = await fetch(`${config.apiBaseUrl}/v1/scans/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode: code }),
      })
      const data = await res.json()
      setResult(data)
    } catch {
      setResult({ result: 'error', message: 'Network error' })
    } finally {
      setScanning(false)
    }
  }

  // Redeem ticket (one-time use)
  const handleRedeem = async (qrCode?: string) => {
    const code = qrCode ?? qrInput
    if (!code.trim()) return

    setScanning(true)
    setResult(null)

    try {
      const res = await fetch(`${config.apiBaseUrl}/v1/scans/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode: code, gateId: 'web-scanner' }),
      })
      const data = await res.json()
      setResult(data)
    } catch {
      setResult({ result: 'error', message: 'Network error' })
    } finally {
      setScanning(false)
    }
  }

  // Result display
  const renderResult = () => {
    if (!result) return null

    const isOk = result.result === 'ok' || result.valid === true
    const bgColor = isOk ? 'bg-green-900/50' : 'bg-red-900/50'
    const borderColor = isOk ? 'border-green-500' : 'border-red-500'
    const textColor = isOk ? 'text-green-400' : 'text-red-400'

    return (
      <div className={`${bgColor} ${borderColor} border-2 rounded-lg p-6 mt-6`}>
        <div className={`text-2xl font-bold ${textColor} mb-2`}>
          {isOk ? '✓ VALID' : '✗ DENIED'}
        </div>
        <div className="text-gray-300">
          {result.message ?? (isOk ? 'Ticket is valid' : 'Ticket rejected')}
        </div>
        {result.ticket && (
          <div className="mt-4 text-sm text-gray-400">
            <div>Event: {result.ticket.eventTitle}</div>
            <div>Ticket ID: {result.ticket.id}</div>
            {result.ticket.redeemedAt && (
              <div>Redeemed: {new Date(result.ticket.redeemedAt).toLocaleString()}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="min-h-screen p-8 bg-gray-900">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            <span className="text-kaspa-primary">Ghost</span>Pass Scanner
          </h1>
          <p className="text-gray-400 mt-2">Verify and redeem tickets at the gate</p>
        </div>

        {/* Mode Switcher */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setMode('manual')}
            className={`px-4 py-2 rounded ${
              mode === 'manual'
                ? 'bg-kaspa-primary text-black'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            Manual Entry
          </button>
          <button
            onClick={() => setMode('camera')}
            className={`px-4 py-2 rounded ${
              mode === 'camera'
                ? 'bg-kaspa-primary text-black'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            Camera Scan
          </button>
        </div>

        {/* Manual Entry Mode */}
        {mode === 'manual' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <label className="block text-sm text-gray-400 mb-2">
              Enter QR Code Content
            </label>
            <textarea
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="TK1|ticketId|saleId|txid|signature"
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white placeholder-gray-500 font-mono text-sm"
              rows={3}
            />
            <div className="flex gap-4 mt-4">
              <button
                onClick={() => handleVerify()}
                disabled={scanning || !qrInput.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 px-6 py-3 rounded font-medium"
              >
                {scanning ? 'Checking...' : 'Verify Only'}
              </button>
              <button
                onClick={() => handleRedeem()}
                disabled={scanning || !qrInput.trim()}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 px-6 py-3 rounded font-medium"
              >
                {scanning ? 'Processing...' : 'Verify & Redeem'}
              </button>
            </div>
          </div>
        )}

        {/* Camera Mode */}
        {mode === 'camera' && (
          <div className="bg-gray-800 rounded-lg p-6">
            {cameraError ? (
              <div className="text-red-400 text-center py-12">
                <div className="text-4xl mb-4">📷</div>
                <div>{cameraError}</div>
                <button
                  onClick={startCamera}
                  className="mt-4 bg-gray-700 px-4 py-2 rounded"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="relative bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full aspect-square object-cover"
                    playsInline
                    muted
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-64 h-64 border-2 border-kaspa-primary rounded-lg" />
                  </div>
                </div>
                <p className="text-center text-gray-400 mt-4 text-sm">
                  Position QR code within the frame.
                  <br />
                  Note: Auto-detection requires additional library integration.
                </p>
                <div className="mt-4">
                  <label className="block text-sm text-gray-400 mb-2">
                    Or paste scanned content:
                  </label>
                  <input
                    type="text"
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    placeholder="TK1|..."
                    className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white font-mono text-sm"
                  />
                  <div className="flex gap-4 mt-4">
                    <button
                      onClick={() => handleVerify()}
                      disabled={scanning || !qrInput.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 px-4 py-2 rounded"
                    >
                      Verify
                    </button>
                    <button
                      onClick={() => handleRedeem()}
                      disabled={scanning || !qrInput.trim()}
                      className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 px-4 py-2 rounded"
                    >
                      Redeem
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Result Display */}
        {renderResult()}

        {/* Instructions */}
        <div className="mt-8 bg-gray-800/50 rounded-lg p-6 text-sm text-gray-400">
          <h3 className="font-semibold text-white mb-3">Instructions</h3>
          <ul className="space-y-2">
            <li>• <strong>Verify Only:</strong> Check if ticket is valid without marking as used</li>
            <li>• <strong>Verify & Redeem:</strong> Check validity AND mark as used (one-time)</li>
            <li>• A ticket can only be redeemed ONCE</li>
            <li>• QR format: <code className="bg-gray-700 px-1 rounded">TK1|ticketId|saleId|txid|signature</code></li>
          </ul>
        </div>
      </div>
    </main>
  )
}
