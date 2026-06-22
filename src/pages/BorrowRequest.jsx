import { useEffect, useRef, useState } from "react"; 
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query as firestoreQuery,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/BorrowRequest.css";

function BorrowRequest() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { setUnsavedChanges, guardedNavigate } = outletContext;
  const { showToast } = useToast();

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function addDaysToDate(dateString, daysToAdd) {
    const [year, month, day] = String(dateString).split("-").map(Number);

    if (!year || !month || !day) return dateString;

    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + daysToAdd);

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
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formTouched, setFormTouched] = useState(false);

  const submitLockRef = useRef(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }
function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function markFormChanged() {
  setFormTouched(true);
}

function sanitizeRequestText(value) {
  return String(value || "").replace(/[<>`]/g, "");
}

function validateBorrowRequestForm() {
  const errors = {};

  if (!purpose.trim()) {
    errors.purpose = "Purpose of borrowing is required.";
  }

  if (!expectedReturnDate) {
    errors.expectedReturnDate = "Expected return date is required.";
  } else if (expectedReturnDate < today) {
    errors.expectedReturnDate = "Expected return date cannot be in the past.";
  } else if (expectedReturnDate < borrowDate) {
    errors.expectedReturnDate =
      "Expected return date cannot be earlier than the borrow date.";
  }

  const maxExpectedReturnDate = getMaxExpectedReturnDate();

  if (
    expectedReturnDate &&
    maxExpectedReturnDate &&
    expectedReturnDate > maxExpectedReturnDate
  ) {
    errors.expectedReturnDate = `Expected return date cannot exceed the item's max borrow limit. Latest allowed return date is ${maxExpectedReturnDate}.`;
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}
function validateBorrowRequestField(fieldName) {
  setFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "purpose") {
      if (!purpose.trim()) {
        nextErrors.purpose = "Purpose of borrowing is required.";
      } else {
        delete nextErrors.purpose;
      }
    }

    if (fieldName === "expectedReturnDate") {
      if (!expectedReturnDate) {
        nextErrors.expectedReturnDate = "Expected return date is required.";
      } else if (expectedReturnDate < today) {
        nextErrors.expectedReturnDate =
          "Expected return date cannot be in the past.";
      } else if (expectedReturnDate < borrowDate) {
        nextErrors.expectedReturnDate =
          "Expected return date cannot be earlier than the borrow date.";
      } else if (
        expectedReturnDate &&
        getMaxExpectedReturnDate() &&
        expectedReturnDate > getMaxExpectedReturnDate()
      ) {
        nextErrors.expectedReturnDate = `Expected return date cannot exceed the item's max borrow limit. Latest allowed return date is ${getMaxExpectedReturnDate()}.`;
      } else {
        delete nextErrors.expectedReturnDate;
      }
    }

    return nextErrors;
  });
}
  function getItemCode() {
    return item?.itemCode || item?.id || "No code";
  }

  function getCategoryId() {
    return item?.categoryId || item?.category || "";
  }

  function getCategoryName() {
    return (
      item?.categoryName ||
      item?.category ||
      item?.categoryId ||
      "Uncategorized"
    );
  }

  function getBorrowerName() {
    return (
      currentUserData?.fullName ||
      currentUser?.displayName ||
      currentUser?.email ||
      "Borrower"
    );
  }

  function cleanDisplay(value, fallback = "Not set") {
    const cleanedValue = String(value || "").trim();
    return cleanedValue || fallback;
  }

  function getBorrowerUserType() {
    return cleanDisplay(currentUserData?.userType, "Student");
  }

  function getBorrowerIdNumber() {
    const borrowerType = getBorrowerUserType();

    if (borrowerType === "Faculty" || borrowerType === "Staff") {
      return cleanDisplay(currentUserData?.employeeId);
    }

    return cleanDisplay(currentUserData?.studentNumber);
  }

  function getBorrowerYearSection() {
    const values = [
      currentUserData?.yearLevel,
      currentUserData?.section,
    ].filter(Boolean);

    return values.length > 0 ? values.join(" - ") : "Not set";
  }

  function getBorrowerDetailsSnapshot() {
    const borrowerType = getBorrowerUserType();

    return {
      borrowerUserType: borrowerType,
      borrowerStudentNumber:
        borrowerType === "Student" ? String(currentUserData?.studentNumber || "").trim() : "",
      borrowerEmployeeId:
        borrowerType === "Faculty" || borrowerType === "Staff"
          ? String(currentUserData?.employeeId || "").trim()
          : "",
      borrowerCourseDepartment: String(currentUserData?.courseDepartment || "").trim(),
      borrowerYearLevel:
        borrowerType === "Student" ? String(currentUserData?.yearLevel || "").trim() : "",
      borrowerSection:
        borrowerType === "Student" ? String(currentUserData?.section || "").trim() : "",
      borrowerMobileNumber: String(currentUserData?.mobileNumber || "").trim(),
    };
  }

  function getMaxBorrowDays() {
    const parsedMaxDays = Number(item?.maxBorrowDays);

    if (!Number.isFinite(parsedMaxDays) || parsedMaxDays <= 0) {
      return null;
    }

    return Math.floor(parsedMaxDays);
  }

  function getMaxExpectedReturnDate() {
    const maxBorrowDays = getMaxBorrowDays();

    if (!maxBorrowDays) {
      return "";
    }

    return addDaysToDate(borrowDate, maxBorrowDays);
  }

  function getMaxBorrowDaysLabel() {
    const maxBorrowDays = getMaxBorrowDays();

    if (!maxBorrowDays) {
      return "No maximum limit set for this item.";
    }

    return `Maximum allowed borrowing period: ${maxBorrowDays} day${
      maxBorrowDays === 1 ? "" : "s"
    }.`;
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

  function getBorrowRestrictionMessage() {
    const suspendedUntilLabel = getSuspendedUntilLabel();

    if (suspendedUntilLabel) {
      return `Your account is temporarily suspended from borrowing until ${suspendedUntilLabel} due to overdue returns.`;
    }

    return "Your account is currently restricted from borrowing. Please contact the administrator.";
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
    if (!item?.id) return null;

    const activeStatuses = ["Approved", "Borrowed"];

    const requestsQuery = firestoreQuery(
      collection(db, "borrowRequests"),
      where("itemId", "==", item.id)
    );

    const requestsSnapshot = await getDocs(requestsQuery);

    const conflictingRequest = requestsSnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .find((request) => {
        if (!activeStatuses.includes(request.approvalStatus)) return false;

        return hasDateConflict(borrowDate, expectedReturnDate, request);
      });

    return conflictingRequest;
  }

  useEffect(() => {
    async function loadPageData(user) {
      setLoading(true);

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

        if (outletContext?.userData) {
          setCurrentUserData(outletContext.userData);
        } else {
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

useEffect(() => {
  setUnsavedChanges?.(
    formTouched && !submitting && !requestSubmitted,
    "You have an unfinished borrow request. Leaving this page will discard your progress."
  );

  return () => {
    setUnsavedChanges?.(false);
  };
}, [formTouched, submitting, requestSubmitted, setUnsavedChanges]);

async function handleSubmitRequest(e) {
  e.preventDefault();

  if (submitLockRef.current || submitting || requestSubmitted) {
    return;
  }

showStatus("", "");

const isValid = validateBorrowRequestForm();

if (!isValid) {
  return;
}

submitLockRef.current = true;
setSubmitting(true);

let submittedSuccessfully = false;

  try {
    if (currentUserData?.role && currentUserData.role !== "borrower") {
      showStatus("Only borrower accounts can submit borrow requests.", "error");
      return;
    }

    if (currentUserData?.canBorrow === false || isBorrowerSuspended()) {
      showStatus(getBorrowRestrictionMessage(), "error");
      return;
    }


    if (borrowDate !== today) {
      showStatus("Borrow date must be today.", "error");
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


    const conflictingRequest = await checkRequestConflict();

    if (conflictingRequest) {
showStatus(
  "This item already has an active request. Please wait until the current request is approved, rejected, cancelled, or auto-rejected.",
  "error"
);
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
      ...getBorrowerDetailsSnapshot(),

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
  categoryName: getCategoryName(),
  title:
    getBorrowerUserType() === "Faculty"
      ? "Priority Faculty Borrow Request"
      : "New Borrow Request",
  message:
    getBorrowerUserType() === "Faculty"
      ? `PRIORITY: Faculty ${getBorrowerName()} requested ${item.itemName}.`
      : `${getBorrowerName()} requested ${item.itemName}.`,
  priority: getBorrowerUserType() === "Faculty" ? "High" : "Normal",
  borrowerUserType: getBorrowerUserType(),
  status: "Unread",
  createdAt: serverTimestamp(),
  link: "/manage-requests",
});

submittedSuccessfully = true;
setRequestSubmitted(true);
setFormTouched(false);
setUnsavedChanges?.(false);

showToast("Borrow Request Submitted", "success");

setTimeout(() => {
  navigate("/my-requests");
}, 700);

  } catch (error) {
    showStatus("Error submitting request: " + error.message, "error");
  } finally {
    if (!submittedSuccessfully) {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }
}

  const maxExpectedReturnDate = getMaxExpectedReturnDate();

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
<section className="borrow-request-header borrow-request-header-compact">
  <div className="borrow-request-header-content">
    <div className="borrow-request-header-text">
      <h1>Borrow Request</h1>

      <p>
        Submit a request for this item. The borrow date is automatically set to
        today, and the item will only be reserved after admin approval.
      </p>
    </div>

    <button
      type="button"
      className="borrow-request-secondary-btn borrow-request-header-back-btn"
      onClick={() => {
  if (guardedNavigate) {
    guardedNavigate(`/item/${itemId}`);
    return;
  }

  navigate(`/item/${itemId}`);
}}
    >
      Back to Item
    </button>
  </div>
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

          {currentUserData?.role === "borrower" && (
            <div className="borrow-request-borrower-preview">
              <span className="qb-kicker">Borrower Details</span>

              <div className="borrow-request-meta-grid">
                <div>
                  <span>User Type</span>
                  <strong>{getBorrowerUserType()}</strong>
                </div>

                <div>
                  <span>ID Number</span>
                  <strong>{getBorrowerIdNumber()}</strong>
                </div>

                <div>
                  <span>Course / Department</span>
                  <strong>{cleanDisplay(currentUserData?.courseDepartment)}</strong>
                </div>

                <div>
                  <span>Year / Section</span>
                  <strong>{getBorrowerYearSection()}</strong>
                </div>

                <div>
                  <span>Mobile Number</span>
                  <strong>{cleanDisplay(currentUserData?.mobileNumber)}</strong>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitRequest} noValidate>
<div className="borrow-request-field">
  <label className="qb-label" htmlFor="purpose">
    Purpose of Borrowing <span className="required-star">*</span>
  </label>

  <textarea
    id="purpose"
    className={fieldErrors.purpose ? "input-error" : ""}
    placeholder="Example: For classroom presentation"
    value={purpose}
    onFocus={() => clearFieldError("purpose")}
    onBlur={() => validateBorrowRequestField("purpose")}
onChange={(e) => {
  const sanitizedValue = sanitizeRequestText(e.target.value);

  markFormChanged();
  setPurpose(sanitizedValue);
  clearFieldError("purpose");
}}
    disabled={submitting || requestSubmitted}
  />

  {fieldErrors.purpose && (
    <p className="field-error-message">{fieldErrors.purpose}</p>
  )}
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
    Expected Return Date <span className="required-star">*</span>
  </label>

  <input
    id="expected-return-date"
    type="date"
    className={fieldErrors.expectedReturnDate ? "input-error" : ""}
    value={expectedReturnDate}
    min={today}
    max={maxExpectedReturnDate || undefined}
    onBlur={() => validateBorrowRequestField("expectedReturnDate")}
    onFocus={() => clearFieldError("expectedReturnDate")}
 onChange={(e) => {
  markFormChanged();
  setExpectedReturnDate(e.target.value);
  clearFieldError("expectedReturnDate");
}}
    disabled={submitting || requestSubmitted}
  />

  {fieldErrors.expectedReturnDate && (
    <p className="field-error-message">{fieldErrors.expectedReturnDate}</p>
  )}

  <p>
    {maxExpectedReturnDate
      ? `${getMaxBorrowDaysLabel()} Latest allowed return date: ${maxExpectedReturnDate}.`
      : "Select today or a future date only."}
  </p>
</div>
            </div>

            <div className="borrow-request-actions">
            <button
              type="button"
              className="borrow-request-secondary-btn"
              onClick={() => {
  if (guardedNavigate) {
    guardedNavigate(`/item/${itemId}`);
    return;
  }

  navigate(`/item/${itemId}`);
}}
              disabled={submitting || requestSubmitted}
            >
              Cancel
            </button>

              <button
                type="submit"
                className="borrow-request-primary-btn"
                disabled={
                  submitting ||
                  requestSubmitted ||
                  item?.availability !== "Available"
                }
              >
                {requestSubmitted
                  ? "Submitted"
                  : submitting
                  ? "Submitting..."
                  : "Submit Request"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}

export default BorrowRequest;
