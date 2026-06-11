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

function ManageRequests() {
  const [requests, setRequests] = useState([]);

  async function fetchRequests() {
    try {
      const querySnapshot = await getDocs(collection(db, "borrowRequests"));

      const requestData = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setRequests(requestData);
    } catch (error) {
      alert("Error loading requests: " + error.message);
    }
  }

  async function handleApproveRequest(request) {
    try {
      const requestRef = doc(db, "borrowRequests", request.id);
      const itemRef = doc(db, "items", request.itemId);

      await updateDoc(requestRef, {
        approvalStatus: "Approved",
        approvedAt: serverTimestamp(),
      });

      await updateDoc(itemRef, {
        availability: "Borrowed",
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        title: "Borrow Request Approved",
        message: `Your request for ${request.itemName} has been approved.`,
        status: "Unread",
        createdAt: serverTimestamp(),
      });

      alert("Request approved successfully!");
      fetchRequests();
    } catch (error) {
      alert("Error approving request: " + error.message);
    }
  }

  async function handleRejectRequest(request) {
    try {
      const requestRef = doc(db, "borrowRequests", request.id);

      await updateDoc(requestRef, {
        approvalStatus: "Rejected",
        rejectedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: request.borrowerId,
        title: "Borrow Request Rejected",
        message: `Your request for ${request.itemName} has been rejected.`,
        status: "Unread",
        createdAt: serverTimestamp(),
      });

      alert("Request rejected successfully!");
      fetchRequests();
    } catch (error) {
      alert("Error rejecting request: " + error.message);
    }
  }

  useEffect(() => {
    fetchRequests();
  }, []);

  return (
    <div>
      <h1>Manage Borrow Requests</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <br />
      <br />

      {requests.length === 0 ? (
        <p>No borrow requests found.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Borrower Email</th>
              <th>Purpose</th>
              <th>Borrow Date</th>
              <th>Expected Return Date</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.itemName}</td>
                <td>{request.borrowerEmail}</td>
                <td>{request.purpose}</td>
                <td>{request.borrowDate}</td>
                <td>{request.expectedReturnDate}</td>
                <td>{request.approvalStatus}</td>
                <td>
                  {request.approvalStatus === "Pending" ? (
                    <>
                      <button onClick={() => handleApproveRequest(request)}>
                        Approve
                      </button>

                      <button onClick={() => handleRejectRequest(request)}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <span>No action</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default ManageRequests;