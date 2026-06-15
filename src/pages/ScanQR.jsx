import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { db } from "../firebase/firebaseConfig";
import "../styles/ScanQR.css";

function ScanQR() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const scannerRef = useRef(null);
  const hasScannedRef = useRef(false);
  const fileInputRef = useRef(null);

  const [scanResult, setScanResult] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerPaused, setScannerPaused] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [startingScanner, setStartingScanner] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");

  const isAdmin =
    userData?.role === "superAdmin" || userData?.role === "categoryAdmin";

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function extractItemIdentifier(scannedText) {
    const text = String(scannedText || "").trim();

    if (!text) return "";

    const itemUrlMatch = text.match(/\/item\/([^/?#]+)/);

    if (itemUrlMatch) {
      return decodeURIComponent(itemUrlMatch[1]);
    }

    return text;
  }

  async function getCameraList() {
    const devices = await Html5Qrcode.getCameras();

    setCameras(devices);

    if (devices.length > 0 && !selectedCameraId) {
      setSelectedCameraId(devices[0].id);
    }

    return devices;
  }

  async function stopScanner(showPaused = false) {
    try {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }

        await scannerRef.current.clear();
      }
    } catch (error) {
      console.log("Scanner stop error:", error);
    } finally {
      scannerRef.current = null;
      setScannerActive(false);
      setScannerPaused(showPaused);
    }
  }

  async function startScanner() {
    if (scannerActive || startingScanner || isSearching) return;

    hasScannedRef.current = false;
    setScanResult("");
    setScannerPaused(false);
    setStartingScanner(true);
    showStatus("", "");

    try {
      let cameraId = selectedCameraId;
      let availableCameras = cameras;

      if (!cameraId) {
        availableCameras = await getCameraList();

        if (availableCameras.length === 0) {
          throw new Error("No camera found on this device.");
        }

        cameraId = availableCameras[0].id;
        setSelectedCameraId(cameraId);
      }

      setScannerActive(true);

      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });

      const scanner = new Html5Qrcode("qr-reader", {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
      });

      scannerRef.current = scanner;

      await scanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: {
            width: 240,
            height: 240,
          },
          aspectRatio: 1.333,
        },
        async (decodedText) => {
          await handleDetectedValue(decodedText);
        },
        () => {}
      );

      showStatus("Scanner started. Point the camera at the QR or barcode.", "success");
    } catch (error) {
      setScannerActive(false);
      setScannerPaused(false);
      showStatus("Camera could not start: " + error.message, "error");
    } finally {
      setStartingScanner(false);
    }
  }

  async function findItemByScannedValue(scannedValue) {
    const identifier = extractItemIdentifier(scannedValue);

    if (!identifier) {
      throw new Error("No QR or barcode value detected.");
    }

    const directItemRef = doc(db, "items", identifier);
    const directItemSnap = await getDoc(directItemRef);

    if (directItemSnap.exists()) {
      return {
        id: directItemSnap.id,
        ...directItemSnap.data(),
      };
    }

    const itemsSnapshot = await getDocs(collection(db, "items"));

    const matchedItem = itemsSnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .find((item) => {
        return (
          item.itemCode === identifier ||
          item.barcodeValue === identifier ||
          item.qrValue === scannedValue ||
          item.qrValue === identifier
        );
      });

    if (!matchedItem) {
      throw new Error("No matching item found.");
    }

    return matchedItem;
  }

  async function handleDetectedValue(value) {
    if (!value || hasScannedRef.current || isSearching) return;

    hasScannedRef.current = true;
    setScanResult(value);
    setIsSearching(true);
    showStatus("Scanning item record...", "success");

    try {
      const item = await findItemByScannedValue(value);

      await stopScanner(true);

      showStatus(`Found item: ${item.itemName || item.id}`, "success");

      setTimeout(() => {
        navigate(`/item/${item.id}`);
      }, 600);
    } catch (error) {
      hasScannedRef.current = false;
      showStatus(error.message, "error");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleManualSearch(e) {
    e.preventDefault();

    if (!manualCode.trim()) {
      showStatus("Please enter an item ID, item code, or barcode value.", "error");
      return;
    }

    await handleDetectedValue(manualCode.trim());
  }
  async function handleUploadedImageScan(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  setUploadedFileName(file.name);
  setIsSearching(true);
  showStatus("Reading uploaded QR/barcode image...", "success");

  try {
    await stopScanner(false);

    const fileScanner = new Html5Qrcode("qr-file-reader", {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
    });

    let decodedText = "";

    try {
      decodedText = await fileScanner.scanFile(file, false);
    } finally {
      try {
        await fileScanner.clear();
      } catch (error) {
        console.log("File scanner clear error:", error);
      }
    }

    if (!decodedText) {
      throw new Error("No QR or barcode detected in the uploaded image.");
    }

    setScanResult(decodedText);

    const item = await findItemByScannedValue(decodedText);

    showStatus(`Found item: ${item.itemName || item.id}`, "success");

    setTimeout(() => {
      navigate(`/item/${item.id}`);
    }, 600);
  } catch (error) {
    showStatus("Upload scan failed: " + error.message, "error");
  } finally {
    setIsSearching(false);
    event.target.value = "";
  }
}
  async function restartScanner() {
    await stopScanner(false);

    hasScannedRef.current = false;
    setScanResult("");
    setStatusMessage("");
    setStatusType("");

    await startScanner();
  }

  useEffect(() => {
    return () => {
      stopScanner(false);
    };
  }, []);

  return (
    <div className="scan-page">
      <section className="scan-header">
        <div>
          <div className="scan-header-topline">
            <p className="qb-kicker">QR / Barcode Scanner</p>

            <button
              type="button"
              className="scan-secondary-btn"
              onClick={() => navigate("/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>

          <h1>Scan Item</h1>

          <p>
            Scan the QR code or barcode attached to an item. Borrowers can open
            item details, while admins can use release and return shortcuts.
          </p>
        </div>
      </section>

      {statusMessage && (
        <div className={`scan-status scan-status-${statusType}`} role="status">
          {statusMessage}
        </div>
      )}

      <section className="scan-layout">
        <section className="scan-card">
          <div className="scan-section-heading">
            <h2>Camera Scanner</h2>
            <p>Choose a camera, then start scanning the QR code or barcode.</p>
          </div>

          <div className="scan-reader-shell">
            <div className="scan-custom-reader">
              <div
                id="qr-reader"
                className={scannerActive ? "" : "scan-hidden-reader"}
              ></div>

              {!scannerActive && (
                <div className="scan-reader-paused">
                  <span>{scannerPaused ? "✓" : "⌁"}</span>

                  <h3>{scannerPaused ? "Scanner Paused" : "Scanner Ready"}</h3>

                  <p>
                    {scannerPaused
                      ? "The item was detected. Opening item details..."
                      : "Click Start Scanning to open your camera."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="scan-camera-controls">
            {cameras.length > 0 && (
              <select
                value={selectedCameraId}
                onChange={(event) => setSelectedCameraId(event.target.value)}
                disabled={scannerActive || startingScanner}
              >
                {cameras.map((camera, index) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              className="scan-primary-btn"
              onClick={startScanner}
              disabled={scannerActive || startingScanner || isSearching}
            >
              {startingScanner ? "Starting..." : "Start Scanning"}
            </button>

            <button
              type="button"
              className="scan-secondary-btn"
              onClick={() => stopScanner(false)}
              disabled={!scannerActive}
            >
              Stop Scanning
            </button>

            <button
              type="button"
              className="scan-secondary-btn"
              onClick={restartScanner}
              disabled={startingScanner || isSearching}
            >
              Restart Scanner
            </button>
          </div>

          {scanResult && (
            <div className="scan-result-box">
              <span>Scanned Result</span>
              <strong>{scanResult}</strong>
            </div>
          )}
        </section>

        <aside className="scan-side-panel">
          <div className="scan-section-heading">
            <h2>Manual Search</h2>
            <p>
              Use this if the camera cannot read the QR code or barcode clearly.
            </p>
          </div>

          <form onSubmit={handleManualSearch} className="scan-manual-form">
            <label className="qb-label" htmlFor="manual-code">
              Item ID / Item Code / Barcode
            </label>

            <input
              id="manual-code"
              type="text"
              placeholder="Paste or type scanned value"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />

            <button
              type="submit"
              className="scan-primary-btn"
              disabled={isSearching}
            >
              {isSearching ? "Searching..." : "Open Item"}
            </button>
          </form>
          <div className="scan-upload-card">
  <h3>Upload QR / Barcode Image</h3>

  <p>
    Upload a clear screenshot or photo of the QR code or barcode.
  </p>

  <input
    ref={fileInputRef}
    type="file"
    accept="image/*"
    onChange={handleUploadedImageScan}
    hidden
  />

  <button
    type="button"
    className="scan-secondary-btn"
    onClick={() => fileInputRef.current?.click()}
    disabled={isSearching}
  >
    {isSearching ? "Reading..." : "Upload Image"}
  </button>

  {uploadedFileName && (
    <span className="scan-upload-name">{uploadedFileName}</span>
  )}
</div>

<div id="qr-file-reader" className="scan-file-reader-hidden"></div>

          <div className="scan-help-card">
            <h3>Scanner Tips</h3>

            <ul>
              <li>Use good lighting.</li>
              <li>Keep the QR code inside the scanner box.</li>
              <li>For barcode, scan the printed CODE_128 value.</li>
              <li>Use manual search if scanning fails.</li>
            </ul>
          </div>

          {isAdmin && (
            <div className="scan-admin-shortcuts">
              <h3>Admin Shortcuts</h3>

              <div>
                <button
                  type="button"
                  className="scan-secondary-btn"
                  onClick={() => navigate("/release-item")}
                >
                  Release Item
                </button>

                <button
                  type="button"
                  className="scan-secondary-btn"
                  onClick={() => navigate("/return-confirmation")}
                >
                  Return Item
                </button>
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

export default ScanQR;