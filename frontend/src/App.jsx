import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  BarcodeFormat,
  DecodeHintType,
  NotFoundException
} from '@zxing/library';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:7300'
).replace(/\/$/, '');

const EAN13_REGEX = /^\d{13}$/;
const SCAN_COOLDOWN_MS = 1800;
const CAMERA_REQUEST_TIMEOUT_MS = 10000;
const DEMO_BARCODES = [
  '8410564006257',
  '8992761132013',
  '1234567890123'
];

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);

function chooseDefaultDevice(devices) {
  const rearCamera = devices.find((device) =>
    /back|rear|environment/i.test(device.label)
  );

  return rearCamera?.deviceId ?? devices[0]?.deviceId ?? '';
}

function formatPrice(price) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(price);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    })
  ]);
}

function stopStream(stream) {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

async function playBeep() {
  const AudioContextCtor =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    return;
  }

  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.06;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start();
  oscillator.stop(context.currentTime + 0.08);

  await new Promise((resolve) => {
    oscillator.onended = resolve;
  });

  await context.close();
}

function App() {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const probeStreamRef = useRef(null);
  const lastHandledRef = useRef({
    barcode: '',
    timestamp: 0
  });
  const mountedRef = useRef(false);

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraStatus, setCameraStatus] = useState(
    'Loading available cameras...'
  );
  const [requestStatus, setRequestStatus] = useState(
    'Waiting for an EAN-13 barcode'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [product, setProduct] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [history, setHistory] = useState([]);
  const [manualBarcode, setManualBarcode] = useState(
    '8992761132013'
  );
  const [scannerVersion, setScannerVersion] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);

  function addHistory(entry) {
    setHistory((current) => [entry, ...current].slice(0, 8));
  }

  function stopScanner() {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }

    stopStream(probeStreamRef.current);
    probeStreamRef.current = null;
  }

  async function initializeCamera(forcePrompt = false) {
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof navigator.mediaDevices.enumerateDevices !== 'function'
    ) {
      setCameraStatus('Camera API unavailable');
      setErrorMessage(
        'This browser does not support camera access through MediaDevices.'
      );
      setCameraReady(false);
      return;
    }

    stopStream(probeStreamRef.current);
    probeStreamRef.current = null;
    setCameraStatus(
      forcePrompt
        ? 'Requesting camera permission...'
        : 'Loading available cameras...'
    );
    setErrorMessage('');

    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }
          },
          audio: false
        }),
        CAMERA_REQUEST_TIMEOUT_MS,
        'Timed out while requesting camera access'
      );

      probeStreamRef.current = stream;

      const availableDevices = await withTimeout(
        navigator.mediaDevices.enumerateDevices(),
        CAMERA_REQUEST_TIMEOUT_MS,
        'Timed out while reading camera devices'
      );

      if (!mountedRef.current) {
        stopStream(stream);
        return;
      }

      const videoDevices = availableDevices.filter(
        (device) => device.kind === 'videoinput'
      );

      setDevices(videoDevices);
      setSelectedDeviceId((current) => {
        if (current) {
          return current;
        }

        return chooseDefaultDevice(videoDevices);
      });
      setCameraReady(true);
      setCameraStatus('Camera access granted');
    } catch (error) {
      console.error(error);
      if (!mountedRef.current) {
        return;
      }

      setCameraReady(false);
      setCameraStatus('Camera access failed');
      setErrorMessage(
        'Unable to access the camera. Allow permission in the browser and use the localhost URL.'
      );
    } finally {
      stopStream(probeStreamRef.current);
      probeStreamRef.current = null;
    }
  }

  async function fetchProduct(barcode, source) {
    const normalizedBarcode = barcode.trim();

    if (!EAN13_REGEX.test(normalizedBarcode)) {
      setErrorMessage('EAN-13 barcode must contain exactly 13 digits.');
      setRequestStatus('Rejected invalid barcode');
      setProduct(null);
      return;
    }

    setRequestStatus(`Checking ${normalizedBarcode} on local API...`);
    setErrorMessage('');

    try {
      const response = await fetch(
        `${API_BASE_URL}/product/${encodeURIComponent(
          normalizedBarcode
        )}`
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      const timestamp = Date.now();

      if (data.error) {
        setProduct(null);
        setRequestStatus('Product not found');
        addHistory({
          barcode: normalizedBarcode,
          source,
          status: 'not found',
          timestamp
        });
        return;
      }

      setProduct({
        barcode: normalizedBarcode,
        name: data.name,
        price: data.price
      });
      setRequestStatus('Product loaded from local API');
      addHistory({
        barcode: normalizedBarcode,
        source,
        status: 'success',
        timestamp,
        name: data.name,
        price: data.price
      });
    } catch (error) {
      console.error(error);
      setProduct(null);
      setRequestStatus('Local API unavailable');
      setErrorMessage(
        `Could not reach ${API_BASE_URL}. Start the FastAPI server on port 7300 first.`
      );
      addHistory({
        barcode: normalizedBarcode,
        source,
        status: 'error',
        timestamp: Date.now()
      });
    }
  }

  async function handleDetectedBarcode(barcodeText) {
    const barcode = barcodeText.trim();

    if (!EAN13_REGEX.test(barcode)) {
      setErrorMessage(`Ignored non EAN-13 result: ${barcode}`);
      return;
    }

    const now = Date.now();

    if (
      lastHandledRef.current.barcode === barcode &&
      now - lastHandledRef.current.timestamp < SCAN_COOLDOWN_MS
    ) {
      return;
    }

    lastHandledRef.current = {
      barcode,
      timestamp: now
    };

    setLastScan({
      barcode,
      timestamp: now
    });
    setManualBarcode(barcode);
    setCameraStatus(`Detected ${barcode}`);
    setErrorMessage('');

    try {
      await playBeep();
    } catch (error) {
      console.error(error);
    }

    await fetchProduct(barcode, 'camera');
  }

  useEffect(() => {
    mountedRef.current = true;
    readerRef.current = new BrowserMultiFormatReader(hints);
    void initializeCamera();

    return () => {
      mountedRef.current = false;
      stopScanner();
      readerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cameraReady || !videoRef.current || !readerRef.current) {
      return undefined;
    }

    let cancelled = false;

    async function startScanner() {
      stopScanner();
      setCameraStatus('Starting camera...');
      setErrorMessage('');

      try {
        const onDecode = (result, error) => {
          if (result) {
            void handleDetectedBarcode(result.getText());
            return;
          }

          if (error && !(error instanceof NotFoundException)) {
            console.error(error);
          }
        };

        const controls = selectedDeviceId
          ? await readerRef.current.decodeFromVideoDevice(
              selectedDeviceId,
              videoRef.current,
              onDecode
            )
          : await readerRef.current.decodeFromConstraints(
              {
                video: {
                  facingMode: { ideal: 'environment' }
                }
              },
              videoRef.current,
              onDecode
            );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setCameraStatus('Scanning for EAN-13 barcodes');
      } catch (error) {
        console.error(error);
        if (cancelled) {
          return;
        }

        setCameraStatus('Camera access failed');
        setErrorMessage(
          'Unable to start the camera stream. Allow camera permission, close other apps using the camera, then retry.'
        );
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [cameraReady, selectedDeviceId, scannerVersion]);

  function handleManualSubmit(event) {
    event.preventDefault();
    void fetchProduct(manualBarcode, 'manual');
  }

  function handleDemoBarcodeClick(barcode) {
    setManualBarcode(barcode);
    void fetchProduct(barcode, 'manual');
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Self Checkout Scanner</p>
        <h1>React EAN-13 Barcode Scanner</h1>
        <p className="hero-copy">
          This frontend scans only EAN-13 barcodes and calls your
          local API at <code>{API_BASE_URL}</code>.
        </p>

        <div className="status-strip">
          <span className="status-pill">Camera: {cameraStatus}</span>
          <span className="status-pill">API: {requestStatus}</span>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel scanner-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Live Scan</p>
              <h2>Camera Preview</h2>
            </div>

            <button
              type="button"
              className="ghost-button"
              onClick={async () => {
                await initializeCamera(true);
                setScannerVersion((version) => version + 1);
              }}
            >
              Enable / restart camera
            </button>
          </div>

          <div className="video-frame">
            <video
              ref={videoRef}
              className="scanner-video"
              muted
              autoPlay
              playsInline
            />
            <div className="scan-guides" aria-hidden="true" />
          </div>

          <div className="camera-toolbar">
            <label className="select-field">
              <span>Camera source</span>
              <select
                value={selectedDeviceId}
                onChange={(event) =>
                  setSelectedDeviceId(event.target.value)
                }
                disabled={!devices.length}
              >
                {devices.map((device, index) => (
                  <option
                    key={device.deviceId}
                    value={device.deviceId}
                  >
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="help-copy">
            Use a well-lit scene and place the barcode inside the
            center guide. Duplicate reads are throttled to avoid
            repeated API calls.
          </p>
        </article>

        <article className="panel result-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Lookup</p>
              <h2>Product Result</h2>
            </div>
          </div>

          {lastScan ? (
            <div className="scan-meta">
              <span>Last scan</span>
              <strong>{lastScan.barcode}</strong>
              <span>{formatTime(lastScan.timestamp)}</span>
            </div>
          ) : (
            <div className="empty-state">
              Waiting for the first barcode scan.
            </div>
          )}

          {product ? (
            <div className="product-card">
              <p className="product-barcode">{product.barcode}</p>
              <h3>{product.name}</h3>
              <p className="product-price">
                {formatPrice(product.price)}
              </p>
            </div>
          ) : (
            <div className="empty-state">
              No product loaded yet.
            </div>
          )}

          {errorMessage ? (
            <div className="error-banner">{errorMessage}</div>
          ) : null}

          <form className="manual-form" onSubmit={handleManualSubmit}>
            <label>
              <span>Manual API test</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{13}"
                maxLength={13}
                value={manualBarcode}
                onChange={(event) =>
                  setManualBarcode(
                    event.target.value.replace(/\D/g, '')
                  )
                }
                placeholder="Enter 13 digit EAN barcode"
              />
            </label>

            <button type="submit" className="primary-button">
              Test local GET endpoint
            </button>
          </form>

          <div className="demo-list">
            {DEMO_BARCODES.map((barcode) => (
              <button
                key={barcode}
                type="button"
                className="demo-chip"
                onClick={() => handleDemoBarcodeClick(barcode)}
              >
                {barcode}
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="panel history-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Recent Activity</p>
            <h2>Lookup History</h2>
          </div>
        </div>

        {history.length ? (
          <div className="history-list">
            {history.map((entry) => (
              <div
                key={`${entry.barcode}-${entry.timestamp}-${entry.source}`}
                className="history-row"
              >
                <div>
                  <strong>{entry.barcode}</strong>
                  <p>
                    {entry.source} • {formatTime(entry.timestamp)}
                  </p>
                </div>

                <div className={`history-badge ${entry.status}`}>
                  {entry.status === 'success' && entry.name
                    ? `${entry.name} • ${formatPrice(entry.price)}`
                    : entry.status}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            No API lookups have been recorded yet.
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
