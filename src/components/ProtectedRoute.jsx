import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";

function ProtectedRoute({ children, allowedRole }) {
  const [loading, setLoading] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/login";
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          alert("User role not found.");
          window.location.href = "/login";
          return;
        }

        const userData = userSnap.data();

        if (userData.role === allowedRole) {
          setIsAllowed(true);
        } else {
          alert("Access denied. You are not allowed to open this page.");
          window.location.href = "/dashboard";
        }
      } catch (error) {
        alert("Error checking access: " + error.message);
        window.location.href = "/login";
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [allowedRole]);

  if (loading) {
    return <h2>Checking access...</h2>;
  }

  if (!isAllowed) {
    return null;
  }

  return children;
}

export default ProtectedRoute;