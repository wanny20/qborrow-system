import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/MyRequests.css";
const REQUESTS_PAGE_SIZE = 10;

function MyRequests() {
  const navigate = useNavigate();
  const { showToast } = useToast();

const [requests, setRequests] = useState([]);
const [lastRequestDoc, setLastRequestDoc] = useState(null);
const [hasMoreRequests, setHasMoreRequests] = useState(false);
const [loadingMoreRequests, setLoadingMoreRequests] = useState(false);

const [currentUser, setCurrentUser] = useState(null);

const [requestStats, setRequestStats] = useState({
  total: 0,
  pending: 0,
  approved: 0,
  borrowed: 0,
  returned: 0,
  closed: 0,
});
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
const [statusMessage, setStatusMessage] = useState("");
const [statusType, setStatusType] = useState("");
const [selectedRequest, setSelectedRequest] = useState(null);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function getCategoryName(request) {
    return (
      request.categoryName ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
  }
  function getRequestClosedReason(request) {
  if (request.approvalStatus === "Rejected") {
    if (request.rejectReason) return request.rejectReason;

    if (request.autoRejected) {
      return "Automatically rejected because no admin action was made within 24 hours. You may submit a new request.";
    }

    return "Your borrow request was rejected by the admin.";
  }

  if (request.approvalStatus === "Cancelled") {
    return "You cancelled this borrow request.";
  }

  return "";
}

function shouldShowClosedReason(request) {
  return ["Rejected", "Cancelled"].includes(request.approvalStatus);
}

  function getRequestTimingStatus(request) {
    if (!request.expectedReturnDate) return "N/A";

    const today = new Date(getTodayDate());
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    if (request.approvalStatus === "Returned") {
      if (!request.actualReturnDate) return "Returned";

      const actualDate = new Date(request.actualReturnDate);
      actualDate.setHours(0, 0, 0, 0);

      return actualDate > expectedDate ? "Returned Late" : "Returned On Time";
    }

    if (
      request.approvalStatus === "Approved" ||
      request.approvalStatus === "Borrowed"
    ) {
      return today > expectedDate ? "Overdue" : "Not Overdue";
    }

    return "N/A";
  }

  function getTimingClass(request) {
    const status = getRequestTimingStatus(request);

    if (status === "Overdue" || status === "Returned Late") return "bad";
    if (status === "Not Overdue" || status === "Returned On Time") return "good";

    return "neutral";
  }
  async function fetchMyRequestStats(userId) {
  const requestsRef = collection(db, "borrowRequests");

  const [
    totalSnapshot,
    pendingSnapshot,
    approvedSnapshot,
    borrowedSnapshot,
    returnedSnapshot,
    rejectedSnapshot,
    cancelledSnapshot,
  ] = await Promise.all([
    getCountFromServer(query(requestsRef, where("borrowerId", "==", userId))),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Pending")
      )
    ),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Approved")
      )
    ),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Borrowed")
      )
    ),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Returned")
      )
    ),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Rejected")
      )
    ),
    getCountFromServer(
      query(
        requestsRef,
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Cancelled")
      )
    ),
  ]);

  setRequestStats({
    total: totalSnapshot.data().count || 0,
    pending: pendingSnapshot.data().count || 0,
    approved: approvedSnapshot.data().count || 0,
    borrowed: borrowedSnapshot.data().count || 0,
    returned: returnedSnapshot.data().count || 0,
    closed:
      (rejectedSnapshot.data().count || 0) +
      (cancelledSnapshot.data().count || 0),
  });
}

async function fetchMyRequests(userId, mode = "reset") {
  if (mode === "reset") {
    setLoading(true);
  }

  try {
    const requestsQuery =
      mode === "more" && lastRequestDoc
        ? query(
            collection(db, "borrowRequests"),
            where("borrowerId", "==", userId),
            orderBy("createdAt", "desc"),
            startAfter(lastRequestDoc),
            limit(REQUESTS_PAGE_SIZE + 1)
          )
        : query(
            collection(db, "borrowRequests"),
            where("borrowerId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(REQUESTS_PAGE_SIZE + 1)
          );

    const querySnapshot = await getDocs(requestsQuery);
    const docs = querySnapshot.docs;
    const visibleDocs = docs.slice(0, REQUESTS_PAGE_SIZE);

    const requestData = visibleDocs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    setHasMoreRequests(docs.length > REQUESTS_PAGE_SIZE);
    setLastRequestDoc(visibleDocs[visibleDocs.length - 1] || null);

    if (mode === "more") {
      setRequests((previousRequests) => {
        const existingIds = new Set(previousRequests.map((request) => request.id));
        const newRequests = requestData.filter(
          (request) => !existingIds.has(request.id)
        );

        return [...previousRequests, ...newRequests];
      });

      return;
    }

    setRequests(requestData);
    await fetchMyRequestStats(userId);
  } catch (error) {
    showStatus("Error loading your requests: " + error.message, "error");
  } finally {
    if (mode === "reset") {
      setLoading(false);
    }
  }
}
async function handleLoadMoreRequests() {
  if (!currentUser?.uid || !hasMoreRequests || loadingMoreRequests) return;

  setLoadingMoreRequests(true);
  showStatus("", "");

  try {
    await fetchMyRequests(currentUser.uid, "more");
  } catch (error) {
    showStatus("Error loading more requests: " + error.message, "error");
  } finally {
    setLoadingMoreRequests(false);
  }
}

  async function handleCancelRequest(request) {
    if (request.approvalStatus !== "Pending") {
      showStatus("Only pending requests can be cancelled.", "error");
      return;
    }

    const confirmCancel = window.confirm(
      `Cancel your request for ${request.itemName}?`
    );

    if (!confirmCancel) return;

    setActionLoadingId(request.id);
    showStatus("", "");

    try {
      const requestRef = doc(db, "borrowRequests", request.id);

      await updateDoc(requestRef, {
        approvalStatus: "Cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: currentUser?.uid || "",
      });

showToast("Request Cancelled", "success");
setSelectedRequest(null);

if (currentUser?.uid) {
  fetchMyRequests(currentUser.uid, "reset");
}

    } catch (error) {
      showStatus("Error cancelling request: " + error.message, "error");
    } finally {
      setActionLoadingId("");
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      setCurrentUser(user);
      await fetchMyRequests(user.uid);
    });

    return () => unsubscribe();
  }, [navigate]);

  const filteredRequests = requests.filter((request) => {
    const searchableText = `
      ${request.itemName || ""}
      ${request.itemCode || ""}
      ${request.purpose || ""}
      ${getCategoryName(request)}
      ${request.approvalStatus || ""}
      ${request.returnCondition || ""}
      ${request.rejectReason || ""}
      ${request.autoRejected ? "auto rejected automatic rejection" : ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" || request.approvalStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });


  if (loading) {
    return (
      <div className="my-requests-loading">
        <div className="my-requests-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading your requests...</h2>
          <p>Checking your borrow request history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-requests-page">
<section className="my-requests-header my-requests-header-compact">
  <div className="my-requests-header-content">
<div className="my-requests-header-text">
  <h1>My Borrow Requests</h1>

  <p>
    Track your borrow requests, approvals, borrowed items, return status,
    and completed transactions in one place.
  </p>
</div>

    <button
      type="button"
      className="my-requests-secondary-btn my-requests-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
</section>

      {statusMessage && (
        <div
          className={`my-requests-status my-requests-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}
      {selectedRequest && (
  <div
    className="my-requests-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setSelectedRequest(null)}
  >
    <section
      className="my-requests-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="my-requests-modal-close"
        onClick={() => setSelectedRequest(null)}
        aria-label="Close request details"
      >
        ×
      </button>

      <div className="my-requests-modal-heading">
        <span>{selectedRequest.itemCode || selectedRequest.itemId}</span>

        <h2>{selectedRequest.itemName || "Untitled Item"}</h2>

        <strong
          className={`my-request-status-pill status-${String(
            selectedRequest.approvalStatus || "Unknown"
          ).toLowerCase()}`}
        >
          {selectedRequest.approvalStatus || "Unknown"}
        </strong>
      </div>

      <p className="my-requests-modal-purpose">
        <strong>Purpose:</strong>{" "}
        {selectedRequest.purpose || "No purpose provided."}
      </p>
{shouldShowClosedReason(selectedRequest) && (
  <div className="my-requests-closed-reason">
    <span>
      {selectedRequest.autoRejected ? "Auto-Rejected Reason" : "Request Status Reason"}
    </span>
    <p>{getRequestClosedReason(selectedRequest)}</p>
  </div>
)}
      <div className="my-requests-modal-grid">
        <div>
          <span>Category</span>
          <strong>{getCategoryName(selectedRequest)}</strong>
        </div>

        <div>
          <span>Borrow Date</span>
          <strong>{selectedRequest.borrowDate || "Not set"}</strong>
        </div>

        <div>
          <span>Expected Return</span>
          <strong>{selectedRequest.expectedReturnDate || "Not set"}</strong>
        </div>

        <div>
          <span>Actual Return</span>
          <strong>{selectedRequest.actualReturnDate || "Not returned yet"}</strong>
        </div>

        <div>
          <span>Timing Status</span>
          <strong
            className={`my-request-timing-pill ${getTimingClass(
              selectedRequest
            )}`}
          >
            {getRequestTimingStatus(selectedRequest)}
          </strong>
        </div>

        <div>
          <span>Return Condition</span>
          <strong>
            {selectedRequest.returnCondition || "No return condition yet"}
          </strong>
        </div>
      </div>

      <div className="my-requests-modal-actions">
        <button
          type="button"
          className="my-requests-primary-btn"
          onClick={() => navigate(`/item/${selectedRequest.itemId}`)}
        >
          View Item
        </button>

        {selectedRequest.approvalStatus === "Pending" && (
          <button
            type="button"
            className="my-requests-danger-btn"
            onClick={() => handleCancelRequest(selectedRequest)}
            disabled={actionLoadingId === selectedRequest.id}
          >
            {actionLoadingId === selectedRequest.id ? "Cancelling..." : "Cancel Request"}
          </button>
        )}

        <button
          type="button"
          className="my-requests-secondary-btn"
          onClick={() => setSelectedRequest(null)}
        >
          Close
        </button>
      </div>
    </section>
  </div>
)}

      <section className="my-requests-summary-grid">
        <div>
          <span>Σ</span>
          <h3>{requestStats.total}</h3>
          <p>Total</p>
        </div>

        <div>
          <span>?</span>
          <h3>{requestStats.pending}</h3>
          <p>Pending</p>
        </div>

        <div>
          <span>✓</span>
          <h3>{requestStats.approved}</h3>
          <p>Approved</p>
        </div>

        <div>
          <span>↗</span>
          <h3>{requestStats.borrowed}</h3>
          <p>Borrowed</p>
        </div>

        <div>
          <span>↩</span>
          <h3>{requestStats.returned}</h3>
          <p>Returned</p>
        </div>

        <div>
          <span>×</span>
          <h3>{requestStats.closed}</h3>
          <p>Closed</p>
        </div>
      </section>

      <section className="my-requests-tools">
        <div>
          <label className="qb-label" htmlFor="request-search">
            Search Requests
          </label>

          <input
            id="request-search"
            type="text"
            placeholder="Search item, category, purpose, status..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div>
          <label className="qb-label" htmlFor="request-status-filter">
            Status
          </label>

          <select
            id="request-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Borrowed">Borrowed</option>
            <option value="Returned">Returned</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <button
          type="button"
          className="my-requests-refresh-btn"
          onClick={() => currentUser?.uid && fetchMyRequests(currentUser.uid, "reset")}
        >
          Refresh
        </button>
      </section>

      <section className="my-requests-panel">
        <div className="my-requests-section-heading">
          <div>
            <h2>Request History</h2>
            <p>
              Showing {filteredRequests.length} of {requests.length} loaded request
{requests.length === 1 ? "" : "s"}.
{hasMoreRequests ? " Load more to view older requests." : ""}
            </p>
          </div>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="my-requests-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No requests found</h2>
            <p>You have no borrow requests matching this filter.</p>

            <button
              type="button"
              className="my-requests-primary-btn"
              onClick={() => navigate("/items")}
            >
              Browse Items
            </button>
          </div>
        ) : (
<div className="my-requests-list">
  {filteredRequests.map((request) => (
<article className="my-request-row my-request-row-compact" key={request.id}>
  <div className="my-request-main">
    <div className="my-request-topline">
      <span>{request.itemCode || request.itemId}</span>

      <strong
        className={`my-request-status-pill status-${String(
          request.approvalStatus || "Unknown"
        ).toLowerCase()}`}
      >
        {request.approvalStatus || "Unknown"}
      </strong>
    </div>

    <h3>{request.itemName || "Untitled Item"}</h3>

    <p>
      <strong>Purpose:</strong> {request.purpose || "No purpose provided."}
    </p>
{shouldShowClosedReason(request) && (
  <div className="my-request-row-reason">
    <strong>
      {request.autoRejected ? "Auto-Rejected:" : "Reason:"}
    </strong>{" "}
    {getRequestClosedReason(request)}
  </div>
)}
    <div className="my-request-footer">
      <span className={`my-request-timing-pill ${getTimingClass(request)}`}>
        {getRequestTimingStatus(request)}
      </span>

      <span className="my-request-condition-pill">
        {request.returnCondition || "No return condition yet"}
      </span>
    </div>
  </div>

  <div className="my-request-compact-meta">
    <div>
      <span>Category</span>
      <strong>{getCategoryName(request)}</strong>
    </div>

    <div>
      <span>Expected Return</span>
      <strong>{request.expectedReturnDate || "Not set"}</strong>
    </div>
  </div>

  <div className="my-request-actions">
    <button
      type="button"
      className="my-requests-primary-btn"
      onClick={() => setSelectedRequest(request)}
    >
      Details
    </button>
  </div>
</article>
  ))}
</div>

        )}
      </section>
      {hasMoreRequests && (
  <div className="my-requests-load-more-row">
    <button
      type="button"
      className="my-requests-secondary-btn"
      onClick={handleLoadMoreRequests}
      disabled={loadingMoreRequests}
    >
      {loadingMoreRequests ? "Loading..." : "Load More Requests"}
    </button>
  </div>
)}
    </div>
  );
}

export default MyRequests;