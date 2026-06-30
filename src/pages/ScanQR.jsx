import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query as firestoreQuery,
  where,
  limit,
} from "firebase/firestore";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { db } from "../firebase/firebaseConfig";
import "../styles/ScanQR.css";
import { useToast } from "../components/ToastContext.jsx";

function ScanQR() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const { showToast } = useToast();
  
  const scannerRef = useRef(null);
  const hasScannedRef = useRef(false);
  const scanActionLockRef = useRef(false);
  const fileInputRef = useRef(null);

  const [scanResult, setScanResult] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
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

  function showActionError(shortMessage, error) {
  const detailedMessage = error?.message
    ? `${shortMessage}: ${error.message}`
    : shortMessage;

  showStatus(detailedMessage, "error");
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  showStatus(message, "error");
  showToast(message, "error");
}

  function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateManualSearchForm() {
  const errors = {};

  if (!manualCode.trim()) {
    errors.manualCode = "Item ID, item code, or barcode is required.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}
  function startScanAction() {
  if (scanActionLockRef.current || isSearching) {
    return false;
  }

  scanActionLockRef.current = true;
  setIsSearching(true);

  return true;
}

function finishScanAction() {
  scanActionLockRef.current = false;
  setIsSearching(false);
}

function isScanBusy() {
  return Boolean(scanActionLockRef.current || isSearching || startingScanner);
}

function canUseAsDocumentId(value) {
  return Boolean(value && !String(value).includes("/"));
}
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error("Unable to read the uploaded image."));
    };

    image.src = imageUrl;
  });
}

async function createScannerFriendlyImageFile(file) {
  const image = await loadImageFromFile(file);

  const minimumWidth = 1200;
  const scale = image.width < minimumWidth ? minimumWidth / image.width : 1;

  const scaledWidth = Math.round(image.width * scale);
  const scaledHeight = Math.round(image.height * scale);

  const padding = Math.max(120, Math.round(scaledWidth * 0.12));

  const canvas = document.createElement("canvas");
  canvas.width = scaledWidth + padding * 2;
  canvas.height = scaledHeight + padding * 2;

  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.imageSmoothingEnabled = false;
  context.drawImage(image, padding, padding, scaledWidth, scaledHeight);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png", 1);
  });

  if (!blob) {
    return file;
  }

  return new File([blob], `scanner-friendly-${file.name}`, {
    type: "image/png",
  });
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

  async function startScanner(forceStart = false) {
    if ((!forceStart && scannerActive) || startingScanner || isSearching) return;

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

      showToast("Scanner started. Point the camera at the QR or barcode.", "success");
    } catch (error) {
      setScannerActive(false);
      setScannerPaused(false);
      showActionError("Camera could not start", error);
    } finally {
      setStartingScanner(false);
    }
  }

async function findItemByScannedValue(scannedValue) {
  const identifier = extractItemIdentifier(scannedValue);

  if (!identifier) {
    throw new Error("No QR or barcode value detected.");
  }

  if (canUseAsDocumentId(identifier)) {
    const directItemRef = doc(db, "items", identifier);
    const directItemSnap = await getDoc(directItemRef);

    if (directItemSnap.exists()) {
      return {
        id: directItemSnap.id,
        ...directItemSnap.data(),
      };
    }
  }

  const searchCandidates = [
    {
      field: "itemCode",
      value: identifier,
    },
    {
      field: "barcodeValue",
      value: identifier,
    },
    {
      field: "qrValue",
      value: scannedValue,
    },
    {
      field: "qrValue",
      value: identifier,
    },
  ];

  const usedQueries = new Set();

  for (const candidate of searchCandidates) {
    const cleanedValue = String(candidate.value || "").trim();

    if (!cleanedValue) continue;

    const queryKey = `${candidate.field}:${cleanedValue}`;

    if (usedQueries.has(queryKey)) continue;

    usedQueries.add(queryKey);

    const itemQuery = firestoreQuery(
      collection(db, "items"),
      where(candidate.field, "==", cleanedValue),
      limit(1)
    );

    const itemSnapshot = await getDocs(itemQuery);

    if (!itemSnapshot.empty) {
      const matchedDocument = itemSnapshot.docs[0];

      return {
        id: matchedDocument.id,
        ...matchedDocument.data(),
      };
    }
  }

  throw new Error("No matching item found.");
}

async function handleDetectedValue(value) {
  if (!value || hasScannedRef.current) return;

  const started = startScanAction();

  if (!started) return;

  hasScannedRef.current = true;
  setScanResult(value);
  showToast("Scanning item record...", "success");

  try {
    const item = await findItemByScannedValue(value);

    await stopScanner(true);

    showToast(`Found item: ${item.itemName || item.id}`, "success");
    setFieldErrors({});

    setTimeout(() => {
      navigate(`/item/${item.id}`);
    }, 600);
  } catch (error) {
    hasScannedRef.current = false;
    showBlockedAction(error.message || "No matching item found.");
  } finally {
    finishScanAction();
  }
}

async function handleManualSearch(e) {
  e.preventDefault();

  if (isScanBusy()) return;

  showStatus("", "");

  const isValid = validateManualSearchForm();

 if (!isValid) {
  return;
}

  clearFieldError("manualCode");

  hasScannedRef.current = false;
  await handleDetectedValue(manualCode.trim());
}

async function handleUploadedImageScan(event) {
  if (isScanBusy()) return;

const file = event.target.files?.[0];

if (!file) {
  return;
}

clearFieldError("uploadImage");

if (!file.type.startsWith("image/")) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    uploadImage: "Please upload an image file only.",
  }));
  showBlockedAction("Please upload an image file only.");
  event.target.value = "";
  return;
}

  const started = startScanAction();

  if (!started) return;

  hasScannedRef.current = true;
  setUploadedFileName(file.name);
  showToast("Reading uploaded QR/barcode image...", "success");

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
  try {
    decodedText = await fileScanner.scanFile(file, false);
  } catch (firstScanError) {
    console.log("Original upload scan failed. Retrying with padded image:", firstScanError);

    const scannerFriendlyFile = await createScannerFriendlyImageFile(file);
    decodedText = await fileScanner.scanFile(scannerFriendlyFile, false);
  }
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
setFieldErrors({});

    setTimeout(() => {
      navigate(`/item/${item.id}`);
    }, 600);
  } catch (error) {
    hasScannedRef.current = false;
    setFieldErrors((previousErrors) => ({
  ...previousErrors,
  uploadImage: "Upload scan failed: " + error.message,
}));
showActionError("Upload scan failed", error);
  } finally {
    finishScanAction();
    event.target.value = "";
  }
}
async function restartScanner() {
  if (isScanBusy()) return;

  await stopScanner(false);

  hasScannedRef.current = false;
  setScanResult("");
  setStatusMessage("");
  setStatusType("");

  await startScanner(true);
}

  useEffect(() => {
    return () => {
      stopScanner(false);
    };
  }, []);

  return (
    <div className="scan-page">
<section className="scan-header scan-header-compact">
  <div className="scan-header-content">
    <div className="scan-header-text">
      <h1>Scan QR</h1>

      <p>
        Scan an item QR code or barcode to open its item details. Admins can
        continue to release and return workflows from this page.
      </p>
    </div>

    <button
      type="button"
      className="scan-secondary-btn scan-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
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
                disabled={scannerActive || startingScanner || isSearching}
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
              onClick={async () => {
                await stopScanner(false);
                showToast("Scanner stopped.", "success");
              }}
              disabled={!scannerActive || isSearching}
            >
              Stop Scanning
            </button>

            <button
              type="button"
              className="scan-secondary-btn"
              onClick={restartScanner}
              disabled={isScanBusy()}
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

          <form onSubmit={handleManualSearch} className="scan-manual-form" noValidate>
<label className="qb-label" htmlFor="manual-code">
  Item ID / Item Code / Barcode <span className="required-star">*</span>
</label>

<input
  id="manual-code"
  type="text"
  className={fieldErrors.manualCode ? "input-error" : ""}
  placeholder="Paste or type scanned value"
  value={manualCode}
  onFocus={() => clearFieldError("manualCode")}
  onChange={(e) => {
    setManualCode(e.target.value);
    clearFieldError("manualCode");
  }}
  disabled={isScanBusy()}
/>

{fieldErrors.manualCode && (
  <p className="field-error-message">{fieldErrors.manualCode}</p>
)}

            <button
              type="submit"
              className="scan-primary-btn"
              disabled={isScanBusy()} 
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
    disabled={isScanBusy()}
  >
    {isSearching ? "Reading..." : "Upload Image"}
  </button>

  {uploadedFileName && (
    <span className="scan-upload-name">{uploadedFileName}</span>
  )}
  {fieldErrors.uploadImage && (
  <p className="field-error-message">{fieldErrors.uploadImage}</p>
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
                  disabled={isScanBusy()}
                >
                  Release Item
                </button>

                <button
                  type="button"
                  className="scan-secondary-btn"
                  onClick={() => navigate("/return-confirmation")}
                  disabled={isScanBusy()}
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