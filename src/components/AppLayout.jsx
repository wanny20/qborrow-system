import { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/AppLayout.css";

function AppLayout() {
  const [userData, setUserData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notificationCount, setNotificationCount] = useState(0);

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

  const currentPageTitle =
    pageTitles[location.pathname] ||
    (location.pathname.startsWith("/item/") ? "Item Details" : "QBorrow");

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
      userData?.themeMode || localStorage.getItem("qborrowTheme") || "light";

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

  async function handleLogout() {
    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      alert("Logout failed: " + error.message);
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
    {
      label: "Settings",
      icon: "/icons/settings.png",
      fallbackIcon: "⚙",
      path: "/settings",
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
    return (
      <NavLink
        key={link.label}
        to={link.path}
        className={({ isActive }) =>
          isActive ? "app-nav-link active" : "app-nav-link"
        }
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

            <div className="app-topbar-title">
              <span>Current Page</span>
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

            <section className="app-topbar-profile" aria-label="Current user">
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
            </section>
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