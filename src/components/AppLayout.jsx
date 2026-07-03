import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/AppLayout.css";

const CLAIM_PICKUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function AppLayout() {
  const [userData, setUserData] = useState(null);
  const [schoolStatus, setSchoolStatus] = useState({
    isSchoolClosed: false,
    closureReason: "",
  });

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.innerWidth > 820;
  });

  const [loading, setLoading] = useState(true);
  const [notificationCount, setNotificationCount] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [unsavedChangesMessage, setUnsavedChangesMessage] = useState(
  "Leaving this page will discard your progress."
);
const [pendingNavigationPath, setPendingNavigationPath] = useState("");


  const [rejectedRequestAlerts, setRejectedRequestAlerts] = useState([]);
  const [acknowledgingRejectedAlerts, setAcknowledgingRejectedAlerts] =
  useState(false);

  const [adminBorrowRequestAlerts, setAdminBorrowRequestAlerts] = useState([]);
  const [claimItemAlerts, setClaimItemAlerts] = useState([]);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    return localStorage.getItem("qborrowTheme") || "light";
  });

  const CLOSED_SIDEBAR_GROUPS = {
    dashboard: false,
    borrower: false,
    admin: false,
    reports: false,
    userManagement: false,
  };

  const [openSidebarGroups, setOpenSidebarGroups] = useState(
    CLOSED_SIDEBAR_GROUPS
  );

  const [showSuspendedAlert, setShowSuspendedAlert] = useState(false);

  const [showBorrowingRestoredAlert, setShowBorrowingRestoredAlert] =
  useState(false);

  const [showAccountDisabledAlert, setShowAccountDisabledAlert] =
  useState(false);

const [suspensionClock, setSuspensionClock] = useState(() => Date.now());
const previousSuspendedStateRef = useRef(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const closeSidebarOnMobile = useCallback(() => {
  if (typeof window !== "undefined" && window.innerWidth <= 820) {
    setSidebarOpen(false);
  }
}, []);

function showActionError(shortMessage, error) {
  console.error(shortMessage, error);
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  showToast(message, "error");
}

function getDateLabel(value) {
  const timestamp = getDateTimeMs(value);

  if (!timestamp) return "Not recorded";

  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSchoolClosedNow() {
  return Boolean(schoolStatus?.isSchoolClosed);
}

function getSchoolClosureReason() {
  return String(schoolStatus?.closureReason || "").trim();
}

function getSchoolClosureMessage() {
  const reason = getSchoolClosureReason();

  return reason
    ? `School is currently closed: ${reason}`
    : "School is currently closed.";
}

const setUnsavedChanges = useCallback((hasChanges, message = "") => {
  setHasUnsavedChanges(Boolean(hasChanges));
  setUnsavedChangesMessage(
    message || "Leaving this page will discard your progress."
  );
}, []);

const guardedNavigate = useCallback(
  (path) => {
    const currentFullPath = `${location.pathname}${location.search || ""}`;

    if (path === currentFullPath) {
      closeSidebarOnMobile();
      return;
    }

    if (hasUnsavedChanges) {
      setPendingNavigationPath(path);
      return;
    }

    navigate(path);
    closeSidebarOnMobile();
  },
  [
    closeSidebarOnMobile,
    hasUnsavedChanges,
    location.pathname,
    location.search,
    navigate,
  ]
);

function cancelPendingNavigation() {
  setPendingNavigationPath("");
}
function isCurrentAccountDisabled() {
  return userData?.isActive === false;
}

function handleCloseAccountDisabledAlert() {
  setShowAccountDisabledAlert(false);
  confirmLogout();
}

function confirmPendingNavigation() {
  const targetPath = pendingNavigationPath;

  setPendingNavigationPath("");
  setHasUnsavedChanges(false);
  setUnsavedChangesMessage("Leaving this page will discard your progress.");

  if (targetPath) {
    navigate(targetPath);
    closeSidebarOnMobile();
  }
}

const currentPath = location.pathname;

const activeSidebarPath = (() => {
  if (
    currentPath === "/dashboard" ||
    currentPath.startsWith("/dashboard/") ||
    currentPath.startsWith("/dashboard-list") ||
    currentPath.startsWith("/admin-dashboard-list") ||
    currentPath.startsWith("/admin-list") ||
    currentPath.startsWith("/total-items") ||
    currentPath.startsWith("/available-items") ||
    currentPath.startsWith("/borrowed-items") ||
    currentPath.startsWith("/pending-requests") ||
    currentPath.startsWith("/overdue") ||
    currentPath.startsWith("/damaged-lost")
  ) {
    return "/dashboard";
  }

  if (
    currentPath === "/items" ||
    currentPath.startsWith("/item/") ||
    currentPath.startsWith("/edit-item") ||
    currentPath.startsWith("/borrow-request")
  ) {
    return "/items";
  }

  if (currentPath.startsWith("/add-item")) {
    return "/add-item";
  }

  if (currentPath.startsWith("/manage-requests")) {
    return "/manage-requests";
  }

  if (currentPath.startsWith("/release-item")) {
    return "/release-item";
  }

  if (currentPath.startsWith("/return-confirmation")) {
    return "/return-confirmation";
  }

  if (currentPath.startsWith("/reports")) {
    return "/reports";
  }

  if (currentPath.startsWith("/scan-qr")) {
    return "/scan-qr";
  }

  if (currentPath.startsWith("/my-requests")) {
    return "/my-requests";
  }

  if (currentPath.startsWith("/notifications")) {
    return "/notifications";
  }

  if (currentPath.startsWith("/user-management")) {
    return "/user-management";
  }

  if (currentPath.startsWith("/settings")) {
    return "/settings";
  }

  return currentPath;
})();
function getRequestTime(request) {
  if (request.rejectedAt?.toMillis) return request.rejectedAt.toMillis();
  if (request.rejectedAt?.seconds) return request.rejectedAt.seconds * 1000;

  if (request.createdAt?.toMillis) return request.createdAt.toMillis();
  if (request.createdAt?.seconds) return request.createdAt.seconds * 1000;

  return 0;
}

function getRejectedRequestReason(request) {
  if (request.rejectReason) return request.rejectReason;

  if (request.autoRejected) {
    return "Automatically rejected because no admin action was made within 24 hours. You may submit a new request.";
  }

  return "Your borrow request was rejected. You may submit a new request if needed.";
}

function getSuspendedUntilDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (value?.seconds) {
    return new Date(value.seconds * 1000);
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function isCurrentUserSuspended() {
  if (userData?.role !== "borrower") return false;

  const suspendedUntilDate = getSuspendedUntilDate(userData?.suspendedUntil);
  const currentDate = new Date(suspensionClock);

  if (userData?.canBorrow === true) {
    return false;
  }

  if (suspendedUntilDate) {
    return suspendedUntilDate > currentDate;
  }

  return userData?.canBorrow === false;
}

function getSuspendedUntilLabel() {
  const suspendedUntilDate = getSuspendedUntilDate(userData?.suspendedUntil);

  if (!suspendedUntilDate) return "until further notice";

  return suspendedUntilDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getSuspensionReason() {
  return (
    userData?.suspensionReason ||
    "Your account is temporarily restricted from borrowing because of overdue return records."
  );
}

function getDateTimeMs(value) {
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

function getApprovedPickupRemainingMs(request) {
  if (request?.approvalStatus !== "Approved") return null;

  const approvedTime =
    getDateTimeMs(request.approvedAt) || getDateTimeMs(request.updatedAt);

  if (!approvedTime) return null;

  return CLAIM_PICKUP_WINDOW_MS - (Date.now() - approvedTime);
}

function formatClaimPickupRemaining(request) {
  const remainingMs = getApprovedPickupRemainingMs(request);

  if (remainingMs === null) return "within the release window";
  if (remainingMs <= 0) return "now";

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;

  return `${hours}h ${minutes}m`;
}

function getClaimItemTooltip() {
  const request = claimItemAlerts[0];

  if (!request) {
    return "You have an approved item to claim.";
  }

  return `${request.itemName || "An approved item"} must be claimed within ${formatClaimPickupRemaining(request)}.`;
}

function isTemporaryBorrowingRestriction() {
  const reason = String(userData?.suspensionReason || "").toLowerCase();

  return (
    reason.includes("temporary borrowing restriction") ||
    reason.includes("approved item") ||
    reason.includes("claimed/released")
  );
}

function getBorrowingRestrictionTooltip() {
  if (isTemporaryBorrowingRestriction()) {
    return "Your borrowing access is temporarily restricted. View details in Profile Settings.";
  }

  return "You are suspended from borrowing items. View details in Profile Settings.";
}

function handleViewBorrowingRestriction() {
  guardedNavigate("/settings");
}

function getSuspensionStorageKey() {
  const userId = userData?.uid || auth.currentUser?.uid || "unknown-user";
  const suspendedUntil = userData?.suspendedUntil?.seconds
    ? userData.suspendedUntil.seconds
    : String(userData?.suspendedUntil || "no-date");

  return `qborrowSuspensionAlertSeen-${userId}-${suspendedUntil}`;
}

function handleCloseSuspendedAlert() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(getSuspensionStorageKey(), "yes");
  }

  setShowSuspendedAlert(false);
}

function getBorrowingRestoredStorageKey() {
  const userId = userData?.uid || auth.currentUser?.uid || "unknown-user";
  const suspensionMarker = userData?.suspendedUntil?.seconds
    ? userData.suspendedUntil.seconds
    : String(userData?.suspendedUntil || "manual-restored");

  return `qborrowBorrowingRestoredAlertSeen-${userId}-${suspensionMarker}`;
}

function handleCloseBorrowingRestoredAlert() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(getBorrowingRestoredStorageKey(), "yes");
  }

  setShowBorrowingRestoredAlert(false);
}

async function checkRejectedRequestAlerts(userId) {
  try {
    const requestQuery = query(
      collection(db, "borrowRequests"),
      where("borrowerId", "==", userId)
    );

    const snapshot = await getDocs(requestQuery);

    const unacknowledgedRejectedRequests = snapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .filter((request) => {
        return (
          request.approvalStatus === "Rejected" &&
          !request.borrowerAcknowledgedAt
        );
      })
      .sort((a, b) => getRequestTime(b) - getRequestTime(a));

    setRejectedRequestAlerts(unacknowledgedRejectedRequests);
  } catch (error) {
    console.error("Error checking rejected request alerts:", error);
  }
}

async function handleAcknowledgeRejectedRequests() {
  if (acknowledgingRejectedAlerts || rejectedRequestAlerts.length === 0) return;

  setAcknowledgingRejectedAlerts(true);

  try {
    await Promise.all(
      rejectedRequestAlerts.map((request) =>
        updateDoc(doc(db, "borrowRequests", request.id), {
          borrowerAcknowledgedAt: serverTimestamp(),
          borrowerAcknowledgedBy: auth.currentUser?.uid || "",
        })
      )
    );

    setRejectedRequestAlerts([]);
  } catch (error) {
    showActionError("Failed to close rejected request alert", error);
  } finally {
    setAcknowledgingRejectedAlerts(false);
  }
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

function getBorrowRequestCreatedTime(request) {
  if (request.createdAt?.toMillis) return request.createdAt.toMillis();
  if (request.createdAt?.seconds) return request.createdAt.seconds * 1000;

  return 0;
}

function isFacultyBorrowRequest(request) {
  return (
    request.priority === "High" ||
    String(request.borrowerUserType || "").toLowerCase() === "faculty"
  );
}

function getAdminBorrowAlertStorageKey() {
  const adminId = userData?.uid || auth.currentUser?.uid || "unknown-admin";

  return `qborrowSeenBorrowRequestAlerts-${adminId}`;
}

function getSeenAdminBorrowAlertIds() {
  if (typeof window === "undefined") return new Set();

  try {
    const savedIds = JSON.parse(
      localStorage.getItem(getAdminBorrowAlertStorageKey()) || "[]"
    );

    return new Set(Array.isArray(savedIds) ? savedIds : []);
  } catch {
    return new Set();
  }
}

function markAdminBorrowAlertAsSeen(requestId) {
  if (typeof window === "undefined" || !requestId) return;

  const seenIds = getSeenAdminBorrowAlertIds();
  seenIds.add(requestId);

  localStorage.setItem(
    getAdminBorrowAlertStorageKey(),
    JSON.stringify([...seenIds])
  );
}

function canSeeBorrowRequestAlert(request) {
  if (!isAdmin || !userData?.uid) return false;

  if (isSuperAdmin) return true;

  if (isCategoryAdmin) {
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

  return false;
}

function handleDismissAdminBorrowRequestAlert() {
  const currentAlert = adminBorrowRequestAlerts[0];

  if (!currentAlert) return;

  markAdminBorrowAlertAsSeen(currentAlert.id);

  setAdminBorrowRequestAlerts((previousAlerts) =>
    previousAlerts.filter((request) => request.id !== currentAlert.id)
  );
}

function handleViewAdminBorrowRequestAlert() {
  const currentAlert = adminBorrowRequestAlerts[0];

  if (!currentAlert) return;

  markAdminBorrowAlertAsSeen(currentAlert.id);

  setAdminBorrowRequestAlerts((previousAlerts) =>
    previousAlerts.filter((request) => request.id !== currentAlert.id)
  );

  navigate("/manage-requests?status=Pending");
}

  const isBorrower = userData?.role === "borrower";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isSuperAdmin = userData?.role === "superAdmin";
  const isAdmin = isCategoryAdmin || isSuperAdmin;

  const showBorrowingSuspendedIndicator =
  isBorrower && isCurrentUserSuspended();

  const roleLabel = useMemo(() => {
    if (isSuperAdmin) return "Super Admin";
    if (isCategoryAdmin) return "Category Admin";
    return "Borrower";
  }, [isSuperAdmin, isCategoryAdmin]);

  const schoolClosed = isSchoolClosedNow();
  const schoolClosureMessage = getSchoolClosureMessage();

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getInitials(name, email) {
    const source = name || email || "User";

    const initials = source
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    return initials || "U";
  }

  function getNotificationCategoryId(notification) {
    return notification.categoryId || notification.category || "";
  }

  function canSeeNotification(notification) {
    if (!userData?.uid) return false;

    if (notification.userId === userData.uid) {
      return true;
    }

    const targetRole = notification.targetRole || "";

    if (isSuperAdmin) {
      return ["admin", "superAdmin", "all", "system"].includes(targetRole);
    }

    if (isCategoryAdmin) {
      const assignedCategories = Array.isArray(userData?.assignedCategories)
        ? userData.assignedCategories.map(normalizeText)
        : [];

      const notificationCategory = normalizeText(
        getNotificationCategoryId(notification)
      );

      const roleAllowed = ["categoryAdmin", "admin", "all"].includes(targetRole);

      const categoryAllowed =
        !notificationCategory ||
        assignedCategories.includes(notificationCategory);

      return roleAllowed && categoryAllowed;
    }

    return false;
  }

  function isNotificationUnread(notification) {
    if (!userData?.uid) return false;

    if (notification.userId === userData.uid) {
      return notification.status !== "Read";
    }

    const readBy = Array.isArray(notification.readBy)
      ? notification.readBy
      : [];

    return !readBy.includes(userData.uid);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setUserData({
            id: userSnap.id,
            uid: user.uid,
            email: user.email,
            ...userSnap.data(),
          });
        } else {
          showBlockedAction("No user role found in Firestore.");
          await signOut(auth);
          navigate("/login");
        }
      } catch (error) {
        showActionError("Failed to load user data", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
  if (!userData?.uid) return;

  const userRef = doc(db, "users", userData.uid);

const unsubscribe = onSnapshot(
  userRef,
  (snapshot) => {
    if (!snapshot.exists()) return;

    const latestUserData = snapshot.data();

    setUserData((previousData) => ({
      ...previousData,
      id: snapshot.id,
      ...latestUserData,
      uid: previousData?.uid || auth.currentUser?.uid || snapshot.id,
      email:
        auth.currentUser?.email ||
        latestUserData.email ||
        previousData?.email ||
        "",
    }));
  },
  (error) => {
    showActionError("Failed to sync user account", error);
  }
);

  return () => unsubscribe();
}, [userData?.uid]);

useEffect(() => {
  if (!userData?.uid) {
    setSchoolStatus({
      isSchoolClosed: false,
      closureReason: "",
    });
    return;
  }

  const schoolStatusRef = doc(db, "systemSettings", "schoolStatus");

  const unsubscribe = onSnapshot(
    schoolStatusRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        setSchoolStatus({
          isSchoolClosed: false,
          closureReason: "",
        });
        return;
      }

      setSchoolStatus({
        id: snapshot.id,
        isSchoolClosed: false,
        closureReason: "",
        ...snapshot.data(),
      });
    },
    (error) => {
      console.error("School status sync error:", error);
    }
  );

  return () => unsubscribe();
}, [userData?.uid]);

  useEffect(() => {
  if (!hasUnsavedChanges) return;

  function handleBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = "";
  }

  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}, [hasUnsavedChanges]);

  useEffect(() => {
    function handleUserUpdate(event) {
      setUserData((previousData) => ({
        ...previousData,
        ...event.detail,
      }));
    }

    window.addEventListener("qborrow-user-updated", handleUserUpdate);

    return () => {
      window.removeEventListener("qborrow-user-updated", handleUserUpdate);
    };
  }, []);

function resetPublicPagesToLightTheme() {
  if (typeof document === "undefined") return;

  /*
    Keep the user's saved QBorrow theme in localStorage, but reset the actual
    document theme when AppLayout is no longer active. This prevents public
    pages like Landing and Login from inheriting the dashboard dark mode after
    logout.
  */
  document.documentElement.setAttribute("data-theme", "light");
}

    useEffect(() => {
      const savedTheme =
        localStorage.getItem("qborrowTheme") || userData?.themeMode || "light";

      setThemeMode(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
      localStorage.setItem("qborrowTheme", savedTheme);
    }, [userData?.themeMode]);

  useEffect(() => {
    return () => {
      resetPublicPagesToLightTheme();
    };
  }, []);

  useEffect(() => {
    if (!userData?.uid) return;

    const unsubscribe = onSnapshot(
      collection(db, "notifications"),
      (snapshot) => {
        const notifications = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        const unreadCount = notifications.filter(
          (notification) =>
            canSeeNotification(notification) &&
            isNotificationUnread(notification)
        ).length;

        setNotificationCount(unreadCount);
      },
      (error) => {
        console.error("Notification sync error:", error);
      }
    );

    return () => unsubscribe();
  }, [userData]);

  useEffect(() => {
  if (!userData?.uid) {
    setShowSuspendedAlert(false);
    return;
  }
  if (isCurrentAccountDisabled()) {
  setShowSuspendedAlert(false);
  return;
}

  if (!isCurrentUserSuspended()) {
    setShowSuspendedAlert(false);
    return;
  }

  const alreadySeen =
    typeof window !== "undefined" &&
    sessionStorage.getItem(getSuspensionStorageKey()) === "yes";

if (!alreadySeen && rejectedRequestAlerts.length === 0) {
  setShowSuspendedAlert(true);
}
}, [
  userData?.uid,
  userData?.role,
  userData?.canBorrow,
  userData?.suspendedUntil,
  userData?.suspensionReason,
  rejectedRequestAlerts.length,
]);
useEffect(() => {
  if (
    userData?.role !== "borrower" ||
    !userData?.uid ||
    isCurrentAccountDisabled()
  ) {
    previousSuspendedStateRef.current = false;
    setShowBorrowingRestoredAlert(false);
    return;
  }

  const currentlySuspended = isCurrentUserSuspended();

  if (currentlySuspended) {
    previousSuspendedStateRef.current = true;
    return;
  }

  if (previousSuspendedStateRef.current) {
    const alreadySeen =
      typeof window !== "undefined" &&
      sessionStorage.getItem(getBorrowingRestoredStorageKey()) === "yes";

    if (!alreadySeen) {
      setShowBorrowingRestoredAlert(true);
    }

    previousSuspendedStateRef.current = false;
  }
}, [
  userData?.uid,
  userData?.role,
  userData?.canBorrow,
  userData?.suspendedUntil,
  suspensionClock,
]);

useEffect(() => {
  if (!userData?.uid) {
    setShowAccountDisabledAlert(false);
    return;
  }

  if (isCurrentAccountDisabled()) {
    setShowAccountDisabledAlert(true);
    setShowSuspendedAlert(false);
    setShowBorrowingRestoredAlert(false);
    return;
  }

  setShowAccountDisabledAlert(false);
}, [userData?.uid, userData?.isActive]);

useEffect(() => {
  if (userData?.role !== "borrower") return;

  const suspendedUntilDate = getSuspendedUntilDate(userData?.suspendedUntil);

  if (!suspendedUntilDate) return;

  const delay = suspendedUntilDate.getTime() - Date.now();

  if (delay <= 0) {
    setSuspensionClock(Date.now());
    return;
  }

  const timer = window.setTimeout(() => {
    setSuspensionClock(Date.now());
  }, Math.min(delay + 1000, 2147483647));

  return () => window.clearTimeout(timer);
}, [userData?.role, userData?.suspendedUntil]);

  useEffect(() => {
  if (!isAdmin || !userData?.uid) {
    setAdminBorrowRequestAlerts([]);
    return;
  }

  const unsubscribe = onSnapshot(
    collection(db, "borrowRequests"),
    (snapshot) => {
      const seenIds = getSeenAdminBorrowAlertIds();

      const newPendingAlerts = snapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((request) => {
          return (
            request.approvalStatus === "Pending" &&
            canSeeBorrowRequestAlert(request) &&
            !seenIds.has(request.id)
          );
        })
        .sort((a, b) => {
          const aPriority = isFacultyBorrowRequest(a) ? 0 : 1;
          const bPriority = isFacultyBorrowRequest(b) ? 0 : 1;

          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }

          return getBorrowRequestCreatedTime(b) - getBorrowRequestCreatedTime(a);
        });

      setAdminBorrowRequestAlerts(newPendingAlerts);
    },
    (error) => {
      console.error("Borrow request alert sync error:", error);
    }
  );

  return () => unsubscribe();
}, [
  isAdmin,
  isSuperAdmin,
  isCategoryAdmin,
  userData?.uid,
  userData?.role,
  userData?.assignedCategories,
]);

useEffect(() => {
  if (userData?.role !== "borrower") {
    setRejectedRequestAlerts([]);
    return;
  }

  const userId = auth.currentUser?.uid || userData?.uid;

  if (!userId) return;

  checkRejectedRequestAlerts(userId);
}, [userData?.role, userData?.uid]);

useEffect(() => {
  if (userData?.role !== "borrower") {
    setClaimItemAlerts([]);
    return;
  }

  const userId = auth.currentUser?.uid || userData?.uid;

  if (!userId) {
    setClaimItemAlerts([]);
    return;
  }

  const requestQuery = query(
    collection(db, "borrowRequests"),
    where("borrowerId", "==", userId)
  );

  const unsubscribe = onSnapshot(
    requestQuery,
    (snapshot) => {
      const approvedClaimRequests = snapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((request) => {
          const remainingMs = getApprovedPickupRemainingMs(request);

          return (
            request.approvalStatus === "Approved" &&
            remainingMs !== null &&
            remainingMs > 0
          );
        })
        .sort(
          (a, b) =>
            getApprovedPickupRemainingMs(a) -
            getApprovedPickupRemainingMs(b)
        );

      setClaimItemAlerts(approvedClaimRequests);
    },
    (error) => {
      console.error("Approved claim alert sync error:", error);
    }
  );

  return () => unsubscribe();
}, [userData?.role, userData?.uid]);

useEffect(() => {
  const activeGroupName = getActiveSidebarGroupName();

  /*
    Notifications and Settings are topbar/profile pages, not sidebar modules.
    When those pages are opened, close all sidebar dropdown groups.
  */
  if (!activeGroupName) {
    setOpenSidebarGroups(CLOSED_SIDEBAR_GROUPS);
    return;
  }

  setOpenSidebarGroups({
    ...CLOSED_SIDEBAR_GROUPS,
    [activeGroupName]: true,
  });
}, [activeSidebarPath]);

useEffect(() => {
  setProfileDropdownOpen(false);
}, [location.pathname]);

function handleToggleTheme() {
  const nextTheme = themeMode === "dark" ? "light" : "dark";

  setThemeMode(nextTheme);
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem("qborrowTheme", nextTheme);
}

function handleLogout() {
  if (loggingOut) return;

  setProfileDropdownOpen(false);

  if (typeof window !== "undefined" && window.innerWidth <= 820) {
    setSidebarOpen(false);
  }

  setShowLogoutConfirm(true);
}

function closeLogoutConfirm() {
  if (loggingOut) return;
  setShowLogoutConfirm(false);
}

async function confirmLogout() {
  if (loggingOut) return;

  setLoggingOut(true);

  try {
    await signOut(auth);
    resetPublicPagesToLightTheme();
    setShowLogoutConfirm(false);
    navigate("/");
  } catch (error) {
    showActionError("Logout failed", error);
  } finally {
    setLoggingOut(false);
  }
}

  const sharedLinks = [
    {
      label: "Dashboard",
      icon: "/icons/dashboard.png",
      fallbackIcon: "⌂",
      path: "/dashboard",
    },
    {
      label: "View Items",
      icon: "/icons/items.png",
      fallbackIcon: "□",
      path: "/items",
    },
  ];

  const borrowerLinks = [
    {
      label: "Scan QR Code",
      icon: "/icons/scan.png",
      fallbackIcon: "⌗",
      path: "/scan-qr",
    },
    {
      label: "My Borrow Requests",
      icon: "/icons/requests.png",
      fallbackIcon: "▣",
      path: "/my-requests",
    },
  ];

  const adminLinks = [
    {
      label: "Add Item",
      icon: "/icons/add-item.png",
      fallbackIcon: "+",
      path: "/add-item",
    },
    {
      label: "Manage Requests",
      icon: "/icons/manage.png",
      fallbackIcon: "✓",
      path: "/manage-requests",
    },
    {
      label: "Release Item",
      icon: "/icons/scan.png",
      fallbackIcon: "↗",
      path: "/release-item",
    },
    {
      label: "Return Confirmation",
      icon: "/icons/return.png",
      fallbackIcon: "↩",
      path: "/return-confirmation",
    },
  ];


  const reportsLinks = [
    {
      label: "Reports Dashboard",
      icon: "/icons/reports.png",
      fallbackIcon: "▦",
      path: "/reports",
    },
    {
      label: "Frequently Borrowed Items",
      icon: "/icons/items.png",
      fallbackIcon: "★",
      path: "/reports?module=frequentlyBorrowed",
    },
    {
      label: "Borrowing History",
      icon: "/icons/requests.png",
      fallbackIcon: "H",
      path: "/reports?module=borrowingHistory",
    },
    {
      label: "Late / Overdue Returns",
      icon: "/icons/return.png",
      fallbackIcon: "!",
      path: "/reports?module=overdueItems",
    },
    {
      label: "Damaged/Lost Items",
      icon: "/icons/reports.png",
      fallbackIcon: "DL",
      path: "/reports?module=damagedLostItems",
    },
  ];

  const superAdminLinks = [
  {
    label: "User Management",
    icon: "/icons/manage.png",
    fallbackIcon: "◎",
    path: "/user-management",
  },
  {
    label: "Add New User",
    icon: "/icons/add-item.png",
    fallbackIcon: "+",
    path: "/user-management?tool=create",
  },
  {
    label: "Manage Item Categories",
    icon: "/icons/manage.png",
    fallbackIcon: "C",
    path: "/user-management?tool=categories",
  },
  {
    label: "Import CSV",
    icon: "/icons/reports.png",
    fallbackIcon: "CSV",
    path: "/user-management?tool=import",
  },
];

function getActiveSidebarGroupName() {
  if (["/dashboard", "/items"].includes(activeSidebarPath)) {
    return "dashboard";
  }

  if (["/scan-qr", "/my-requests"].includes(activeSidebarPath)) {
    return "borrower";
  }

  if (
    [
      "/add-item",
      "/manage-requests",
      "/release-item",
      "/return-confirmation",
    ].includes(activeSidebarPath)
  ) {
    return "admin";
  }

  if (activeSidebarPath === "/reports") {
    return "reports";
  }

  if (activeSidebarPath === "/user-management") {
    return "userManagement";
  }

  return "";
}

/*
  Sidebar behavior:
  - The group for the current page stays open.
  - Opening another group for preview does not close the current page group.
  - When the user actually navigates to another page, the active group changes.
*/
function toggleSidebarGroup(groupName) {
  setOpenSidebarGroups((previousGroups) => {
    const activeGroupName = getActiveSidebarGroupName();
    const willOpenGroup = previousGroups[groupName] !== true;

    const nextGroups = {
      ...CLOSED_SIDEBAR_GROUPS,
    };

    if (activeGroupName && activeGroupName !== groupName) {
      nextGroups[activeGroupName] = true;
    }

    nextGroups[groupName] = willOpenGroup;

    return nextGroups;
  });
}

function isSidebarLinkActive(link) {
  const currentFullPath = `${location.pathname}${location.search || ""}`;
  const isQueryLink = link.path.includes("?");

  return isQueryLink
    ? currentFullPath === link.path
    : link.path === "/user-management"
    ? location.pathname === "/user-management" && !location.search
    : link.path === "/reports"
    ? location.pathname === "/reports" && !location.search
    : activeSidebarPath === link.path;
}

function renderNavLink(link) {
  const isActive = isSidebarLinkActive(link);

  return (
    <button
      type="button"
      key={link.label}
      className={isActive ? "app-nav-link active" : "app-nav-link"}
      onClick={() => guardedNavigate(link.path)}
    >
      <span className="app-nav-icon">
        <img
          src={link.icon}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
            event.currentTarget.nextElementSibling.style.display = "grid";
          }}
        />

        <span className="app-nav-fallback-icon">
          {link.fallbackIcon || "•"}
        </span>
      </span>

      <span className="app-nav-text">{link.label}</span>
    </button>
  );
}

function renderSidebarGroup({ groupName, title, icon, links }) {
  const isOpen = openSidebarGroups[groupName] === true;
  const hasActiveChild = links.some(isSidebarLinkActive);

  return (
    <section
      className={`app-nav-group app-sidebar-section ${
        isOpen ? "open" : "closed"
      } ${hasActiveChild ? "active" : ""}`}
      key={groupName}
    >
      <button
        type="button"
        className="app-nav-parent-link app-sidebar-section-toggle"
        onClick={() => toggleSidebarGroup(groupName)}
        aria-expanded={isOpen}
      >
        <span className="app-nav-icon app-nav-group-icon">
          <span>{icon}</span>
        </span>

        <span className="app-nav-text">{title}</span>

        <span className="app-nav-chevron" aria-hidden="true"></span>
      </button>

      {isOpen && (
        <div className="app-nav-submenu app-sidebar-section-list">
          {links.map(renderNavLink)}
        </div>
      )}
    </section>
  );
}

  const claimItemAlertCount = claimItemAlerts.length;
  const showClaimItemIndicator = isBorrower && claimItemAlertCount > 0;

  if (loading) {
    return (
      <div className="layout-loading">
        <div className="layout-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading QBorrow...</h2>
          <p>Checking your assigned role and permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`app-layout ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
    >
      <aside className="app-sidebar">
        <div className="app-sidebar-top">
          <button
            type="button"
            className="app-sidebar-brand"
            onClick={() => guardedNavigate("/dashboard")}
            aria-label="Go to dashboard"
          >
            <span className="app-brand-logo">
              <img src="/qborrow-logo.png" alt="" />
            </span>

<span className="app-sidebar-brand-text">
  <strong>QBorrow</strong>
</span>
          </button>

          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label="Hide sidebar"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        <nav className="app-sidebar-nav" aria-label="Application navigation">
          {renderSidebarGroup({
            groupName: "dashboard",
            title: "Dashboard",
            icon: "⌂",
            links: sharedLinks,
          })}

          {isBorrower &&
            renderSidebarGroup({
              groupName: "borrower",
              title: "Borrowing",
              icon: "◇",
              links: borrowerLinks,
            })}

          {isAdmin &&
            renderSidebarGroup({
              groupName: "admin",
              title: "Admin Menu",
              icon: "⚙",
              links: adminLinks,
            })}

          {isAdmin &&
            renderSidebarGroup({
              groupName: "reports",
              title: "Reports",
              icon: "▤",
              links: reportsLinks,
            })}

          {isSuperAdmin &&
            renderSidebarGroup({
              groupName: "userManagement",
              title: "User Management",
              icon: "◎",
              links: superAdminLinks,
            })}
        </nav>

              </aside>

{sidebarOpen && (
  <button
    type="button"
    className="app-sidebar-backdrop"
    onClick={() => setSidebarOpen(false)}
    aria-label="Close sidebar overlay"
  />
)}

{showLogoutConfirm && (
  <div
    className="app-logout-confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="logout-confirm-title"
    onClick={closeLogoutConfirm}
  >
    <section
      className="app-logout-confirm-card"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="app-logout-confirm-icon">↪</div>

      <div className="app-logout-confirm-text">
        <p>Logout Confirmation</p>

        <h2 id="logout-confirm-title">Are you sure you want to logout?</h2>

        <span>
          You will be returned to the landing page and will need to sign in again
          to access QBorrow.
        </span>
      </div>

      <div className="app-logout-confirm-actions">
        <button
          type="button"
          className="app-logout-confirm-cancel"
          onClick={closeLogoutConfirm}
          disabled={loggingOut}
        >
          Cancel
        </button>

        <button
          type="button"
          className="app-logout-confirm-yes"
          onClick={confirmLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Logging out..." : "Yes, Logout"}
        </button>
      </div>
    </section>
  </div>
)}
{rejectedRequestAlerts.length > 0 && (
  <div
    className="app-rejected-alert-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rejected-request-alert-title"
  >
    <section className="app-rejected-alert-card">
      <div className="app-rejected-alert-icon">!</div>

      <div className="app-rejected-alert-content">
        <p>Borrow Request Update</p>

        <h2 id="rejected-request-alert-title">
          Your borrow request has been rejected
        </h2>

        <span>
          Please review the rejected request below before continuing to use the
          system.
        </span>
      </div>

      <div className="app-rejected-alert-list">
        {rejectedRequestAlerts.map((request) => (
          <div className="app-rejected-alert-item" key={request.id}>
            <strong>{request.itemName || "Untitled Item"}</strong>
            <p>{getRejectedRequestReason(request)}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="app-rejected-alert-ok"
        onClick={handleAcknowledgeRejectedRequests}
        disabled={acknowledgingRejectedAlerts}
      >
        {acknowledgingRejectedAlerts ? "Closing..." : "OK, I Understand"}
      </button>
    </section>
  </div>
)}

{showBorrowingRestoredAlert && (
  <div
    className="app-restored-alert-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="restored-alert-title"
  >
    <section className="app-restored-alert-card">
      <div className="app-restored-alert-icon">✓</div>

      <div className="app-restored-alert-content">
        <p>Borrowing Restored</p>

        <h2 id="restored-alert-title">
          Your borrowing access is now active
        </h2>

        <span>
          Your account is no longer suspended. You can now submit borrow
          requests again.
        </span>
      </div>

      <button
        type="button"
        className="app-restored-alert-ok"
        onClick={handleCloseBorrowingRestoredAlert}
      >
        OK, I Understand
      </button>
    </section>
  </div>
)}

{showAccountDisabledAlert && (
  <div
    className="app-disabled-alert-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="disabled-alert-title"
  >
    <section className="app-disabled-alert-card">
      <div className="app-disabled-alert-icon">!</div>

      <div className="app-disabled-alert-content">
        <p>Account Disabled</p>

        <h2 id="disabled-alert-title">
          Your account has been disabled
        </h2>

        <span>
          You can no longer use QBorrow at this time. Please contact the
          administrator for assistance.
        </span>
      </div>

      <button
        type="button"
        className="app-disabled-alert-ok"
        onClick={handleCloseAccountDisabledAlert}
      >
        OK, Logout
      </button>
    </section>
  </div>
)}

{showSuspendedAlert && (
  <div
    className="app-suspended-alert-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="suspended-alert-title"
  >
    <section className="app-suspended-alert-card">
      <div className="app-suspended-alert-icon">!</div>

      <div className="app-suspended-alert-content">
        <p>Borrowing Suspended</p>

        <h2 id="suspended-alert-title">
          Your account is temporarily suspended
        </h2>

        <span>
          You cannot submit new borrow requests until {getSuspendedUntilLabel()}.
        </span>
      </div>

      <div className="app-suspended-alert-reason">
        <span>Reason</span>
        <strong>{getSuspensionReason()}</strong>
      </div>

      <button
        type="button"
        className="app-suspended-alert-ok"
        onClick={handleCloseSuspendedAlert}
      >
        OK, I Understand
      </button>
    </section>
  </div>
)}

{adminBorrowRequestAlerts.length > 0 && (
  <div
    className="app-admin-request-alert-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="admin-request-alert-title"
  >
    <section className="app-admin-request-alert-card">
      <div className="app-admin-request-alert-icon">
        {isFacultyBorrowRequest(adminBorrowRequestAlerts[0]) ? "★" : "!"}
      </div>

      <div className="app-admin-request-alert-content">
        <p>
          {isFacultyBorrowRequest(adminBorrowRequestAlerts[0])
            ? "Priority Faculty Request"
            : "New Borrow Request"}
        </p>

        <h2 id="admin-request-alert-title">
          Someone sent a borrow request
        </h2>

        <span>
          Review this request before continuing with other admin tasks.
        </span>
      </div>

      <div className="app-admin-request-alert-item">
        <span>Item</span>
        <strong>
          {adminBorrowRequestAlerts[0].itemName || "Untitled Item"}
        </strong>

        <p>
          {adminBorrowRequestAlerts[0].borrowerName ||
            adminBorrowRequestAlerts[0].borrowerEmail ||
            "Borrower"}{" "}
          requested this item.
        </p>
      </div>

      <div className="app-admin-request-alert-grid">
        <div>
          <span>Borrower Type</span>
          <strong>
            {adminBorrowRequestAlerts[0].borrowerUserType || "Student"}
          </strong>
        </div>

        <div>
          <span>Category</span>
          <strong>{getRequestCategoryName(adminBorrowRequestAlerts[0])}</strong>
        </div>

        <div>
          <span>Borrow Date</span>
          <strong>{adminBorrowRequestAlerts[0].borrowDate || "Not set"}</strong>
        </div>

        <div>
          <span>Expected Return</span>
          <strong>
            {adminBorrowRequestAlerts[0].expectedReturnDate || "Not set"}
          </strong>
        </div>
      </div>

      {adminBorrowRequestAlerts.length > 1 && (
        <div className="app-admin-request-alert-more">
          +{adminBorrowRequestAlerts.length - 1} more new request
          {adminBorrowRequestAlerts.length - 1 === 1 ? "" : "s"} waiting.
        </div>
      )}

      <div className="app-admin-request-alert-actions">
        <button
          type="button"
          className="app-admin-request-alert-secondary"
          onClick={handleDismissAdminBorrowRequestAlert}
        >
          OK
        </button>

        <button
          type="button"
          className="app-admin-request-alert-primary"
          onClick={handleViewAdminBorrowRequestAlert}
        >
          View Request
        </button>
      </div>
    </section>
  </div>
)}

{pendingNavigationPath && (
  <div
    className="app-logout-confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="unsaved-changes-title"
    onClick={cancelPendingNavigation}
  >
    <section
      className="app-logout-confirm-card"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="app-logout-confirm-icon">!</div>

      <div className="app-logout-confirm-text">
        <p>Unsaved Changes</p>

        <h2 id="unsaved-changes-title">You have unsaved changes.</h2>

        <span>{unsavedChangesMessage}</span>
      </div>

      <div className="app-logout-confirm-actions">
        <button
          type="button"
          className="app-logout-confirm-cancel"
          onClick={cancelPendingNavigation}
        >
          No, Stay Here
        </button>

        <button
          type="button"
          className="app-logout-confirm-yes"
          onClick={confirmPendingNavigation}
        >
          Yes, Leave Page
        </button>
      </div>
    </section>
  </div>
)}

<main className="app-main-content">
        <header className="app-topbar">
          <div className="app-topbar-left">
            {!sidebarOpen && (
              <button
                type="button"
                className="app-topbar-menu-btn"
                onClick={() => setSidebarOpen(true)}
                aria-label="Show sidebar"
              >
                <span></span>
                <span></span>
                <span></span>
              </button>
            )}

<div className="app-topbar-title" aria-label="System name">
  <h3>QR-Based Digital Borrowing System</h3>
</div>
          </div>

<div className="app-topbar-right">
  {showClaimItemIndicator && (
    <button
      type="button"
      className="app-claim-topbar-btn"
      onClick={() => guardedNavigate("/my-requests")}
      aria-label="Approved item waiting to be claimed"
      title={getClaimItemTooltip()}
    >
      <span className="app-claim-topbar-icon" aria-hidden="true">📦</span>
      <span className="app-claim-topbar-text">Claim Item</span>
      <strong>{claimItemAlertCount > 99 ? "99+" : claimItemAlertCount}</strong>
    </button>
  )}

  {showBorrowingSuspendedIndicator && (
    <div
      className="app-suspended-topbar-wrap"
      aria-label="Borrowing access restricted"
    >
      <button
        type="button"
        className="app-suspended-topbar-icon"
        onClick={handleViewBorrowingRestriction}
        aria-describedby="suspended-topbar-tooltip"
        title={getBorrowingRestrictionTooltip()}
      >
        !
      </button>

      <div
        id="suspended-topbar-tooltip"
        className="app-suspended-topbar-tooltip"
        role="tooltip"
      >
        {getBorrowingRestrictionTooltip()}
      </div>
    </div>
  )}

  <button
    type="button"
    className="app-topbar-theme-toggle"
    onClick={handleToggleTheme}
    aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    title={themeMode === "dark" ? "Light mode" : "Dark mode"}
  >
    <span aria-hidden="true">{themeMode === "dark" ? "☀" : "☾"}</span>
  </button>

  <button
    type="button"
    className="app-topbar-notification"
    onClick={() => guardedNavigate("/notifications")}
    aria-label="Open notifications"
  >
    <span className="app-topbar-notification-icon">!</span>
    <span>Notifications</span>

    {notificationCount > 0 && (
      <strong>{notificationCount > 99 ? "99+" : notificationCount}</strong>
    )}
  </button>

  <div className="app-profile-menu-wrap">
    <button
      type="button"
      className={`app-profile-pill ${
        profileDropdownOpen ? "profile-open" : ""
      }`}
      onClick={() => setProfileDropdownOpen((current) => !current)}
      aria-haspopup="menu"
      aria-expanded={profileDropdownOpen}
    >
      <div className="app-profile-pill-avatar">
        {userData?.photoURL ? (
          <img src={userData.photoURL} alt={userData.fullName || "Profile"} />
        ) : (
          <span>{getInitials(userData?.fullName, userData?.email)}</span>
        )}
      </div>

      <div className="app-profile-pill-text">
        <strong>{userData?.fullName || "QBorrow User"}</strong>
        <span>
          <i></i>
          {roleLabel}
        </span>
      </div>

      <span className="app-profile-pill-arrow">
        {profileDropdownOpen ? "⌃" : "⌄"}
      </span>
    </button>

    {profileDropdownOpen && (
      <>
        <button
          type="button"
          className="app-profile-menu-backdrop"
          onClick={() => setProfileDropdownOpen(false)}
          aria-label="Close profile menu"
        />

        <div className="app-profile-menu" role="menu">
          <div className="app-profile-menu-header">
            <strong>{userData?.fullName || "QBorrow User"}</strong>
            <span>{userData?.email || "No email"}</span>
            <p>{roleLabel}</p>
          </div>

          <button
            type="button"
            className="app-profile-menu-item"
            onClick={() => {
              setProfileDropdownOpen(false);
              guardedNavigate("/settings");
            }}
            role="menuitem"
          >
            <span>♙</span>
            <strong>My Profile</strong>
          </button>

          <button
            type="button"
            className="app-profile-menu-item logout"
            onClick={handleLogout}
            role="menuitem"
          >
            <span>↪</span>
            <strong>Logout</strong>
          </button>
        </div>
      </>
    )}
  </div>
</div>
        </header>

        <div className="app-page-content">
          {schoolClosed && (
            <div className="app-school-closed-banner" role="alert">
              <div>
                <span>School Closure Mode</span>
                <strong>{schoolClosureMessage}</strong>
                <p>
                  Borrowing, item claiming, and return confirmation are paused until the
                  system is reopened by the super admin.
                </p>
              </div>

              <small>
                Updated: {getDateLabel(schoolStatus?.updatedAt || schoolStatus?.closedAt)}
              </small>
            </div>
          )}

          <Outlet
  context={{
    userData,
    schoolStatus,
    schoolClosed,
    schoolClosureMessage,
    setUnsavedChanges,
    guardedNavigate,
  }}
/>
        </div>
      </main>
    </div>
  );
}

export default AppLayout;