import { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/AppLayout.css";

function AppLayout() {
  const [userData, setUserData] = useState(null);

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

  const navigate = useNavigate();
  const location = useLocation();

  const pageTitles = {
    "/dashboard": "Dashboard",
    "/items": "Item Inventory",
    "/add-item": "Add Item",
    "/manage-requests": "Manage Requests",
    "/release-item": "Release Item",
    "/return-confirmation": "Return Confirmation",
    "/reports": "Reports",
    "/scan-qr": "Scan QR Code",
    "/my-requests": "My Borrow Requests",
    "/notifications": "Notifications",
    "/user-management": "User Management",
    "/settings": "Settings",
  };

const currentPath = location.pathname;

const currentPageTitle =
  pageTitles[currentPath] ||
  (currentPath.startsWith("/dashboard-list") ? "Dashboard" : "") ||
  (currentPath.startsWith("/dashboard-items") ? "Dashboard" : "") ||
  (currentPath.startsWith("/dashboard-requests") ? "Dashboard" : "") ||
  (currentPath.startsWith("/item/") ? "Item Details" : "") ||
  (currentPath.startsWith("/edit-item") ? "Edit Item" : "") ||
  (currentPath.startsWith("/borrow-request") ? "Borrow Request" : "") ||
  "QBorrow";

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

  const isBorrower = userData?.role === "borrower";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isSuperAdmin = userData?.role === "superAdmin";
  const isAdmin = isCategoryAdmin || isSuperAdmin;

  const roleLabel = useMemo(() => {
    if (isSuperAdmin) return "Super Admin";
    if (isCategoryAdmin) return "Category Admin";
    return "Borrower";
  }, [isSuperAdmin, isCategoryAdmin]);

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
          alert("No user role found in Firestore.");
          await signOut(auth);
          navigate("/login");
        }
      } catch (error) {
        alert("Error loading user data: " + error.message);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

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

    useEffect(() => {
      const savedTheme =
        localStorage.getItem("qborrowTheme") || userData?.themeMode || "light";

      document.documentElement.setAttribute("data-theme", savedTheme);
      localStorage.setItem("qborrowTheme", savedTheme);
    }, [userData?.themeMode]);

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

function handleLogout() {
  if (loggingOut) return;

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
    setShowLogoutConfirm(false);
    navigate("/");
  } catch (error) {
    alert("Logout failed: " + error.message);
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
    {
      label: "Reports",
      icon: "/icons/reports.png",
      fallbackIcon: "≡",
      path: "/reports",
    },
  ];

  const superAdminLinks = [
    {
      label: "User Management",
      icon: "/icons/manage.png",
      fallbackIcon: "◎",
      path: "/user-management",
    },
  ];

function renderNavLink(link) {
  const isActive = activeSidebarPath === link.path;

  return (
    <NavLink
      key={link.label}
      to={link.path}
      className={isActive ? "app-nav-link active" : "app-nav-link"}
      onClick={() => {
        if (window.innerWidth <= 820) {
          setSidebarOpen(false);
        }
      }}
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
    </NavLink>
  );
}

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
            onClick={() => navigate("/dashboard")}
            aria-label="Go to dashboard"
          >
            <span className="app-brand-logo">
              <img src="/qborrow-logo.png" alt="" />
            </span>

            <span className="app-sidebar-brand-text">
              <strong>QBorrow</strong>
              <small>Scan • Borrow • Return</small>
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
          <p className="app-nav-label">Main Menu</p>
          {sharedLinks.map(renderNavLink)}

          {isBorrower && (
            <>
              <p className="app-nav-label">Borrower Menu</p>
              {borrowerLinks.map(renderNavLink)}
            </>
          )}

          {isAdmin && (
            <>
              <p className="app-nav-label">Admin Menu</p>
              {adminLinks.map(renderNavLink)}
            </>
          )}

          {isSuperAdmin && (
            <>
              <p className="app-nav-label">Super Admin</p>
              {superAdminLinks.map(renderNavLink)}
            </>
          )}
        </nav>

        <button type="button" className="app-logout-btn" onClick={handleLogout}>
          <span className="app-nav-icon">
            <img src="/icons/logout.png" alt="" />
          </span>
          <span>Logout</span>
        </button>
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

<div className="app-topbar-title" aria-label="Current page">
  <strong>{currentPageTitle}</strong>
</div>
          </div>

          <div className="app-topbar-right">
            <button
              type="button"
              className="app-topbar-notification"
              onClick={() => navigate("/notifications")}
              aria-label="Open notifications"
            >
              <span className="app-topbar-notification-icon">!</span>
              <span>Notifications</span>

              {notificationCount > 0 && (
                <strong>{notificationCount > 99 ? "99+" : notificationCount}</strong>
              )}
            </button>

              <button
                type="button"
                className="app-topbar-profile"
                onClick={() => navigate("/settings")}
                aria-label="Open profile settings"
                title="Open Settings"
              >
                <div className="app-topbar-avatar">
                  {userData?.photoURL ? (
                    <img
                      src={userData.photoURL}
                      alt={userData.fullName || "Profile"}
                    />
                  ) : (
                    <span>{getInitials(userData?.fullName, userData?.email)}</span>
                  )}
                </div>

                <div>
                  <strong>{userData?.fullName || "QBorrow User"}</strong>
                  <span>{roleLabel}</span>
                </div>
              </button>
              <button
  type="button"
  className="app-topbar-logout"
  onClick={handleLogout}
  aria-label="Logout"
>
  <span className="app-topbar-logout-icon">↪</span>
  <span>Logout</span>
</button>
          </div>
        </header>

        <div className="app-page-content">
          <Outlet context={{ userData }} />
        </div>
      </main>
    </div>
  );
}

export default AppLayout;