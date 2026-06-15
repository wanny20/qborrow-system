import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/BorrowRequest.css";

function BorrowRequest() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  const today = getTodayDate();

  const [item, setItem] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserData, setCurrentUserData] = useState(
    outletContext?.userData || null
  );

  const [purpose, setPurpose] = useState("");
  const [borrowDate] = useState(today);
  const [expectedReturnDate, setExpectedReturnDate] = useState(today);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function getItemCode() {
    return item?.itemCode || item?.id || "No code";
  }

  function getCategoryId() {
    return item?.categoryId || item?.category || "";
  }

  function getCategoryName() {
    return item?.categoryName || item?.category || item?.categoryId || "Uncategorized";
  }

  function getBorrowerName() {
    return (
      currentUserData?.fullName ||
      currentUser?.displayName ||
      currentUser?.email ||
      "Borrower"
    );
  }

  function getSuspendedUntilDate(value) {
    if (!value) return null;

    if (typeof value?.toDate === "function") {
      return value.toDate();
    }

    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  function isBorrowerSuspended() {
    const suspendedUntilDate = getSuspendedUntilDate(
      currentUserData?.suspendedUntil
    );

    if (!suspendedUntilDate) return false;

    const now = new Date();
    return suspendedUntilDate > now;
  }

  function getSuspendedUntilLabel() {
    const suspendedUntilDate = getSuspendedUntilDate(
      currentUserData?.suspendedUntil
    );

    if (!suspendedUntilDate) return "";

    return suspendedUntilDate.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function hasDateConflict(newBorrowDate, newExpectedReturnDate, existingRequest) {
    const existingBorrowDate = existingRequest.borrowDate;
    const existingExpectedReturnDate = existingRequest.expectedReturnDate;

    if (!existingBorrowDate || !existingExpectedReturnDate) {
      return false;
    }

    return (
      newBorrowDate <= existingExpectedReturnDate &&
      newExpectedReturnDate >= existingBorrowDate
    );
  }

  async function checkRequestConflict() {
    const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));
    const activeStatuses = ["Pending", "Approved", "Borrowed"];

    const conflictingRequest = requestsSnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .find((request) => {
        if (request.itemId !== item.id) return false;
        if (!activeStatuses.includes(request.approvalStatus)) return false;

        return hasDateConflict(borrowDate, expectedReturnDate, request);
      });

    return conflictingRequest;
  }

  useEffect(() => {
    async function loadPageData(user) {
      try {
        const itemRef = doc(db, "items", itemId);
        const itemSnap = await getDoc(itemRef);

        if (!itemSnap.exists()) {
          alert("Item not found.");
          navigate("/items");
          return;
        }

        setItem({
          id: itemSnap.id,
          ...itemSnap.data(),
        });

        if (!outletContext?.userData) {
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            setCurrentUserData({
              id: userSnap.id,
              uid: user.uid,
              email: user.email,
              ...userSnap.data(),
            });
          }
        }
      } catch (error) {
        alert("Error loading borrow request form: " + error.message);
      } finally {
        setLoading(false);
      }
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        alert("Please login first.");
        navigate("/login");
        return;
      }

      setCurrentUser(user);
      loadPageData(user);
    });

    return () => unsubscribe();
  }, [itemId, navigate, outletContext?.userData]);

  async function handleSubmitRequest(e) {
    e.preventDefault();
    showStatus("", "");

    if (currentUserData?.role && currentUserData.role !== "borrower") {
      showStatus("Only borrower accounts can submit borrow requests.", "error");
      return;
    }

    if (currentUserData?.canBorrow === false || isBorrowerSuspended()) {
      showStatus(
        `Your account is temporarily suspended from borrowing until ${getSuspendedUntilLabel()} due to overdue returns.`,
        "error"
      );
      return;
    }

    if (!purpose.trim()) {
      showStatus("Please enter your purpose of borrowing.", "error");
      return;
    }

    if (borrowDate !== today) {
      showStatus("Borrow date must be today.", "error");
      return;
    }

    if (expectedReturnDate < today) {
      showStatus("Expected return date cannot be in the past.", "error");
      return;
    }

    if (expectedReturnDate < borrowDate) {
      showStatus("Expected return date cannot be earlier than the borrow date.", "error");
      return;
    }

    if (!item) {
      showStatus("Item data is missing.", "error");
      return;
    }

    if (item.availability !== "Available") {
      showStatus("This item is not available for borrowing right now.", "error");
      return;
    }

    setSubmitting(true);

    try {
      const conflictingRequest = await checkRequestConflict();

      if (conflictingRequest) {
        showStatus(
          `This item already has an active request from ${conflictingRequest.borrowDate} to ${conflictingRequest.expectedReturnDate}. Please choose another item.`,
          "error"
        );
        setSubmitting(false);
        return;
      }

      await addDoc(collection(db, "borrowRequests"), {
        itemId: item.id,
        itemCode: getItemCode(),
        itemName: item.itemName || "Untitled Item",
        categoryId: getCategoryId(),
        categoryName: getCategoryName(),

        borrowerId: currentUser.uid,
        borrowerEmail: currentUser.email,
        borrowerName: getBorrowerName(),

        purpose: purpose.trim(),
        borrowDate,
        expectedReturnDate,
        actualReturnDate: "",

        approvalStatus: "Pending",

        assignedAdminId: "",
        approvedBy: "",
        releasedBy: "",
        returnedBy: "",

        returnCondition: "",
        damageLostReport: "",

        createdAt: serverTimestamp(),
        approvedAt: "",
        rejectedAt: "",
        releasedAt: "",
        returnedAt: "",
      });

      await addDoc(collection(db, "notifications"), {
        userId: currentUser.uid,
        targetRole: "borrower",
        categoryId: getCategoryId(),
        title: "Borrow Request Submitted",
        message: `Your request for ${item.itemName} has been submitted and is waiting for admin approval.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/my-requests",
      });

      await addDoc(collection(db, "notifications"), {
        userId: "",
        targetRole: "categoryAdmin",
        categoryId: getCategoryId(),
        title: "New Borrow Request",
        message: `${getBorrowerName()} requested ${item.itemName}.`,
        status: "Unread",
        createdAt: serverTimestamp(),
        link: "/manage-requests",
      });

      showStatus("Borrow request submitted successfully. Redirecting...", "success");

      setTimeout(() => {
        navigate("/my-requests");
      }, 700);
    } catch (error) {
      showStatus("Error submitting request: " + error.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="borrow-request-loading">
        <div className="borrow-request-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading borrow request...</h2>
          <p>Preparing item and borrower information.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="borrow-request-page">
      <section className="borrow-request-header">
        <div>
          <p className="qb-kicker">Borrow Request</p>

          <h1>Request Item</h1>

          <p>
            Submit a borrow request for this item. The borrow date is
            automatically set to today and cannot be edited.
          </p>
        </div>

        <button
          type="button"
          className="borrow-request-secondary-btn"
          onClick={() => navigate(`/item/${itemId}`)}
        >
          Back to Item
        </button>
      </section>

      <section className="borrow-request-layout">
        <aside className="borrow-request-item-card">
          <div className="borrow-request-item-media">
            {item?.imageUrl ? (
              <img src={item.imageUrl} alt={item.itemName || "Item"} />
            ) : (
              <span>{(item?.itemName || "Item").charAt(0)}</span>
            )}
          </div>

          <div className="borrow-request-item-info">
            <span className="borrow-request-item-code">{getItemCode()}</span>
            <h2>{item?.itemName || "Untitled Item"}</h2>
            <p>{item?.description || "No description added for this item yet."}</p>

            <div className="borrow-request-meta-grid">
              <div>
                <span>Category</span>
                <strong>{getCategoryName()}</strong>
              </div>

              <div>
                <span>Condition</span>
                <strong>{item?.condition || "Unknown"}</strong>
              </div>

              <div>
                <span>Availability</span>
                <strong>{item?.availability || "Unavailable"}</strong>
              </div>

              <div>
                <span>Max Borrow Days</span>
                <strong>{item?.maxBorrowDays || "Not set"}</strong>
              </div>
            </div>
          </div>
        </aside>

        <section className="borrow-request-form-card">
          <div className="borrow-request-form-heading">
            <h2>Request Form</h2>
            <p>
              Your request will be sent as <strong>Pending</strong>. The item
              becomes reserved only after admin approval.
            </p>
          </div>

          {statusMessage && (
            <div
              className={`borrow-request-status borrow-request-status-${statusType}`}
              role="status"
            >
              {statusMessage}
            </div>
          )}

          {item?.availability !== "Available" && (
            <div className="borrow-request-warning">
              <strong>Item not available</strong>
              <p>
                This item is currently marked as {item?.availability}. You cannot
                request it right now.
              </p>
            </div>
          )}

          {currentUserData?.role && currentUserData.role !== "borrower" && (
            <div className="borrow-request-warning">
              <strong>Admin account detected</strong>
              <p>Only borrower accounts can submit borrow requests.</p>
            </div>
          )}

          <form onSubmit={handleSubmitRequest}>
            <div className="borrow-request-field">
              <label className="qb-label" htmlFor="purpose">
                Purpose of Borrowing
              </label>

              <textarea
                id="purpose"
                placeholder="Example: For classroom presentation"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              />
            </div>

            <div className="borrow-request-date-grid">
              <div className="borrow-request-field">
                <label className="qb-label" htmlFor="borrow-date">
                  Borrow Date
                </label>

                <input
                  id="borrow-date"
                  type="date"
                  value={borrowDate}
                  min={today}
                  readOnly
                />

                <p>Borrow date is automatically set to today.</p>
              </div>

              <div className="borrow-request-field">
                <label className="qb-label" htmlFor="expected-return-date">
                  Expected Return Date
                </label>

                <input
                  id="expected-return-date"
                  type="date"
                  value={expectedReturnDate}
                  min={today}
                  onChange={(e) => setExpectedReturnDate(e.target.value)}
                  required
                />

                <p>Select today or a future date only.</p>
              </div>
            </div>

            <div className="borrow-request-actions">
              <button
                type="button"
                className="borrow-request-secondary-btn"
                onClick={() => navigate(`/item/${itemId}`)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="borrow-request-primary-btn"
                disabled={submitting || item?.availability !== "Available"}
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}

export default BorrowRequest;