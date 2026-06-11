import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function ReturnConfirmation() {
  const [requests, setRequests] = useState([]);

  function checkOverdue(expectedReturnDate) {
    const today = new Date();
    const returnDate = new Date(expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    returnDate.setHours(0, 0, 0, 0);

    if (today > returnDate) {
      return "Overdue";
    }

    return "Not Overdue";
  }

  async function fetchApprovedRequests() {
    try {
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const requestData = querySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((request) => request.approvalStatus === "Approved");

      setRequests(requestData);
    } catch (error) {
      alert("Error loading approved requests: " + error.message);
    }
  }

  async function handleReturn(request) {
    const actualReturnDate = prompt("Enter actual return date: YYYY-MM-DD");

    if (!actualReturnDate) {
      alert("Actual return date is required.");
      return;
    }

    const returnCondition = prompt(
      "Enter condition upon return: Good, Fair, Damaged, or Lost"
    );

    if (!returnCondition) {
      alert("Return condition is required.");
      return;
    }

    let damageLostReport = "";

    if (
      returnCondition.toLowerCase() === "damaged" ||
      returnCondition.toLowerCase() === "lost"
    ) {
      damageLostReport = prompt("Enter damage/lost report:");

      if (!damageLostReport) {
        alert("Damage/lost report is required.");
        return;
      }
    }

    try {
      const requestRef = doc(db, "borrowRequests", request.id);
      const itemRef = doc(db, "items", request.itemId);

      await updateDoc(requestRef, {
        approvalStatus: "Returned",
        actualReturnDate: actualReturnDate,
        returnCondition: returnCondition,
        damageLostReport: damageLostReport,
        returnedAt: serverTimestamp(),
      });

      if (returnCondition.toLowerCase() === "damaged") {
        await updateDoc(itemRef, {
          availability: "Unavailable",
          condition: "Damaged",
          updatedAt: serverTimestamp(),
        });
      } else if (returnCondition.toLowerCase() === "lost") {
        await updateDoc(itemRef, {
          availability: "Unavailable",
          condition: "Lost",
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(itemRef, {
          availability: "Available",
          condition: returnCondition,
          updatedAt: serverTimestamp(),
        });
      }

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        title: "Item Return Confirmed",
        message: `${request.itemName} has been returned successfully.`,
        status: "Unread",
        createdAt: serverTimestamp(),
      });

      alert("Item return confirmed successfully!");
      fetchApprovedRequests();
    } catch (error) {
      alert("Error confirming return: " + error.message);
    }
  }

  useEffect(() => {
    fetchApprovedRequests();
  }, []);

  return (
    <div>
      <h1>Return Confirmation</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <br />
      <br />

      {requests.length === 0 ? (
        <p>No approved borrowed items for return.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Borrower Email</th>
              <th>Borrow Date</th>
              <th>Expected Return Date</th>
              <th>Overdue Status</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.itemName}</td>
                <td>{request.borrowerEmail}</td>
                <td>{request.borrowDate}</td>
                <td>{request.expectedReturnDate}</td>
                <td>{checkOverdue(request.expectedReturnDate)}</td>
                <td>{request.approvalStatus}</td>
                <td>
                  <button onClick={() => handleReturn(request)}>
                    Confirm Return
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default ReturnConfirmation;