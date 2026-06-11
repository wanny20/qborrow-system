import { useEffect, useState } from "react";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import QRCodeGenerator from "../components/QRCodeGenerator";

function ItemList() {
  const [items, setItems] = useState([]);

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

    if (!confirmDelete) {
      return;
    }

    try {
      await deleteDoc(doc(db, "items", itemId));
      alert("Item deleted successfully!");
      fetchItems();
    } catch (error) {
      alert("Error deleting item: " + error.message);
    }
  }

  useEffect(() => {
    fetchItems();
  }, []);

  return (
    <div>
      <h1>Item List</h1>

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>

      <br />
      <br />

      {items.length === 0 ? (
        <p>No items found.</p>
      ) : (
        <table border="1" cellPadding="10">
          <thead>
            <tr>
            <th>Item Name</th>
            <th>Category</th>
            <th>Condition</th>
            <th>Availability</th>
            <th>QR Code / Barcode</th>
            <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                <button
                    onClick={() => (window.location.href = `/item/${item.id}`)}
                    style={{
                    background: "none",
                    border: "none",
                    color: "blue",
                    textDecoration: "underline",
                    cursor: "pointer",
                    }}
                >
                    {item.itemName}
                </button>
                </td>
                <td>{item.category}</td>
                <td>{item.condition}</td>
                <td>{item.availability}</td>

                <td>
                <QRCodeGenerator itemId={item.id} itemName={item.itemName} />
                </td>

                <td>
                <button onClick={() => (window.location.href = `/edit-item?id=${item.id}`)}>
                    Edit
                </button>

                <button onClick={() => handleDeleteItem(item.id)}>
                    Delete
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

export default ItemList;