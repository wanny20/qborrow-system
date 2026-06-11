import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate, useOutletContext } from "react-router-dom";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/Dashboard.css";

function Dashboard() {
  const navigate = useNavigate();
  const { userData } = useOutletContext();

  const [loading, setLoading] = useState(true);
  const [notificationCount, setNotificationCount] = useState(0);
  const [availableItemsPreview, setAvailableItemsPreview] = useState([]);
  const [borrowerSearch, setBorrowerSearch] = useState("");

  const [stats, setStats] = useState({
    totalItems: 0,
    availableItems: 0,
    borrowedItems: 0,
    pendingRequests: 0,
    overdueItems: 0,
    damagedLostItems: 0,
  });

  const [borrowerStats, setBorrowerStats] = useState({
    availableItems: 0,
    myPendingRequests: 0,
    myApprovedRequests: 0,
    myReturnedItems: 0,
  });

  async function fetchDashboardStats() {
    try {
      const itemsSnapshot = await getDocs(collection(db, "items"));
      const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));

      const items = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requests = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingRequests = requests.filter(
        (request) => request.approvalStatus === "Pending"
      );

      const overdueRequests = requests.filter((request) => {
        if (request.approvalStatus !== "Approved") {
          return false;
        }

        const expectedDate = new Date(request.expectedReturnDate);
        expectedDate.setHours(0, 0, 0, 0);

        return today > expectedDate;
      });

      const damagedLostItems = items.filter(
        (item) => item.condition === "Damaged" || item.condition === "Lost"
      );

      const availableItems = items.filter(
        (item) => item.availability === "Available"
      );

      const currentUser = auth.currentUser;

      const myRequests = currentUser
        ? requests.filter((request) => request.borrowerId === currentUser.uid)
        : [];

      const myPendingRequests = myRequests.filter(
        (request) => request.approvalStatus === "Pending"
      );

      const myApprovedRequests = myRequests.filter(
        (request) => request.approvalStatus === "Approved"
      );

      const myReturnedItems = myRequests.filter(
        (request) => request.approvalStatus === "Returned"
      );

      setStats({
        totalItems: items.length,
        availableItems: availableItems.length,
        borrowedItems: items.filter((item) => item.availability === "Borrowed")
          .length,
        pendingRequests: pendingRequests.length,
        overdueItems: overdueRequests.length,
        damagedLostItems: damagedLostItems.length,
      });

      setBorrowerStats({
        availableItems: availableItems.length,
        myPendingRequests: myPendingRequests.length,
        myApprovedRequests: myApprovedRequests.length,
        myReturnedItems: myReturnedItems.length,
      });

      setAvailableItemsPreview(availableItems);

      if (userData?.role === "admin") {
        setNotificationCount(
          pendingRequests.length + overdueRequests.length + damagedLostItems.length
        );
      } else {
        setNotificationCount(myPendingRequests.length + myApprovedRequests.length);
      }
    } catch (error) {
      alert("Error loading dashboard stats: " + error.message);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchDashboardStats();
  }, [userData]);

  const adminStatCards = [
    {
      title: "Total Items",
      value: stats.totalItems,
      icon: "/icons/total-items.png",
    },
    {
      title: "Available Items",
      value: stats.availableItems,
      icon: "/icons/available.png",
    },
    {
      title: "Borrowed Items",
      value: stats.borrowedItems,
      icon: "/icons/borrowed.png",
    },
    {
      title: "Pending Requests",
      value: stats.pendingRequests,
      icon: "/icons/pending.png",
    },
    {
      title: "Overdue Items",
      value: stats.overdueItems,
      icon: "/icons/overdue.png",
    },
    {
      title: "Damaged/Lost Items",
      value: stats.damagedLostItems,
      icon: "/icons/damaged.png",
    },
  ];

  const adminQuickActions = [
    {
      label: "Add Item",
      icon: "/icons/add-item.png",
      path: "/add-item",
    },
    {
      label: "Manage Requests",
      icon: "/icons/manage.png",
      path: "/manage-requests",
    },
    {
      label: "Return Confirmation",
      icon: "/icons/return.png",
      path: "/return-confirmation",
    },
    {
      label: "Reports",
      icon: "/icons/reports.png",
      path: "/reports",
    },
  ];

  const borrowerStatCards = [
    {
      title: "Available Items",
      value: borrowerStats.availableItems,
      icon: "/icons/available.png",
    },
    {
      title: "Pending Requests",
      value: borrowerStats.myPendingRequests,
      icon: "/icons/pending.png",
    },
    {
      title: "Approved Requests",
      value: borrowerStats.myApprovedRequests,
      icon: "/icons/borrowed.png",
    },
    {
      title: "Returned Items",
      value: borrowerStats.myReturnedItems,
      icon: "/icons/return.png",
    },
  ];

  const borrowerQuickActions = [
    {
      label: "Scan QR Code",
      icon: "/icons/scan.png",
      path: "/scan-qr",
    },
    {
      label: "View Items",
      icon: "/icons/items.png",
      path: "/items",
    },
    {
      label: "My Borrow Requests",
      icon: "/icons/requests.png",
      path: "/my-requests",
    },
  ];

  const filteredAvailableItems = availableItemsPreview
    .filter((item) => {
      const itemName = item.itemName || "";
      const category = item.category || "";
      const condition = item.condition || "";
      const description = item.description || "";

      return (
        itemName.toLowerCase().includes(borrowerSearch.toLowerCase()) ||
        category.toLowerCase().includes(borrowerSearch.toLowerCase()) ||
        condition.toLowerCase().includes(borrowerSearch.toLowerCase()) ||
        description.toLowerCase().includes(borrowerSearch.toLowerCase())
      );
    })
    .slice(0, 6);

  if (loading) {
    return (
      <div className="dashboard-content-loading">
        <img src="/qborrow-logo.png" alt="QBorrow Logo" />
        <h2>Loading Dashboard...</h2>
      </div>
    );
  }

  return (
    <div className="dashboard-content-page">
      <section className="dashboard-content-header-row">
        <div className="dashboard-title-area">
          <h1>
            DASHBOARD/
            {userData?.role === "admin" ? "ADMIN" : "BORROWER"}
          </h1>

          <p>
            {userData?.role === "admin"
              ? "Monitor borrowing activity, item availability, and return status in one place."
              : "Find available items, scan QR codes, and track your borrowing requests."}
          </p>
        </div>

        <button
          className="dashboard-notification-card"
          onClick={() => navigate("/notifications")}
        >
          <div className="dashboard-notification-icon-wrap">
            <img src="/icons/notifications.png" alt="" />

            {notificationCount > 0 && (
              <span className="dashboard-notification-badge">
                {notificationCount}
              </span>
            )}
          </div>

          <span>Notifications</span>
        </button>
      </section>

      {userData?.role === "admin" ? (
        <>
          <section className="dashboard-stats-grid">
            {adminStatCards.map((card) => (
              <div className="dashboard-stat-card" key={card.title}>
                <img src={card.icon} alt="" />
                <h3>{card.title}</h3>
                <p>{card.value}</p>
              </div>
            ))}
          </section>

          <section className="dashboard-quick-actions">
            <h2>QUICK ACTIONS</h2>

            <div className="dashboard-action-row">
              {adminQuickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => navigate(action.path)}
                >
                  <img src={action.icon} alt="" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="borrower-search-section">
            <input
              type="text"
              placeholder="Search available items by name, category, condition, or description..."
              value={borrowerSearch}
              onChange={(event) => setBorrowerSearch(event.target.value)}
            />

            <button onClick={() => navigate("/items")}>View All Items</button>
          </section>

          <section className="borrower-action-row">
            {borrowerQuickActions.map((action) => (
              <button key={action.label} onClick={() => navigate(action.path)}>
                <img src={action.icon} alt="" />
                <span>{action.label}</span>
              </button>
            ))}
          </section>

          <section className="borrower-stats-grid">
            {borrowerStatCards.map((card) => (
              <div className="borrower-stat-card" key={card.title}>
                <img src={card.icon} alt="" />
                <div>
                  <h3>{card.value}</h3>
                  <p>{card.title}</p>
                </div>
              </div>
            ))}
          </section>

          <section className="available-preview-section">
            <div className="section-heading-row">
              <div>
                <h2>AVAILABLE ITEMS</h2>
                <p>Preview of items you can currently borrow.</p>
              </div>

              <button onClick={() => navigate("/items")}>View More</button>
            </div>

            {filteredAvailableItems.length === 0 ? (
              <div className="no-available-items">
                <img src="/qborrow-logo.png" alt="QBorrow Logo" />
                <h3>No available items found</h3>
                <p>Try searching another item or check again later.</p>
              </div>
            ) : (
              <div className="available-item-grid">
                {filteredAvailableItems.map((item) => (
                  <div className="available-item-card" key={item.id}>
                    <div className="available-item-icon">
                      <img src="/icons/items.png" alt="" />
                    </div>

                    <h3>{item.itemName}</h3>

                    <p className="item-description-preview">
                      {item.description || "No description yet"}
                    </p>

                    <div className="item-meta-row">
                      <span>{item.category}</span>
                      <span>{item.condition}</span>
                    </div>

                    <div className="item-card-actions">
                      <button
                        className="view-item-btn"
                        onClick={() => navigate(`/item/${item.id}`)}
                      >
                        View
                      </button>

                      <button
                        className="borrow-item-btn"
                        onClick={() => navigate(`/borrow-request/${item.id}`)}
                      >
                        Borrow
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default Dashboard;