import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate, useOutletContext } from "react-router-dom";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/Dashboard.css";

function Dashboard() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [borrowerSearch, setBorrowerSearch] = useState("");

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isBorrower = userData?.role === "borrower";
  const isAdmin = isSuperAdmin || isCategoryAdmin;

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

  function isOverdue(request) {
    if (!["Approved", "Borrowed"].includes(request.approvalStatus)) {
      return false;
    }

    if (!request.expectedReturnDate) return false;

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  async function fetchDashboardData() {
    setLoading(true);

    try {
      const itemsSnapshot = await getDocs(collection(db, "items"));
      const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));

      const itemData = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setItems(itemData);
      setRequests(requestData);
    } catch (error) {
      alert("Error loading dashboard: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboardData();
  }, []);

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

  const currentUser = auth.currentUser;

  const myRequests = currentUser
    ? requests.filter((request) => request.borrowerId === currentUser.uid)
    : [];

  const availableItems = visibleItems.filter(
    (item) => item.availability === "Available"
  );

  const borrowedItems = visibleItems.filter(
    (item) => item.availability === "Borrowed"
  );

  const pendingRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Pending"
  );

  const overdueRequests = visibleRequests.filter((request) => isOverdue(request));

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

const adminStats = [
  {
    label: "Total Items",
    value: visibleItems.length,
    tone: "purple",
    path: "/admin-list/items",
  },
  {
    label: "Available",
    value: availableItems.length,
    tone: "green",
    path: "/admin-list/available",
  },
  {
    label: "Borrowed",
    value: borrowedRequests.length,
    tone: "yellow",
    path: "/admin-list/borrowed",
  },
  {
    label: "Pending",
    value: pendingRequests.length,
    tone: "pink",
    path: "/admin-list/pending",
  },
  {
    label: "Overdue",
    value: overdueRequests.length,
    tone: "red",
    path: "/admin-list/overdue",
  },
  {
    label: "Damaged/Lost",
    value: damagedLostItems.length,
    tone: "red",
    path: "/admin-list/damaged-lost",
  },
];

const borrowerStats = [
  {
    label: "Available Items",
    value: items.filter((item) => item.availability === "Available").length,
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

  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : isCategoryAdmin
    ? "Category Admin"
    : "Borrower";

  const notificationCount = isAdmin
    ? pendingRequests.length + overdueRequests.length + damagedLostItems.length
    : myPendingRequests.length + myApprovedRequests.length + myBorrowedRequests.length;

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
      <section className="dashboard-hero">
        <div>
          <p className="dashboard-eyebrow">QBorrow Dashboard</p>
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

      <section className="dashboard-role-row">
        <div>
          <span>Current Role</span>
          <strong>{roleLabel}</strong>
        </div>

        <div>
          <span>Email</span>
          <strong>{userData?.email || auth.currentUser?.email || "No email"}</strong>
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
                <strong>{pendingRequests.length}</strong>
              </button>

              <button type="button" onClick={() => navigate("/reports")}>
                <span>Overdue Records</span>
                <strong>{overdueRequests.length}</strong>
              </button>

              <button type="button" onClick={() => navigate("/reports")}>
                <span>Damaged/Lost Items</span>
                <strong>{damagedLostItems.length}</strong>
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