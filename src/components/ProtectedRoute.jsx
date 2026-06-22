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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setChecking(true);

      try {
        if (!firebaseUser) {
          setCurrentUser(null);
          setUserData(null);
          return;
        }

        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDoc(userRef);

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
        setCurrentUser(null);
        setUserData(null);
      } finally {
        setChecking(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="protected-route-loading">
        <div className="protected-route-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Checking access...</h2>
          <p>Verifying your QBorrow account and role permissions.</p>
        </div>
      </div>
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