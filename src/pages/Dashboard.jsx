import { useEffect, useState } from "react";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/Dashboard.css";

function Dashboard() {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    totalItems: 0,
    availableItems: 0,
    borrowedItems: 0,
    pendingRequests: 0,
    overdueItems: 0,
    damagedLostItems: 0,
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

      const overdueRequests = requests.filter((request) => {
        if (request.approvalStatus !== "Approved") {
          return false;
        }

        const expectedDate = new Date(request.expectedReturnDate);
        expectedDate.setHours(0, 0, 0, 0);

        return today > expectedDate;
      });

      setStats({
        totalItems: items.length,
        availableItems: items.filter(
          (item) => item.availability === "Available"
        ).length,
        borrowedItems: items.filter((item) => item.availability === "Borrowed")
          .length,
        pendingRequests: requests.filter(
          (request) => request.approvalStatus === "Pending"
        ).length,
        overdueItems: overdueRequests.length,
        damagedLostItems: items.filter(
          (item) => item.condition === "Damaged" || item.condition === "Lost"
        ).length,
      });
    } catch (error) {
      alert("Error loading dashboard stats: " + error.message);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/login";
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setUserData(userSnap.data());
          fetchDashboardStats();
        } else {
          alert("No user role found in Firestore.");
        }
      } catch (error) {
        alert("Error loading user data: " + error.message);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function handleLogout() {
    try {
      await signOut(auth);
      window.location.href = "/";
    } catch (error) {
      alert("Logout failed: " + error.message);
    }
  }

  function goTo(path) {
    window.location.href = path;
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading Dashboard...</h2>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Items",
      value: stats.totalItems,
      icon: "📦",
      className: "stat-blue",
    },
    {
      title: "Available Items",
      value: stats.availableItems,
      icon: "✅",
      className: "stat-green",
    },
    {
      title: "Borrowed Items",
      value: stats.borrowedItems,
      icon: "📤",
      className: "stat-indigo",
    },
    {
      title: "Pending Requests",
      value: stats.pendingRequests,
      icon: "⏳",
      className: "stat-yellow",
    },
    {
      title: "Overdue Items",
      value: stats.overdueItems,
      icon: "⚠️",
      className: "stat-red",
    },
    {
      title: "Damaged/Lost Items",
      value: stats.damagedLostItems,
      icon: "🛠️",
      className: "stat-dark",
    },
  ];

  return (
    <div className="dashboard-page">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <div>
            <h2>QBorrow</h2>
            <p>Scan • Borrow • Return</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className="active" onClick={() => goTo("/dashboard")}>
            🏠 Dashboard
          </button>

          <button onClick={() => goTo("/items")}>📋 View Items</button>

          <button onClick={() => goTo("/scan-qr")}>🔍 Scan QR Code</button>

          <button onClick={() => goTo("/my-requests")}>
            📄 My Borrow Requests
          </button>

          <button onClick={() => goTo("/notifications")}>
            🔔 Notifications
          </button>

          {userData?.role === "admin" && (
            <>
              <div className="sidebar-label">Admin Menu</div>

              <button onClick={() => goTo("/add-item")}>➕ Add Item</button>

              <button onClick={() => goTo("/manage-requests")}>
                ✅ Manage Requests
              </button>

              <button onClick={() => goTo("/return-confirmation")}>
                ↩️ Return Confirmation
              </button>

              <button onClick={() => goTo("/reports")}>📊 Reports</button>
            </>
          )}
        </nav>

        <button className="logout-btn" onClick={handleLogout}>
          🚪 Logout
        </button>
      </aside>

      <main className="dashboard-main">
        <section className="dashboard-header">
          <div>
            <p className="dashboard-eyebrow">QBorrow Dashboard</p>
            <h1>
              Welcome back,{" "}
              <span>{userData?.fullName || "User"}</span>
            </h1>
            <p className="dashboard-subtitle">
              Monitor borrowing activity, item availability, and return status
              in one place.
            </p>
          </div>

          <div className="user-card">
            <div className="user-avatar">
              {userData?.fullName?.charAt(0)?.toUpperCase() || "U"}
            </div>

            <div>
              <p>{userData?.fullName}</p>
              <span className={`role-badge ${userData?.role}`}>
                {userData?.role}
              </span>
            </div>
          </div>
        </section>

        <section className="stats-grid">
          {statCards.map((card) => (
            <div className={`stat-card ${card.className}`} key={card.title}>
              <div className="stat-icon">{card.icon}</div>

              <div>
                <h3>{card.value}</h3>
                <p>{card.title}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="quick-actions">
          <div className="section-title">
            <h2>Quick Actions</h2>
            <p>Choose a task to continue using the system.</p>
          </div>

          <div className="action-grid">
            <button onClick={() => goTo("/items")}>
              <span>📋</span>
              View Items
            </button>

            <button onClick={() => goTo("/scan-qr")}>
              <span>🔍</span>
              Scan QR
            </button>

            <button onClick={() => goTo("/my-requests")}>
              <span>📄</span>
              My Requests
            </button>

            <button onClick={() => goTo("/notifications")}>
              <span>🔔</span>
              Notifications
            </button>

            {userData?.role === "admin" && (
              <>
                <button onClick={() => goTo("/add-item")}>
                  <span>➕</span>
                  Add Item
                </button>

                <button onClick={() => goTo("/manage-requests")}>
                  <span>✅</span>
                  Manage Requests
                </button>

                <button onClick={() => goTo("/return-confirmation")}>
                  <span>↩️</span>
                  Confirm Return
                </button>

                <button onClick={() => goTo("/reports")}>
                  <span>📊</span>
                  Reports
                </button>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;