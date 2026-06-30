import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  getDoc,
  serverTimestamp,
  runTransaction,
  query as firestoreQuery,
  orderBy,
  startAfter,
  limit as queryLimit,
  getCountFromServer,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import ConfirmActionModal from "../components/ConfirmActionModal.jsx";
import "../styles/ManageRequests.css";

const MANAGE_REQUESTS_PAGE_SIZE = 6;

function getRequestPriority(request) {
  if (request.priority === "High") return "High";
  if (request.borrowerUserType === "Faculty") return "High";

  return "Normal";
}

function isFacultyPriorityRequest(request) {
  return getRequestPriority(request) === "High";
}

function getRequestCreatedTime(request) {
  if (request.createdAt?.toMillis) {
    return request.createdAt.toMillis();
  }

  if (request.createdAt?.seconds) {
    return request.createdAt.seconds * 1000;
  }

  return 0;
}

function ManageRequests() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalMatchingRequestCount, setTotalMatchingRequestCount] = useState(0);
  const [serverRequestStats, setServerRequestStats] = useState({
  total: 0,
  pending: 0,
  approved: 0,
  borrowed: 0,
  overdue: 0,
  returned: 0,
  rejected: 0,
});

  const [lastRequestDoc, setLastRequestDoc] = useState(null);
  const [hasMoreRequests, setHasMoreRequests] = useState(false);
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState("");
  const [actionLoadingType, setActionLoadingType] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "Pending"
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [viewingRequest, setViewingRequest] = useState(null);

  const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const actionLockRef = useRef("");

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

function openConfirmAction(config) {
  setConfirmAction(config);
}

function closeConfirmAction() {
  if (confirmActionLoading) return;
  setConfirmAction(null);
}

async function runConfirmAction() {
  if (!confirmAction?.onConfirm) return;

  setConfirmActionLoading(true);

  try {
    await confirmAction.onConfirm();
    setConfirmAction(null);
  } finally {
    setConfirmActionLoading(false);
  }
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

  function isRequestOverdue(request) {
    // Important system rule:
    // Approved means reserved only. Due date / overdue logic starts only after release.
    if (request.approvalStatus !== "Borrowed") {
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
  } else if (value === "All") {
    setSearchParams({});
  } else {
    setSearchParams({ status: value });
  }

  fetchRequests("reset", value);
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
async function autoRejectExpiredPendingRequests() {
  const snapshot = await getDocs(collection(db, "borrowRequests"));
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const expiredRequests = snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((request) => {
      if (request.approvalStatus !== "Pending") return false;

      const createdTime =
        request.createdAt?.toMillis?.() ||
        (request.createdAt?.seconds ? request.createdAt.seconds * 1000 : 0);

      return createdTime && now - createdTime >= oneDayMs;
    });

  await Promise.all(
    expiredRequests.map(async (request) => {
      await updateDoc(doc(db, "borrowRequests", request.id), {
        approvalStatus: "Rejected",
        rejectReason:
          "Automatically rejected because no admin action was made within 24 hours.",
        rejectedAt: serverTimestamp(),
        autoRejected: true,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        targetRole: "borrower",
        categoryId: request.categoryId || "",
        categoryName: request.categoryName || "",
        title: "Borrow Request Auto-Rejected",
        message: `Your request for ${request.itemName} was automatically rejected because it was not approved within 24 hours. You may submit a new request.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });
    })
  );
}
async function autoRejectOtherPendingRequests(approvedRequest) {
  const snapshot = await getDocs(collection(db, "borrowRequests"));

  const otherPendingRequests = snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((request) => {
      return (
        request.id !== approvedRequest.id &&
        request.itemId === approvedRequest.itemId &&
        request.approvalStatus === "Pending"
      );
    });

  await Promise.all(
    otherPendingRequests.map(async (request) => {
      await updateDoc(doc(db, "borrowRequests", request.id), {
        approvalStatus: "Rejected",
        rejectReason:
          "Automatically rejected because another request for the same item was approved.",
        rejectedAt: serverTimestamp(),
        autoRejected: true,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        targetRole: "borrower",
        categoryId: request.categoryId || "",
        categoryName: request.categoryName || "",
        title: "Borrow Request Auto-Rejected",
        message: `Your request for ${request.itemName} was automatically rejected because another request for the same item was approved.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });
    })
  );
}

function getTodayDateKey() {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
}

function getRequestQueryConstraints(
  selectedStatus = statusFilter,
  includeSort = false,
  mode = "reset"
) {
  const constraints = [];

  if (isCategoryAdmin) {
    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.filter(Boolean).slice(0, 10)
      : [];

    if (assignedCategories.length === 0) {
      return null;
    }

    constraints.push(where("categoryId", "in", assignedCategories));
  }

  if (selectedStatus === "Overdue") {
    // Approved requests are reserved but not released yet, so they are not overdue.
    constraints.push(where("approvalStatus", "==", "Borrowed"));
    constraints.push(where("expectedReturnDate", "<", getTodayDateKey()));

    if (includeSort) {
      constraints.push(orderBy("expectedReturnDate", "desc"));

      if (mode === "more" && lastRequestDoc) {
        constraints.push(startAfter(lastRequestDoc));
      }
    }

    return constraints;
  }

  if (selectedStatus !== "All") {
    constraints.push(where("approvalStatus", "==", selectedStatus));
  }

  if (includeSort) {
    constraints.push(orderBy("createdAt", "desc"));

    if (mode === "more" && lastRequestDoc) {
      constraints.push(startAfter(lastRequestDoc));
    }
  }

  return constraints;
}

async function getRequestCount(selectedStatus = "All") {
  const requestsRef = collection(db, "borrowRequests");
  const constraints = getRequestQueryConstraints(selectedStatus, false);

  if (constraints === null) {
    return 0;
  }

  const countQuery =
    constraints.length > 0
      ? firestoreQuery(requestsRef, ...constraints)
      : requestsRef;

  const countSnapshot = await getCountFromServer(countQuery);

  return countSnapshot.data().count || 0;
}

async function fetchRequestCounts(selectedStatus = statusFilter) {
  const [
    totalCount,
    matchingCount,
    pendingCount,
    approvedCount,
    borrowedCount,
    overdueCount,
    returnedCount,
    rejectedCount,
  ] = await Promise.all([
    getRequestCount("All"),
    getRequestCount(selectedStatus),
    getRequestCount("Pending"),
    getRequestCount("Approved"),
    getRequestCount("Borrowed"),
    getRequestCount("Overdue"),
    getRequestCount("Returned"),
    getRequestCount("Rejected"),
  ]);

  setTotalMatchingRequestCount(matchingCount);

  setServerRequestStats({
    total: totalCount,
    pending: pendingCount,
    approved: approvedCount,
    borrowed: borrowedCount,
    overdue: overdueCount,
    returned: returnedCount,
    rejected: rejectedCount,
  });
}

async function fetchRequests(mode = "reset", selectedStatus = statusFilter) {
  if (mode === "reset") {
    setLoading(true);
  } else {
    setLoadingMoreRequests(true);
  }

  try {
    if (mode === "reset") {
      await fetchRequestCounts(selectedStatus);
    }

    const requestsRef = collection(db, "borrowRequests");
    const constraints = getRequestQueryConstraints(selectedStatus, true, mode);

    if (constraints === null) {
      setRequests([]);
      setHasMoreRequests(false);
      setTotalMatchingRequestCount(0);
      return;
    }

    const requestsQuery = firestoreQuery(
      requestsRef,
      ...constraints,
      queryLimit(MANAGE_REQUESTS_PAGE_SIZE + 1)
    );

    const querySnapshot = await getDocs(requestsQuery);
    const docs = querySnapshot.docs;
    const visibleDocs = docs.slice(0, MANAGE_REQUESTS_PAGE_SIZE);

    const requestData = visibleDocs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    setHasMoreRequests(docs.length > MANAGE_REQUESTS_PAGE_SIZE);
    setLastRequestDoc(visibleDocs[visibleDocs.length - 1] || null);

    if (mode === "more") {
      setRequests((previousRequests) => {
        const existingIds = new Set(
          previousRequests.map((request) => request.id)
        );

        const newRequests = requestData.filter(
          (request) => !existingIds.has(request.id)
        );

        return [...previousRequests, ...newRequests];
      });
    } else {
      setRequests(requestData);
    }
  } catch (error) {
    showActionError("Failed to load requests", error);
  } finally {
    setLoading(false);
    setLoadingMoreRequests(false);
  }
}

async function handleLoadMoreRequests() {
  if (!hasMoreRequests || loadingMoreRequests || hasActiveRequestAction()) {
    return;
  }

  await fetchRequests("more", statusFilter);
}

async function handleApproveRequest(request) {
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Pending") {
    showBlockedAction("Only pending requests can be approved.");
    return;
  }

  openConfirmAction({
    title: "Approve Borrow Request?",
    message: `Approve ${
      request.borrowerName || request.borrowerEmail || "this borrower"
    }'s request for ${request.itemName || "this item"}?`,
    confirmText: "Approve Request",
    danger: false,
    onConfirm: async () => {
      const started = startRequestAction(request.id, "approve");

      if (!started) return;

      try {
        showStatus("", "");

        const requestRef = doc(db, "borrowRequests", request.id);
        const latestRequestSnap = await getDoc(requestRef);

        if (!latestRequestSnap.exists()) {
          showBlockedAction("This request no longer exists.");
          return;
        }

        const latestRequest = {
          id: latestRequestSnap.id,
          ...latestRequestSnap.data(),
        };

        if (latestRequest.approvalStatus !== "Pending") {
          showBlockedAction(
            `This request is already ${latestRequest.approvalStatus}. Refreshing list...`
          );
          await fetchRequests("reset", statusFilter);
          return;
        }

        const itemRef = doc(db, "items", latestRequest.itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
          showBlockedAction("Item not found. This request cannot be approved.");
          return;
        }

        await runTransaction(db, async (transaction) => {
          const freshRequestSnap = await transaction.get(requestRef);
          const freshItemSnap = await transaction.get(itemRef);

          if (!freshRequestSnap.exists()) {
            throw new Error("This request no longer exists.");
          }

          if (!freshItemSnap.exists()) {
            throw new Error("Item not found. This request cannot be approved.");
          }

          const freshRequest = freshRequestSnap.data();
          const freshItem = freshItemSnap.data();

          if (freshRequest.approvalStatus !== "Pending") {
            throw new Error(
              `This request is already ${freshRequest.approvalStatus}.`
            );
          }

          if (freshItem.availability !== "Available") {
            throw new Error(
              `This item is currently ${freshItem.availability}. Only available items can be approved.`
            );
          }

          transaction.update(requestRef, {
            approvalStatus: "Approved",
            assignedAdminId: getAdminId(),
            approvedBy: getAdminId(),
            approvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          transaction.update(itemRef, {
            availability: "Reserved",
            updatedAt: serverTimestamp(),
          });
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

        await autoRejectOtherPendingRequests(latestRequest);

        showToast(
          "Request Approved. Other pending requests were auto-rejected.",
          "success"
        );

        await fetchRequests("reset", statusFilter);
      } catch (error) {
        showActionError("Failed to approve request", error);
      } finally {
        finishRequestAction();
      }
    },
  });
}

async function handleReleaseRequest(request) {
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Approved") {
    showBlockedAction("Only approved requests can be released.");
    return;
  }

  openConfirmAction({
    title: "Release Item?",
    message: `Release ${request.itemName || "this item"} to ${
      request.borrowerName || request.borrowerEmail || "this borrower"
    }? This will mark the request as Borrowed.`,
    confirmText: "Release Item",
    danger: false,
    onConfirm: async () => {
      const started = startRequestAction(request.id, "release");

      if (!started) return;

      try {
        showStatus("", "");

        const requestRef = doc(db, "borrowRequests", request.id);
        const latestRequestSnap = await getDoc(requestRef);

        if (!latestRequestSnap.exists()) {
          showBlockedAction("This request no longer exists.");
          return;
        }

        const latestRequest = {
          id: latestRequestSnap.id,
          ...latestRequestSnap.data(),
        };

        if (latestRequest.approvalStatus !== "Approved") {
          showBlockedAction(
            `This request is already ${latestRequest.approvalStatus}. Refreshing list...`
          );
          await fetchRequests("reset", statusFilter);
          return;
        }

        const itemRef = doc(db, "items", latestRequest.itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
          showBlockedAction("Item not found. This request cannot be released.");
          return;
        }

        const itemData = itemSnap.data();

        if (itemData.availability !== "Reserved") {
          showBlockedAction(
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
          message: `${latestRequest.itemName} has been released to you. Please return it on or before ${
            latestRequest.expectedReturnDate || "the expected return date"
          }.`,
          status: "Unread",
          createdAt: serverTimestamp(),
          link: "/my-requests",
        });

        showToast("Item Released", "success");
        await fetchRequests("reset", statusFilter);
      } catch (error) {
        showActionError("Failed to release item", error);
      } finally {
        finishRequestAction();
      }
    },
  });
}

async function handleRejectRequest(request) {
  if (hasActiveRequestAction()) return;

  if (request.approvalStatus !== "Pending") {
    showBlockedAction("Only pending requests can be rejected.");
    return;
  }

  openConfirmAction({
    title: "Reject Borrow Request?",
    message: `Reject ${
      request.borrowerName || request.borrowerEmail || "this borrower"
    }'s request for ${request.itemName || "this item"}?`,
    confirmText: "Reject Request",
    danger: true,
    onConfirm: async () => {
      const started = startRequestAction(request.id, "reject");

      if (!started) return;

      try {
        showStatus("", "");

        const requestRef = doc(db, "borrowRequests", request.id);
        const latestRequestSnap = await getDoc(requestRef);

        if (!latestRequestSnap.exists()) {
          showBlockedAction("This request no longer exists.");
          return;
        }

        const latestRequest = {
          id: latestRequestSnap.id,
          ...latestRequestSnap.data(),
        };

        if (latestRequest.approvalStatus !== "Pending") {
          showBlockedAction(
            `This request is already ${latestRequest.approvalStatus}. Refreshing list...`
          );
          await fetchRequests("reset", statusFilter);
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

        showToast("Request Rejected", "success");
        await fetchRequests("reset", statusFilter);
      } catch (error) {
        showActionError("Failed to reject request", error);
      } finally {
        finishRequestAction();
      }
    },
  });
}

useEffect(() => {
  async function loadRequests() {
    try {
      await autoRejectExpiredPendingRequests();
      await fetchRequests();
    } catch (error) {
      showActionError("Failed to prepare borrow requests", error);
      setLoading(false);
      setLoadingMoreRequests(false);
    }
  }

  loadRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

const filteredRequests = visibleRequests
  .filter((request) => {
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
      ${getRequestPriority(request)}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "All" ||
      request.approvalStatus === statusFilter ||
      (statusFilter === "Overdue" && isRequestOverdue(request));

    return matchesSearch && matchesStatus;
  })
  .sort((a, b) => {
    const aPriority = isFacultyPriorityRequest(a) ? 0 : 1;
    const bPriority = isFacultyPriorityRequest(b) ? 0 : 1;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return getRequestCreatedTime(b) - getRequestCreatedTime(a);
  });

const requestStats = serverRequestStats;

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
    <ConfirmActionModal
      open={Boolean(confirmAction)}
      title={confirmAction?.title}
      message={confirmAction?.message}
      confirmText={confirmAction?.confirmText}
      cancelText={confirmAction?.cancelText || "Cancel"}
      danger={confirmAction?.danger}
      loading={confirmActionLoading}
      onConfirm={runConfirmAction}
      onCancel={closeConfirmAction}
    />
<section className="manage-requests-header manage-requests-header-compact">
  <div className="manage-requests-header-content">
<div className="manage-requests-header-text">
  <h1>Manage Requests</h1>

  <p>
    Review borrower requests, approve available items, release reserved
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
      className="manage-secondary-btn manage-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
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
          onClick={() => fetchRequests("reset")}
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
Showing {filteredRequests.length} of {totalMatchingRequestCount} visible
request{totalMatchingRequestCount === 1 ? "" : "s"}.
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
  <>
    <div className="manage-request-table-header">
      <span>Item</span>
      <span>Borrower</span>
      <span>Category</span>
      <span>Borrow Date</span>
      <span>Expected Return</span>
      <span>Status</span>
      <span>Actions</span>
    </div>

    <div className="manage-request-grid manage-request-table-grid">
      {filteredRequests.map((request) => (
        <article
  className={`manage-request-row ${
    isFacultyPriorityRequest(request) ? "manage-priority-row" : ""
  }`}
  key={request.id}
>
          <div className="manage-request-cell manage-request-item-cell">
            <span>{request.itemCode || request.itemId}</span>
            <strong>{request.itemName || "Untitled Item"}</strong>
          </div>

          <div className="manage-request-cell manage-request-borrower-cell">
            <span>{request.borrowerEmail || "No email"}</span>
            <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
          </div>

          <div className="manage-request-cell">
            <span>Category</span>
            <strong>{getRequestCategoryName(request)}</strong>
          </div>

          <div className="manage-request-cell">
            <span>Borrow Date</span>
            <strong>{request.borrowDate || "Not set"}</strong>
          </div>

          <div className="manage-request-cell">
            <span>Expected Return</span>
            <strong>{request.expectedReturnDate || "Not set"}</strong>
          </div>

<div className="manage-request-status-cell">
  {isFacultyPriorityRequest(request) && (
    <span className="manage-priority-pill">Faculty</span>
  )}

  <span
    className={`manage-status-pill status-${String(
      request.approvalStatus || "Unknown"
    ).toLowerCase()}`}
  >
    {request.approvalStatus || "Unknown"}
  </span>

  {isRequestOverdue(request) && (
    <span className="manage-status-pill status-overdue">Overdue</span>
  )}
</div>

          <div className="manage-request-row-actions">
            <button
              type="button"
              className="manage-view-btn manage-action-icon-btn manage-action-details"
              data-tooltip="Details"
              title="Details"
              aria-label="View request details"
              onClick={() => setViewingRequest(request)}
            >
              <span aria-hidden="true">i</span>
            </button>

            <button
              type="button"
              className="manage-view-btn manage-action-icon-btn manage-action-item"
              data-tooltip="View Item"
              title="View Item"
              aria-label="View item"
              onClick={() => navigate(`/item/${request.itemId}`)}
            >
              <span aria-hidden="true">▣</span>
            </button>

            {request.approvalStatus === "Pending" && (
              <>
                <button
                  type="button"
                  className="manage-approve-btn manage-action-icon-btn manage-action-approve"
                  data-tooltip={
                    isRequestActionLoading(request.id, "approve")
                      ? "Approving..."
                      : "Approve"
                  }
                  title={
                    isRequestActionLoading(request.id, "approve")
                      ? "Approving..."
                      : "Approve"
                  }
                  aria-label="Approve request"
                  onClick={() => handleApproveRequest(request)}
                  disabled={hasActiveRequestAction()}
                >
                  <span aria-hidden="true">
                    {isRequestActionLoading(request.id, "approve") ? "…" : "✓"}
                  </span>
                </button>

                <button
                  type="button"
                  className="manage-reject-btn manage-action-icon-btn manage-action-reject"
                  data-tooltip={
                    isRequestActionLoading(request.id, "reject")
                      ? "Rejecting..."
                      : "Reject"
                  }
                  title={
                    isRequestActionLoading(request.id, "reject")
                      ? "Rejecting..."
                      : "Reject"
                  }
                  aria-label="Reject request"
                  onClick={() => handleRejectRequest(request)}
                  disabled={hasActiveRequestAction()}
                >
                  <span aria-hidden="true">
                    {isRequestActionLoading(request.id, "reject") ? "…" : "×"}
                  </span>
                </button>
              </>
            )}

            {request.approvalStatus === "Approved" && (
              <button
                type="button"
                className="manage-release-btn manage-action-icon-btn manage-action-release"
                data-tooltip={
                  isRequestActionLoading(request.id, "release")
                    ? "Releasing..."
                    : "Release"
                }
                title={
                  isRequestActionLoading(request.id, "release")
                    ? "Releasing..."
                    : "Release"
                }
                aria-label="Release item"
                onClick={() => handleReleaseRequest(request)}
                disabled={hasActiveRequestAction()}
              >
                <span aria-hidden="true">
                  {isRequestActionLoading(request.id, "release") ? "…" : "↗"}
                </span>
              </button>
            )}

            {!["Pending", "Approved"].includes(request.approvalStatus) && (
              <span
                className="manage-no-action manage-action-icon-btn manage-action-done"
                data-tooltip="No action needed"
                title="No action needed"
                aria-label="No action needed"
              >
                <span aria-hidden="true">✓</span>
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
    {hasMoreRequests && filteredRequests.length < totalMatchingRequestCount && (
  <div className="manage-load-more-row">
    <button
      type="button"
      className="manage-load-more-btn"
      onClick={handleLoadMoreRequests}
      disabled={loadingMoreRequests || hasActiveRequestAction()}
    >
      {loadingMoreRequests ? "Loading..." : "Load More Requests"}
    </button>
  </div>
)}
  </>
)}
      </section>

      {viewingRequest &&
        createPortal(
          <div
            className="manage-request-view-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Borrow request details"
          >
          <section className="manage-request-view-modal">
            <button
              type="button"
              className="manage-request-modal-close"
              onClick={() => setViewingRequest(null)}
              aria-label="Close request details"
            >
              ×
            </button>

            <div className="manage-section-heading">
              <div>
                <h2>{viewingRequest.itemName || "Untitled Item"}</h2>
                <p>{viewingRequest.itemCode || viewingRequest.itemId}</p>
              </div>
            </div>
<div className="manage-request-view-status">
  {isFacultyPriorityRequest(viewingRequest) && (
    <span className="manage-priority-pill manage-priority-pill-full">
      Priority Faculty
    </span>
  )}

  <span
    className={`manage-status-pill status-${String(
      viewingRequest.approvalStatus || "Unknown"
    ).toLowerCase()}`}
  >
    {viewingRequest.approvalStatus || "Unknown"}
  </span>

  {isRequestOverdue(viewingRequest) && (
    <span className="manage-status-pill status-overdue">
      Overdue
    </span>
  )}
</div>

            <div className="manage-request-view-grid">
              <div>
                <span>Borrower</span>
                <strong>{viewingRequest.borrowerName || "Unnamed Borrower"}</strong>
                <p>{viewingRequest.borrowerEmail || "No email"}</p>
              </div>

              <div>
                <span>User Type</span>
                <strong>{getBorrowerUserType(viewingRequest)}</strong>
              </div>

              <div>
                <span>ID Number</span>
                <strong>{getBorrowerIdNumber(viewingRequest)}</strong>
              </div>

              <div>
                <span>Course / Department</span>
                <strong>{cleanDisplay(viewingRequest.borrowerCourseDepartment)}</strong>
              </div>

              <div>
                <span>Year / Section</span>
                <strong>{getBorrowerYearSection(viewingRequest)}</strong>
              </div>

              <div>
                <span>Mobile Number</span>
                <strong>{cleanDisplay(viewingRequest.borrowerMobileNumber)}</strong>
              </div>

              <div>
                <span>Category</span>
                <strong>{getRequestCategoryName(viewingRequest)}</strong>
              </div>

              <div>
                <span>Borrow Date</span>
                <strong>{viewingRequest.borrowDate || "Not set"}</strong>
              </div>

              <div>
                <span>Expected Return</span>
                <strong>{viewingRequest.expectedReturnDate || "Not set"}</strong>
              </div>
            </div>

            <div className="manage-request-view-purpose">
              <span>Purpose</span>
              <p>{viewingRequest.purpose || "No purpose provided."}</p>
            </div>

            <div className="manage-request-view-actions">
              <button
                type="button"
                className="manage-secondary-btn"
                onClick={() => setViewingRequest(null)}
              >
                Close
              </button>

              <button
                type="button"
                className="manage-view-btn"
                onClick={() => navigate(`/item/${viewingRequest.itemId}`)}
              >
                View Item
              </button>
            </div>
          </section>
          </div>,
          document.body
        )}
    </div>
  );
}

export default ManageRequests;
