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
  Timestamp,
  runTransaction,
  query as firestoreQuery,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import ConfirmActionModal from "../components/ConfirmActionModal.jsx";
import "../styles/ReleaseItem.css";

const RELEASE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TEMPORARY_BORROWING_RESTRICTION_MS = RELEASE_WINDOW_MS;
const TEMPORARY_BORROWING_RESTRICTION_REASON =
  "Temporary borrowing restriction for 24 hours because an approved item was not claimed/released within the allowed window.";
const RELEASED_ITEMS_PAGE_SIZE = 10;


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

function ReleaseItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData, schoolStatus } = outletContext;
  const { showToast } = useToast();

  const [approvedRequests, setApprovedRequests] = useState([]);
  const [releasedRequests, setReleasedRequests] = useState([]);
  const [activeReleaseTab, setActiveReleaseTab] = useState("forRelease");
  const [releasedDateFilter, setReleasedDateFilter] = useState("today");
  const [visibleReleasedCount, setVisibleReleasedCount] = useState(
    RELEASED_ITEMS_PAGE_SIZE
  );
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
  const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  const isCategoryAdmin = userData?.role === "categoryAdmin";

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

function getSchoolClosedMessage() {
  const reason = String(schoolStatus?.closureReason || "").trim();

  return reason
    ? `Item release is temporarily unavailable because the school is closed: ${reason}`
    : "Item release is temporarily unavailable because the school is currently closed.";
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
function validateReleaseField(fieldName) {
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
          "Please scan, enter, or select an approved request first.";
      } else {
        delete nextErrors.selectedRequest;
      }
    }

    return nextErrors;
  });
}

function sanitizeScannerInput(value) {
  return String(value || "").replace(/[<>`]/g, "");
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

function clearSelectedReleaseRequest() {
  if (releasing) return;

  setSelectedRequest(null);
  setManualItemId("");

  setFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };
    delete nextErrors.selectedRequest;
    return nextErrors;
  });
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
      showToast("Scanner closed.", "success");
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
  if (isSchoolClosed()) {
    showBlockedAction(getSchoolClosedMessage());
    return;
  }

  if (startingScanner || releasing) return;

  setStartingScanner(true);
  showToast("Starting scanner...", "success");

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

    scannerRunningRef.current = true;

    showToast("Scanner opened. Point the camera at the QR code or barcode.", "success");
  } catch (error) {
    await stopReleaseScanner(false);
    showActionError("Scanner could not start", error);
  } finally {
    setStartingScanner(false);
  }
}

async function restartReleaseScanner() {
  showToast("Restarting scanner...", "success");
  await startReleaseScanner();
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

  function getAdminId() {
    return userData?.uid || auth.currentUser?.uid || "";
  }

  function getTodayDateKey() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;

    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function getReleasedTime(request) {
    return getTimestampMs(request?.releasedAt);
  }

  function getReleasedDateFilterRange(filterValue) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    if (filterValue === "week") {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 6);

      return {
        start: weekStart.getTime(),
        end: tomorrowStart.getTime(),
      };
    }

    if (filterValue === "month") {
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      return {
        start: monthStart.getTime(),
        end: tomorrowStart.getTime(),
      };
    }

    return {
      start: todayStart.getTime(),
      end: tomorrowStart.getTime(),
    };
  }

  function getReleasedDateFilterLabel(filterValue) {
    if (filterValue === "week") return "this week";
    if (filterValue === "month") return "this month";

    return "today";
  }

  function isReleasedRequestRecord(request) {
    return (
      Boolean(getReleasedTime(request)) &&
      ["Borrowed", "Returned"].includes(request?.approvalStatus)
    );
  }

  function isReleasedRequestInsideFilter(request) {
    const releasedTime = getReleasedTime(request);

    if (!releasedTime) return false;

    const range = getReleasedDateFilterRange(releasedDateFilter);

    return releasedTime >= range.start && releasedTime < range.end;
  }

  function formatReleasedDateTime(request) {
    const releasedTime = getReleasedTime(request);

    if (!releasedTime) return "No release date";

    return new Date(releasedTime).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getComparableDateKey(value) {
    if (!value) return "";

    if (typeof value?.toDate === "function") {
      return formatDateKey(value.toDate());
    }

    if (typeof value?.toMillis === "function") {
      return formatDateKey(new Date(value.toMillis()));
    }

    if (value?.seconds) {
      return formatDateKey(new Date(value.seconds * 1000));
    }

    const textValue = String(value || "").trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
      return textValue;
    }

    const parsedDate = new Date(textValue);

    if (Number.isNaN(parsedDate.getTime())) {
      return "";
    }

    return formatDateKey(parsedDate);
  }

  function isReturnedLateRequest(request) {
    if (request?.approvalStatus !== "Returned") return false;

    const expectedReturnDate = getComparableDateKey(request.expectedReturnDate);
    const actualReturnDate = getComparableDateKey(request.actualReturnDate);

    if (!expectedReturnDate || !actualReturnDate) return false;

    return actualReturnDate > expectedReturnDate;
  }

  function getReleasedStatusLabel(request) {
    if (isReturnedLateRequest(request)) return "Returned Late";
    if (request?.approvalStatus === "Returned") return "Returned";
    if (request?.approvalStatus === "Borrowed") return "Borrowed";

    return request?.approvalStatus || "Released";
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
    const closedTime = getTimestampMs(schoolStatus?.closedAt);
    const reopenedTime = isSchoolClosed()
      ? Date.now()
      : getTimestampMs(schoolStatus?.reopenedAt);

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
    if (isSchoolClosed()) return false;

    const remainingMs = getApprovedReleaseRemainingMs(request);

    return remainingMs !== null && remainingMs <= 0;
  }

  function formatApprovedReleaseRemaining(request) {
    if (isSchoolClosed()) return "Paused by school closure";

    const remainingMs = getApprovedReleaseRemainingMs(request);

    if (remainingMs === null) return "No release deadline";
    if (remainingMs <= 0) return "Release deadline expired";

    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours <= 0) return `${minutes}m left`;

    return `${hours}h ${minutes}m left`;
  }

  function formatApprovedReleaseDeadline(request) {
    if (isSchoolClosed()) return "Paused by school closure";

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
        permission issue should not break the whole Release Item page.
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
    School Closure Mode pauses approved request release/claim expiration.
  */
  if (isSchoolClosed()) {
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

async function fetchApprovedRequests(options = {}) {
  const { showSuccessToast = false } = options;

  setLoading(true);

  try {
    if (!isSchoolClosed()) {
      await autoExpireApprovedRequests();
    }

    const querySnapshot = await getDocs(collection(db, "borrowRequests"));

    const requestData = await enrichRequestsWithItemImages(
      querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))
    );

    setApprovedRequests(
      requestData.filter((request) => request.approvalStatus === "Approved")
    );

    setReleasedRequests(
      requestData.filter((request) => isReleasedRequestRecord(request))
    );

    if (showSuccessToast) {
      showToast("Release records refreshed", "success");
    }
  } catch (error) {
    showActionError("Failed to load release records", error);
  } finally {
    setLoading(false);
  }
}

  const visibleApprovedRequests = useMemo(() => {
    const categoryVisibleRequests = isCategoryAdmin
      ? approvedRequests.filter((request) => canCategoryAdminSeeRequest(request))
      : approvedRequests;

    return [...categoryVisibleRequests].sort(
      (a, b) => getApprovedTime(b) - getApprovedTime(a)
    );
  }, [approvedRequests, userData]);

  const visibleReleasedRequests = useMemo(() => {
    const categoryVisibleRequests = isCategoryAdmin
      ? releasedRequests.filter((request) => canCategoryAdminSeeRequest(request))
      : releasedRequests;

    return [...categoryVisibleRequests]
      .filter((request) => isReleasedRequestInsideFilter(request))
      .sort((a, b) => getReleasedTime(b) - getReleasedTime(a));
  }, [releasedRequests, userData, releasedDateFilter]);

  const displayedReleasedRequests = visibleReleasedRequests.slice(
    0,
    visibleReleasedCount
  );

async function findApprovedRequestByItemId(rawItemId) {
  if (isReleaseBusy()) return;

  if (isSchoolClosed()) {
    showBlockedAction(getSchoolClosedMessage());
    return;
  }

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
      showBlockedAction("No approved request found for this item.");
      return;
    }

    if (isCategoryAdmin && !canCategoryAdminSeeRequest(matchingRequest)) {
      setSelectedRequest(null);
      showBlockedAction(
        "This request belongs to a category that is not assigned to your account."
      );
      return;
    }

    if (isApprovedReleaseExpired(matchingRequest)) {
      await expireApprovedRequest(matchingRequest);
      setSelectedRequest(null);
      await fetchApprovedRequests();
      showBlockedAction(
        "This approved request expired because it was not released before the release deadline."
      );
      return;
    }

const [enrichedMatchingRequest] = await enrichRequestsWithItemImages([
  matchingRequest,
]);

matchingRequest = enrichedMatchingRequest;

setSelectedRequest(matchingRequest);
setManualItemId(itemId);
setFieldErrors({});
showToast("Approved request found. Review details before release.", "success");
  } catch (error) {
    showActionError("Failed to find approved request", error);
  }
}

async function handleConfirmRelease() {
  showStatus("", "");

  if (isSchoolClosed()) {
    showBlockedAction(getSchoolClosedMessage());
    return;
  }

  const isValid = validateReleaseForm();

  if (!isValid) {
    return;
  }

  if (isCategoryAdmin && !canCategoryAdminSeeRequest(selectedRequest)) {
    showBlockedAction("You are not allowed to release this category item.");
    return;
  }

  const requestToRelease = selectedRequest;

  openConfirmAction({
    title: "Confirm Item Release?",
    message: `Confirm release of ${requestToRelease.itemName || "this item"} to ${
      requestToRelease.borrowerName || requestToRelease.borrowerEmail || "this borrower"
    }?`,
    confirmText: "Release Item",
    danger: false,
    onConfirm: async () => {
      const started = startReleaseAction();

      if (!started) return;

      try {
        showStatus("", "");

        const requestRef = doc(db, "borrowRequests", requestToRelease.id);
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
            `This request is already ${latestRequest.approvalStatus}. Refreshing release queue...`
          );

          setSelectedRequest(null);
          setManualItemId("");
          await fetchApprovedRequests();
          return;
        }

        if (isApprovedReleaseExpired(latestRequest)) {
          await expireApprovedRequest(latestRequest);
          showBlockedAction(
            "This approved request expired because it was not released before the release deadline."
          );

          setSelectedRequest(null);
          setManualItemId("");
          await fetchApprovedRequests();
          return;
        }

        if (isCategoryAdmin && !canCategoryAdminSeeRequest(latestRequest)) {
          showBlockedAction("You are not allowed to release this category item.");
          return;
        }

        const itemRef = doc(db, "items", latestRequest.itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
          showBlockedAction("Item record not found. Release cannot continue.");
          return;
        }

        const itemData = itemSnap.data();

        if (
          itemData.availability !== "Reserved" &&
          itemData.availability !== "Available"
        ) {
          showBlockedAction(
            `This item is currently ${itemData.availability}. It cannot be released.`
          );
          return;
        }

        const releaseDateUpdate = getReleaseDateUpdate(latestRequest);

        await updateDoc(requestRef, {
          approvalStatus: "Borrowed",
          borrowDate: releaseDateUpdate.borrowDate,
          expectedReturnDate: releaseDateUpdate.expectedReturnDate,
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
          message: `${latestRequest.itemName} has been released to you. Your borrowing period starts today. Please return it on or before ${releaseDateUpdate.expectedReturnDate}.`,
          status: "Unread",
          createdAt: serverTimestamp(),
          link: "/my-requests",
        });

        showToast("Item Released", "success");
        setSelectedRequest(null);
        setManualItemId("");
        await fetchApprovedRequests();
      } catch (error) {
        showActionError("Failed to release item", error);
      } finally {
        finishReleaseAction();
      }
    },
  });
}

  useEffect(() => {
    if (!userData?.role) return;

    fetchApprovedRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userData?.role,
    userData?.assignedCategories?.join("|"),
    schoolStatus?.isSchoolClosed,
    schoolStatus?.reopenedAt,
  ]);

useEffect(() => {
  setVisibleReleasedCount(RELEASED_ITEMS_PAGE_SIZE);
}, [activeReleaseTab, releasedDateFilter, userData?.assignedCategories?.join("|")]);

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

      {isSchoolClosed() && (
        <div className="release-school-closed-banner" role="alert">
          <strong>Release is temporarily unavailable</strong>
          <p>{getSchoolClosedMessage()}</p>
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
      disabled={scannerOpen || startingScanner || isSchoolClosed()}
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
    disabled={startingScanner || releasing || isSchoolClosed()}
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
    disabled={startingScanner || releasing || isSchoolClosed()}
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
                onBlur={() => validateReleaseField("manualItemId")}
                onChange={(e) => {
                  const sanitizedValue = sanitizeScannerInput(e.target.value);

                  setManualItemId(sanitizedValue);
                  clearFieldError("manualItemId");
                }}
                placeholder="Example: item ID or /item/itemId"
                disabled={releasing || isSchoolClosed()}
              />
            <button
              type="button"
              className="release-secondary-btn"
              onClick={() => findApprovedRequestByItemId(manualItemId)}
              disabled={releasing || isSchoolClosed()}
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
  {selectedRequest && (
    <button
      type="button"
      className="release-selected-close-btn"
      onClick={clearSelectedReleaseRequest}
      disabled={releasing}
      aria-label="Clear selected request"
      title="Clear selected request"
    >
      ×
    </button>
  )}

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

              <div className="release-selected-item-preview">
                {getRequestItemImageUrl(selectedRequest) ? (
                  <img
                    src={getRequestItemImageUrl(selectedRequest)}
                    alt={selectedRequest.itemName || "Selected item"}
                  />
                ) : (
                  <span>{getRequestItemInitial(selectedRequest)}</span>
                )}

                <div>
                  <span>Item Photo</span>
                  <strong>{selectedRequest.itemName || "Untitled Item"}</strong>
                  <p>{selectedRequest.itemCode || selectedRequest.itemId || "No item code"}</p>
                </div>
              </div>

              <div className="release-purpose-box">
                <span>Release Deadline</span>
                <p>
                  {formatApprovedReleaseRemaining(selectedRequest)} · Deadline:{" "}
                  {formatApprovedReleaseDeadline(selectedRequest)}
                </p>
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

                <div>
                  <span>Adjusted Borrow Date</span>
                  <strong>{getReleaseDateUpdate(selectedRequest).borrowDate}</strong>
                </div>

                <div>
                  <span>Adjusted Return Date</span>
                  <strong>{getReleaseDateUpdate(selectedRequest).expectedReturnDate}</strong>
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
                disabled={releasing || isSchoolClosed()}
              >
                {releasing ? "Releasing..." : isSchoolClosed() ? "School Closed" : "Confirm Release"}
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
        <div className="release-tabs" role="tablist" aria-label="Release item tabs">
          <button
            type="button"
            className={`release-tab-btn ${
              activeReleaseTab === "forRelease" ? "active" : ""
            }`}
            onClick={() => setActiveReleaseTab("forRelease")}
          >
            For Release
            <span>{visibleApprovedRequests.length}</span>
          </button>

          <button
            type="button"
            className={`release-tab-btn ${
              activeReleaseTab === "releasedItems" ? "active" : ""
            }`}
            onClick={() => setActiveReleaseTab("releasedItems")}
          >
            Released Items
            <span>{visibleReleasedRequests.length}</span>
          </button>
        </div>

        {activeReleaseTab === "forRelease" ? (
          <>
            <div className="release-section-heading">
              <div>
                <h2>For Release</h2>
                <p>
                  Showing {visibleApprovedRequests.length} approved request
                  {visibleApprovedRequests.length === 1 ? "" : "s"} waiting for
                  physical release.
                </p>
              </div>

              <button
                type="button"
                className="release-secondary-btn"
                onClick={() => fetchApprovedRequests({ showSuccessToast: true })}
                disabled={releasing || isSchoolClosed()}
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
  <div className="release-table-scroll-area" aria-label="For release table">
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
                        <small
                          title={`Release deadline: ${formatApprovedReleaseDeadline(request)}`}
                        >
                          {formatApprovedReleaseRemaining(request)}
                        </small>
                      </div>

                      <div className="release-approved-actions">
                        <button
                          type="button"
                          className="release-primary-btn"
                          onClick={() => {
                            if (releasing) return;

                            if (isApprovedReleaseExpired(request)) {
                              expireApprovedRequest(request).then(() =>
                                fetchApprovedRequests()
                              );
                              showBlockedAction(
                                "This approved request expired because it was not released before the release deadline."
                              );
                              return;
                            }

                            setSelectedRequest(request);
                            setManualItemId(request.itemId);
                            setFieldErrors({});
                            showToast("Approved request selected.", "success");
                          }}
                          disabled={releasing || isSchoolClosed() || selectedRequest?.id === request.id}
                        >
                          {selectedRequest?.id === request.id ? "Selected" : "Select"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="release-section-heading release-released-heading">
              <div>
                <h2>Released Items</h2>
                <p>
                  Showing {displayedReleasedRequests.length} of{" "}
                  {visibleReleasedRequests.length} released item
                  {visibleReleasedRequests.length === 1 ? "" : "s"} for{" "}
                  {getReleasedDateFilterLabel(releasedDateFilter)}.
                </p>
              </div>

              <div className="release-released-controls">
                <select
                  value={releasedDateFilter}
                  onChange={(event) => setReleasedDateFilter(event.target.value)}
                  aria-label="Released items date filter"
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                </select>

                <button
                  type="button"
                  className="release-secondary-btn"
                  onClick={() => fetchApprovedRequests({ showSuccessToast: true })}
                  disabled={releasing || isSchoolClosed()}
                >
                  Refresh
                </button>
              </div>
            </div>

            {visibleReleasedRequests.length === 0 ? (
              <div className="release-empty">
                <img src="/qborrow-logo.png" alt="QBorrow Logo" />
                <h2>No released items</h2>
                <p>No items were released for the selected date filter.</p>
              </div>
) : (
  <>
    <div className="release-table-scroll-area" aria-label="Released items table">
    <div className="release-released-table-header">
                  <span>Item</span>
                  <span>Borrower</span>
                  <span>Category</span>
                  <span>Released</span>
                  <span>Expected Return</span>
                  <span>Status</span>
                </div>

                <div className="release-released-table-grid">
                  {displayedReleasedRequests.map((request) => (
                    <article className="release-released-row" key={request.id}>
                      <div className="release-released-cell release-released-item-cell">
                        <span>{request.itemCode || request.itemId || "No code"}</span>
                        <strong>{request.itemName || "Untitled Item"}</strong>
                      </div>

                      <div className="release-released-cell release-released-borrower-cell">
                        <span>{request.borrowerEmail || "No email"}</span>
                        <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
                      </div>

                      <div className="release-released-cell">
                        <span>Category</span>
                        <strong>{getRequestCategoryName(request)}</strong>
                      </div>

                      <div className="release-released-cell">
                        <span>Released</span>
                        <strong>{formatReleasedDateTime(request)}</strong>
                      </div>

                      <div className="release-released-cell">
                        <span>Expected Return</span>
                        <strong>{request.expectedReturnDate || "Not set"}</strong>
                      </div>

                      <div className="release-released-status-cell">
                        <span
                          className={`release-released-status-pill status-${normalizeText(
                            getReleasedStatusLabel(request)
                          ).replace(/\s+/g, "-")}`}
                          title={
                            isReturnedLateRequest(request)
                              ? `Returned late: expected ${
                                  request.expectedReturnDate || "not set"
                                }, returned ${request.actualReturnDate || "not set"}`
                              : getReleasedStatusLabel(request)
                          }
                        >
                          {getReleasedStatusLabel(request)}
                        </span>
                      </div>
                    </article>
                  ))}
    </div>
  </div>

  {visibleReleasedCount < visibleReleasedRequests.length && (
                  <div className="release-load-more-row release-released-load-more-row">
                    <button
                      type="button"
                      className="release-secondary-btn"
                      onClick={() =>
                        setVisibleReleasedCount((currentCount) =>
                          Math.min(
                            currentCount + RELEASED_ITEMS_PAGE_SIZE,
                            visibleReleasedRequests.length
                          )
                        )
                      }
                    >
                      Load More Released Items
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default ReleaseItem;