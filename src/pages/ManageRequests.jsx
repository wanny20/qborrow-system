import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
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
import "../styles/ManageRequests.css";

function ManageRequests() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(
  searchParams.get("status") || "Pending"
);
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

  function getAdminName() {
    return userData?.fullName || userData?.email || auth.currentUser?.email || "Admin";
  }
  function isRequestOverdue(request) {
  if (!["Approved", "Borrowed"].includes(request.approvalStatus)) {
    return false;
  }

  if (!request.expectedReturnDate) {
    return false;
  }

  const today = new Date();
  const expectedDate = new Date(request.expectedReturnDate);

  today.setHours(0, 0, 0, 0);
  expectedDate.setHours(0, 0, 0, 0);

  return today > expectedDate;
}

function handleStatusFilterChange(value) {
  setStatusFilter(value);

  if (value === "Pending") {
    setSearchParams({ status: "Pending" });
    return;
  }

  if (value === "All") {
    setSearchParams({});
    return;
  }

  setSearchParams({ status: value });
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

  async function fetchRequests() {
    setLoading(true);

    try {
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const requestData = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setRequests(requestData);
    } catch (error) {
      showStatus("Error loading requests: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveRequest(request) {
    if (request.approvalStatus !== "Pending") {
      showStatus("Only pending requests can be approved.", "error");
      return;
    }

    const confirmApprove = window.confirm(
      `Approve ${request.borrowerName || request.borrowerEmail}'s request for ${request.itemName}?`
    );

    if (!confirmApprove) return;

    setActionLoadingId(request.id);
    showStatus("", "");

    try {
      const requestRef = doc(db, "borrowRequests", request.id);
      const itemRef = doc(db, "items", request.itemId);
      const itemSnap = await getDoc(itemRef);

      if (!itemSnap.exists()) {
        showStatus("Item not found. This request cannot be approved.", "error");
        return;
      }

      const itemData = itemSnap.data();

      if (itemData.availability !== "Available") {
        showStatus(
          `This item is currently ${itemData.availability}. It cannot be approved right now.`,
          "error"
        );
        return;
      }

      await updateDoc(requestRef, {
        approvalStatus: "Approved",
        assignedAdminId: getAdminId(),
        approvedBy: getAdminId(),
        approvedAt: serverTimestamp(),
      });

      await updateDoc(itemRef, {
        availability: "Reserved",
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        targetRole: "borrower",
        categoryId: getRequestCategoryId(request),
        title: "Borrow Request Approved",
        message: `Your request for ${request.itemName} has been approved. Please wait for the admin to release the item.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });

      showStatus("Request approved successfully. Item is now reserved.", "success");
      fetchRequests();
    } catch (error) {
      showStatus("Error approving request: " + error.message, "error");
    } finally {
      setActionLoadingId("");
    }
  }

  async function handleRejectRequest(request) {
    if (request.approvalStatus !== "Pending") {
      showStatus("Only pending requests can be rejected.", "error");
      return;
    }

    const confirmReject = window.confirm(
      `Reject ${request.borrowerName || request.borrowerEmail}'s request for ${request.itemName}?`
    );

    if (!confirmReject) return;

    setActionLoadingId(request.id);
    showStatus("", "");

    try {
      const requestRef = doc(db, "borrowRequests", request.id);

      await updateDoc(requestRef, {
        approvalStatus: "Rejected",
        rejectedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        targetRole: "borrower",
        categoryId: getRequestCategoryId(request),
        title: "Borrow Request Rejected",
        message: `Your request for ${request.itemName} has been rejected.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });

      showStatus("Request rejected successfully.", "success");
      fetchRequests();
    } catch (error) {
      showStatus("Error rejecting request: " + error.message, "error");
    } finally {
      setActionLoadingId("");
    }
  }

  useEffect(() => {
    fetchRequests();
  }, []);
  useEffect(() => {
  const statusFromUrl = searchParams.get("status");

  if (statusFromUrl) {
    setStatusFilter(statusFromUrl);
  }
}, [searchParams]);

  const visibleRequests = useMemo(() => {
    if (isCategoryAdmin) {
      return requests.filter((request) => canCategoryAdminSeeRequest(request));
    }

    return requests;
  }, [requests, userData]);

  const filteredRequests = visibleRequests.filter((request) => {
    const searchableText = `
      ${request.itemName || ""}
      ${request.itemCode || ""}
      ${request.borrowerName || ""}
      ${request.borrowerEmail || ""}
      ${request.purpose || ""}
      ${getRequestCategoryId(request)}
      ${getRequestCategoryName(request)}
      ${request.approvalStatus || ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" ||
      request.approvalStatus === statusFilter ||
      (statusFilter === "Overdue" && isRequestOverdue(request));

    return matchesSearch && matchesStatus;
  });

    const requestStats = {
      total: visibleRequests.length,
      pending: visibleRequests.filter(
        (request) => request.approvalStatus === "Pending"
      ).length,
      approved: visibleRequests.filter(
        (request) => request.approvalStatus === "Approved"
      ).length,
      borrowed: visibleRequests.filter(
        (request) => request.approvalStatus === "Borrowed"
      ).length,
      overdue: visibleRequests.filter((request) => isRequestOverdue(request)).length,
      returned: visibleRequests.filter(
        (request) => request.approvalStatus === "Returned"
      ).length,
      rejected: visibleRequests.filter(
        (request) => request.approvalStatus === "Rejected"
      ).length,
    };
  if (loading) {
    return (
      <div className="manage-requests-loading">
        <div className="manage-requests-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading requests...</h2>
          <p>Checking borrow request records.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="manage-requests-page">
      <section className="manage-requests-header">
        <div>
          <p className="qb-kicker">Admin Request Control</p>

          <h1>Manage Requests</h1>

          <p>
            Review borrower requests, approve available items into reserved
            status, or reject requests that cannot proceed.
          </p>

          {isCategoryAdmin && (
            <div className="manage-assigned-note">
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
          className="manage-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </section>

      {statusMessage && (
        <div className={`manage-status manage-status-${statusType}`} role="status">
          {statusMessage}
        </div>
      )}

      <section className="manage-summary-grid">
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
        <span>!</span>
        <h3>{requestStats.overdue}</h3>
        <p>Overdue</p>
        </div>

        <div>
          <span>↩</span>
          <h3>{requestStats.returned}</h3>
          <p>Returned</p>
        </div>

        <div>
          <span>×</span>
          <h3>{requestStats.rejected}</h3>
          <p>Rejected</p>
        </div>
      </section>

      <section className="manage-tools">
        <div>
          <label className="qb-label" htmlFor="request-search">
            Search Requests
          </label>

          <input
            id="request-search"
            type="text"
            placeholder="Search item, borrower, category, purpose..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div>
          <label className="qb-label" htmlFor="status-filter">
            Status
          </label>

            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => handleStatusFilterChange(event.target.value)}
            >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Borrowed">Borrowed</option>
            <option value="Overdue">Overdue</option>
            <option value="Returned">Returned</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <button type="button" className="manage-refresh-btn" onClick={fetchRequests}>
          Refresh
        </button>
      </section>

      <section className="manage-request-panel">
        <div className="manage-section-heading">
          <div>
            <h2>Borrow Requests</h2>
            <p>
              Showing {filteredRequests.length} of {visibleRequests.length} visible
              request{visibleRequests.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="manage-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No requests found</h2>
            <p>Try changing the status filter or search keyword.</p>
          </div>
        ) : (
          <div className="manage-request-grid">
            {filteredRequests.map((request) => (
              <article className="manage-request-card" key={request.id}>
                <div className="manage-request-topline">
                  <span>{request.itemCode || request.itemId}</span>

                  <span
                    className={`manage-status-pill status-${String(
                      request.approvalStatus || "Unknown"
                    ).toLowerCase()}`}
                  >
                    {request.approvalStatus || "Unknown"}
                  </span>
                  {isRequestOverdue(request) && (
                  <span className="manage-status-pill status-overdue">
                    Overdue
                  </span>
                )}
                </div>

                <h3>{request.itemName || "Untitled Item"}</h3>

                <div className="manage-request-info">
                  <div>
                    <span>Borrower</span>
                    <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
                    <p>{request.borrowerEmail}</p>
                  </div>

                  <div>
                    <span>Category</span>
                    <strong>{getRequestCategoryName(request)}</strong>
                  </div>

                  <div>
                    <span>Borrow Date</span>
                    <strong>{request.borrowDate || "Not set"}</strong>
                  </div>

                  <div>
                    <span>Expected Return</span>
                    <strong>{request.expectedReturnDate || "Not set"}</strong>
                  </div>
                </div>

                <div className="manage-purpose-box">
                  <span>Purpose</span>
                  <p>{request.purpose || "No purpose provided."}</p>
                </div>

                <div className="manage-request-actions">
                  <button
                    type="button"
                    className="manage-view-btn"
                    onClick={() => navigate(`/item/${request.itemId}`)}
                  >
                    View Item
                  </button>

                  {request.approvalStatus === "Pending" ? (
                    <>
                      <button
                        type="button"
                        className="manage-approve-btn"
                        onClick={() => handleApproveRequest(request)}
                        disabled={actionLoadingId === request.id}
                      >
                        {actionLoadingId === request.id ? "..." : "Approve"}
                      </button>

                      <button
                        type="button"
                        className="manage-reject-btn"
                        onClick={() => handleRejectRequest(request)}
                        disabled={actionLoadingId === request.id}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="manage-no-action">No action needed</span>
                  )}
                </div>

                {request.approvedBy && (
                  <p className="manage-approved-by">
                    Approved by: {request.approvedBy === getAdminId() ? getAdminName() : request.approvedBy}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default ManageRequests;