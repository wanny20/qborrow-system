import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/MyRequests.css";

function MyRequests() {
  const navigate = useNavigate();

  const [requests, setRequests] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function getCreatedTime(request) {
    if (request.createdAt?.toMillis) {
      return request.createdAt.toMillis();
    }

    if (request.createdAt?.seconds) {
      return request.createdAt.seconds * 1000;
    }

    return 0;
  }

  function getCategoryName(request) {
    return (
      request.categoryName ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
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

  async function fetchMyRequests(userId) {
    setLoading(true);

    try {
      const requestsQuery = query(
        collection(db, "borrowRequests"),
        where("borrowerId", "==", userId)
      );

      const querySnapshot = await getDocs(requestsQuery);

      const requestData = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));

      setRequests(requestData);
    } catch (error) {
      showStatus("Error loading your requests: " + error.message, "error");
    } finally {
      setLoading(false);
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

      showStatus("Request cancelled successfully.", "success");

      if (currentUser?.uid) {
        fetchMyRequests(currentUser.uid);
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
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" || request.approvalStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const requestStats = useMemo(
    () => ({
      total: requests.length,
      pending: requests.filter(
        (request) => request.approvalStatus === "Pending"
      ).length,
      approved: requests.filter(
        (request) => request.approvalStatus === "Approved"
      ).length,
      borrowed: requests.filter(
        (request) => request.approvalStatus === "Borrowed"
      ).length,
      returned: requests.filter(
        (request) => request.approvalStatus === "Returned"
      ).length,
      closed: requests.filter(
        (request) =>
          request.approvalStatus === "Rejected" ||
          request.approvalStatus === "Cancelled"
      ).length,
    }),
    [requests]
  );

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
<section className="my-requests-header">
  <div>
    <div className="my-requests-header-topline">
      <p className="qb-kicker">Borrower Tracker</p>

      <button
        type="button"
        className="my-requests-secondary-btn"
        onClick={() => navigate("/dashboard")}
      >
        Back to Dashboard
      </button>
    </div>

    <h1>My Requests</h1>

    <p>
      Track your borrow requests from pending approval, reserved items,
      released borrowed items, and completed returns.
    </p>
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
          onClick={() => currentUser?.uid && fetchMyRequests(currentUser.uid)}
        >
          Refresh
        </button>
      </section>

      <section className="my-requests-panel">
        <div className="my-requests-section-heading">
          <div>
            <h2>Request History</h2>
            <p>
              Showing {filteredRequests.length} of {requests.length} request
              {requests.length === 1 ? "" : "s"}.
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
    <article className="my-request-row" key={request.id}>
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
          <strong>Purpose:</strong>{" "}
          {request.purpose || "No purpose provided."}
        </p>

        <div className="my-request-footer">
          <span
            className={`my-request-timing-pill ${getTimingClass(request)}`}
          >
            {getRequestTimingStatus(request)}
          </span>

          <span className="my-request-condition-pill">
            {request.returnCondition || "No return condition yet"}
          </span>
        </div>
      </div>

      <div className="my-request-details">
        <div>
          <span>Category</span>
          <strong>{getCategoryName(request)}</strong>
        </div>

        <div>
          <span>Borrow Date</span>
          <strong>{request.borrowDate || "Not set"}</strong>
        </div>

        <div>
          <span>Expected Return</span>
          <strong>{request.expectedReturnDate || "Not set"}</strong>
        </div>

        <div>
          <span>Actual Return</span>
          <strong>{request.actualReturnDate || "Not returned yet"}</strong>
        </div>
      </div>

      <div className="my-request-actions">
        <button
          type="button"
          className="my-requests-secondary-btn"
          onClick={() => navigate(`/item/${request.itemId}`)}
        >
          View Item
        </button>

        {request.approvalStatus === "Pending" && (
          <button
            type="button"
            className="my-requests-danger-btn"
            onClick={() => handleCancelRequest(request)}
            disabled={actionLoadingId === request.id}
          >
            {actionLoadingId === request.id ? "Cancelling..." : "Cancel"}
          </button>
        )}
      </div>
    </article>
  ))}
</div>
        )}
      </section>
    </div>
  );
}

export default MyRequests;