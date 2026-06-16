import { useEffect, useMemo, useState } from "react";
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
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/ReturnConfirmation.css";

function ReturnConfirmation() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

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

  const [actualReturnDate] = useState(today);
  const [returnCondition, setReturnCondition] = useState("Good");
  const [damageLostReport, setDamageLostReport] = useState("");

  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

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
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const requestData = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((request) => request.approvalStatus === "Borrowed");

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

  async function findBorrowedRequestByItemId(rawItemId) {
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
            request.itemId === itemId && request.approvalStatus === "Borrowed"
        );

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
      showStatus("Borrowed request found. Review details before confirming return.", "success");
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
    if (!selectedRequest) {
      showStatus("Please scan or select a borrowed request first.", "error");
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(selectedRequest)) {
      showStatus("You are not allowed to confirm returns for this category.", "error");
      return;
    }

    if (!actualReturnDate) {
      showStatus("Actual return date is required.", "error");
      return;
    }

    if (!returnCondition) {
      showStatus("Return condition is required.", "error");
      return;
    }

    if (
      (returnCondition === "Damaged" || returnCondition === "Lost") &&
      !damageLostReport.trim()
    ) {
      showStatus("Damage/lost report is required.", "error");
      return;
    }

    const confirmReturn = window.confirm(
      `Confirm return of ${selectedRequest.itemName} from ${
        selectedRequest.borrowerName || selectedRequest.borrowerEmail
      }?`
    );

    if (!confirmReturn) return;

    setConfirming(true);
    showStatus("", "");

    try {
      const requestRef = doc(db, "borrowRequests", selectedRequest.id);
      const itemRef = doc(db, "items", selectedRequest.itemId);

      await updateDoc(requestRef, {
        approvalStatus: "Returned",
        actualReturnDate,
        returnCondition,
        damageLostReport: damageLostReport.trim(),
        returnedAt: serverTimestamp(),
        returnedBy: getAdminId(),
      });

      await updateDoc(itemRef, {
        availability: getNewItemAvailability(),
        condition: returnCondition,
        updatedAt: serverTimestamp(),
      });

      await updateBorrowerOverdueRecord(selectedRequest);

      await addDoc(collection(db, "notifications"), {
        userId: selectedRequest.borrowerId,
        targetRole: "borrower",
        categoryId: getRequestCategoryId(selectedRequest),
        title: "Item Return Confirmed",
        message: `${selectedRequest.itemName} has been returned successfully with condition: ${returnCondition}.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });

      if (returnCondition === "Damaged" || returnCondition === "Lost") {
        await addDoc(collection(db, "notifications"), {
          userId: "",
          targetRole: "categoryAdmin",
          categoryId: getRequestCategoryId(selectedRequest),
          title: `${returnCondition} Item Reported`,
          message: `${selectedRequest.itemName} was returned as ${returnCondition}.`,
          status: "Unread",
          createdAt: serverTimestamp(),
          link: "/reports",
        });
      }

      showStatus("Item return confirmed successfully.", "success");

      setSelectedRequest(null);
      setManualItemId("");
      setReturnCondition("Good");
      setDamageLostReport("");
      fetchBorrowedRequests();
    } catch (error) {
      showStatus("Error confirming return: " + error.message, "error");
    } finally {
      setConfirming(false);
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
      }
    }

    scanner.render(
      async (decodedText) => {
        const itemId = extractItemId(decodedText);

        setScannerOpen(false);
        await clearScanner();
        findBorrowedRequestByItemId(itemId);
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
      <section className="return-header">
        <div>
          <p className="qb-kicker">Return Scan</p>

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
          className="return-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
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
            onClick={() => setScannerOpen((current) => !current)}
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
              Manual Item ID / Barcode / QR URL
            </label>

            <div className="return-manual-row">
              <input
                id="manual-return-item-id"
                type="text"
                value={manualItemId}
                onChange={(e) => setManualItemId(e.target.value)}
                placeholder="Example: item ID or /item/itemId"
              />

              <button
                type="button"
                className="return-secondary-btn"
                onClick={() => findBorrowedRequestByItemId(manualItemId)}
              >
                Find
              </button>
            </div>
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
                    Actual Return Date
                  </label>
                  <input
                    id="actual-return-date"
                    type="date"
                    value={actualReturnDate}
                    readOnly
                  />
                </div>

                <div className="return-field">
                  <label className="qb-label" htmlFor="return-condition">
                    Return Condition
                  </label>
                  <select
                    id="return-condition"
                    value={returnCondition}
                    onChange={(e) => setReturnCondition(e.target.value)}
                  >
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
              </div>

              {(returnCondition === "Damaged" || returnCondition === "Lost") && (
                <div className="return-field">
                  <label className="qb-label" htmlFor="damage-lost-report">
                    Damage / Lost Report
                  </label>
                  <textarea
                    id="damage-lost-report"
                    value={damageLostReport}
                    onChange={(e) => setDamageLostReport(e.target.value)}
                    placeholder="Describe the damage or lost item issue..."
                  />
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
          <div className="return-request-grid">
            {visibleBorrowedRequests.map((request) => (
              <article className="return-request-card" key={request.id}>
                <div className="return-request-topline">
                  <span>{request.itemCode || request.itemId}</span>
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

                <h3>{request.itemName}</h3>

                <div className="return-request-meta">
                  <div>
                    <span>Borrower</span>
                    <strong>{request.borrowerName || request.borrowerEmail}</strong>
                  </div>

                  <div>
                    <span>User Type</span>
                    <strong>{getBorrowerUserType(request)}</strong>
                  </div>

                  <div>
                    <span>ID Number</span>
                    <strong>{getBorrowerIdNumber(request)}</strong>
                  </div>

                  <div>
                    <span>Course / Department</span>
                    <strong>{cleanDisplay(request.borrowerCourseDepartment)}</strong>
                  </div>

                  <div>
                    <span>Expected Return</span>
                    <strong>{request.expectedReturnDate}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="return-primary-btn"
                  onClick={() => {
                    setSelectedRequest(request);
                    setManualItemId(request.itemId);
                    setReturnCondition("Good");
                    setDamageLostReport("");
                    showStatus("Borrowed request selected.", "success");
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

export default ReturnConfirmation;
