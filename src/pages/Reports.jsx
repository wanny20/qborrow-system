import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function Reports() {
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);

  async function fetchReportsData() {
    try {
      const itemsSnapshot = await getDocs(collection(db, "items"));
      const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));

      const itemData = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setItems(itemData);
      setRequests(requestData);
    } catch (error) {
      alert("Error loading reports: " + error.message);
    }
  }

  function checkOverdue(request) {
    if (request.approvalStatus !== "Approved") {
      return false;
    }

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  function getFrequentlyBorrowedItems() {
    const countMap = {};

    requests.forEach((request) => {
      if (!countMap[request.itemName]) {
        countMap[request.itemName] = 0;
      }

      countMap[request.itemName]++;
    });

    return Object.entries(countMap)
      .map(([itemName, count]) => ({
        itemName,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  useEffect(() => {
    fetchReportsData();
  }, []);

  const borrowingHistory = requests;
  const overdueItems = requests.filter((request) => checkOverdue(request));
  const damagedLostItems = items.filter(
    (item) => item.condition === "Damaged" || item.condition === "Lost"
  );

  const availableItems = items.filter(
    (item) => item.availability === "Available"
  );

  const borrowedItems = items.filter(
    (item) => item.availability === "Borrowed"
  );

  const frequentlyBorrowedItems = getFrequentlyBorrowedItems();

  return (
    <div>
      <h1>Reports Module</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <hr />

      <h2>Available vs Borrowed Items</h2>
      <p>
        <strong>Available Items:</strong> {availableItems.length}
      </p>
      <p>
        <strong>Borrowed Items:</strong> {borrowedItems.length}
      </p>

      <hr />

      <h2>Borrowing History</h2>

      {borrowingHistory.length === 0 ? (
        <p>No borrowing history found.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Borrower Email</th>
              <th>Purpose</th>
              <th>Borrow Date</th>
              <th>Expected Return</th>
              <th>Actual Return</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {borrowingHistory.map((request) => (
              <tr key={request.id}>
                <td>{request.itemName}</td>
                <td>{request.borrowerEmail}</td>
                <td>{request.purpose}</td>
                <td>{request.borrowDate}</td>
                <td>{request.expectedReturnDate}</td>
                <td>{request.actualReturnDate || "Not returned yet"}</td>
                <td>{request.approvalStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />

      <h2>Frequently Borrowed Items</h2>

      {frequentlyBorrowedItems.length === 0 ? (
        <p>No borrowed items yet.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Borrow Count</th>
            </tr>
          </thead>

          <tbody>
            {frequentlyBorrowedItems.map((item) => (
              <tr key={item.itemName}>
                <td>{item.itemName}</td>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />

      <h2>Overdue Items</h2>

      {overdueItems.length === 0 ? (
        <p>No overdue items.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Borrower Email</th>
              <th>Expected Return Date</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {overdueItems.map((request) => (
              <tr key={request.id}>
                <td>{request.itemName}</td>
                <td>{request.borrowerEmail}</td>
                <td>{request.expectedReturnDate}</td>
                <td>Overdue</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr />

      <h2>Damaged/Lost Items</h2>

      {damagedLostItems.length === 0 ? (
        <p>No damaged or lost items.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Condition</th>
              <th>Availability</th>
            </tr>
          </thead>

          <tbody>
            {damagedLostItems.map((item) => (
              <tr key={item.id}>
                <td>{item.itemName}</td>
                <td>{item.condition}</td>
                <td>{item.availability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Reports;