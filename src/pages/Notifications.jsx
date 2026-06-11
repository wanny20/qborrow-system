import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/";
        return;
      }

      try {
        const notificationsQuery = query(
          collection(db, "notifications"),
          where("userId", "==", user.uid)
        );

        const querySnapshot = await getDocs(notificationsQuery);

        const notificationData = querySnapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setNotifications(notificationData);
      } catch (error) {
        alert("Error loading notifications: " + error.message);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <h2>Loading notifications...</h2>;
  }

  return (
    <div>
      <h1>Notifications</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <br />
      <br />

      {notifications.length === 0 ? (
        <p>No notifications found.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Title</th>
              <th>Message</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {notifications.map((notification) => (
              <tr key={notification.id}>
                <td>{notification.title}</td>
                <td>{notification.message}</td>
                <td>{notification.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Notifications;