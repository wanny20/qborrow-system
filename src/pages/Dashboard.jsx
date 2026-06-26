import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit as queryLimit,
  query,
  where,
} from "firebase/firestore";
import { useNavigate, useOutletContext } from "react-router-dom";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/Dashboard.css";

const emptyDashboardCounts = {
  totalItems: 0,
  availableItems: 0,
  borrowedRequests: 0,
  pendingRequests: 0,
  overdueRequests: 0,
  damagedLostItems: 0,
};
const AUTO_REJECT_MS = 24 * 60 * 60 * 1000;
const NEAR_AUTO_REJECT_MS = 3 * 60 * 60 * 1000;

function Dashboard() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const { showToast } = useToast();

  const currentUser = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [dashboardCounts, setDashboardCounts] = useState(emptyDashboardCounts);
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [dismissedDueTodayAlert, setDismissedDueTodayAlert] = useState(false);

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isBorrower = userData?.role === "borrower";
  const isAdmin = isSuperAdmin || isCategoryAdmin;

  function showActionError(shortMessage, error) {
  console.error(shortMessage, error);
  showToast(shortMessage, "error");
}

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getCategoryId(record) {
    return record.categoryId || record.category || "";
  }

  function getCategoryName(record) {
    return record.categoryName || record.category || record.categoryId || "Uncategorized";
  }

  function canCategoryAdminSee(record) {
    if (!isCategoryAdmin) return true;

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    const categoryId = normalizeText(getCategoryId(record));
    const categoryName = normalizeText(getCategoryName(record));

    return (
      assignedCategories.includes(categoryId) ||
      assignedCategories.includes(categoryName)
    );
  }

  function getTodayDateKey() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;

    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

function isOverdue(request) {
  if (request.approvalStatus !== "Borrowed") {
    return false;
  }

  if (!request.expectedReturnDate) return false;

  const today = new Date();
  const expectedDate = new Date(request.expectedReturnDate);

  today.setHours(0, 0, 0, 0);
  expectedDate.setHours(0, 0, 0, 0);

  return today > expectedDate;
}

function isDueToday(request) {
  if (request.approvalStatus !== "Borrowed") {
    return false;
  }

  if (!request.expectedReturnDate) return false;

  return request.expectedReturnDate === getTodayDateKey();
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

function getAutoRejectRemainingMs(request) {
  if (request.approvalStatus !== "Pending") return null;

  const createdTime = getRequestCreatedTime(request);

  if (!createdTime) return null;

  return AUTO_REJECT_MS - (Date.now() - createdTime);
}

function formatAutoRejectRemaining(request) {
  const remainingMs = getAutoRejectRemainingMs(request);

  if (remainingMs === null) return "No timer";
  if (remainingMs <= 0) return "Ready to auto-reject";

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m left`;

  return `${hours}h ${minutes}m left`;
}

function isNearAutoReject(request) {
  const remainingMs = getAutoRejectRemainingMs(request);

  return remainingMs !== null && remainingMs <= NEAR_AUTO_REJECT_MS;
}

function isFacultyPriorityRequest(request) {
  return (
    request.priority === "High" ||
    String(request.borrowerUserType || "").toLowerCase() === "faculty"
  );
}

  function mapSnapshot(snapshot) {
    return snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
  }

  async function getServerCount(queryReference) {
    const countSnapshot = await getCountFromServer(queryReference);
    return countSnapshot.data().count || 0;
  }

  async function fetchSuperAdminDashboardData() {
    const itemsRef = collection(db, "items");
    const requestsRef = collection(db, "borrowRequests");
    const todayKey = getTodayDateKey();

const [
  totalItemsCount,
  availableItemsCount,
  borrowedRequestsCount,
  pendingRequestsCount,
  overdueSnapshot,
  conditionDamagedSnapshot,
  conditionLostSnapshot,
  availabilityDamagedSnapshot,
  availabilityLostSnapshot,
  allRequestsSnapshot,
] = await Promise.all([

      getServerCount(itemsRef),
      getServerCount(query(itemsRef, where("availability", "==", "Available"))),
      getServerCount(query(requestsRef, where("approvalStatus", "==", "Borrowed"))),
      getServerCount(query(requestsRef, where("approvalStatus", "==", "Pending"))),
      getDocs(query(requestsRef, where("expectedReturnDate", "<", todayKey))),
      getDocs(query(itemsRef, where("condition", "==", "Damaged"))),
      getDocs(query(itemsRef, where("condition", "==", "Lost"))),
      getDocs(query(itemsRef, where("availability", "==", "Damaged"))),
     getDocs(query(itemsRef, where("availability", "==", "Lost"))),
getDocs(requestsRef),
    ]);

const overdueCount = overdueSnapshot.docs.filter(
  (document) => document.data().approvalStatus === "Borrowed"
).length;

    const damagedLostItemIds = new Set();

    [
      conditionDamagedSnapshot,
      conditionLostSnapshot,
      availabilityDamagedSnapshot,
      availabilityLostSnapshot,
    ].forEach((snapshot) => {
      snapshot.docs.forEach((document) => {
        damagedLostItemIds.add(document.id);
      });
    });

setItems([]);
setRequests(mapSnapshot(allRequestsSnapshot));

    setDashboardCounts({
      totalItems: totalItemsCount,
      availableItems: availableItemsCount,
      borrowedRequests: borrowedRequestsCount,
      pendingRequests: pendingRequestsCount,
      overdueRequests: overdueCount,
      damagedLostItems: damagedLostItemIds.size,
    });
  }

  async function fetchBorrowerDashboardData() {
    const itemsRef = collection(db, "items");
    const requestsRef = collection(db, "borrowRequests");

    if (!currentUser) {
      setItems([]);
      setRequests([]);
      setDashboardCounts(emptyDashboardCounts);
      return;
    }

    const [availableItemsCount, availablePreviewSnapshot, myRequestsSnapshot] =
      await Promise.all([
        getServerCount(query(itemsRef, where("availability", "==", "Available"))),
        getDocs(
          query(
            itemsRef,
            where("availability", "==", "Available"),
            queryLimit(20)
          )
        ),
        getDocs(query(requestsRef, where("borrowerId", "==", currentUser.uid))),
      ]);

    setItems(mapSnapshot(availablePreviewSnapshot));
    setRequests(mapSnapshot(myRequestsSnapshot));

    setDashboardCounts({
      ...emptyDashboardCounts,
      availableItems: availableItemsCount,
    });
  }

  async function fetchCategoryAdminDashboardData() {
    const itemsSnapshot = await getDocs(collection(db, "items"));
    const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));

    setItems(mapSnapshot(itemsSnapshot));
    setRequests(mapSnapshot(requestsSnapshot));
    setDashboardCounts(emptyDashboardCounts);
  }

  async function fetchDashboardData() {
    setLoading(true);

    try {
      if (isSuperAdmin) {
        await fetchSuperAdminDashboardData();
      } else if (isCategoryAdmin) {
        await fetchCategoryAdminDashboardData();
      } else {
        await fetchBorrowerDashboardData();
      }
    } catch (error) {
      showActionError("Failed to load dashboard", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!userData?.role) return;

    fetchDashboardData();
  }, [userData?.role, userData?.assignedCategories?.join("|"), currentUser?.uid]);

  const visibleItems = useMemo(() => {
    if (isCategoryAdmin) {
      return items.filter((item) => canCategoryAdminSee(item));
    }

    return items;
  }, [items, userData]);

  const visibleRequests = useMemo(() => {
    if (isCategoryAdmin) {
      return requests.filter((request) => canCategoryAdminSee(request));
    }

    return requests;
  }, [requests, userData]);

  const myRequests = currentUser
    ? requests.filter((request) => request.borrowerId === currentUser.uid)
    : [];

  const myDueTodayRequests = myRequests.filter((request) => isDueToday(request));
  const priorityDueTodayRequest = myDueTodayRequests[0];

  const dueTodaySessionKey = currentUser
    ? `qborrowDueTodayDismissed-${currentUser.uid}-${getTodayDateKey()}`
    : "";

  const shouldShowDueTodayAlert =
    isBorrower &&
    priorityDueTodayRequest &&
    !dismissedDueTodayAlert &&
    dueTodaySessionKey &&
    sessionStorage.getItem(dueTodaySessionKey) !== "true";

  const availableItems = visibleItems.filter(
    (item) => item.availability === "Available"
  );

  const pendingRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Pending"
  );

  const overdueRequests = visibleRequests.filter((request) => isOverdue(request));

  const facultyPendingRequests = pendingRequests.filter((request) =>
  isFacultyPriorityRequest(request)
);

const nearAutoRejectRequests = pendingRequests.filter((request) =>
  isNearAutoReject(request)
);

const adminUrgentAlerts = [
  {
    title: "Priority Faculty Requests",
    count: facultyPendingRequests.length,
    description: "Faculty requests waiting for admin action.",
    tone: "yellow",
    path: "/manage-requests?status=Pending",
    items: facultyPendingRequests.slice(0, 3),
  },
  {
    title: "Near Auto-Reject",
    count: nearAutoRejectRequests.length,
    description: "Pending requests close to the 24-hour auto-reject limit.",
    tone: "pink",
    path: "/manage-requests?status=Pending",
    items: nearAutoRejectRequests.slice(0, 3),
  },
  {
    title: "Overdue Borrowed Items",
    count: overdueRequests.length,
    description: "Borrowed items past expected return date.",
    tone: "red",
    path: "/manage-requests?status=Overdue",
    items: overdueRequests.slice(0, 3),
  },
];

  const damagedLostItems = visibleItems.filter(
    (item) =>
      item.condition === "Damaged" ||
      item.condition === "Lost" ||
      item.availability === "Damaged" ||
      item.availability === "Lost"
  );

  const myPendingRequests = myRequests.filter(
    (request) => request.approvalStatus === "Pending"
  );

  const myApprovedRequests = myRequests.filter(
    (request) => request.approvalStatus === "Approved"
  );

  const myBorrowedRequests = myRequests.filter(
    (request) => request.approvalStatus === "Borrowed"
  );

  const borrowedRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Borrowed"
  );

  const myReturnedRequests = myRequests.filter(
    (request) => request.approvalStatus === "Returned"
  );

  const totalItemsValue = isSuperAdmin
    ? dashboardCounts.totalItems
    : visibleItems.length;

  const availableItemsValue = isSuperAdmin
    ? dashboardCounts.availableItems
    : availableItems.length;

  const borrowedRequestsValue = isSuperAdmin
    ? dashboardCounts.borrowedRequests
    : borrowedRequests.length;

  const pendingRequestsValue = isSuperAdmin
    ? dashboardCounts.pendingRequests
    : pendingRequests.length;

  const overdueRequestsValue = isSuperAdmin
    ? dashboardCounts.overdueRequests
    : overdueRequests.length;

  const damagedLostItemsValue = isSuperAdmin
    ? dashboardCounts.damagedLostItems
    : damagedLostItems.length;

  const borrowerAvailableItemsValue = isBorrower
    ? dashboardCounts.availableItems
    : items.filter((item) => item.availability === "Available").length;

  const adminStats = [
    {
      label: "Total Items",
      value: totalItemsValue,
      tone: "purple",
      path: "/admin-list/items",
    },
    {
      label: "Available",
      value: availableItemsValue,
      tone: "green",
      path: "/admin-list/available",
    },
    {
      label: "Borrowed",
      value: borrowedRequestsValue,
      tone: "yellow",
      path: "/admin-list/borrowed",
    },
    {
      label: "Pending",
      value: pendingRequestsValue,
      tone: "pink",
      path: "/admin-list/pending",
    },
    {
      label: "Overdue",
      value: overdueRequestsValue,
      tone: "red",
      path: "/admin-list/overdue",
    },
    {
      label: "Damaged/Lost",
      value: damagedLostItemsValue,
      tone: "red",
      path: "/admin-list/damaged-lost",
    },
  ];

  const borrowerStats = [
    {
      label: "Available Items",
      value: borrowerAvailableItemsValue,
      tone: "green",
      path: "/items",
    },
    {
      label: "Pending",
      value: myPendingRequests.length,
      tone: "yellow",
      path: "/my-requests",
    },
    {
      label: "Approved",
      value: myApprovedRequests.length,
      tone: "purple",
      path: "/my-requests",
    },
    {
      label: "Borrowed",
      value: myBorrowedRequests.length,
      tone: "pink",
      path: "/my-requests",
    },
    {
      label: "Returned",
      value: myReturnedRequests.length,
      tone: "green",
      path: "/my-requests",
    },
  ];

  const adminActions = [
    {
      label: "Add Item",
      description: "Register new inventory",
      path: "/add-item",
    },
    {
      label: "Manage Requests",
      description: "Approve or reject requests",
      path: "/manage-requests",
    },
    {
      label: "Release Item",
      description: "Scan before releasing",
      path: "/release-item",
    },
    {
      label: "Return Item",
      description: "Confirm returned items",
      path: "/return-confirmation",
    },
    {
      label: "Reports",
      description: "View analytics",
      path: "/reports",
    },
  ];

  if (isSuperAdmin) {
    adminActions.push({
      label: "User Management",
      description: "Manage roles and accounts",
      path: "/user-management",
    });
  }

  const borrowerActions = [
    {
      label: "Scan QR",
      description: "Open an item using QR",
      path: "/scan-qr",
    },
    {
      label: "Browse Items",
      description: "View available items",
      path: "/items",
    },
    {
      label: "My Requests",
      description: "Track your borrowing",
      path: "/my-requests",
    },
  ];

  const filteredAvailableItems = items
    .filter((item) => item.availability === "Available")
    .filter((item) => {
      const searchableText = `
        ${item.itemName || ""}
        ${item.itemCode || ""}
        ${getCategoryName(item)}
        ${item.condition || ""}
        ${item.description || ""}
      `.toLowerCase();

      return searchableText.includes(borrowerSearch.toLowerCase());
    })
    .slice(0, 4);

  function handleDismissDueTodayAlert() {
    if (dueTodaySessionKey) {
      sessionStorage.setItem(dueTodaySessionKey, "true");
    }

    setDismissedDueTodayAlert(true);
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="dashboard-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading dashboard...</h2>
          <p>Preparing a quick summary of your account.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {shouldShowDueTodayAlert && (
        <div className="dashboard-due-overlay" role="dialog" aria-modal="true">
          <section className="dashboard-due-card">
            <div className="dashboard-due-icon">!</div>

            <div>
              <p className="qb-kicker">Priority Reminder</p>
              <h2>You have an item due today</h2>

              <p>
                Please return or coordinate the item before the day ends to avoid
                overdue records.
              </p>
            </div>

            <div className="dashboard-due-item">
              <span>Item</span>
              <strong>{priorityDueTodayRequest.itemName || "Untitled Item"}</strong>
            </div>

            <div className="dashboard-due-grid">
              <div>
                <span>Item Code</span>
                <strong>
                  {priorityDueTodayRequest.itemCode ||
                    priorityDueTodayRequest.itemId ||
                    "N/A"}
                </strong>
              </div>

              <div>
                <span>Expected Return</span>
                <strong>{priorityDueTodayRequest.expectedReturnDate}</strong>
              </div>

              <div>
                <span>Status</span>
                <strong>{priorityDueTodayRequest.approvalStatus}</strong>
              </div>

              <div>
                <span>Total Due Today</span>
                <strong>{myDueTodayRequests.length}</strong>
              </div>
            </div>

            <div className="dashboard-due-actions">
              <button
                type="button"
                className="dashboard-due-secondary"
                onClick={() => navigate("/my-requests")}
              >
                View My Requests
              </button>

              <button
                type="button"
                className="dashboard-due-primary"
                onClick={handleDismissDueTodayAlert}
              >
                OK
              </button>
            </div>
          </section>
        </div>
      )}

<section className="dashboard-hero">
  <div>
    <h1>Welcome, {userData?.fullName || "User"}</h1>
          <p>
            {isAdmin
              ? "Here is a quick overview of inventory, requests, and items that need attention."
              : "Browse items, scan QR codes, and track your borrowing requests from one place."}
          </p>

          {isCategoryAdmin && (
            <div className="dashboard-assigned-note">
              Assigned:{" "}
              {Array.isArray(userData?.assignedCategories) &&
              userData.assignedCategories.length > 0
                ? userData.assignedCategories.join(", ")
                : "No assigned categories"}
            </div>
          )}
        </div>
      </section>
      
      <section className="dashboard-stats-grid">
        {(isAdmin ? adminStats : borrowerStats).map((stat) => (
          <button
            type="button"
            className={`dashboard-stat-card dashboard-stat-${stat.tone}`}
            key={stat.label}
            onClick={() => navigate(stat.path)}
            aria-label={`Open ${stat.label}`}
          >
            <span className="dashboard-stat-label">{stat.label}</span>
            <strong>{stat.value}</strong>
            <span className="dashboard-stat-hint">View</span>
          </button>
        ))}
      </section>

      {isAdmin && (
  <section className="dashboard-urgent-alerts">
    <div className="dashboard-urgent-heading">
      <div>
        <p className="qb-kicker">Admin Priority Center</p>
        <h2>Urgent Alerts</h2>
        <span>
          Requests and records that need attention before normal tasks.
        </span>
      </div>

      <button type="button" onClick={() => navigate("/manage-requests")}>
        View Requests
      </button>
    </div>

    <div className="dashboard-urgent-grid">
      {adminUrgentAlerts.map((alert) => (
        <button
          type="button"
          className={`dashboard-urgent-card dashboard-urgent-${alert.tone}`}
          key={alert.title}
          onClick={() => navigate(alert.path)}
        >
          <div className="dashboard-urgent-card-top">
            <span>{alert.title}</span>
            <strong>{alert.count}</strong>
          </div>

          <p>{alert.description}</p>

          {alert.items.length > 0 ? (
            <div className="dashboard-urgent-preview-list">
              {alert.items.map((request) => (
                <div key={request.id}>
                  <strong>{request.itemName || "Untitled Item"}</strong>
                  <span>
                    {request.borrowerName || request.borrowerEmail || "Borrower"}
                    {request.approvalStatus === "Pending"
                      ? ` • ${formatAutoRejectRemaining(request)}`
                      : request.expectedReturnDate
                        ? ` • Due ${request.expectedReturnDate}`
                        : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-urgent-empty">No urgent records</div>
          )}
        </button>
      ))}
    </div>
  </section>
)}

      {isAdmin ? (
        <section className="dashboard-main-grid">
          <div className="dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h2>Quick Actions</h2>
                <p>Common admin tasks.</p>
              </div>
            </div>

            <div className="dashboard-action-list">
              {adminActions.map((action) => (
                <button
                  type="button"
                  key={action.label}
                  onClick={() => navigate(action.path)}
                >
                  <div>
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </div>

                  <span>→</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h2>Needs Attention</h2>
                <p>Important admin indicators.</p>
              </div>
            </div>

            <div className="dashboard-attention-list">
              <button type="button" onClick={() => navigate("/manage-requests")}>
                <span>Pending Requests</span>
                <strong>{pendingRequestsValue}</strong>
              </button>

              <button type="button" onClick={() => navigate("/reports")}>
                <span>Overdue Records</span>
                <strong>{overdueRequestsValue}</strong>
              </button>

              <button type="button" onClick={() => navigate("/reports")}>
                <span>Damaged/Lost Items</span>
                <strong>{damagedLostItemsValue}</strong>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="dashboard-main-grid">
          <div className="dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <h2>Quick Actions</h2>
                <p>Start borrowing faster.</p>
              </div>
            </div>

            <div className="dashboard-action-list">
              {borrowerActions.map((action) => (
                <button
                  type="button"
                  key={action.label}
                  onClick={() => navigate(action.path)}
                >
                  <div>
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </div>

                  <span>→</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="dashboard-panel-heading dashboard-search-heading">
              <div>
                <h2>Available Items</h2>
                <p>Preview of borrowable items.</p>
              </div>

              <button type="button" onClick={() => navigate("/items")}>
                View All
              </button>
            </div>

            <input
              className="dashboard-search-input"
              type="text"
              placeholder="Search available items..."
              value={borrowerSearch}
              onChange={(event) => setBorrowerSearch(event.target.value)}
            />

            {filteredAvailableItems.length === 0 ? (
              <div className="dashboard-empty-state">
                <p>No available items found.</p>
              </div>
            ) : (
              <div className="dashboard-item-preview-list">
                {filteredAvailableItems.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.itemName || "Untitled Item"}</strong>
                      <span>
                        {getCategoryName(item)} • {item.condition || "Unknown"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate(`/item/${item.id}`)}
                    >
                      View
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default Dashboard;