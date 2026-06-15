import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";

function ProtectedRoute({ children, allowedRoles }) {
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      setLoading(true);

      if (!user) {
        setIsLoggedIn(false);
        setIsAllowed(false);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          setIsLoggedIn(false);
          setIsAllowed(false);
          setLoading(false);
          return;
        }

        const userData = userSnap.data();
        const userRole = userData?.role;

        setIsLoggedIn(true);

        /*
          IMPORTANT:
          If allowedRoles is not provided, any logged-in user with a valid
          user document can access the page.
        */
        if (!allowedRoles) {
          setIsAllowed(true);
          setLoading(false);
          return;
        }

        if (Array.isArray(allowedRoles)) {
          setIsAllowed(allowedRoles.includes(userRole));
        } else {
          setIsAllowed(userRole === allowedRoles);
        }
      } catch (error) {
        console.error("Protected route error:", error);
        setIsLoggedIn(false);
        setIsAllowed(false);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [allowedRoles]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--qb-heading-font)",
          fontWeight: 900,
          color: "var(--qb-foreground)",
        }}
      >
        Checking permission...
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!isAllowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;