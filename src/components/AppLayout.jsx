import { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/AppLayout.css";

function AppLayout() {
  const [userData, setUserData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

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
          setUserData(userSnap.data());
        } else {
          alert("No user role found in Firestore.");
        }
      } catch (error) {
        alert("Error loading user data: " + error.message);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  async function handleLogout() {
    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      alert("Logout failed: " + error.message);
    }
  }

  const mainLinks = [
    { label: "Dashboard", icon: "/icons/dashboard.png", path: "/dashboard" },
    { label: "View Items", icon: "/icons/items.png", path: "/items" },
    { label: "Scan QR Code", icon: "/icons/scan.png", path: "/scan-qr" },
    {
      label: "My Borrow Requests",
      icon: "/icons/requests.png",
      path: "/my-requests",
    },
    {
      label: "Notifications",
      icon: "/icons/notifications.png",
      path: "/notifications",
    },
  ];

  const adminLinks = [
    { label: "Add Item", icon: "/icons/add-item.png", path: "/add-item" },
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
    { label: "Reports", icon: "/icons/reports.png", path: "/reports" },
  ];

  if (loading) {
    return (
      <div className="layout-loading">
        <img src="/qborrow-logo.png" alt="QBorrow Logo" />
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div className={`app-layout ${sidebarOpen ? "" : "sidebar-closed"}`}>
      {!sidebarOpen && (
        <button
          className="floating-layout-toggle"
          onClick={() => setSidebarOpen(true)}
          aria-label="Show sidebar"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      )}

      <aside className="app-sidebar">
        <div className="app-sidebar-top">
          <div className="app-sidebar-brand">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />

            <div className="app-sidebar-brand-text">
              <h2>QBorrow</h2>
              <p>Scan • Borrow • Return</p>
            </div>
          </div>

            <button
            className="app-sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label="Hide sidebar"
            >
            <span></span>
            <span></span>
            <span></span>
            </button>
        </div>

        <nav className="app-sidebar-nav">
          {mainLinks.map((link) => (
            <NavLink
              key={link.label}
              to={link.path}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <img src={link.icon} alt="" />
              <span>{link.label}</span>
            </NavLink>
          ))}

          {userData?.role === "admin" && (
            <>
              <p className="app-admin-label">ADMIN MENU</p>

              {adminLinks.map((link) => (
                <NavLink
                  key={link.label}
                  to={link.path}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <img src={link.icon} alt="" />
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </>
          )}

          <button className="app-logout-btn" onClick={handleLogout}>
            <img src="/icons/logout.png" alt="" />
            <span>Logout</span>
          </button>
        </nav>
      </aside>

      <main className="app-main-content">
        <Outlet context={{ userData }} />
      </main>
    </div>
  );
}

export default AppLayout;