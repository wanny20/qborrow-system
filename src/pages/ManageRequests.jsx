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
  Timestamp,
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
const RELEASE_WINDOW_MS = 24 * 60 * 60 * 1000;
const NEAR_RELEASE_WINDOW_MS = 3 * 60 * 60 * 1000;
const TEMPORARY_BORROWING_RESTRICTION_MS = RELEASE_WINDOW_MS;
const TEMPORARY_BORROWING_RESTRICTION_REASON =
  "Temporary borrowing restriction for 24 hours because an approved item was not claimed/released within the allowed window.";

const MANAGE_REQUEST_VISIBLE_STATUS_FILTERS = [
  "All",
  "Pending",
  "Expired",
  "Rejected",
  "Cancelled",
];

function getSafeManageRequestStatusFilter(value) {
  return MANAGE_REQUEST_VISIBLE_STATUS_FILTERS.includes(value)
    ? value
    : "Pending";
}


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

function getTimestampMs(value) {
  if (!value) return 0;

  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (value?.seconds) {
    return value.seconds * 1000;
  }

  const parsedDate = new Date(value);
  const parsedTime = parsedDate.getTime();

  return Number.isNaN(parsedTime) ? 0 : parsedTime;
}

function ManageRequests() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData, schoolStatus } = outletContext;
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
  expired: 0,
});

  const [lastRequestDoc, setLastRequestDoc] = useState(null);
  const [hasMoreRequests, setHasMoreRequests] = useState(false);
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState("");
  const [actionLoadingType, setActionLoadingType] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(() =>
    getSafeManageRequestStatusFilter(searchParams.get("status"))
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [viewingRequest, setViewingRequest] = useState(null);

  const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isAdmin =
    userData?.role === "superAdmin" || userData?.role === "categoryAdmin";
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

function isSchoolClosed() {
  return Boolean(schoolStatus?.isSchoolClosed);
}

function getSchoolClosedMessage(actionLabel = "This action") {
  const reason = String(schoolStatus?.closureReason || "").trim();

  return reason
    ? `${actionLabel} is temporarily unavailable because the school is closed: ${reason}`
    : `${actionLabel} is temporarily unavailable because the school is currently closed.`;
}

function isSystemSuspended() {
  return Boolean(schoolStatus?.isSystemSuspended);
}

function getSystemSuspendedMessage(actionLabel = "This action") {
  const reason = String(schoolStatus?.systemSuspensionReason || "").trim();

  return reason
    ? `${actionLabel} is unavailable because the system is suspended: ${reason}`
    : `${actionLabel} is unavailable because the system is currently suspended.`;
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


  function getRequestItemImageUrl(request) {
    return (
      request?.itemImageUrl ||
      request?.itemImage ||
      request?.imageUrl ||
      request?.itemPhotoUrl ||
      ""
    );
  }

  function getRequestItemInitial(request) {
    return String(request?.itemName || request?.itemCode || "Q")
      .trim()
      .charAt(0)
      .toUpperCase() || "Q";
  }

  async function enrichRequestsWithItemImages(requestList) {
    const uniqueItemIds = [
      ...new Set(
        requestList
          .map((request) => request.itemId)
          .filter(Boolean)
      ),
    ];

    if (uniqueItemIds.length === 0) {
      return requestList;
    }

    const itemEntries = await Promise.all(
      uniqueItemIds.map(async (itemId) => {
        try {
          const itemSnap = await getDoc(doc(db, "items", itemId));

          return [
            itemId,
            itemSnap.exists()
              ? {
                  id: itemSnap.id,
                  ...itemSnap.data(),
                }
              : null,
          ];
        } catch (error) {
          console.warn("Failed to load item image", itemId, error);
          return [itemId, null];
        }
      })
    );

    const itemMap = new Map(itemEntries);

    return requestList.map((request) => {
      const itemRecord = itemMap.get(request.itemId);

      return {
        ...request,
        itemImageUrl:
          getRequestItemImageUrl(request) ||
          itemRecord?.imageUrl ||
          itemRecord?.itemImageUrl ||
          "",
        itemCondition: request.itemCondition || itemRecord?.condition || "",
        itemAvailability:
          request.itemAvailability || itemRecord?.availability || "",
      };
    });
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
  const safeStatusFilter = getSafeManageRequestStatusFilter(value);

  setStatusFilter(safeStatusFilter);

  if (safeStatusFilter === "Pending") {
    setSearchParams({ status: "Pending" });
  } else if (safeStatusFilter === "All") {
    setSearchParams({});
  } else {
    setSearchParams({ status: safeStatusFilter });
  }

  fetchRequests("reset", safeStatusFilter);
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
  /*
    System Suspension Mode pauses pending request expiration.
  */
  if (isSystemSuspended()) {
    return;
  }

  const snapshot = await getDocs(collection(db, "borrowRequests"));
  const now = Date.now();

  const expiredRequests = snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((request) => {
      if (request.approvalStatus !== "Pending") return false;

      /*
        Category admins can only update requests inside their assigned
        categories. Without this check, Firestore blocks the whole auto-expire
        batch when one expired request belongs to another category.
      */
      if (!canCategoryAdminSeeRequest(request)) return false;

      const requestDeadline = getPendingRequestDeadlineMs(request);

      return Boolean(requestDeadline && now > requestDeadline);
    });

  await Promise.allSettled(
    expiredRequests.map(async (request) => {
      await updateDoc(doc(db, "borrowRequests", request.id), {
        approvalStatus: "Expired",
        expireReason:
          "Request expired because it was not approved before the request deadline.",
        expiredAt: serverTimestamp(),
        expiredBy: "system",
        autoExpired: true,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        targetRole: "borrower",
        categoryId: request.categoryId || "",
        categoryName: request.categoryName || "",
        title: "Borrow Request Expired",
        message: `Your request for ${request.itemName} expired because it was not approved before the request deadline. You may submit a new request if the item is still available.`,
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

function getApprovedTime(request) {
  return getTimestampMs(request.approvedAt) || getTimestampMs(request.updatedAt);
}

function parseDateKey(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);

  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
}

function getEndOfDateKeyMs(dateKey) {
  const date = parseDateKey(dateKey);

  if (!date) return 0;

  date.setHours(23, 59, 59, 999);

  return date.getTime();
}

function getEarliestValidDeadlineMs(deadlines) {
  const validDeadlines = deadlines.filter(
    (deadline) => typeof deadline === "number" && deadline > 0
  );

  return validDeadlines.length > 0 ? Math.min(...validDeadlines) : 0;
}

function getSchoolClosurePauseMs(timerStartMs, baseDeadlineMs) {
  const closedTime = getTimestampMs(schoolStatus?.systemSuspendedAt);
  const reopenedTime = isSystemSuspended()
    ? Date.now()
    : getTimestampMs(schoolStatus?.systemResumedAt);

  if (!closedTime || !reopenedTime || !baseDeadlineMs) return 0;
  if (baseDeadlineMs <= closedTime) return 0;
  if (timerStartMs && timerStartMs >= reopenedTime) return 0;

  const pauseStart = Math.max(closedTime, timerStartMs || closedTime);
  const pauseEnd = reopenedTime;

  return Math.max(0, pauseEnd - pauseStart);
}

function getDeadlineWithSchoolClosurePause(timerStartMs, baseDeadlineMs) {
  if (!baseDeadlineMs) return 0;

  return baseDeadlineMs + getSchoolClosurePauseMs(timerStartMs, baseDeadlineMs);
}

function getPendingRequestDeadlineMs(request) {
  const createdTime = getRequestCreatedTime(request);
  const expectedReturnEnd = getEndOfDateKeyMs(request.expectedReturnDate);

  return getEarliestValidDeadlineMs([
    createdTime
      ? getDeadlineWithSchoolClosurePause(
          createdTime,
          createdTime + RELEASE_WINDOW_MS
        )
      : 0,
    getDeadlineWithSchoolClosurePause(createdTime, expectedReturnEnd),
  ]);
}

function getApprovedReleaseDeadlineMs(request) {
  if (request.approvalStatus !== "Approved") return 0;

  const approvedTime = getApprovedTime(request);
  const expectedReturnEnd = getEndOfDateKeyMs(request.expectedReturnDate);

  return getEarliestValidDeadlineMs([
    approvedTime
      ? getDeadlineWithSchoolClosurePause(
          approvedTime,
          approvedTime + RELEASE_WINDOW_MS
        )
      : 0,
    getDeadlineWithSchoolClosurePause(approvedTime, expectedReturnEnd),
  ]);
}

function getApprovedReleaseRemainingMs(request) {
  const deadlineTime = getApprovedReleaseDeadlineMs(request);

  if (!deadlineTime) return null;

  return deadlineTime - Date.now();
}

function isApprovedReleaseExpired(request) {
  if (isSystemSuspended()) return false;

  const remainingMs = getApprovedReleaseRemainingMs(request);

  return remainingMs !== null && remainingMs <= 0;
}

function isNearReleaseExpire(request) {
  if (isSystemSuspended()) return false;

  const remainingMs = getApprovedReleaseRemainingMs(request);

  return (
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= NEAR_RELEASE_WINDOW_MS
  );
}

function formatApprovedReleaseRemaining(request) {
  if (isSystemSuspended()) return "Paused by system suspension";

  const remainingMs = getApprovedReleaseRemainingMs(request);

  if (remainingMs === null) return "No release deadline";
  if (remainingMs <= 0) return "Release deadline expired";

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m left to release`;

  return `${hours}h ${minutes}m left to release`;
}

function formatApprovedReleaseDeadline(request) {
  if (isSystemSuspended()) return "Paused by system suspension";

  const deadlineTime = getApprovedReleaseDeadlineMs(request);

  if (!deadlineTime) return "No deadline";

  return new Date(deadlineTime).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const baseDate = parseDateKey(dateKey);

  if (!baseDate) return dateKey;

  baseDate.setDate(baseDate.getDate() + daysToAdd);

  return formatDateKey(baseDate);
}

function getRequestedBorrowDurationDays(request) {
  const borrowDate = parseDateKey(request.borrowDate);
  const expectedDate = parseDateKey(request.expectedReturnDate);

  if (!borrowDate || !expectedDate) return 0;

  const oneDayMs = 24 * 60 * 60 * 1000;
  const durationDays = Math.round(
    (expectedDate.getTime() - borrowDate.getTime()) / oneDayMs
  );

  return Math.max(durationDays, 0);
}

function getReleaseDateUpdate(request) {
  const actualBorrowDate = getTodayDateKey();
  const durationDays = getRequestedBorrowDurationDays(request);

  return {
    borrowDate: actualBorrowDate,
    expectedReturnDate: addDaysToDateKey(actualBorrowDate, durationDays),
  };
}

function getTemporaryRestrictionUntilDate() {
  return new Date(Date.now() + TEMPORARY_BORROWING_RESTRICTION_MS);
}

function shouldApplyTemporaryBorrowingRestriction(
  borrowerAccount,
  restrictionUntilDate
) {
  if (!borrowerAccount) return false;

  const existingSuspensionTime = getTimestampMs(borrowerAccount.suspendedUntil);
  const restrictionUntilTime = restrictionUntilDate.getTime();

  /*
    Do not overwrite stronger restrictions:
    - canBorrow false with no suspendedUntil means manual/indefinite restriction.
    - suspendedUntil later than the new 24-hour window is stronger.
  */
  if (borrowerAccount.canBorrow === false && !existingSuspensionTime) {
    return false;
  }

  if (
    borrowerAccount.canBorrow === false &&
    existingSuspensionTime >= restrictionUntilTime
  ) {
    return false;
  }

  return true;
}


function buildTemporaryPenaltyRecordPayload(request, restrictionUntilDate) {
  if (!request?.borrowerId || !restrictionUntilDate) return null;

  return {
    borrowerId: request.borrowerId || "",
    borrowerName: request.borrowerName || "Unknown borrower",
    borrowerEmail: request.borrowerEmail || "",
    requestId: request.id || "",
    itemId: request.itemId || "",
    itemName: request.itemName || "Unknown item",
    itemCode: request.itemCode || "",
    categoryId: request.categoryId || "",
    categoryName: request.categoryName || "",
    reason: TEMPORARY_BORROWING_RESTRICTION_REASON,
    penaltyType: "Temporary Borrowing Restriction",
    penaltySource: "approvedReleaseExpired",
    restrictionEndAt: Timestamp.fromDate(restrictionUntilDate),
    status: "Active",
  };
}

async function createPenaltyRecord(payload) {
  if (!payload) return;

  await addDoc(collection(db, "penaltyRecords"), {
    ...payload,
    restrictionStartAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: "system",
    createdByEmail: "",
    updatedAt: serverTimestamp(),
  });
}

async function notifyApprovedRequestExpired(request) {
  await addDoc(collection(db, "notifications"), {
    userId: request.borrowerId,
    targetRole: "borrower",
    categoryId: request.categoryId || "",
    categoryName: request.categoryName || "",
    title: "Approved Request Expired",
    message: `Your approved request for ${
      request.itemName || "this item"
    } expired because the item was not released before the release deadline. Your borrowing access is temporarily restricted for 24 hours. Contact the admin if this was a mistake.`,
    status: "Unread",
    createdAt: serverTimestamp(),
    link: "/my-requests",
  });
}

async function expireApprovedRequest(request) {
  if (!request?.id) return null;

  const requestRef = doc(db, "borrowRequests", request.id);
  let expiredRequest = null;
  let penaltyRecordPayload = null;

  await runTransaction(db, async (transaction) => {
    const freshRequestSnap = await transaction.get(requestRef);

    if (!freshRequestSnap.exists()) return;

    const freshRequest = {
      id: freshRequestSnap.id,
      ...freshRequestSnap.data(),
    };

    if (freshRequest.approvalStatus !== "Approved") return;
    if (!canCategoryAdminSeeRequest(freshRequest)) return;
    if (!isApprovedReleaseExpired(freshRequest)) return;

    const itemRef = freshRequest.itemId
      ? doc(db, "items", freshRequest.itemId)
      : null;
    const itemSnap = itemRef ? await transaction.get(itemRef) : null;

    const borrowerRef = freshRequest.borrowerId
      ? doc(db, "users", freshRequest.borrowerId)
      : null;
    const borrowerSnap = borrowerRef ? await transaction.get(borrowerRef) : null;
    const restrictionUntilDate = getTemporaryRestrictionUntilDate();

    transaction.update(requestRef, {
      approvalStatus: "Expired",
      expireReason:
        "Approved request expired because the item was not released before the release deadline.",
      expiredAt: serverTimestamp(),
      expiredBy: "system",
      autoExpired: true,
      updatedAt: serverTimestamp(),
    });

    if (itemRef && itemSnap?.exists() && itemSnap.data().availability === "Reserved") {
      transaction.update(itemRef, {
        availability: "Available",
        updatedAt: serverTimestamp(),
      });
    }

    if (
      borrowerRef &&
      borrowerSnap?.exists() &&
      shouldApplyTemporaryBorrowingRestriction(
        borrowerSnap.data(),
        restrictionUntilDate
      )
    ) {
      transaction.update(borrowerRef, {
        canBorrow: false,
        suspendedUntil: Timestamp.fromDate(restrictionUntilDate),
        suspensionReason: TEMPORARY_BORROWING_RESTRICTION_REASON,
        updatedAt: serverTimestamp(),
      });

      penaltyRecordPayload = buildTemporaryPenaltyRecordPayload(
        freshRequest,
        restrictionUntilDate
      );
    }

    expiredRequest = freshRequest;
  });

  if (expiredRequest) {
    try {
      await notifyApprovedRequestExpired(expiredRequest);
    } catch {
      /*
        The request/item/user transaction already finished. A notification
        permission issue should not break the whole Manage Requests page.
      */
    }

    try {
      await createPenaltyRecord(penaltyRecordPayload);
    } catch (error) {
      console.error("Penalty record creation failed:", error);
    }
  }

  return expiredRequest;
}

async function autoExpireApprovedRequests() {
  /*
    System Suspension Mode pauses approved request release/claim expiration.
  */
  if (isSystemSuspended()) {
    return;
  }

  const snapshot = await getDocs(collection(db, "borrowRequests"));

  const expiredApprovedRequests = snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((request) => {
      return (
        request.approvalStatus === "Approved" &&
        canCategoryAdminSeeRequest(request) &&
        isApprovedReleaseExpired(request)
      );
    });

  await Promise.allSettled(
    expiredApprovedRequests.map((request) => expireApprovedRequest(request))
  );
}

async function prepareBorrowRequestsForDisplay() {
  /*
    Auto-expire is helpful, but it must not block admins from opening this page.
    If Firestore blocks one old/mismatched record, requests still load normally.
  */
  if (isSystemSuspended()) {
    return;
  }

  await Promise.allSettled([
    autoRejectExpiredPendingRequests(),
    autoExpireApprovedRequests(),
  ]);
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
    expiredCount,
  ] = await Promise.all([
    getRequestCount("All"),
    getRequestCount(selectedStatus),
    getRequestCount("Pending"),
    getRequestCount("Approved"),
    getRequestCount("Borrowed"),
    getRequestCount("Overdue"),
    getRequestCount("Returned"),
    getRequestCount("Rejected"),
    getRequestCount("Expired"),
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
    expired: expiredCount,
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

    const requestData = await enrichRequestsWithItemImages(
      visibleDocs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))
    );

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

  if (isSystemSuspended()) {
    showBlockedAction(getSystemSuspendedMessage("Approving borrow requests"));
    return;
  }

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
          message: `Your request for ${latestRequest.itemName} has been approved. Please claim the item before the release deadline. The deadline is whichever comes first: 24 hours after approval or the end of your expected return date. If it is not released before the deadline, the request will expire and borrowing access may be temporarily restricted for 24 hours.`,
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

  if (isSystemSuspended()) {
    showBlockedAction(getSystemSuspendedMessage("Item release"));
    return;
  }

  if (isSchoolClosed()) {
    showBlockedAction(getSchoolClosedMessage("Item release"));
    return;
  }

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

        if (isApprovedReleaseExpired(latestRequest)) {
          await expireApprovedRequest(latestRequest);
          showBlockedAction(
            "This approved request expired because it was not released before the release deadline."
          );
          await fetchRequests("reset", statusFilter);
          return;
        }

        const releaseDateUpdate = getReleaseDateUpdate(latestRequest);
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
          borrowDate: releaseDateUpdate.borrowDate,
          expectedReturnDate: releaseDateUpdate.expectedReturnDate,
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
          message: `${latestRequest.itemName} has been released to you. Your borrowing period starts today. Please return it on or before ${
            releaseDateUpdate.expectedReturnDate || "the expected return date"
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

  if (isSystemSuspended()) {
    showBlockedAction(getSystemSuspendedMessage("Rejecting borrow requests"));
    return;
  }

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
  if (!userData?.role) {
    return;
  }

  if (!isAdmin) {
    showBlockedAction("Only admins can access Manage Requests.");
    setLoading(false);
    navigate("/dashboard", { replace: true });
    return;
  }

  async function loadRequests() {
    try {
      await prepareBorrowRequestsForDisplay();
      await fetchRequests();
    } catch (error) {
      showActionError("Failed to load borrow requests", error);
      setLoading(false);
      setLoadingMoreRequests(false);
    }
  }

  loadRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  userData?.role,
  userData?.assignedCategories?.join("|"),
  schoolStatus?.isSchoolClosed,
  schoolStatus?.isSystemSuspended,
  schoolStatus?.systemSuspendedAt,
  schoolStatus?.systemResumedAt,
]);

  useEffect(() => {
    const statusFromUrl = searchParams.get("status");

    if (!statusFromUrl) {
      return;
    }

    const safeStatusFilter = getSafeManageRequestStatusFilter(statusFromUrl);

    if (safeStatusFilter !== statusFromUrl) {
      setStatusFilter(safeStatusFilter);
      setSearchParams({ status: safeStatusFilter }, { replace: true });
      fetchRequests("reset", safeStatusFilter);
      return;
    }

    setStatusFilter(safeStatusFilter);
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

      {(isSystemSuspended() || isSchoolClosed()) && (
        <div className="manage-status manage-status-error" role="alert">
          {isSystemSuspended()
            ? getSystemSuspendedMessage("Request management")
            : getSchoolClosedMessage("Item release")}
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

        <div>
          <span>⌛</span>
          <h3>{requestStats.expired}</h3>
          <p>Expired</p>
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
            <option value="Expired">Expired</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <button
          type="button"
          className="manage-refresh-btn"
          onClick={async () => {
            await prepareBorrowRequestsForDisplay();
            await fetchRequests("reset");
          }}
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
    <div className="manage-request-table-scroll" aria-label="Borrow requests table">
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

  {request.approvalStatus === "Approved" && (
    <span
      className={`manage-status-pill ${
        isNearReleaseExpire(request) ? "status-overdue" : "status-approved"
      }`}
      title={`Release deadline: ${formatApprovedReleaseDeadline(request)}`}
    >
      {formatApprovedReleaseRemaining(request)}
    </span>
  )}

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

      {viewingRequest && (
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

            <div className="manage-request-view-header">
              <div>
                <span className="manage-request-view-code">
                  {viewingRequest.itemCode || viewingRequest.itemId}
                </span>
                <h2>{viewingRequest.itemName || "Untitled Item"}</h2>
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

                {viewingRequest.approvalStatus === "Approved" && (
                  <span
                    className={`manage-status-pill ${
                      isNearReleaseExpire(viewingRequest)
                        ? "status-overdue"
                        : "status-approved"
                    }`}
                    title={`Release deadline: ${formatApprovedReleaseDeadline(
                      viewingRequest
                    )}`}
                  >
                    {formatApprovedReleaseRemaining(viewingRequest)}
                  </span>
                )}

                {isRequestOverdue(viewingRequest) && (
                  <span className="manage-status-pill status-overdue">
                    Overdue
                  </span>
                )}
              </div>
            </div>

            <div className="manage-request-view-columns">
              <section className="manage-request-view-panel manage-request-view-item-panel">
                <div className="manage-request-view-media">
                  {getRequestItemImageUrl(viewingRequest) ? (
                    <img
                      src={getRequestItemImageUrl(viewingRequest)}
                      alt={viewingRequest.itemName || "Borrowed item"}
                    />
                  ) : (
                    <span>{getRequestItemInitial(viewingRequest)}</span>
                  )}
                </div>

                <div className="manage-request-view-panel-heading">
                  <span>Item Details</span>
                  <h3>{viewingRequest.itemName || "Untitled Item"}</h3>
                </div>

                <div className="manage-request-view-detail-grid">
                  <div>
                    <span>Item Code</span>
                    <strong>{viewingRequest.itemCode || viewingRequest.itemId || "Not set"}</strong>
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

                  {viewingRequest.approvalStatus === "Approved" && (
                    <>
                      <div>
                        <span>Release Deadline</span>
                        <strong>{formatApprovedReleaseDeadline(viewingRequest)}</strong>
                      </div>

                      <div>
                        <span>Release Window</span>
                        <strong>{formatApprovedReleaseRemaining(viewingRequest)}</strong>
                      </div>
                    </>
                  )}
                </div>

                <div className="manage-request-view-purpose">
                  <span>Purpose</span>
                  <p>{viewingRequest.purpose || "No purpose provided."}</p>
                </div>
              </section>

              <section className="manage-request-view-panel manage-request-view-user-panel">
                <div className="manage-request-view-panel-heading">
                  <span>Borrower Details</span>
                  <h3>{viewingRequest.borrowerName || "Unnamed Borrower"}</h3>
                  <p>{viewingRequest.borrowerEmail || "No email"}</p>
                </div>

                <div className="manage-request-view-detail-grid">
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

                  <div className="manage-request-view-wide-field">
                    <span>Mobile Number</span>
                    <strong>{cleanDisplay(viewingRequest.borrowerMobileNumber)}</strong>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default ManageRequests;
