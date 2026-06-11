import { useEffect, useState } from "react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function EditItem() {
  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("Good");
  const [availability, setAvailability] = useState("Available");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get("id");

    if (!idFromUrl) {
      alert("No item ID found.");
      window.location.href = "/items";
      return;
    }

    setItemId(idFromUrl);
    fetchItem(idFromUrl);
  }, []);

  async function fetchItem(id) {
    try {
      const itemRef = doc(db, "items", id);
      const itemSnap = await getDoc(itemRef);

      if (itemSnap.exists()) {
        const item = itemSnap.data();

        setItemName(item.itemName);
        setCategory(item.category);
        setCondition(item.condition);
        setAvailability(item.availability);
      } else {
        alert("Item not found.");
        window.location.href = "/items";
      }
    } catch (error) {
      alert("Error loading item: " + error.message);
    }

    setLoading(false);
  }

  async function handleUpdateItem(e) {
    e.preventDefault();

    if (!itemName || !category) {
      alert("Please fill in item name and category.");
      return;
    }

    try {
      const itemRef = doc(db, "items", itemId);

      await updateDoc(itemRef, {
        itemName: itemName,
        category: category,
        condition: condition,
        availability: availability,
        updatedAt: serverTimestamp(),
      });

      alert("Item updated successfully!");
      window.location.href = "/items";
    } catch (error) {
      alert("Error updating item: " + error.message);
    }
  }

  if (loading) {
    return <h2>Loading item...</h2>;
  }

  return (
    <div>
      <h1>Edit Item</h1>

      <form onSubmit={handleUpdateItem}>
        <div>
          <label>Item Name</label>
          <br />
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
          />
        </div>

        <br />

        <div>
          <label>Category</label>
          <br />
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>

        <br />

        <div>
          <label>Condition</label>
          <br />
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Damaged">Damaged</option>
          </select>
        </div>

        <br />

        <div>
          <label>Availability</label>
          <br />
          <select
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="Available">Available</option>
            <option value="Borrowed">Borrowed</option>
            <option value="Unavailable">Unavailable</option>
          </select>
        </div>

        <br />

        <button type="submit">Update Item</button>
      </form>

      <br />

      <button onClick={() => (window.location.href = "/items")}>
        Back to Item List
      </button>
    </div>
  );
}

export default EditItem;