import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function AddItem() {
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("Good");
  const [availability, setAvailability] = useState("Available");

  async function handleAddItem(e) {
    e.preventDefault();

    if (!itemName || !category) {
      alert("Please fill in item name and category.");
      return;
    }

    try {
      await addDoc(collection(db, "items"), {
        itemName: itemName,
        category: category,
        condition: condition,
        availability: availability,
        createdAt: serverTimestamp(),
      });

      alert("Item added successfully!");

      setItemName("");
      setCategory("");
      setCondition("Good");
      setAvailability("Available");
    } catch (error) {
      alert("Error adding item: " + error.message);
    }
  }

  return (
    <div>
      <h1>Add Item</h1>

      <form onSubmit={handleAddItem}>
        <div>
          <label>Item Name</label>
          <br />
          <input
            type="text"
            placeholder="Example: Projector"
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
            placeholder="Example: Equipment"
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

        <button type="submit">Save Item</button>
      </form>

      <br />

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>
    </div>
  );
}

export default AddItem;