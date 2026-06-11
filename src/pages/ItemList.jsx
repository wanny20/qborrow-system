import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, useOutletContext } from "react-router-dom";
import { db, auth } from "../firebase/firebaseConfig";
import QRCodeGenerator from "../components/QRCodeGenerator";
import "../styles/ItemList.css";

function ItemList() {
  const [items, setItems] = useState([]);
  const [localUserData, setLocalUserData] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const outletContext = useOutletContext();
  const userData = outletContext?.userData || localUserData;

  async function fetchItems() {
    try {
      const querySnapshot = await getDocs(collection(db, "items"));

      const itemData = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setItems(itemData);
    } catch (error) {
      alert("Error loading items: " + error.message);
    }
  }

  async function handleDeleteItem(itemId) {
    const confirmDelete = confirm("Are you sure you want to delete this item?");

    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "items", itemId));
      alert("Item deleted successfully!");
      fetchItems();
    } catch (error) {
      alert("Error deleting item: " + error.message);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setLocalUserData(userSnap.data());
        }

        await fetchItems();
      } catch (error) {
        alert("Error loading item list: " + error.message);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  const filteredItems = items.filter((item) => {
    const itemName = item.itemName || "";
    const category = item.category || "";
    const condition = item.condition || "";
    const description = item.description || "";

    const matchesSearch =
      itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      condition.toLowerCase().includes(searchTerm.toLowerCase()) ||
      description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAvailability =
      availabilityFilter === "All" || item.availability === availabilityFilter;

    return matchesSearch && matchesAvailability;
  });

  function getAvailabilityClass(availability) {
    if (availability === "Available") return "available";
    if (availability === "Borrowed") return "borrowed";
    return "unavailable";
  }

  function getConditionClass(condition) {
    if (condition === "Good") return "good";
    if (condition === "Fair") return "fair";
    if (condition === "Damaged") return "damaged";
    if (condition === "Lost") return "lost";
    return "unknown";
  }

  if (loading) {
    return (
      <div className="inventory-loading">
        <img src="/qborrow-logo.png" alt="QBorrow Logo" />
        <h2>Loading Items...</h2>
      </div>
    );
  }

  return (
    <div className="inventory-page">
      <section className="inventory-header-row">
        <div>
          <h1>ITEM INVENTORY</h1>
          <p>
            View, monitor, and manage all borrowable items in the QBorrow
            system.
          </p>
        </div>

        <div className="inventory-header-actions">
          {userData?.role === "admin" && (
            <button
              className="inventory-add-btn"
              onClick={() => navigate("/add-item")}
            >
              + Add Item
            </button>
          )}

          <button
            className="inventory-notification-card"
            onClick={() => navigate("/notifications")}
          >
            <img src="/icons/notifications.png" alt="" />
            <span>Notifications</span>
          </button>
        </div>
      </section>

      <section className="inventory-tools">
        <div className="inventory-search">
          <input
            type="text"
            placeholder="Search Item name, Category, or Condition..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <select
          value={availabilityFilter}
          onChange={(event) => setAvailabilityFilter(event.target.value)}
        >
          <option value="All">All Availability</option>
          <option value="Available">Available</option>
          <option value="Borrowed">Borrowed</option>
          <option value="Unavailable">Unavailable</option>
        </select>
      </section>

      <section className="inventory-summary">
        <div>
          <img src="/icons/total-items.png" alt="" />
          <h3>{items.length}</h3>
          <p>Total Items</p>
        </div>

        <div>
          <img src="/icons/available.png" alt="" />
          <h3>
            {items.filter((item) => item.availability === "Available").length}
          </h3>
          <p>Available</p>
        </div>

        <div>
          <img src="/icons/borrowed.png" alt="" />
          <h3>
            {items.filter((item) => item.availability === "Borrowed").length}
          </h3>
          <p>Borrowed</p>
        </div>

        <div>
          <img src="/icons/unavailable.png" alt="" />
          <h3>
            {
              items.filter(
                (item) =>
                  item.availability === "Unavailable" ||
                  item.condition === "Damaged" ||
                  item.condition === "Lost"
              ).length
            }
          </h3>
          <p>Unavailable</p>
        </div>
      </section>

      <section className="inventory-table-card">
        {filteredItems.length === 0 ? (
          <div className="inventory-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No items found</h2>
            <p>Try changing your search or filter.</p>
          </div>
        ) : (
          <div className="inventory-table-wrapper">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Item ID</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Condition</th>
                  <th>Availability</th>
                  <th>QR Code / Barcode</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="item-id-cell">{item.id}</td>

                    <td>{item.itemName}</td>

                    <td className="description-cell">
                      {item.description || "No description yet"}
                    </td>

                    <td>{item.category}</td>

                    <td>
                      <span
                        className={`condition-pill ${getConditionClass(
                          item.condition
                        )}`}
                      >
                        {item.condition}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`availability-pill ${getAvailabilityClass(
                          item.availability
                        )}`}
                      >
                        {item.availability}
                      </span>
                    </td>

                    <td>
                      <div className="compact-qr">
                        <QRCodeGenerator
                          itemId={item.id}
                          itemName={item.itemName}
                        />
                      </div>
                    </td>

                    <td>
                      <div className="inventory-actions">
                        <button
                          className="view-btn"
                          onClick={() => navigate(`/item/${item.id}`)}
                        >
                          View
                        </button>

                        {userData?.role === "admin" && (
                          <>
                            <button
                              className="edit-btn"
                              onClick={() =>
                                navigate(`/edit-item?id=${item.id}`)
                              }
                            >
                              Edit
                            </button>

                            <button
                              className="delete-btn"
                              onClick={() => handleDeleteItem(item.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ItemList;