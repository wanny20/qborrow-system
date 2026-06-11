import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";

function BorrowRequest() {
  const { itemId } = useParams();

  const [item, setItem] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  const [purpose, setPurpose] = useState("");
  const [borrowDate, setBorrowDate] = useState("");
  const [expectedReturnDate, setExpectedReturnDate] = useState("");

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadItem() {
      try {
        const itemRef = doc(db, "items", itemId);
        const itemSnap = await getDoc(itemRef);

        if (itemSnap.exists()) {
          setItem({
            id: itemSnap.id,
            ...itemSnap.data(),
          });
        } else {
          alert("Item not found.");
          window.location.href = "/items";
        }
      } catch (error) {
        alert("Error loading item: " + error.message);
      }

      setLoading(false);
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        alert("Please login first.");
        window.location.href = "/";
        return;
      }

      setCurrentUser(user);
      loadItem();
    });

    return () => unsubscribe();
  }, [itemId]);

  async function handleSubmitRequest(e) {
    e.preventDefault();

    if (!purpose || !borrowDate || !expectedReturnDate) {
      alert("Please fill in all fields.");
      return;
    }

    if (item.availability !== "Available") {
      alert("This item is not available for borrowing.");
      return;
    }

    try {
        await addDoc(collection(db, "borrowRequests"), {
        itemId: item.id,
        itemName: item.itemName,
        borrowerId: currentUser.uid,
        borrowerEmail: currentUser.email,
        purpose: purpose,
        borrowDate: borrowDate,
        expectedReturnDate: expectedReturnDate,
        actualReturnDate: "",
        approvalStatus: "Pending",
        returnCondition: "",
        damageLostReport: "",
        createdAt: serverTimestamp(),
        });

        await addDoc(collection(db, "notifications"), {
        userId: currentUser.uid,
        title: "Borrow Request Submitted",
        message: `Your request for ${item.itemName} has been submitted and is waiting for admin approval.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        });

      alert("Borrow request submitted successfully!");
      window.location.href = "/dashboard";
    } catch (error) {
      alert("Error submitting request: " + error.message);
    }
  }

  if (loading) {
    return <h2>Loading borrow request form...</h2>;
  }

  return (
    <div>
      <h1>Borrow Request Form</h1>

      {item && (
        <div>
          <p>
            <strong>Item Name:</strong> {item.itemName}
          </p>
          <p>
            <strong>Category:</strong> {item.category}
          </p>
          <p>
            <strong>Condition:</strong> {item.condition}
          </p>
          <p>
            <strong>Availability:</strong> {item.availability}
          </p>
        </div>
      )}

      <hr />

      <form onSubmit={handleSubmitRequest}>
        <div>
          <label>Purpose of Borrowing</label>
          <br />
          <textarea
            placeholder="Example: For classroom presentation"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>

        <br />

        <div>
          <label>Borrow Date</label>
          <br />
          <input
            type="date"
            value={borrowDate}
            onChange={(e) => setBorrowDate(e.target.value)}
          />
        </div>

        <br />

        <div>
          <label>Expected Return Date</label>
          <br />
          <input
            type="date"
            value={expectedReturnDate}
            onChange={(e) => setExpectedReturnDate(e.target.value)}
          />
        </div>

        <br />

        <button type="submit">Submit Borrow Request</button>
      </form>

      <br />

      <button onClick={() => (window.location.href = `/item/${itemId}`)}>
        Back to Item Details
      </button>
    </div>
  );
}

export default BorrowRequest;