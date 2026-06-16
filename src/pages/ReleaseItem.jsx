import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/ReleaseItem.css";

function ReleaseItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const [approvedRequests, setApprovedRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [manualItemId, setManualItemId] = useState("");
const [scannerOpen, setScannerOpen] = useState(false);
const [scannerKey, setScannerKey] = useState(0);
const [startingScanner, setStartingScanner] = useState(false);
const [cameras, setCameras] = useState([]);
const [selectedCameraId, setSelectedCameraId] = useState("");
  const scannerRef = useRef(null);
  const scannerRunningRef = useRef(false);
  const hasScannedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function extractItemId(scannedText) {
    const text = String(scannedText || "").trim();
    const match = text.match(/\/item\/([^/?#]+)/);

    if (match) {
      return decodeURIComponent(match[1]);
    }

    return text;
  }
  function clearScannerDom() {
  const scannerElement = document.getElementById("release-item-reader");

  if (scannerElement) {
    scannerElement.innerHTML = "";
  }
}

async function stopReleaseScanner(showMessage = false) {
  try {
    if (scannerRef.current) {
      if (scannerRunningRef.current) {
        await scannerRef.current.stop();
      }

      await scannerRef.current.clear();
    }
  } catch (error) {
    console.log("Release scanner stop error:", error);
  } finally {
    scannerRef.current = null;
    scannerRunningRef.current = false;
    hasScannedRef.current = false;

    clearScannerDom();

    setScannerOpen(false);

    if (showMessage) {
      showStatus("Scanner closed.", "success");
    }
  }
}
async function getCameraList() {
  const devices = await Html5Qrcode.getCameras();

  setCameras(devices);

  if (devices.length > 0 && !selectedCameraId) {
    const backCamera =
      devices.find((camera) =>
        String(camera.label || "").toLowerCase().includes("back")
      ) ||
      devices.find((camera) =>
        String(camera.label || "").toLowerCase().includes("rear")
      ) ||
      devices[0];

    setSelectedCameraId(backCamera.id);
    return {
      devices,
      cameraId: backCamera.id,
    };
  }

  return {
    devices,
    cameraId: selectedCameraId || devices[0]?.id || "",
  };
}
async function startReleaseScanner() {
  if (startingScanner || releasing) return;

  setStartingScanner(true);
  showStatus("Starting scanner...", "success");

  try {
    await stopReleaseScanner(false);

    hasScannedRef.current = false;
    setScannerKey((current) => current + 1);
    setScannerOpen(true);

    await new Promise((resolve) => setTimeout(resolve, 180));

    clearScannerDom();

    const scanner = new Html5Qrcode("release-item-reader", {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
    });

    scannerRef.current = scanner;

const scannerConfig = {
  fps: 10,
  qrbox: {
    width: 250,
    height: 250,
  },
  aspectRatio: 1.333,
};

const cameraResult = await getCameraList();
const cameraId = cameraResult.cameraId;

if (!cameraId) {
  throw new Error("No camera found on this device.");
}

await scanner.start(
  cameraId,
  scannerConfig,
        async (decodedText) => {
          if (hasScannedRef.current) return;

          hasScannedRef.current = true;

          const itemId = extractItemId(decodedText);

          await stopReleaseScanner(false);
          await findApprovedRequestByItemId(itemId);
        },
        () => {}
      );

    showStatus("Scanner opened. Point the camera at the QR code or barcode.", "success");
  } catch (error) {
    await stopReleaseScanner(false);
    showStatus("Scanner could not start: " + error.message, "error");
  } finally {
    setStartingScanner(false);
  }
}

async function restartReleaseScanner() {
  showStatus("Restarting scanner...", "success");
  await startReleaseScanner();
}
  function openScannerFresh() {
  setScannerKey((current) => current + 1);
  setScannerOpen(true);
  showStatus("Scanner ready. Point the camera at the QR code or barcode.", "success");
    }

    function restartScanner() {
      setScannerKey((current) => current + 1);
      setScannerOpen(true);
      showStatus("Scanner restarted. Try scanning again.", "success");
    }
  function getRequestCategoryId(request) {
    return request.categoryId || request.category || "";
  }

  function getRequestCategoryName(request) {
    return (
      request.categoryName ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
  }

  function getAdminId() {
    return userData?.uid || auth.currentUser?.uid || "";
  }

  function canCategoryAdminSeeRequest(request) {
    if (!isCategoryAdmin) return true;

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    const requestCategoryId = normalizeText(getRequestCategoryId(request));
    const requestCategoryName = normalizeText(getRequestCategoryName(request));

    return (
      assignedCategories.includes(requestCategoryId) ||
      assignedCategories.includes(requestCategoryName)
    );
  }

  async function fetchApprovedRequests() {
    setLoading(true);

    try {
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const requestData = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((request) => request.approvalStatus === "Approved");

      setApprovedRequests(requestData);
    } catch (error) {
      showStatus("Error loading approved requests: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  const visibleApprovedRequests = useMemo(() => {
    if (isCategoryAdmin) {
      return approvedRequests.filter((request) =>
        canCategoryAdminSeeRequest(request)
      );
    }

    return approvedRequests;
  }, [approvedRequests, userData]);

  async function findApprovedRequestByItemId(rawItemId) {
    const itemId = extractItemId(rawItemId);
    showStatus("", "");

    if (!itemId) {
      showStatus("Please scan or enter an item ID, barcode, or QR URL.", "error");
      return;
    }

    try {
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const matchingRequest = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .find(
          (request) =>
            request.itemId === itemId && request.approvalStatus === "Approved"
        );

      if (!matchingRequest) {
        setSelectedRequest(null);
        showStatus("No approved request found for this item.", "error");
        return;
      }

      if (isCategoryAdmin && !canCategoryAdminSeeRequest(matchingRequest)) {
        setSelectedRequest(null);
        showStatus(
          "This request belongs to a category that is not assigned to your account.",
          "error"
        );
        return;
      }

      setSelectedRequest(matchingRequest);
      setManualItemId(itemId);
      showStatus("Approved request found. Review details before release.", "success");
    } catch (error) {
      showStatus("Error finding approved request: " + error.message, "error");
    }
  }

  async function handleConfirmRelease() {
    if (!selectedRequest) {
      showStatus("Please scan or select an approved request first.", "error");
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(selectedRequest)) {
      showStatus("You are not allowed to release this category item.", "error");
      return;
    }

    const confirmRelease = window.confirm(
      `Confirm release of ${selectedRequest.itemName} to ${
        selectedRequest.borrowerName || selectedRequest.borrowerEmail
      }?`
    );

    if (!confirmRelease) return;

    setReleasing(true);
    showStatus("", "");

    try {
      const requestRef = doc(db, "borrowRequests", selectedRequest.id);
      const itemRef = doc(db, "items", selectedRequest.itemId);
      const itemSnap = await getDoc(itemRef);

      if (!itemSnap.exists()) {
        showStatus("Item record not found. Release cannot continue.", "error");
        return;
      }

      const itemData = itemSnap.data();

      if (
        itemData.availability !== "Reserved" &&
        itemData.availability !== "Available"
      ) {
        showStatus(
          `This item is currently ${itemData.availability}. It cannot be released.`,
          "error"
        );
        return;
      }

      await updateDoc(requestRef, {
        approvalStatus: "Borrowed",
        releasedAt: serverTimestamp(),
        releasedBy: getAdminId(),
      });

      await updateDoc(itemRef, {
        availability: "Borrowed",
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: selectedRequest.borrowerId,
        targetRole: "borrower",
        categoryId: getRequestCategoryId(selectedRequest),
        title: "Item Released",
        message: `${selectedRequest.itemName} has been released to you. Please return it on or before ${selectedRequest.expectedReturnDate}.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });

      showStatus("Item released successfully. Request is now Borrowed.", "success");
      setSelectedRequest(null);
      setManualItemId("");
      fetchApprovedRequests();
    } catch (error) {
      showStatus("Error releasing item: " + error.message, "error");
    } finally {
      setReleasing(false);
    }
  }

  useEffect(() => {
    fetchApprovedRequests();
  }, []);
useEffect(() => {
  getCameraList().catch((error) => {
    console.log("Camera list error:", error);
  });
}, []);

useEffect(() => {
  return () => {
    stopReleaseScanner(false);
  };
}, []);

  if (loading) {
    return (
      <div className="release-loading">
        <div className="release-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading release queue...</h2>
          <p>Checking approved requests waiting for release.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="release-page">
      <section className="release-header">
        <div>
          <p className="qb-kicker">Release Scan</p>

          <h1>Release Item</h1>

          <p>
            Scan the item QR code or barcode before giving it to the borrower.
            This confirms the approved item is physically released.
          </p>

          {isCategoryAdmin && (
            <div className="release-assigned-note">
              Assigned categories:{" "}
              {Array.isArray(userData?.assignedCategories) &&
              userData.assignedCategories.length > 0
                ? userData.assignedCategories.join(", ")
                : "No assigned categories yet"}
            </div>
          )}
        </div>

        <button
          type="button"
          className="release-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </section>

      {statusMessage && (
        <div className={`release-status release-status-${statusType}`} role="status">
          {statusMessage}
        </div>
      )}

      <section className="release-layout">
        <section className="release-scanner-card">
          <div className="release-card-heading">
            <h2>Scan or Enter Item ID</h2>
            <p>
              QR values may contain a full item URL. Barcode values may contain
              only the item ID.
            </p>
          </div>
{cameras.length > 0 && (
  <div className="release-camera-select">
    <label className="qb-label" htmlFor="release-camera">
      Camera
    </label>

    <select
      id="release-camera"
      value={selectedCameraId}
      onChange={(event) => setSelectedCameraId(event.target.value)}
      disabled={scannerOpen || startingScanner}
    >
      {cameras.map((camera, index) => (
        <option key={camera.id} value={camera.id}>
          {camera.label || `Camera ${index + 1}`}
        </option>
      ))}
    </select>
  </div>
)}
<div className="release-scanner-actions">
  <button
    type="button"
    className="release-primary-btn"
    onClick={() => {
      if (scannerOpen) {
        stopReleaseScanner(true);
      } else {
        startReleaseScanner();
      }
    }}
    disabled={startingScanner}
  >
    {startingScanner
      ? "Opening..."
      : scannerOpen
        ? "Close Scanner"
        : "Open QR / Barcode Scanner"}
  </button>

  <button
    type="button"
    className="release-secondary-btn"
    onClick={restartReleaseScanner}
    disabled={startingScanner}
  >
    Restart Scanner
  </button>
</div>

{scannerOpen && (
  <div className="release-scanner-box" key={scannerKey}>
    <div id="release-item-reader"></div>
  </div>
)}

          <div className="release-manual-form">
            <label className="qb-label" htmlFor="manual-item-id">
              Manual Item ID / Barcode / QR URL
            </label>

            <div className="release-manual-row">
              <input
                id="manual-item-id"
                type="text"
                value={manualItemId}
                onChange={(e) => setManualItemId(e.target.value)}
                placeholder="Example: item ID or /item/itemId"
              />

              <button
                type="button"
                className="release-secondary-btn"
                onClick={() => findApprovedRequestByItemId(manualItemId)}
              >
                Find
              </button>
            </div>
          </div>
        </section>

        <section className="release-selected-card">
          <div className="release-card-heading">
            <h2>Selected Request</h2>
            <p>Review the request before confirming physical release.</p>
          </div>

          {selectedRequest ? (
            <>
              <div className="release-selected-topline">
                <span>{selectedRequest.itemCode || selectedRequest.itemId}</span>
                <strong>{selectedRequest.approvalStatus}</strong>
              </div>

              <h3>{selectedRequest.itemName}</h3>

              <div className="release-info-grid">
                <div>
                  <span>Borrower</span>
                  <strong>
                    {selectedRequest.borrowerName || "Unnamed Borrower"}
                  </strong>
                  <p>{selectedRequest.borrowerEmail}</p>
                </div>

                <div>
                  <span>Category</span>
                  <strong>{getRequestCategoryName(selectedRequest)}</strong>
                </div>

                <div>
                  <span>Borrow Date</span>
                  <strong>{selectedRequest.borrowDate}</strong>
                </div>

                <div>
                  <span>Expected Return</span>
                  <strong>{selectedRequest.expectedReturnDate}</strong>
                </div>
              </div>

              <div className="release-purpose-box">
                <span>Purpose</span>
                <p>{selectedRequest.purpose || "No purpose provided."}</p>
              </div>

              <button
                type="button"
                className="release-confirm-btn"
                onClick={handleConfirmRelease}
                disabled={releasing}
              >
                {releasing ? "Releasing..." : "Confirm Release"}
              </button>
            </>
          ) : (
            <div className="release-empty-selected">
              <img src="/qborrow-logo.png" alt="QBorrow Logo" />
              <h3>No selected request yet</h3>
              <p>Scan an item or select from the approved request queue.</p>
            </div>
          )}
        </section>
      </section>

      <section className="release-queue-panel">
        <div className="release-section-heading">
          <div>
            <h2>Approved Requests Waiting for Release</h2>
            <p>
              Showing {visibleApprovedRequests.length} approved request
              {visibleApprovedRequests.length === 1 ? "" : "s"}.
            </p>
          </div>

          <button
            type="button"
            className="release-secondary-btn"
            onClick={fetchApprovedRequests}
          >
            Refresh
          </button>
        </div>

        {visibleApprovedRequests.length === 0 ? (
          <div className="release-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No approved requests</h2>
            <p>No items are currently waiting for release.</p>
          </div>
        ) : (
          <div className="release-request-grid">
            {visibleApprovedRequests.map((request) => (
              <article className="release-request-card" key={request.id}>
                <div className="release-request-topline">
                  <span>{request.itemCode || request.itemId}</span>
                  <strong>{request.approvalStatus}</strong>
                </div>

                <h3>{request.itemName}</h3>

                <div className="release-request-meta">
                  <div>
                    <span>Borrower</span>
                    <strong>{request.borrowerName || request.borrowerEmail}</strong>
                  </div>

                  <div>
                    <span>Expected Return</span>
                    <strong>{request.expectedReturnDate}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="release-primary-btn"
                  onClick={() => {
                    setSelectedRequest(request);
                    setManualItemId(request.itemId);
                    showStatus("Approved request selected.", "success");
                  }}
                >
                  Select
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default ReleaseItem;