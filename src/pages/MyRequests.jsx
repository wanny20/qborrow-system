import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";

function MyRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  function checkOverdue(request) {
    if (request.approvalStatus !== "Approved") {
      return "N/A";
    }

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    if (today > expectedDate) {
      return "Overdue";
    }

    return "Not Overdue";
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/";
        return;
      }

      try {
        const requestsQuery = query(
          collection(db, "borrowRequests"),
          where("borrowerId", "==", user.uid)
        );

        const querySnapshot = await getDocs(requestsQuery);

        const requestData = querySnapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setRequests(requestData);
      } catch (error) {
        alert("Error loading your requests: " + error.message);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <h2>Loading your requests...</h2>;
  }

  return (
    <div>
      <h1>My Borrow Requests</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <br />
      <br />

      {requests.length === 0 ? (
        <p>You have no borrow requests yet.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Purpose</th>
              <th>Borrow Date</th>
              <th>Expected Return Date</th>
              <th>Actual Return Date</th>
              <th>Status</th>
              <th>Overdue Status</th>
              <th>Return Condition</th>
            </tr>
          </thead>

          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.itemName}</td>
                <td>{request.purpose}</td>
                <td>{request.borrowDate}</td>
                <td>{request.expectedReturnDate}</td>
                <td>{request.actualReturnDate || "Not returned yet"}</td>
                <td>{request.approvalStatus}</td>
                <td>{checkOverdue(request)}</td>
                <td>{request.returnCondition || "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default MyRequests;