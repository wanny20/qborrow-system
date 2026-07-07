import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import QRCodeGenerator from "../components/QRCodeGenerator";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/ItemDetails.css";

function ItemDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const outletContext = useOutletContext() || {};
  const { userData, schoolStatus } = outletContext;

  const { showToast } = useToast();

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [showSchoolClosedModal, setShowSchoolClosedModal] = useState(false);

  const isBorrower = userData?.role === "borrower";

  function showActionError(shortMessage, error) {
    const detailedMessage = error?.message
      ? `${shortMessage}: ${error.message}`
      : shortMessage;

    setStatusMessage(detailedMessage);
    showToast(shortMessage, "error");
  }

  function showBlockedAction(message) {
    setStatusMessage(message);
    showToast(message, "error");
  }


  function isSchoolClosed() {
    return Boolean(schoolStatus?.isSchoolClosed);
  }

  function getSchoolClosedMessage() {
    const reason = String(schoolStatus?.closureReason || "").trim();

    return reason
      ? `The school is currently closed: ${reason}`
      : "The school is currently closed.";
  }

  function handleBorrowItemClick() {
    if (isSchoolClosed()) {
      setShowSchoolClosedModal(true);
      showToast("Borrowing is temporarily unavailable", "error");
      return;
    }

    navigate(`/borrow-request/${item.id}`);
  }

  function getCategoryName(targetItem = item) {
    return (
      targetItem?.categoryName ||
      targetItem?.category ||
      targetItem?.categoryId ||
      "Uncategorized"
    );
  }

  function getItemCode(targetItem = item) {
    return targetItem?.itemCode || targetItem?.id || "No code";
  }

  function getAvailabilityClass(availability) {
    if (availability === "Available") return "available";
    if (availability === "Reserved") return "reserved";
    if (availability === "Borrowed") return "borrowed";
    if (availability === "Under Maintenance") return "maintenance";
    if (availability === "Damaged") return "damaged";
    if (availability === "Lost") return "lost";
    return "unavailable";
  }

  function getConditionClass(condition) {
    if (condition === "Good") return "good";
    if (condition === "Fair") return "fair";
    if (condition === "Damaged") return "damaged";
    if (condition === "Lost") return "lost";
    return "unknown";
  }

  async function findItemByFallback(identifier) {
    const itemsSnapshot = await getDocs(collection(db, "items"));

    const matchedDoc = itemsSnapshot.docs.find((document) => {
      const data = document.data();

      return (
        document.id === identifier ||
        data.itemCode === identifier ||
        data.barcodeValue === identifier ||
        String(data.qrValue || "").includes(identifier)
      );
    });

    if (!matchedDoc) return null;

    return {
      id: matchedDoc.id,
      ...matchedDoc.data(),
    };
  }

  async function fetchItem() {
    setLoading(true);
    setStatusMessage("");

    try {
      if (!id) {
        setItem(null);
        showBlockedAction("Item ID is missing.");
        return;
      }

      const itemRef = doc(db, "items", id);
      const itemSnap = await getDoc(itemRef);

      if (itemSnap.exists()) {
        setItem({
          id: itemSnap.id,
          ...itemSnap.data(),
        });
        return;
      }

      const fallbackItem = await findItemByFallback(id);

      if (fallbackItem) {
        setItem(fallbackItem);
        return;
      }

      setItem(null);
      showBlockedAction("Item not found.");
    } catch (error) {
      showActionError("Failed to load item", error);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItem();
  }, [id]);

  if (loading) {
    return (
      <div className="item-details-loading">
        <div className="item-details-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading item details...</h2>
          <p>Preparing item information.</p>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="item-details-page">
        <section className="item-details-empty">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h1>Item Not Found</h1>
          <p>
            {statusMessage ||
              "The item may have been deleted or the link is incorrect."}
          </p>

          <button
            type="button"
            className="item-details-primary-btn"
            onClick={() => navigate("/items")}
          >
            Back to Items
          </button>
        </section>
      </div>
    );
  }

  const isItemUnderMaintenance = item.availability === "Under Maintenance";
  const maintenanceReason = String(item.maintenanceReason || "").trim();
  const canBorrow = isBorrower && item.availability === "Available";

  return (
    <div className="item-details-page">

      {showSchoolClosedModal && (
        <div
          className="item-details-school-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="item-school-closed-title"
          onClick={() => setShowSchoolClosedModal(false)}
        >
          <section
            className="item-details-school-modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="item-details-school-modal-icon">!</div>
            <p>School Closure Mode</p>
            <h2 id="item-school-closed-title">Borrowing is temporarily unavailable</h2>
            <span>
              {getSchoolClosedMessage()} Borrow requests, item claiming, and
              returns are paused until the super admin reopens the system.
            </span>

            <button
              type="button"
              className="item-details-primary-btn"
              onClick={() => setShowSchoolClosedModal(false)}
            >
              I Understand
            </button>
          </section>
        </div>
      )}

      <section className="item-details-header item-details-header-compact">
        <div className="item-details-header-content">
          <div className="item-details-header-text">
            <span>{getItemCode(item)}</span>

            <h2>{item.itemName || "Untitled Item"}</h2>

            <p>
              Review item information, availability, condition, and scan codes in
              one clean view.
            </p>
          </div>

          <div className="item-details-header-actions item-details-header-actions-compact">
            <button
              type="button"
              className="item-details-secondary-btn"
              onClick={() => navigate("/items")}
            >
              Back to Items
            </button>
          </div>
        </div>
      </section>

      <section className="item-details-layout">
        <article className="item-details-main-card">
          <div className="item-details-image-panel">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.itemName || "Item"} />
            ) : (
              <div className="item-details-placeholder">
                {(item.itemName || "I").charAt(0)}
              </div>
            )}
          </div>

          <div className="item-details-info-panel">
            <div className="item-details-topline">
              <span>{getItemCode(item)}</span>

              <span
                className={`item-details-pill availability-${getAvailabilityClass(
                  item.availability
                )}`}
              >
                {item.availability || "Unavailable"}
              </span>
            </div>

            <h2>{item.itemName || "Untitled Item"}</h2>

            <p className="item-details-description">
              {item.description ||
                "No description has been added for this item yet."}
            </p>

            {isSchoolClosed() && isBorrower && (
              <div className="item-details-school-closed-banner" role="alert">
                <strong>Borrowing is temporarily unavailable</strong>
                <p>{getSchoolClosedMessage()}</p>
              </div>
            )}

            {isItemUnderMaintenance && (
              <div className="item-details-maintenance-banner" role="alert">
                <strong>Under Maintenance</strong>
                <p>
                  {maintenanceReason
                    ? maintenanceReason
                    : "This item is temporarily unavailable while it is being inspected or repaired."}
                </p>
              </div>
            )}

            <div className="item-details-meta-grid">
              <div>
                <span>Item ID</span>
                <strong>{item.id}</strong>
              </div>

              <div>
                <span>Category</span>
                <strong>{getCategoryName(item)}</strong>
              </div>

              <div>
                <span>Condition</span>
                <strong
                  className={`item-details-inline-pill condition-${getConditionClass(
                    item.condition
                  )}`}
                >
                  {item.condition || "Unknown"}
                </strong>
              </div>

              <div>
                <span>Max Borrow Days</span>
                <strong>{item.maxBorrowDays || "Not set"}</strong>
              </div>
            </div>

            <div className="item-details-action-panel">
              {canBorrow ? (
                <button
                  type="button"
                  className="item-details-primary-btn"
                  onClick={handleBorrowItemClick}
                >
                  {isSchoolClosed() ? "School Closed" : "Borrow This Item"}
                </button>
              ) : isBorrower ? (
                <div className="item-details-warning">
                  <strong>
                    {isItemUnderMaintenance
                      ? "Item under maintenance"
                      : "Not available for borrowing"}
                  </strong>
                  <p>
                    {isItemUnderMaintenance
                      ? maintenanceReason || "This item cannot be borrowed until the admin marks it as available again."
                      : (
                          <>
                            This item is currently marked as{" "}
                            <span>{item.availability || "Unavailable"}</span>.
                          </>
                        )}
                  </p>
                </div>
              ) : (
                <div className="item-details-warning item-details-info-note">
                  <strong>Admin View</strong>
                  <p>
                    Admins can review item information and use release or return
                    workflows from the scan shortcuts.
                  </p>
                </div>
              )}
            </div>
          </div>
        </article>

        <aside className="item-details-side-card">
          <div className="item-details-qr-header">
            <span>QR / Barcode</span>
            <p>Used for scanning during release and return.</p>
          </div>

          <div className="item-details-qr-box">
            <QRCodeGenerator
              itemId={item.id}
              itemName={item.itemName}
              itemCode={item.itemCode}
              qrValue={item.qrValue}
              barcodeValue={item.barcodeValue}
              compact
              hideActions={isBorrower}
            />
          </div>

          <div className="item-details-scan-values">
            <div>
              <span>QR Value</span>
              <p>{item.qrValue || `${window.location.origin}/item/${item.id}`}</p>
            </div>

            <div>
              <span>Barcode Value</span>
              <p>{item.barcodeValue || item.itemCode || item.id}</p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export default ItemDetails;
