import { useEffect, useMemo, useRef, useState } from "react";
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
  const [actionLoadingType, setActionLoadingType] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "Pending"
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const actionLockRef = useRef("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }
  function startRequestAction(requestId, actionType) {
  if (actionLockRef.current) {
    return false;
  }

  actionLockRef.current = `${requestId}-${actionType}`;
  setActionLoadingId(requestId);
  setActionLoadingType(actionType);

  return true;
}

function finishRequestAction() {
  actionLockRef.current = "";
  setActionLoadingId("");
  setActionLoadingType("");
}

function hasActiveRequestAction() {
  return Boolean(actionLockRef.current || actionLoadingId);
}

function isRequestActionLoading(requestId, actionType) {
  return actionLoadingId === requestId && actionLoadingType === actionType;
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

  function cleanDisplay(value, fallback = "Not set") {
    const cleanedValue = String(value || "").trim();
    return cleanedValue || fallback;
  }

  function getBorrowerUserType(request) {
    return cleanDisplay(request.borrowerUserType, "Student");
  }

  function getBorrowerIdNumber(request) {
    const borrowerType = getBorrowerUserType(request);

    if (borrowerType === "Faculty" || borrowerType === "Staff") {
      return cleanDisplay(request.borrowerEmployeeId);
    }

    return cleanDisplay(request.borrowerStudentNumber);
  }

  function getBorrowerYearSection(request) {
    const values = [
      request.borrowerYearLevel,
      request.borrowerSection,
    ].filter(Boolean);

    return values.length > 0 ? values.join(" - ") : "Not set";
  }

  function getAdminId() {
    return userData?.uid || auth.currentUser?.uid || "";
  }

  function getAdminName() {
    return (
      userData?.fullName ||
      userData?.email ||
      auth.currentUser?.email ||
      "Admin"
    );
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
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Pending") {
    showStatus("Only pending requests can be approved.", "error");
    return;
  }

  const started = startRequestAction(request.id, "approve");

  if (!started) return;

  try {
    const confirmApprove = window.confirm(
      `Approve ${request.borrowerName || request.borrowerEmail}'s request for ${request.itemName}?`
    );

    if (!confirmApprove) return;

    showStatus("", "");

    const requestRef = doc(db, "borrowRequests", request.id);
    const latestRequestSnap = await getDoc(requestRef);

    if (!latestRequestSnap.exists()) {
      showStatus("This request no longer exists.", "error");
      return;
    }

    const latestRequest = {
      id: latestRequestSnap.id,
      ...latestRequestSnap.data(),
    };

    if (latestRequest.approvalStatus !== "Pending") {
      showStatus(
        `This request is already ${latestRequest.approvalStatus}. Refreshing list...`,
        "error"
      );
      await fetchRequests();
      return;
    }

    const itemRef = doc(db, "items", latestRequest.itemId);
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
      updatedAt: serverTimestamp(),
    });

    await updateDoc(itemRef, {
      availability: "Reserved",
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "notifications"), {
      userId: latestRequest.borrowerId,
      targetRole: "borrower",
      categoryId: getRequestCategoryId(latestRequest),
      title: "Borrow Request Approved",
      message: `Your request for ${latestRequest.itemName} has been approved. Please wait for the admin to release the item.`,
      status: "Unread",
      createdAt: serverTimestamp(),
      link: "/my-requests",
    });

    showStatus("Request approved successfully. Item is now reserved.", "success");
    await fetchRequests();
  } catch (error) {
    showStatus("Error approving request: " + error.message, "error");
  } finally {
    finishRequestAction();
  }
}

async function handleReleaseRequest(request) {
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Approved") {
    showStatus("Only approved requests can be released.", "error");
    return;
  }

  const started = startRequestAction(request.id, "release");

  if (!started) return;

  try {
    const confirmRelease = window.confirm(
      `Release ${request.itemName} to ${request.borrowerName || request.borrowerEmail}? This will mark the request as Borrowed.`
    );

    if (!confirmRelease) return;

    showStatus("", "");

    const requestRef = doc(db, "borrowRequests", request.id);
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
        `This request is already ${latestRequest.approvalStatus}. Refreshing list...`,
        "error"
      );
      await fetchRequests();
      return;
    }

    const itemRef = doc(db, "items", latestRequest.itemId);
    const itemSnap = await getDoc(itemRef);

    if (!itemSnap.exists()) {
      showStatus("Item not found. This request cannot be released.", "error");
      return;
    }

    const itemData = itemSnap.data();

    if (itemData.availability !== "Reserved") {
      showStatus(
        `This item is currently ${itemData.availability}. Only reserved items can be released.`
      );
      return;
    }

    await updateDoc(requestRef, {
      approvalStatus: "Borrowed",
      releasedBy: getAdminId(),
      releasedAt: serverTimestamp(),
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
      message: `${latestRequest.itemName} has been released to you. Please return it on or before ${latestRequest.expectedReturnDate || "the expected return date"}.`,
      status: "Unread",
      createdAt: serverTimestamp(),
      link: "/my-requests",
    });

    showStatus("Item released successfully. Request is now marked as borrowed.", "success");
    await fetchRequests();
  } catch (error) {
    showStatus("Error releasing item: " + error.message, "error");
  } finally {
    finishRequestAction();
  }
}

async function handleRejectRequest(request) {
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Pending") {
    showStatus("Only pending requests can be rejected.", "error");
    return;
  }

  const started = startRequestAction(request.id, "reject");

  if (!started) return;

  try {
    const confirmReject = window.confirm(
      `Reject ${request.borrowerName || request.borrowerEmail}'s request for ${request.itemName}?`
    );

    if (!confirmReject) return;

    showStatus("", "");

    const requestRef = doc(db, "borrowRequests", request.id);
    const latestRequestSnap = await getDoc(requestRef);

    if (!latestRequestSnap.exists()) {
      showStatus("This request no longer exists.", "error");
      return;
    }

    const latestRequest = {
      id: latestRequestSnap.id,
      ...latestRequestSnap.data(),
    };

    if (latestRequest.approvalStatus !== "Pending") {
      showStatus(
        `This request is already ${latestRequest.approvalStatus}. Refreshing list...`,
        "error"
      );
      await fetchRequests();
      return;
    }

    await updateDoc(requestRef, {
      approvalStatus: "Rejected",
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "notifications"), {
      userId: latestRequest.borrowerId,
      targetRole: "borrower",
      categoryId: getRequestCategoryId(latestRequest),
      title: "Borrow Request Rejected",
      message: `Your request for ${latestRequest.itemName} has been rejected.`,
      status: "Unread",
      createdAt: serverTimestamp(),
      link: "/my-requests",
    });

    showStatus("Request rejected successfully.", "success");
    await fetchRequests();
  } catch (error) {
    showStatus("Error rejecting request: " + error.message, "error");
  } finally {
    finishRequestAction();
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
      ${request.borrowerUserType || ""}
      ${request.borrowerStudentNumber || ""}
      ${request.borrowerEmployeeId || ""}
      ${request.borrowerCourseDepartment || ""}
      ${request.borrowerYearLevel || ""}
      ${request.borrowerSection || ""}
      ${request.borrowerMobileNumber || ""}
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
            Review borrower requests, approve available items, release approved
            items to borrowers, or reject requests that cannot proceed.
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
            placeholder="Search item, borrower, ID, section, category, purpose..."
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

        <button
          type="button"
          className="manage-refresh-btn"
          onClick={fetchRequests}
          disabled={hasActiveRequestAction()}
        >
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
                    <span>Year / Section</span>
                    <strong>{getBorrowerYearSection(request)}</strong>
                  </div>

                  <div>
                    <span>Mobile Number</span>
                    <strong>{cleanDisplay(request.borrowerMobileNumber)}</strong>
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

                  {request.approvalStatus === "Pending" && (
                    <>
                    <button
                      type="button"
                      className="manage-approve-btn"
                      onClick={() => handleApproveRequest(request)}
                      disabled={hasActiveRequestAction()}
                    >
                      {isRequestActionLoading(request.id, "approve") ? "Approving..." : "Approve"}
                    </button>

                      <button
                        type="button"
                        className="manage-reject-btn"
                        onClick={() => handleRejectRequest(request)}
                        disabled={hasActiveRequestAction()}
                      >
                        {isRequestActionLoading(request.id, "reject") ? "Rejecting..." : "Reject"}
                      </button>
                    </>
                  )}

                  {request.approvalStatus === "Approved" && (
                    <button
                      type="button"
                      className="manage-release-btn"
                      onClick={() => handleReleaseRequest(request)}
                      disabled={hasActiveRequestAction()}
                    >
                      {isRequestActionLoading(request.id, "release")
                        ? "Releasing..."
                        : "Release Item"}
                    </button>
                  )}

                  {!["Pending", "Approved"].includes(request.approvalStatus) && (
                    <span className="manage-no-action">No action needed</span>
                  )}
                </div>

                {request.approvedBy && (
                  <p className="manage-approved-by">
                    Approved by:{" "}
                    {request.approvedBy === getAdminId()
                      ? getAdminName()
                      : request.approvedBy}
                  </p>
                )}

                {request.releasedBy && (
                  <p className="manage-approved-by">
                    Released by:{" "}
                    {request.releasedBy === getAdminId()
                      ? getAdminName()
                      : request.releasedBy}
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
