import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  query as firestoreQuery,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/ReturnConfirmation.css";

function ReturnConfirmation() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const { showToast } = useToast();

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  const today = getTodayDate();

  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [manualItemId, setManualItemId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [viewingBorrowedRequest, setViewingBorrowedRequest] = useState(null);

  const [actualReturnDate] = useState(today);
  const [returnCondition, setReturnCondition] = useState("Good");
  const [damageLostReport, setDamageLostReport] = useState("");

  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const returnLockRef = useRef(false);
  const scannerLockRef = useRef(false);

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

function validateReturnForm() {
  const errors = {};

  if (!selectedRequest) {
    errors.selectedRequest = "Please scan, enter, or select a borrowed request first.";
  }

  if (!actualReturnDate) {
    errors.actualReturnDate = "Actual return date is required.";
  }

  if (!returnCondition) {
    errors.returnCondition = "Return condition is required.";
  }

  if (
    (returnCondition === "Damaged" || returnCondition === "Lost") &&
    !damageLostReport.trim()
  ) {
    errors.damageLostReport = "Damage / lost report is required.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

function validateReturnField(fieldName) {
  setFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "manualItemId") {
      if (!manualItemId.trim()) {
        nextErrors.manualItemId =
          "Manual Item ID, barcode, or QR URL is required.";
      } else {
        delete nextErrors.manualItemId;
      }
    }

    if (fieldName === "selectedRequest") {
      if (!selectedRequest) {
        nextErrors.selectedRequest =
          "Please scan, enter, or select a borrowed request first.";
      } else {
        delete nextErrors.selectedRequest;
      }
    }

    if (fieldName === "actualReturnDate") {
      if (!actualReturnDate) {
        nextErrors.actualReturnDate = "Actual return date is required.";
      } else {
        delete nextErrors.actualReturnDate;
      }
    }

    if (fieldName === "returnCondition") {
      if (!returnCondition) {
        nextErrors.returnCondition = "Return condition is required.";
      } else {
        delete nextErrors.returnCondition;
      }
    }

    if (fieldName === "damageLostReport") {
      if (
        (returnCondition === "Damaged" || returnCondition === "Lost") &&
        !damageLostReport.trim()
      ) {
        nextErrors.damageLostReport = "Damage / lost report is required.";
      } else {
        delete nextErrors.damageLostReport;
      }
    }

    return nextErrors;
  });
}

function sanitizeScannerInput(value) {
  return String(value || "").replace(/[<>`]/g, "");
}

function sanitizeReportText(value) {
  return String(value || "").replace(/[<>`]/g, "");
}

  function startReturnAction() {
  if (returnLockRef.current || confirming) {
    return false;
  }

  returnLockRef.current = true;
  setConfirming(true);

  return true;
}

function finishReturnAction() {
  returnLockRef.current = false;
  setConfirming(false);
}

function isReturnBusy() {
  return Boolean(returnLockRef.current || confirming);
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

  function getAdminId() {
    return userData?.uid || auth.currentUser?.uid || "";
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

  function cleanDisplay(value, fallback = "Not set") {
    const cleanedValue = String(value || "").trim();
    return cleanedValue || fallback;
  }

  function getBorrowerUserType(request) {
    return cleanDisplay(request?.borrowerUserType, "Student");
  }

  function getBorrowerIdNumber(request) {
    const borrowerType = getBorrowerUserType(request);

    if (borrowerType === "Faculty" || borrowerType === "Staff") {
      return cleanDisplay(request?.borrowerEmployeeId);
    }

    return cleanDisplay(request?.borrowerStudentNumber);
  }

  function getBorrowerYearSection(request) {
    const values = [
      request?.borrowerYearLevel,
      request?.borrowerSection,
    ].filter(Boolean);

    return values.length > 0 ? values.join(" - ") : "Not set";
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

  function isOverdue(expectedReturnDate) {
    if (!expectedReturnDate) return false;

    const currentDate = new Date(today);
    const expectedDate = new Date(expectedReturnDate);

    currentDate.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return currentDate > expectedDate;
  }

  function getOverdueStatus(expectedReturnDate) {
    return isOverdue(expectedReturnDate) ? "Overdue" : "Not Overdue";
  }

  function addDaysToToday(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);

    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function getNewItemAvailability() {
    if (returnCondition === "Good" || returnCondition === "Fair") {
      return "Available";
    }

    if (returnCondition === "Damaged") {
      return "Damaged";
    }

    if (returnCondition === "Lost") {
      return "Lost";
    }

    return "Unavailable";
  }

async function fetchBorrowedRequests() {
  setLoading(true);

  try {
    const borrowedQuery = firestoreQuery(
      collection(db, "borrowRequests"),
      where("approvalStatus", "==", "Borrowed")
    );

    const querySnapshot = await getDocs(borrowedQuery);

    const requestData = querySnapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    setRequests(requestData);
  } catch (error) {
    showStatus("Error loading borrowed requests: " + error.message, "error");
  } finally {
    setLoading(false);
  }
}

  const visibleBorrowedRequests = useMemo(() => {
    if (isCategoryAdmin) {
      return requests.filter((request) => canCategoryAdminSeeRequest(request));
    }

    return requests;
  }, [requests, userData]);

  function selectBorrowedRequest(request) {
  if (confirming) return;

  setSelectedRequest(request);
  setManualItemId(request.itemId);
  setReturnCondition("Good");
  setDamageLostReport("");
  setFieldErrors({});
  setViewingBorrowedRequest(null);
  showToast("Borrowed request selected.", "success");
}

async function findBorrowedRequestByItemId(rawItemId) {
  if (isReturnBusy()) return;

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
      .find((request) => request.approvalStatus === "Borrowed");

    if (!matchingRequest) {
      const borrowedQuery = firestoreQuery(
        collection(db, "borrowRequests"),
        where("approvalStatus", "==", "Borrowed")
      );

      const borrowedSnapshot = await getDocs(borrowedQuery);

      matchingRequest = borrowedSnapshot.docs
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
      showStatus("No active borrowed request found for this item.", "error");
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(matchingRequest)) {
      setSelectedRequest(null);
      showStatus(
        "This borrowed item belongs to a category that is not assigned to your account.",
        "error"
      );
      return;
    }

    setSelectedRequest(matchingRequest);
    setManualItemId(itemId);
    setReturnCondition("Good");
    setDamageLostReport("");
    setFieldErrors({});
    showToast("Borrowed request found. Review details before confirming return.", "success");
  } catch (error) {
    showStatus("Error finding borrowed request: " + error.message, "error");
  }
}
  async function updateBorrowerOverdueRecord(request) {
    if (!isOverdue(request.expectedReturnDate)) return;

    const borrowerRef = doc(db, "users", request.borrowerId);
    const borrowerSnap = await getDoc(borrowerRef);

    if (!borrowerSnap.exists()) return;

    const borrowerData = borrowerSnap.data();
    const currentOverdueCount = Number(borrowerData.overdueCount || 0);
    const newOverdueCount = currentOverdueCount + 1;

    const updatePayload = {
      overdueCount: newOverdueCount,
      updatedAt: serverTimestamp(),
    };

    if (newOverdueCount >= 5) {
      updatePayload.canBorrow = false;
      updatePayload.suspendedUntil = addDaysToToday(30);
      updatePayload.suspensionReason =
        "Account suspended for 1 month due to 5 overdue returns.";
    } else if (newOverdueCount >= 3) {
      updatePayload.canBorrow = false;
      updatePayload.suspendedUntil = addDaysToToday(14);
      updatePayload.suspensionReason =
        "Account suspended for 2 weeks due to 3 overdue returns.";
    }

    await updateDoc(borrowerRef, updatePayload);
  }

async function handleReturn() {
  showStatus("", "");

  const isValid = validateReturnForm();

if (!isValid) {
  return;
}

  if (isCategoryAdmin && !canCategoryAdminSeeRequest(selectedRequest)) {
    showStatus("You are not allowed to confirm returns for this category.", "error");
    return;
  }


  const started = startReturnAction();

  if (!started) return;

  try {
    const confirmReturn = window.confirm(
      `Confirm return of ${selectedRequest.itemName} from ${
        selectedRequest.borrowerName || selectedRequest.borrowerEmail
      }?`
    );

    if (!confirmReturn) return;

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

    if (latestRequest.approvalStatus !== "Borrowed") {
      showStatus(
        `This request is already ${latestRequest.approvalStatus}. Refreshing return queue...`,
        "error"
      );

      setSelectedRequest(null);
      setManualItemId("");
      await fetchBorrowedRequests();
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(latestRequest)) {
      showStatus("You are not allowed to confirm returns for this category.", "error");
      return;
    }

    const itemRef = doc(db, "items", latestRequest.itemId);
    const itemSnap = await getDoc(itemRef);

    if (!itemSnap.exists()) {
      showStatus("Item record not found. Return cannot continue.", "error");
      return;
    }

    await updateDoc(requestRef, {
      approvalStatus: "Returned",
      actualReturnDate,
      returnCondition,
      damageLostReport: damageLostReport.trim(),
      returnedAt: serverTimestamp(),
      returnedBy: getAdminId(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(itemRef, {
      availability: getNewItemAvailability(),
      condition: returnCondition,
      updatedAt: serverTimestamp(),
    });

    await updateBorrowerOverdueRecord(latestRequest);

    await addDoc(collection(db, "notifications"), {
      userId: latestRequest.borrowerId,
      targetRole: "borrower",
      categoryId: getRequestCategoryId(latestRequest),
      title: "Item Return Confirmed",
      message: `${latestRequest.itemName} has been returned successfully with condition: ${returnCondition}.`,
      status: "Unread",
      createdAt: serverTimestamp(),
      link: "/my-requests",
    });

    if (returnCondition === "Damaged" || returnCondition === "Lost") {
      await addDoc(collection(db, "notifications"), {
        userId: "",
        targetRole: "categoryAdmin",
        categoryId: getRequestCategoryId(latestRequest),
        title: `${returnCondition} Item Reported`,
        message: `${latestRequest.itemName} was returned as ${returnCondition}.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/reports",
      });
    }

showToast("Return Confirmed", "success");

setSelectedRequest(null);
setManualItemId("");
setReturnCondition("Good");

    setDamageLostReport("");
    await fetchBorrowedRequests();
  } catch (error) {
    showStatus("Error confirming return: " + error.message, "error");
  } finally {
    finishReturnAction();
  }
}

  useEffect(() => {
    fetchBorrowedRequests();
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;

    let scannerCleared = false;

    const scanner = new Html5QrcodeScanner(
      "return-item-reader",
      {
        fps: 10,
        qrbox: {
          width: 250,
          height: 250,
        },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
      },
      false
    );

async function clearScanner() {
  if (scannerCleared) return;

  scannerCleared = true;

  try {
    await scanner.clear();
  } catch (error) {
    console.log("Scanner clear error:", error);
  } finally {
    scannerLockRef.current = false;
  }
}

scanner.render(
  async (decodedText) => {
    if (scannerLockRef.current || isReturnBusy()) return;

    scannerLockRef.current = true;

    const itemId = extractItemId(decodedText);

    setScannerOpen(false);
    await clearScanner();
    await findBorrowedRequestByItemId(itemId);

    scannerLockRef.current = false;
  },
  () => {}
);

    return () => {
      clearScanner();
    };
  }, [scannerOpen]);

  if (loading) {
    return (
      <div className="return-loading">
        <div className="return-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading return queue...</h2>
          <p>Checking borrowed items waiting for return.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="return-page">
      {viewingBorrowedRequest && (
  <div
    className="return-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setViewingBorrowedRequest(null)}
  >
    <section
      className="return-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="return-modal-close"
        onClick={() => setViewingBorrowedRequest(null)}
        aria-label="Close borrowed request details"
      >
        ×
      </button>

      <div className="return-modal-heading">
        <span>{viewingBorrowedRequest.itemCode || viewingBorrowedRequest.itemId}</span>

        <strong
          className={
            isOverdue(viewingBorrowedRequest.expectedReturnDate)
              ? "return-overdue-pill overdue"
              : "return-overdue-pill good"
          }
        >
          {getOverdueStatus(viewingBorrowedRequest.expectedReturnDate)}
        </strong>

        <h2>{viewingBorrowedRequest.itemName || "Untitled Item"}</h2>
        <p>Review the borrowed request details before selecting it for return.</p>
      </div>

      <div className="return-modal-info-grid">
        <div>
          <span>Borrower</span>
          <strong>{viewingBorrowedRequest.borrowerName || "Unnamed Borrower"}</strong>
          <p>{viewingBorrowedRequest.borrowerEmail || "No email"}</p>
        </div>

        <div>
          <span>User Type</span>
          <strong>{getBorrowerUserType(viewingBorrowedRequest)}</strong>
        </div>

        <div>
          <span>ID Number</span>
          <strong>{getBorrowerIdNumber(viewingBorrowedRequest)}</strong>
        </div>

        <div>
          <span>Course / Department</span>
          <strong>{cleanDisplay(viewingBorrowedRequest.borrowerCourseDepartment)}</strong>
        </div>

        <div>
          <span>Year / Section</span>
          <strong>{getBorrowerYearSection(viewingBorrowedRequest)}</strong>
        </div>

        <div>
          <span>Mobile Number</span>
          <strong>{cleanDisplay(viewingBorrowedRequest.borrowerMobileNumber)}</strong>
        </div>

        <div>
          <span>Category</span>
          <strong>{getRequestCategoryName(viewingBorrowedRequest)}</strong>
        </div>

        <div>
          <span>Borrow Date</span>
          <strong>{viewingBorrowedRequest.borrowDate || "Not set"}</strong>
        </div>

        <div>
          <span>Expected Return</span>
          <strong>{viewingBorrowedRequest.expectedReturnDate || "Not set"}</strong>
        </div>
      </div>

      <div className="return-modal-actions">
        <button
          type="button"
          className="return-secondary-btn"
          onClick={() => setViewingBorrowedRequest(null)}
        >
          Close
        </button>

        <button
          type="button"
          className="return-primary-btn"
          onClick={() => selectBorrowedRequest(viewingBorrowedRequest)}
          disabled={confirming}
        >
          Select for Return
        </button>
      </div>
    </section>
  </div>
)}
<section className="return-header return-header-compact">
  <div className="return-header-content">
<div className="return-header-text">
  <h1>Return Confirmation</h1>

  <p>
    Scan the returned item QR code or barcode, verify the borrowed
    request, then confirm the actual return date and item condition.
  </p>

      {isCategoryAdmin && (
        <div className="return-assigned-note">
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
      className="return-secondary-btn return-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
</section>

      {statusMessage && (
        <div className={`return-status return-status-${statusType}`} role="status">
          {statusMessage}
        </div>
      )}

      <section className="return-layout">
        <section className="return-scanner-card">
          <div className="return-card-heading">
            <h2>Scan or Enter Item ID</h2>
            <p>
              QR values may contain a full item URL. Barcode values may contain
              only the item ID.
            </p>
          </div>

          <button
                type="button"
                className="return-primary-btn"
                onClick={() => {
                  if (isReturnBusy()) return;
                  setScannerOpen((current) => !current);
                }}
                disabled={confirming}
              >
              {scannerOpen ? "Close Scanner" : "Open QR / Barcode Scanner"}
          </button>

          {scannerOpen && (
            <div className="return-scanner-box">
              <div id="return-item-reader"></div>
            </div>
          )}

          <div className="return-manual-form">
<label className="qb-label" htmlFor="manual-return-item-id">
  Manual Item ID / Barcode / QR URL <span className="required-star">*</span>
</label>

            <div className="return-manual-row">
<input
  id="manual-return-item-id"
  type="text"
  className={fieldErrors.manualItemId ? "input-error" : ""}
  value={manualItemId}
  onFocus={() => clearFieldError("manualItemId")}
  onBlur={() => validateReturnField("manualItemId")}
  onChange={(e) => {
    const sanitizedValue = sanitizeScannerInput(e.target.value);

    setManualItemId(sanitizedValue);
    clearFieldError("manualItemId");
  }}
  placeholder="Example: item ID or /item/itemId"
  disabled={confirming}
/>

            <button
              type="button"
              className="return-secondary-btn"
              onClick={() => findBorrowedRequestByItemId(manualItemId)}
              disabled={confirming}
            >
              Find
            </button>
            </div>
            {fieldErrors.manualItemId && (
  <p className="field-error-message">{fieldErrors.manualItemId}</p>
)}
          </div>
        </section>

        <section className="return-selected-card">
          <div className="return-card-heading">
            <h2>Selected Borrowed Request</h2>
            <p>Review the item before confirming the return.</p>
          </div>

          {selectedRequest ? (
            <>
              <div className="return-selected-topline">
                <span>{selectedRequest.itemCode || selectedRequest.itemId}</span>
                <strong
                  className={
                    isOverdue(selectedRequest.expectedReturnDate)
                      ? "return-overdue-pill overdue"
                      : "return-overdue-pill good"
                  }
                >
                  {getOverdueStatus(selectedRequest.expectedReturnDate)}
                </strong>
              </div>

              <h3>{selectedRequest.itemName}</h3>

              <div className="return-info-grid">
                <div>
                  <span>Borrower</span>
                  <strong>
                    {selectedRequest.borrowerName || "Unnamed Borrower"}
                  </strong>
                  <p>{selectedRequest.borrowerEmail}</p>
                </div>

                <div>
                  <span>User Type</span>
                  <strong>{getBorrowerUserType(selectedRequest)}</strong>
                </div>

                <div>
                  <span>ID Number</span>
                  <strong>{getBorrowerIdNumber(selectedRequest)}</strong>
                </div>

                <div>
                  <span>Course / Department</span>
                  <strong>{cleanDisplay(selectedRequest.borrowerCourseDepartment)}</strong>
                </div>

                <div>
                  <span>Year / Section</span>
                  <strong>{getBorrowerYearSection(selectedRequest)}</strong>
                </div>

                <div>
                  <span>Mobile Number</span>
                  <strong>{cleanDisplay(selectedRequest.borrowerMobileNumber)}</strong>
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

              <div className="return-form-grid">
                <div className="return-field">
<label className="qb-label" htmlFor="actual-return-date">
  Actual Return Date <span className="required-star">*</span>
</label>
 <input
  id="actual-return-date"
  type="date"
  className={fieldErrors.actualReturnDate ? "input-error" : ""}
  value={actualReturnDate}
  readOnly
/>

{fieldErrors.actualReturnDate && (
  <p className="field-error-message">{fieldErrors.actualReturnDate}</p>
)}
                </div>

                <div className="return-field">
<label className="qb-label" htmlFor="return-condition">
  Return Condition <span className="required-star">*</span>
</label>
 <select
  id="return-condition"
  className={fieldErrors.returnCondition ? "input-error" : ""}
  value={returnCondition}
  onFocus={() => clearFieldError("returnCondition")}
  onBlur={() => validateReturnField("returnCondition")}
  onChange={(e) => {
    setReturnCondition(e.target.value);
    clearFieldError("returnCondition");
    clearFieldError("damageLostReport");
  }}
  disabled={confirming}
>
  <option value="Good">Good</option>
  <option value="Fair">Fair</option>
  <option value="Damaged">Damaged</option>
  <option value="Lost">Lost</option>
</select>

{fieldErrors.returnCondition && (
  <p className="field-error-message">{fieldErrors.returnCondition}</p>
)}
                </div>
              </div>

              {(returnCondition === "Damaged" || returnCondition === "Lost") && (
                <div className="return-field">
<label className="qb-label" htmlFor="damage-lost-report">
  Damage / Lost Report <span className="required-star">*</span>
</label>
<textarea
  id="damage-lost-report"
  className={fieldErrors.damageLostReport ? "input-error" : ""}
  value={damageLostReport}
  onFocus={() => clearFieldError("damageLostReport")}
  onBlur={() => validateReturnField("damageLostReport")}
  onChange={(e) => {
    const sanitizedValue = sanitizeReportText(e.target.value);

    setDamageLostReport(sanitizedValue);
    clearFieldError("damageLostReport");
  }}
  placeholder="Describe the damage or lost item issue..."
  disabled={confirming}
/>

{fieldErrors.damageLostReport && (
  <p className="field-error-message">{fieldErrors.damageLostReport}</p>
)}
                </div>
              )}

              <button
                type="button"
                className="return-confirm-btn"
                onClick={handleReturn}
                disabled={confirming}
              >
                {confirming ? "Confirming..." : "Confirm Return"}
              </button>
            </>
          ) : (
<div className="return-empty-selected">
  <img src="/qborrow-logo.png" alt="QBorrow Logo" />
  <h3>No selected request yet</h3>
  <p>Scan an item or select from the borrowed request queue.</p>

  {fieldErrors.selectedRequest && (
    <p className="field-error-message">{fieldErrors.selectedRequest}</p>
  )}
</div>
          )}
        </section>
      </section>

      <section className="return-queue-panel">
        <div className="return-section-heading">
          <div>
            <h2>Borrowed Items for Return</h2>
            <p>
              Showing {visibleBorrowedRequests.length} borrowed request
              {visibleBorrowedRequests.length === 1 ? "" : "s"}.
            </p>
          </div>

        <button
          type="button"
          className="return-secondary-btn"
          onClick={fetchBorrowedRequests}
          disabled={confirming}
        >
          Refresh
        </button>
        </div>

        {visibleBorrowedRequests.length === 0 ? (
          <div className="return-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No borrowed items</h2>
            <p>No items are currently waiting for return.</p>
          </div>
        ) : (
<>
  <div className="return-borrowed-table-header">
    <span>Item</span>
    <span>Borrower</span>
    <span>Category</span>
    <span>Expected Return</span>
    <span>Status</span>
    <span>Actions</span>
  </div>

  <div className="return-borrowed-table-grid">
    {visibleBorrowedRequests.map((request) => (
      <article
        className={`return-borrowed-row ${
          selectedRequest?.id === request.id ? "selected" : ""
        }`}
        key={request.id}
      >
        <div className="return-borrowed-cell return-borrowed-item-cell">
          <span>{request.itemCode || request.itemId}</span>
          <strong>{request.itemName || "Untitled Item"}</strong>
        </div>

        <div className="return-borrowed-cell return-borrowed-borrower-cell">
          <span>{request.borrowerEmail || "No email"}</span>
          <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
        </div>

        <div className="return-borrowed-cell">
          <span>Category</span>
          <strong>{getRequestCategoryName(request)}</strong>
        </div>

        <div className="return-borrowed-cell">
          <span>Expected Return</span>
          <strong>{request.expectedReturnDate || "Not set"}</strong>
        </div>

        <div className="return-borrowed-status-cell">
          <strong
            className={
              isOverdue(request.expectedReturnDate)
                ? "return-overdue-pill overdue"
                : "return-overdue-pill good"
            }
          >
            {getOverdueStatus(request.expectedReturnDate)}
          </strong>
        </div>

        <div className="return-borrowed-actions">
          <button
            type="button"
            className="return-secondary-btn"
            onClick={() => setViewingBorrowedRequest(request)}
            disabled={confirming}
          >
            Details
          </button>

          <button
            type="button"
            className="return-primary-btn"
            onClick={() => selectBorrowedRequest(request)}
            disabled={confirming || selectedRequest?.id === request.id}
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

export default ReturnConfirmation;
