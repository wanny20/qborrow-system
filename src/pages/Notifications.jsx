import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  query,
  orderBy,
  limit as firestoreLimit,
  startAfter,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import ConfirmActionModal from "../components/ConfirmActionModal.jsx";
import "../styles/Notifications.css";

const NOTIFICATIONS_PAGE_SIZE = 10;
const NOTIFICATIONS_FETCH_BATCH_SIZE = 25;
const MAX_NOTIFICATION_FETCH_LOOPS = 8;

function Notifications() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { showToast } = useToast();

  const [notifications, setNotifications] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserData, setCurrentUserData] = useState(
    outletContext?.userData || null
  );

  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [filter, setFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastVisibleNotificationDoc, setLastVisibleNotificationDoc] =
    useState(null);
  const [hasMoreNotificationPages, setHasMoreNotificationPages] =
    useState(true);
  const [loadingMoreNotifications, setLoadingMoreNotifications] =
    useState(false);
const [statusMessage, setStatusMessage] = useState("");
const [statusType, setStatusType] = useState("");
const [selectedNotification, setSelectedNotification] = useState(null);
const notificationActionLockRef = useRef("");
const notificationFetchRequestRef = useRef(0);
const initialNotificationsLoadedRef = useRef(false);
const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

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

  function startNotificationAction(actionId) {
  if (notificationActionLockRef.current || actionLoadingId) {
    return false;
  }

  notificationActionLockRef.current = actionId;
  setActionLoadingId(actionId);

  return true;
  }

  function finishNotificationAction() {
    notificationActionLockRef.current = "";
    setActionLoadingId("");
  }

  function isNotificationActionBusy() {
    return Boolean(notificationActionLockRef.current || actionLoadingId);
  }
  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getNotificationTime(notification) {
    if (notification.createdAt?.toMillis) {
      return notification.createdAt.toMillis();
    }

    if (notification.createdAt?.seconds) {
      return notification.createdAt.seconds * 1000;
    }

    return 0;
  }

  function formatDate(notification) {
    const time = getNotificationTime(notification);

    if (!time) return "No date";

    return new Date(time).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function canSeeNotification(notification, userData, user) {
    if (!user) return false;

    const role = userData?.role || "borrower";
    const uid = user.uid;

    if (notification.userId === uid) {
      return true;
    }

    if (role === "superAdmin") {
      return (
        notification.userId === "" ||
        notification.targetRole === "superAdmin" ||
        notification.targetRole === "categoryAdmin" ||
        notification.targetRole === "admin" ||
        notification.targetRole === "all"
      );
    }

    if (role === "categoryAdmin") {
      const targetRole = notification.targetRole || "";
      const isAdminNotification =
        targetRole === "categoryAdmin" ||
        targetRole === "admin" ||
        targetRole === "all";

      if (!isAdminNotification) return false;

      const notificationCategoryId = normalizeText(notification.categoryId);
      const notificationCategoryName = normalizeText(notification.categoryName);

      if (!notificationCategoryId && !notificationCategoryName) {
        return true;
      }

      const assignedCategories = Array.isArray(userData?.assignedCategories)
        ? userData.assignedCategories.map(normalizeText)
        : [];

      return (
        assignedCategories.includes(notificationCategoryId) ||
        assignedCategories.includes(notificationCategoryName)
      );
    }

    return false;
  }

  function isNotificationReadForUser(notification, user) {
    const uid = user?.uid;

    if (!uid) return false;

    if (notification.userId === uid) {
      return notification.status === "Read";
    }

    if (Array.isArray(notification.readBy)) {
      return notification.readBy.includes(uid);
    }

    return notification.status === "Read";
  }

  function isNotificationRead(notification) {
    return isNotificationReadForUser(notification, currentUser);
  }

  function doesNotificationMatchSearch(notification, activeSearchTerm) {
    const cleanedSearchTerm = normalizeText(activeSearchTerm);

    if (!cleanedSearchTerm) return true;

    const searchableText = `
      ${notification.title || ""}
      ${notification.message || ""}
      ${notification.targetRole || ""}
      ${notification.categoryId || ""}
      ${notification.categoryName || ""}
      ${notification.status || ""}
    `.toLowerCase();

    return searchableText.includes(cleanedSearchTerm);
  }

  function doesNotificationMatchFilter(notification, activeFilter, user) {
    const read = isNotificationReadForUser(notification, user);

    return (
      activeFilter === "All" ||
      (activeFilter === "Unread" && !read) ||
      (activeFilter === "Read" && read)
    );
  }

  function doesNotificationMatchActiveView(
    notification,
    activeFilter,
    activeSearchTerm,
    user
  ) {
    return (
      doesNotificationMatchFilter(notification, activeFilter, user) &&
      doesNotificationMatchSearch(notification, activeSearchTerm)
    );
  }

  function isNotificationDeletedForUser(notification, user) {
  if (!user) return false;

  return (
    Array.isArray(notification.deletedBy) &&
    notification.deletedBy.includes(user.uid)
  );
}

  async function loadUserData(user) {
    if (outletContext?.userData) {
      return {
        uid: user.uid,
        email: user.email,
        ...outletContext.userData,
      };
    }

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return {
        uid: user.uid,
        email: user.email,
        role: "borrower",
      };
    }

    return {
      id: userSnap.id,
      uid: user.uid,
      email: user.email,
      ...userSnap.data(),
    };
  }

async function fetchNotifications(user, userData, options = {}) {
  const {
    reset = false,
    showSuccessToast = false,
    loadMore = false,
    filterOverride,
    searchOverride,
  } = options;

  if (loadMore && !hasMoreNotificationPages) return;

  const activeFilter = filterOverride ?? filter;
  const activeSearchTerm = searchOverride ?? searchTerm;

  notificationFetchRequestRef.current += 1;
  const requestId = notificationFetchRequestRef.current;

  if (loadMore) {
    setLoadingMoreNotifications(true);
  } else {
    setLoading(true);
  }

  try {
    let cursorDocument = reset ? null : lastVisibleNotificationDoc;
    let nextCursorDocument = cursorDocument;
    let reachedEnd = false;
    let fetchLoopCount = 0;
    let matchedVisibleCount = 0;

    const knownNotificationIds = new Set(
      loadMore && !reset ? notifications.map((notification) => notification.id) : []
    );

    const nextVisibleNotifications = [];

    while (
      matchedVisibleCount < NOTIFICATIONS_PAGE_SIZE &&
      !reachedEnd &&
      fetchLoopCount < MAX_NOTIFICATION_FETCH_LOOPS
    ) {
      const notificationQueryConstraints = [orderBy("createdAt", "desc")];

      if (nextCursorDocument) {
        notificationQueryConstraints.push(startAfter(nextCursorDocument));
      }

      notificationQueryConstraints.push(
        firestoreLimit(NOTIFICATIONS_FETCH_BATCH_SIZE)
      );

      const notificationsQuery = query(
        collection(db, "notifications"),
        ...notificationQueryConstraints
      );

      const querySnapshot = await getDocs(notificationsQuery);

      if (querySnapshot.empty) {
        reachedEnd = true;
        break;
      }

      const fetchedDocs = querySnapshot.docs;
      nextCursorDocument = fetchedDocs[fetchedDocs.length - 1];

      if (fetchedDocs.length < NOTIFICATIONS_FETCH_BATCH_SIZE) {
        reachedEnd = true;
      }

      const visibleBatch = fetchedDocs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter(
          (notification) =>
            canSeeNotification(notification, userData, user) &&
            !isNotificationDeletedForUser(notification, user)
        )
        .filter((notification) => {
          if (knownNotificationIds.has(notification.id)) return false;

          knownNotificationIds.add(notification.id);
          return true;
        });

      nextVisibleNotifications.push(...visibleBatch);

      matchedVisibleCount += visibleBatch.filter((notification) =>
        doesNotificationMatchActiveView(
          notification,
          activeFilter,
          activeSearchTerm,
          user
        )
      ).length;

      fetchLoopCount += 1;
    }

    if (requestId !== notificationFetchRequestRef.current) {
      return;
    }

    setNotifications((previousNotifications) => {
      if (reset || !loadMore) {
        return nextVisibleNotifications.sort(
          (a, b) => getNotificationTime(b) - getNotificationTime(a)
        );
      }

      const notificationMap = new Map();

      [...previousNotifications, ...nextVisibleNotifications].forEach(
        (notification) => {
          notificationMap.set(notification.id, notification);
        }
      );

      return Array.from(notificationMap.values()).sort(
        (a, b) => getNotificationTime(b) - getNotificationTime(a)
      );
    });

    setLastVisibleNotificationDoc(nextCursorDocument);
    setHasMoreNotificationPages(!reachedEnd);

    if (showSuccessToast) {
      showToast("Notifications refreshed", "success");
    }
  } catch (error) {
    showActionError("Failed to load notifications", error);
  } finally {
    if (requestId !== notificationFetchRequestRef.current) {
      return;
    }

    if (loadMore) {
      setLoadingMoreNotifications(false);
    } else {
      setLoading(false);
    }
  }
}

async function handleOpenNotification(notification) {
  if (!currentUser) {
  showBlockedAction("Please login first.");
  return;
}

  setSelectedNotification(notification);

  if (isNotificationRead(notification)) {
    return;
  }

  const actionId = `open-${notification.id}`;
  const started = startNotificationAction(actionId);

  if (!started) return;

  showStatus("", "");

  try {
    const notificationRef = doc(db, "notifications", notification.id);
    const latestNotificationSnap = await getDoc(notificationRef);

    if (!latestNotificationSnap.exists()) {
      setSelectedNotification(null);

      setNotifications((previousNotifications) =>
        previousNotifications.filter((item) => item.id !== notification.id)
      );

      showBlockedAction("This notification no longer exists.");
      return;
    }

    if (notification.userId === currentUser.uid) {
      await updateDoc(notificationRef, {
        status: "Read",
        readAt: serverTimestamp(),
      });

      const updatedNotification = {
        ...notification,
        status: "Read",
      };

      setSelectedNotification(updatedNotification);

      setNotifications((previousNotifications) =>
        previousNotifications.map((item) =>
          item.id === notification.id ? { ...item, status: "Read" } : item
        )
      );

      return;
    }

    await updateDoc(notificationRef, {
      readBy: arrayUnion(currentUser.uid),
      lastReadAt: serverTimestamp(),
    });

    const updatedReadBy = Array.isArray(notification.readBy)
      ? [...new Set([...notification.readBy, currentUser.uid])]
      : [currentUser.uid];

    const updatedNotification = {
      ...notification,
      readBy: updatedReadBy,
    };

    setSelectedNotification(updatedNotification);

    setNotifications((previousNotifications) =>
      previousNotifications.map((item) =>
        item.id === notification.id
          ? {
              ...item,
              readBy: Array.isArray(item.readBy)
                ? [...new Set([...item.readBy, currentUser.uid])]
                : [currentUser.uid],
            }
          : item
      )
    );
  } catch (error) {
    showActionError("Failed to open notification", error);
  } finally {
    finishNotificationAction();
  }
}

async function handleMarkAllAsRead() {
  if (!currentUser) {
    showBlockedAction("Please login first.");
    return;
  }

  if (isNotificationActionBusy()) return;

  const unreadNotifications = filteredNotifications.filter(
    (notification) => !isNotificationRead(notification)
  );

  if (unreadNotifications.length === 0) {
    showToast("No Unread Notifications", "success");
    return;
  }

  openConfirmAction({
    title: "Mark All as Read?",
    message: `Mark ${unreadNotifications.length} notification(s) as read?`,
    confirmText: "Mark as Read",
    danger: false,
    onConfirm: async () => {
      const started = startNotificationAction("all");

      if (!started) return;

      try {
        showStatus("", "");

        await Promise.all(
          unreadNotifications.map((notification) => {
            const notificationRef = doc(db, "notifications", notification.id);

            if (notification.userId === currentUser.uid) {
              return updateDoc(notificationRef, {
                status: "Read",
                readAt: serverTimestamp(),
              });
            }

            return updateDoc(notificationRef, {
              readBy: arrayUnion(currentUser.uid),
              lastReadAt: serverTimestamp(),
            });
          })
        );

        setNotifications((previousNotifications) =>
          previousNotifications.map((notification) => {
            const shouldUpdate = unreadNotifications.some(
              (unread) => unread.id === notification.id
            );

            if (!shouldUpdate) return notification;

            if (notification.userId === currentUser.uid) {
              return {
                ...notification,
                status: "Read",
              };
            }

            return {
              ...notification,
              readBy: Array.isArray(notification.readBy)
                ? [...new Set([...notification.readBy, currentUser.uid])]
                : [currentUser.uid],
            };
          })
        );

        showToast("Notifications Marked as Read", "success");
      } catch (error) {
        showActionError("Failed to mark notifications as read", error);
      } finally {
        finishNotificationAction();
      }
    },
  });
}

async function handleDeleteAllNotifications() {
  if (!currentUser) {
    showBlockedAction("Please login first.");
    return;
  }

  if (isNotificationActionBusy()) return;

  if (filteredNotifications.length === 0) {
    showToast("No Notifications to Delete", "success");
    return;
  }

  const notificationsToDelete = [...filteredNotifications];

  openConfirmAction({
    title: "Delete Notifications?",
    message: `Delete ${notificationsToDelete.length} visible notification(s)? This action cannot be undone for your view.`,
    confirmText: "Delete Notifications",
    danger: true,
    onConfirm: async () => {
      const started = startNotificationAction("delete-all");

      if (!started) return;

      try {
        showStatus("", "");

        await Promise.all(
          notificationsToDelete.map((notification) => {
            const notificationRef = doc(db, "notifications", notification.id);

            if (notification.userId === currentUser.uid) {
              return deleteDoc(notificationRef);
            }

            return updateDoc(notificationRef, {
              deletedBy: arrayUnion(currentUser.uid),
              deletedAt: serverTimestamp(),
            });
          })
        );

        setNotifications((previousNotifications) =>
          previousNotifications.filter(
            (notification) =>
              !notificationsToDelete.some(
                (deletedNotification) =>
                  deletedNotification.id === notification.id
              )
          )
        );

        showToast("Notifications Deleted", "success");
      } catch (error) {
        showActionError("Failed to delete notifications", error);
      } finally {
        finishNotificationAction();
      }
    },
  });
}

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        showBlockedAction("Please login first.");
        navigate("/login");
        return;
      }

      setCurrentUser(user);

      try {
        const loadedUserData = await loadUserData(user);
        setCurrentUserData(loadedUserData);
        await fetchNotifications(user, loadedUserData, {
          reset: true,
          filterOverride: filter,
          searchOverride: searchTerm,
        });

        initialNotificationsLoadedRef.current = true;
      } catch (error) {
        showActionError("Failed to load notification page", error);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate, outletContext?.userData]);

useEffect(() => {
  if (!initialNotificationsLoadedRef.current || !currentUser || !currentUserData) {
    return undefined;
  }

  const debounceTimer = window.setTimeout(() => {
    fetchNotifications(currentUser, currentUserData, {
      reset: true,
      filterOverride: filter,
      searchOverride: searchTerm,
    });
  }, 300);

  return () => window.clearTimeout(debounceTimer);
}, [filter, searchTerm, currentUser, currentUserData]);

const filteredNotifications = useMemo(() => {
  return notifications
    .filter((notification) =>
      doesNotificationMatchActiveView(
        notification,
        filter,
        searchTerm,
        currentUser
      )
    )
    .sort((a, b) => getNotificationTime(b) - getNotificationTime(a));
}, [notifications, filter, searchTerm, currentUser]);

  const stats = useMemo(
    () => ({
      total: notifications.length,
      unread: notifications.filter(
        (notification) => !isNotificationRead(notification)
      ).length,
      read: notifications.filter((notification) =>
        isNotificationRead(notification)
      ).length,
      admin: notifications.filter(
        (notification) =>
          notification.targetRole === "categoryAdmin" ||
          notification.targetRole === "admin" ||
          notification.targetRole === "superAdmin"
      ).length,
    }),
    [notifications, currentUser]
  );
  const displayedNotifications = filteredNotifications;

  const canLoadMoreNotifications =
    hasMoreNotificationPages && !loadingMoreNotifications;

  const summaryScopeLabel = hasMoreNotificationPages
    ? "Loaded so far"
    : "Full total";

  const summaryHelperText = hasMoreNotificationPages
    ? "Load more to continue counting history."
    : "All available history is loaded.";

  function handleLoadMoreNotifications() {
    if (!currentUser || !currentUserData) {
      showBlockedAction("Please login first.");
      return;
    }

    fetchNotifications(currentUser, currentUserData, {
      loadMore: true,
      filterOverride: filter,
      searchOverride: searchTerm,
    });
  }

  if (loading) {
    return (
      <div className="notifications-loading">
        <div className="notifications-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading notifications...</h2>
          <p>Checking your latest QBorrow updates.</p>
        </div>
      </div>
    );
  }

return (
  <div className="notifications-page">
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

<section className="notifications-header notifications-header-compact">
  <div className="notifications-header-content">
<div className="notifications-header-text">
  <h1>Notifications</h1>

  <p>
    Track borrow request updates, approval results, release confirmations,
    return confirmations, and admin alerts in one place.
  </p>
</div>

    <button
      type="button"
      className="notifications-secondary-btn notifications-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
</section>

      {statusMessage && (
        <div
          className={`notifications-status notifications-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}
{selectedNotification && (
  <div
    className="notifications-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setSelectedNotification(null)}
  >
    <section
      className="notifications-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="notifications-modal-close"
        onClick={() => setSelectedNotification(null)}
        aria-label="Close notification details"
      >
        ×
      </button>

      <div className="notifications-modal-heading">
        <span>{formatDate(selectedNotification)}</span>

        <h2>{selectedNotification.title || "Untitled Notification"}</h2>

        <strong
          className={
            isNotificationRead(selectedNotification) ? "read" : "unread"
          }
        >
          {isNotificationRead(selectedNotification) ? "Read" : "Unread"}
        </strong>
      </div>

      <p className="notifications-modal-message">
        {selectedNotification.message || "No message provided."}
      </p>

      <div className="notifications-modal-grid">
        <div>
          <span>Target Role</span>
          <strong>{selectedNotification.targetRole || "Not specified"}</strong>
        </div>

        <div>
          <span>Category</span>
          <strong>
            {selectedNotification.categoryName ||
              selectedNotification.categoryId ||
              "Not specified"}
          </strong>
        </div>

        <div>
          <span>Status</span>
          <strong>
            {isNotificationRead(selectedNotification) ? "Read" : "Unread"}
          </strong>
        </div>

        <div>
          <span>Date Created</span>
          <strong>{formatDate(selectedNotification)}</strong>
        </div>
      </div>

      <div className="notifications-modal-actions">
        {selectedNotification.link && (
          <button
            type="button"
            className="notifications-primary-btn"
            onClick={() => navigate(selectedNotification.link)}
          >
            Go to Related Page
          </button>
        )}

        <button
          type="button"
          className="notifications-secondary-btn"
          onClick={() => setSelectedNotification(null)}
        >
          Close
        </button>
      </div>
    </section>
  </div>
)}
      <section className="notifications-summary-grid">
        <div>
          <span>Σ</span>
          <h3>{stats.total}</h3>
          <p>{summaryScopeLabel}</p>
          <small>Total notifications in the current loaded set.</small>
        </div>

        <div>
          <span>!</span>
          <h3>{stats.unread}</h3>
          <p>{hasMoreNotificationPages ? "Loaded Unread" : "Total Unread"}</p>
          <small>{summaryHelperText}</small>
        </div>

        <div>
          <span>✓</span>
          <h3>{stats.read}</h3>
          <p>{hasMoreNotificationPages ? "Loaded Read" : "Total Read"}</p>
          <small>{summaryHelperText}</small>
        </div>

        <div>
          <span>⚙</span>
          <h3>{stats.admin}</h3>
          <p>{hasMoreNotificationPages ? "Loaded Admin" : "Total Admin"}</p>
          <small>{summaryHelperText}</small>
        </div>
      </section>

      <section className="notifications-tools">
        <div>
          <label className="qb-label" htmlFor="notification-search">
            Search Notifications
          </label>

          <input
            id="notification-search"
            type="text"
            placeholder="Search title, message, category..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div>
          <label className="qb-label" htmlFor="notification-filter">
            Status
          </label>

          <select
            id="notification-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="All">All Notifications</option>
            <option value="Unread">Unread Only</option>
            <option value="Read">Read Only</option>
          </select>
        </div>

        <button
          type="button"
          className="notifications-refresh-btn"
          onClick={() =>
            currentUser &&
            currentUserData &&
            fetchNotifications(currentUser, currentUserData, {
              reset: true,
              showSuccessToast: true,
              filterOverride: filter,
              searchOverride: searchTerm,
            })
          }
          disabled={isNotificationActionBusy()}
        >
          Refresh
        </button>
      </section>

      <section className="notifications-panel">
<div className="notifications-section-heading">
  <div>
    <h2>Notification List</h2>
    <p>
      Showing {displayedNotifications.length} matched notification
      {filteredNotifications.length === 1 ? "" : "s"} from {notifications.length} loaded record
      {notifications.length === 1 ? "" : "s"}. {hasMoreNotificationPages
        ? "The summary cards count loaded records only. Use Load More to continue the full history."
        : "All available history is loaded, so the summary cards now show full totals."}
    </p>
  </div>

  <div className="notifications-heading-actions">
    <button
      type="button"
      className="notifications-primary-btn"
      onClick={handleMarkAllAsRead}
      disabled={isNotificationActionBusy()}
    >
      {actionLoadingId === "all" ? "Marking..." : "Mark All Read"}
    </button>

    <button
      type="button"
      className="notifications-danger-btn"
      onClick={handleDeleteAllNotifications}
      disabled={isNotificationActionBusy()}
    >
      {actionLoadingId === "delete-all" ? "Deleting..." : "Delete Visible"}
    </button>
  </div>
</div>

        {filteredNotifications.length === 0 ? (
          <div className="notifications-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No notifications found</h2>
            <p>There are no notifications matching this filter.</p>
          </div>
        ) : (
          <div className="notifications-table-wrap">
            <table className="notifications-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Notification</th>
                  <th>Target</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {displayedNotifications.map((notification) => {
                  const read = isNotificationRead(notification);

                  return (
                    <tr
                      className={`notification-table-row ${read ? "read" : "unread"}`}
                      key={notification.id}
                    >
                      <td data-label="Date">
                        <span className="notification-table-date">
                          {formatDate(notification)}
                        </span>
                      </td>

                      <td data-label="Notification">
                        <div className="notification-table-message">
                          <strong>{notification.title || "Untitled Notification"}</strong>
                          <span>{notification.message || "No message provided."}</span>
                        </div>
                      </td>

                      <td data-label="Target">
                        <span className="notification-table-chip">
                          {notification.targetRole || "General"}
                        </span>
                      </td>

                      <td data-label="Category">
                        <span className="notification-table-chip">
                          {notification.categoryName || notification.categoryId || "None"}
                        </span>
                      </td>

                      <td data-label="Status">
                        <span
                          className={`notification-table-status ${read ? "read" : "unread"}`}
                        >
                          {read ? "Read" : "Unread"}
                        </span>
                      </td>

                      <td data-label="Action">
                        <div className="notification-table-actions">
                          <button
                            type="button"
                            className="notification-icon-btn"
                            data-tooltip="Open"
                            title="Open"
                            aria-label="Open notification"
                            onClick={() => handleOpenNotification(notification)}
                            disabled={isNotificationActionBusy()}
                          >
                            {actionLoadingId === `open-${notification.id}` ? "…" : "↗"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMoreNotificationPages && (
          <div className="notifications-load-more-row">
            <button
              type="button"
              className="notifications-refresh-btn"
              onClick={handleLoadMoreNotifications}
              disabled={isNotificationActionBusy() || !canLoadMoreNotifications}
            >
              {loadingMoreNotifications
                ? "Loading More..."
                : filter === "Read"
                ? "Load More Read Notifications"
                : filter === "Unread"
                ? "Load More Unread Notifications"
                : "Load More Notifications"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default Notifications;