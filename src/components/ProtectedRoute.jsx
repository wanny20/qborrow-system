import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/ProtectedRoute.css";

function ProtectedRoute({ children, allowedRoles }) {
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (isMounted) {
        setChecking(true);
      }

      try {
        if (!firebaseUser) {
          if (!isMounted) return;

          setCurrentUser(null);
          setUserData(null);
          return;
        }

        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!isMounted) return;

        if (!userSnap.exists()) {
          setCurrentUser(firebaseUser);
          setUserData(null);
          return;
        }

        setCurrentUser(firebaseUser);
        setUserData({
          id: userSnap.id,
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          ...userSnap.data(),
        });
      } catch (error) {
        console.error("Protected route error:", error);

        if (!isMounted) return;

        setCurrentUser(null);
        setUserData(null);
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <main className="protected-route-loading" aria-label="Checking access">
        <section className="protected-route-card">
          <div className="protected-route-logo-wrap">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          </div>

          <div className="protected-route-copy">
            <p>Secure Access Check</p>
            <h2>Checking access...</h2>
            <span>Verifying your QBorrow account and role permissions.</span>
          </div>

          <div className="protected-route-progress" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!userData?.role) {
    return <Navigate to="/login" replace />;
  }

  const isForcePasswordPage = location.pathname === "/force-password-change";

  const needsFirstTimeSetup =
    userData?.termsAccepted !== true || userData?.mustChangePassword === true;

  if (needsFirstTimeSetup && !isForcePasswordPage) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (!needsFirstTimeSetup && isForcePasswordPage) {
    return <Navigate to="/dashboard" replace />;
  }

  if (allowedRoles?.length && !allowedRoles.includes(userData.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
