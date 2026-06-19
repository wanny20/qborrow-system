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
  query as firestoreQuery,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/ReleaseItem.css";

function ReleaseItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const { showToast } = useToast();

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
  const releaseLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }
  function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateManualFindForm(value) {
  const errors = {};

  if (!String(value || "").trim()) {
    errors.manualItemId = "Manual Item ID, barcode, or QR URL is required.";
  }

  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    ...errors,
  }));

  return Object.keys(errors).length === 0;
}

function validateReleaseForm() {
  const errors = {};

  if (!selectedRequest) {
    errors.selectedRequest = "Please scan, enter, or select an approved request first.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}
  function startReleaseAction() {
  if (releaseLockRef.current || releasing) {
    return false;
  }

  releaseLockRef.current = true;
  setReleasing(true);

  return true;
}

function finishReleaseAction() {
  releaseLockRef.current = false;
  setReleasing(false);
}

function isReleaseBusy() {
  return Boolean(releaseLockRef.current || releasing || startingScanner);
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
    const approvedQuery = firestoreQuery(
      collection(db, "borrowRequests"),
      where("approvalStatus", "==", "Approved")
    );

    const querySnapshot = await getDocs(approvedQuery);

    const requestData = querySnapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

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
  if (isReleaseBusy()) return;

const itemId = extractItemId(rawItemId);
showStatus("", "");

const isValid = validateManualFindForm(itemId);

if (!isValid) {
  return;
}

clearFieldError("manualItemId");

  try {
    const itemRequestQuery = firestoreQuery(
      collection(db, "borrowRequests"),
      where("itemId", "==", itemId)
    );

    const querySnapshot = await getDocs(itemRequestQuery);

    let matchingRequest = querySnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .find((request) => request.approvalStatus === "Approved");

    if (!matchingRequest) {
      const approvedQuery = firestoreQuery(
        collection(db, "borrowRequests"),
        where("approvalStatus", "==", "Approved")
      );

      const approvedSnapshot = await getDocs(approvedQuery);

      matchingRequest = approvedSnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .find(
          (request) =>
            request.itemId === itemId ||
            request.itemCode === itemId ||
            request.barcodeValue === itemId
        );
    }

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
setFieldErrors({});
showStatus("Approved request found. Review details before release.", "success");
  } catch (error) {
    showStatus("Error finding approved request: " + error.message, "error");
  }
}

async function handleConfirmRelease() {
  showStatus("", "");

  const isValid = validateReleaseForm();

if (!isValid) {
  return;
}

  if (isCategoryAdmin && !canCategoryAdminSeeRequest(selectedRequest)) {
    showStatus("You are not allowed to release this category item.", "error");
    return;
  }

  const started = startReleaseAction();

  if (!started) return;

  try {
    const confirmRelease = window.confirm(
      `Confirm release of ${selectedRequest.itemName} to ${
        selectedRequest.borrowerName || selectedRequest.borrowerEmail
      }?`
    );

    if (!confirmRelease) return;

    showStatus("", "");

    const requestRef = doc(db, "borrowRequests", selectedRequest.id);
    const latestRequestSnap = await getDoc(requestRef);

    if (!latestRequestSnap.exists()) {
      showStatus("This request no longer exists.", "error");
      return;
    }

    const latestRequest = {
      id: latestRequestSnap.id,
      ...latestRequestSnap.data(),
    };

    if (latestRequest.approvalStatus !== "Approved") {
      showStatus(
        `This request is already ${latestRequest.approvalStatus}. Refreshing release queue...`,
        "error"
      );

      setSelectedRequest(null);
      setManualItemId("");
      await fetchApprovedRequests();
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(latestRequest)) {
      showStatus("You are not allowed to release this category item.", "error");
      return;
    }

    const itemRef = doc(db, "items", latestRequest.itemId);
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
      updatedAt: serverTimestamp(),
    });

    await updateDoc(itemRef, {
      availability: "Borrowed",
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "notifications"), {
      userId: latestRequest.borrowerId,
      targetRole: "borrower",
      categoryId: getRequestCategoryId(latestRequest),
      title: "Item Released",
      message: `${latestRequest.itemName} has been released to you. Please return it on or before ${latestRequest.expectedReturnDate}.`,
      status: "Unread",
      createdAt: serverTimestamp(),
      link: "/my-requests",
    });

      showToast("Item Released", "success");
      setSelectedRequest(null);
      setManualItemId("");
      await fetchApprovedRequests();

  } catch (error) {
    showStatus("Error releasing item: " + error.message, "error");
  } finally {
    finishReleaseAction();
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
<section className="release-header release-header-compact">
  <div className="release-header-content">
<div className="release-header-text">
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
      className="release-secondary-btn release-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
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
    disabled={startingScanner || releasing}
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
    disabled={startingScanner || releasing}
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
  Manual Item ID / Barcode / QR URL <span className="required-star">*</span>
</label>

            <div className="release-manual-row">
<input
  id="manual-item-id"
  type="text"
  className={fieldErrors.manualItemId ? "input-error" : ""}
  value={manualItemId}
  onFocus={() => clearFieldError("manualItemId")}
  onChange={(e) => {
    setManualItemId(e.target.value);
    clearFieldError("manualItemId");
  }}
  placeholder="Example: item ID or /item/itemId"
  disabled={releasing}
/>

            <button
              type="button"
              className="release-secondary-btn"
              onClick={() => findApprovedRequestByItemId(manualItemId)}
              disabled={releasing}
            >
              Find
            </button>
            </div>
            {fieldErrors.manualItemId && (
  <p className="field-error-message">{fieldErrors.manualItemId}</p>
)}
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

  {fieldErrors.selectedRequest && (
    <p className="field-error-message">{fieldErrors.selectedRequest}</p>
  )}
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
            disabled={releasing}
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
<>
  <div className="release-approved-table-header">
    <span>Item</span>
    <span>Borrower</span>
    <span>Category</span>
    <span>Expected Return</span>
    <span>Status</span>
    <span>Action</span>
  </div>

  <div className="release-approved-table-grid">
    {visibleApprovedRequests.map((request) => (
      <article
        className={`release-approved-row ${
          selectedRequest?.id === request.id ? "selected" : ""
        }`}
        key={request.id}
      >
        <div className="release-approved-cell release-approved-item-cell">
          <span>{request.itemCode || request.itemId}</span>
          <strong>{request.itemName || "Untitled Item"}</strong>
        </div>

        <div className="release-approved-cell release-approved-borrower-cell">
          <span>{request.borrowerEmail || "No email"}</span>
          <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
        </div>

        <div className="release-approved-cell">
          <span>Category</span>
          <strong>{getRequestCategoryName(request)}</strong>
        </div>

        <div className="release-approved-cell">
          <span>Expected Return</span>
          <strong>{request.expectedReturnDate || "Not set"}</strong>
        </div>

        <div className="release-approved-status-cell">
          <span>{request.approvalStatus || "Approved"}</span>
        </div>

        <div className="release-approved-actions">
          <button
            type="button"
            className="release-primary-btn"
            onClick={() => {
              if (releasing) return;

              setSelectedRequest(request);
              setManualItemId(request.itemId);
              setFieldErrors({});
              showStatus("Approved request selected.", "success");
            }}
            disabled={releasing || selectedRequest?.id === request.id}
          >
            {selectedRequest?.id === request.id ? "Selected" : "Select"}
          </button>
        </div>
      </article>
    ))}
  </div>
</>
        )}
      </section>
    </div>
  );
}

export default ReleaseItem;