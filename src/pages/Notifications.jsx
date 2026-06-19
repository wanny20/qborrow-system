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
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/Notifications.css";

const NOTIFICATIONS_PAGE_SIZE = 10;

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
  const [visibleNotificationCount, setVisibleNotificationCount] = useState(
    NOTIFICATIONS_PAGE_SIZE
  );
const [statusMessage, setStatusMessage] = useState("");
const [statusType, setStatusType] = useState("");
const [selectedNotification, setSelectedNotification] = useState(null);
const notificationActionLockRef = useRef("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
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

  function isNotificationRead(notification) {
    const uid = currentUser?.uid;

    if (!uid) return false;

    if (notification.userId === uid) {
      return notification.status === "Read";
    }

    if (Array.isArray(notification.readBy)) {
      return notification.readBy.includes(uid);
    }

    return notification.status === "Read";
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

  async function fetchNotifications(user, userData) {
    setLoading(true);

    try {
      const querySnapshot = await getDocs(collection(db, "notifications"));

      const notificationData = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter(
          (notification) =>
            canSeeNotification(notification, userData, user) &&
            !isNotificationDeletedForUser(notification, user)
        )
        .sort((a, b) => getNotificationTime(b) - getNotificationTime(a));

      setNotifications(notificationData);
    } catch (error) {
      showStatus("Error loading notifications: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

async function handleMarkAsRead(notification) {
  if (!currentUser) return;

  if (isNotificationRead(notification)) return;

  const started = startNotificationAction(notification.id);

  if (!started) return;

  showStatus("", "");

  try {
    const notificationRef = doc(db, "notifications", notification.id);
    const latestNotificationSnap = await getDoc(notificationRef);

    if (!latestNotificationSnap.exists()) {
      setNotifications((previousNotifications) =>
        previousNotifications.filter((item) => item.id !== notification.id)
      );

      showStatus("This notification no longer exists.", "error");
      return;
    }

    if (notification.userId === currentUser.uid) {
      await updateDoc(notificationRef, {
        status: "Read",
        readAt: serverTimestamp(),
      });

      setNotifications((previousNotifications) =>
        previousNotifications.map((item) =>
          item.id === notification.id ? { ...item, status: "Read" } : item
        )
      );
    } else {
      await updateDoc(notificationRef, {
        readBy: arrayUnion(currentUser.uid),
        lastReadAt: serverTimestamp(),
      });

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
    }

    showToast("Notification Marked as Read", "success");
  } catch (error) {
    showStatus("Error updating notification: " + error.message, "error");
  } finally {
    finishNotificationAction();
  }
}

async function handleOpenNotification(notification) {
  if (!currentUser) return;

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

      showStatus("This notification no longer exists.", "error");
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
    showStatus("Error opening notification: " + error.message, "error");
  } finally {
    finishNotificationAction();
  }
}

async function handleMarkAllAsRead() {
  if (!currentUser) return;

  if (isNotificationActionBusy()) return;

  const unreadNotifications = filteredNotifications.filter(
    (notification) => !isNotificationRead(notification)
  );

  if (unreadNotifications.length === 0) {
    showToast("No Unread Notifications", "success");
return;
  }

  const started = startNotificationAction("all");

  if (!started) return;

  try {
    const confirmRead = window.confirm(
      `Mark ${unreadNotifications.length} notification(s) as read?`
    );

    if (!confirmRead) return;

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
    showStatus("Error marking notifications as read: " + error.message, "error");
  } finally {
    finishNotificationAction();
  }
}

async function handleDeleteAllNotifications() {
  if (!currentUser) return;

  if (isNotificationActionBusy()) return;

  if (filteredNotifications.length === 0) {
showToast("No Notifications to Delete", "success");
return;
  }

  const started = startNotificationAction("delete-all");

  if (!started) return;

  try {
    const confirmDelete = window.confirm(
      `Delete ${filteredNotifications.length} visible notification(s)?`
    );

    if (!confirmDelete) return;

    showStatus("", "");

    await Promise.all(
      filteredNotifications.map((notification) => {
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
          !filteredNotifications.some(
            (deletedNotification) => deletedNotification.id === notification.id
          )
      )
    );

    showToast("Notifications Deleted", "success");
  } catch (error) {
    showStatus("Error deleting notifications: " + error.message, "error");
  } finally {
    finishNotificationAction();
  }
}
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      setCurrentUser(user);

      try {
        const loadedUserData = await loadUserData(user);
        setCurrentUserData(loadedUserData);
        await fetchNotifications(user, loadedUserData);
      } catch (error) {
        showStatus("Error loading notification page: " + error.message, "error");
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate, outletContext?.userData]);

const filteredNotifications = useMemo(() => {
  return notifications
    .filter((notification) => {
      const read = isNotificationRead(notification);

      const matchesFilter =
        filter === "All" ||
        (filter === "Unread" && !read) ||
        (filter === "Read" && read);

      const searchableText = `
        ${notification.title || ""}
        ${notification.message || ""}
        ${notification.targetRole || ""}
        ${notification.categoryId || ""}
        ${notification.categoryName || ""}
        ${notification.status || ""}
      `.toLowerCase();

      const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => getNotificationTime(b) - getNotificationTime(a));
}, [notifications, filter, searchTerm, currentUser]);

useEffect(() => {
  setVisibleNotificationCount(NOTIFICATIONS_PAGE_SIZE);
}, [filter, searchTerm]);

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
  const displayedNotifications = filteredNotifications.slice(
  0,
  visibleNotificationCount
);

const hasMoreNotifications =
  visibleNotificationCount < filteredNotifications.length;

function handleLoadMoreNotifications() {
  setVisibleNotificationCount((currentCount) =>
    Math.min(
      currentCount + NOTIFICATIONS_PAGE_SIZE,
      filteredNotifications.length
    )
  );
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
          <p>Total</p>
        </div>

        <div>
          <span>!</span>
          <h3>{stats.unread}</h3>
          <p>Unread</p>
        </div>

        <div>
          <span>✓</span>
          <h3>{stats.read}</h3>
          <p>Read</p>
        </div>

        <div>
          <span>⚙</span>
          <h3>{stats.admin}</h3>
          <p>Admin Alerts</p>
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
            fetchNotifications(currentUser, currentUserData)
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
      Showing {displayedNotifications.length} of {filteredNotifications.length} matched notification
      {filteredNotifications.length === 1 ? "" : "s"}.
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
      {actionLoadingId === "delete-all" ? "Deleting..." : "Delete All"}
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
 <div className="notifications-list">
  {displayedNotifications.map((notification) => {
    const read = isNotificationRead(notification);

    return (
      <article
        className={`notification-row ${read ? "read" : "unread"}`}
        key={notification.id}
      >
        <div className="notification-row-main">
          <div className="notification-row-titleline">
            <div>
              <span className="notification-date">
                {formatDate(notification)}
              </span>

              <h3>{notification.title || "Untitled Notification"}</h3>
            </div>

            <strong className={read ? "read" : "unread"}>
              {read ? "Read" : "Unread"}
            </strong>
          </div>

          <p>{notification.message || "No message provided."}</p>

          <div className="notification-meta-row">
            {notification.targetRole && <span>{notification.targetRole}</span>}

            {notification.categoryId && (
              <span>{notification.categoryName || notification.categoryId}</span>
            )}
          </div>
        </div>

        <div className="notification-actions">
<button
  type="button"
  className="notifications-primary-btn"
  onClick={() => handleOpenNotification(notification)}
  disabled={isNotificationActionBusy()}
>
  {actionLoadingId === `open-${notification.id}` ? "Opening..." : "Open"}
</button>
        </div>
      </article>
    );
  })}
</div>
        )}

        {hasMoreNotifications && (
          <div className="notifications-load-more-row">
            <button
              type="button"
              className="notifications-refresh-btn"
              onClick={handleLoadMoreNotifications}
              disabled={isNotificationActionBusy()}
            >
              Load More Notifications
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default Notifications;